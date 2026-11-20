using System.Drawing.Imaging;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GameWindow;

/// <summary>Arguments of a bridge call (the JS args array).</summary>
readonly struct BridgeArgs(JsonElement array)
{
    public int Count => array.ValueKind == JsonValueKind.Array ? array.GetArrayLength() : 0;

    public JsonElement? At(int i) => i < Count && array[i].ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) ? array[i] : null;

    public string Str(int i) => At(i) is { ValueKind: JsonValueKind.String } e
        ? e.GetString()!
        : throw new ArgumentException($"Argument {i + 1} must be a string.");

    public string? OptStr(int i) => At(i) is { ValueKind: JsonValueKind.String } e ? e.GetString() : null;

    public bool Bool(int i, bool fallback = false) => At(i) is { } e && e.ValueKind is JsonValueKind.True or JsonValueKind.False ? e.GetBoolean() : fallback;

    public int Int(int i) => At(i) is { ValueKind: JsonValueKind.Number } e ? e.GetInt32() : throw new ArgumentException($"Argument {i + 1} must be a number.");

    public JsonElement? Obj(int i) => At(i) is { ValueKind: JsonValueKind.Object } e ? e : null;

    public static string? Prop(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;

    public static bool? PropBool(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;

    public static double? PropNum(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    public static string[]? PropStrings(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Select(x => x.ToString()).ToArray()
            : null;
}

/// <summary>Dispatches api.host calls from the page (chrome.webview.postMessage) to native handlers.</summary>
sealed class HostBridge
{
    delegate Task<object?> Handler(BridgeArgs a);

    readonly Dictionary<string, Handler> _handlers = new(StringComparer.Ordinal);

    public IEnumerable<string> Methods => _handlers.Keys.OrderBy(k => k, StringComparer.Ordinal);

    public HostBridge()
    {
        Sync("host.info", _ => new
        {
            version = Host.Version,
            root = Paths.Root,
            mcp = McpHost.Url,
            collab = $"http://127.0.0.1:{CollabHost.Port}/",
            collabPort = CollabHost.Port,
            collabRunning = CollabHost.Running,
            pid = Environment.ProcessId,
        });
        Sync("host.methods", _ => Methods.ToArray());

        // fs (full access; relative paths resolve against the program folder)
        Sync("fs.read", a => File.ReadAllText(Paths.Resolve(a.Str(0))));
        Sync("fs.readBytes", a => Convert.ToBase64String(File.ReadAllBytes(Paths.Resolve(a.Str(0)))));
        Sync("fs.write", a => { var p = Paths.Resolve(a.Str(0)); EnsureDir(p); File.WriteAllText(p, a.OptStr(1) ?? ""); return true; });
        Sync("fs.writeBytes", a => { var p = Paths.Resolve(a.Str(0)); EnsureDir(p); File.WriteAllBytes(p, Convert.FromBase64String(a.Str(1))); return true; });
        Sync("fs.append", a => { var p = Paths.Resolve(a.Str(0)); EnsureDir(p); File.AppendAllText(p, a.OptStr(1) ?? ""); return true; });
        Sync("fs.list", a => ListDir(Paths.Resolve(a.OptStr(0) ?? "."), a.OptStr(1) ?? "*", a.Bool(2)));
        Sync("fs.delete", a =>
        {
            var p = Paths.Resolve(a.Str(0));
            if (File.Exists(p)) { File.Delete(p); return true; }
            if (Directory.Exists(p)) { Directory.Delete(p, a.Bool(1)); return true; }
            return false;
        });
        Sync("fs.exists", a => { var p = Paths.Resolve(a.Str(0)); return File.Exists(p) || Directory.Exists(p); });
        Sync("fs.mkdir", a => { Directory.CreateDirectory(Paths.Resolve(a.Str(0))); return true; });
        Sync("fs.stat", a => Stat(Paths.Resolve(a.Str(0))));
        Sync("fs.copy", a =>
        {
            var src = Paths.Resolve(a.Str(0)); var dst = Paths.Resolve(a.Str(1));
            EnsureDir(dst);
            if (Directory.Exists(src)) CopyDir(src, dst, a.Bool(2)); else File.Copy(src, dst, a.Bool(2));
            return true;
        });
        Sync("fs.move", a =>
        {
            var src = Paths.Resolve(a.Str(0)); var dst = Paths.Resolve(a.Str(1));
            EnsureDir(dst);
            if (Directory.Exists(src)) Directory.Move(src, dst); else File.Move(src, dst, a.Bool(2));
            return true;
        });
        Sync("fs.watch", a => FsWatches.Watch(a.Str(0), a.Bool(1)));
        Sync("fs.unwatch", a => FsWatches.Unwatch(a.Int(0)));

        // http
        Async("http.fetch", a => HttpBridge.Fetch(a.Str(0), a.Obj(1)));
        Sync("http.abort", a => HttpBridge.Abort(a.Int(0)));

        // processes
        Sync("process.start", a =>
        {
            var opts = a.Obj(2);
            var env = opts is { } o && o.TryGetProperty("env", out var e) && e.ValueKind == JsonValueKind.Object
                ? e.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ValueKind == JsonValueKind.Null ? null : (string?)p.Value.ToString())
                : null;
            var (list, str) = ArgsOf(a.At(1));
            var mp = Host.Processes.Start(a.Str(0), list, str, BridgeArgs.Prop(opts, "cwd"), env,
                BridgeArgs.PropBool(opts, "stream") ?? true, "page");
            return new { id = mp.Id, pid = mp.Proc.Id };
        });
        Async("process.exec", async a =>
        {
            var opts = a.Obj(2);
            var (list, str) = ArgsOf(a.At(1));
            return await Host.Processes.Exec(a.Str(0), list, str, BridgeArgs.Prop(opts, "cwd"), BridgeArgs.Prop(opts, "stdin"),
                (int)(BridgeArgs.PropNum(opts, "timeoutMs") ?? 60000), "page");
        });
        Sync("process.write", a => { Host.Processes.Write(a.Int(0), a.Str(1)); return true; });
        Sync("process.closeInput", a => { Host.Processes.CloseInput(a.Int(0)); return true; });
        Sync("process.kill", a => Host.Processes.Kill(a.Int(0)));
        Sync("process.list", _ => Host.Processes.List());
        Sync("process.output", a => Host.Processes.Get(a.Int(0)).Output(a.At(1) is { ValueKind: JsonValueKind.Number } s ? s.GetInt64() : 0, 200_000));

        // window
        Async("window.get", _ => Host.OnUi(() => (object?)Host.Form.WindowInfo()));
        Async("window.set", a => Host.OnUi(() => { Host.Form.ApplyWindow(WindowChange.From(a.Obj(0))); return (object?)Host.Form.WindowInfo(); }));
        Async("window.title", a => Host.OnUi(() => { if (a.OptStr(0) is { } t) Host.Form.ApplyWindow(new WindowChange { Title = t }); return (object?)Host.Form.Text; }));
        Async("window.bounds", a => Host.OnUi(() => { if (a.Obj(0) is { } b) Host.Form.ApplyWindow(WindowChange.From(b)); return (object?)Host.Form.WindowInfo(); }));
        Async("window.state", a => Host.OnUi(() => { Host.Form.ApplyWindow(new WindowChange { State = a.Str(0) }); return (object?)true; }));
        Async("window.topmost", a => Host.OnUi(() => { Host.Form.ApplyWindow(new WindowChange { Topmost = a.Bool(0, true) }); return (object?)true; }));
        Async("window.opacity", a => Host.OnUi(() => { Host.Form.ApplyWindow(new WindowChange { Opacity = a.At(0)?.GetDouble() }); return (object?)true; }));
        Async("window.fullscreen", a => Host.OnUi(() => { Host.Form.ApplyWindow(new WindowChange { Fullscreen = a.Bool(0, true) }); return (object?)true; }));
        Async("window.focus", _ => Host.OnUi(() => { Host.Form.BringToFront(true); return (object?)true; }));
        Async("window.flash", _ => Host.OnUi(() => { Host.Form.Flash(); return (object?)true; }));
        Sync("window.close", _ => { Host.Form.BeginInvoke(new Action(Host.Form.Close)); return true; });

        // clipboard (STA, so on the UI thread)
        Async("clipboard.readText", _ => Host.OnUi(() => (object?)(Clipboard.ContainsText() ? Clipboard.GetText() : "")));
        Async("clipboard.writeText", a => Host.OnUi(() => { var t = a.OptStr(0) ?? ""; if (t.Length == 0) Clipboard.Clear(); else Clipboard.SetText(t); return (object?)true; }));
        Async("clipboard.readImage", _ => Host.OnUi(() =>
        {
            if (!Clipboard.ContainsImage()) return (object?)null;
            using var img = Clipboard.GetImage()!;
            using var ms = new MemoryStream();
            img.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }));
        Async("clipboard.writeImage", a => Host.OnUi(() =>
        {
            using var ms = new MemoryStream(Convert.FromBase64String(a.Str(0)));
            using var img = Image.FromStream(ms);
            Clipboard.SetImage(img);
            return (object?)true;
        }));

        // dialogs (modal, so no timeout)
        Async("dialog.openFile", a => Host.OnUi(() => Dialogs.OpenFile(a.Obj(0)), 0));
        Async("dialog.saveFile", a => Host.OnUi(() => Dialogs.SaveFile(a.Obj(0)), 0));
        Async("dialog.pickFolder", a => Host.OnUi(() => Dialogs.PickFolder(a.Obj(0)), 0));
        Async("dialog.message", a => Host.OnUi(() => Dialogs.Message(a.OptStr(0) ?? "", a.Obj(1)), 0));

        Async("notify", a => Host.OnUi(() => { Host.Form.Notify(a.OptStr(0) ?? "Game", a.OptStr(1) ?? ""); return (object?)true; }));
        Sync("shell.open", a => { ShellOpen(a.Str(0)); return true; });

        // storage (api.storage)
        Sync("storage.get", a => Host.Storage.Get(a.Str(0)));
        Sync("storage.set", a => { Host.Storage.Set(a.Str(0), a.At(1) is { } v ? JsonNode.Parse(v.GetRawText()) : null); return true; });
        Sync("storage.delete", a => Host.Storage.Delete(a.Str(0)));
        Sync("storage.list", _ => Host.Storage.Keys());

        // used by the loader
        Sync("modules.list", _ => Host.Modules.Names().Select(Host.Modules.Info).ToArray());
        Sync("modules.info", a => Host.Modules.Info(a.Str(0)));

        // git status / pull + hot reload when Modules/Shell/Assets change; native changes still need a restart
        Async("app.update", async _ => await AppUpdate.RunAsync());
        Async("app.update.check", async _ => await AppUpdate.CheckAsync());
    }

    void Sync(string name, Func<BridgeArgs, object?> fn) => _handlers[name] = a => Task.FromResult(fn(a));
    void Async(string name, Func<BridgeArgs, Task<object?>> fn) => _handlers[name] = a => fn(a);

    public void OnMessage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var typeEl)) return;
        string? Str(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        switch (typeEl.GetString())
        {
            case "call":
                var id = root.GetProperty("id").GetInt64();
                var method = Str("method") ?? "";
                var args = root.TryGetProperty("args", out var a) ? a.Clone() : default;
                _ = Task.Run(() => Invoke(id, method, args));
                break;
            case "console":
                Host.Console.Add(Str("level") ?? "log", Str("text") ?? "", Str("source"));
                break;
            case "module.status":
                Host.Modules.SetStatus(Str("name") ?? "", Str("status") ?? "unknown", Str("error"));
                break;
            case "module.error":
                Host.Modules.SetRuntimeError(Str("name") ?? "", Str("error") ?? "");
                break;
            case "ready":
                Host.Form.OnPageReady();
                break;
        }
    }

    async Task Invoke(long id, string method, JsonElement args)
    {
        try
        {
            if (!_handlers.TryGetValue(method, out var handler))
                throw new ArgumentException($"Unknown host method '{method}'. Call api.host.call('host.methods') for the list.");
            var value = await handler(new BridgeArgs(args));
            Host.Post(new { type = "result", id, ok = true, value });
        }
        catch (Exception ex)
        {
            var inner = ex is TargetInvocationException { InnerException: { } ie } ? ie : ex;
            Host.Post(new { type = "result", id, ok = false, error = inner.Message });
        }
    }

    /// <summary>Opens a URL or file in its default app, outside the Job Object so it outlives this program.</summary>
    public static void ShellOpen(string target)
    {
        if (string.IsNullOrWhiteSpace(target) || target.Contains('"')) throw new ArgumentException("Invalid target.");
        var isUrl = Uri.TryCreate(target, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "mailto";
        var resolved = isUrl ? target : Paths.Resolve(target);
        var explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        JobObject.StartDetached($"\"{explorer}\" \"{resolved}\"");
    }

    static (IReadOnlyList<string>? List, string? Str) ArgsOf(JsonElement? e) => e switch
    {
        { ValueKind: JsonValueKind.Array } arr => (arr.EnumerateArray().Select(x => x.ToString()).ToList(), null),
        { ValueKind: JsonValueKind.String } s => (null, s.GetString()),
        _ => (null, null),
    };

    static void EnsureDir(string file)
    {
        var dir = Path.GetDirectoryName(file);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    }

    static object Stat(string p)
    {
        if (File.Exists(p))
        {
            var f = new FileInfo(p);
            return new { path = f.FullName, exists = true, isDir = false, size = f.Length, created = f.CreationTime, modified = f.LastWriteTime };
        }
        if (Directory.Exists(p))
        {
            var d = new DirectoryInfo(p);
            return new { path = d.FullName, exists = true, isDir = true, size = 0L, created = d.CreationTime, modified = d.LastWriteTime };
        }
        return new { path = p, exists = false };
    }

    static object[] ListDir(string dir, string pattern, bool recursive)
    {
        var di = new DirectoryInfo(dir);
        if (!di.Exists) throw new DirectoryNotFoundException(dir);
        return di.EnumerateFileSystemInfos(pattern, new EnumerationOptions { RecurseSubdirectories = recursive, IgnoreInaccessible = true })
            .Select(i => (object)new
            {
                name = i.Name,
                path = i.FullName,
                isDir = i is DirectoryInfo,
                size = i is FileInfo f ? f.Length : 0,
                modified = i.LastWriteTime,
            })
            .ToArray();
    }

    static void CopyDir(string src, string dst, bool overwrite)
    {
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.EnumerateFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), overwrite);
        foreach (var d in Directory.EnumerateDirectories(src)) CopyDir(d, Path.Combine(dst, Path.GetFileName(d)), overwrite);
    }
}

