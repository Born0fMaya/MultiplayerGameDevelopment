using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GameWindow;

sealed class WindowChange
{
    public string? Title { get; set; }
    public int? X { get; set; }
    public int? Y { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? State { get; set; }
    public bool? Topmost { get; set; }
    public double? Opacity { get; set; }
    public bool? Fullscreen { get; set; }

    public static WindowChange From(JsonElement? o)
    {
        var b = o is { ValueKind: JsonValueKind.Object } obj && obj.TryGetProperty("bounds", out var inner) ? inner : o;
        return new WindowChange
        {
            Title = BridgeArgs.Prop(o, "title"),
            X = (int?)BridgeArgs.PropNum(b, "x"),
            Y = (int?)BridgeArgs.PropNum(b, "y"),
            Width = (int?)BridgeArgs.PropNum(b, "width"),
            Height = (int?)BridgeArgs.PropNum(b, "height"),
            State = BridgeArgs.Prop(o, "state"),
            Topmost = BridgeArgs.PropBool(o, "topmost"),
            Opacity = BridgeArgs.PropNum(o, "opacity"),
            Fullscreen = BridgeArgs.PropBool(o, "fullscreen"),
        };
    }
}

sealed class MainForm : Form
{
    public const string ShellUrl = "https://app.local/Shell/index.html";
    static readonly Color Background = Color.FromArgb(17, 17, 20);

    WebView2? _web;
    CoreWebView2Environment? _env;
    readonly System.Windows.Forms.Timer _watchdog = new() { Interval = 3000 };
    readonly System.Windows.Forms.Timer _boundsSaver = new() { Interval = 1000 };
    FileSystemWatcher? _shellWatcher;
    SharePoll? _shellPoll;
    readonly Debouncer _shellDebounce = new(300);
    Label? _startupError;
    readonly List<NotifyIcon> _notifyIcons = new();
    bool _pinging, _shuttingDown, _shutdownComplete;
    bool _fullscreen;
    FormBorderStyle _prevBorder;
    FormWindowState _prevState;
    Rectangle _prevBounds;

    public bool PageResponsive { get; private set; } = true;
    public bool PageReady { get; private set; }
    public DateTime? LastPing { get; private set; }
    public string? BrowserVersion { get; private set; }
    public string? WebViewError { get; private set; }
    public int WebViewRecreations { get; private set; }

