namespace GameWindow;

/// <summary>Finds a git.exe even when the GUI process PATH is bare (Explorer / no Git on PATH).</summary>
static class GitLocator
{
    static string? _cached;

    public static string? Find()
    {
        if (_cached != null) return File.Exists(_cached) ? _cached : null;

        foreach (var candidate in Candidates())
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate))
                {
                    _cached = candidate;
                    Log.Info($"Using git at {candidate}");
                    return candidate;
                }
            }
            catch { /* skip bad path */ }
        }

        return null;
    }

    static IEnumerable<string> Candidates()
    {
        yield return "git.exe";
        yield return "git";

        var programFiles = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetEnvironmentVariable("LocalAppData") ?? "",
            Environment.GetEnvironmentVariable("ProgramW6432") ?? "",
        };

        foreach (var root in programFiles.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            yield return Path.Combine(root, "Git", "cmd", "git.exe");
            yield return Path.Combine(root, "Git", "bin", "git.exe");
            yield return Path.Combine(root, "Programs", "Git", "cmd", "git.exe");
            yield return Path.Combine(root, "Programs", "Git", "bin", "git.exe");
        }

        // GitHub Desktop ships its own git — common when someone cloned via Desktop and never installed Git for Windows.
        var local = Environment.GetEnvironmentVariable("LocalAppData");
        if (!string.IsNullOrWhiteSpace(local))
        {
            var desktop = Path.Combine(local, "GitHubDesktop");
            if (Directory.Exists(desktop))
            {
                IEnumerable<string> apps;
                try
                {
                    apps = Directory.EnumerateDirectories(desktop, "app-*")
                        .OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase);
                }
                catch { apps = []; }

                foreach (var app in apps)
                {
                    yield return Path.Combine(app, "resources", "app", "git", "cmd", "git.exe");
                    yield return Path.Combine(app, "resources", "app", "git", "mingw64", "bin", "git.exe");
                }
            }
        }

        // where.exe can see a user PATH that CreateProcess misses in some setups
        string? fromWhere = null;
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "where.exe",
                Arguments = "git",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc != null)
            {
                var output = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(5000);
                fromWhere = output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .FirstOrDefault(line => line.EndsWith("git.exe", StringComparison.OrdinalIgnoreCase));
            }
        }
        catch { /* where unavailable */ }
        if (!string.IsNullOrWhiteSpace(fromWhere)) yield return fromWhere;
    }
}
