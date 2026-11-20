using System.Diagnostics;
using System.Text.RegularExpressions;

namespace GameWindow;

/// <summary>
/// Bundled Cloudflare quick tunnel. Runs as a child of GameWindow (job-object kill-on-close)
/// and is stopped explicitly on shutdown so it never outlives the app.
/// </summary>
static class CollabTunnel
{
    public const string RelativeExe = "Tools/cloudflared.exe";
    const string DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/download/2026.11.1/cloudflared-windows-amd64.exe";

    static Process? _proc;
    static readonly object Gate = new();
    static readonly Regex UrlRx = new(
        @"https://[a-z0-9-]+\.trycloudflare\.com",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string? PublicUrl { get; private set; }
    public static string? Error { get; private set; }
    public static bool Running
    {
        get { lock (Gate) return _proc is { HasExited: false }; }
    }

    public static void Start(int localPort) => _ = Task.Run(() =>
    {
        try { StartCore(localPort); }
        catch (Exception ex)
        {
            Error = ex.Message;
            Log.Warn("Collab tunnel failed: " + ex.Message);
        }
    });

    static void StartCore(int localPort)
    {
        lock (Gate)
        {
            if (_proc is { HasExited: false }) return;
        }

        var exe = EnsureBundled();
        if (exe == null)
        {
            Error = "Bundled cloudflared is missing";
            Log.Warn("Collab tunnel skipped: " + RelativeExe + " not available.");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = $"tunnel --url http://127.0.0.1:{localPort}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Paths.Root,
        };
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        void OnLine(string? line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            var m = UrlRx.Match(line);
            if (!m.Success) return;
            PublicUrl = m.Value.TrimEnd('/');
            Error = null;
            Log.Info("Collab tunnel ready at " + PublicUrl);
        }
        proc.OutputDataReceived += (_, e) => OnLine(e.Data);
        proc.ErrorDataReceived += (_, e) => OnLine(e.Data);
        proc.Exited += (_, _) =>
        {
            Log.Warn($"Collab tunnel exited (code {proc.ExitCode}).");
            PublicUrl = null;
        };

        if (!proc.Start())
        {
            Error = "Could not start bundled cloudflared";
            return;
        }
        lock (Gate) { _proc = proc; }
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        Log.Info($"Collab tunnel starting (bundled {exe})");
    }

    /// <summary>Prefer Tools under the project root; fall back to next to the exe; copy/download if needed.</summary>
    static string? EnsureBundled()
    {
        var rootPath = Path.Combine(Paths.Root, "Tools", "cloudflared.exe");
        if (File.Exists(rootPath)) return rootPath;

        var basePath = Path.Combine(AppContext.BaseDirectory, "Tools", "cloudflared.exe");
        if (File.Exists(basePath))
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(rootPath)!);
                File.Copy(basePath, rootPath, true);
                return rootPath;
            }
            catch
            {
                return basePath;
            }
        }

        // Last resort: fetch once into the project Tools folder (same binary the build ships).
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(rootPath)!);
            Log.Info("Downloading bundled cloudflared…");
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
            var bytes = http.GetByteArrayAsync(DownloadUrl).GetAwaiter().GetResult();
            File.WriteAllBytes(rootPath, bytes);
            if (File.Exists(rootPath) && new FileInfo(rootPath).Length > 1_000_000)
                return rootPath;
        }
        catch (Exception ex)
        {
            Error = "Could not download cloudflared: " + ex.Message;
            Log.Warn(Error);
        }
        return null;
    }

    public static void Stop()
    {
        Process? proc;
        lock (Gate)
        {
            proc = _proc;
            _proc = null;
        }
        PublicUrl = null;
        if (proc == null) return;
        try
        {
            if (!proc.HasExited)
            {
                proc.Kill(entireProcessTree: true);
                proc.WaitForExit(3000);
            }
        }
        catch { /* shutting down */ }
        try { proc.Dispose(); } catch { /* ignore */ }
        Log.Info("Collab tunnel stopped");
    }
}
