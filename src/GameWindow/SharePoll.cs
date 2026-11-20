namespace GameWindow;

/// <summary>
/// A folder watch on a network share often never hears edits made by the
/// computer that owns the files. Shared sessions poll those folders too.
/// </summary>
sealed class SharePoll : IDisposable
{
    readonly string _root;
    readonly bool _recursive;
    readonly Action<string> _changed;
    readonly Dictionary<string, (long Ticks, long Length)> _sig = new(StringComparer.OrdinalIgnoreCase);
    System.Threading.Timer? _timer;

    public SharePoll(string root, bool recursive, Action<string> changed)
    {
        _root = root;
        _recursive = recursive;
        _changed = changed;
        if (!Paths.SharedRoot) return;
        Snapshot(notify: false);
        _timer = new System.Threading.Timer(_ => Snapshot(notify: true), null, 300, 300);
    }

    void Snapshot(bool notify)
    {
        if (!Directory.Exists(_root)) return;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IEnumerable<string> files;
        try
        {
            files = Directory.EnumerateFiles(_root, "*", _recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly);
        }
        catch { return; }

        foreach (var file in files)
        {
            if (file.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue;
            if (file.Contains($"{Path.DirectorySeparatorChar}.history{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)) continue;
            FileInfo info;
            try { info = new FileInfo(file); }
            catch { continue; }
            var sig = (info.LastWriteTimeUtc.Ticks, info.Length);
            seen.Add(file);
            if (!notify)
            {
                _sig[file] = sig;
                continue;
            }
            if (_sig.TryGetValue(file, out var old) && old == sig) continue;
            _sig[file] = sig;
            try { _changed(file); } catch (Exception ex) { Log.Warn("Shared file change failed: " + ex.Message); }
        }

        if (!notify) return;
        foreach (var old in _sig.Keys.Where(path => !seen.Contains(path)).ToArray())
        {
            _sig.Remove(old);
            try { _changed(old); } catch (Exception ex) { Log.Warn("Shared file change failed: " + ex.Message); }
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _timer = null;
    }
}
