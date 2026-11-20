using System.ComponentModel;
using ModelContextProtocol.Server;

namespace GameWindow.Tools;

[McpServerToolType]
public sealed class ModuleTools
{
    static async Task<object> AfterChange(string name, DateTime sinceUtc, string action)
    {
        if (!Host.Form.PageReady)
            return new { name, action, status = "pending", note = "Saved; the page is not ready yet, so it will load when the page finishes loading." };
        var st = await Host.Modules.WaitForStatus(name, sinceUtc, 3000);
        if (st == null)
            return new { name, action, status = "unknown", note = "Saved, but the page did not report back within 3 s. Check status or get_errors." };
        return new { name, action, status = st.Status, error = st.Error };
    }

    [McpServerTool(Name = "list_modules", ReadOnly = true), Description("List feature modules with enabled flag, load status (running/errored/disabled), and last load or runtime error.")]
    public static Task<string> ListModules() => Tool.Run(() => Host.Modules.List());

    [McpServerTool(Name = "read_module", ReadOnly = true), Description("Read a module's JavaScript and CSS source.")]
    public static Task<string> ReadModule([Description("Module name")] string name) => Tool.Run(() =>
    {
        var (js, css) = Host.Modules.Read(name);
        var st = Host.Modules.GetStatus(name);
        return new { name, enabled = !Host.State.IsDisabled(name), status = st?.Status, error = st?.Error, runtimeError = st?.RuntimeError, js, css };
    });

    [McpServerTool(Name = "write_module", Destructive = true), Description(
        "Create or replace a feature module; it hot-reloads in the running window and persists across restarts. " +
        "JS must be an ES module: `export default { mount(root, api) { ...; return () => { /* cleanup */ } } }` (optional `export const order = 0`). " +
        "Call bridge_api for the full api reference. Returns the load status reported by the page, including any error.")]
    public static Task<string> WriteModule(
        [Description("Module name: letters, digits, '_' or '-'")] string name,
        [Description("Full JavaScript ES module source")] string js,
        [Description("Optional CSS. Omit to keep the existing stylesheet; pass an empty string to remove it.")] string? css = null) => Tool.Run(async () =>
    {
        var since = DateTime.UtcNow;
        Host.Modules.Write(name, js, css);
        return await AfterChange(name, since, "written");
    });

    [McpServerTool(Name = "patch_module", Destructive = true), Description("Find-and-replace inside a module's JS or CSS. The find text must match exactly once unless replaceAll is true. Hot-reloads and returns the load status.")]
    public static Task<string> PatchModule(
        [Description("Module name")] string name,
        [Description("Exact text to find")] string find,
        [Description("Replacement text")] string replace,
        [Description("'js' (default) or 'css'")] string file = "js",
        [Description("Replace every occurrence")] bool replaceAll = false) => Tool.Run(async () =>
    {
        var since = DateTime.UtcNow;
        var count = Host.Modules.Patch(name, find, replace, file, replaceAll);
        var result = await AfterChange(name, since, $"patched ({count} replacement{(count == 1 ? "" : "s")})");
        return result;
    });

    [McpServerTool(Name = "rename_module", Destructive = true), Description("Rename a module (files, history and enabled flag move with it).")]
    public static Task<string> RenameModule([Description("Current name")] string from, [Description("New name")] string to) => Tool.Run(async () =>
    {
        var since = DateTime.UtcNow;
        Host.Modules.Rename(from, to);
        return await AfterChange(to, since, $"renamed from {from}");
    });

    [McpServerTool(Name = "delete_module", Destructive = true), Description("Delete a module. Its cleanup runs and it is removed from the page. A copy is kept in history, so revert_module can bring it back.")]
    public static Task<string> DeleteModule([Description("Module name")] string name) => Tool.Run(() =>
    {
        Host.Modules.Delete(name);
        return new { name, deleted = true, restoreWith = $"revert_module(name: \"{name}\")" };
    });

    [McpServerTool(Name = "enable_module"), Description("Enable a disabled module and load it.")]
    public static Task<string> EnableModule([Description("Module name")] string name) => Tool.Run(async () =>
    {
        if (!Host.Modules.Exists(name)) throw new FileNotFoundException($"Module '{name}' does not exist.");
        var since = DateTime.UtcNow;
        Host.State.SetDisabled(name, false);
        Host.Modules.NotifyChanged(name);
        return await AfterChange(name, since, "enabled");
    });

    [McpServerTool(Name = "disable_module"), Description("Disable a module without deleting it: runs its cleanup and removes it from the page; stays disabled across restarts.")]
    public static Task<string> DisableModule([Description("Module name")] string name) => Tool.Run(async () =>
    {
        if (!Host.Modules.Exists(name)) throw new FileNotFoundException($"Module '{name}' does not exist.");
        var since = DateTime.UtcNow;
        Host.State.SetDisabled(name, true);
        Host.Modules.NotifyChanged(name);
        return await AfterChange(name, since, "disabled");
    });

    [McpServerTool(Name = "module_history", ReadOnly = true), Description("List saved versions of a module (newest first). Every write, patch, revert and delete saves the previous version.")]
    public static Task<string> ModuleHistory([Description("Module name")] string name) =>
        Tool.Run(() => new { name, versions = Host.Modules.Versions(name), limit = ModuleStore.HistoryLimit });

    [McpServerTool(Name = "revert_module", Destructive = true), Description("Restore a module to a saved version (default: the most recent saved version). The current files are saved first, so a revert can itself be reverted.")]
    public static Task<string> RevertModule(
        [Description("Module name")] string name,
        [Description("Version id from module_history; omit for the most recent")] string? version = null) => Tool.Run(async () =>
    {
        var since = DateTime.UtcNow;
        var restored = Host.Modules.Revert(name, version);
        return await AfterChange(name, since, $"reverted to {restored}");
    });
}
