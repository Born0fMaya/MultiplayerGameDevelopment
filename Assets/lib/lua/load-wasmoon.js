// ESM shim around the UMD wasmoon build + local glue.wasm.
let cached = null;

export async function loadWasmoon() {
  if (cached) return cached;
  if (globalThis.wasmoon?.LuaFactory) {
    cached = globalThis.wasmoon;
    return cached;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/Assets/lib/lua/wasmoon.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load wasmoon.js'));
    document.head.append(script);
  });
  if (!globalThis.wasmoon?.LuaFactory) throw new Error('wasmoon failed to initialize');
  cached = globalThis.wasmoon;
  return cached;
}

export async function createLuaFactory() {
  const wasmoon = await loadWasmoon();
  const wasmUrl = new URL('/Assets/lib/lua/glue.wasm', window.location.href).href;
  return new wasmoon.LuaFactory(wasmUrl);
}