    public MainForm()
    {
        AutoScaleMode = AutoScaleMode.None;
        Text = Host.State.Value.Title ?? "Game";
        BackColor = Background;
        MinimumSize = new Size(240, 160);
        StartPosition = FormStartPosition.Manual;
        TopMost = Host.State.Value.Topmost;
        Opacity = Math.Clamp(Host.State.Value.Opacity, 0.1, 1);

        _watchdog.Tick += (_, _) => Ping();
        _boundsSaver.Tick += (_, _) => { _boundsSaver.Stop(); SaveWindowState(); };
        ResizeEnd += (_, _) => _boundsSaver.Start();
        SizeChanged += (_, _) => { if (IsHandleCreated) _boundsSaver.Start(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int on = 1;
        DwmSetWindowAttribute(Handle, 20, ref on, sizeof(int));
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        RestoreSavedBounds();
        StartShellWatcher();
        _watchdog.Start();
        await CreateWebView();
    }

    // ---------------------------------------------------------------- WebView lifecycle

    async Task CreateWebView()
    {
        if (_shuttingDown) return;
        PageReady = false;
        PageResponsive = true;
        _pinging = false;

        var old = _web;
        if (old != null)
        {
            Controls.Remove(old);
            try { old.Dispose(); } catch (Exception ex) { Log.Warn("Disposing old WebView failed: " + ex.Message); }
        }

        var web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
        _web = web;
        Controls.Add(web);

        try
        {
            _env ??= await CoreWebView2Environment.CreateAsync(null, Paths.WebView2Data, new CoreWebView2EnvironmentOptions());
            await web.EnsureCoreWebView2Async(_env);
        }
        catch (Exception ex)
        {
            WebViewError = ex.Message;
            Log.Error("WebView2 initialisation failed", ex);
            _env = null;
            web.Visible = false;
            ShowStartupError(ex.Message);
            return;
        }
        if (_web != web) return;
        WebViewError = null;
        if (_startupError != null)
        {
            Controls.Remove(_startupError);
            _startupError.Dispose();
            _startupError = null;
        }

        var core = web.CoreWebView2;
        BrowserVersion = _env.BrowserVersionString;
        core.SetVirtualHostNameToFolderMapping("app.local", Paths.Root, CoreWebView2HostResourceAccessKind.Allow);
        var s = core.Settings;
        s.AreDevToolsEnabled = true;
        s.IsStatusBarEnabled = false;
        s.AreDefaultContextMenusEnabled = false;
        s.IsZoomControlEnabled = true;
        HookF11(web);

        core.WebMessageReceived += (_, e) =>
        {
            try { Host.Bridge.OnMessage(e.WebMessageAsJson); }
            catch (Exception ex) { Log.Error("Bad web message", ex); }
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            TryShellOpen(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith("https://app.local/", StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                TryShellOpen(e.Uri);
                return;
            }
            PageReady = false;
            FsWatches.UnwatchAll();
            HttpBridge.AbortAll();
        };
        core.ProcessFailed += OnProcessFailed;
        core.WindowCloseRequested += (_, _) => BeginInvoke(new Action(Close));

        try
        {
            await core.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
            await core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":true}");
        }
        catch (Exception ex) { Log.Warn("Could not disable cache: " + ex.Message); }

        core.Navigate(ShellUrl);
        Log.Info($"WebView ready (Chromium {BrowserVersion})");
    }

    void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Warn($"WebView2 process failed: {e.ProcessFailedKind}, reason {e.Reason}, exit code {e.ExitCode}");
        if (_shuttingDown) return;
        switch (e.ProcessFailedKind)
        {
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
                BeginInvoke(new Action(() =>
                {
                    try { _web?.CoreWebView2?.Navigate(ShellUrl); }
                    catch { _ = Recreate(); }
                }));
                break;
            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                _env = null;
                BeginInvoke(new Action(async () => await Recreate()));
                break;
            case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                PageResponsive = false;
                break;
        }
    }

    async Task Recreate()
    {
        WebViewRecreations++;
        await CreateWebView();
    }

    /// <summary>Soft: kill the renderer (works even when the page is stuck in a loop), then reload. Hard: rebuild the WebView control.</summary>
    public async Task<string> ResetWebView(bool hard)
    {
        if (!hard && _env != null)
        {
            var killed = new List<int>();
            try
            {
                var infos = await _env.GetProcessExtendedInfosAsync();
                foreach (var info in infos.Where(i => i.ProcessInfo.Kind == CoreWebView2ProcessKind.Renderer))
                {
                    try { Process.GetProcessById(info.ProcessInfo.ProcessId).Kill(); killed.Add(info.ProcessInfo.ProcessId); }
                    catch { }
                }
            }
            catch (Exception ex) { Log.Warn("Listing WebView2 processes failed: " + ex.Message); }
            if (killed.Count > 0)
            {
                PageResponsive = true;
                _pinging = false;
                return $"Killed renderer process(es) {string.Join(", ", killed)}; the page is reloading with all modules.";
            }
        }
        await Recreate();
        return "Recreated the WebView; the page is reloading with all modules.";
    }

    public void ReloadPage(bool restoreDefaultShell)
    {
        if (restoreDefaultShell || ShellFiles.Files.Any(f => !File.Exists(Path.Combine(Paths.Shell, f))))
            ShellFiles.EnsureDefaults(restoreDefaultShell);
        var core = _web?.CoreWebView2 ?? throw new InvalidOperationException("WebView is not ready.");
        core.Navigate(ShellUrl);
    }

    public void OnPageReady()
    {
        PageReady = true;
        Log.Info("Page ready");
    }

    async void Ping()
    {
        var core = _web?.CoreWebView2;
        if (_pinging || core == null || _shuttingDown) return;
        _pinging = true;
        Task<string> task;
        try { task = core.ExecuteScriptAsync("1"); }
        catch { _pinging = false; return; }
        var done = await Task.WhenAny(task, Task.Delay(2500));
        if (done == task)
        {
            PageResponsive = true;
            LastPing = DateTime.Now;
            _pinging = false;
            return;
        }
        if (PageResponsive) Log.Warn("Page stopped responding");
        PageResponsive = false;
        _ = task.ContinueWith(t =>
        {
            if (IsHandleCreated && !IsDisposed)
                BeginInvoke(new Action(() => { _pinging = false; if (t.IsCompletedSuccessfully) PageResponsive = true; }));
        });
    }

    CoreWebView2 Core() => _web?.CoreWebView2 ?? throw new InvalidOperationException(
        WebViewError != null ? "WebView failed to start: " + WebViewError : "WebView is not ready yet.");

    public void EnsureResponsive()
    {
        if (!PageResponsive)
            throw new InvalidOperationException("The page is unresponsive (likely an infinite loop). Call reset_webview to recover.");
    }

    /// <summary>Calls a Chrome DevTools Protocol method on the page.</summary>
    public Task<JsonNode?> Cdp(string method, object? parameters, int timeoutMs = 10000) => Host.OnUi(async () =>
    {
        var json = await Core().CallDevToolsProtocolMethodAsync(method, JsonSerializer.Serialize(parameters ?? new { }, Host.JsonNoNulls));
        return JsonNode.Parse(json);
    }, timeoutMs);

    public void PostToPage(string json)
    {
        if (_shuttingDown || IsDisposed || !IsHandleCreated) return;
        try
        {
            BeginInvoke(new Action(() =>
            {
                try { _web?.CoreWebView2?.PostWebMessageAsJson(json); } catch { }
            }));
        }
        catch { }
    }

    public void OpenDevTools() => Core().OpenDevToolsWindow();

    public async Task<object> ProcessInfo()
    {
        if (_env == null) return Array.Empty<object>();
        var infos = await _env.GetProcessExtendedInfosAsync();
        return infos.Select(i => new { pid = i.ProcessInfo.ProcessId, kind = i.ProcessInfo.Kind.ToString() }).ToArray();
    }

    static void TryShellOpen(string uri)
    {
        try { HostBridge.ShellOpen(uri); } catch (Exception ex) { Log.Warn($"Could not open {uri}: {ex.Message}"); }
    }

    // ---------------------------------------------------------------- shell hot reload

    void StartShellWatcher()
    {
        _shellWatcher = new FileSystemWatcher(Paths.Shell)
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler h = (_, _) => _shellDebounce.Run("shell", () =>
        {
            if (_shuttingDown || IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                try { Log.Info("Shell files changed; reloading page"); ReloadPage(false); }
                catch (Exception ex) { Log.Warn("Shell reload failed: " + ex.Message); }
            }));
        });
        _shellWatcher.Changed += h;
        _shellWatcher.Created += h;
        _shellWatcher.Deleted += h;
        _shellWatcher.Renamed += (s, e) => h(s, e);
        _shellWatcher.EnableRaisingEvents = true;
        _shellPoll = new SharePoll(Paths.Shell, false, _ => h(this, new FileSystemEventArgs(WatcherChangeTypes.Changed, Paths.Shell, "index.html")));
    }

