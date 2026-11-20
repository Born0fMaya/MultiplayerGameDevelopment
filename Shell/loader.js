// GameWindow shell loader: mounts every module in /Modules, hot-reloads them, and exposes the native bridge.
const wv = window.chrome?.webview;
const send = (msg) => { try { wv?.postMessage(msg); } catch { /* host gone */ } };

// ------------------------------------------------------------------ console + error capture
const fmt = (v) => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    send({ type: 'console', level, text: args.map(fmt).join(' ') });
  };
}
const moduleFrom = (text) => /\/Modules\/([A-Za-z0-9_-]+)\.js/.exec(text || '')?.[1] ?? null;
window.addEventListener('error', (e) => {
  const text = e.error?.stack || e.message;
  send({ type: 'console', level: 'error', text, source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null });
  const name = moduleFrom(e.filename) || moduleFrom(e.error?.stack);
  if (name) reportRuntime(name, text);
});
window.addEventListener('unhandledrejection', (e) => {
  const text = 'Unhandled rejection: ' + (e.reason?.stack || fmt(e.reason));
  send({ type: 'console', level: 'error', text });
  const name = moduleFrom(e.reason?.stack);
  if (name) reportRuntime(name, text);
});

// Suppress the Chromium/WebView2 default context menu everywhere in the app.
window.addEventListener('contextmenu', (e) => e.preventDefault(), true);

// ------------------------------------------------------------------ native bridge
let seq = 0;
const pending = new Map();
const hostListeners = new Map();

function call(method, ...args) {
  if (!wv) return Promise.reject(new Error('Not running inside GameWindow.'));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    wv.postMessage({ type: 'call', id, method, args });
  });
}

function onHost(event, fn) {
  let set = hostListeners.get(event);
  if (!set) hostListeners.set(event, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

function emitHost(event, data) {
  for (const fn of [...(hostListeners.get(event) ?? [])]) {
    try { fn(data); } catch (err) { console.error(`Handler for host event '${event}' failed`, err); }
  }
}

function methodProxy(path) {
  return new Proxy(function () {}, {
    get(_, key) { return typeof key === 'string' && key !== 'then' ? methodProxy(`${path}.${key}`) : undefined; },
    apply(_, __, args) { return call(path, ...args); },
  });
}

function makeHost(on) {
  const base = { call, on };
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key];
      return typeof key === 'string' && key !== 'then' ? methodProxy(key) : undefined;
    },
  });
}

wv?.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'result': {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
      break;
    }
    case 'event': emitHost(m.name, m.data); break;
    case 'module.changed': queueLoad(m.name); break;
    case 'asset.changed': emitHost('asset.changed', { path: m.path }); break;
  }
});

