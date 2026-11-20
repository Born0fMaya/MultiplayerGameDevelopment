// Windows-style taskbar along the bottom of the window.
export const order = -9;

const HEIGHT = '48px';

const LOGO = `
  <svg viewBox="0 0 28 22" width="22" height="17" aria-hidden="true">
    <rect x="0" y="0" width="28" height="5" rx="2.5" fill="currentColor"/>
    <rect x="0" y="8.5" width="28" height="5" rx="2.5" fill="currentColor"/>
    <rect x="0" y="17" width="28" height="5" rx="2.5" fill="currentColor"/>
  </svg>`;

const EXPLORER_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M1.6 3.2A1.4 1.4 0 0 1 3 1.8h3.1l1.2 1.3H13a1.4 1.4 0 0 1 1.4 1.4v7.3A1.4 1.4 0 0 1 13 13.2H3a1.4 1.4 0 0 1-1.4-1.4V3.2z"/>
  </svg>`;

const PROPERTIES_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M2.2 4.2h11.6M2.2 8h11.6M2.2 11.8h11.6"/>
    <circle cx="5.2" cy="4.2" r="1.5" fill="currentColor"/>
    <circle cx="10.6" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="6.4" cy="11.8" r="1.5" fill="currentColor"/>
  </svg>`;

const CHAT_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M2.4 3.2h11.2v7.2H8.4L5.2 13V10.4H2.4z"/>
  </svg>`;

const ASSISTANT_ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="8" cy="8" r="2.2" fill="currentColor"/>
    <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
      d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1"/>
  </svg>`;

export default {
  mount(root, api) {
    document.documentElement.style.setProperty('--gw-taskbar-h', HEIGHT);
    root.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      `height:${HEIGHT}`,
      'z-index:30',
      'display:flex',
      'align-items:center',
      'justify-content:flex-start',
      'padding:0 8px',
      'background:var(--gw-bg, #1c1c1c)',
      'border-top:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'color:var(--gw-text, #e8eaed)',
      'font:13px/1 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'user-select:none',
    ].join(';');

    const start = document.createElement('button');
    start.type = 'button';
    start.title = 'Start';
    start.setAttribute('aria-label', 'Start');
    start.innerHTML = LOGO;
    start.style.cssText = [
      'appearance:none',
      'border:0',
      'margin:0',
      'width:40px',
      'height:40px',
      'padding:0',
      'display:grid',
      'place-items:center',
      'border-radius:6px',
      'background:transparent',
      'color:var(--gw-text, #e8eaed)',
      'cursor:default',
    ].join(';');
    const menu = document.createElement('div');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Start');
    menu.style.cssText = [
      'position:absolute',
      'left:8px',
      'bottom:calc(100% + 8px)',
      'width:min(640px, calc(100vw - 24px))',
      'height:min(640px, calc(100vh - var(--gw-taskbar-h, 48px) - var(--gw-menu-h, 30px) - var(--gw-toolbar-h, 52px) - 36px))',
      'background:var(--gw-bg, #1c1c1c)',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:8px',
      'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
    ].join(';');

    let open = false;
    let over = false;
    let pressed = false;
    const paint = () => {
      start.style.background = pressed
        ? 'var(--gw-press)'
        : (open || over) ? 'var(--gw-hover)' : 'transparent';
    };
    const setOpen = (next) => {
      open = next;
      menu.hidden = !open;
      start.setAttribute('aria-expanded', open ? 'true' : 'false');
      paint();
    };

    start.setAttribute('aria-expanded', 'false');
    start.setAttribute('aria-haspopup', 'menu');
    start.addEventListener('mouseenter', () => { over = true; paint(); });
    start.addEventListener('mouseleave', () => { over = false; pressed = false; paint(); });
    start.addEventListener('mousedown', () => { pressed = true; paint(); });
    start.addEventListener('mouseup', () => { pressed = false; paint(); });
    start.addEventListener('click', () => setOpen(!open));

    const apps = document.createElement('div');
    apps.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;padding:8px;';
    const addApp = (label, icon, id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `${icon}<span>${label}</span>`;
      button.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:10px',
        'min-width:180px',
        'appearance:none',
        'border:0',
        'margin:0',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'text-align:left',
        'padding:8px 10px',
        'border-radius:4px',
        'cursor:default',
      ].join(';');
      button.addEventListener('mouseenter', () => { button.style.background = 'var(--gw-hover)'; });
      button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
      button.addEventListener('click', () => {
        setOpen(false);
        api.bus.emit('app:open', id);
      });
      apps.append(button);
    };
    addApp('Explorer', EXPLORER_ICON, 'explorer');
    addApp('Properties', PROPERTIES_ICON, 'properties');
    addApp('Chat', CHAT_ICON, 'chat');
    addApp('Assistant', ASSISTANT_ICON, 'assistant');
    menu.append(apps);

    const tasks = document.createElement('div');
    tasks.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:6px;min-width:0;flex:1;overflow:hidden;';
    const windows = new Map();

    const renderTasks = () => {
      tasks.replaceChildren();
      for (const win of windows.values()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.windowId = win.id;
        button.title = win.title;
        button.setAttribute('aria-label', win.title);
        const shown = win.open && !win.minimized;
        const label = document.createElement('span');
        label.textContent = win.title;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        if (win.icon) button.insertAdjacentHTML('afterbegin', win.icon);
        button.append(label);
        button.style.cssText = [
          'appearance:none',
          'border:0',
          'margin:0',
          'height:40px',
          'max-width:180px',
          'min-width:48px',
          'padding:0 12px',
          'display:flex',
          'align-items:center',
          'gap:8px',
          'border-radius:4px',
          'background:' + (shown && win.active ? 'var(--gw-press)' : 'transparent'),
          'box-shadow:' + (shown ? 'inset 0 -2px 0 rgba(232,234,237,.85)' : 'none'),
          'color:inherit',
          'font:inherit',
          'cursor:default',
        ].join(';');
        button.addEventListener('mouseenter', () => {
          if (!(shown && win.active)) button.style.background = 'var(--gw-hover)';
        });
        button.addEventListener('mouseleave', () => {
          button.style.background = shown && win.active ? 'var(--gw-press)' : 'transparent';
        });
        button.addEventListener('click', () => {
          setOpen(false);
          api.bus.emit('window:command', { id: win.id, action: 'toggle' });
        });
        tasks.append(button);
      }
    };

    api.bus.on('window:changed', (win) => {
      if (!win?.id) return;
      if (!win.open) windows.delete(win.id);
      else windows.set(win.id, win);
      renderTasks();
    });
    api.bus.emit('window:request');

    const onPointerDown = (e) => {
      if (open && !root.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);

    root.append(start, tasks, menu);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.removeProperty('--gw-taskbar-h');
    };
  },
};
