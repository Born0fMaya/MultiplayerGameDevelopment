// The open project. New Project always restores the default baseplate.
// A modified project asks whether to save before that happens.
export const order = -5;

function defaultProject() {
  return {
    version: 1,
    baseplate: { width: 512, depth: 512, thickness: 20, position: [0, -10, 0], rotation: [0, 0, 0] },
    parts: [],
    nextPart: 1,
    folders: [],
    placement: {},
    nextFolder: 1,
  };
}

const snap = (doc) => JSON.stringify(doc);

const CAMERA_MODES = new Set(['firstPerson', 'thirdPerson', 'topDown']);

function normalizeCameraMode(mode) {
  const raw = String(mode || '').trim();
  if (CAMERA_MODES.has(raw)) return raw;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'thirdperson' || key === 'third') return 'thirdPerson';
  if (key === 'topdown' || key === 'top') return 'topDown';
  if (key === 'firstperson' || key === 'first' || key === 'fp') return 'firstPerson';
  return 'firstPerson';
}

function normalizeCamera(src) {
  const input = src && typeof src === 'object' ? src : {};
  const next = {
    fieldOfView: Number.isFinite(input.fieldOfView) ? Math.max(1, Math.min(120, input.fieldOfView)) : 70,
    mode: normalizeCameraMode(input.mode),
    turnParent: input.turnParent !== false,
  };
  if (Number.isFinite(input.distance)) next.distance = Math.max(1, Math.min(200, input.distance));
  if (Number.isFinite(input.height)) next.height = Math.max(-50, Math.min(400, input.height));
  return next;
}

function normalizeScript(src) {
  const input = src && typeof src === 'object' ? src : {};
  const source = typeof input.source === 'string' ? input.source.slice(0, 200000) : '';
  return {
    enabled: input.enabled !== false,
    source,
  };
}

