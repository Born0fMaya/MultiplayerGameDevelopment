// Tool bar under the menu. Select, Move, Scale, and Rotate match Studio's tools.
export const order = -8;

const HEIGHT = '56px';

const SHAPES = [
  {
    id: 'block',
    label: 'Block',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M12 4.6 18.8 8.4v8.2L12 20.4 5.2 16.6V8.4L12 4.6z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M12 12.2 5.2 8.4M12 12.2 18.8 8.4M12 12.2v8.2"/>',
  },
  {
    id: 'sphere',
    label: 'Sphere',
    icon: '<circle cx="12" cy="12" r="6.7" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="6.7" ry="2.35" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 5.3c2.15 1.95 3.25 4.25 3.25 6.7s-1.1 4.75-3.25 6.7c-2.15-1.95-3.25-4.25-3.25-6.7s1.1-4.75 3.25-6.7z"/>',
  },
  {
    id: 'cylinder',
    label: 'Cylinder',
    icon: '<ellipse cx="12" cy="7.4" rx="5.4" ry="2.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6.6 7.4v8.4M17.4 7.4v8.4"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6.6 15.8a5.4 2.7 0 0 0 10.8 0"/>',
  },
  {
    id: 'wedge',
    label: 'Wedge',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M5.2 8.2V16.8H15.4L18.2 15 8 6.4Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M5.2 8.2 15.4 16.8"/>',
  },
  {
    id: 'corner',
    label: 'Corner Wedge',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M6.4 17h9.8L10.2 10.2Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M6.4 17 8.2 6.6 16.2 17M8.2 6.6 10.2 10.2"/>',
  },
  {
    id: 'camera',
    label: 'Camera',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4.2 8.2h9.2v8.4H4.2z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M13.4 10.6 19.2 7.8v9.2l-5.8-2.8z"/><circle cx="8.8" cy="12.4" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  },
];
const TOOLS = [
  {
    id: 'select',
    label: 'Select',
    icon: '<path fill="currentColor" d="M6.1 3.4v13.4l2.85-2.95 2.85 5.7 2-.95-2.85-5.6 4.35-.55L6.1 3.4z"/>',
  },
  {
    id: 'move',
    label: 'Move',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 9.1V4.3M9.4 6.9 12 4.3l2.6 2.6M12 14.9v4.8M9.4 17.1 12 19.7l2.6-2.6M9.1 12H4.3M6.9 9.4 4.3 12l2.6 2.6M14.9 12h4.8M17.1 9.4 19.7 12l-2.6 2.6"/>',
  },
  {
    id: 'scale',
    label: 'Scale',
    icon: '<rect x="4.4" y="8.6" width="9.2" height="9.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M13.4 4.6h6v6M19.4 4.6 12.2 11.8"/>',
  },
  {
    id: 'rotate',
    label: 'Rotate',
    icon: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1L19.2 8.6"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M19.2 4.2v4.4h-4.4"/>',
  },
];

export default {
  mount(root, api) {
    let current = 'select';
    document.documentElement.style.setProperty('--gw-toolbar-h', HEIGHT);
    root.style.cssText = [
      'position:fixed',
      'top:var(--gw-menu-h,30px)',
      'left:0',
      'right:0',
      `height:${HEIGHT}`,
      'z-index:19',
      'display:flex',
      'align-items:center',
      'gap:4px',
      'padding:0 8px',
      'background:var(--gw-bg, #1c1c1c)',
      'border-bottom:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'color:var(--gw-text, #e8eaed)',
      'font:12px/1 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'user-select:none',
    ].join(';');

    const buttons = new Map();
    const paint = () => {
      for (const [id, button] of buttons) {
        const on = id === current;
        button.style.background = on ? 'var(--gw-press)' : 'transparent';
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };

    let sessionMode = 'edit';
    const setTool = (id) => {
      if (sessionMode === 'live') return;
      if (!buttons.has(id)) return;
      current = id;
      paint();
      api.bus.emit('tool:changed', id);
    };

    for (const tool of TOOLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = [
        'appearance:none',
        'border:0',
        'margin:0',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'gap:4px',
        'height:44px',
        'min-width:64px',
        'padding:0 12px',
        'border-radius:6px',
        'cursor:default',
      ].join(';');
      button.title = `${tool.label} (${TOOLS.indexOf(tool) + 1})`;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${tool.icon}</svg><span>${tool.label}</span>`;
      button.addEventListener('mouseenter', () => {
        if (tool.id !== current) button.style.background = 'var(--gw-hover)';
      });
      button.addEventListener('mouseleave', () => paint());
      button.addEventListener('click', () => setTool(tool.id));
      buttons.set(tool.id, button);
      root.append(button);
    }

    paint();
    const onToolKey = (e) => {
      if (sessionMode === 'live') return;
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing || e.altKey || e.metaKey || e.shiftKey || e.ctrlKey || e.repeat) return;
      const index = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
      if (index == null) return;
      e.preventDefault();
      setTool(TOOLS[index].id);
    };
    window.addEventListener('keydown', onToolKey);
    api.bus.on('tool:request', () => api.bus.emit('tool:changed', current));
    api.bus.emit('tool:changed', current);

    const snap = { move: true, moveStuds: 4, rotate: true, rotateDegrees: 45 };
    const publishSnap = () => api.bus.emit('snap:changed', { ...snap });
    const snapUi = {};

    const rule = document.createElement('div');
    rule.style.cssText = 'width:1px;height:28px;margin:0 10px 0 8px;background:var(--gw-line);flex:0 0 auto;';
    root.append(rule);

    const snaps = document.createElement('div');
    snaps.style.cssText = 'display:flex;flex-direction:column;justify-content:center;gap:4px;';

    const addSnap = (key, title) => {
      const line = document.createElement('label');
      line.title = title;
      line.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:default;';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = true;
      toggle.style.cssText = [
        'appearance:none',
        'width:14px',
        'height:14px',
        'margin:0',
        'border-radius:4px',
        'border:1px solid var(--gw-line)',
        'background:var(--gw-well)',
        'display:grid',
        'place-items:center',
        'flex:0 0 auto',
      ].join(';');
      const paintToggle = () => {
        toggle.style.background = toggle.checked
          ? 'var(--gw-well) url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 14 14\'%3E%3Cpath d=\'M3 7.2 5.6 10 11 4.2\' fill=\'none\' stroke=\'%23e8eaed\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E") center/12px 12px no-repeat'
          : 'var(--gw-well)';
      };
      toggle.addEventListener('change', () => {
        snap[key] = toggle.checked;
        paintToggle();
        publishSnap();
      });
      paintToggle();

      const field = document.createElement('span');
      field.style.cssText = [
        'display:flex',
        'align-items:center',
        'height:22px',
        'padding:0 8px',
        'border-radius:4px',
        'background:var(--gw-well)',
        'border:1px solid var(--gw-line)',
        'min-width:78px',
      ].join(';');
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', title);
      input.style.cssText = [
        'width:36px',
        'border:0',
        'outline:none',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'padding:0',
      ].join(';');
      const suffix = document.createElement('span');
      suffix.style.cssText = 'color:var(--gw-muted);pointer-events:none;';
      const valueKey = key === 'move' ? 'moveStuds' : 'rotateDegrees';
      const show = () => {
        input.value = String(snap[valueKey]);
        suffix.textContent = key === 'move' ? (snap.moveStuds === 1 ? ' stud' : ' studs') : '°';
      };
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (Number.isFinite(value) && value > 0) {
          snap[valueKey] = value;
          suffix.textContent = key === 'move' ? (value === 1 ? ' stud' : ' studs') : '°';
          publishSnap();
        }
      });
      input.addEventListener('focus', () => { field.style.borderColor = 'rgba(255,255,255,.28)'; });
      input.addEventListener('blur', () => { field.style.borderColor = ''; show(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        e.stopPropagation();
      });
      show();
      field.append(input, suffix);
      line.append(toggle, field);
      snaps.append(line);
      snapUi[key] = { toggle, paintToggle, show };
    };

    addSnap('move', 'Move snap in studs');
    addSnap('rotate', 'Rotate snap in degrees');
    root.append(snaps);
    api.bus.on('snap:request', publishSnap);
    api.bus.on('snap:set', (next) => {
      if (!next || typeof next !== 'object') return;
      if (typeof next.move === 'boolean') snap.move = next.move;
      if (typeof next.rotate === 'boolean') snap.rotate = next.rotate;
      if (Number.isFinite(next.moveStuds) && next.moveStuds > 0) snap.moveStuds = next.moveStuds;
      if (Number.isFinite(next.rotateDegrees) && next.rotateDegrees > 0) snap.rotateDegrees = next.rotateDegrees;
      for (const key of ['move', 'rotate']) {
        const ui = snapUi[key];
        if (!ui) continue;
        ui.toggle.checked = !!snap[key];
        ui.paintToggle();
        ui.show();
      }
      publishSnap();
    });
    publishSnap();

    let shape = 'block';
    let menuOpen = false;
    const partWrap = document.createElement('div');
    partWrap.style.cssText = 'position:relative;display:flex;align-items:stretch;height:40px;margin-left:14px;flex:0 0 auto;';

    const partButton = document.createElement('button');
    partButton.type = 'button';
    partButton.dataset.partCreate = 'true';
    partButton.title = 'Create a part';
    partButton.style.cssText = [
      'appearance:none',
      'border:0',
      'margin:0',
      'background:transparent',
      'color:inherit',
      'font:inherit',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 10px 0 8px',
      'border-radius:6px 0 0 6px',
      'cursor:default',
    ].join(';');
    const partIcon = document.createElement('span');
    partIcon.style.cssText = 'display:flex;width:20px;height:20px;';
    const partLabel = document.createElement('span');
    partLabel.textContent = 'Part';
    partButton.append(partIcon, partLabel);

    const shapeButton = document.createElement('button');
    shapeButton.type = 'button';
    shapeButton.dataset.partShapes = 'true';
    shapeButton.title = 'Part shape';
    shapeButton.setAttribute('aria-label', 'Part shape');
    shapeButton.style.cssText = [
      'appearance:none',
      'border:0',
      'border-left:1px solid var(--gw-line)',
      'margin:0',
      'background:transparent',
      'color:inherit',
      'width:22px',
      'border-radius:0 6px 6px 0',
      'cursor:default',
      'display:grid',
      'place-items:center',
    ].join(';');
    shapeButton.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M2.2 4.2 6 8.2 9.8 4.2z"/></svg>';

    const shapeMenu = document.createElement('div');
    shapeMenu.hidden = true;
    shapeMenu.style.cssText = [
      'position:absolute',
      'top:calc(100% + 6px)',
      'left:0',
      'min-width:168px',
      'padding:4px',
      'background:var(--gw-bg)',
      'border:1px solid var(--gw-line)',
      'border-radius:8px',
      'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
      'z-index:5',
    ].join(';');

    const shapeRows = new Map();
    const paintPart = () => {
      const chosen = SHAPES.find((item) => item.id === shape) ?? SHAPES[0];
      partIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${chosen.icon}</svg>`;
      for (const [id, row] of shapeRows) {
        row.style.background = id === shape ? 'var(--gw-press)' : 'transparent';
      }
    };
    const setMenu = (open) => {
      menuOpen = open;
      shapeMenu.hidden = !open;
      shapeButton.style.background = open ? 'var(--gw-press)' : 'transparent';
    };

    for (const item of SHAPES) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'width:100%',
        'appearance:none',
        'border:0',
        'margin:0',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'text-align:left',
        'padding:7px 10px',
        'border-radius:4px',
        'cursor:default',
      ].join(';');
      row.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>`;
      row.addEventListener('mouseenter', () => {
        if (item.id !== shape) row.style.background = 'var(--gw-hover)';
      });
      row.addEventListener('mouseleave', () => paintPart());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        shape = item.id;
        paintPart();
        setMenu(false);
      });
      shapeRows.set(item.id, row);
      shapeMenu.append(row);
    }

    const hover = (button, on) => {
      if (button === shapeButton && menuOpen) return;
      button.style.background = on ? 'var(--gw-hover)' : 'transparent';
    };
    partButton.addEventListener('mouseenter', () => hover(partButton, true));
    partButton.addEventListener('mouseleave', () => hover(partButton, false));
    shapeButton.addEventListener('mouseenter', () => hover(shapeButton, true));
    shapeButton.addEventListener('mouseleave', () => hover(shapeButton, false));
    partButton.addEventListener('click', () => {
      if (sessionMode === 'live') return;
      setMenu(false);
      api.bus.emit('part:create', shape);
    });
    shapeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sessionMode === 'live') return;
      setMenu(!menuOpen);
    });

    const onPointerDown = (e) => {
      if (menuOpen && !partWrap.contains(e.target)) setMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && menuOpen) setMenu(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    paintPart();
    partWrap.append(partButton, shapeButton, shapeMenu);
    root.append(partWrap);

    const DRAW_TOOLS = [
      {
        id: 'pencil',
        label: 'Pencil',
        icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M14.2 4.4 19.6 9.8 9.2 20.2 3.8 20.2 3.8 14.8Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12.6 6 18 11.4"/>',
      },
      {
        id: 'line',
        label: 'Line',
        icon: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/>',
      },
      {
        id: 'rectangle',
        label: 'Rectangle',
        icon: '<rect x="5" y="6" width="14" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      },
      {
        id: 'circle',
        label: 'Circle',
        icon: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
      },
      {
        id: 'pushpull',
        label: 'Push/Pull',
        icon: '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M7 14V6.5h10V14"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 6.5V3.5M9.8 5.2 12 3.2l2.2 2"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M5.5 14h13v5.5H5.5z"/>',
      },
      {
        id: 'erase',
        label: 'Erase',
        icon: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M6.2 15.8 14.8 7.2l2 2L8.2 17.8H6.2z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M13.4 8.6 15.4 10.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M5 19.2h14"/>',
      },
    ];
    const drawWrap = document.createElement('div');
    drawWrap.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:10px;flex:0 0 auto;';
    for (const tool of DRAW_TOOLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = [
        'appearance:none',
        'border:0',
        'margin:0',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'gap:4px',
        'height:44px',
        'min-width:58px',
        'padding:0 8px',
        'border-radius:6px',
        'cursor:default',
      ].join(';');
      button.title = tool.label;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${tool.icon}</svg><span>${tool.label}</span>`;
      button.addEventListener('mouseenter', () => {
        if (tool.id !== current) button.style.background = 'var(--gw-hover)';
      });
      button.addEventListener('mouseleave', () => paint());
      button.addEventListener('click', () => setTool(tool.id));
      buttons.set(tool.id, button);
      drawWrap.append(button);
    }
    root.append(drawWrap);

    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:4px;flex:0 0 auto;';

    const modeButton = (title, icon, color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.style.cssText = [
        'appearance:none',
        'border:0',
        'margin:0',
        'width:36px',
        'height:36px',
        'border-radius:8px',
        'display:grid',
        'place-items:center',
        'cursor:default',
        'background:transparent',
        'color:' + color,
        'flex:0 0 auto',
      ].join(';');
      button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${icon}</svg>`;
      button.addEventListener('mouseenter', () => {
        if (button.disabled) return;
        button.style.background = 'var(--gw-hover)';
      });
      button.addEventListener('mouseleave', () => paintMode());
      return button;
    };

    const playBtn = modeButton(
      'Play (Live Mode)',
      '<path fill="currentColor" d="M8 5.2v13.6l11-6.8L8 5.2z"/>',
      '#3ddc84',
    );
    const stopBtn = modeButton(
      'Stop (Edit Mode)',
      '<rect x="6.5" y="6.5" width="11" height="11" rx="1.2" fill="currentColor"/>',
      '#e23b2f',
    );

    const editChrome = [snaps, partWrap, drawWrap];
    const paintMode = () => {
      const live = sessionMode === 'live';
      // Keep Stop clickable so a desynced Live state can still be recovered.
      playBtn.style.opacity = live ? '0.35' : '1';
      stopBtn.style.opacity = live ? '1' : '0.35';
      playBtn.style.background = 'transparent';
      stopBtn.style.background = live ? 'rgba(226,59,47,.16)' : 'transparent';
      playBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
      stopBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
      for (const [id, button] of buttons) {
        button.disabled = live;
        button.style.opacity = live ? '0.35' : '1';
        button.style.pointerEvents = live ? 'none' : '';
        if (live) button.style.background = 'transparent';
      }
      if (!live) paint();
      for (const el of editChrome) {
        el.style.opacity = live ? '0.35' : '1';
        el.style.pointerEvents = live ? 'none' : '';
      }
      if (live) setMenu(false);
      partButton.disabled = live;
      shapeButton.disabled = live;
    };

    playBtn.addEventListener('click', () => {
      if (sessionMode === 'live') return;
      api.bus.emit('mode:play');
    });
    stopBtn.addEventListener('click', () => {
      api.bus.emit('mode:stop');
    });
    paintMode();
    api.bus.on('mode:changed', (mode) => {
      sessionMode = mode === 'live' ? 'live' : 'edit';
      paintMode();
    });
    api.bus.emit('mode:request');

    const users = document.createElement('div');
    users.style.cssText = [
      'padding:4px 10px',
      'color:var(--gw-muted, #aeb4bb)',
      'font:11px/1.35 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'font-variant-numeric:tabular-nums',
      'flex:0 0 auto',
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'gap:1px',
      'white-space:nowrap',
    ].join(';');
    users.dataset.users = 'true';
    users.style.cursor = 'pointer';
    users.style.borderRadius = '6px';
    const editLine = document.createElement('div');
    const liveLine = document.createElement('div');
    users.append(editLine, liveLine);
    const userLabel = (count, label) => {
      const next = Math.max(0, count | 0);
      const noun = next === 1 ? 'user' : 'users';
      return `${next} ${noun} in ${label}.`;
    };
    const showUsers = (payload) => {
      let edit = 1;
      let live = 0;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        edit = Math.max(0, payload.edit | 0);
        live = Math.max(0, payload.live | 0);
      } else {
        edit = Math.max(1, payload | 0);
      }
      editLine.textContent = userLabel(edit, 'edit mode');
      liveLine.textContent = userLabel(live, 'live mode');
      const text = `${editLine.textContent} ${liveLine.textContent}`;
      users.title = 'Change your color and username';
      users.setAttribute('aria-label', text);
    };
    showUsers({ edit: 1, live: 0 });
    api.bus.on('project:users', showUsers);
    api.bus.emit('project:users-request');
    modeWrap.append(playBtn, stopBtn, users);
    root.append(modeWrap);

    const savedName = localStorage.getItem('gw-presence-name');
    const savedColor = localStorage.getItem('gw-presence-color');
    let myName = savedName && savedName.trim() ? savedName.trim().slice(0, 32) : 'User';
    let myColor = savedColor && /^#[0-9a-fA-F]{6}$/.test(savedColor) ? savedColor.toLowerCase() : '#5b9dff';
    const publishProfile = () => api.bus.emit('presence:profile', { name: myName, color: myColor });
    api.bus.on('presence:request', publishProfile);
    publishProfile();

    document.querySelectorAll('[data-presence]').forEach((node) => node.remove());
    const panel = document.createElement('form');
    panel.hidden = true;
    panel.dataset.presence = 'true';
    panel.style.cssText = [
      'position:fixed',
      'z-index:40',
      'width:240px',
      'box-sizing:border-box',
      'padding:12px',
      'flex-direction:column',
      'gap:8px',
      'background:var(--gw-bg, #1c1c1c)',
      'color:var(--gw-text, #e8eaed)',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:8px',
      'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
      'font:13px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
    ].join(';');
    const fieldStyle = [
      'width:100%',
      'box-sizing:border-box',
      'height:28px',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:4px',
      'background:var(--gw-well, #1c1c1c)',
      'color:inherit',
      'font:inherit',
      'padding:0 8px',
    ].join(';');
    const addLabel = (text) => {
      const label = document.createElement('label');
      label.textContent = text;
      label.style.cssText = 'display:flex;flex-direction:column;gap:4px;color:var(--gw-muted, #aeb4bb);font-size:12px;';
      return label;
    };
    const nameLabel = addLabel('Username');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.value = myName;
    nameInput.spellcheck = false;
    nameInput.style.cssText = fieldStyle;
    nameLabel.append(nameInput);
    const colorLabel = addLabel('Color');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = myColor;
    colorInput.style.cssText = 'width:100%;height:32px;padding:0;border:0;background:transparent;cursor:pointer;';
    colorLabel.append(colorInput);
    const ipLabel = addLabel('Host IP');
    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.placeholder = '10.0.0.12';
    ipInput.spellcheck = false;
    ipInput.autocomplete = 'off';
    ipInput.style.cssText = fieldStyle;
    try {
      const savedHost = localStorage.getItem('gw-collab-host');
      if (savedHost) ipInput.value = savedHost;
    } catch { /* private mode */ }
    ipLabel.append(ipInput);
    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.textContent = 'Connect';
    connectBtn.style.cssText = [
      'width:100%',
      'height:30px',
      'border:1px solid var(--gw-line, rgba(255,255,255,.12))',
      'border-radius:4px',
      'background:var(--gw-hover, rgba(255,255,255,.06))',
      'color:inherit',
      'font:inherit',
      'cursor:pointer',
    ].join(';');
    const collabStatus = document.createElement('div');
    collabStatus.style.cssText = 'font-size:11px;line-height:1.35;color:var(--gw-muted, #aeb4bb);min-height:14px;';
    const yourIp = document.createElement('div');
    yourIp.style.cssText = 'font-size:11px;line-height:1.35;color:var(--gw-muted, #aeb4bb);word-break:break-all;';
    yourIp.textContent = 'Your IP: …';
    let collabConnected = false;
    let collabBusy = false;
    const showCollab = (status = {}) => {
      if ('connected' in status) collabConnected = !!status.connected;
      const connecting = !!status.connecting;
      connectBtn.textContent = collabConnected ? 'Disconnect' : (connecting ? 'Connecting…' : 'Connect');
      connectBtn.disabled = connecting || collabBusy;
      ipInput.disabled = collabConnected || connecting;
      if (status.host && !ipInput.value) ipInput.value = status.host;
      if ('error' in status || 'connected' in status || 'connecting' in status) {
        if (status.error) collabStatus.textContent = status.error;
        else if (collabConnected) collabStatus.textContent = `Connected to ${status.host || 'host'}`;
        else if (connecting) collabStatus.textContent = 'Connecting…';
        else collabStatus.textContent = 'Open a project, then share your IP with friends.';
      }
      if (Array.isArray(status.addresses) && status.addresses.length) {
        const best = status.addresses.find((ip) => ip && ip !== '127.0.0.1') || status.addresses[0];
        yourIp.textContent = `Your IP: ${best}${status.port ? `:${status.port}` : ''}`;
      }
    };
    api.bus.on('collab:status', showCollab);
    api.bus.emit('collab:request');
    fetch('http://127.0.0.1:5282/collab/info')
      .then((res) => res.ok ? res.json() : null)
      .then((info) => {
        if (!info) return;
        showCollab({ addresses: info.addresses, port: info.port || 5282 });
      })
      .catch(() => { yourIp.textContent = 'Your IP: unavailable'; });
    connectBtn.addEventListener('click', () => {
      if (collabBusy) return;
      if (collabConnected) {
        api.bus.emit('collab:disconnect');
        return;
      }
      const host = ipInput.value.trim();
      if (!host) {
        collabStatus.textContent = 'Enter a host IP address.';
        ipInput.focus();
        return;
      }
      try { localStorage.setItem('gw-collab-host', host); } catch { /* private mode */ }
      collabBusy = true;
      connectBtn.disabled = true;
      api.bus.emit('collab:connect', { host });
      setTimeout(() => { collabBusy = false; }, 50);
    });
    ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        connectBtn.click();
      }
    });
    panel.append(nameLabel, colorLabel, ipLabel, connectBtn, yourIp, collabStatus);
    document.body.append(panel);
    const placePanel = () => {
      const rect = users.getBoundingClientRect();
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.left = `${Math.max(8, rect.right - 240)}px`;
    };
    const setPanel = (open) => {
      panel.hidden = !open;
      panel.style.display = open ? 'flex' : 'none';
      if (open) placePanel();
    };
    setPanel(false);
    users.addEventListener('click', (e) => {
      e.stopPropagation();
      setPanel(panel.hidden);
    });
    users.addEventListener('mouseenter', () => { users.style.background = 'var(--gw-hover)'; });
    users.addEventListener('mouseleave', () => { users.style.background = 'transparent'; });
    nameInput.addEventListener('input', () => {
      myName = nameInput.value.trim().slice(0, 32) || 'User';
      localStorage.setItem('gw-presence-name', myName);
      publishProfile();
    });
    colorInput.addEventListener('input', () => {
      myColor = colorInput.value.toLowerCase();
      localStorage.setItem('gw-presence-color', myColor);
      publishProfile();
    });
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('keydown', (e) => e.stopPropagation());
    const onPresencePointer = (e) => {
      if (panel.hidden || panel.contains(e.target) || users.contains(e.target)) return;
      setPanel(false);
    };
    document.addEventListener('pointerdown', onPresencePointer, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerdown', onPresencePointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onToolKey);
      panel.remove();
      document.documentElement.style.removeProperty('--gw-toolbar-h');
    };
  },
};
