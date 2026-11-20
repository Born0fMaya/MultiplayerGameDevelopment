using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace GameWindow;

/// <summary>Process-wide services shared by the window, the bridge and the MCP tools.</summary>
static class Host
{
    public static string Version => typeof(Host).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";
    public static readonly DateTime Started = DateTime.Now;

    public static MainForm Form = null!;
    public static StateStore State = null!;
    public static KeyValueStore Storage = null!;
    public static ConsoleBuffer Console = null!;
    public static ModuleStore Modules = null!;
    public static AssetStore Assets = null!;
    public static ProcessManager Processes = null!;
    public static HostBridge Bridge = null!;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    public static readonly JsonSerializerOptions JsonIndented = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    public static readonly JsonSerializerOptions JsonNoNulls = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static void Init()
    {
        State = new StateStore(Paths.StateFile);
        Storage = new KeyValueStore(Paths.StorageFile);
        Console = new ConsoleBuffer();
        Modules = new ModuleStore();
        Assets = new AssetStore();
        Processes = new ProcessManager();
        Bridge = new HostBridge();
    }

    /// <summary>Sends a message to the page. Safe to call from any thread.</summary>
    public static void Post(object message) => Form?.PostToPage(JsonSerializer.Serialize(message, Json));

    /// <summary>
    /// Runs work on the UI thread. Returns a timeout error instead of blocking forever if the window or
    /// page is stuck. A timeout of 0 waits indefinitely (used for modal dialogs).
    /// </summary>
    public static async Task<T> OnUi<T>(Func<Task<T>> work, int timeoutMs = 10000)
    {
        var form = Form;
        if (form == null || form.IsDisposed || !form.IsHandleCreated)
            throw new InvalidOperationException("The window is not available.");
        if (!form.InvokeRequired) return await work();

        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        form.BeginInvoke(new Action(async () =>
        {
            try { tcs.TrySetResult(await work()); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        }));
        if (timeoutMs <= 0) return await tcs.Task;
        var done = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs));
        if (done != tcs.Task)
            throw new TimeoutException($"Timed out after {timeoutMs} ms. The page may be busy or hung; check status and use reset_webview if needed.");
        return await tcs.Task;
    }

    public static Task<T> OnUi<T>(Func<T> work, int timeoutMs = 10000) => OnUi(() => Task.FromResult(work()), timeoutMs);

    public static Task OnUi(Action work, int timeoutMs = 10000) => OnUi(() => { work(); return true; }, timeoutMs);

    /// <summary>Evaluates JavaScript in the page via DevTools, awaiting promises and returning the value as JSON.</summary>
    public static async Task<JsonNode?> Eval(string expression, int timeoutMs = 10000)
    {
        var res = await Form.Cdp("Runtime.evaluate", new
        {
            expression,
            awaitPromise = true,
            returnByValue = true,
            replMode = true,
            userGesture = true,
            timeout = timeoutMs
        }, timeoutMs + 2000);

        if (res?["exceptionDetails"] is JsonNode ex)
        {
            var desc = ex["exception"]?["description"]?.ToString() ?? ex["text"]?.ToString() ?? "Unknown error";
            throw new InvalidOperationException("JavaScript error: " + desc);
        }
        var result = res?["result"];
        if (result == null || result["type"]?.ToString() == "undefined") return null;
        if (result.AsObject().TryGetPropertyValue("value", out var value)) return value?.DeepClone();
        return (result["unserializableValue"] ?? result["description"])?.DeepClone();
    }
}
