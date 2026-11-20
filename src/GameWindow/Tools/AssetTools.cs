using System.ComponentModel;
using ModelContextProtocol.Server;

namespace GameWindow.Tools;

[McpServerToolType]
public sealed class AssetTools
{
    [McpServerTool(Name = "list_assets", ReadOnly = true), Description("List files under Assets/ (served to the page at /Assets/...).")]
    public static Task<string> ListAssets([Description("Optional sub-folder, e.g. 'lib'")] string? path = null) =>
        Tool.Run(() => Host.Assets.List(path));

    [McpServerTool(Name = "read_asset", ReadOnly = true), Description("Read an asset as text, or as base64 for binary files.")]
    public static Task<string> ReadAsset([Description("Path relative to Assets/")] string path, [Description("Return base64 instead of text")] bool base64 = false) =>
        Tool.Run(() => Host.Assets.Read(path, base64));

    [McpServerTool(Name = "write_asset", Destructive = true), Description("Create or overwrite an asset file (images, JSON data, fonts, helper JS...). Pass text or base64. Returns the URL modules should use.")]
    public static Task<string> WriteAsset(
        [Description("Path relative to Assets/, e.g. 'img/logo.png'")] string path,
        [Description("Text content")] string? text = null,
        [Description("Binary content as base64")] string? base64 = null) =>
        Tool.Run(() => new { url = Host.Assets.Write(path, text, base64) });

    [McpServerTool(Name = "delete_asset", Destructive = true), Description("Delete an asset file or folder under Assets/.")]
    public static Task<string> DeleteAsset([Description("Path relative to Assets/")] string path) =>
        Tool.Run(() => new { path, deleted = Host.Assets.Delete(path) });

    [McpServerTool(Name = "add_library", OpenWorld = true), Description("Download a JS/CSS library (e.g. an ESM build from esm.sh, jsDelivr or unpkg) into Assets/lib so modules can import it locally and offline.")]
    public static Task<string> AddLibrary(
        [Description("URL to download")] string url,
        [Description("Optional destination relative to Assets/ (default lib/<file name>)")] string? path = null) =>
        Tool.Run(async () => await Host.Assets.AddLibrary(url, path));
}
