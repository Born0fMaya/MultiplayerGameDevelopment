using System.Net;
using GameWindow.Tools;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GameWindow;

/// <summary>The embedded MCP server (streamable HTTP, stateless) on 127.0.0.1.</summary>
static class McpHost
{
    static WebApplication? _app;

    public static string Url => $"http://127.0.0.1:{Program.Port}/mcp";
    public static bool Running { get; private set; }
    public static string? Error { get; private set; }

    public static void Start() => _ = Task.Run(async () =>
    {
        try
        {
            await Run();
        }
        catch (Exception ex)
        {
            Error = ex.Message;
            Log.Error("MCP server failed to start", ex);
            Host.Form.BeginInvoke(new Action(() => Host.Form.Text += $"  (MCP server failed: port {Program.Port} unavailable)"));
        }
    });

    static async Task Run()
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            ContentRootPath = Paths.Root,
            ApplicationName = "GameWindow",
        });
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(new HostLoggerProvider());
        builder.WebHost.ConfigureKestrel(o => o.Listen(IPAddress.Loopback, Program.Port));

        builder.Services
            .AddMcpServer(o =>
            {
                o.ServerInfo = new() { Name = "game-window", Version = Host.Version };
                o.ServerInstructions = BridgeDocs.Instructions;
            })
            .WithHttpTransport(o => o.Stateless = true)
            .WithTools<ModuleTools>()
            .WithTools<AssetTools>()
            .WithTools<PageTools>()
            .WithTools<InputTools>()
            .WithTools<WindowTools>()
            .WithTools<StorageTools>()
            .WithTools<ProcessTools>()
            .WithTools<DiagnosticTools>()
            .WithTools<RecoveryTools>();

        var app = builder.Build();

        // Only local, non-browser clients: blocks DNS rebinding and cross-site requests from web pages.
        app.Use(async (ctx, next) =>
        {
            var host = ctx.Request.Host.Host;
            var origin = ctx.Request.Headers.Origin.ToString();
            bool hostOk = host is "127.0.0.1" or "localhost" or "[::1]";
            bool originOk = string.IsNullOrEmpty(origin) || origin == "null" ||
                            origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                            origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase);
            if (!hostOk || !originOk)
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            await next();
        });

        app.MapMcp("/mcp");
        app.MapGet("/", () => $"GameWindow {Host.Version} MCP server. Endpoint: {Url}");
        app.MapGet("/focus", () =>
        {
            Host.Form.BeginInvoke(new Action(() => Host.Form.BringToFront(true)));
            return "ok";
        });

        await app.StartAsync();
        _app = app;
        Running = true;
        Log.Info("MCP server listening at " + Url);
    }

    public static async Task Stop(int timeoutMs)
    {
        var app = _app;
        if (app == null) return;
        Running = false;
        using var cts = new CancellationTokenSource(timeoutMs);
        try { await app.StopAsync(cts.Token); } catch { }
        try { await app.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromMilliseconds(500)); } catch { }
    }
}