export default {
  mount(root, api) {
    root.style.display = 'none';

    let doc = defaultProject();
    let saved = snap(doc);
    let filePath = null;

    // Fixed stack of JSON snapshots. Entries past the cap, and the redo
    // branch after a new edit, are dropped so the strings can be collected.
    const HISTORY_LIMIT = 100;
    const history = [];
    let cursor = -1;
    const dirty = () => snap(doc) !== saved;
    const publish = () => api.bus.emit('project:opened', JSON.parse(snap(doc)));
    const announce = () => api.bus.emit('history:state', {
      undo: cursor > 0,
      redo: cursor < history.length - 1,
    });
    const PROJECTS_DIR = 'Projects';
    const ensureProjectsDir = () => api.host.fs.mkdir(PROJECTS_DIR);

    // While a project file is open, every edit is written back to that file and
    // every other window that has the same file open reads it. A drag sends a
    // live preview; releasing the drag commits one undo step.
    let revision = 0;
    let lastShared = null;
    let previewing = false;
    let pendingCommit = false;
    let shareTimer = 0;
    let shareChain = Promise.resolve();
    let watchId = 0;
    let followed = '';
    let alive = true;
    const COLLAB_PORT = 5282;
    const COLLAB_MIRROR = `${PROJECTS_DIR}/_online-collab.json`;
    let collabRemote = null;
    let collabHostLabel = '';
    const normPath = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
    const collabBase = (host) => {
      const raw = String(host || '').trim();
      if (!raw) return '';
      // Full share links (Cloudflare tunnel) — keep https, no :5282 suffix.
      if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
      let cleaned = raw.replace(/^\/+|\/+$/g, '');
      if (!cleaned) return '';
      // Hostname-only tunnel links people may paste without the scheme.
      if (/\.trycloudflare\.com$/i.test(cleaned.split('/')[0].split(':')[0])) {
        const hostOnly = cleaned.replace(/:\d+$/, '').replace(/\/+$/, '');
        return `https://${hostOnly}`;
      }
      if (/:\d+$/.test(cleaned)) return `http://${cleaned}`;
      return `http://${cleaned}:${COLLAB_PORT}`;
    };
    // Shell is https://app.local — browser fetch() to http:// public IPs is mixed-content
    // blocked. Talk to remote hosts through the C# HTTP bridge instead.
    async function collabHttp(url, options = {}) {
      const res = await api.host.http.fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || undefined,
        body: options.body,
        responseType: options.responseType || 'json',
        timeoutMs: options.timeoutMs ?? 12_000,
      });
      return res || { ok: false, status: 0, statusText: 'no response', body: null };
    }
    function collabHttpError(res, fallback) {
      if (!res) return fallback || 'request failed';
      if (typeof res.body === 'string' && res.body.trim()) return res.body.trim().slice(0, 200);
      if (res.body && typeof res.body === 'object' && res.body.error) return String(res.body.error);
      if (res.statusText) return res.statusText;
      if (!res.status) return 'Could not reach host (timeout or blocked).';
      return fallback || `HTTP ${res.status}`;
    }
    const publishCollabStatus = (extra = {}) => {
      api.bus.emit('collab:status', {
        connected: !!collabRemote,
        host: collabHostLabel || '',
        url: collabRemote || '',
        port: COLLAB_PORT,
        ...extra,
      });
    };
    async function publishActiveProject() {
      if (collabRemote) return;
      try {
        await api.host.fs.write('Storage/collab-active.json', JSON.stringify({
          path: filePath || null,
          at: Date.now(),
        }));
      } catch (err) { api.log(err); }
    }

    function scheduleShare(commit) {
      if (!alive || !filePath) return;
      if (commit) pendingCommit = true;
      else previewing = true;
      if (shareTimer) return;
      shareTimer = setTimeout(() => {
        shareTimer = 0;
        const commitNow = pendingCommit;
        enqueue(async () => {
          if (!alive) return;
          const ok = await flushShare(commitNow);
          if (!alive) return;
          if (ok) {
            if (commitNow) pendingCommit = false;
          } else if (commitNow) {
            pendingCommit = true;
            scheduleShare(true);
          }
        });
      }, 40);
    }

    function endPreview() {
      if (!previewing && !pendingCommit) return;
      previewing = false;
      if (pendingCommit || (filePath && snap(doc) !== lastShared)) scheduleShare(true);
    }

    function enqueue(fn) {
      const run = shareChain.then(fn, fn);
      shareChain = run.then(() => {}, () => {});
      return run;
    }

    async function flushShare(commit) {
      if (!alive || !filePath) return false;
      if (collabRemote) return flushShareRemote(commit);
      const shot = snap(doc);
      if (!commit && shot === lastShared) return true;
      let remote = null;
      let remoteRev = revision;
      try {
        remote = JSON.parse(await api.host.fs.read(filePath));
        if (!alive) return false;
        remoteRev = Number(remote?.revision) || 0;
      } catch { /* the file is new, or a replace is in progress */ }
      if (!alive) return false;
      if (remote && remoteRev > revision) {
        const next = adopt(remote);
        if (next && snap(next) !== shot) {
          takeShared(next, remoteRev, !!remote.live);
          return true;
        }
      }
      const nextRev = commit ? Math.max(revision, remoteRev) + 1 : Math.max(revision, remoteRev);
      const tmp = `${filePath}.${Date.now()}.tmp`;
      try {
        await api.host.fs.write(tmp, JSON.stringify({ ...doc, revision: nextRev, live: !commit }, null, 2));
        if (!alive) {
          try { await api.host.fs.delete(tmp); } catch { /* already gone */ }
          return false;
        }
        await api.host.fs.move(tmp, filePath, true);
      } catch (err) {
        api.log(err);
        try { await api.host.fs.delete(tmp); } catch { /* already gone */ }
        return false;
      }
      if (!alive) return false;
      revision = nextRev;
      lastShared = shot;
      saved = shot;
      if (commit) previewing = false;
      return true;
    }

    async function flushShareRemote(commit) {
      if (!alive || !filePath || !collabRemote) return false;
      const shot = snap(doc);
      if (!commit && shot === lastShared) return true;
      let remote = null;
      let remoteRev = revision;
      try {
        const res = await collabHttp(`${collabRemote}/collab/project`, { timeoutMs: 8000 });
        if (res.ok && res.body && typeof res.body === 'object') {
          remote = res.body;
          remoteRev = Number(remote?.revision) || 0;
        }
      } catch { /* host briefly unreachable */ }
      if (!alive) return false;
      if (remote && remoteRev > revision) {
        const next = adopt(remote);
        if (next && snap(next) !== shot) {
          takeShared(next, remoteRev, !!remote.live);
          return true;
        }
      }
      const nextRev = commit ? Math.max(revision, remoteRev) + 1 : Math.max(revision, remoteRev);
      const body = JSON.stringify({ ...doc, revision: nextRev, live: !commit }, null, 2);
      try {
        await api.host.fs.write(filePath, body);
        const put = await collabHttp(`${collabRemote}/collab/project`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          timeoutMs: 8000,
        });
        if (!put.ok) {
          if (put.status === 409) {
            await pullSharedRemote();
            return false;
          }
          api.log(collabHttpError(put, `Collab put failed (${put.status})`));
          return false;
        }
      } catch (err) {
        api.log(err);
        return false;
      }
      if (!alive) return false;
      revision = nextRev;
      lastShared = shot;
      saved = shot;
      if (commit) previewing = false;
      return true;
    }

    function takeShared(next, rev, live) {
      const shot = snap(next);
      revision = Math.max(revision, rev);
      if (shot === snap(doc)) {
        lastShared = shot;
        saved = shot;
        return;
      }
      doc = next;
      lastShared = shot;
      saved = shot;
      previewing = false;
      pendingCommit = false;
      if (!live && !(cursor >= 0 && history[cursor] === shot)) {
        history.length = Math.max(0, cursor + 1);
        history.push(shot);
        if (history.length > HISTORY_LIMIT) history.shift();
        cursor = history.length - 1;
        announce();
      }
      api.bus.emit('project:reverted', doc);
    }

    async function pullShared() {
      if (!alive || !filePath || shareTimer || pendingCommit || previewing) return;
      if (collabRemote) return pullSharedRemote();
      let raw;
      try { raw = JSON.parse(await api.host.fs.read(filePath)); }
      catch { return; }
      if (!alive) return;
      const next = adopt(raw);
      if (!next) return;
      const rev = Number(raw.revision) || 0;
      if (rev < revision) return;
      if (rev === revision && snap(next) === snap(doc)) return;
      takeShared(next, rev, rev === revision || !!raw.live);
    }

    async function pullSharedRemote() {
      if (!alive || !collabRemote || shareTimer || pendingCommit || previewing) return;
      let raw;
      try {
        const res = await collabHttp(`${collabRemote}/collab/project`, { timeoutMs: 8000 });
        if (!res.ok || !res.body || typeof res.body !== 'object') return;
        raw = res.body;
      } catch { return; }
      if (!alive) return;
      const next = adopt(raw);
      if (!next) return;
      const rev = Number(raw.revision) || 0;
      if (rev < revision) return;
      if (rev === revision && snap(next) === snap(doc)) return;
      takeShared(next, rev, rev === revision || !!raw.live);
      try { await api.host.fs.write(filePath || COLLAB_MIRROR, JSON.stringify({ ...raw }, null, 2)); }
      catch { /* mirror is best-effort */ }
    }

    async function followFile(path) {
      const key = normPath(path);
      if (key === followed) return;
      followed = key;
      if (watchId) {
        const old = watchId;
        watchId = 0;
        api.host.fs.unwatch(old).catch(() => {});
      }
      if (!path) return;
      try { watchId = await api.host.fs.watch(path) || 0; }
      catch (err) { api.log(err); }
    }

    const sessionStore = (() => {
      try { return localStorage; } catch { return null; }
    })();
    const sessionId = (() => {
      try {
        let id = sessionStore?.getItem('gw-session-id') || sessionStorage.getItem('gw-session-id');
        if (!id) {
          id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        }
        sessionStore?.setItem('gw-session-id', id);
        sessionStorage.setItem('gw-session-id', id);
        return id;
      } catch {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      }
    })();
    let presenceFile = '';
    let userCount = 1;
    // Survive hot reload so remotes do not flash empty then snap.
    let lastPeople = Array.isArray(window.__gwLastPeople) ? window.__gwLastPeople : [];
    // Stay quiet until the last project is restored so hot reload does not
    // delete our session file or publish an empty presence list.
    let presenceReady = false;
    let presenceEpoch = 0;
    let profile = { name: 'User', color: '#5b9dff' };
    let pose = { position: [0, 2, 8], forward: [0, 0, -1], pointer: null, activeAt: Date.now() };
    let poseKnown = false;
    let mySelection = [];
    let sessionMode = 'edit';
    const AFK_MS = 10 * 60 * 1000;
    const isAfk = (activeAt, now = Date.now()) => Number.isFinite(activeAt) && now - activeAt > AFK_MS;
    const lockIds = new Set();
    let lockShot = '';
    let userCounts = { edit: 1, live: 0 };
    const publishUsers = (edit, live) => {
      const next = {
        edit: Math.max(0, edit | 0),
        live: Math.max(0, live | 0),
      };
      if (next.edit === userCounts.edit && next.live === userCounts.live) return;
      userCounts = next;
      userCount = Math.max(1, next.edit + next.live);
      api.bus.emit('project:users', { ...userCounts });
    };
    const setSessionMode = (mode) => {
      const next = mode === 'live' ? 'live' : 'edit';
      const changed = sessionMode !== next;
      sessionMode = next;
      if (sessionMode === 'live') mySelection = [];
      // Always re-publish so a desynced toolbar can recover on Stop.
      api.bus.emit('mode:changed', sessionMode);
      if (changed) presenceTick();
    };
    const vec3 = (value, fallback) => {
      if (!Array.isArray(value) || value.length < 3) return fallback;
      const next = value.slice(0, 3).map(Number);
      return next.every((n) => Number.isFinite(n)) ? next : fallback;
    };
    try {
      const raw = sessionStore?.getItem('gw-pose') || sessionStorage.getItem('gw-pose') || '';
      const saved = JSON.parse(raw);
      const position = vec3(saved?.position, null);
      const forward = vec3(saved?.forward, null);
      if (position && forward) {
        pose = { position, forward, pointer: null, activeAt: Date.now() };
        poseKnown = true;
      }
    } catch { /* private mode or bad cache */ }
    function normalizeClaims(value) {
      if (!Array.isArray(value)) return [];
      const out = [];
      const seen = new Set();
      for (const item of value) {
        const id = typeof item === 'string' ? item : item?.id;
        const at = item && typeof item === 'object' && Number.isFinite(item.at) ? item.at : 0;
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, at });
      }
      return out.slice(0, 64);
    }
    function publishLocks(ids) {
      lockIds.clear();
      for (const id of ids) lockIds.add(id);
      const shot = ids.slice().sort().join('\n');
      if (shot === lockShot) return;
      lockShot = shot;
      api.bus.emit('project:locks', ids.slice());
    }
    function rankClaims(people) {
      const best = new Map();
      const consider = (session, claim) => {
        if (!claim || typeof claim.id !== 'string' || !claim.id) return;
        const at = Number.isFinite(claim.at) ? claim.at : 0;
        const prev = best.get(claim.id);
        if (!prev || at < prev.at || (at === prev.at && session < prev.session)) {
          best.set(claim.id, { at, session });
        }
      };
      for (const claim of mySelection) consider(sessionId, claim);
      for (const person of people) {
        for (const claim of person.selection || []) consider(person.id, claim);
      }
      return best;
    }
    async function leavePresence() {
      if (collabRemote) {
        presenceFile = '';
        try {
          await collabHttp(`${collabRemote}/collab/session/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            responseType: 'text',
            timeoutMs: 4000,
          });
        } catch { /* host offline */ }
        return;
      }
      const file = presenceFile;
      presenceFile = '';
      if (!file) return;
      try { await api.host.fs.delete(file); } catch { /* already gone */ }
      const dir = file.replace(/[\\/][^\\/]+$/, '');
      try {
        const left = await api.host.fs.list(dir);
        if (!left || !left.length) await api.host.fs.delete(dir);
      } catch { /* another window may still be using it */ }
    }
    let presenceBusy = false;
    async function presenceTick() {
      if (presenceBusy) return;
      presenceBusy = true;
      try {
        await writePresence();
      } finally {
        presenceBusy = false;
      }
    }
    // Chat rides the same session heartbeat as presence — no separate chat files.
    const CHAT_KEEP = 50;
    let pendingChat = [];
    let lastMerged = [];
    let chatShot = '';
    function normalizeChatItem(item, fallbackId, fallbackName, fallbackColor, fallbackSession) {
      const text = typeof item?.text === 'string' ? item.text.trim().slice(0, 500) : '';
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : fallbackId,
        at: Number.isFinite(item.at) ? item.at : Date.now(),
        session: typeof item.session === 'string' && item.session ? item.session : (fallbackSession || ''),
        name: typeof item.name === 'string' && item.name.trim()
          ? item.name.trim().slice(0, 32)
          : (fallbackName || 'User'),
        color: typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
          ? item.color.toLowerCase()
          : (fallbackColor || '#5b9dff'),
        text,
      };
    }
    function mergeChat(lists) {
      const map = new Map();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (!item?.id || !item.text) continue;
          if (!map.has(item.id)) map.set(item.id, item);
        }
      }
      return [...map.values()]
        .sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)))
        .slice(-CHAT_KEEP);
    }
    function publishChat(force = false) {
      const ready = !!filePath;
      const shot = `${ready ? 1 : 0}\n${lastMerged.map((item) => item.id).join('\n')}`;
      if (!force && shot === chatShot) return;
      chatShot = shot;
      api.bus.emit('project:chat', {
        ready,
        messages: lastMerged.slice(),
      });
    }
    function setFilePath(next) {
      const path = typeof next === 'string' && next ? next : null;
      if (normPath(filePath) !== normPath(path)) {
        pendingChat = [];
        lastMerged = [];
        chatShot = '';
      }
      filePath = path;
      publishChat(true);
      publishActiveProject();
    }
    async function writePresence() {
      if (!alive) return;
      const epoch = presenceEpoch;
      const stale = () => !alive || epoch !== presenceEpoch;
      if (collabRemote) {
        await writePresenceRemote(stale);
        return;
      }
      if (!filePath) {
        // During hot-reload boot we have no path yet; do not wipe sessions or
        // remote avatars. newProject sets presenceReady and clears for real.
        if (!presenceReady) return;
        await leavePresence();
        if (stale()) return;
        publishUsers(sessionMode === 'edit' ? 1 : 0, sessionMode === 'live' ? 1 : 0);
        publishLocks([]);
        lastPeople = [];
        window.__gwLastPeople = lastPeople;
        api.bus.emit('project:presence', []);
        if (pendingChat.length || lastMerged.length || chatShot.charAt(0) === '1') {
          pendingChat = [];
          lastMerged = [];
          publishChat(true);
        }
        return;
      }
      const dir = `${filePath}.sessions`;
      const mine = `${dir}\\${sessionId}`;
      if (presenceFile && normPath(presenceFile) !== normPath(mine)) await leavePresence();
      if (stale()) return;
      try {
        await api.host.fs.mkdir(dir);
        if (stale()) return;
        const entries = await api.host.fs.list(dir);
        if (stale()) return;
        const now = Date.now();
        const people = [];
        const chatLists = [lastMerged, pendingChat];
        for (const entry of entries || []) {
          if (!entry || entry.isDir || /\.tmp$/i.test(entry.name || '')) continue;
          const mineEntry = normPath(entry.path) === normPath(mine);
          const when = new Date(entry.modified).getTime();
          if (!mineEntry && (!Number.isFinite(when) || now - when > 12000)) {
            api.host.fs.delete(entry.path).catch(() => {});
            continue;
          }
          let data = null;
          try {
            data = JSON.parse(await api.host.fs.read(entry.path));
          } catch { /* a write can still be landing */ }
          if (stale()) return;
          if (!data) continue;
          const color = typeof data?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color)
            ? data.color.toLowerCase()
            : '#5b9dff';
          const name = typeof data?.name === 'string' && data.name.trim()
            ? data.name.trim().slice(0, 32)
            : 'User';
          const theirMode = data?.mode === 'live' ? 'live' : 'edit';
          if (Array.isArray(data.chat)) {
            const bucket = [];
            for (let i = 0; i < data.chat.length; i++) {
              const msg = normalizeChatItem(
                data.chat[i],
                `${entry.name}-${i}`,
                name,
                color,
                entry.name,
              );
              if (msg) bucket.push(msg);
            }
            chatLists.push(bucket);
          }
          if (mineEntry) continue;
          const activeAt = Number.isFinite(data?.activeAt) ? data.activeAt : when;
          const afk = isAfk(activeAt, now);
          people.push({
            id: entry.name,
            name,
            color,
            mode: theirMode,
            position: vec3(data?.position, null),
            forward: vec3(data?.forward, [0, 0, -1]),
            pointer: afk ? null : vec3(data?.pointer, null),
            activeAt,
            afk,
            selection: afk || theirMode === 'live' ? [] : normalizeClaims(data?.selection),
            _modified: Number.isFinite(when) ? when : 0,
          });
        }
        // Hot reload can leave a stale session file beside the live one. Keep
        // the freshest profile so remotes do not flicker between two poses.
        const unique = new Map();
        for (const person of people) {
          const key = `${person.name.toLowerCase()}\0${person.color}`;
          const prev = unique.get(key);
          const score = (person.activeAt || 0) + (person._modified || 0) * 0.0001;
          const prevScore = prev ? (prev.activeAt || 0) + (prev._modified || 0) * 0.0001 : -Infinity;
          if (!prev || score >= prevScore) unique.set(key, person);
        }
        const deduped = [...unique.values()].map((person) => {
          const next = { ...person };
          delete next._modified;
          return next;
        });
        lastMerged = mergeChat(chatLists);
        pendingChat = [];
        publishChat();
        if (isAfk(pose.activeAt, now) && mySelection.length) {
          mySelection = [];
          api.bus.emit('scene:select', null);
        }
        // Until the viewport has restored/sent a real pose, keep whatever is
        // already on disk so a hot reload does not publish the default spawn.
        let writePosition = pose.position;
        let writeForward = pose.forward;
        if (!poseKnown) {
          try {
            const prev = JSON.parse(await api.host.fs.read(mine));
            writePosition = vec3(prev?.position, writePosition);
            writeForward = vec3(prev?.forward, writeForward);
          } catch { /* first session write */ }
          if (stale()) return;
        }
        const body = JSON.stringify({
          name: profile.name,
          color: profile.color,
          mode: sessionMode,
          position: writePosition,
          forward: writeForward,
          pointer: isAfk(pose.activeAt, now) ? null : pose.pointer,
          activeAt: pose.activeAt,
          selection: isAfk(pose.activeAt, now) || sessionMode === 'live' ? [] : mySelection,
          chat: lastMerged,
        });
        const tmp = `${mine}.tmp`;
        await api.host.fs.write(tmp, body);
        // Disposed/replaced modules must not clobber a newer session write —
        // that is what made remotes teleport during Cursor hot reloads.
        if (stale()) {
          try { await api.host.fs.delete(tmp); } catch { /* already gone */ }
          return;
        }
        await api.host.fs.move(tmp, mine, true);
        if (stale()) return;
        presenceFile = mine;
        let editCount = sessionMode === 'edit' ? 1 : 0;
        let liveCount = sessionMode === 'live' ? 1 : 0;
        for (const person of deduped) {
          if (person.mode === 'live') liveCount += 1;
          else editCount += 1;
        }
        publishUsers(editCount, liveCount);
        const ranked = rankClaims(deduped.filter((person) => person.mode !== 'live'));
        for (const person of deduped) {
          person.selection = (person.selection || []).filter((claim) => ranked.get(claim.id)?.session === person.id);
        }
        const locks = [];
        for (const [id, claim] of ranked) {
          if (claim.session !== sessionId) locks.push(id);
        }
        // Live clients do not claim edit locks; edit locks stay for editors only.
        publishLocks(sessionMode === 'live' ? locks : locks);
        lastPeople = deduped.filter((person) => person.position);
        window.__gwLastPeople = lastPeople;
        api.bus.emit('project:presence', lastPeople);
      } catch (err) {
        api.log(err);
      }
    }

    async function writePresenceRemote(stale) {
      if (!collabRemote) return;
      if (!filePath) {
        if (!presenceReady) return;
        await leavePresence();
        if (stale()) return;
        publishUsers(sessionMode === 'edit' ? 1 : 0, sessionMode === 'live' ? 1 : 0);
        publishLocks([]);
        lastPeople = [];
        window.__gwLastPeople = lastPeople;
        api.bus.emit('project:presence', []);
        return;
      }
      const now = Date.now();
      let writePosition = pose.position;
      let writeForward = pose.forward;
      const payload = {
        name: profile.name,
        color: profile.color,
        mode: sessionMode,
        position: writePosition,
        forward: writeForward,
        pointer: isAfk(pose.activeAt, now) ? null : pose.pointer,
        activeAt: pose.activeAt,
        selection: isAfk(pose.activeAt, now) || sessionMode === 'live' ? [] : mySelection,
        chat: mergeChat([lastMerged, pendingChat]),
      };
      try {
        const res = await collabHttp(`${collabRemote}/collab/session/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: 8000,
        });
        if (!res.ok) {
          if (res.status === 404) publishCollabStatus({ error: 'Host has no project open.' });
          return;
        }
        if (stale()) return;
        const data = res.body && typeof res.body === 'object' ? res.body : null;
        if (!data) return;
        if (stale()) return;
        const people = [];
        const chatLists = [lastMerged, pendingChat];
        for (const entry of (Array.isArray(data.people) ? data.people : [])) {
          if (!entry || entry.id === sessionId) continue;
          const color = typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color)
            ? entry.color.toLowerCase()
            : '#5b9dff';
          const name = typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim().slice(0, 32)
            : 'User';
          const theirMode = entry.mode === 'live' ? 'live' : 'edit';
          if (Array.isArray(entry.chat)) {
            const bucket = [];
            for (let i = 0; i < entry.chat.length; i++) {
              const msg = normalizeChatItem(entry.chat[i], `${entry.id}-${i}`, name, color, entry.id);
              if (msg) bucket.push(msg);
            }
            chatLists.push(bucket);
          }
          const activeAt = Number.isFinite(entry.activeAt) ? entry.activeAt : now;
          const afk = isAfk(activeAt, now);
          people.push({
            id: entry.id,
            name,
            color,
            mode: theirMode,
            position: vec3(entry.position, null),
            forward: vec3(entry.forward, [0, 0, -1]),
            pointer: afk ? null : vec3(entry.pointer, null),
            activeAt,
            afk,
            selection: afk || theirMode === 'live' ? [] : normalizeClaims(entry.selection),
          });
        }
        if (Array.isArray(data.chat)) chatLists.push(data.chat.map((item, i) => normalizeChatItem(item, `host-${i}`, 'User', '#5b9dff', '')).filter(Boolean));
        lastMerged = mergeChat(chatLists);
        pendingChat = [];
        publishChat();
        presenceFile = `remote:${sessionId}`;
        let editCount = sessionMode === 'edit' ? 1 : 0;
        let liveCount = sessionMode === 'live' ? 1 : 0;
        for (const person of people) {
          if (person.mode === 'live') liveCount += 1;
          else editCount += 1;
        }
        publishUsers(editCount, liveCount);
        const ranked = rankClaims(people.filter((person) => person.mode !== 'live'));
        for (const person of people) {
          person.selection = (person.selection || []).filter((claim) => ranked.get(claim.id)?.session === person.id);
        }
        const locks = [];
        for (const [id, claim] of ranked) {
          if (claim.session !== sessionId) locks.push(id);
        }
        publishLocks(locks);
        lastPeople = people.filter((person) => person.position);
        window.__gwLastPeople = lastPeople;
        api.bus.emit('project:presence', lastPeople);
        const remoteRev = Number(data.revision) || 0;
        if (remoteRev > revision) enqueue(() => pullSharedRemote());
      } catch (err) {
        api.log(err);
      }
    }

    async function connectCollab(hostInput) {
      const base = collabBase(hostInput);
      if (!base) {
        publishCollabStatus({ error: 'Enter a host IP address.' });
        return false;
      }
      publishCollabStatus({ connecting: true, error: '', host: hostInput });
      let info;
      try {
        const res = await collabHttp(`${base}/collab/info`, { timeoutMs: 10_000 });
        if (!res.ok) {
          throw new Error(collabHttpError(res, `Could not reach ${base}`));
        }
        info = res.body && typeof res.body === 'object' ? res.body : null;
      } catch (err) {
        const msg = err?.message || 'Could not reach that host.';
        publishCollabStatus({
          error: /timeout|canceled|reach|connect/i.test(msg)
            ? `${msg} If this is a public IP, the host needs router port-forward TCP 5282.`
            : msg,
        });
        return false;
      }
      if (!info?.ok) {
        publishCollabStatus({ error: 'That host is not running collaboration.' });
        return false;
      }
      let raw;
      try {
        const res = await collabHttp(`${base}/collab/project`, { timeoutMs: 15_000 });
        if (!res.ok) {
          const msg = res.status === 404
            ? 'Host has no project open yet.'
            : collabHttpError(res, `Host project failed (${res.status}).`);
          publishCollabStatus({ error: msg });
          return false;
        }
        raw = res.body && typeof res.body === 'object' ? res.body : null;
      } catch (err) {
        publishCollabStatus({ error: err?.message || 'Could not download the project.' });
        return false;
      }
      if (!raw) {
        publishCollabStatus({ error: 'Host sent an empty project.' });
        return false;
      }
      const next = adopt(raw);
      if (!next) {
        publishCollabStatus({ error: 'Host sent an invalid project.' });
        return false;
      }
      await leavePresence();
      collabRemote = base;
      collabHostLabel = String(hostInput || '').trim() || base;
      try { localStorage.setItem('gw-collab-host', collabHostLabel); } catch { /* private mode */ }
      doc = next;
      revision = Number(raw.revision) || 0;
      lastShared = snap(doc);
      saved = lastShared;
      previewing = false;
      pendingCommit = false;
      presenceEpoch += 1;
      setFilePath(COLLAB_MIRROR);
      try {
        await ensureProjectsDir();
        await api.host.fs.write(COLLAB_MIRROR, JSON.stringify({ ...raw }, null, 2));
      } catch (err) { api.log(err); }
      followFile('');
      resetHistory();
      presenceReady = true;
      presenceTick();
      publish();
      const title = (info.project && String(info.project)) || 'Online';
      await api.host.window.title(`${title} (online)`);
      publishCollabStatus({ error: '', connecting: false });
      return true;
    }

    async function disconnectCollab() {
      if (!collabRemote) {
        publishCollabStatus();
        return;
      }
      await leavePresence();
      collabRemote = null;
      collabHostLabel = '';
      presenceEpoch += 1;
      presenceFile = '';
      publishActiveProject();
      presenceTick();
      publishCollabStatus();
      const name = (filePath || '').split(/[/\\]/).pop().replace(/\.json$/i, '');
      await api.host.window.title(name || 'Game');
    }

    api.bus.on('collab:connect', (payload) => {
      const host = typeof payload === 'string' ? payload : payload?.host;
      connectCollab(host).catch((err) => {
        api.log(err);
        publishCollabStatus({ error: err?.message || 'Connect failed.', connecting: false });
      });
    });
    api.bus.on('collab:disconnect', () => {
      disconnectCollab().catch((err) => api.log(err));
    });
    api.bus.on('collab:request', () => publishCollabStatus());
    publishCollabStatus();

    api.bus.on('mode:set', (mode) => setSessionMode(mode));
    // Belt-and-suspenders: Stop must clear Live even if the viewport skipped
    // enterLiveMode (hot reload left project on live while playMode reset).
    api.bus.on('mode:stop', () => setSessionMode('edit'));
    api.bus.on('mode:request', () => api.bus.emit('mode:changed', sessionMode));
    api.bus.on('presence:profile', (next) => {
      const name = typeof next?.name === 'string' ? next.name.trim().slice(0, 32) : '';
      if (name) profile.name = name;
      if (typeof next?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(next.color)) profile.color = next.color.toLowerCase();
      presenceTick();
    });
    api.bus.on('presence:pose', (next) => {
      const position = vec3(next?.position, pose.position);
      const forward = vec3(next?.forward, pose.forward);
      const pointer = next?.pointer == null ? null : vec3(next.pointer, null);
      const moved = !position || !pose.position
        || Math.abs(position[0] - pose.position[0]) > 0.02
        || Math.abs(position[1] - pose.position[1]) > 0.02
        || Math.abs(position[2] - pose.position[2]) > 0.02
        || Math.abs(forward[0] - pose.forward[0]) > 0.01
        || Math.abs(forward[1] - pose.forward[1]) > 0.01
        || Math.abs(forward[2] - pose.forward[2]) > 0.01
        || JSON.stringify(pointer) !== JSON.stringify(pose.pointer);
      const active = next?.active === true || moved;
      pose = {
        position,
        forward,
        pointer,
        activeAt: active ? Date.now() : pose.activeAt,
      };
      poseKnown = true;
      try {
        const raw = JSON.stringify({ position, forward });
        sessionStorage.setItem('gw-pose', raw);
        sessionStore?.setItem('gw-pose', raw);
      } catch { /* private mode */ }
    });
    api.bus.on('presence:selection', (next) => {
      mySelection = normalizeClaims(next);
      // Empty publishes include AFK-driven clears — those must not wake activity.
      if (mySelection.length) pose = { ...pose, activeAt: Date.now() };
      presenceTick();
    });
    api.bus.on('project:revert-request', () => api.bus.emit('project:reverted', doc));
    api.bus.on('project:preview-end', endPreview);
    api.bus.emit('presence:request');

    api.bus.on('chat:send', (payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text;
      const clean = typeof text === 'string' ? text.trim().slice(0, 500) : '';
      if (!clean) return;
      pose = { ...pose, activeAt: Date.now() };
      const msg = {
        id: `${sessionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        session: sessionId,
        name: profile.name,
        color: profile.color,
        text: clean,
      };
      pendingChat.push(msg);
      lastMerged = mergeChat([lastMerged, pendingChat]);
      publishChat(true);
      if (!filePath) return;
      presenceTick();
    });
    api.bus.on('chat:request', () => publishChat(true));

    const pullTimer = setInterval(() => { if (alive) enqueue(() => pullShared()); }, 300);
    const presenceTimer = setInterval(() => { if (alive) presenceTick(); }, 200);
    api.host.on('fs.change', (e) => {
      if (!alive || !filePath) return;
      const key = normPath(e?.path);
      if (key === normPath(filePath)) enqueue(() => pullShared());
    });

    function clearHistory() {
      for (let i = 0; i < history.length; i++) history[i] = null;
      history.length = 0;
      cursor = -1;
    }

    function remember() {
      const shot = snap(doc);
      const changed = !(cursor >= 0 && history[cursor] === shot);
      if (changed) {
        history.length = cursor + 1;
        history.push(shot);
        if (history.length > HISTORY_LIMIT) history.shift();
        cursor = history.length - 1;
        announce();
      }
      if (previewing || (changed && shot !== lastShared)) scheduleShare(true);
    }

    function resetHistory() {
      clearHistory();
      remember();
    }

    function applyHistory(index) {
      const shot = history[index];
      if (!shot || index === cursor) return;
      cursor = index;
      doc = JSON.parse(shot);
      api.bus.emit('project:reverted', doc);
      announce();
      scheduleShare(true);
    }

    async function save(forceDialog) {
      let target = filePath;
      if (forceDialog || !target) {
        await ensureProjectsDir();
        target = await api.host.dialog.saveFile({
          title: forceDialog ? 'Save As' : 'Save Project',
          filter: 'Game project (*.json)|*.json|All files (*.*)|*.*',
          defaultName: filePath ? filePath.split(/[/\\]/).pop() : 'Project.json',
          initialDir: PROJECTS_DIR,
        });
        if (!target) return false;
      }
      setFilePath(target);
      const wrote = await enqueue(() => flushShare(true));
      if (!wrote) return false;
      followFile(target);
      presenceTick();
      try { localStorage.setItem('gw-last-project', target); } catch { /* private mode */ }
      const name = target.split(/[/\\]/).pop().replace(/\.json$/i, '');
      await api.host.window.title(name || 'Game');
      return true;
    }

    async function newProject() {
      if (dirty()) {
        const answer = await api.host.dialog.message(
          'Do you want to save the current project before starting a new one?',
          { title: 'New Project', buttons: 'yesnocancel', icon: 'question' },
        );
        if (answer === 'cancel') return;
        if (answer === 'yes') {
          const wrote = await save(false);
          if (!wrote) return;
        }
      }
      setFilePath(null);
      try { localStorage.removeItem('gw-last-project'); } catch { /* private mode */ }
      previewing = false;
      pendingCommit = false;
      revision = 0;
      doc = defaultProject();
      lastShared = snap(doc);
      saved = lastShared;
      followFile('');
      presenceReady = true;
      presenceTick();
      resetHistory();
      publish();
      api.bus.emit('camera:home');
      await api.host.window.title('Game');
    }

    function adopt(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const known = raw.version === 1 || raw.baseplate != null || raw.spawn != null || Array.isArray(raw.parts);
      if (!known) return null;
      const placement = raw.placement && typeof raw.placement === 'object' && !Array.isArray(raw.placement) ? { ...raw.placement } : {};
      delete placement.spawn;
      const parts = [];
      for (const part of (Array.isArray(raw.parts) ? raw.parts : [])) {
        if (!part || part.shape === 'controller') {
          if (part?.id) delete placement[part.id];
          continue;
        }
        if (part.controller) {
          const next = { ...part };
          delete next.controller;
          parts.push(next);
        } else {
          parts.push(part);
        }
      }
      for (const child of Object.keys(placement)) {
        if (!parts.some((p) => p.id === child) && child !== 'baseplate' && !String(child).startsWith('folder-')) {
          delete placement[child];
        }
      }
      return {
        version: 1,
        baseplate: raw.baseplate ?? null,
        parts,
        nextPart: Number.isFinite(raw.nextPart) && raw.nextPart >= 1 ? raw.nextPart : 1,
        folders: Array.isArray(raw.folders) ? raw.folders : [],
        placement,
        nextFolder: Number.isFinite(raw.nextFolder) && raw.nextFolder >= 1 ? raw.nextFolder : 1,
      };
    }

    async function openProject() {
      if (dirty()) {
        const answer = await api.host.dialog.message(
          'Do you want to save the current project before opening another?',
          { title: 'Open Project', buttons: 'yesnocancel', icon: 'question' },
        );
        if (answer === 'cancel') return;
        if (answer === 'yes') {
          const wrote = await save(false);
          if (!wrote) return;
        }
      }
      await ensureProjectsDir();
      const target = await api.host.dialog.openFile({
        title: 'Open Project',
        filter: 'Game project (*.json)|*.json|All files (*.*)|*.*',
        initialDir: PROJECTS_DIR,
      });
      const path = Array.isArray(target) ? target[0] : target;
      if (!path) return;
      await loadProject(path);
    }

    async function loadProject(path) {
      let raw;
      try {
        raw = JSON.parse(await api.host.fs.read(path));
      } catch (err) {
        await api.host.dialog.message('That file could not be read as a project.', { title: 'Open Project', icon: 'error' });
        api.log(err);
        return;
      }
      const next = adopt(raw);
      if (!next) {
        await api.host.dialog.message('That file is not a GameWindow project.', { title: 'Open Project', icon: 'error' });
        return;
      }
      doc = next;
      setFilePath(path);
      revision = Number(raw.revision) || 0;
      lastShared = snap(doc);
      saved = lastShared;
      previewing = false;
      pendingCommit = false;
      resetHistory();
      followFile(path);
      presenceTick();
      publish();
      try { localStorage.setItem('gw-last-project', path); } catch { /* private mode */ }
      const name = path.split(/[/\\]/).pop().replace(/\.json$/i, '');
      await api.host.window.title(name || 'Game');
    }

    async function exportScene() {
      const target = await api.host.dialog.saveFile({
        title: 'Export Scene',
        filter: 'Wavefront OBJ (*.obj)|*.obj|All files (*.*)|*.*',
        defaultName: 'Scene.obj',
      });
      if (!target) return;
      api.bus.emit('project:export', target);
    }

    api.bus.on('file:command', (id) => {
      const run = id === 'new' ? newProject
        : id === 'open' ? openProject
        : id === 'save' ? () => save(false)
        : id === 'save-as' ? () => save(true)
        : id === 'export' ? exportScene
        : null;
      if (run) run().catch((err) => api.log(err));
    });
    api.bus.on('project:load', (path) => {
      if (typeof path === 'string' && path) loadProject(path).catch((err) => api.log(err));
    });
    const findPart = (kind) => {
      if (kind === 'baseplate') return doc.baseplate ?? null;
      return (doc.parts || []).find((part) => part.id === kind) ?? null;
    };

    function writeTransform(change) {
      const part = findPart(change?.kind);
      if (!part || !change.size || !Array.isArray(change.position) || !Array.isArray(change.rotation)) return false;
      part.position = change.position.slice(0, 3);
      part.rotation = change.rotation.slice(0, 3);
      part.width = change.size.x;
      part.depth = change.size.z;
      if (change.kind === 'baseplate') part.thickness = change.size.y;
      else part.height = change.size.y;
      if (typeof change.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(change.color)) part.color = change.color.toLowerCase();
      if (change.solid && typeof change.solid === 'object' && Array.isArray(change.solid.vertices)) {
        part.solid = JSON.parse(JSON.stringify(change.solid));
        part.shape = 'solid';
      }
      return true;
    }
    function changeList(change) {
      if (Array.isArray(change?.changes)) return change.changes;
      return change ? [change] : [];
    }
    api.bus.on('project:live', (change) => {
      // Live Mode is a separate simulation layer — never write it into the edit document.
      if (sessionMode === 'live') return;
      const list = changeList(change).filter((item) => item && !lockIds.has(item.kind));
      if (!list.length) {
        if (changeList(change).some((item) => lockIds.has(item?.kind))) api.bus.emit('project:reverted', doc);
        return;
      }
      const before = snap(doc);
      let any = false;
      for (const item of list) if (writeTransform(item)) any = true;
      if (!any || snap(doc) === before) return;
      scheduleShare(false);
    });
    api.bus.on('project:change', (change) => {
      if (sessionMode === 'live') return;
      const list = changeList(change).filter((item) => item && !lockIds.has(item.kind));
      if (!list.length) {
        if (changeList(change).some((item) => lockIds.has(item?.kind))) api.bus.emit('project:reverted', doc);
        return;
      }
      const before = snap(doc);
      let any = false;
      for (const item of list) if (writeTransform(item)) any = true;
      if (!any) return;
      if (snap(doc) === before && !previewing) return;
      remember();
      api.bus.emit('project:reverted', doc);
    });
    api.bus.on('project:insert', (spec) => {
      if (sessionMode === 'live') return;
      const width = Number(spec?.width);
      const height = Number(spec?.height);
      const depth = Number(spec?.depth);
      const position = spec?.position;
      const rotation = spec?.rotation;
      if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) return;
      if (!Array.isArray(position) || !Array.isArray(rotation)) return;
      if (!Array.isArray(doc.parts)) doc.parts = [];
      if (!Number.isFinite(doc.nextPart) || doc.nextPart < 1) doc.nextPart = doc.parts.length + 1;
      const names = new Set(doc.parts.map((part) => part.name));
      if (spec?.shape === 'controller') return;
      const fallback = spec?.shape === 'camera' ? 'Camera'
        : spec?.shape === 'script' ? 'Script'
          : 'Part';
      let name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim() : fallback;
      if (names.has(name)) {
        const base = name;
        let n = 2;
        while (names.has(`${base} ${n}`)) n += 1;
        name = `${base} ${n}`;
      }
      const id = `part-${doc.nextPart}`;
      doc.nextPart += 1;
      const part = {
        id,
        name,
        shape: spec.shape || 'block',
        width,
        height,
        depth,
        position: position.slice(0, 3),
        rotation: rotation.slice(0, 3),
      };
      if (typeof spec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.color)) part.color = spec.color.toLowerCase();
      if (spec.solid && typeof spec.solid === 'object') part.solid = spec.solid;
      if (part.shape === 'camera') {
        const src = spec.camera && typeof spec.camera === 'object' ? spec.camera : {};
        part.camera = normalizeCamera(src);
      }
      if (part.shape === 'script') {
        part.script = normalizeScript(spec.script);
        part.width = 1;
        part.height = 1;
        part.depth = 1;
      }
      doc.parts.push(part);
      if (typeof spec.folder === 'string' && spec.folder) {
        if (!doc.placement || typeof doc.placement !== 'object') doc.placement = {};
        doc.placement[id] = spec.folder;
        const host = findPart(spec.folder);
        if (host && part.shape === 'script' && Array.isArray(host.position)) {
          const hy = Number(spec.folder === 'baseplate' ? host.thickness : host.height) || 1;
          part.position = [
            Number(host.position[0]) || 0,
            (Number(host.position[1]) || 0) + hy / 2 + 1,
            Number(host.position[2]) || 0,
          ];
        }
      }
      remember();
      api.bus.emit('project:reverted', doc);
      api.bus.emit('scene:select', id);
      api.bus.emit('project:inserted', id);
    });
    api.bus.on('project:rename', (change) => {
      if (sessionMode === 'live') return;
      if (lockIds.has(change?.kind)) {
        api.bus.emit('project:reverted', doc);
        return;
      }
      const part = findPart(change?.kind);
      const name = typeof change?.name === 'string' ? change.name.trim() : '';
      if (!part || !name) return;
      const current = part.name || (change.kind === 'baseplate' ? 'Baseplate' : 'Part');
      if (name === current) return;
      part.name = name;
      remember();
      api.bus.emit('project:reverted', doc);
    });
    function describePart(kind) {
      const part = findPart(kind);
      if (!part) return null;
      const height = kind === 'baseplate' ? part.thickness : part.height;
      const physics = part.physics && typeof part.physics === 'object' ? {
        canCollide: part.physics.canCollide !== false,
        enabled: !!part.physics.enabled,
        gravity: part.physics.gravity !== false,
        gravityScale: Number.isFinite(part.physics.gravityScale) ? part.physics.gravityScale : 1,
        massOverride: Number.isFinite(part.physics.massOverride) ? part.physics.massOverride : 0,
        linearDamping: Number.isFinite(part.physics.linearDamping) ? part.physics.linearDamping : 0,
        angularDamping: Number.isFinite(part.physics.angularDamping) ? part.physics.angularDamping : 0.05,
        startAsleep: !!part.physics.startAsleep,
      } : {
        canCollide: true,
        enabled: false,
        gravity: true,
        gravityScale: 1,
        massOverride: 0,
        linearDamping: 0,
        angularDamping: 0.05,
        startAsleep: false,
      };
      const shape = part.shape || 'block';
      const described = {
        kind,
        name: part.name || (kind === 'baseplate' ? 'Baseplate' : 'Part'),
        shape,
        width: part.width,
        height,
        depth: part.depth,
        position: (part.position || [0, 0, 0]).slice(0, 3),
        rotation: (part.rotation || [0, 0, 0]).slice(0, 3),
        color: part.color || (kind === 'baseplate' ? '#a3a2a5' : '#b1b2b5'),
        emissive: !!part.emissive,
        emissiveIntensity: Number.isFinite(part.emissiveIntensity) ? part.emissiveIntensity : 1,
        physics,
        solid: part.solid || null,
        parent: doc.placement && typeof doc.placement[kind] === 'string' ? doc.placement[kind] : null,
      };
      if (shape === 'camera') {
        described.camera = normalizeCamera(part.camera);
      }
      if (shape === 'script') {
        described.script = normalizeScript(part.script);
      }
      return described;
    }
    api.bus.on('project:solid', (change) => {
      if (sessionMode === 'live') return;
      const kind = change?.kind;
      if (!kind || lockIds.has(kind)) {
        if (lockIds.has(kind)) api.bus.emit('project:reverted', doc);
        return;
      }
      const part = findPart(kind);
      if (!part || !change.solid || typeof change.solid !== 'object') return;
      part.solid = JSON.parse(JSON.stringify(change.solid));
      part.shape = 'solid';
      if (change.size) {
        part.width = change.size.x ?? part.width;
        part.depth = change.size.z ?? part.depth;
        if (kind === 'baseplate') part.thickness = change.size.y ?? part.thickness;
        else part.height = change.size.y ?? part.height;
      }
      if (Array.isArray(change.position)) part.position = change.position.slice(0, 3);
      if (change.live) {
        scheduleShare(false);
        api.bus.emit('project:reverted', doc);
        return;
      }
      remember();
      api.bus.emit('project:reverted', doc);
    });
    api.bus.on('project:describe', (kind) => {
      api.bus.emit('project:described', describePart(kind));
    });
    api.bus.on('project:describe-many', (kinds) => {
      const list = (Array.isArray(kinds) ? kinds : []).map((kind) => describePart(kind)).filter(Boolean);
      api.bus.emit('project:described-many', list);
    });
    api.bus.on('project:patch', (change) => {
      if (sessionMode === 'live') return;
      const requested = Array.isArray(change?.kinds) ? change.kinds : (change?.kind ? [change.kind] : []);
      const ids = requested.filter((id) => id && !lockIds.has(id));
      if (!ids.length) {
        if (requested.some((id) => lockIds.has(id))) api.bus.emit('project:reverted', doc);
        return;
      }
      let any = false;
      for (const id of ids) {
        const part = findPart(id);
        if (!part) continue;
        const isPlate = id === 'baseplate' || part === doc.baseplate;
        if (typeof change.emissive === 'boolean' && !isPlate) {
          if (!!part.emissive !== change.emissive) {
            part.emissive = change.emissive;
            any = true;
          }
        }
        if (Number.isFinite(change.emissiveIntensity) && !isPlate) {
          const next = Math.max(0, Math.min(20, change.emissiveIntensity));
          if (part.emissiveIntensity !== next) {
            part.emissiveIntensity = next;
            any = true;
          }
        }
        if (change.physics && typeof change.physics === 'object' && !isPlate) {
          const prev = part.physics && typeof part.physics === 'object' ? { ...part.physics } : {};
          const next = { ...prev };
          const src = change.physics;
          if (typeof src.canCollide === 'boolean') next.canCollide = src.canCollide;
          if (typeof src.enabled === 'boolean') next.enabled = src.enabled;
          if (typeof src.gravity === 'boolean') next.gravity = src.gravity;
          if (Number.isFinite(src.gravityScale)) next.gravityScale = Math.max(0, Math.min(20, src.gravityScale));
          if (Number.isFinite(src.massOverride)) next.massOverride = Math.max(0, src.massOverride);
          if (Number.isFinite(src.linearDamping)) next.linearDamping = Math.max(0, Math.min(10, src.linearDamping));
          if (Number.isFinite(src.angularDamping)) next.angularDamping = Math.max(0, Math.min(10, src.angularDamping));
          if (typeof src.startAsleep === 'boolean') next.startAsleep = src.startAsleep;
          if (JSON.stringify(prev) !== JSON.stringify(next)) {
            part.physics = next;
            any = true;
          }
        }
        if (change.camera && typeof change.camera === 'object' && part.shape === 'camera') {
          const prev = normalizeCamera(part.camera);
          const next = normalizeCamera({ ...prev, ...change.camera });
          if (JSON.stringify(prev) !== JSON.stringify(next)) {
            part.camera = next;
            any = true;
          }
        }
        if (change.script && typeof change.script === 'object' && part.shape === 'script') {
          const prev = normalizeScript(part.script);
          const next = normalizeScript({ ...prev, ...change.script });
          if (JSON.stringify(prev) !== JSON.stringify(next)) {
            part.script = next;
            any = true;
          }
        }
      }
      if (!any) return;
      if (change.live) {
        scheduleShare(false);
        api.bus.emit('project:reverted', doc);
        return;
      }
      remember();
      api.bus.emit('project:reverted', doc);
    });
    api.bus.on('project:recolor', (change) => {
      if (sessionMode === 'live') return;
      const requested = Array.isArray(change?.kinds) ? change.kinds : [];
      const ids = requested.filter((id) => !lockIds.has(id));
      const color = typeof change?.color === 'string' ? change.color : '';
      if (!ids.length || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        if (requested.some((id) => lockIds.has(id))) api.bus.emit('project:reverted', doc);
        return;
      }
      const next = color.toLowerCase();
      let any = false;
      for (const id of ids) {
        const part = findPart(id);
        if (!part || part.color === next) continue;
        part.color = next;
        any = true;
      }
      if (!any) return;
      if (change.live) {
        scheduleShare(false);
        api.bus.emit('project:reverted', doc);
        return;
      }
      remember();
      api.bus.emit('project:reverted', doc);
    });
    api.bus.on('project:folders', (next) => {
      if (sessionMode === 'live') return;
      if (!next) return;
      doc.folders = Array.isArray(next.folders) ? next.folders.map((folder) => ({
        id: folder.id,
        name: folder.name || 'Folder',
        parent: folder.parent || null,
      })) : [];
      doc.placement = next.placement && typeof next.placement === 'object' ? { ...next.placement } : {};
      doc.nextFolder = Number.isFinite(next.nextFolder) && next.nextFolder >= 1 ? next.nextFolder : 1;
      remember();
      // Viewport needs the new placement so Cameras can attach to their parent Parts.
      api.bus.emit('project:reverted', doc);
    });
    api.bus.on('project:folders-request', () => {
      api.bus.emit('project:folders-state', {
        folders: doc.folders || [],
        placement: doc.placement || {},
        nextFolder: doc.nextFolder || 1,
      });
    });
    api.bus.on('project:delete', (kind) => {
      if (sessionMode === 'live') return;
      if (lockIds.has(kind)) {
        api.bus.emit('project:reverted', doc);
        return;
      }
      if (kind === 'baseplate') {
        if (!doc.baseplate) return;
        doc.baseplate = null;
      } else {
        const index = (doc.parts || []).findIndex((part) => part.id === kind);
        if (index < 0) return;
        doc.parts.splice(index, 1);
      }
      if (doc.placement && Object.prototype.hasOwnProperty.call(doc.placement, kind)) delete doc.placement[kind];
      remember();
      api.bus.emit('project:reverted', doc);
      api.bus.emit('scene:select', null);
    });
    api.bus.on('edit:command', (id) => {
      if (sessionMode === 'live') return;
      if (id === 'undo') applyHistory(cursor - 1);
      else if (id === 'redo') applyHistory(cursor + 1);
    });
    api.bus.on('history:request', announce);
    api.bus.on('project:request', publish);
    api.bus.on('project:users-request', () => api.bus.emit('project:users', { ...userCounts }));
    api.bus.on('project:presence-request', () => api.bus.emit('project:presence', lastPeople));
    api.bus.on('project:edit', (next) => {
      if (sessionMode === 'live') return;
      doc = JSON.parse(JSON.stringify(next));
      remember();
      publish();
    });
    resetHistory();
    publish();
    ensureProjectsDir().catch((err) => api.log(err));
    api.bus.emit('project:users', { ...userCounts });
    api.bus.emit('mode:changed', sessionMode);
    publishChat(true);
    // Hot reload clears the open path; put the last project back before any
    // presence heartbeat so we never delete sessions or flash empty avatars.
    enqueue(async () => {
      let last = '';
      try { last = localStorage.getItem('gw-last-project') || ''; } catch { /* private mode */ }
      if (last && !filePath) {
        try {
          if (await api.host.fs.exists(last)) await loadProject(last);
        } catch (err) {
          api.log(err);
        }
      }
      if (!alive) return;
      presenceReady = true;
      presenceTick();
    });
    const abandonPresence = () => { leavePresence().catch(() => {}); };
    window.addEventListener('pagehide', abandonPresence);
    api.onDispose(() => {
      alive = false;
      presenceEpoch += 1;
      clearInterval(pullTimer);
      clearInterval(presenceTimer);
      window.removeEventListener('pagehide', abandonPresence);
      clearTimeout(shareTimer);
      if (watchId) api.host.fs.unwatch(watchId).catch(() => {});
      // Do not delete the session file or clear remote avatars here. Hot reload
      // remounts in under a second and reuses the same session id; wiping caused
      // everyone to teleport. A real window close hits pagehide, and stale
      // sessions still age out after a few seconds with no heartbeat.
      // Bumping presenceEpoch also cancels in-flight writes so they cannot
      // overwrite the remounted module's fresher pose on disk.
      clearHistory();
    });
  },
};
