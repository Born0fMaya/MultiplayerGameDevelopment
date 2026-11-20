using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GameWindow;

/// <summary>HTTP requests made from the host, so pages are not limited by CORS (e.g. Ollama on localhost:11434).</summary>
static class HttpBridge
{
    public static readonly HttpClient Client = new(new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    })
    { Timeout = Timeout.InfiniteTimeSpan };

    static readonly ConcurrentDictionary<int, CancellationTokenSource> Streams = new();
    static int _nextId;

    public static async Task<object?> Fetch(string url, JsonElement? options)
    {
        string Opt(string name) => options is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
        bool OptBool(string name) => options is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
        int OptInt(string name, int def) => options is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : def;

        var method = Opt("method") is { Length: > 0 } m ? m.ToUpperInvariant() : "GET";
        var responseType = Opt("responseType") is { Length: > 0 } r ? r : "text";
        var timeoutMs = OptInt("timeoutMs", 100_000);
        var request = new HttpRequestMessage(new HttpMethod(method), url);

        if (Opt("bodyBase64") is { Length: > 0 } b64) request.Content = new ByteArrayContent(Convert.FromBase64String(b64));
        else if (options is { ValueKind: JsonValueKind.Object } o1 && o1.TryGetProperty("body", out var body) && body.ValueKind != JsonValueKind.Null)
        {
            var text = body.ValueKind == JsonValueKind.String ? body.GetString()! : body.GetRawText();
            request.Content = new StringContent(text, Encoding.UTF8);
            request.Content.Headers.ContentType = null;
            if (body.ValueKind != JsonValueKind.String) request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");
        }

        if (options is { ValueKind: JsonValueKind.Object } o2 && o2.TryGetProperty("headers", out var headers) && headers.ValueKind == JsonValueKind.Object)
            foreach (var h in headers.EnumerateObject())
            {
                var value = h.Value.ToString();
                if (!request.Headers.TryAddWithoutValidation(h.Name, value) && request.Content != null)
                {
                    request.Content.Headers.Remove(h.Name);
                    request.Content.Headers.TryAddWithoutValidation(h.Name, value);
                }
            }

        using var headerCts = new CancellationTokenSource(timeoutMs);
        var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, headerCts.Token);
        var responseHeaders = response.Headers.Concat(response.Content.Headers)
            .GroupBy(h => h.Key.ToLowerInvariant())
            .ToDictionary(g => g.Key, g => string.Join(", ", g.SelectMany(h => h.Value)));

        if (OptBool("stream"))
        {
            var id = Interlocked.Increment(ref _nextId);
            var cts = new CancellationTokenSource();
            Streams[id] = cts;
            _ = Task.Run(async () =>
            {
                string? error = null;
                try
                {
                    using (response)
                    {
                        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cts.Token), Encoding.UTF8);
                        var buf = new char[8192];
                        int n;
                        while ((n = await reader.ReadAsync(buf.AsMemory(), cts.Token)) > 0)
                            Host.Post(new { type = "event", name = "http.chunk", data = new { id, text = new string(buf, 0, n) } });
                    }
                }
                catch (OperationCanceledException) { error = "aborted"; }
                catch (Exception ex) { error = ex.Message; }
                finally
                {
                    Streams.TryRemove(id, out _);
                    cts.Dispose();
                    Host.Post(new { type = "event", name = "http.end", data = new { id, error } });
                }
            });
            return new { id, status = (int)response.StatusCode, statusText = response.ReasonPhrase, ok = response.IsSuccessStatusCode, headers = responseHeaders };
        }

        using (response)
        {
            object? bodyValue;
            using var bodyCts = new CancellationTokenSource(timeoutMs);
            if (responseType == "base64") bodyValue = Convert.ToBase64String(await response.Content.ReadAsByteArrayAsync(bodyCts.Token));
            else
            {
                var text = await response.Content.ReadAsStringAsync(bodyCts.Token);
                bodyValue = responseType == "json" ? JsonNode.Parse(text) : text;
            }
            return new { status = (int)response.StatusCode, statusText = response.ReasonPhrase, ok = response.IsSuccessStatusCode, headers = responseHeaders, body = bodyValue };
        }
    }

    public static bool Abort(int id)
    {
        if (!Streams.TryGetValue(id, out var cts)) return false;
        try { cts.Cancel(); } catch { }
        return true;
    }

    public static void AbortAll()
    {
        foreach (var id in Streams.Keys) Abort(id);
    }
}

/// <summary>File watches requested by the page. Cleared whenever the page navigates or reloads.</summary>
static class FsWatches
{
    static readonly ConcurrentDictionary<int, FileSystemWatcher> Watchers = new();
    static int _nextId;

    public static int Watch(string path, bool recursive)
    {
        var full = Paths.Resolve(path);
        FileSystemWatcher w = Directory.Exists(full)
            ? new FileSystemWatcher(full)
            : new FileSystemWatcher(Path.GetDirectoryName(full) ?? throw new ArgumentException("Invalid path"), Path.GetFileName(full));
        var id = Interlocked.Increment(ref _nextId);
        w.IncludeSubdirectories = recursive;
        w.NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size;
        void Send(string kind, string p, string? old = null) =>
            Host.Post(new { type = "event", name = "fs.change", data = new { id, kind, path = p, oldPath = old } });
        w.Changed += (_, e) => Send("changed", e.FullPath);
        w.Created += (_, e) => Send("created", e.FullPath);
        w.Deleted += (_, e) => Send("deleted", e.FullPath);
        w.Renamed += (_, e) => Send("renamed", e.FullPath, e.OldFullPath);
        w.EnableRaisingEvents = true;
        Watchers[id] = w;
        return id;
    }

    public static bool Unwatch(int id)
    {
        if (!Watchers.TryRemove(id, out var w)) return false;
        w.Dispose();
        return true;
    }

    public static void UnwatchAll()
    {
        foreach (var id in Watchers.Keys) Unwatch(id);
    }
}