static class Dialogs
{
    public static object? OpenFile(JsonElement? o)
    {
        using var dlg = new OpenFileDialog
        {
            Title = BridgeArgs.Prop(o, "title") ?? "Open",
            Filter = BridgeArgs.Prop(o, "filter") ?? "All files (*.*)|*.*",
            Multiselect = BridgeArgs.PropBool(o, "multiple") ?? false,
            InitialDirectory = BridgeArgs.Prop(o, "initialDir") is { } d ? Paths.Resolve(d) : "",
        };
        if (dlg.ShowDialog(Host.Form) != DialogResult.OK) return null;
        return dlg.Multiselect ? dlg.FileNames : dlg.FileName;
    }

    public static object? SaveFile(JsonElement? o)
    {
        using var dlg = new SaveFileDialog
        {
            Title = BridgeArgs.Prop(o, "title") ?? "Save",
            Filter = BridgeArgs.Prop(o, "filter") ?? "All files (*.*)|*.*",
            FileName = BridgeArgs.Prop(o, "defaultName") ?? "",
            InitialDirectory = BridgeArgs.Prop(o, "initialDir") is { } d ? Paths.Resolve(d) : "",
        };
        return dlg.ShowDialog(Host.Form) == DialogResult.OK ? dlg.FileName : null;
    }

