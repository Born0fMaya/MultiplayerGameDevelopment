# Multiplayer Game Development (GameWindow)

Shared Windows desktop editor for building multiplayer game scenes (parts, Scripts, Live Mode, in-editor Assistant) with **live hot-reload** and an embedded **MCP server** so AI agents can edit and test the running app.

**Repo:** https://github.com/Born0fMaya/MultiplayerGameDevelopment.git  
**Default branch:** `main`

> **For AI agents (read first every session)**  
> This README is the project map and the shared notebook between collaborators’ agents — **any** agent (Cursor, Claude Desktop, custom scripts, etc.), not only Cursor.  
> When you learn something durable (setup gotcha, architecture change, collab rule, hard “do not touch”), **update this file in the same change**.  
> Call MCP `status` first when GameWindow is running. Prefer live MCP edits over guessing from disk alone.
>
> **Cursor-specific vs universal**  
> - **Universal:** architecture, setup/build, Modules hot-reload, collab share-link flow, version bumps, and the entire MCP tool catalog against `http://127.0.0.1:5281/mcp`.  
> - **Cursor-only conveniences:** `.cursor/mcp.json` and `.cursor/rules/` — other agents should point their own MCP client at the same URL and still follow the rules written in this README (including plain-English in-editor Assistant prompts).

---

## What this program is

- **Host:** `GameWindow.exe` — C# WinForms + WebView2 (Chromium), loads `https://app.local/Shell/index.html` mapped to the repo root.
- **Features:** ES modules under `Modules/` (viewport, explorer, toolbar, project, assistant, …). Edit them on disk or via MCP; they **hot-reload** without restarting the exe.
- **Live Mode:** Play/Stop in the toolbar; Lua scripts run in the viewport runtime.
- **Online collab:** Host shares a Cloudflare tunnel link; guests Connect with that link (no router port-forward required).
- **Version badge:** Bottom-right of the UI shows `vX.Y.Z` from `<Version>` in `src/GameWindow/GameWindow.csproj`. **Bump this on every patch**, then rebuild/restart the host so the badge updates.

### Ports

| Port | Bind | Purpose |
|------|------|---------|
| **5281** | loopback only | MCP HTTP endpoint `http://127.0.0.1:5281/mcp` |
| **5282** | all interfaces | Collab HTTP API (`/collab/info`, `/collab/project`, `/collab/session/{id}`) |

