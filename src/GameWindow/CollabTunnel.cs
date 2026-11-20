using System.Diagnostics;
using System.Text.RegularExpressions;

namespace GameWindow;

/// <summary>
/// Outbound Cloudflare quick tunnel so guests can reach CollabHost without router
/// port forwarding (Xfinity often blocks local port-forward UI).
/// </summary>
static class CollabTunnel
{
    static Process? _proc;
    static readonly object Gate = new();
    static readonly Regex UrlRx = new(
        @"https://[a-z0-9-]+\.trycloudflare\.com",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string? PublicUrl { get; private set; }
    public static string? Error { get; private set; }

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

        var exe = FindCloudflared();
        if (exe == null)
        {
            Error = "cloudflared not found";
            Log.Warn("Collab tunnel skipped: cloudflared.exe not installed.");
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
            if (PublicUrl != null) PublicUrl = null;
        };

        if (!proc.Start())
        {
            Error = "Could not start cloudflared";
            return;
        }
        lock (Gate) { _proc = proc; }
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        Log.Info($"Collab tunnel starting ({exe})");
    }

    static string? FindCloudflared()
    {
        var bundled = Path.Combine(Paths.Root, "Tools", "cloudflared.exe");
        if (File.Exists(bundled)) return bundled;

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "cloudflared", "cloudflared.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Links", "cloudflared.exe"),
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return c;

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "where",
                Arguments = "cloudflared",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
            };
            using var p = Process.Start(psi);
            var output = p?.StandardOutput.ReadToEnd() ?? "";
            p?.WaitForExit(3000);
            var first = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (!string.IsNullOrEmpty(first) && File.Exists(first)) return first;
        }
        catch { /* ignore */ }

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
                proc.WaitForExit(2000);
            }
        }
        catch { /* shutting down */ }
        try { proc.Dispose(); } catch { /* ignore */ }
    }
}