// ------------------------------------------------------------------ module bus
const busHandlers = new Map();
function busOn(event, fn) {
  let set = busHandlers.get(event);
  if (!set) busHandlers.set(event, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}
function busEmit(event, data) {
  for (const fn of [...(busHandlers.get(event) ?? [])]) {
    try { fn(data); } catch (err) { console.error(`Bus handler for '${event}' failed`, err); }
  }
}

// ------------------------------------------------------------------ modules
const app = document.getElementById('app');
const records = new Map();
const queues = new Map();

function queueLoad(name, preImport) {
  const next = (queues.get(name) ?? Promise.resolve())
    .then(() => load(name, preImport))
    .catch((err) => console.error(`Loader failure for ${name}`, err));
  queues.set(name, next);
  return next;
}

function importModule(name) {
  const p = import(`/Modules/${name}.js?v=${Date.now()}${Math.random().toString(36).slice(2, 7)}`);
  p.catch(() => {});
  return p;
}

const orderOf = (mod) => Number(mod?.order ?? mod?.default?.order ?? 0) || 0;

function makeApi(name, rec) {
  const scoped = (off) => { rec.disposers.push(off); return off; };
  return {
    name,
    root: rec.container,
    log: (...args) => console.log(`[${name}]`, ...args),
    bus: { on: (event, fn) => scoped(busOn(event, fn)), emit: busEmit },
    storage: {
      get: (key) => call('storage.get', key),
      set: (key, value) => call('storage.set', key, value),
      delete: (key) => call('storage.delete', key),
      list: () => call('storage.list'),
    },
    host: makeHost((event, fn) => scoped(onHost(event, fn))),
    onDispose: (fn) => { rec.disposers.push(fn); },
    asset: (path) => `/Assets/${path}`,
  };
}

function place(container, order, name) {
  container.dataset.order = String(order);
  const after = [...app.children].find((c) =>
    c.classList.contains('lw-module') &&
    (Number(c.dataset.order) > order || (Number(c.dataset.order) === order && c.dataset.module.localeCompare(name) > 0)));
  app.insertBefore(container, after ?? null);
}

function unmount(name) {
  const rec = records.get(name);
  if (!rec) return;
  records.delete(name);
  for (const fn of rec.disposers.reverse()) {
    try { fn(); } catch (err) { console.error(`[${name}] cleanup failed`, err); }
  }
  rec.container.remove();
  rec.link?.remove();
}

function report(name, status, error = null) {
  send({ type: 'module.status', name, status, error });
  updateOverlay();
}

function reportRuntime(name, text) {
  const rec = records.get(name);
  if (rec) rec.runtimeError = text;
  send({ type: 'module.error', name, error: text });
  updateOverlay();
}

async function load(name, preImport) {
  let info;
  try { info = await call('modules.info', name); }
  catch (err) { console.error(`Cannot query module ${name}`, err); return; }

  unmount(name);
  if (!info.exists) { report(name, 'removed'); return; }
  if (!info.enabled) { report(name, 'disabled'); return; }

  const container = document.createElement('div');
  container.className = 'lw-module';
  container.dataset.module = name;
  const rec = { name, container, link: null, disposers: [], status: 'loading', error: null, runtimeError: null };
  records.set(name, rec);

  try {
    const mod = await (preImport ?? importModule(name));
    place(container, orderOf(mod), name);
    if (info.hasCss) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/Modules/${name}.css?v=${Date.now()}`;
      link.dataset.module = name;
      document.head.appendChild(link);
      rec.link = link;
    }
    const def = mod.default;
    const mountFn = typeof def === 'function' ? def : def?.mount;
    if (typeof mountFn !== 'function')
      throw new Error('Module must `export default { mount(root, api) { ... } }` or `export default function (root, api) { ... }`.');
    const cleanup = await mountFn.call(def, container, makeApi(name, rec));
    if (typeof cleanup === 'function') rec.disposers.push(cleanup);
    rec.status = 'running';
    report(name, 'running');
  } catch (err) {
    rec.status = 'errored';
    rec.error = err?.stack || String(err);
    for (const fn of rec.disposers.splice(0).reverse()) {
      try { fn(); } catch { /* already failing */ }
    }
    container.replaceChildren();
    if (!container.isConnected) place(container, 0, name);
    console.error(`[${name}] failed to load:`, rec.error);
    report(name, 'errored', rec.error);
  }
}

// ------------------------------------------------------------------ error overlay
const overlay = document.createElement('div');
overlay.id = 'lw-overlay';
let dismissedSignature = null;

function updateOverlay() {
  const problems = [...records.values()].filter((r) => r.status === 'errored' || r.runtimeError);
  const signature = problems.map((r) => r.name + (r.error ?? '') + (r.runtimeError ?? '')).join('|');
  if (!problems.length || signature === dismissedSignature) { overlay.remove(); return; }

  const header = document.createElement('header');
  header.textContent = `Module error${problems.length > 1 ? 's' : ''}`;
  const close = document.createElement('button');
  close.textContent = '×';
  close.title = 'Dismiss';
  close.onclick = () => { dismissedSignature = signature; overlay.remove(); };
  header.append(close);

  const items = problems.map((r) => {
    const div = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = `${r.name} (${r.status === 'errored' ? 'failed to load' : 'runtime error'})`;
    const pre = document.createElement('pre');
    pre.textContent = r.error ?? r.runtimeError;
    div.append(title, pre);
    return div;
  });
  overlay.replaceChildren(header, ...items);
  if (!overlay.isConnected) document.body.appendChild(overlay);
}

// ------------------------------------------------------------------ startup
window.__lw = {
  records,
  bus: { on: busOn, emit: busEmit },
  call,
  host: makeHost(onHost),
  reload: (name) => queueLoad(name),
  disposeAll() { for (const name of [...records.keys()]) unmount(name); },
};

async function showVersion() {
  const el = document.getElementById('gw-version');
  if (!el) return;
  try {
    const info = await call('host.info');
    const ver = info?.version ? String(info.version) : '';
    el.textContent = ver ? `v${ver}` : '';
    el.title = ver ? `GameWindow ${ver}` : '';
  } catch {
    el.textContent = '';
  }
}

async function start() {
  showVersion();

  let list = [];
  try { list = await call('modules.list'); }
  catch (err) { console.error('Could not list modules', err); }

  const enabled = list.filter((m) => m.enabled);
  const imports = new Map(enabled.map((m) => [m.name, importModule(m.name)]));
  const ordered = await Promise.all(enabled.map(async (m) => {
    try { return { name: m.name, order: orderOf(await imports.get(m.name)) }; }
    catch { return { name: m.name, order: 0 }; }
  }));
  ordered.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  for (const { name } of ordered) await queueLoad(name, imports.get(name));
  for (const m of list.filter((x) => !x.enabled)) report(m.name, 'disabled');
  send({ type: 'ready' });
}

start();
