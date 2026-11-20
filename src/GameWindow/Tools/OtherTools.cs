using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using ModelContextProtocol.Server;

namespace GameWindow.Tools;

[McpServerToolType]
public sealed class WindowTools
{
    [McpServerTool(Name = "get_window", ReadOnly = true), Description("Get the window's title, bounds, client size, state, fullscreen, topmost, opacity and DPI.")]
    public static Task<string> GetWindow() => Tool.Run(async () => await Host.OnUi(() => Host.Form.WindowInfo()));

    [McpServerTool(Name = "set_window"), Description("Change the window. Only the parameters you pass are changed. Title, bounds, topmost and opacity persist across restarts.")]
    public static Task<string> SetWindow(
        [Description("Window title")] string? title = null,
        [Description("Left in screen pixels")] int? x = null,
        [Description("Top in screen pixels")] int? y = null,
        [Description("Outer width in pixels")] int? width = null,
        [Description("Outer height in pixels")] int? height = null,
        [Description("normal, minimized or maximized")] string? state = null,
        [Description("Keep above other windows")] bool? topmost = null,
        [Description("0.1 to 1")] double? opacity = null,
        [Description("Borderless fullscreen on the current monitor")] bool? fullscreen = null,
        [Description("Bring the window to the front")] bool focus = false) => Tool.Run(async () => await Host.OnUi(() =>
    {
        Host.Form.ApplyWindow(new WindowChange
        {
            Title = title, X = x, Y = y, Width = width, Height = height,
            State = state, Topmost = topmost, Opacity = opacity, Fullscreen = fullscreen,
        });
        if (focus) Host.Form.BringToFront(true);
        return Host.Form.WindowInfo();
    }));
}

[McpServerToolType]
public sealed class StorageTools
{
    [McpServerTool(Name = "storage_list", ReadOnly = true), Description("List keys in the persistent key/value store (the same store modules use via api.storage).")]
    public static Task<string> StorageList() => Tool.Run(() => Host.Storage.Keys());

    [McpServerTool(Name = "storage_get", ReadOnly = true), Description("Get a value from the persistent store.")]
    public static Task<string> StorageGet([Description("Key")] string key) => Tool.Run(() =>
        Host.Storage.Has(key) ? Host.Storage.Get(key)?.ToJsonString(Host.JsonIndented) ?? "null" : throw new KeyNotFoundException($"No key '{key}'."));

    [McpServerTool(Name = "storage_set"), Description("Set a value in the persistent store. 'value' is parsed as JSON; if it isn't valid JSON it is stored as a string.")]
    public static Task<string> StorageSet([Description("Key")] string key, [Description("JSON value")] string value) => Tool.Run(() =>
    {
        JsonNode? node;
        try { node = JsonNode.Parse(value); }
        catch (JsonException) { node = JsonValue.Create(value); }
        Host.Storage.Set(key, node);
        Host.Post(new { type = "event", name = "storage.changed", data = new { key } });
        return new { key, saved = true };
    });

    [McpServerTool(Name = "storage_delete", Destructive = true), Description("Delete a key from the persistent store.")]
    public static Task<string> StorageDelete([Description("Key")] string key) => Tool.Run(() =>
    {
        var deleted = Host.Storage.Delete(key);
        if (deleted) Host.Post(new { type = "event", name = "storage.changed", data = new { key } });
        return new { key, deleted };
    });
}

[McpServerToolType]
public sealed class ProcessTools
{
    [McpServerTool(Name = "list_processes", ReadOnly = true), Description("List child processes started by the window (by modules or start_process), running and recently exited. All of them are killed when the window closes.")]
    public static Task<string> ListProcesses() => Tool.Run(() => Host.Processes.List());

    [McpServerTool(Name = "start_process", OpenWorld = true), Description("Start a child process owned by the window (killed with the window). Output is buffered; read it with process_output.")]
    public static Task<string> StartProcess(
        [Description("Executable, e.g. 'python', 'node', 'cmd'")] string file,
        [Description("Arguments, one per element")] string[]? args = null,
        [Description("Working directory (default: program folder)")] string? cwd = null,
        [Description("Also stream output to the page as 'process.output' events")] bool streamToPage = false) => Tool.Run(() =>
    {
        var mp = Host.Processes.Start(file, args, null, cwd, null, streamToPage, "mcp");
        return new { id = mp.Id, pid = mp.Proc.Id };
    });

    [McpServerTool(Name = "process_output", ReadOnly = true), Description("Read buffered stdout/stderr of a child process. Pass 'since' = previous 'next' to get only new output.")]
    public static Task<string> ProcessOutput([Description("Process id from start_process/list_processes")] int id, [Description("Sequence number to read after")] long since = 0) =>
        Tool.Run(() => Host.Processes.Get(id).Output(since, 100_000));

