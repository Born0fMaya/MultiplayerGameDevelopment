using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GameWindow;

/// <summary>Checks remote status, pulls latest (git or GitHub zip fallback), and hot-reloads when possible.</summary>
static class AppUpdate
{
    static readonly string[] PreserveTopLevels =
    [
        ".git", "Storage", "Projects", "Logs", "WebView2", "WebView2Data",
    ];

    public static Task<object?> CheckAsync() => StatusAsync(fetch: true);

    public static async Task<object?> RunAsync()
    {
        var repo = FindGitRoot(Paths.Root);
        if (repo == null)
            return Fail("No git repository found near the program folder.");

        if (GitLocator.Find() == null)
            return await RunViaGithubZip(repo);

        var before = (await Git(repo, "rev-parse", "HEAD")).Stdout.Trim();
        if (string.IsNullOrEmpty(before))
            return Fail("Could not read the current git revision.");

        var pull = await Git(repo, "pull", "--ff-only");
        if (pull.TimedOut)
            return Fail("git pull timed out.");
        if ((pull.ExitCode ?? 1) != 0)
        {
            var detail = FirstLine(pull.Stderr) ?? FirstLine(pull.Stdout) ?? "git pull failed.";
            if (LooksLikeMissingGit(detail))
                return await RunViaGithubZip(repo);
            return Fail(detail, pull.Stdout, pull.Stderr);
        }

        var after = (await Git(repo, "rev-parse", "HEAD")).Stdout.Trim();
        var pullText = (pull.Stdout + "\n" + pull.Stderr).Trim();
        if (string.Equals(before, after, StringComparison.OrdinalIgnoreCase)
            || pullText.Contains("Already up to date", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = true,
                updated = false,
                reloaded = false,
                needsRestart = false,
                latest = true,
                outdated = false,
                behind = 0,
                version = Host.Version,
                message = "You're on the latest version.",
                stdout = pull.Stdout,
                stderr = pull.Stderr,
            };
        }

        var diff = await Git(repo, "diff", "--name-only", before, after);
        var files = diff.Stdout
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(f => f.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return await FinishUpdate(before, after, files, pull.Stdout, pull.Stderr);
    }

    static async Task<object?> StatusAsync(bool fetch)
    {
        var repo = FindGitRoot(Paths.Root);
        if (repo == null)
            return Fail("No git repository found near the program folder.");

        if (GitLocator.Find() == null)
            return await StatusViaGithub(repo);

        try
        {
            return await StatusViaGit(repo, fetch);
        }
        catch (Exception ex) when (LooksLikeMissingGit(ex.Message))
        {
            return await StatusViaGithub(repo);
        }
    }

    static async Task<object?> StatusViaGit(string repo, bool fetch)
    {
        var head = (await Git(repo, "rev-parse", "HEAD")).Stdout.Trim();
        if (string.IsNullOrEmpty(head))
            return Fail("Could not read the current git revision.");

        var branchResult = await Git(repo, "rev-parse", "--abbrev-ref", "HEAD");
        var branch = branchResult.Stdout.Trim();
        if (string.IsNullOrEmpty(branch) || branch == "HEAD") branch = "detached";

        string? upstream = null;
        var upstreamResult = await Git(repo, "rev-parse", "--abbrev-ref", "@{u}");
        if ((upstreamResult.ExitCode ?? 1) == 0)
            upstream = upstreamResult.Stdout.Trim();
        if (string.IsNullOrEmpty(upstream))
        {
            var originHead = await Git(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD");
            if ((originHead.ExitCode ?? 1) == 0)
            {
                var refName = originHead.Stdout.Trim();
                const string prefix = "refs/remotes/";
                upstream = refName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                    ? refName[prefix.Length..]
                    : "origin/main";
            }
            else
            {
                upstream = branch is "detached" or "" ? "origin/main" : $"origin/{branch}";
            }
        }

        if (fetch)
        {
            var remote = upstream.Contains('/') ? upstream.Split('/')[0] : "origin";
            var fetched = await Git(repo, 60_000, "fetch", "--quiet", "--prune", remote);
            if (fetched.TimedOut)
                return Fail("git fetch timed out.", fetched.Stdout, fetched.Stderr);
            if ((fetched.ExitCode ?? 1) != 0)
            {
                var detail = FirstLine(fetched.Stderr) ?? FirstLine(fetched.Stdout) ?? "git fetch failed.";
                if (LooksLikeMissingGit(detail))
                    return await StatusViaGithub(repo);
                return Fail(detail, fetched.Stdout, fetched.Stderr);
            }
        }

        var remoteHeadResult = await Git(repo, "rev-parse", upstream);
        if ((remoteHeadResult.ExitCode ?? 1) != 0 || string.IsNullOrWhiteSpace(remoteHeadResult.Stdout))
        {
            return Fail(
                FirstLine(remoteHeadResult.Stderr) ?? $"Could not resolve {upstream}.",
                remoteHeadResult.Stdout,
                remoteHeadResult.Stderr);
        }
        var remoteHead = remoteHeadResult.Stdout.Trim();

        var behindResult = await Git(repo, "rev-list", "--count", $"HEAD..{upstream}");
        var aheadResult = await Git(repo, "rev-list", "--count", $"{upstream}..HEAD");
        var behind = ParseCount(behindResult.Stdout);
        var ahead = ParseCount(aheadResult.Stdout);
        var latest = behind == 0;
        var message = latest
            ? (ahead > 0 ? $"Latest remote — {ahead} local commit(s) not pushed." : "You're on the latest version.")
            : $"Update available — {behind} commit(s) behind.";

        return new
        {
            ok = true,
            latest,
            outdated = !latest,
            behind,
            ahead,
            branch,
            upstream,
            local = head,
            remote = remoteHead,
            version = Host.Version,
            message,
        };
    }

    static async Task<object?> StatusViaGithub(string repo)
    {
        var (owner, name, branch) = await ResolveGithub(repo);
        if (owner == null || name == null)
            return Fail("Git was not found, and the GitHub remote could not be read from .git/config. Install Git for Windows, or open this folder in GitHub Desktop.");

        var local = ReadLocalHead(repo);
        var remote = await FetchGithubSha(owner, name, branch);
        if (string.IsNullOrEmpty(remote))
            return Fail("Could not reach GitHub to check for updates.");

        var latest = !string.IsNullOrEmpty(local)
            && string.Equals(local, remote, StringComparison.OrdinalIgnoreCase);
        // Without git rev-list we only know equal vs different.
        var outdated = !latest;
        var message = latest
            ? "You're on the latest version."
            : (string.IsNullOrEmpty(local)
                ? "Update available (GitHub zip sync)."
                : "Update available — remote has newer commits.");

        return new
        {
            ok = true,
            latest,
            outdated,
            behind = outdated ? 1 : 0,
            ahead = 0,
            branch,
            upstream = $"origin/{branch}",
            local = local ?? "",
            remote,
            version = Host.Version,
            message,
            method = "github",
        };
    }

    static async Task<object?> RunViaGithubZip(string repo)
    {
        var (owner, name, branch) = await ResolveGithub(repo);
        if (owner == null || name == null)
            return Fail("Git was not found on this PC. Install Git for Windows (git-scm.com) or GitHub Desktop, then try Update again.");

        var before = ReadLocalHead(repo) ?? "";
        var remote = await FetchGithubSha(owner, name, branch);
        if (!string.IsNullOrEmpty(before) && !string.IsNullOrEmpty(remote)
            && string.Equals(before, remote, StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = true,
                updated = false,
                reloaded = false,
                needsRestart = false,
                latest = true,
                outdated = false,
                behind = 0,
                version = Host.Version,
                message = "You're on the latest version.",
                method = "github-zip",
            };
        }

        var url = $"https://github.com/{owner}/{name}/archive/refs/heads/{branch}.zip";
        Log.Info($"app.update: downloading {url}");
        byte[] zipBytes;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd("GameWindow-Update");
            using var res = await HttpBridge.Client.SendAsync(req);
            if (!res.IsSuccessStatusCode)
                return Fail($"GitHub download failed ({(int)res.StatusCode}).");
            zipBytes = await res.Content.ReadAsByteArrayAsync();
        }
        catch (Exception ex)
        {
            return Fail("GitHub download failed: " + ex.Message);
        }

        var tempRoot = Path.Combine(Path.GetTempPath(), "GameWindow-update-" + Guid.NewGuid().ToString("N"));
        var zipPath = tempRoot + ".zip";
        try
        {
            Directory.CreateDirectory(tempRoot);
            await File.WriteAllBytesAsync(zipPath, zipBytes);
            ZipFile.ExtractToDirectory(zipPath, tempRoot);

            var source = Directory.EnumerateDirectories(tempRoot).FirstOrDefault()
                ?? throw new InvalidOperationException("Zip archive had no project folder.");

            var copied = OverlayTree(source, repo);
            var needsRestart = copied.Any(NeedsRestart);
            var canHotReload = copied.Any(IsHotReloadable);
            WriteLocalHeadHint(repo, remote);

            return await FinishUpdate(before, remote ?? "", copied, "", "", needsRestart, canHotReload, zipFallback: true);
        }
        catch (Exception ex)
        {
            return Fail("Could not apply GitHub zip update: " + ex.Message);
        }
        finally
        {
            try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch { }
            try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
        }
    }

    static async Task<object?> FinishUpdate(
        string before,
        string after,
        string[] files,
        string stdout,
        string stderr,
        bool? needsRestartOverride = null,
        bool? canHotReloadOverride = null,
        bool zipFallback = false)
    {
        var needsRestart = needsRestartOverride ?? files.Any(NeedsRestart);
        var canHotReload = canHotReloadOverride ?? files.Any(IsHotReloadable);

        var reloaded = false;
        if (canHotReload)
        {
            try
            {
                await Host.OnUi(() =>
                {
                    Host.Form.ReloadPage(false);
                    return (object?)true;
                });
                reloaded = true;
            }
            catch (Exception ex)
            {
                Log.Warn("Update reload failed: " + ex.Message);
            }
        }

        var message = needsRestart
            ? (reloaded
                ? "Updated and reloaded scripts. Restart GameWindow to apply native/C# changes."
                : "Updated. Restart GameWindow to apply the changes.")
            : (reloaded
                ? "Updated and reloaded."
                : "Updated.");
        if (zipFallback)
            message += " (synced from GitHub without local git)";

        try
        {
            await Host.OnUi(() =>
            {
                Host.Form.Notify("Update", message);
                return (object?)true;
            });
        }
        catch { /* tray notify is best-effort */ }

        Log.Info($"app.update: {Short(before)} → {Short(after)} ({files.Length} files, reload={reloaded}, restart={needsRestart}, zip={zipFallback})");

        return new
        {
            ok = true,
            updated = true,
            reloaded,
            needsRestart,
            latest = true,
            outdated = false,
            behind = 0,
            version = Host.Version,
            before,
            after,
            files,
            message,
            stdout,
            stderr,
            method = zipFallback ? "github-zip" : "git",
        };
    }

    static string[] OverlayTree(string sourceRoot, string destRoot)
    {
        var copied = new List<string>();
        foreach (var file in Directory.EnumerateFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(sourceRoot, file);
            if (ShouldPreserve(rel)) continue;
            var dest = Path.Combine(destRoot, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.Copy(file, dest, overwrite: true);
            copied.Add(rel.Replace('\\', '/'));
        }
        return copied.ToArray();
    }

    static bool ShouldPreserve(string relative)
    {
        var top = relative.Replace('\\', '/').Split('/', 2)[0];
        return PreserveTopLevels.Any(p => p.Equals(top, StringComparison.OrdinalIgnoreCase));
    }

    static async Task<(string? Owner, string? Name, string Branch)> ResolveGithub(string repo)
    {
        var branch = ReadLocalBranch(repo) ?? "main";
        var url = ReadOriginUrl(repo);
        if (string.IsNullOrWhiteSpace(url))
            return ("Born0fMaya", "MultiplayerGameDevelopment", branch);

        // https://github.com/Owner/Repo.git or git@github.com:Owner/Repo.git
        var https = Regex.Match(url, @"github\.com[:/](?<owner>[^/]+)/(?<name>[^/.]+)", RegexOptions.IgnoreCase);
        if (!https.Success) return (null, null, branch);
        return (https.Groups["owner"].Value, https.Groups["name"].Value, branch);
    }

    static string? ReadOriginUrl(string repo)
    {
        try
        {
            var config = Path.Combine(repo, ".git", "config");
            if (!File.Exists(config)) return null;
            string? section = null;
            foreach (var raw in File.ReadLines(config))
            {
                var line = raw.Trim();
                if (line.StartsWith('[') && line.EndsWith(']'))
                {
                    section = line.Trim('[', ']');
                    continue;
                }
                if (section != null
                    && section.Equals("remote \"origin\"", StringComparison.OrdinalIgnoreCase)
                    && line.StartsWith("url", StringComparison.OrdinalIgnoreCase))
                {
                    var parts = line.Split('=', 2);
                    if (parts.Length == 2) return parts[1].Trim();
                }
            }
        }
        catch { }
        return null;
    }

    static string? ReadLocalBranch(string repo)
    {
        try
        {
            var head = Path.Combine(repo, ".git", "HEAD");
            if (!File.Exists(head)) return null;
            var text = File.ReadAllText(head).Trim();
            const string prefix = "ref: refs/heads/";
            if (text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return text[prefix.Length..].Trim();
        }
        catch { }
        return null;
    }

    static string? ReadLocalHead(string repo)
    {
        try
        {
            var head = Path.Combine(repo, ".git", "HEAD");
            if (!File.Exists(head)) return TryReadHint(repo);
            var text = File.ReadAllText(head).Trim();
            if (Regex.IsMatch(text, "^[0-9a-fA-F]{40}$")) return text.ToLowerInvariant();
            const string prefix = "ref: ";
            if (!text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return TryReadHint(repo);
            var refPath = Path.Combine(repo, ".git", text[prefix.Length..].Trim().Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(refPath))
                return File.ReadAllText(refPath).Trim().ToLowerInvariant();
            // packed-refs
            var packed = Path.Combine(repo, ".git", "packed-refs");
            if (File.Exists(packed))
            {
                var want = text[prefix.Length..].Trim();
                foreach (var line in File.ReadLines(packed))
                {
                    if (line.StartsWith('#') || line.StartsWith('^')) continue;
                    var parts = line.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length == 2 && parts[1].Equals(want, StringComparison.OrdinalIgnoreCase))
                        return parts[0].Trim().ToLowerInvariant();
                }
            }
        }
        catch { }
        return TryReadHint(repo);
    }

    static string HintPath(string repo) => Path.Combine(repo, "Storage", "update-head.txt");

    static string? TryReadHint(string repo)
    {
        try
        {
            var path = HintPath(repo);
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path).Trim();
            return Regex.IsMatch(text, "^[0-9a-fA-F]{7,40}$") ? text.ToLowerInvariant() : null;
        }
        catch { return null; }
    }

    static void WriteLocalHeadHint(string repo, string? sha)
    {
        if (string.IsNullOrWhiteSpace(sha)) return;
        try
        {
            Directory.CreateDirectory(Path.Combine(repo, "Storage"));
            File.WriteAllText(HintPath(repo), sha.Trim().ToLowerInvariant());
        }
        catch { }
    }

    static async Task<string?> FetchGithubSha(string owner, string name, string branch)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{owner}/{name}/commits/{branch}");
            req.Headers.UserAgent.ParseAdd("GameWindow-Update");
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            using var res = await HttpBridge.Client.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            await using var stream = await res.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
            if (doc.RootElement.TryGetProperty("sha", out var sha) && sha.ValueKind == JsonValueKind.String)
                return sha.GetString()?.ToLowerInvariant();
        }
        catch (Exception ex)
        {
            Log.Warn("GitHub commit lookup failed: " + ex.Message);
        }
        return null;
    }

