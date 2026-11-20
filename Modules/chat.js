// Project chat. Messages travel in the same presence heartbeat as avatars.
import { frameWindow } from '/Assets/lib/window.js?v=11';

export const order = 7;

const ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M2.4 3.2h11.2v7.2H8.4L5.2 13V10.4H2.4z"/>
  </svg>`;

export default {
  mount(root, api) {
    const frame = frameWindow(root, api, {
      id: 'chat',
      title: 'Chat',
      icon: ICON,
      width: 320,
      height: 420,
      left: 36,
      top: 96,
    });

    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;user-select:text;';
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;';
    const composer = document.createElement('div');
    composer.style.cssText = 'display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--gw-line, rgba(255,255,255,.08));';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = 'Message';
    input.spellcheck = true;
    input.autocomplete = 'off';
    input.style.cssText = [
      'flex:1',
      'min-width:0',
      'height:30px',
      'box-sizing:border-box',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:4px',
      'background:var(--gw-well, #1c1c1c)',
      'color:var(--gw-text, #e8eaed)',
      'font:13px/1 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'padding:0 10px',
      'user-select:text',
    ].join(';');
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'Send';
    send.style.cssText = [
      'appearance:none',
      'border:0',
      'margin:0',
      'height:30px',
      'padding:0 12px',
      'border-radius:4px',
      'background:var(--gw-press)',
      'color:inherit',
      'font:inherit',
      'cursor:default',
      'flex:0 0 auto',
    ].join(';');
    composer.append(input, send);
    wrap.append(list, composer);
    frame.body.append(wrap);

    let ready = false;
    let messages = [];
    let painted = '';
    let stickBottom = true;

    const paint = () => {
      const shot = `${ready ? 1 : 0}\n${messages.map((item) => item.id).join('\n')}`;
      if (shot === painted) return;
      painted = shot;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      input.disabled = !ready;
      send.disabled = !ready;
      input.style.opacity = ready ? '1' : '0.55';
      send.style.opacity = ready ? '1' : '0.55';
      const keepFocus = document.activeElement === input;
      list.replaceChildren();
      if (!messages.length) {
        const empty = document.createElement('div');
        empty.textContent = ready ? 'No messages yet.' : 'Open or save a project to chat with other users.';
        empty.style.cssText = 'color:var(--gw-muted, #aeb4bb);padding:8px 0;';
        list.append(empty);
      } else {
        const frag = document.createDocumentFragment();
        for (const message of messages) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
          const head = document.createElement('div');
          head.style.cssText = 'display:flex;align-items:center;gap:8px;font:12px;';
          const swatch = document.createElement('span');
          swatch.style.cssText = `width:8px;height:8px;border-radius:50%;background:${message.color || '#5b9dff'};flex:0 0 auto;`;
          const name = document.createElement('span');
          name.textContent = message.name || 'User';
          name.style.cssText = 'color:var(--gw-text, #e8eaed);font-weight:600;';
          const when = document.createElement('span');
          const date = new Date(message.at || Date.now());
          when.textContent = Number.isFinite(date.getTime())
            ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : '';
          when.style.cssText = 'color:var(--gw-muted, #aeb4bb);margin-left:auto;';
          head.append(swatch, name, when);
          const body = document.createElement('div');
          body.textContent = message.text || '';
          body.style.cssText = 'color:var(--gw-text, #e8eaed);white-space:pre-wrap;word-break:break-word;line-height:1.35;';
          row.append(head, body);
          frag.append(row);
        }
        list.append(frag);
      }
      if (stickBottom || nearBottom) list.scrollTop = list.scrollHeight;
      if (keepFocus) input.focus({ preventScroll: true });
    };

    const sendMessage = () => {
      if (!ready) return false;
      const text = input.value.trim();
      if (!text) return false;
      api.bus.emit('chat:send', { text });
      input.value = '';
      stickBottom = true;
      input.focus({ preventScroll: true });
      return true;
    };

    list.addEventListener('scroll', () => {
      stickBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    });
    send.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());

    api.bus.on('app:open', (id) => {
      if (id !== 'chat') return;
      frame.show();
      api.bus.emit('chat:request');
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    });
    api.bus.on('project:chat', (state) => {
      // Presence hot-reload can leave stale timers that spam ready:false.
      // Only clear the composer when the project module really closed, or
      // when nothing is open and we have no remembered project path.
      if (state?.ready) {
        ready = true;
        messages = Array.isArray(state.messages) ? state.messages : messages;
        paint();
        return;
      }
      let remembered = '';
      try { remembered = localStorage.getItem('gw-last-project') || ''; } catch { /* private mode */ }
      if (!state?.closed && remembered && ready) {
        if (Array.isArray(state?.messages) && state.messages.length) messages = state.messages;
        paint();
        return;
      }
      ready = false;
      messages = Array.isArray(state?.messages) ? state.messages : [];
      paint();
    });
    api.bus.emit('chat:request');
    paint();

    return () => {};
  },
};
