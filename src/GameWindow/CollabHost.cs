using System.Net;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace GameWindow;

/// <summary>
/// LAN collaboration server. Guests connect with an IP + port and sync project + presence
/// over HTTP instead of a shared network folder.
/// </summary>
static class CollabHost
{
    public const int Port = 5282;
    static WebApplication? _app;
    static readonly object Gate = new();
    static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = false };

    public static bool Running { get; private set; }
    public static string? Error { get; private set; }
    public static string Url => $"http://0.0.0.0:{Port}/";

    public static void Start() => _ = Task.Run(async () =>
    {
        try { await Run(); }
        catch (Exception ex)
        {
            Error = ex.Message;
            Log.Error("Collab server failed to start", ex);
        }
    });

    static string ActivePath()
    {
        var file = Path.Combine(Paths.Storage, "collab-active.json");
        if (!File.Exists(file)) return "";
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            return doc.RootElement.TryGetProperty("path", out var p) ? (p.GetString() ?? "") : "";
        }
        catch { return ""; }
    }

    static string SessionsDir(string projectPath) => projectPath + ".sessions";

    static IEnumerable<string> LocalAddresses()
    {
        yield return "127.0.0.1";
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback) continue;
            foreach (var addr in nic.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                var ip = addr.Address.ToString();
                if (!string.IsNullOrWhiteSpace(ip)) yield return ip;
            }
        }
    }

    static async Task Run()
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            ContentRootPath = Paths.Root,
            ApplicationName = "GameWindow.Collab",
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(o => o.Listen(IPAddress.Any, Port));

        var app = builder.Build();

        app.Use(async (ctx, next) =>
        {
            ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
            ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
            ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            if (HttpMethods.IsOptions(ctx.Request.Method))
            {
                ctx.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            }
            await next();
        });

        app.MapGet("/collab/info", () =>
        {
            var path = ActivePath();
            var name = string.IsNullOrEmpty(path) ? "" : Path.GetFileNameWithoutExtension(path);
            long revision = 0;
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(path));
                    if (doc.RootElement.TryGetProperty("revision", out var rev) && rev.ValueKind == JsonValueKind.Number)
                        revision = rev.GetInt64();
                }
                catch { /* ignore */ }
            }
            return Results.Json(new
            {
                ok = true,
                version = Host.Version,
                machine = Environment.MachineName,
                project = name,
                path = string.IsNullOrEmpty(path) ? null : path,
                revision,
                port = Port,
                addresses = LocalAddresses().Distinct().ToArray(),
            });
        });

        app.MapGet("/collab/project", () =>
        {
            var path = ActivePath();
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                return Results.Json(new { ok = false, error = "Host has no project open." }, statusCode: 404);
            try
            {
                var text = File.ReadAllText(path);
                return Results.Text(text, "application/json");
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = ex.Message }, statusCode: 500);
            }
        });

        app.MapPut("/collab/project", async (HttpRequest req) =>
        {
            var path = ActivePath();
            if (string.IsNullOrEmpty(path))
                return Results.Json(new { ok = false, error = "Host has no project open." }, statusCode: 404);
            string body;
            using (var reader = new StreamReader(req.Body, Encoding.UTF8))
                body = await reader.ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(body))
                return Results.Json(new { ok = false, error = "Empty body." }, statusCode: 400);

            long incomingRev = 0;
            try
            {
                using var parsed = JsonDocument.Parse(body);
                if (parsed.RootElement.TryGetProperty("revision", out var rev) && rev.ValueKind == JsonValueKind.Number)
                    incomingRev = rev.GetInt64();
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = "Invalid JSON: " + ex.Message }, statusCode: 400);
            }

            lock (Gate)
            {
                long currentRev = 0;
                if (File.Exists(path))
                {
                    try
                    {
                        using var existing = JsonDocument.Parse(File.ReadAllText(path));
                        if (existing.RootElement.TryGetProperty("revision", out var rev) && rev.ValueKind == JsonValueKind.Number)
                            currentRev = rev.GetInt64();
                    }
                    catch { /* overwrite broken file */ }
                }
                if (incomingRev < currentRev)
                    return Results.Json(new { ok = false, error = "Stale revision.", revision = currentRev }, statusCode: 409);

                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var tmp = path + $".{DateTime.UtcNow.Ticks}.tmp";
                File.WriteAllText(tmp, body, Encoding.UTF8);
                File.Move(tmp, path, true);
                return Results.Json(new { ok = true, revision = incomingRev });
            }
        });

        app.MapPost("/collab/session/{id}", async (string id, HttpRequest req) =>
        {
            var path = ActivePath();
            if (string.IsNullOrEmpty(path))
                return Results.Json(new { ok = false, error = "Host has no project open." }, statusCode: 404);
            if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                return Results.Json(new { ok = false, error = "Bad session id." }, statusCode: 400);

            string body;
            using (var reader = new StreamReader(req.Body, Encoding.UTF8))
                body = await reader.ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(body))
                return Results.Json(new { ok = false, error = "Empty body." }, statusCode: 400);

            var sessions = SessionsDir(path);
            Directory.CreateDirectory(sessions);
            var mine = Path.Combine(sessions, id);
            var tmp = mine + ".tmp";
            await File.WriteAllTextAsync(tmp, body, Encoding.UTF8);
            File.Move(tmp, mine, true);

            var now = DateTime.UtcNow;
            var people = new JsonArray();
            var chatLists = new List<JsonArray>();
            foreach (var file in Directory.EnumerateFiles(sessions))
            {
                if (file.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue;
                var name = Path.GetFileName(file);
                var mineEntry = string.Equals(name, id, StringComparison.OrdinalIgnoreCase);
                DateTime modified;
                try { modified = File.GetLastWriteTimeUtc(file); }
                catch { continue; }
                if (!mineEntry && (now - modified).TotalSeconds > 12)
                {
                    try { File.Delete(file); } catch { /* busy */ }
                    continue;
                }
                JsonNode? data;
                try { data = JsonNode.Parse(await File.ReadAllTextAsync(file)); }
                catch { continue; }
                if (data is not JsonObject obj) continue;
                if (obj["chat"] is JsonArray chat) chatLists.Add(chat);
                if (mineEntry) continue;
                people.Add(new JsonObject
                {
                    ["id"] = name,
                    ["name"] = obj["name"]?.GetValue<string>() ?? "User",
                    ["color"] = obj["color"]?.GetValue<string>() ?? "#5b9dff",
                    ["mode"] = obj["mode"]?.GetValue<string>() == "live" ? "live" : "edit",
                    ["position"] = obj["position"]?.DeepClone(),
                    ["forward"] = obj["forward"]?.DeepClone(),
                    ["pointer"] = obj["pointer"]?.DeepClone(),
                    ["activeAt"] = obj["activeAt"]?.DeepClone()
                        ?? JsonValue.Create(modified.Subtract(DateTime.UnixEpoch).TotalMilliseconds),
                    ["selection"] = obj["selection"]?.DeepClone() ?? new JsonArray(),
                    ["chat"] = obj["chat"]?.DeepClone(),
                });
            }

            long revision = 0;
            try
            {
                using var proj = JsonDocument.Parse(await File.ReadAllTextAsync(path));
                if (proj.RootElement.TryGetProperty("revision", out var rev) && rev.ValueKind == JsonValueKind.Number)
                    revision = rev.GetInt64();
            }
            catch { /* ignore */ }

            return Results.Json(new
            {
                ok = true,
                revision,
                people,
                chat = MergeChat(chatLists),
            });
        });

        app.MapDelete("/collab/session/{id}", (string id) =>
        {
            var path = ActivePath();
            if (string.IsNullOrEmpty(path) || string.IsNullOrWhiteSpace(id)) return Results.Json(new { ok = true });
            var file = Path.Combine(SessionsDir(path), id);
            try { if (File.Exists(file)) File.Delete(file); } catch { /* ignore */ }
            return Results.Json(new { ok = true });
        });

        await app.StartAsync();
        _app = app;
        Running = true;
        Log.Info($"Collab server listening on http://*:{Port}/");
    }

    static JsonArray MergeChat(List<JsonArray> lists)
    {
        var map = new Dictionary<string, JsonNode>();
        foreach (var list in lists)
        {
            foreach (var item in list)
            {
                if (item is not JsonObject obj) continue;
                var id = obj["id"]?.GetValue<string>();
                if (string.IsNullOrEmpty(id) || map.ContainsKey(id)) continue;
                map[id] = obj.DeepClone();
            }
        }
        return new JsonArray(map.Values
            .OrderBy(n => n?["at"]?.GetValue<long>() ?? 0)
            .TakeLast(50)
            .Select(n => n!.DeepClone())
            .ToArray());
    }

    public static async Task Stop(int timeoutMs)
    {
        var app = _app;
        if (app == null) return;
        Running = false;
        using var cts = new CancellationTokenSource(timeoutMs);
        try { await app.StopAsync(cts.Token); } catch { /* shutting down */ }
        await app.DisposeAsync();
        _app = null;
    }
}
