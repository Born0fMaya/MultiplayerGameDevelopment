namespace GameWindow;

static class Paths
{
    public static string Root { get; private set; } = "";

    public static string Modules => Path.Combine(Root, "Modules");
    public static string History => Path.Combine(Modules, ".history");
    public static string Assets => Path.Combine(Root, "Assets");
    public static string Lib => Path.Combine(Assets, "lib");
    public static string Storage => Path.Combine(Root, "Storage");
    public static string WebView2Data { get; private set; } = "";
    public static string Logs => Path.Combine(Root, "Logs");
    public static string Shell => Path.Combine(Root, "Shell");
    public static string StorageFile => Path.Combine(Storage, "storage.json");
    public static string StateFile { get; private set; } = "";

    /// <summary>The program folder is a network share, so this PC is a guest of the machine that owns the files.</summary>
    public static bool SharedRoot { get; private set; }

    public static void Init(string[] args)
    {
        string? root = null;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--root") root = args[i + 1];
        root ??= Environment.GetEnvironmentVariable("GAMEWINDOW_ROOT");
        root ??= AppContext.BaseDirectory;
        Root = Path.GetFullPath(root).TrimEnd('\\', '/');
        SharedRoot = IsNetwork(Root);

        // WebView2 refuses a profile folder on a network share (the window stays black,
        // or the second PC loses with "resource in use"). The profile is a browser cache.
        // The program, modules, and projects stay in the shared folder.
        var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GameWindow");
        WebView2Data = SharedRoot ? Path.Combine(local, "WebView2") : Path.Combine(Storage, "WebView2");
        // Window placement is per screen. A guest writes its own state file on the host, not on its disk.
        var machine = string.Join("_", Environment.MachineName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
        StateFile = SharedRoot ? Path.Combine(Storage, "state-" + machine + ".json") : Path.Combine(Storage, "state.json");

        foreach (var dir in new[] { Modules, History, Assets, Lib, Storage, WebView2Data, Logs, Shell })
            Directory.CreateDirectory(dir);
        try { File.SetAttributes(History, File.GetAttributes(History) | FileAttributes.Hidden); } catch { }
    }

    static bool IsNetwork(string path)
    {
        if (path.StartsWith(@"\\", StringComparison.Ordinal)) return true;
        try
        {
            var root = Path.GetPathRoot(path);
            if (string.IsNullOrEmpty(root)) return false;
            return new DriveInfo(root).DriveType == DriveType.Network;
        }
        catch { return false; }
    }

    /// <summary>Absolute paths are used as-is; relative paths resolve against the program folder.</summary>
    public static string Resolve(string path) =>
        Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(Root, path));

    /// <summary>Resolves <paramref name="relative"/> inside <paramref name="baseDir"/> and refuses to escape it.</summary>
    public static string Under(string baseDir, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(baseDir, relative.Replace('/', '\\').TrimStart('\\')));
        if (!full.Equals(baseDir, StringComparison.OrdinalIgnoreCase) &&
            !full.StartsWith(baseDir + "\\", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"Path '{relative}' is outside {baseDir}");
        return full;
    }

    public static string Relative(string baseDir, string full) =>
        Path.GetRelativePath(baseDir, full).Replace('\\', '/');
}
