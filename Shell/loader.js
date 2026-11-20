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

function setUpdateState(state, label, title) {
  const bar = document.getElementById('gw-version-bar');
  const status = document.getElementById('gw-update-status');
  const btn = document.getElementById('gw-update');
  if (bar) bar.dataset.state = state || '';
  if (status && label != null) status.textContent = label;
  const tip = title ?? label;
  if (status && tip) status.title = tip;
  if (btn && tip) btn.title = tip;
}

async function gitExec(root, args, timeoutMs = 60_000) {
  return call('process.exec', 'git', args, { cwd: root, timeoutMs });
}

async function resolveGitRoot(root) {
  const top = await gitExec(root, ['rev-parse', '--show-toplevel'], 15_000);
  if ((top?.exitCode ?? 1) === 0) {
    const path = String(top.stdout || '').trim();
    if (path) return path;
  }
  return root;
}

async function fallbackCheck() {
  const info = await call('host.info');
  const root = await resolveGitRoot(info?.root);
  if (!root) throw new Error('Program folder unknown.');
  const head = await gitExec(root, ['rev-parse', 'HEAD'], 15_000);
  if ((head?.exitCode ?? 1) !== 0) throw new Error((head?.stderr || head?.stdout || 'Not a git repo.').trim());
  let upstream = '';
  const tracked = await gitExec(root, ['rev-parse', '--abbrev-ref', '@{u}'], 15_000);
  if ((tracked?.exitCode ?? 1) === 0) upstream = String(tracked.stdout || '').trim();
  if (!upstream) {
    const branch = await gitExec(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 15_000);
    const name = String(branch?.stdout || '').trim();
    upstream = name && name !== 'HEAD' ? `origin/${name}` : 'origin/main';
  }
  const remoteName = upstream.includes('/') ? upstream.split('/')[0] : 'origin';
  const fetched = await gitExec(root, ['fetch', '--quiet', '--prune', remoteName], 60_000);
  if (fetched?.timedOut) throw new Error('git fetch timed out.');
  if ((fetched?.exitCode ?? 1) !== 0) {
    throw new Error((fetched?.stderr || fetched?.stdout || 'git fetch failed.').trim().split(/\r?\n/).find(Boolean) || 'git fetch failed.');
  }
  const behindRun = await gitExec(root, ['rev-list', '--count', `HEAD..${upstream}`], 15_000);
  const aheadRun = await gitExec(root, ['rev-list', '--count', `${upstream}..HEAD`], 15_000);
  const behind = Number.parseInt(String(behindRun?.stdout || '0').trim(), 10) || 0;
  const ahead = Number.parseInt(String(aheadRun?.stdout || '0').trim(), 10) || 0;
  const latest = behind === 0;
  return {
    ok: true,
    latest,
    outdated: !latest,
    behind,
    ahead,
    upstream,
    message: latest
      ? (ahead > 0 ? `Latest remote — ${ahead} local commit(s) not pushed.` : "You're on the latest version.")
      : `Update available — ${behind} commit(s) behind.`,
  };
}

function missingGitMessage(err) {
  const text = String(err?.message || err || '');
  if (/cannot find the file|not found|No such file/i.test(text) && /git/i.test(text)) {
    return 'Git was not found on this PC. Install Git for Windows (git-scm.com) or GitHub Desktop, restart GameWindow, then try Update again. Newer builds can also update from GitHub without git.';
  }
  return text;
}

