// Shared frame for every floating window: drag, resize, and caption buttons.
// Open windows publish on the bus so the taskbar can list them.

const MIN_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3 11.5h10"/></svg>`;
const MAX_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const RESTORE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M5.5 3.5H13V11"/><rect x="3" y="5.5" width="7.5" height="7.5" rx=".5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"/></svg>`;

const EDGES = [
  ['n', 'top:0;left:12px;right:128px;height:6px;cursor:ns-resize'],
  ['s', 'bottom:0;left:12px;right:12px;height:6px;cursor:ns-resize'],
  ['e', 'top:42px;right:0;bottom:12px;width:6px;cursor:ew-resize'],
  ['w', 'top:42px;left:0;bottom:12px;width:6px;cursor:ew-resize'],
  ['nw', 'top:0;left:0;width:12px;height:12px;cursor:nwse-resize'],
  ['ne', 'top:0;right:0;width:12px;height:12px;cursor:nesw-resize'],
  ['sw', 'bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize'],
  ['se', 'bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize'],
];

const SNAP_EDGE = 64;
const SNAP_WIDTH = 320;

const docked = new Map();

function column(side, exceptId) {
  return [...docked.values()]
    .filter((item) => item.side === side && item.id !== exceptId)
    .sort((a, b) => a.anchor - b.anchor || String(a.id).localeCompare(String(b.id)));
}

function placeRect(root, rect) {
  root.style.left = `${rect.left}px`;
  root.style.top = `${rect.top}px`;
  root.style.width = `${rect.width}px`;
  root.style.height = `${rect.height}px`;
  root.style.borderRadius = '0';
}

function stackRects(side, rows) {
  const area = workArea();
  const width = Math.min(SNAP_WIDTH, area.width);
  const left = side === 'left' ? area.left : area.left + area.width - width;
  const count = Math.max(1, rows.length);
  return rows.map((row, index) => {
    const top = area.top + Math.round(index * area.height / count);
    const bottom = index === count - 1
      ? area.top + area.height
      : area.top + Math.round((index + 1) * area.height / count);
    return { id: row.id, left, top, width, height: bottom - top };
  });
}

function layout(side) {
  const rows = column(side);
  if (!rows.length) return;
  const rects = stackRects(side, rows);
  for (const item of rows) {
    const rect = rects.find((entry) => entry.id === item.id);
    if (rect) item.place(rect);
  }
}

function undock(id) {
  const item = docked.get(id);
  if (!item) return;
  docked.delete(id);
  layout(item.side);
}

function slotRect(side, anchor, id) {
  const rows = [...column(side, id), { id, anchor }]
    .sort((a, b) => a.anchor - b.anchor || String(a.id).localeCompare(String(b.id)));
  return stackRects(side, rows).find((entry) => entry.id === id);
}

function snapSide(x) {
  if (x <= SNAP_EDGE) return 'left';
  if (x >= window.innerWidth - SNAP_EDGE) return 'right';
  return null;
}

let snapRoot = null;

function snapUi() {
  if (snapRoot) return snapRoot;
  snapRoot = document.createElement('div');
  snapRoot.dataset.snapRoot = 'true';
  snapRoot.style.cssText = 'position:fixed;inset:0;z-index:22;pointer-events:none;display:none;';
  for (const side of ['left', 'right']) {
    const hint = document.createElement('div');
    hint.dataset.snap = side;
    hint.style.cssText = [
      'position:fixed',
      'width:12px',
      'box-sizing:border-box',
      'border-radius:6px',
      'background:rgba(232,234,237,.28)',
      'border:1px solid rgba(232,234,237,.45)',
    ].join(';');
    snapRoot.append(hint);
  }
  const ghost = document.createElement('div');
  ghost.dataset.snapGhost = 'true';
  ghost.style.cssText = [
    'position:fixed',
    'display:none',
    'box-sizing:border-box',
    'border-radius:8px',
    'background:rgba(28,28,28,.35)',
    'border:1px solid rgba(232,234,237,.5)',
  ].join(';');
  snapRoot.append(ghost);
  document.body.append(snapRoot);
  return snapRoot;
}