    static object Fail(string error, string? stdout = null, string? stderr = null) => new
    {
        ok = false,
        updated = false,
        reloaded = false,
        needsRestart = false,
        latest = false,
        outdated = false,
        version = Host.Version,
        error,
        message = error,
        stdout = stdout ?? "",
        stderr = stderr ?? "",
    };

    static string? FindGitRoot(string start)
    {
        DirectoryInfo? dir = new(start);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, ".git"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    static bool IsHotReloadable(string relative)
    {
        var path = relative.Replace('\\', '/');
        return path.StartsWith("Modules/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("Shell/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("src/GameWindow/DefaultShell/", StringComparison.OrdinalIgnoreCase);
    }

    static bool NeedsRestart(string relative)
    {
        var path = relative.Replace('\\', '/');
        if (path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("src/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("Tools/", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    static bool LooksLikeMissingGit(string text) =>
        text.Contains("cannot find the file", StringComparison.OrdinalIgnoreCase)
        || text.Contains("cannot find the file specified", StringComparison.OrdinalIgnoreCase)
        || text.Contains("No such file or directory", StringComparison.OrdinalIgnoreCase)
        || (text.Contains("git", StringComparison.OrdinalIgnoreCase)
            && text.Contains("not found", StringComparison.OrdinalIgnoreCase));

    static string? FirstLine(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        return text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
    }

    static int ParseCount(string text)
    {
        var line = FirstLine(text);
        return int.TryParse(line, out var n) && n >= 0 ? n : 0;
    }

    static string Short(string hash) => string.IsNullOrEmpty(hash) ? "?" : (hash.Length <= 7 ? hash : hash[..7]);

    sealed record GitResult(int? ExitCode, bool TimedOut, string Stdout, string Stderr);

    static Task<GitResult> Git(string repo, params string[] args) => Git(repo, 120_000, args);

    static async Task<GitResult> Git(string repo, int timeoutMs, params string[] args)
    {
        var git = GitLocator.Find() ?? "git";
        try
        {
            var mp = Host.Processes.Start(
                git,
                args,
                null,
                repo,
                new Dictionary<string, string?> { ["GIT_TERMINAL_PROMPT"] = "0" },
                streamToPage: false,
                owner: "update");
            var finished = await Task.WhenAny(mp.Completion.Task, Task.Delay(timeoutMs)) == mp.Completion.Task;
            if (!finished)
            {
                Host.Processes.Kill(mp.Id);
                return new GitResult(null, true, mp.Text("stdout"), mp.Text("stderr"));
            }
            return new GitResult(mp.ExitCode, false, mp.Text("stdout"), mp.Text("stderr"));
        }
        catch (Exception ex)
        {
            return new GitResult(1, false, "", ex.Message);
        }
    }
}