async function fallbackUpdate() {
  const info = await call('host.info');
  const root = await resolveGitRoot(info?.root);
  if (!root) throw new Error('Program folder unknown.');
  let before;
  try {
    before = await gitExec(root, ['rev-parse', 'HEAD'], 30_000);
  } catch (err) {
    throw new Error(missingGitMessage(err));
  }
  if ((before?.exitCode ?? 1) !== 0) {
    throw new Error(missingGitMessage({ message: (before?.stderr || before?.stdout || 'Not a git repo.').trim() }));
  }
  let pull;
  try {
    pull = await gitExec(root, ['pull', '--ff-only'], 120_000);
  } catch (err) {
    throw new Error(missingGitMessage(err));
  }
  if (pull?.timedOut) throw new Error('git pull timed out.');
  if ((pull?.exitCode ?? 1) !== 0) {
    throw new Error((pull?.stderr || pull?.stdout || 'git pull failed.').trim().split(/\r?\n/).find(Boolean) || 'git pull failed.');
  }
  const after = await gitExec(root, ['rev-parse', 'HEAD'], 30_000);
  const beforeHash = String(before?.stdout || '').trim();
  const afterHash = String(after?.stdout || '').trim();
  const text = `${pull?.stdout || ''}\n${pull?.stderr || ''}`;
  if (beforeHash === afterHash || /Already up to date/i.test(text)) {
    return { ok: true, updated: false, reloaded: false, needsRestart: false, latest: true, outdated: false, behind: 0, message: "You're on the latest version." };
  }
  location.reload();
  return { ok: true, updated: true, reloaded: true, needsRestart: false, latest: true, outdated: false, behind: 0, message: 'Updated and reloaded.' };
}

function applyStatusResult(result) {
  if (!result?.ok) {
    const msg = result?.error || result?.message || 'Could not check for updates.';
    setUpdateState('error', 'Check failed', msg);
    return;
  }
  if (result.outdated || result.latest === false) {
    const behind = Number(result.behind) || 0;
    const label = behind > 0 ? `Outdated · ${behind} behind` : 'Outdated';
    setUpdateState('outdated', label, result.message || label);
    return;
  }
  setUpdateState('ok', 'Latest', result.message || "You're on the latest version.");
}

let checkBusy = false;
async function refreshUpdateStatus() {
  if (checkBusy) return;
  checkBusy = true;
  setUpdateState('checking', 'Checking…', 'Checking for updates…');
  try {
    let result;
    try {
      result = await call('app.update.check');
    } catch (err) {
      if (!/Unknown host method/i.test(String(err?.message || err))) throw err;
      result = await fallbackCheck();
    }
    applyStatusResult(result);
  } catch (err) {
    const msg = String(err?.message || err || 'Could not check for updates.');
    setUpdateState('error', 'Check failed', msg);
    console.warn('Update check failed', err);
  } finally {
    checkBusy = false;
  }
}

async function runUpdate() {
  const btn = document.getElementById('gw-update');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Updating…';
  setUpdateState('checking', 'Updating…', 'Pulling latest changes…');
  try {
    let result;
    try {
      result = await call('app.update');
    } catch (err) {
      if (!/Unknown host method/i.test(String(err?.message || err))) throw err;
      result = await fallbackUpdate();
    }
    if (!result?.ok) throw new Error(result?.error || result?.message || 'Update failed.');
    const msg = result.message || (result.updated ? 'Updated.' : "You're on the latest version.");
    if (result.latest || result.updated || result.outdated === false) {
      setUpdateState('ok', 'Latest', msg);
    } else {
      applyStatusResult(result);
    }
    if (result.updated && !result.reloaded && result.needsRestart) {
      try { await call('notify', 'Update', msg); } catch { /* optional */ }
    }
    showVersion();
    if (!result.reloaded) await refreshUpdateStatus();
  } catch (err) {
    const msg = missingGitMessage(err) || String(err?.message || err || 'Update failed.');
    setUpdateState('error', 'Update failed', msg);
    console.error('Update failed', err);
    try { await call('notify', 'Update failed', msg); } catch { /* optional */ }
  } finally {
    btn.disabled = false;
    btn.textContent = prev || 'Update';
  }
}

function wireUpdateButton() {
  const btn = document.getElementById('gw-update');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => { void runUpdate(); });
}

async function start() {
  showVersion();
  wireUpdateButton();
  void refreshUpdateStatus();
  setInterval(() => { void refreshUpdateStatus(); }, 5 * 60_000);

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
