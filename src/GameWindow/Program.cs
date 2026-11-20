using System.Runtime.InteropServices;

namespace GameWindow;

static class Program
{
    public const int Port = 5281;
    public static Mutex? SingleInstance;

    [STAThread]
    static void Main(string[] args)
    {
        Paths.Init(args);

        SingleInstance = new Mutex(true, @"Local\GameWindow.SingleInstance", out bool created);
        if (!created)
        {
            FocusExisting();
            return;
        }

        Log.Info($"GameWindow {Host.Version} starting (pid {Environment.ProcessId}, root {Paths.Root}, shared {Paths.SharedRoot})");
        JobObject.AssignSelf();

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Error("Unhandled UI thread exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Fatal unhandled exception", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("Unobserved task exception", e.Exception);
            e.SetObserved();
        };

        ApplicationConfiguration.Initialize();
        ShellFiles.EnsureDefaults();
        Host.Init();

        var form = new MainForm();
        Host.Form = form;
        McpHost.Start();
        Application.Run(form);
    }

    static void FocusExisting()
    {
        try
        {
            AllowSetForegroundWindow(-1);
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            client.GetAsync($"http://127.0.0.1:{Port}/focus").GetAwaiter().GetResult();
        }
        catch { }
    }

    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);
}