Cursor MCP config (repo `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "game-window": {
      "type": "http",
      "url": "http://127.0.0.1:5281/mcp",
      "headers": { "Accept": "application/json, text/event-stream" }
    }
  }
}
```

GameWindow must be **running** for MCP tools to work.

---

## Quick setup (Windows)

1. Install [.NET SDK](https://dotnet.microsoft.com/download) (targets `net10.0-windows`) and WebView2 (usually present on Windows 11).
2. Clone:

```powershell
git clone https://github.com/Born0fMaya/MultiplayerGameDevelopment.git
cd MultiplayerGameDevelopment
```

3. Publish and run from the **repo root** (so `Modules/`, `Shell/`, `Assets/` resolve):

```powershell
dotnet publish .\src\GameWindow\GameWindow.csproj -c Release -o .\publish --self-contained true -p:PublishSingleFile=true
Copy-Item .\publish\GameWindow.exe .\GameWindow.exe -Force
# Build also ensures Tools\cloudflared.exe (bundled collab tunnel helper)
if (Test-Path .\publish\Tools\cloudflared.exe) {
  New-Item -ItemType Directory -Force -Path .\Tools | Out-Null
  Copy-Item .\publish\Tools\cloudflared.exe .\Tools\cloudflared.exe -Force
}
.\GameWindow.exe
```

Dev alternate (quote `--root` if the path has spaces):

```powershell
dotnet build .\src\GameWindow\GameWindow.csproj -c Release
$root = (Get-Location).Path
$exe = ".\src\GameWindow\bin\Release\net10.0-windows\win-x64\GameWindow.exe"
Start-Process -FilePath $exe -ArgumentList "--root `"$root`"" -WorkingDirectory $root
```

4. Open Cursor / your agent on the **repo root**, not a subfolder.
5. Confirm MCP: with GameWindow open, call `status`.

### Optional

- **Ollama** at `http://localhost:11434` — in-editor Assistant.
- Firewall allow inbound for collab on **5282** only matters for raw public-IP hosting (tunnel avoids this).

---

## Project map

| Path | Role |
|------|------|
| `src/GameWindow/` | C# host, MCP tools, CollabHost, CollabTunnel, HostBridge |
| `Modules/` | Live editor features (`*.js` + optional `*.css`). Hot-reloaded. |
| `Shell/` | `index.html` + `loader.js` — page shell (`https://app.local/...`) |
| `Assets/` | Libraries (Three.js, physics, Lua helpers). Served at `/Assets/...` |
| `Projects/` | Saved scene JSON |
| `Tools/` | Bundled helpers (`cloudflared.exe`). Fetched on build / first run — not committed |
| `Storage/` | Local state (mostly gitignored) |
| `Logs/` | `host.log` (gitignored) |
| `.cursor/rules/` | Always-on Cursor rules |
| `.cursor/mcp.json` | MCP server URL for Cursor |

**Do not commit:** `bin/`, `obj/`, `*.exe`, `Logs/`, most of `Storage/`, `publish*`, `Tools/*.exe`, session folders (`*.sessions/`).

### Key modules (live UI)

| Module | Responsibility |
|--------|----------------|
| `viewport` | 3D scene, tools, physics, Live Mode camera/pawn |
| `project` | Open/save project, undo, presence, **online collab connect/sync** |
| `toolbar` | Tools ribbon, Play/Stop, **presence menu + share link + Connect** |
| `explorer` / `properties` / `taskbar` | Hierarchy, inspectors, bottom toggles |
| `menu-bar` | File/Edit/View |
| `assistant` | In-editor local AI (Ollama) |
| `script-editor` / `script-runtime` | Script editing + Lua live runtime |
| `chat` | Collab chat |

---

## How to edit the *live* program (agent workflow)

**Golden rule:** Do **not** rebuild/restart the exe to change JS/CSS modules. Hot-reload applies them. Rebuild only when you change C# host code, ship a new version badge, or need a new published `GameWindow.exe`.

### Recommended session flow

1. Ensure GameWindow is running; call MCP **`status`**.
2. Call **`bridge_api`** before writing new modules (contract + `api.host` reference).
3. Inspect with **`list_modules`**, **`read_module`**, **`get_errors`**, **`screenshot`**.
4. Change code with **`patch_module`** / **`write_module`** (or edit `Modules/*.js` on disk — host watches and reloads).
5. Verify with **`screenshot`**, **`get_errors`**, **`get_console`**; interact with **`click`** / **`type_text`** / **`press_key`** / **`eval_js`**.
6. If the page hangs: **`reset_webview`**. If a module is broken: **`revert_module`** or **`disable_module`**.
7. When done: bump `<Version>` if this was a patch, update this README if scope/rules changed, commit/push.

### What hot-reloads vs what needs rebuild

| Change | How it applies |
|--------|----------------|
| `Modules/*.js`, `Modules/*.css` | Auto hot-reload (or `reload_module` / `patch_module`) |
| `Shell/index.html`, `Shell/loader.js` | `reload_page` (or save triggers shell watcher) |
| `Assets/**` | Available at `/Assets/...`; may need module reload if already imported |
| `src/GameWindow/**/*.cs` | **Must** `dotnet publish`, replace `GameWindow.exe`, restart |
| Version badge | Bump csproj `<Version>`, rebuild + restart |

### Module contract (summary)

```js
export const order = 0; // lower mounts first
export default {
  mount(root, api) {
    // build UI under root; use api.bus, api.host, api.storage
    return () => { /* cleanup timers, listeners, DOM outside root */ };
  }
};
```

- Import assets with **absolute** paths: `import x from '/Assets/lib/...'`.
- Cleanup is mandatory on hot reload (return cleanup from `mount` and/or `api.onDispose`).
- Full reference: MCP tool **`bridge_api`**.

### Editing C# host

After changing host code:

```powershell
# Close GameWindow first (file lock on GameWindow.exe)
dotnet publish .\src\GameWindow\GameWindow.csproj -c Release -o .\publish --self-contained true -p:PublishSingleFile=true
Copy-Item .\publish\GameWindow.exe .\GameWindow.exe -Force
Copy-Item .\publish\Tools\cloudflared.exe .\Tools\cloudflared.exe -Force
.\GameWindow.exe
```

Paths with spaces: always quote `--root` when launching the bin exe.

---

## Online multiplayer collaboration

### Host (share)

1. Open a **saved project** in GameWindow.
2. Open the presence menu (users control next to Play/Stop).
3. Copy **Send this to friends** (Cloudflare `https://….trycloudflare.com` share link).  
   Do **not** put your own share link in the join field.
4. Bundled `Tools/cloudflared.exe` starts with CollabHost and **stops when GameWindow exits**.

### Guest (join)

1. Paste the host’s **full** share link into **Friend’s share link or IP**.
2. Click **Connect**.
3. Guests sync via `api.host.http.fetch` (not browser `fetch`) to avoid `https://app.local` mixed-content blocks.

### Implementation map

| Piece | Role |
|-------|------|
| `CollabHost.cs` | HTTP server on `:5282` |
| `CollabTunnel.cs` | Spawns/kills bundled cloudflared quick tunnel |
| `Modules/project.js` | Connect/disconnect, remote project + presence sync |
| `Modules/toolbar.js` | Share link UI + Connect |
| `Storage/collab-active.json` | Which project the host is serving (local) |

Endpoints: `GET /collab/info`, `GET|PUT /collab/project`, `POST|DELETE /collab/session/{id}`

**Third-party helpers rule:** Anything required at runtime (e.g. cloudflared) must be **bundled or auto-fetched into the app tree**, run as a **child of GameWindow**, and **die when GameWindow closes**. Do not tell users to install Cloudflare separately as the primary path.

**Public IP without tunnel:** needs router TCP **5282** → host LAN IP. Many Xfinity gateways only allow that via the account holder’s Xfinity app — prefer the share link.

Share links **change each GameWindow restart** (quick tunnel).

---

## MCP tools (complete catalog)

Connect to `http://127.0.0.1:5281/mcp` while GameWindow is running. Tool names below are the MCP `Name` values.

### Session / diagnostics (start here)

| Tool | What it does | How to use |
|------|----------------|------------|
| **`status`** | Health overview: version, uptime, page ready/responsive, Chromium, modules + errors, child processes, memory, MCP/job state | Call **first** every session |
| **`host_log`** | Tail of `Logs/host.log` | `tail` (default 100) — startup, crashes, tool errors |
| **`bridge_api`** | Module contract + full `api` / `api.host` reference + registered host methods | Read **before** writing modules |
| **`get_errors`** | Module load/runtime failures, recent console errors, page/WebView/MCP problems | After every risky change |
| **`get_console`** | Captured page console (log/info/warn/error/debug) | `since`, `level`, `max`, `clear` |
| **`open_devtools`** | Opens Chromium DevTools for the user | When human inspection helps |

### Modules (primary way to change the live app)

| Tool | What it does | How to use |
|------|----------------|------------|
| **`list_modules`** | Names, enabled, running/errored/disabled, errors | Survey current features |
| **`read_module`** | Full JS (+ CSS) source | `name` |
| **`write_module`** | Create/overwrite module JS (+ optional CSS); hot-reloads | `name`, `js`, optional `css` (omit keeps CSS; `""` removes) |
| **`patch_module`** | Exact find/replace in JS or CSS; hot-reloads | `name`, `find`, `replace`, `file`=`js`\|`css`, `replaceAll` |
| **`rename_module`** | Rename module files + history + enabled flag | `from`, `to` |
| **`delete_module`** | Remove module (history kept) | `name` — recoverable via `revert_module` |
| **`enable_module`** / **`disable_module`** | Load or unload without deleting | `name` |
| **`module_history`** | Saved versions (newest first) | `name` |
| **`revert_module`** | Restore a saved version (current saved first) | `name`, optional `version` id |
| **`reload_module`** | Cleanup + re-import + remount one module | `name` |
| **`reload_page`** | Full page + all modules reload | `restoreDefaultShell` optional |
| **`reset_webview`** | Recover hung page; `hard=true` rebuilds WebView control | Prefer before restarting the exe |

### Page inspection & UI automation

| Tool | What it does | How to use |
|------|----------------|------------|
| **`screenshot`** | PNG of page, element, or full scrollable page | After every visual change |
| **`get_dom`** | Outer HTML of `html` or a selector | `selector`, `maxChars` |
| **`query`** | Match elements: tag, id, classes, text, visibility, bounds (max 50) | CSS `selector` |
| **`eval_js`** | Run JS in the page | Keep scripts self-contained; avoid `return` at top level unless wrapped; watch name clashes |
| **`wait_for`** | Wait for selector or truthy JS condition | `selector` and/or `condition`, `timeoutMs` |
| **`click`** | Click selector or `x,y` | `button`, `clickCount`, `modifiers` |
| **`hover`** | Move mouse to selector or point | |
| **`type_text`** | Type into focused element (optional click selector first) | `clear` to empty first |
| **`press_key`** | Key + modifiers, optional `count` | Enter, Escape, Tab, arrows, F-keys, chars |
| **`scroll`** | Wheel scroll at element/point | `deltaY` / `deltaX` |

### Assets

| Tool | What it does | How to use |
|------|----------------|------------|
| **`list_assets`** | List under `Assets/` | optional subfolder `path` |
| **`read_asset`** | Text or base64 | `path`, `base64` |
| **`write_asset`** | Create/overwrite | `path`, `text` or `base64` → returns URL |
| **`delete_asset`** | Delete file/folder under Assets | `path` |
| **`add_library`** | Download remote JS/CSS into `Assets/lib` | `url`, optional `path` |

### Window

| Tool | What it does | How to use |
|------|----------------|------------|
| **`get_window`** | Title, bounds, state, fullscreen, topmost, opacity, DPI | |
| **`set_window`** | Change only provided fields (some persist) | `title`, `x/y/width/height`, `state`, `topmost`, `opacity`, `fullscreen`, `focus` |

### Persistent storage (host key/value)

| Tool | What it does | How to use |
|------|----------------|------------|
| **`storage_list`** | List keys | Same store as `api.storage` |
| **`storage_get`** | Get value | `key` |
| **`storage_set`** | Set JSON value (or string if not JSON) | `key`, `value` |
| **`storage_delete`** | Delete key | `key` |

### Child processes

Children are killed when GameWindow closes (job object).

| Tool | What it does | How to use |
|------|----------------|------------|
| **`list_processes`** | Running / recent children | |
| **`start_process`** | Start owned child | `file`, `args[]`, `cwd`, `streamToPage` |
| **`process_output`** | Read buffered stdout/stderr | `id`, `since` |
| **`process_input`** | Write stdin | `id`, `text`, `close` |
| **`kill_process`** | Kill process tree | `id` |

### Practical MCP recipes

**Patch a live module and verify**

1. `read_module` / `status`
2. `patch_module` with a unique `find` string
3. `get_errors` → `screenshot`

**Debug a blank/broken UI**

1. `get_errors` → `get_console` → `host_log`
2. `screenshot` / `query`
3. `reset_webview` if unresponsive

**Troubleshoot collab (guest)**

1. `get_errors` / `get_console` after Connect  
2. `eval_js` only for inspection inside the page; network to hosts should go through the app’s host HTTP bridge (modules already do)  
3. Confirm host has a project open and sent a fresh share link  

**Do not** use MCP `eval_js` to reinvent collab fetches that the modules already perform via `api.host.http.fetch`.

---

## Agent rules (both collaborators)

1. **README is shared memory** — read at session start; update when durable facts change.
2. **In-editor Assistant prompts** must sound like a non-coder (plain English). See `.cursor/rules/assistant-plain-english-prompts.mdc`. No API names, file paths, or implementation recipes in Assistant prompts.
3. Prefer local Ollama (`http://localhost:11434`) for in-editor Assistant paths when available.
4. Don’t force-push `main`. Don’t commit secrets, WebView2 profiles, or local session junk.
5. After **C#** changes: republish/restart. Module-only JS/CSS: hot-reload.
6. **Bump `<Version>` in `GameWindow.csproj` every patch** so the bottom-right badge updates after rebuild.
7. Third-party runtime helpers: bundle/auto-fetch, child process, kill on exit.
8. Prefer small commits with a clear why; pull before starting work; push when ready for the other person.

### Hard “do not touch”

- Keep durable prohibitions listed here so both agents see them.
- (Add new hard rules below this line.)

---

## Working together / handoff

- Pull `main` before work; push when a change is ready for the sibling.
- If architecture or setup changes, update **this README in the same commit**.

### Handoff checklist

- What changed  
- How to verify (MCP `status` / screenshot / collab Connect)  
- Anything still broken  
- Version bumped? README updated?  

---

## Troubleshooting cheat sheet

| Symptom | Likely fix |
|---------|------------|
| MCP tools fail | Start GameWindow; confirm `http://127.0.0.1:5281/mcp` |
| Module error overlay | `get_errors`, `revert_module` / fix + `reload_module` |
| Page frozen | `reset_webview` (then `hard=true` if needed) |
| Guest Connect timeout | Host must have project open; send **current** tunnel share link; guest on latest code (host HTTP bridge) |
| Share link missing in UI | Wait a few seconds for tunnel; check `host_log` for “Collab tunnel ready” |
| `GameWindow.exe` locked on copy | Fully quit the app (not only kill renderer), then publish/copy |
| Version badge wrong | Bump csproj Version, republish, restart |
| Path with spaces + `--root` | Quote the root path in ProcessStartInfo / PowerShell |
