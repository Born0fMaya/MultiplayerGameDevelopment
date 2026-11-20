using System.Text.Json;
using System.Text.Json.Nodes;

namespace GameWindow;

/// <summary>Persistent key/value store backing api.storage and the storage_* tools (Storage/storage.json).</summary>
sealed class KeyValueStore
{
    readonly string _file;
    readonly object _gate = new();
    readonly Dictionary<string, JsonNode?> _data = new();
    readonly System.Threading.Timer _saveTimer;

    public KeyValueStore(string file)
    {
        _file = file;
        _saveTimer = new System.Threading.Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
        if (!File.Exists(file)) return;
        try
        {
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject obj)
                foreach (var (k, v) in obj) _data[k] = v?.DeepClone();
        }
        catch (Exception ex)
        {
            Log.Error($"Could not read {file}; keeping a copy as .corrupt", ex);
            try { File.Copy(file, file + ".corrupt", true); } catch { }
        }
    }

    public JsonNode? Get(string key)
    {
        lock (_gate) return _data.TryGetValue(key, out var v) ? v?.DeepClone() : null;
    }

    public bool Has(string key)
    {
        lock (_gate) return _data.ContainsKey(key);
    }

    public void Set(string key, JsonNode? value)
    {
        lock (_gate) _data[key] = value?.DeepClone();
        _saveTimer.Change(300, Timeout.Infinite);
    }

    public bool Delete(string key)
    {
        bool removed;
        lock (_gate) removed = _data.Remove(key);
        if (removed) _saveTimer.Change(300, Timeout.Infinite);
        return removed;
    }

    public string[] Keys()
    {
        lock (_gate) return _data.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();
    }

    public void Flush()
    {
        try
        {
            var obj = new JsonObject();
            lock (_gate)
                foreach (var (k, v) in _data) obj[k] = v?.DeepClone();
            FileUtil.AtomicWrite(_file, obj.ToJsonString(Host.JsonIndented));
        }
        catch (Exception ex) { Log.Error("Saving storage failed", ex); }
    }
}

sealed class WindowBounds
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
}

sealed class AppState
{
    public WindowBounds? Bounds { get; set; }
    public bool Maximized { get; set; }
    public string? Title { get; set; }
    public bool Topmost { get; set; }
    public double Opacity { get; set; } = 1;
    public List<string> Disabled { get; set; } = new();
}

/// <summary>Window and module state that survives restarts (Storage/state.json).</summary>
sealed class StateStore
{
    readonly string _file;
    readonly object _gate = new();
    public AppState Value { get; }

    public StateStore(string file)
    {
        _file = file;
        Value = new AppState();
        if (!File.Exists(file)) return;
        try { Value = JsonSerializer.Deserialize<AppState>(File.ReadAllText(file), Host.Json) ?? new AppState(); }
        catch (Exception ex) { Log.Error($"Could not read {file}", ex); }
    }

    public bool IsDisabled(string module)
    {
        lock (_gate) return Value.Disabled.Contains(module, StringComparer.OrdinalIgnoreCase);
    }

    public void SetDisabled(string module, bool disabled)
    {
        lock (_gate)
        {
            Value.Disabled.RemoveAll(m => m.Equals(module, StringComparison.OrdinalIgnoreCase));
            if (disabled) Value.Disabled.Add(module);
        }
        Save();
    }

    public void Update(Action<AppState> change)
    {
        lock (_gate) change(Value);
        Save();
    }

    public void Save()
    {
        try
        {
            string json;
            lock (_gate) json = JsonSerializer.Serialize(Value, Host.JsonIndented);
            FileUtil.AtomicWrite(_file, json);
        }
        catch (Exception ex) { Log.Error("Saving state failed", ex); }
    }
}

/// <summary>Ring buffer of page console output and errors.</summary>
sealed class ConsoleBuffer
{
    public sealed record Entry(long Seq, DateTime Time, string Level, string Text, string? Source);

    readonly object _gate = new();
    readonly LinkedList<Entry> _entries = new();
    long _seq;

    public void Add(string level, string text, string? source)
    {
        lock (_gate)
        {
            _entries.AddLast(new Entry(++_seq, DateTime.Now, level, text, source));
            while (_entries.Count > 2000) _entries.RemoveFirst();
        }
    }

    public (long Next, Entry[] Entries) Since(long since, string? level, int max)
    {
        lock (_gate)
        {
            var list = _entries.Where(e => e.Seq > since && (level == null || e.Level == level)).TakeLast(max).ToArray();
            return (_seq, list);
        }
    }

    public Entry[] Errors(int max)
    {
        lock (_gate) return _entries.Where(e => e.Level == "error").TakeLast(max).ToArray();
    }

    public int ErrorCount
    {
        get { lock (_gate) return _entries.Count(e => e.Level == "error"); }
    }

    public void Clear()
    {
        lock (_gate) _entries.Clear();
    }
}
