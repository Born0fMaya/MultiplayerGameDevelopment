using System.Text.Json;
using ModelContextProtocol;

namespace GameWindow.Tools;

/// <summary>Runs tool bodies so that every failure comes back to Cursor as a readable tool error.</summary>
static class Tool
{
    public static string Json(object? value) => value is string s ? s : JsonSerializer.Serialize(value, Host.JsonIndented);

    public static async Task<string> Run(Func<Task<object?>> body)
    {
        try { return Json(await body()); }
        catch (McpException) { throw; }
        catch (Exception ex) { throw Wrap(ex); }
    }

    public static Task<string> Run(Func<object?> body) => Run(() => Task.FromResult(body()));

    public static McpException Wrap(Exception ex)
    {
        var inner = ex is AggregateException { InnerException: { } ie } ? ie : ex;
        Log.Warn($"Tool error: {inner.GetType().Name}: {inner.Message}");
        return new McpException(inner.Message);
    }

    /// <summary>A JavaScript string literal for embedding user input in page scripts.</summary>
    public static string Js(string? value) => JsonSerializer.Serialize(value);
}
