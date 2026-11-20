using System.ComponentModel;
using ModelContextProtocol.Server;

namespace GameWindow.Tools;

/// <summary>Real (trusted) input through the DevTools Input domain, so Cursor can test features itself.</summary>
[McpServerToolType]
public sealed class InputTools
{
    static async Task<(double X, double Y)> Point(string? selector, double? x, double? y)
    {
        Host.Form.EnsureResponsive();
        if (selector != null)
        {
            var p = await Host.Eval($$"""
                (() => { const el = document.querySelector({{Tool.Js(selector)}}); if (!el) return null;
                  el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
                  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()
                """) ?? throw new ArgumentException($"No element matches '{selector}'.");
            return ((double)p["x"]!, (double)p["y"]!);
        }
        if (x == null || y == null) throw new ArgumentException("Provide a selector or both x and y (CSS pixels from the top-left of the page viewport).");
        return (x.Value, y.Value);
    }

    static int Modifiers(string[]? mods)
    {
        int m = 0;
        foreach (var mod in mods ?? [])
            m |= mod.ToLowerInvariant() switch
            {
                "alt" => 1,
                "ctrl" or "control" => 2,
                "meta" or "cmd" or "win" => 4,
                "shift" => 8,
                _ => throw new ArgumentException($"Unknown modifier '{mod}'. Use alt, ctrl, meta, shift."),
            };
        return m;
    }

    static Task Mouse(string type, double x, double y, string button = "none", int clickCount = 0, int modifiers = 0, double deltaX = 0, double deltaY = 0) =>
        Host.Form.Cdp("Input.dispatchMouseEvent", new
        {
            type, x, y, button, clickCount, modifiers,
            buttons = button == "none" || type == "mouseReleased" ? 0 : button switch { "right" => 2, "middle" => 4, _ => 1 },
            deltaX = type == "mouseWheel" ? deltaX : (double?)null,
            deltaY = type == "mouseWheel" ? deltaY : (double?)null,
        });

    [McpServerTool(Name = "click"), Description("Click an element (CSS selector, scrolled into view) or a point (x,y in CSS pixels).")]
    public static Task<string> Click(
        [Description("CSS selector")] string? selector = null,
        [Description("X in CSS pixels")] double? x = null,
        [Description("Y in CSS pixels")] double? y = null,
        [Description("left, right or middle")] string button = "left",
        [Description("2 for double-click")] int clickCount = 1,
        [Description("Modifier keys: alt, ctrl, meta, shift")] string[]? modifiers = null) => Tool.Run(async () =>
    {
        var (px, py) = await Point(selector, x, y);
        var mods = Modifiers(modifiers);
        await Mouse("mouseMoved", px, py, modifiers: mods);
        for (int i = 1; i <= Math.Max(1, clickCount); i++)
        {
            await Mouse("mousePressed", px, py, button, i, mods);
            await Mouse("mouseReleased", px, py, button, i, mods);
        }
        return new { clicked = new { x = px, y = py }, button, clickCount };
    });

    [McpServerTool(Name = "hover"), Description("Move the mouse over an element or point.")]
    public static Task<string> Hover(
        [Description("CSS selector")] string? selector = null,
        [Description("X in CSS pixels")] double? x = null,
        [Description("Y in CSS pixels")] double? y = null) => Tool.Run(async () =>
    {
        var (px, py) = await Point(selector, x, y);
        await Mouse("mouseMoved", px, py);
        return new { hovered = new { x = px, y = py } };
    });

    [McpServerTool(Name = "type_text"), Description("Type text into the focused element, or focus the element matching the selector first (clicks it).")]
    public static Task<string> TypeText(
        [Description("Text to insert")] string text,
        [Description("Optional CSS selector to click/focus first")] string? selector = null,
        [Description("Clear the element's current value first")] bool clear = false) => Tool.Run(async () =>
    {
        if (selector != null)
        {
            await Click(selector);
            if (clear)
                await Host.Eval($"(() => {{ const el = document.querySelector({Tool.Js(selector)}); if (el && 'value' in el) {{ el.value = ''; el.dispatchEvent(new Event('input', {{ bubbles: true }})); }} else if (el?.isContentEditable) el.textContent = ''; }})()");
        }
        await Host.Form.Cdp("Input.insertText", new { text });
        return new { typed = text.Length };
    });