    void ShowStartupError(string message)
    {
        _startupError?.Dispose();
        var label = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(230, 230, 234),
            BackColor = Background,
            TextAlign = ContentAlignment.MiddleCenter,
            Padding = new Padding(32),
            Text = "GameWindow could not start the view.\n\n" + message,
        };
        _startupError = label;
        Controls.Add(label);
        label.BringToFront();
    }

    // ---------------------------------------------------------------- window control

    public object WindowInfo()
    {
        var b = _fullscreen ? _prevBounds : (WindowState == FormWindowState.Normal ? Bounds : RestoreBounds);
        return new
        {
            title = Text,
            bounds = new { x = b.X, y = b.Y, width = b.Width, height = b.Height },
            clientSize = new { width = ClientSize.Width, height = ClientSize.Height },
            state = WindowState.ToString().ToLowerInvariant(),
            fullscreen = _fullscreen,
            topmost = TopMost,
            opacity = Opacity,
            dpi = DeviceDpi,
            focused = ContainsFocus,
        };
    }

    public void ApplyWindow(WindowChange c)
    {
        if (c.Title != null) { Text = c.Title; Host.State.Update(s => s.Title = c.Title); }
        if (c.Fullscreen == false && _fullscreen) SetFullscreen(false);
        if (c.State != null)
        {
            if (_fullscreen) SetFullscreen(false);
            WindowState = c.State.ToLowerInvariant() switch
            {
                "minimized" => FormWindowState.Minimized,
                "maximized" => FormWindowState.Maximized,
                "normal" => FormWindowState.Normal,
                _ => throw new ArgumentException("state must be normal, minimized or maximized."),
            };
        }
        if (c.X != null || c.Y != null || c.Width != null || c.Height != null)
        {
            if (_fullscreen) SetFullscreen(false);
            if (WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
            Bounds = new Rectangle(c.X ?? Left, c.Y ?? Top, Math.Max(MinimumSize.Width, c.Width ?? Width), Math.Max(MinimumSize.Height, c.Height ?? Height));
        }
        if (c.Topmost is bool top) { TopMost = top; Host.State.Update(s => s.Topmost = top); }
        if (c.Opacity is double op) { Opacity = Math.Clamp(op, 0.1, 1); Host.State.Update(s => s.Opacity = Opacity); }
        if (c.Fullscreen == true && !_fullscreen) SetFullscreen(true);
        SaveWindowState();
    }

    void SetFullscreen(bool on)
    {
        if (on == _fullscreen) return;
        if (on)
        {
            _prevBorder = FormBorderStyle;
            _prevState = WindowState;
            _prevBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
            _fullscreen = true;
        }
        else
        {
            _fullscreen = false;
            FormBorderStyle = _prevBorder;
            Bounds = _prevBounds;
            WindowState = _prevState;
        }
    }

    const int VkF11 = 0x7A;

    void HookF11(WebView2 web)
    {
        var controller = FindController(web);
        if (controller == null)
        {
            Log.Warn("F11 fullscreen: CoreWebView2Controller not found");
            return;
        }
        controller.AcceleratorKeyPressed += OnAcceleratorKey;
    }

    static CoreWebView2Controller? FindController(WebView2 web)
    {
        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        for (var type = web.GetType(); type != null; type = type.BaseType)
        {
            foreach (var field in type.GetFields(flags))
            {
                if (typeof(CoreWebView2Controller).IsAssignableFrom(field.FieldType)
                    && field.GetValue(web) is CoreWebView2Controller fromField)
                    return fromField;
            }
            foreach (var prop in type.GetProperties(flags))
            {
                if (prop.GetIndexParameters().Length != 0) continue;
                if (!typeof(CoreWebView2Controller).IsAssignableFrom(prop.PropertyType)) continue;
                try
                {
                    if (prop.GetValue(web) is CoreWebView2Controller fromProp)
                        return fromProp;
                }
                catch { }
            }
        }
        return null;
    }

    void OnAcceleratorKey(object? sender, CoreWebView2AcceleratorKeyPressedEventArgs e)
    {
        if (e.VirtualKey != VkF11) return;
        if (e.KeyEventKind is not (CoreWebView2KeyEventKind.KeyDown or CoreWebView2KeyEventKind.SystemKeyDown))
            return;
        if (e.PhysicalKeyStatus.WasKeyDown != 0) return;
        e.Handled = true;
        e.IsBrowserAcceleratorKeyEnabled = false;
        BeginInvoke(() => SetFullscreen(!_fullscreen));
    }

    public void BringToFront(bool activate)
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        if (!activate) return;
        var top = TopMost;
        TopMost = true;
        TopMost = top;
        Activate();
        SetForegroundWindow(Handle);
    }

    public void Flash()
    {
        var info = new FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(),
            hwnd = Handle,
            dwFlags = 3 | 12,
            uCount = 3,
        };
        FlashWindowEx(ref info);
    }

    public void Notify(string title, string body)
    {
        var icon = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Visible = true, Text = "Game" };
        _notifyIcons.Add(icon);
        icon.ShowBalloonTip(5000, title, body.Length == 0 ? " " : body, ToolTipIcon.None);
        var timer = new System.Windows.Forms.Timer { Interval = 8000 };
        timer.Tick += (_, _) =>
        {
            timer.Dispose();
            icon.Visible = false;
            icon.Dispose();
            _notifyIcons.Remove(icon);
        };
        timer.Start();
    }

    void RestoreSavedBounds()
    {
        var st = Host.State.Value;
        var rect = st.Bounds is { Width: > 0, Height: > 0 } b ? new Rectangle(b.X, b.Y, b.Width, b.Height) : Rectangle.Empty;
        if (rect != Rectangle.Empty && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect)))
            Bounds = rect;
        else
        {
            var scale = DeviceDpi / 96.0;
            var work = Screen.FromPoint(Cursor.Position).WorkingArea;
            ClientSize = new Size(Math.Min((int)(1280 * scale), work.Width), Math.Min((int)(800 * scale), work.Height - 40));
            Location = new Point(work.Left + (work.Width - Width) / 2, work.Top + Math.Max(0, (work.Height - Height) / 2));
        }
        if (st.Maximized) WindowState = FormWindowState.Maximized;
    }

    void SaveWindowState()
    {
        if (!IsHandleCreated || WindowState == FormWindowState.Minimized) return;
        var b = _fullscreen ? _prevBounds : (WindowState == FormWindowState.Normal ? Bounds : RestoreBounds);
        var maximized = _fullscreen ? _prevState == FormWindowState.Maximized : WindowState == FormWindowState.Maximized;
        Host.State.Update(s =>
        {
            s.Bounds = new WindowBounds { X = b.X, Y = b.Y, Width = b.Width, Height = b.Height };
            s.Maximized = maximized;
        });
    }

    // ---------------------------------------------------------------- shutdown

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_shutdownComplete)
        {
            e.Cancel = true;
            if (!_shuttingDown) _ = ShutdownAsync();
            return;
        }
        base.OnFormClosing(e);
    }

    async Task ShutdownAsync()
    {
        _shuttingDown = true;
        Log.Info("Shutting down");
        new Thread(() =>
        {
            Thread.Sleep(3000);
            Log.Warn("Shutdown took longer than 3 s; forcing exit");
            try { JobObject.KillDescendants(); } catch { }
            Environment.Exit(0);
        }) { IsBackground = true }.Start();

        Step("stop timers", () => { _watchdog.Stop(); _boundsSaver.Stop(); });
        Step("save window state", SaveWindowState);
        // Bundled helpers (cloudflared tunnel) must die with the window — stop before UI teardown.
        Step("stop collab tunnel", CollabTunnel.Stop);
        try
        {
            if (_web?.CoreWebView2 is { } core)
                await Task.WhenAny(core.ExecuteScriptAsync("window.__lw && window.__lw.disposeAll()"), Task.Delay(700));
        }
        catch { }
        Step("kill child processes", Host.Processes.KillAll);
        Step("stop watchers", () =>
        {
            FsWatches.UnwatchAll();
            HttpBridge.AbortAll();
            _shellWatcher?.Dispose();
            _shellPoll?.Dispose();
            _shellDebounce.Dispose();
            Host.Modules.Dispose();
            Host.Assets.Dispose();
        });
        Step("remove notifications", () => { foreach (var n in _notifyIcons.ToArray()) { n.Visible = false; n.Dispose(); } });
        try { await McpHost.Stop(1000); } catch { }
        try { await CollabHost.Stop(1000); } catch { }
        Step("save state", () => { Host.State.Save(); Host.Storage.Flush(); });
        Step("dispose webview", () => _web?.Dispose());
        Step("kill remaining child processes", JobObject.KillDescendants);
        Log.Info("Shutdown complete");
        Step("release mutex", () => Program.SingleInstance?.ReleaseMutex());
        _shutdownComplete = true;
        Environment.Exit(0);
    }

    static void Step(string name, Action action)
    {
        try { action(); }
        catch (Exception ex) { Log.Warn($"Shutdown step '{name}' failed: {ex.Message}"); }
    }

    // ---------------------------------------------------------------- native

    [StructLayout(LayoutKind.Sequential)]
    struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    static extern bool FlashWindowEx(ref FLASHWINFO info);

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);
}