function showSnap(side, anchor, id) {
  const ui = snapUi();
  const bounds = workArea();
  ui.style.display = 'block';
  for (const edge of ['left', 'right']) {
    const hint = ui.querySelector(`[data-snap="${edge}"]`);
    const active = side === edge;
    hint.style.display = active ? 'none' : 'block';
    hint.style.top = `${bounds.top}px`;
    hint.style.height = `${bounds.height}px`;
    hint.style.borderRadius = '0';
    hint.style.left = edge === 'left' ? `${bounds.left}px` : `${bounds.left + bounds.width - 12}px`;
  }
  const ghost = ui.querySelector('[data-snap-ghost]');
  if (!side) {
    ghost.style.display = 'none';
    return;
  }
  const rect = slotRect(side, anchor, id);
  ghost.style.display = 'block';
  ghost.style.borderRadius = '0';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
}

function hideSnap() {
  if (!snapRoot) return;
  snapRoot.style.display = 'none';
}

function workArea() {
  const cs = getComputedStyle(document.documentElement);
  const menu = parseFloat(cs.getPropertyValue('--gw-menu-h')) || 30;
  const toolbar = parseFloat(cs.getPropertyValue('--gw-toolbar-h')) || 52;
  const taskbar = parseFloat(cs.getPropertyValue('--gw-taskbar-h')) || 48;
  return {
    left: 0,
    top: menu + toolbar,
    width: window.innerWidth,
    height: Math.max(120, window.innerHeight - menu - toolbar - taskbar),
  };
}

function captionButton(label, svg) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = label.toLowerCase();
  button.setAttribute('aria-label', label);
  button.innerHTML = svg;
  button.style.cssText = [
    'appearance:none',
    'border:0',
    'margin:0',
    'width:40px',
    'height:36px',
    'padding:0',
    'display:grid',
    'place-items:center',
    'background:transparent',
    'color:inherit',
    'cursor:default',
  ].join(';');
  button.addEventListener('mouseenter', () => { button.style.background = 'var(--gw-hover)'; });
  button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
  return button;
}

let stack = 24;

