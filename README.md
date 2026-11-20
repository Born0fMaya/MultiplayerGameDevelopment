# Multiplayer Game Development

Local GameWindow editor and Live Mode runtime for building multiplayer game scenes with Scripts, parts, and an in-editor Assistant.

## What’s in this repo

- `src/GameWindow` — C# host (WinForms + WebView2)
- `Modules/` — editor UI modules (viewport, explorer, assistant, …)
- `Shell/` — HTML/JS shell loaded by the host
- `Assets/` — shared libraries (Three.js, physics, Lua runtime helpers)
- `Projects/` — sample project data

## Requirements

- Windows 10/11
- [.NET SDK](https://dotnet.microsoft.com/download) (for building the host)
- WebView2 runtime (usually already on Windows 11)

## Build & run

```powershell
dotnet build .\src\GameWindow\GameWindow.csproj
dotnet run --project .\src\GameWindow\GameWindow.csproj
```

Or open the solution/project in Visual Studio and run.

## Notes

- `Storage/` and `Logs/` are local runtime folders and are not committed.
- The in-editor Assistant talks to a local Ollama endpoint when configured.
