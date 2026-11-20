namespace GameWindow;

/// <summary>Files under Assets/ (images, data, downloaded libraries), served at https://app.local/Assets/.</summary>
sealed class AssetStore : IDisposable
{
    readonly FileSystemWatcher _watcher;
    readonly SharePoll _poll;
    readonly Debouncer _debounce = new(150);

    public AssetStore()
    {
        _watcher = new FileSystemWatcher(Paths.Assets)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler h = (_, e) => Changed(e.FullPath);
        _watcher.Changed += h;
        _watcher.Created += h;
        _watcher.Deleted += h;
        _watcher.Renamed += (_, e) => { Changed(e.OldFullPath); Changed(e.FullPath); };
        _watcher.EnableRaisingEvents = true;
        _poll = new SharePoll(Paths.Assets, true, Changed);
    }

    void Changed(string full)
    {
        var rel = Paths.Relative(Paths.Assets, full);
        _debounce.Run(rel.ToLowerInvariant(), () => Host.Post(new { type = "asset.changed", path = rel }));
    }

    public string Full(string relative) => Paths.Under(Paths.Assets, relative);

    public object[] List(string? sub)
    {
        var dir = sub == null ? Paths.Assets : Full(sub);
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .Select(f => new FileInfo(f))
            .Select(f => (object)new
            {
                path = Paths.Relative(Paths.Assets, f.FullName),
                url = "/Assets/" + Paths.Relative(Paths.Assets, f.FullName),
                size = f.Length,
                modified = f.LastWriteTime,
            })
            .ToArray();
    }

    public object Read(string relative, bool base64)
    {
        var full = Full(relative);
        if (!File.Exists(full)) throw new FileNotFoundException($"Asset '{relative}' does not exist.");
        return base64
            ? new { path = relative, base64 = Convert.ToBase64String(File.ReadAllBytes(full)) }
            : new { path = relative, text = File.ReadAllText(full) };
    }

    public string Write(string relative, string? text, string? base64)
    {
        if (text == null && base64 == null) throw new ArgumentException("Provide text or base64.");
        var full = Full(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        if (base64 != null) File.WriteAllBytes(full, Convert.FromBase64String(base64));
        else File.WriteAllText(full, text);
        return "/Assets/" + Paths.Relative(Paths.Assets, full);
    }

    public bool Delete(string relative)
    {
        var full = Full(relative);
        if (full.Equals(Paths.Assets, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Refusing to delete the Assets folder.");
        if (File.Exists(full)) { File.Delete(full); return true; }
        if (Directory.Exists(full)) { Directory.Delete(full, true); return true; }
        return false;
    }

    public async Task<object> AddLibrary(string url, string? relative)
    {
        var uri = new Uri(url);
        var rel = relative ?? "lib/" + Path.GetFileName(uri.AbsolutePath);
        if (rel.EndsWith('/')) rel += Path.GetFileName(uri.AbsolutePath);
        if (Path.GetFileName(rel).Length == 0) throw new ArgumentException("Could not derive a file name from the URL; pass path.");
        var bytes = await HttpBridge.Client.GetByteArrayAsync(uri);
        var full = Full(rel);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, bytes);
        var importUrl = "/Assets/" + Paths.Relative(Paths.Assets, full);
        return new { saved = importUrl, bytes = bytes.Length, usage = $"import x from '{importUrl}';  (or <link>/<script> with that URL)" };
    }

    public void Dispose()
    {
        _poll.Dispose();
        _watcher.Dispose();
        _debounce.Dispose();
    }
}

static class ShellFiles
{
    public static readonly string[] Files = ["index.html", "loader.js"];

    public static void EnsureDefaults(bool overwrite = false)
    {
        foreach (var file in Files)
        {
            var dest = Path.Combine(Paths.Shell, file);
            if (!overwrite && File.Exists(dest)) continue;
            using var src = typeof(ShellFiles).Assembly.GetManifestResourceStream("DefaultShell/" + file)
                ?? throw new InvalidOperationException($"Embedded shell file {file} is missing.");
            using var dst = File.Create(dest);
            src.CopyTo(dst);
        }
    }
}
