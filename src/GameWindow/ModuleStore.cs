using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace GameWindow;

/// <summary>Feature modules on disk (Modules/name.js + optional name.css), with version history and hot reload.</summary>
sealed partial class ModuleStore : IDisposable
{
    public const int HistoryLimit = 20;

    public sealed record ModuleStatus(string Status, string? Error, string? RuntimeError, DateTime Time);

    readonly ConcurrentDictionary<string, ModuleStatus> _status = new(StringComparer.OrdinalIgnoreCase);
    readonly FileSystemWatcher _watcher;
    readonly SharePoll _poll;
    readonly Debouncer _debounce = new(150);

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]
    private static partial Regex NameRx();

    public ModuleStore()
    {
        _watcher = new FileSystemWatcher(Paths.Modules)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        _watcher.Changed += (_, e) => OnFileEvent(e.FullPath);
        _watcher.Created += (_, e) => OnFileEvent(e.FullPath);
        _watcher.Deleted += (_, e) => OnFileEvent(e.FullPath);
        _watcher.Renamed += (_, e) => { OnFileEvent(e.OldFullPath); OnFileEvent(e.FullPath); };
        _watcher.Error += (_, e) => Log.Error("Modules watcher error", e.GetException());
        _watcher.EnableRaisingEvents = true;
        _poll = new SharePoll(Paths.Modules, false, OnFileEvent);
    }

    public static string Check(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || !NameRx().IsMatch(name))
            throw new ArgumentException("Module names must be 1-64 characters of letters, digits, '_' or '-', starting with a letter or digit.");
        return name;
    }

    public static bool IsValidName(string? name) => name != null && NameRx().IsMatch(name);

    public string JsPath(string name) => Path.Combine(Paths.Modules, name + ".js");
    public string CssPath(string name) => Path.Combine(Paths.Modules, name + ".css");
    string HistoryDir(string name) => Path.Combine(Paths.History, name);

    public bool Exists(string name) => File.Exists(JsPath(Check(name)));

    public string[] Names() => Directory.EnumerateFiles(Paths.Modules, "*.js")
        .Select(Path.GetFileNameWithoutExtension)
        .Where(IsValidName)
        .Select(n => n!)
        .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    public object Info(string name)
    {
        Check(name);
        return new
        {
            name,
            exists = File.Exists(JsPath(name)),
            enabled = !Host.State.IsDisabled(name),
            hasCss = File.Exists(CssPath(name)),
        };
    }

    public object[] List() => Names().Select(n =>
    {
        var js = new FileInfo(JsPath(n));
        _status.TryGetValue(n, out var st);
        return (object)new
        {
            name = n,
            enabled = !Host.State.IsDisabled(n),
            hasCss = File.Exists(CssPath(n)),
            size = js.Length,
            modified = js.LastWriteTime,
            status = st?.Status ?? "unknown",
            error = st?.Error,
            runtimeError = st?.RuntimeError,
        };
    }).ToArray();

    public (string Js, string? Css) Read(string name)
    {
        Check(name);
        if (!File.Exists(JsPath(name))) throw new FileNotFoundException($"Module '{name}' does not exist.");
        var css = File.Exists(CssPath(name)) ? File.ReadAllText(CssPath(name)) : null;
        return (File.ReadAllText(JsPath(name)), css);
    }

    /// <summary>css: null keeps the existing stylesheet, empty string removes it.</summary>
    public void Write(string name, string js, string? css)
    {
        Check(name);
        Snapshot(name);
        if (css != null)
        {
            if (css.Length == 0) File.Delete(CssPath(name));
            else File.WriteAllText(CssPath(name), css);
        }
        File.WriteAllText(JsPath(name), js);
    }

    public int Patch(string name, string find, string replace, string file, bool replaceAll)
    {
        Check(name);
        if (string.IsNullOrEmpty(find)) throw new ArgumentException("find must not be empty.");
        var path = file.Equals("css", StringComparison.OrdinalIgnoreCase) ? CssPath(name) : JsPath(name);
        if (!File.Exists(path)) throw new FileNotFoundException($"{Path.GetFileName(path)} does not exist.");
        var text = File.ReadAllText(path);
        int count = 0, idx = 0;
        while ((idx = text.IndexOf(find, idx, StringComparison.Ordinal)) >= 0) { count++; idx += find.Length; }
        if (count == 0) throw new ArgumentException("find text was not found.");
        if (count > 1 && !replaceAll)
            throw new ArgumentException($"find text occurs {count} times; add more context or set replaceAll.");
        Snapshot(name);
        File.WriteAllText(path, text.Replace(find, replace, StringComparison.Ordinal));
        return count;
    }

    public void Rename(string from, string to)
    {
        Check(from); Check(to);
        if (!File.Exists(JsPath(from))) throw new FileNotFoundException($"Module '{from}' does not exist.");
        if (File.Exists(JsPath(to))) throw new IOException($"Module '{to}' already exists.");
        var wasDisabled = Host.State.IsDisabled(from);
        if (File.Exists(CssPath(from))) File.Move(CssPath(from), CssPath(to));
        File.Move(JsPath(from), JsPath(to));
        if (Directory.Exists(HistoryDir(from)) && !Directory.Exists(HistoryDir(to)))
            Directory.Move(HistoryDir(from), HistoryDir(to));
        if (wasDisabled)
        {
            Host.State.SetDisabled(from, false);
            Host.State.SetDisabled(to, true);
        }
        _status.TryRemove(from, out _);
    }

    public void Delete(string name)
    {
        Check(name);
        if (!File.Exists(JsPath(name)) && !File.Exists(CssPath(name)))
            throw new FileNotFoundException($"Module '{name}' does not exist.");
        Snapshot(name);
        File.Delete(CssPath(name));
        File.Delete(JsPath(name));
        _status.TryRemove(name, out _);
    }

    void Snapshot(string name)
    {
        bool hasJs = File.Exists(JsPath(name)), hasCss = File.Exists(CssPath(name));
        if (!hasJs && !hasCss) return;
        var dir = HistoryDir(name);
        Directory.CreateDirectory(dir);
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
        if (hasJs) File.Copy(JsPath(name), Path.Combine(dir, stamp + ".js"), true);
        if (hasCss) File.Copy(CssPath(name), Path.Combine(dir, stamp + ".css"), true);
        if (!hasJs) File.WriteAllText(Path.Combine(dir, stamp + ".nojs"), "");
        foreach (var old in Versions(name).Skip(HistoryLimit))
            foreach (var f in Directory.EnumerateFiles(dir, old + ".*")) File.Delete(f);
    }

    public string[] Versions(string name)
    {
        var dir = HistoryDir(Check(name));
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateFiles(dir)
            .Select(Path.GetFileNameWithoutExtension)
            .Select(n => n!)
            .Distinct()
            .OrderByDescending(n => n, StringComparer.Ordinal)
            .ToArray();
    }

    /// <summary>Restores a saved version (default: the most recent one). The current files are saved first.</summary>
    public string Revert(string name, string? version)
    {
        var versions = Versions(name);
        if (versions.Length == 0) throw new InvalidOperationException($"Module '{name}' has no history.");
        var v = version ?? versions[0];
        if (!versions.Contains(v)) throw new ArgumentException($"Unknown version '{v}'. Use module_history to list versions.");
        var dir = HistoryDir(name);
        string js = Path.Combine(dir, v + ".js"), css = Path.Combine(dir, v + ".css");
        Snapshot(name);
        if (File.Exists(css)) File.Copy(css, CssPath(name), true); else File.Delete(CssPath(name));
        if (File.Exists(js)) File.Copy(js, JsPath(name), true); else File.Delete(JsPath(name));
        return v;
    }

    public void SetStatus(string name, string status, string? error)
    {
        if (!IsValidName(name)) return;
        _status[name] = new ModuleStatus(status, error, null, DateTime.UtcNow);
    }

    public void SetRuntimeError(string name, string error)
    {
        if (!IsValidName(name)) return;
        _status.AddOrUpdate(name,
            _ => new ModuleStatus("running", null, error, DateTime.UtcNow),
            (_, old) => old with { RuntimeError = error });
    }

    public ModuleStatus? GetStatus(string name) => _status.TryGetValue(name, out var s) ? s : null;

    public IEnumerable<(string Name, ModuleStatus Status)> Problems() =>
        _status.Where(kv => kv.Value.Status == "errored" || kv.Value.RuntimeError != null)
            .Select(kv => (kv.Key, kv.Value));

    /// <summary>Waits for the page to report on a module after <paramref name="afterUtc"/>.</summary>
    public async Task<ModuleStatus?> WaitForStatus(string name, DateTime afterUtc, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (_status.TryGetValue(name, out var s) && s.Time > afterUtc) return s;
            await Task.Delay(50);
        }
        return null;
    }

    /// <summary>Asks the page to reload one module now (used where no file changes, e.g. enable/disable).</summary>
    public void NotifyChanged(string name) => Host.Post(new { type = "module.changed", name });

    void OnFileEvent(string path)
    {
        var ext = Path.GetExtension(path);
        if (!ext.Equals(".js", StringComparison.OrdinalIgnoreCase) && !ext.Equals(".css", StringComparison.OrdinalIgnoreCase)) return;
        var name = Path.GetFileNameWithoutExtension(path);
        if (!IsValidName(name)) return;
        _debounce.Run(name.ToLowerInvariant(), () => NotifyChanged(name));
    }

    public void Dispose()
    {
        _poll.Dispose();
        _watcher.Dispose();
        _debounce.Dispose();
    }
}
