using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace GameWindow.Tools;

[McpServerToolType]
public sealed class PageTools
{
    [McpServerTool(Name = "eval_js"), Description(
        "Run JavaScript in the live page (REPL semantics: the last expression is returned, top-level await works, promises are awaited). " +
        "Returns the value as JSON. Use for quick experiments and inspection; use write_module for anything that should persist. " +
        "window.__lw exposes loader internals (records, bus, call).")]
    public static Task<string> EvalJs(
        [Description("JavaScript code")] string code,
        [Description("Timeout in ms (default 10000)")] int timeoutMs = 10000) => Tool.Run(async () =>
    {
        Host.Form.EnsureResponsive();
        var value = await Host.Eval(code, timeoutMs);
        return value?.ToJsonString(Host.JsonIndented) ?? "undefined";
    });

    [McpServerTool(Name = "get_dom", ReadOnly = true), Description("Get the outer HTML of the page or of the first element matching a CSS selector.")]
    public static Task<string> GetDom(
        [Description("CSS selector (default: html)")] string? selector = null,
        [Description("Maximum characters to return (default 50000)")] int maxChars = 50000) => Tool.Run(async () =>
    {
        Host.Form.EnsureResponsive();
        var html = await Host.Eval($"document.querySelector({Tool.Js(selector ?? "html")})?.outerHTML ?? null");
        if (html == null) throw new ArgumentException($"No element matches '{selector}'.");
        var s = html.ToString();
        return s.Length > maxChars ? s[..maxChars] + $"\n... [truncated, {s.Length} chars total]" : s;
    });

    [McpServerTool(Name = "query", ReadOnly = true), Description("Find elements by CSS selector and return tag, id, classes, text, visibility and bounding box for each (max 50).")]
    public static Task<string> Query([Description("CSS selector")] string selector) => Tool.Run(async () =>
    {
        Host.Form.EnsureResponsive();
        return await Host.Eval($$"""
            [...document.querySelectorAll({{Tool.Js(selector)}})].slice(0, 50).map(el => {
              const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
              return { tag: el.tagName.toLowerCase(), id: el.id || undefined, classes: el.className && typeof el.className === 'string' ? el.className : undefined,
                text: (el.innerText ?? el.textContent ?? '').trim().slice(0, 200),
                value: 'value' in el ? String(el.value).slice(0, 200) : undefined,
                visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0',
                rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
            })
            """);
    });

    [McpServerTool(Name = "get_console", ReadOnly = true), Description("Read captured page console output (log/info/warn/error/debug, uncaught errors, unhandled rejections). Pass 'since' = previous 'next' to get only new entries.")]
    public static Task<string> GetConsole(
        [Description("Only entries after this sequence number")] long since = 0,
        [Description("Filter by level: log, info, warn, error, debug")] string? level = null,
        [Description("Maximum entries (default 200)")] int max = 200,
        [Description("Clear the buffer after reading")] bool clear = false) => Tool.Run(() =>
    {
        var (next, entries) = Host.Console.Since(since, level, max);
        if (clear) Host.Console.Clear();
        return new { next, entries };
    });

    [McpServerTool(Name = "get_errors", ReadOnly = true), Description("Everything currently wrong: modules that failed to load or threw at runtime, recent console errors, page responsiveness and WebView/MCP problems.")]
    public static Task<string> GetErrors() => Tool.Run(() => new
    {
        pageResponsive = Host.Form.PageResponsive,
        pageReady = Host.Form.PageReady,
        webViewError = Host.Form.WebViewError,
        mcpError = McpHost.Error,
        modules = Host.Modules.Problems().Select(p => new { name = p.Name, status = p.Status.Status, error = p.Status.Error, runtimeError = p.Status.RuntimeError }),
        consoleErrors = Host.Console.Errors(30),
    });

    [McpServerTool(Name = "wait_for", ReadOnly = true), Description("Wait until a CSS selector matches a visible element, or a JS condition becomes truthy. Returns how long it took.")]
    public static Task<string> WaitFor(
        [Description("CSS selector to wait for")] string? selector = null,
        [Description("JS expression to wait for (truthy)")] string? condition = null,
        [Description("Timeout in ms (default 5000)")] int timeoutMs = 5000) => Tool.Run(async () =>
    {
        if (selector == null && condition == null) throw new ArgumentException("Provide selector or condition.");
        var expr = condition ?? $"(() => {{ const el = document.querySelector({Tool.Js(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }})()";
        var start = DateTime.UtcNow;
        while ((DateTime.UtcNow - start).TotalMilliseconds < timeoutMs)
        {
            Host.Form.EnsureResponsive();
            var v = await Host.Eval($"!!({expr})", 3000);
            if (v is JsonValue jv && jv.TryGetValue<bool>(out var b) && b)
                return new { ok = true, elapsedMs = (int)(DateTime.UtcNow - start).TotalMilliseconds };
            await Task.Delay(100);
        }
        throw new TimeoutException($"Condition not met within {timeoutMs} ms.");
    });

    [McpServerTool(Name = "screenshot", ReadOnly = true), Description("Capture a PNG of the window's page, of one element (CSS selector), or of the full scrollable page. Use it after every visual change.")]
    public static async Task<CallToolResult> Screenshot(
        [Description("Optional CSS selector to capture just that element")] string? selector = null,
        [Description("Capture the whole scrollable page instead of the viewport")] bool fullPage = false)
    {
        try
        {
            Host.Form.EnsureResponsive();
            object? clip = null;
            bool beyond = false;
            if (selector != null)
            {
                var rect = await Host.Eval($$"""
                    (() => { const el = document.querySelector({{Tool.Js(selector)}}); if (!el) return null;
                      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect();
                      return { x: r.left + scrollX, y: r.top + scrollY, width: Math.max(1, r.width), height: Math.max(1, r.height) }; })()
                    """) ?? throw new ArgumentException($"No element matches '{selector}'.");
                clip = new { x = (double)rect["x"]!, y = (double)rect["y"]!, width = (double)rect["width"]!, height = (double)rect["height"]!, scale = 1 };
                beyond = true;
            }
            else if (fullPage)
            {
                var metrics = await Host.Form.Cdp("Page.getLayoutMetrics", null);
                var size = metrics?["cssContentSize"];
                clip = new { x = 0, y = 0, width = (double)size!["width"]!, height = (double)size["height"]!, scale = 1 };
                beyond = true;
            }
            var res = await Host.Form.Cdp("Page.captureScreenshot", new { format = "png", clip, captureBeyondViewport = beyond }, 15000);
            var bytes = Convert.FromBase64String(res!["data"]!.ToString());
            return new CallToolResult { Content = [ImageContentBlock.FromBytes(bytes, "image/png")] };
        }
        catch (Exception ex)
        {
            throw Tool.Wrap(ex);
        }
    }
}