export function frameWindow(root, api, options) {
  const id = options.id;
  let titleText = options.title;
  const icon = options.icon || '';
  const minWidth = options.minWidth ?? 220;
  const minHeight = options.minHeight ?? 160;

  root.dataset.window = id;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', titleText);
  root.style.cssText = [
    'position:fixed',
    'z-index:25',
    'display:none',
    'box-sizing:border-box',
    'flex-direction:column',
    'background:var(--gw-bg, #1c1c1c)',
    'color:var(--gw-text, #e8eaed)',
    'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
    'border-radius:8px',
    'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
    'font:13px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
    'user-select:none',
    'overflow:hidden',
  ].join(';');

  const area = workArea();
  const defaultLeft = options.left ?? 16;
  const defaultTop = options.top ?? 16;
  const defaultWidth = options.width ?? 280;
  const defaultHeight = options.height ?? 320;
  const defaultSnap = options.snap === 'left' || options.snap === 'right' ? options.snap : null;
  const normal = {
    left: area.left + defaultLeft,
    top: area.top + defaultTop,
    width: defaultWidth,
    height: defaultHeight,
  };
  const placeNormal = () => {
    root.style.left = `${normal.left}px`;
    root.style.top = `${normal.top}px`;
    root.style.width = `${normal.width}px`;
    root.style.height = `${normal.height}px`;
    root.style.borderRadius = '8px';
  };
  placeNormal();

  const title = document.createElement('div');
  title.dataset.caption = 'true';
  title.style.cssText = [
    'display:flex',
    'align-items:center',
    'height:36px',
    'padding-left:12px',
    'border-bottom:1px solid var(--gw-line, rgba(255,255,255,.08))',
    'cursor:default',
    'flex:0 0 auto',
  ].join(';');
  if (icon) {
    const mark = document.createElement('span');
    mark.innerHTML = icon;
    mark.style.cssText = 'display:grid;place-items:center;margin-right:8px;flex:0 0 auto;';
    title.append(mark);
  }
  const heading = document.createElement('span');
  heading.textContent = titleText;
  heading.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:stretch;height:100%;flex:0 0 auto;';
  const minButton = captionButton('Minimize', MIN_ICON);
  const maxButton = captionButton('Maximize', MAX_ICON);
  const closeButton = captionButton('Close', CLOSE_ICON);
  controls.append(minButton, maxButton, closeButton);
  title.append(heading, controls);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;user-select:text;';

  const handles = EDGES.map(([edge, style]) => {
    const handle = document.createElement('div');
    handle.dataset.resize = edge;
    handle.style.cssText = `position:absolute;z-index:2;${style}`;
    return handle;
  });

  root.append(title, body, ...handles);

  let opened = false;
  let minimized = false;
  let maximized = false;
  let snapped = defaultSnap;
  let anchor = workArea().top + workArea().height / 2;
  let active = false;

  const resetToDefault = () => {
    const next = workArea();
    maximized = false;
    if (snapped) undock(id);
    snapped = null;
    normal.left = next.left + defaultLeft;
    normal.top = next.top + defaultTop;
    normal.width = defaultWidth;
    normal.height = defaultHeight;
    const visible = opened && !minimized;
    if (defaultSnap) {
      snapped = defaultSnap;
      anchor = next.top + next.height / 2;
      if (visible) applySnap(defaultSnap, anchor);
    } else if (visible) {
      placeNormal();
    }
    paint();
    publish();
    if (visible) focus();
  };

  const publish = () => {
    api.bus.emit('window:changed', { id, title: titleText, icon, open: opened, minimized, maximized, active });
  };

  const paint = () => {
    root.style.borderColor = active ? 'rgba(255,255,255,.18)' : 'var(--gw-line, rgba(255,255,255,.08))';
    root.style.borderRadius = (maximized || snapped) ? '0' : '8px';
    root.style.boxShadow = (maximized || snapped) ? 'none' : 'var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))';
    root.dataset.snapped = snapped || '';
    maxButton.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    maxButton.dataset.action = maximized ? 'restore' : 'maximize';
    maxButton.innerHTML = maximized ? RESTORE_ICON : MAX_ICON;
    for (const handle of handles) handle.style.display = (maximized || snapped) ? 'none' : 'block';
  };

  const applySnap = (side, nextAnchor) => {
    const previous = docked.get(id);
    if (previous && previous.side !== side) {
      docked.delete(id);
      layout(previous.side);
    }
    snapped = side;
    anchor = nextAnchor;
    docked.set(id, {
      id,
      side,
      anchor,
      place: (rect) => placeRect(root, rect),
    });
    layout(side);
  };

  const bringToFront = () => {
    stack = Math.min(stack + 1, 28);
    root.style.zIndex = String(stack);
  };

  const remember = () => {
    const rect = root.getBoundingClientRect();
    normal.left = rect.left;
    normal.top = rect.top;
    normal.width = rect.width;
    normal.height = rect.height;
  };

  const applyMax = () => {
    const next = workArea();
    root.style.left = `${next.left}px`;
    root.style.top = `${next.top}px`;
    root.style.width = `${next.width}px`;
    root.style.height = `${next.height}px`;
    root.style.borderRadius = '0';
  };

  const focus = () => {
    if (!opened || minimized) return;
    bringToFront();
    api.bus.emit('window:focus', id);
  };

  const show = () => {
    opened = true;
    minimized = false;
    root.style.display = 'flex';
    if (maximized) applyMax();
    else if (snapped) applySnap(snapped, anchor);
    else placeNormal();
    paint();
    bringToFront();
    api.bus.emit('window:focus', id);
  };

  const minimize = () => {
    if (!opened) return;
    if (!maximized && !snapped) remember();
    if (snapped) undock(id);
    minimized = true;
    active = false;
    root.style.display = 'none';
    paint();
    publish();
  };

  const hide = () => {
    if (!maximized && !snapped) remember();
    if (snapped) undock(id);
    opened = false;
    minimized = false;
    active = false;
    root.style.display = 'none';
    paint();
    publish();
  };

  const maximize = () => {
    if (!opened) return;
    if (minimized) {
      minimized = false;
      root.style.display = 'flex';
    }
    if (!maximized && !snapped) remember();
    if (snapped) undock(id);
    snapped = null;
    maximized = true;
    applyMax();
    paint();
    focus();
  };

  const restore = () => {
    maximized = false;
    if (snapped) undock(id);
    snapped = null;
    if (minimized) {
      minimized = false;
      root.style.display = 'flex';
    }
    placeNormal();
    paint();
    focus();
  };

  const toggleMaximize = () => {
    if (maximized) restore();
    else maximize();
  };

  minButton.addEventListener('click', (e) => { e.stopPropagation(); minimize(); });
  maxButton.addEventListener('click', (e) => { e.stopPropagation(); toggleMaximize(); });
  closeButton.addEventListener('click', (e) => { e.stopPropagation(); hide(); });

  let drag = null;
  title.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || controls.contains(e.target)) return;
    const rect = root.getBoundingClientRect();
    drag = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      x: e.clientX,
      y: e.clientY,
      fromMax: maximized,
      fromSnap: !!snapped,
      moved: false,
      side: null,
      home: { left: normal.left, top: normal.top, width: normal.width, height: normal.height },
    };
    e.preventDefault();
  });
  title.addEventListener('dblclick', (e) => {
    if (controls.contains(e.target)) return;
    toggleMaximize();
  });

  let resize = null;
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || maximized || snapped) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      resize = { edge: handle.dataset.resize, left: rect.left, top: rect.top, width: rect.width, height: rect.height, x: e.clientX, y: e.clientY };
    });
  }

  const onPointerMove = (e) => {
    if (drag) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      if (drag.fromMax || drag.fromSnap) {
        const ratio = Math.min(1, Math.max(0, drag.dx / Math.max(1, root.offsetWidth)));
        restore();
        drag.dx = normal.width * ratio;
        drag.dy = Math.min(drag.dy, 24);
        drag.fromMax = false;
        drag.fromSnap = false;
      }
      drag.moved = true;
      const bounds = workArea();
      const width = root.offsetWidth;
      const left = Math.min(bounds.left + bounds.width - 80, Math.max(bounds.left, e.clientX - drag.dx));
      const top = Math.min(bounds.top + bounds.height - 36, Math.max(bounds.top, e.clientY - drag.dy));
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      drag.left = left;
      drag.top = top;
      drag.side = snapSide(e.clientX);
      drag.anchor = top + root.offsetHeight / 2;
      showSnap(drag.side, drag.anchor, id);
      return;
    }
    if (!resize) return;
    const dx = e.clientX - resize.x;
    const dy = e.clientY - resize.y;
    const edge = resize.edge;
    let { left, top, width, height } = resize;
    if (edge.includes('e')) width = resize.width + dx;
    if (edge.includes('s')) height = resize.height + dy;
    if (edge.includes('w')) {
      width = resize.width - dx;
      left = resize.left + dx;
    }
    if (edge.includes('n')) {
      height = resize.height - dy;
      top = resize.top + dy;
    }
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
    if (edge.includes('w')) left = resize.left + resize.width - width;
    if (edge.includes('n')) top = resize.top + resize.height - height;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    normal.left = left;
    normal.top = top;
    normal.width = width;
    normal.height = height;
  };
  const onPointerUp = () => {
    if (drag?.moved && drag.side) {
      normal.left = drag.home.left;
      normal.top = drag.home.top;
      normal.width = drag.home.width;
      normal.height = drag.home.height;
      maximized = false;
      applySnap(drag.side, drag.anchor);
      paint();
    } else if (drag?.moved && drag.left != null) {
      normal.left = drag.left;
      normal.top = drag.top;
    }
    hideSnap();
    drag = null;
    resize = null;
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  root.addEventListener('pointerdown', () => focus());

  const onHostResize = () => {
    if (!opened || minimized) return;
    if (maximized) applyMax();
    else if (snapped) layout(snapped);
  };
  window.addEventListener('resize', onHostResize);

  api.bus.on('window:focus', (focused) => {
    const next = focused === id && opened && !minimized;
    if (next) bringToFront();
    if (next === active) return;
    active = next;
    paint();
    publish();
  });
  api.bus.on('window:command', (command) => {
    if (!command) return;
    if (command.action === 'reset-layout' || (command.action === 'reset' && (!command.id || command.id === id))) {
      resetToDefault();
      return;
    }
    if (command.id !== id) return;
    if (command.action === 'toggle') {
      if (opened && !minimized && active) minimize();
      else show();
    } else if (command.action === 'show') show();
    else if (command.action === 'minimize') minimize();
    else if (command.action === 'close') hide();
  });
  api.bus.on('view:command', (command) => {
    if (command === 'default-windows') resetToDefault();
  });
  api.bus.on('window:request', publish);

  api.onDispose(() => {
    undock(id);
    hideSnap();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onHostResize);
  });
  api.onDispose(() => {
    opened = false;
    minimized = false;
    active = false;
    publish();
  });

  const setTitle = (next) => {
    titleText = String(next ?? options.title ?? '');
    heading.textContent = titleText;
    root.setAttribute('aria-label', titleText);
    publish();
  };

  paint();
  publish();

  return { body, show, hide, minimize, toggleMaximize, setTitle };
}