    public static object? PickFolder(JsonElement? o)
    {
        using var dlg = new FolderBrowserDialog
        {
            Description = BridgeArgs.Prop(o, "title") ?? "Choose a folder",
            UseDescriptionForTitle = true,
            InitialDirectory = BridgeArgs.Prop(o, "initialDir") is { } d ? Paths.Resolve(d) : "",
        };
        return dlg.ShowDialog(Host.Form) == DialogResult.OK ? dlg.SelectedPath : null;
    }

    public static object? Message(string text, JsonElement? o)
    {
        var buttons = (BridgeArgs.Prop(o, "buttons") ?? "ok").ToLowerInvariant() switch
        {
            "okcancel" => MessageBoxButtons.OKCancel,
            "yesno" => MessageBoxButtons.YesNo,
            "yesnocancel" => MessageBoxButtons.YesNoCancel,
            "retrycancel" => MessageBoxButtons.RetryCancel,
            _ => MessageBoxButtons.OK,
        };
        var icon = (BridgeArgs.Prop(o, "icon") ?? "none").ToLowerInvariant() switch
        {
            "info" => MessageBoxIcon.Information,
            "warning" => MessageBoxIcon.Warning,
            "error" => MessageBoxIcon.Error,
            "question" => MessageBoxIcon.Question,
            _ => MessageBoxIcon.None,
        };
        return MessageBox.Show(Host.Form, text, BridgeArgs.Prop(o, "title") ?? Host.Form.Text, buttons, icon).ToString().ToLowerInvariant();
    }
}
