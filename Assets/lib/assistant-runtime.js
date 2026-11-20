// GameWindow-owned Ollama runtime. Serves on a private port with an isolated
 // models folder so closing the app kills this AI (Job Object + process.kill).

export const ASSISTANT_HOST = '127.0.0.1';
export const ASSISTANT_PORT = 11435;
export const ASSISTANT_BASE = `http://${ASSISTANT_HOST}:${ASSISTANT_PORT}`;
export const ASSISTANT_MODEL = 'qwen3:4b';

const PULL_TIMEOUT_MS = 60 * 60 * 1000;
const READY_TIMEOUT_MS = 90_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function localAppData(api) {
  try {
    const r = await api.host.process.exec('cmd', ['/c', 'echo', '%LOCALAPPDATA%'], { timeoutMs: 5000 });
    const line = String(r?.stdout || '').trim().replace(/"/g, '');
    if (line && !line.includes('%')) return line;
  } catch { /* fall through */ }
  return null;
}

async function findOllama(api) {
  try {
    const r = await api.host.process.exec('where', ['ollama'], { timeoutMs: 8000 });
    const line = String(r?.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (line) return line;
  } catch { /* keep looking */ }
  try {
    const local = await localAppData(api);
    if (local) {
      const path = `${local}\\Programs\\Ollama\\ollama.exe`;
      if (await api.host.fs.exists(path)) return path;
    }
  } catch { /* keep looking */ }
  return null;
}

export function createAssistantRuntime(api) {
  let serveId = 0;
  let disposed = false;
  let status = 'offline';
  let statusDetail = '';
  const listeners = new Set();

  const setStatus = (next, detail = '') => {
    status = next;
    statusDetail = detail || '';
    for (const fn of [...listeners]) {
      try { fn({ status, detail: statusDetail }); } catch (err) { api.log(err); }
    }
  };

  const onStatus = (fn) => {
    listeners.add(fn);
    fn({ status, detail: statusDetail });
    return () => listeners.delete(fn);
  };

  const fetchJson = async (path, options = {}) => {
    const res = await api.host.http.fetch(`${ASSISTANT_BASE}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || { 'Content-Type': 'application/json' },
      body: options.body,
      responseType: 'json',
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    if (!res?.ok) {
      const msg = typeof res?.body === 'string' ? res.body : (res?.body?.error || res?.statusText || 'request failed');
      throw new Error(msg);
    }
    return res.body;
  };

  const waitReady = async () => {
    const start = Date.now();
    while (!disposed && Date.now() - start < READY_TIMEOUT_MS) {
      try {
        const tags = await fetchJson('/api/tags', { timeoutMs: 4000 });
        if (tags) return tags;
      } catch { /* not up yet */ }
      await sleep(400);
    }
    throw new Error('Local AI server did not become ready in time.');
  };

  const hasModel = async (name) => {
    const tags = await fetchJson('/api/tags', { timeoutMs: 8000 });
    const models = Array.isArray(tags?.models) ? tags.models : [];
    return models.some((m) => {
      const n = String(m?.name || m?.model || '');
      return n === name || n.startsWith(`${name}:`) || n.split(':')[0] === name.split(':')[0];
    });
  };

  const pullModel = async (name, onProgress) => {
    setStatus('downloading', `Downloading ${name}…`);
    // Non-stream pull is simpler and reliable for first-run.
    await fetchJson('/api/pull', {
      method: 'POST',
      body: { name, stream: false },
      timeoutMs: PULL_TIMEOUT_MS,
    });
    onProgress?.(1);
  };

  const ensure = async () => {
    if (disposed) throw new Error('Assistant runtime disposed.');
    if (status === 'ready') return { model: ASSISTANT_MODEL };

    setStatus('starting', 'Starting local AI…');
    const info = await api.host.host.info();
    const root = info?.root || '';
    const modelsDir = `${root}\\Storage\\ollama\\models`;
    try { await api.host.fs.mkdir('Storage/ollama/models'); } catch { /* exists */ }

    if (!serveId) {
      const ollama = await findOllama(api);
      if (!ollama) {
        setStatus('offline', 'Ollama is not installed. Install Ollama, then reopen Assistant.');
        throw new Error('Ollama executable not found.');
      }

      const started = await api.host.process.start(ollama, ['serve'], {
        stream: true,
        env: {
          OLLAMA_HOST: `${ASSISTANT_HOST}:${ASSISTANT_PORT}`,
          OLLAMA_MODELS: modelsDir,
        },
      });
      serveId = started?.id || 0;
      if (!serveId) throw new Error('Failed to start local AI process.');
    }

    await waitReady();
    if (!(await hasModel(ASSISTANT_MODEL))) {
      await pullModel(ASSISTANT_MODEL);
    }
    if (!(await hasModel(ASSISTANT_MODEL))) {
      setStatus('offline', `Model ${ASSISTANT_MODEL} is missing.`);
      throw new Error(`Model ${ASSISTANT_MODEL} failed to install.`);
    }
    setStatus('ready', ASSISTANT_MODEL);
    return { model: ASSISTANT_MODEL };
  };

  const abortStream = (id) => {
    if (!id) return;
    try { api.host.http.abort(id); } catch { /* already ended */ }
  };

  const stripThink = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^[\s\S]*?<\/think>/i, '')
      .trim();
  };

  /** Non-streaming chat — preferred for tool rounds (reliable on local Ollama). */
  const chat = async (payload, { signal } = {}) => {
    if (signal?.aborted) return { role: 'assistant', content: '', aborted: true };
    const body = await fetchJson('/api/chat', {
      method: 'POST',
      body: { ...payload, stream: false },
      timeoutMs: 10 * 60 * 1000,
    });
    if (signal?.aborted) return { role: 'assistant', content: '', aborted: true };
    const msg = body?.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined;
    return {
      role: 'assistant',
      content: stripThink(msg.content || ''),
      thinking: typeof msg.thinking === 'string' ? msg.thinking : undefined,
      tool_calls: toolCalls,
    };
  };

  /**
   * Stream an Ollama /api/chat request. onEvent receives parsed NDJSON objects.
   * Returns the final assembled message { role, content, tool_calls }.
   */
  const chatStream = async (payload, { onEvent, signal } = {}) => {
    let streamId = 0;
    let buffer = '';
    let content = '';
    let thinking = '';
    const toolCalls = [];
    let finished = null;
    let ended = false;

    const handleChunk = (text) => {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj;
        try { obj = JSON.parse(trimmed); } catch { continue; }
        onEvent?.(obj);
        const msg = obj.message || {};
        if (typeof msg.content === 'string' && msg.content) content += msg.content;
        if (typeof msg.thinking === 'string' && msg.thinking) thinking += msg.thinking;
        if (Array.isArray(msg.tool_calls)) {
          for (const call of msg.tool_calls) toolCalls.push(call);
        }
        if (obj.done) {
          finished = {
            role: 'assistant',
            content,
            thinking: thinking || undefined,
            tool_calls: toolCalls.length ? toolCalls : undefined,
          };
        }
      }
    };

    const offChunk = api.host.on('http.chunk', (data) => {
      if (!data || data.id !== streamId) return;
      handleChunk(String(data.text || ''));
    });
    let streamError = null;
    const offEnd = api.host.on('http.end', (data) => {
      if (!data || data.id !== streamId) return;
      ended = true;
      if (data.error && data.error !== 'aborted') streamError = data.error;
    });

    try {
      const start = await api.host.http.fetch(`${ASSISTANT_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { ...payload, stream: true },
        stream: true,
        timeoutMs: 10 * 60 * 1000,
      });
      streamId = start?.id || 0;
      if (!streamId) throw new Error('Failed to open chat stream.');

      if (signal) {
        const onAbort = () => abortStream(streamId);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      const deadline = Date.now() + 10 * 60 * 1000;
      while (!ended && Date.now() < deadline) {
        if (signal?.aborted) break;
        await sleep(40);
        if (finished) break;
      }
      if (buffer.trim()) handleChunk('\n');
      if (signal?.aborted) {
        return { role: 'assistant', content: stripThink(content) || '', aborted: true };
      }
      if (streamError) throw new Error(streamError);
      const finalContent = stripThink((finished && finished.content) || content);
      return finished
        ? { ...finished, content: finalContent }
        : {
          role: 'assistant',
          content: finalContent,
          thinking: thinking || undefined,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        };
    } finally {
      offChunk();
      offEnd();
    }
  };

  const dispose = async () => {
    disposed = true;
    listeners.clear();
    if (serveId) {
      const id = serveId;
      serveId = 0;
      try { await api.host.process.kill(id); } catch { /* already dead */ }
    }
    setStatus('offline', '');
  };

  return {
    ASSISTANT_MODEL,
    ASSISTANT_BASE,
    onStatus,
    ensure,
    chat,
    chatStream,
    abortStream,
    dispose,
    get status() { return status; },
    get detail() { return statusDetail; },
  };
}