    [McpServerTool(Name = "press_key"), Description("Press a key with optional modifiers, e.g. Enter, Escape, Tab, Backspace, ArrowUp, F5, 'a'. Repeat with 'count'.")]
    public static Task<string> PressKey(
        [Description("Key name (Enter, Escape, Tab, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space, F1-F12) or a single character")] string key,
        [Description("Modifier keys: alt, ctrl, meta, shift")] string[]? modifiers = null,
        [Description("How many times to press")] int count = 1) => Tool.Run(async () =>
    {
        Host.Form.EnsureResponsive();
        var mods = Modifiers(modifiers);
        var (k, code, vk, text) = KeyInfo(key, (mods & 8) != 0);
        if ((mods & ~8) != 0) text = null;
        for (int i = 0; i < Math.Max(1, count); i++)
        {
            await Host.Form.Cdp("Input.dispatchKeyEvent", new { type = text != null ? "keyDown" : "rawKeyDown", key = k, code, windowsVirtualKeyCode = vk, nativeVirtualKeyCode = vk, modifiers = mods, text, unmodifiedText = text });
            await Host.Form.Cdp("Input.dispatchKeyEvent", new { type = "keyUp", key = k, code, windowsVirtualKeyCode = vk, nativeVirtualKeyCode = vk, modifiers = mods });
        }
        return new { pressed = k, modifiers, count };
    });

    [McpServerTool(Name = "scroll"), Description("Scroll with the mouse wheel at an element or point (default: centre of the page). Positive deltaY scrolls down.")]
    public static Task<string> Scroll(
        [Description("Vertical pixels (positive = down)")] double deltaY = 400,
        [Description("Horizontal pixels (positive = right)")] double deltaX = 0,
        [Description("CSS selector to scroll over")] string? selector = null,
        [Description("X in CSS pixels")] double? x = null,
        [Description("Y in CSS pixels")] double? y = null) => Tool.Run(async () =>
    {
        double px, py;
        if (selector == null && x == null)
        {
            Host.Form.EnsureResponsive();
            var c = await Host.Eval("({ x: innerWidth / 2, y: innerHeight / 2 })");
            (px, py) = ((double)c!["x"]!, (double)c["y"]!);
        }
        else (px, py) = await Point(selector, x, y);
        await Mouse("mouseWheel", px, py, deltaX: deltaX, deltaY: deltaY);
        return new { scrolled = new { deltaX, deltaY }, at = new { x = px, y = py } };
    });

    static (string Key, string Code, int Vk, string? Text) KeyInfo(string key, bool shift)
    {
        switch (key.ToLowerInvariant())
        {
            case "enter": case "return": return ("Enter", "Enter", 13, "\r");
            case "tab": return ("Tab", "Tab", 9, null);
            case "escape": case "esc": return ("Escape", "Escape", 27, null);
            case "backspace": return ("Backspace", "Backspace", 8, null);
            case "delete": case "del": return ("Delete", "Delete", 46, null);
            case "space": case " ": return (" ", "Space", 32, " ");
            case "arrowup": case "up": return ("ArrowUp", "ArrowUp", 38, null);
            case "arrowdown": case "down": return ("ArrowDown", "ArrowDown", 40, null);
            case "arrowleft": case "left": return ("ArrowLeft", "ArrowLeft", 37, null);
            case "arrowright": case "right": return ("ArrowRight", "ArrowRight", 39, null);
            case "home": return ("Home", "Home", 36, null);
            case "end": return ("End", "End", 35, null);
            case "pageup": return ("PageUp", "PageUp", 33, null);
            case "pagedown": return ("PageDown", "PageDown", 34, null);
            case "insert": return ("Insert", "Insert", 45, null);
        }
        if (key.Length >= 2 && (key[0] == 'F' || key[0] == 'f') && int.TryParse(key[1..], out var fn) && fn is >= 1 and <= 12)
            return ($"F{fn}", $"F{fn}", 111 + fn, null);
        if (key.Length == 1)
        {
            var ch = key[0];
            var text = shift ? char.ToUpperInvariant(ch).ToString() : ch.ToString();
            if (char.IsLetter(ch)) return (text, "Key" + char.ToUpperInvariant(ch), char.ToUpperInvariant(ch), text);
            if (char.IsDigit(ch)) return (text, "Digit" + ch, ch, text);
            return (text, "", 0, text);
        }
        throw new ArgumentException($"Unknown key '{key}'.");
    }
}
