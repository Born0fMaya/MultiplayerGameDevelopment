namespace GameWindow;

/// <summary>Checks git remote status, pulls latest, and hot-reloads when possible.</summary>
static class AppUpdate
{
    public static Task<object?> CheckAsync() => StatusAsync(fetch: true);

    public static async Task<object?> RunAsync()
    {
        var repo = FindGitRoot(Paths.Root);
        if (repo == null)
            return Fail("No git repository found near the program folder.");

        var before = (await Git(repo, "rev-parse", "HEAD")).Stdout.Trim();
        if (string.IsNullOrEmpty(before))
            return Fail("Could not read the current git revision.");

        var pull = await Git(repo, "pull", "--ff-only");
        if (pull.TimedOut)
            return Fail("git pull timed out.");
        if ((pull.ExitCode ?? 1) != 0)
        {
            var detail = FirstLine(pull.Stderr) ?? FirstLine(pull.Stdout) ?? "git pull failed.";
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

        var needsRestart = files.Any(NeedsRestart);
        var canHotReload = files.Any(IsHotReloadable);

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

        try
        {
            await Host.OnUi(() =>
            {
                Host.Form.Notify("Update", message);
                return (object?)true;
            });
        }
        catch { /* tray notify is best-effort */ }

        Log.Info($"app.update: {Short(before)} → {Short(after)} ({files.Length} files, reload={reloaded}, restart={needsRestart})");

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
            stdout = pull.Stdout,
            stderr = pull.Stderr,
        };
    }

    static async Task<object?> StatusAsync(bool fetch)
    {
        var repo = FindGitRoot(Paths.Root);
        if (repo == null)
            return Fail("No git repository found near the program folder.");

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

    static string Short(string hash) => hash.Length <= 7 ? hash : hash[..7];

    sealed record GitResult(int? ExitCode, bool TimedOut, string Stdout, string Stderr);

    static Task<GitResult> Git(string repo, params string[] args) => Git(repo, 120_000, args);

    static async Task<GitResult> Git(string repo, int timeoutMs, params string[] args)
    {
        var mp = Host.Processes.Start(
            "git",
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
}
