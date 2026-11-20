using Microsoft.Extensions.Logging;

namespace GameWindow;

static class Log
{
    const long MaxBytes = 1_000_000;
    const int KeepFiles = 5;
    static readonly object Gate = new();
    static readonly Queue<string> Recent = new();

    static string FilePath => Path.Combine(Paths.Logs, "host.log");

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);
    public static void Error(string message, Exception? ex = null) =>
        Write("ERROR", ex == null ? message : $"{message}: {ex}");

    static void Write(string level, string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}";
        lock (Gate)
        {
            Recent.Enqueue(line);
            while (Recent.Count > 2000) Recent.Dequeue();
            try
            {
                Roll();
                File.AppendAllText(FilePath, line + Environment.NewLine);
            }
            catch { }
        }
    }

    static void Roll()
    {
        var info = new FileInfo(FilePath);
        if (!info.Exists || info.Length < MaxBytes) return;
        for (int i = KeepFiles - 2; i >= 1; i--)
        {
            var src = $"{FilePath}.{i}";
            if (File.Exists(src)) File.Move(src, $"{FilePath}.{i + 1}", true);
        }
        File.Move(FilePath, FilePath + ".1", true);
    }

    public static string[] Tail(int count)
    {
        lock (Gate) return Recent.TakeLast(Math.Max(1, count)).ToArray();
    }
}

sealed class HostLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Logger(categoryName);
    public void Dispose() { }

    sealed class Logger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => level >= LogLevel.Warning;

        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? ex, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(level)) return;
            global::GameWindow.Log.Warn($"[{category}] {formatter(state, ex)}{(ex != null ? " " + ex.Message : "")}");
        }
    }
}
