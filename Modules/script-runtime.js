// Live Mode script runner — Lua scripts execute with a Roblox-like API.
import { createRobloxRuntime } from '/Assets/lib/roblox-runtime.js?v=6';

export const order = 1;

export default {
  mount(root, api) {
    root.style.display = 'none';

    let runtime = null;
    let starting = null;
    let live = false;

    const world = () => window.__gwScriptApi || null;

    const stop = () => {
      live = false;
      starting = null;
      if (!runtime) return;
      try { runtime.stop(); } catch (err) { api.log(err); }
      runtime = null;
    };

    const start = async () => {
      if (live && runtime) return;
      const apiWorld = world();
      if (!apiWorld) {
        console.warn('[script-runtime] viewport script API not ready');
        return;
      }
      const token = {};
      starting = token;
      live = true;
      try {
        const next = await createRobloxRuntime({
          log: (text) => console.log(`[script] ${text}`),
          warn: (text) => console.warn(`[script] ${text}`),
          getRecord: (id) => apiWorld.getRecord?.(id) ?? null,
          getChildren: (id) => apiWorld.getChildren?.(id) ?? [],
          getDescendants: (id) => apiWorld.getDescendants?.(id) ?? [],
          findFirstChild: (id, name) => apiWorld.findFirstChild?.(id, name) ?? null,
          getCharacterId: () => apiWorld.getCharacterId?.() ?? null,
          getCameraId: () => apiWorld.getCameraId?.() ?? null,
          getCameraBasis: () => apiWorld.getCameraBasis?.() ?? null,
          isGrounded: (id) => !!apiWorld.isGrounded?.(id),
          setProp: (id, key, value) => apiWorld.setProp?.(id, key, value),
          destroy: (id) => apiWorld.destroy?.(id),
          clone: (id) => apiWorld.clone?.(id) ?? null,
          instanceNew: (className) => apiWorld.instanceNew?.(className) ?? null,
          applyImpulse: (id, impulse) => apiWorld.applyImpulse?.(id, impulse),
          setVelocity: (id, velocity) => apiWorld.setVelocity?.(id, velocity),
          getVelocity: (id) => apiWorld.getVelocity?.(id) ?? { x: 0, y: 0, z: 0 },
          isKeyDown: (code) => !!apiWorld.isKeyDown?.(code),
        });
        if (starting !== token || !live) {
          try { next.stop(); } catch { /* superseded */ }
          return;
        }
        runtime = next;
        const scripts = apiWorld.listScripts?.() || [];
        await runtime.start(scripts);
        console.log(`[script-runtime] started ${scripts.filter((s) => s.enabled !== false && String(s.source || '').trim()).length} script(s)`);
      } catch (err) {
        console.error('[script-runtime] failed to start', err);
        stop();
      } finally {
        if (starting === token) starting = null;
      }
    };

    api.bus.on('mode:changed', (mode) => {
      if (mode === 'live') start();
      else stop();
    });

    api.bus.on('script:tick', (dt) => {
      if (!runtime || !live) return;
      runtime.tick(dt);
    });

    api.bus.on('script:input', (payload) => {
      if (!runtime || !live) return;
      runtime.input(payload?.kind, payload);
    });

    api.onDispose(stop);
    api.bus.emit('mode:request');
  },
};
