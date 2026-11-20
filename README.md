# Multiplayer Game Development

Shared GameWindow editor for building multiplayer game scenes (parts, Scripts, Live Mode, in-editor Assistant).  
**Repo:** https://github.com/Born0fMaya/MultiplayerGameDevelopment.git

> **For AI agents:** Read this file first on every session. Treat it as the project map and the shared notebook between collaborators’ agents. When you learn something durable (setup gotcha, architecture change, collab rule, “do not touch”), **update this README** in the same change so the other side stays in sync.

---

## Quick setup (Windows)

1. Install [.NET SDK](https://dotnet.microsoft.com/download) (project targets `net10.0-windows`) and WebView2 (usually already on Windows 11).
2. Clone and enter the repo:

```powershell
git clone https://github.com/Born0fMaya/MultiplayerGameDevelopment.git
cd MultiplayerGameDevelopment
```

3. Build and run from the repo root (so `Modules/`, `Shell/`, `Assets/` resolve correctly):

```powershell
dotnet publish .\src\GameWindow\GameWindow.csproj -c Release -o .\publish --self-contained true -p:PublishSingleFile=true
Copy-Item .\publish\GameWindow.exe .\GameWindow.exe -Force
.\GameWindow.exe
```

Alternate (dev):

```powershell
dotnet build .\src\GameWindow\GameWindow.csproj -c Release
# If the path has spaces, quote --root:
$root = (Get-Location).Path
$exe = ".\src\GameWindow\bin\Release\net10.0-windows\win-x64\GameWindow.exe"
Start-Process -FilePath $exe -ArgumentList "--root `"$root`"" -WorkingDirectory $root
```

4. Open Cursor / your agent on the **repo root**, not a subfolder.

### Optional local tools

- **Ollama** at `http://localhost:11434` — powers the in-editor Assistant when available.
- Firewall: inbound allow for `GameWindow.exe` so LAN collaborators can reach port **5282**.

---

## Project map

| Path | Role |
|------|------|
| `src/GameWindow/` | C# host (WinForms + WebView2). MCP on **5281** (loopback). Collab HTTP on **5282** (LAN). |
| `Modules/` | Editor UI modules (`viewport`, `explorer`, `toolbar`, `project`, `assistant`, …). Hot-reloaded from disk. |
| `Shell/` | HTML/JS shell the host loads. |
| `Assets/` | Shared libs (Three.js, Cannon physics helpers, Lua/runtime). |
| `Projects/` | Saved `.json` scenes. |
| `Storage/` | Local machine state (not for sharing secrets; mostly gitignored). |
| `Logs/` | Host logs (gitignored). |
| `.cursor/rules/` | Always-on Cursor rules for this workspace. |

Do **not** commit: `bin/`, `obj/`, `*.exe`, `Logs/`, most of `Storage/`, `publish*`.

---

## Online multiplayer collaboration

Local shared-folder collab is replaced by **IP + Connect**:

1. Host opens a project in GameWindow.
2. Host opens the presence menu (username/color) — note **Your IP** (port **5282**).
3. Guest enters that IP and clicks **Connect**.
4. Guests sync project + presence over HTTP (`CollabHost`).

Key pieces:

- `src/GameWindow/CollabHost.cs` — LAN server on `0.0.0.0:5282`
- `Modules/toolbar.js` — Host IP field + Connect/Disconnect on the presence menu
- `Modules/project.js` — remote sync when connected; host writes `Storage/collab-active.json`

Endpoints (host): `/collab/info`, `/collab/project`, `/collab/session/{id}`

Guest connections use the host HTTP bridge (`api.host.http.fetch`), not browser `fetch`, because the shell is `https://app.local` and Chromium blocks mixed-content `http://` calls to public IPs.

**Public internet:** host must port-forward TCP **5282** on the router to the host PC. Without that, Connect times out even after the mixed-content fix.

---

## Agent rules (both collaborators)

1. **README is shared memory** — read it at session start; update it when you change scope, setup, or hard rules.
2. **In-editor Assistant prompts** must sound like a non-coder (plain English). See `.cursor/rules/assistant-plain-english-prompts.mdc`. Never put API names, file paths, or implementation recipes into Assistant prompts.
3. Prefer local Ollama (`http://localhost:11434`) for in-editor Assistant paths when available.
4. Public inspector-facing values in S&box-related work should use `[Property]` when that stack is in play (see user/workspace guides).
5. Don’t force-push `main`. Don’t commit secrets, WebView2 profiles, or local session junk.
6. After host C# changes, republish/restart `GameWindow.exe`. Module-only JS/CSS changes usually hot-reload.

### Hard “do not touch” notes

- Keep durable “do not change” items listed here as they appear so both agents see them.
- (Add new hard rules below this line.)

---

## Working together

- Default branch: `main`
- Pull before starting work; push when a change is ready for the other person.
- Prefer small commits with a clear why.
- If your agent changes architecture or setup, update **this README in the same PR/commit**.

### Agent handoff checklist

When finishing a session, leave the next agent (or the sibling’s agent) with:

- What changed
- How to verify (build/run/collab connect)
- Anything still broken
- README updated if scope/rules changed
