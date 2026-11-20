namespace GameWindow;

static class BridgeDocs
{
    public const string Instructions = """
        GameWindow is a blank desktop window (Chromium via WebView2) that you extend live. Never rebuild or restart the exe to add or change features.
        Workflow: call status, then bridge_api (module contract + native API). Add features with write_module (JS ES module + optional CSS); it hot-reloads and persists.
        After each change, verify with screenshot and get_errors; test interactions with click/type_text/press_key. Use eval_js for quick inspection.
        Native needs (files, processes, HTTP without CORS, window, clipboard, dialogs, notifications) go through api.host inside modules.
        If the page hangs, call reset_webview. Broken module: revert_module or disable_module.
        """;

    public const string Reference = """
        # GameWindow module reference

        ## Files
        - Modules/<name>.js (+ optional <name>.css): one feature each. Served at /Modules/<name>.js.
        - Assets/...: images, data, libraries (add_library downloads into Assets/lib). Served at /Assets/...
        - Import other files with ABSOLUTE paths, e.g. `import confetti from '/Assets/lib/confetti.mjs'`.
        - Shell/index.html + Shell/loader.js: the page shell. Normally leave alone; edits reload the page.

        ## Module contract
        ```js
        export const order = 0;            // optional: lower mounts first / appears first in #app
        export default {
          mount(root, api) {               // root = this module's own <div class="lw-module" data-module="name"> inside #app
            const btn = document.createElement('button');
            btn.textContent = 'Hi';
            root.append(btn);
            const off = api.bus.on('tick', (n) => api.log('tick', n));   // auto-removed on unmount
            const t = setInterval(() => api.bus.emit('tick', Date.now()), 1000);
            return () => clearInterval(t); // cleanup: runs before hot reload, disable, delete and shutdown
          }
        };
        ```
        `export default async function (root, api) {...}` also works. mount may be async.
        Anything global you create (window listeners, timers, elements outside root, intervals) MUST be undone in cleanup or api.onDispose,
        because hot reload mounts a fresh copy. Errors in mount are caught and shown in an overlay; other modules keep running.
        Page defaults: dark theme, CSS variables --lw-bg, --lw-fg, --lw-muted, --lw-accent, --lw-error, --lw-surface, --lw-border.

        ## api (per module)
        - api.name                         module name
        - api.root                         same as root
        - api.log(...args)                 console.log prefixed with [name] (captured; see get_console)
        - api.bus.on(event, fn) -> off     shared event bus between modules (auto-unsubscribed on unmount)
        - api.bus.emit(event, data)
        - api.storage.get(key) / set(key, value) / delete(key) / list()   persistent JSON store (Promises)
        - api.onDispose(fn)                register extra cleanup
        - api.asset(path)                  -> '/Assets/' + path
        - api.host                         native bridge (below). api.host.on(event, fn) -> off (auto-removed on unmount)

        ## api.host (all methods return Promises; relative paths resolve against the program folder)
        fs:
          fs.read(path) -> string                fs.readBytes(path) -> base64
          fs.write(path, text)                   fs.writeBytes(path, base64)          fs.append(path, text)
          fs.list(dir='.', pattern='*', recursive=false) -> [{name,path,isDir,size,modified}]
          fs.delete(path, recursive=false)       fs.exists(path)    fs.mkdir(path)    fs.stat(path)
          fs.copy(src, dst, overwrite=false)     fs.move(src, dst, overwrite=false)
          fs.watch(path, recursive=false) -> id  (events 'fs.change' {id,kind,path,oldPath})   fs.unwatch(id)
        http:
          http.fetch(url, {method, headers, body (string or object -> JSON), bodyBase64, responseType:'text'|'json'|'base64', timeoutMs, stream})
            -> {status, statusText, ok, headers, body}
            stream:true -> {id, status, headers} then events 'http.chunk' {id,text} and 'http.end' {id,error}; http.abort(id)
            No CORS limits, e.g. Ollama: api.host.http.fetch('http://localhost:11434/api/generate', {method:'POST', body:{model, prompt, stream:false}, responseType:'json'})
        process (children are killed when the window closes):
          process.start(file, args[] | argString, {cwd, env, stream=true}) -> {id, pid}
            events 'process.output' {id, stream:'stdout'|'stderr', text} and 'process.exit' {id, exitCode}
          process.exec(file, args, {cwd, stdin, timeoutMs=60000}) -> {exitCode, timedOut, stdout, stderr}
          process.write(id, text)   process.closeInput(id)   process.kill(id)   process.list()   process.output(id, since=0)
        window:
          window.get()   window.set({title, bounds:{x,y,width,height}, state:'normal'|'minimized'|'maximized', topmost, opacity, fullscreen})
          window.title(t?)   window.bounds({x,y,width,height}?)   window.state(s)   window.topmost(bool)   window.opacity(n)
          window.fullscreen(bool)   window.focus()   window.flash()
          window.close()            quit the program (normal shutdown; JS window.close() does the same)
        clipboard: clipboard.readText()  clipboard.writeText(t)  clipboard.readImage() -> base64 png|null  clipboard.writeImage(base64)
        dialog:
          dialog.openFile({title, filter:'Images|*.png;*.jpg|All|*.*', multiple, initialDir}) -> path | paths[] | null
          dialog.saveFile({title, filter, defaultName, initialDir}) -> path | null
          dialog.pickFolder({title, initialDir}) -> path | null
          dialog.message(text, {title, buttons:'ok'|'okcancel'|'yesno'|'yesnocancel'|'retrycancel', icon:'info'|'warning'|'error'|'question'}) -> 'ok'|'cancel'|'yes'|'no'|...
        notify(title, body)          Windows notification
        shell.open(urlOrPath)        open in the default browser/app (not killed with the window)
        host.info()  host.methods()  api.host.call('method.name', ...args) for any method by name

        Other host events: 'storage.changed' {key} (when changed via MCP), 'asset.changed' {path}.

        ## Blank window
        The page starts empty. Every feature is a module you add with write_module. Do not edit the exe,
        and do not restart the program to add or change a feature. Hot reload applies the module immediately
        and the files in Modules/ persist, so the same features come back the next time the window is opened.
        Child processes started with process.start / start_process are killed when the window closes.
        shell.open is the exception: it opens the user's browser or default app outside the window's job.

        ## Debugging
        window.__lw = { records, bus, call, reload(name), disposeAll() } in eval_js.
        """;
}
