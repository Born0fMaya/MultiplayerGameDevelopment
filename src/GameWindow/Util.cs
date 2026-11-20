namespace GameWindow;

static class FileUtil
{
    static readonly object WriteGate = new();

    public static void AtomicWrite(string path, string text)
    {
        lock (WriteGate)
        {
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, text);
            File.Move(tmp, path, true);
        }
    }
}

/// <summary>Collapses bursts of calls with the same key into one call after a quiet period.</summary>
sealed class Debouncer(int delayMs) : IDisposable
{
    readonly Dictionary<string, System.Threading.Timer> _timers = new();
    readonly object _gate = new();
    bool _disposed;

    public void Run(string key, Action action)
    {
        lock (_gate)
        {
            if (_disposed) return;
            if (_timers.TryGetValue(key, out var existing))
            {
                existing.Change(delayMs, Timeout.Infinite);
                return;
            }
            System.Threading.Timer? timer = null;
            timer = new System.Threading.Timer(_ =>
            {
                lock (_gate) _timers.Remove(key);
                timer?.Dispose();
                try { action(); }
                catch (Exception ex) { Log.Error($"Debounced action '{key}' failed", ex); }
            }, null, delayMs, Timeout.Infinite);
            _timers[key] = timer;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            foreach (var t in _timers.Values) t.Dispose();
            _timers.Clear();
        }
    }
}