    [McpServerTool(Name = "process_input"), Description("Write text to a child process's stdin (include \\n for Enter). Set close to send EOF.")]
    public static Task<string> ProcessInput([Description("Process id")] int id, [Description("Text to write")] string text = "", [Description("Close stdin afterwards")] bool close = false) => Tool.Run(() =>
    {
        if (text.Length > 0) Host.Processes.Write(id, text);
        if (close) Host.Processes.CloseInput(id);
        return new { id, written = text.Length, closed = close };
    });

    [McpServerTool(Name = "kill_process", Destructive = true), Description("Kill a child process and its whole process tree.")]
    public static Task<string> KillProcess([Description("Process id")] int id) => Tool.Run(() => new { id, killed = Host.Processes.Kill(id) });
}

[McpServerToolType]
public sealed class DiagnosticTools
{
    [McpServerTool(Name = "status", ReadOnly = true), Description("Health overview: version, uptime, page ready/responsive, Chromium version, modules (with errors), child processes, memory, MCP and job-object state. Call this first in a new session.")]
    public static Task<string> Status() => Tool.Run(async () =>
    {
        object? webviewProcesses = null;
        try { webviewProcesses = await Host.OnUi(() => Host.Form.ProcessInfo(), 3000); } catch { }
        var self = Process.GetCurrentProcess();
        var modules = Host.Modules.List();
        return new
        {
            version = Host.Version,
            pid = Environment.ProcessId,
            uptime = (DateTime.Now - Host.Started).ToString(@"d\.hh\:mm\:ss"),
            root = Paths.Root,
            mcp = new { url = McpHost.Url, running = McpHost.Running, error = McpHost.Error },
            killOnCloseJob = JobObject.Active,
            page = new
            {
                ready = Host.Form.PageReady,
                responsive = Host.Form.PageResponsive,
                lastPing = Host.Form.LastPing,
                chromium = Host.Form.BrowserVersion,
                webViewError = Host.Form.WebViewError,
                recreations = Host.Form.WebViewRecreations,
            },
            modules = new { count = modules.Length, problems = Host.Modules.Problems().Select(p => p.Name).ToArray() },
            consoleErrors = Host.Console.ErrorCount,
            childProcesses = new { running = Host.Processes.RunningCount, webview = webviewProcesses },
            memoryMb = Math.Round(self.WorkingSet64 / 1048576.0, 1),
        };
    });

    [McpServerTool(Name = "host_log", ReadOnly = true), Description("Tail of the host log (Logs/host.log): startup, crashes, recoveries, tool errors.")]
    public static Task<string> HostLog([Description("Number of lines (default 100)")] int tail = 100) =>
        Tool.Run(() => string.Join("\n", Log.Tail(tail)));

    [McpServerTool(Name = "bridge_api", ReadOnly = true), Description("Reference for writing modules: the module contract, the api object (bus, log, storage, host, onDispose, asset) and every api.host native method. Read this before writing modules.")]
    public static Task<string> BridgeApi() => Tool.Run(() => BridgeDocs.Reference + "\n\nRegistered host methods:\n" + string.Join("\n", Host.Bridge.Methods));

    [McpServerTool(Name = "open_devtools"), Description("Open Chromium DevTools for the page in a separate window (for the user to inspect).")]
    public static Task<string> OpenDevtools() => Tool.Run(async () => { await Host.OnUi(Host.Form.OpenDevTools); return "DevTools opened."; });
}

[McpServerToolType]
public sealed class RecoveryTools
{
    [McpServerTool(Name = "reload_module"), Description("Re-run one module: cleanup, re-import from disk, mount again.")]
    public static Task<string> ReloadModule([Description("Module name")] string name) => Tool.Run(async () =>
    {
        ModuleStore.Check(name);
        var since = DateTime.UtcNow;
        Host.Modules.NotifyChanged(name);
        var st = await Host.Modules.WaitForStatus(name, since, 3000);
        return new { name, status = st?.Status ?? "unknown", error = st?.Error };
    });

    [McpServerTool(Name = "reload_page"), Description("Reload the page and every module (also applies edits to Shell/index.html or Shell/loader.js). Optionally restore the default shell files first.")]
    public static Task<string> ReloadPage([Description("Overwrite Shell/ with the built-in defaults first")] bool restoreDefaultShell = false) => Tool.Run(async () =>
    {
        await Host.OnUi(() => Host.Form.ReloadPage(restoreDefaultShell));
        return await WaitReady();
    });

    [McpServerTool(Name = "reset_webview"), Description("Recover a hung or broken page without restarting the program. Default kills the page's renderer process (works even in an infinite loop) and reloads all modules; hard=true rebuilds the whole WebView control.")]
    public static Task<string> ResetWebView([Description("Rebuild the WebView control instead of just the renderer")] bool hard = false) => Tool.Run(async () =>
    {
        var message = await Host.OnUi(() => Host.Form.ResetWebView(hard), 20000);
        var ready = await WaitReady();
        return message + " " + ready;
    });

    static async Task<string> WaitReady()
    {
        await Task.Delay(300);
        for (int i = 0; i < 100 && !Host.Form.PageReady; i++) await Task.Delay(100);
        return Host.Form.PageReady ? "Page ready." : "Page not ready yet; check status.";
    }
}
