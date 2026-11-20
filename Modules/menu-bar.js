// Dark menu bar across the top of the window. The viewport starts below --gw-menu-h.
export const order = -10;

const HEIGHT = '30px';

const MENUS = [
  {
    label: 'File',
    event: 'file:command',
    items: [
      { id: 'new', label: 'New Project' },
      { id: 'open', label: 'Open...', shortcut: 'Ctrl+O' },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S' },
      { id: 'save-as', label: 'Save As...', shortcut: 'Ctrl+Shift+S' },
      { id: 'export', label: 'Export...' },
    ],
  },
  {
    label: 'Edit',
    event: 'edit:command',
    items: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
    ],
  },
  {
    label: 'View',
    event: 'view:command',
    items: [
      { id: 'fullbright', label: 'Fullbright', toggle: true },
      { id: 'default-windows', label: 'Default Window Position' },
    ],
  },
];

export default {
  mount(root, api) {
    const theme = document.documentElement.style;
    theme.setProperty('--gw-menu-h', HEIGHT);
    theme.setProperty('--gw-bg', '#1c1c1c');
    theme.setProperty('--gw-text', '#e8eaed');
    theme.setProperty('--gw-muted', '#aeb4bb');
    theme.setProperty('--gw-hover', 'rgba(255,255,255,.08)');
    theme.setProperty('--gw-press', 'rgba(255,255,255,.14)');
    theme.setProperty('--gw-well', '#1c1c1c');
    theme.setProperty('--gw-line', 'rgba(255,255,255,.08)');
    theme.setProperty('--gw-font', '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif');
    theme.setProperty('--gw-shadow', '0 16px 40px rgba(0,0,0,.45)');
    root.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      `height:${HEIGHT}`,
      'z-index:20',
      'display:flex',
      'align-items:center',
      'padding:0 8px',
      'background:var(--gw-bg)',
      'border-bottom:1px solid var(--gw-line)',
      'color:var(--gw-text)',
      'font:13px/1 var(--gw-font)',
      'user-select:none',
    ].join(';');

    let openMenu = null;
    const menus = [];
    const historyItems = new Map();
    const toggles = new Map();
    const savedFullbright = localStorage.getItem('gw-fullbright') === '1';
    toggles.set('fullbright', savedFullbright);

    const closeAll = () => {
      openMenu = null;
      for (const menu of menus) menu.setOpen(false);
    };

    const publishFullbright = () => {
      api.bus.emit('view:fullbright', !!toggles.get('fullbright'));
    };

    for (const spec of MENUS) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;display:flex;align-items:center;';

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = spec.label;
      button.style.cssText = [
        'appearance:none',
        'border:0',
        'margin:0',
        'background:transparent',
        'color:inherit',
        'font:inherit',
        'padding:4px 10px',
        'border-radius:4px',
        'cursor:default',
      ].join(';');

      const panel = document.createElement('div');
      panel.hidden = true;
      panel.style.cssText = [
        'position:absolute',
        'top:calc(100% + 4px)',
        'left:0',
        'min-width:220px',
        'padding:4px',
        'background:var(--gw-bg)',
        'border:1px solid var(--gw-line)',
        'border-radius:8px',
        'box-shadow:var(--gw-shadow)',
      ].join(';');

      const menu = {
        button,
        panel,
        setOpen(next) {
          panel.hidden = !next;
          button.style.background = next ? 'var(--gw-hover)' : 'transparent';
        },
      };
      menus.push(menu);

      const show = () => {
        if (openMenu === menu) return;
        closeAll();
        openMenu = menu;
        menu.setOpen(true);
      };

      for (const item of spec.items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText = [
          'display:flex',
          'align-items:center',
          'justify-content:space-between',
          'gap:28px',
          'width:100%',
          'appearance:none',
          'border:0',
          'margin:0',
          'background:transparent',
          'color:inherit',
          'font:inherit',
          'text-align:left',
          'padding:7px 12px',
          'border-radius:4px',
          'cursor:default',
        ].join(';');
        const name = document.createElement('span');
        name.textContent = item.label;
        let mark = null;
        if (item.toggle) {
          const labelWrap = document.createElement('span');
          labelWrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';
          mark = document.createElement('span');
          mark.style.cssText = 'width:12px;flex:0 0 auto;color:var(--gw-text);font:12px/1 var(--gw-font);';
          labelWrap.append(mark, name);
          row.append(labelWrap);
        } else {
          row.append(name);
        }
        if (item.shortcut) {
          const keys = document.createElement('span');
          keys.textContent = item.shortcut;
          keys.style.color = 'var(--gw-muted)';
          row.append(keys);
        }
        const paintToggle = () => {
          if (mark) mark.textContent = toggles.get(item.id) ? '✓' : '';
        };
        if (item.toggle) paintToggle();
        const setEnabled = (enabled) => {
          row.disabled = !enabled;
          row.style.opacity = enabled ? '1' : '0.38';
        };
        if (item.id === 'undo' || item.id === 'redo') {
          setEnabled(false);
          historyItems.set(item.id, setEnabled);
        }
        row.addEventListener('mouseenter', () => {
          if (!row.disabled) row.style.background = 'var(--gw-hover)';
        });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('click', () => {
          if (row.disabled) return;
          if (item.toggle) {
            const next = !toggles.get(item.id);
            toggles.set(item.id, next);
            paintToggle();
            if (item.id === 'fullbright') {
              localStorage.setItem('gw-fullbright', next ? '1' : '0');
              publishFullbright();
            }
            closeAll();
            return;
          }
          closeAll();
          api.bus.emit(spec.event, item.id);
        });
        panel.append(row);
      }

      button.addEventListener('mouseenter', () => {
        if (openMenu) show();
        else button.style.background = 'var(--gw-hover)';
      });
      button.addEventListener('mouseleave', () => {
        if (openMenu !== menu) button.style.background = 'transparent';
      });
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openMenu === menu) closeAll();
        else show();
      });

      wrap.append(button, panel);
      root.append(wrap);
    }

    const typing = () => {
      const el = document.activeElement;
      return !!(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
    };
    const onPointerDown = (e) => {
      if (openMenu && !root.contains(e.target)) closeAll();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && openMenu) closeAll();
      if (typing() || e.altKey || e.metaKey || !e.ctrlKey) return;
      if (e.code === 'KeyS') {
        e.preventDefault();
        closeAll();
        api.bus.emit('file:command', e.shiftKey ? 'save-as' : 'save');
        return;
      }
      if (e.shiftKey) return;
      if (e.code === 'KeyO') {
        e.preventDefault();
        closeAll();
        api.bus.emit('file:command', 'open');
        return;
      }
      const command = e.code === 'KeyZ' ? 'undo' : e.code === 'KeyY' ? 'redo' : null;
      if (!command) return;
      e.preventDefault();
      closeAll();
      api.bus.emit('edit:command', command);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    api.bus.on('history:state', (state) => {
      historyItems.get('undo')?.(!!state?.undo);
      historyItems.get('redo')?.(!!state?.redo);
    });
    api.bus.emit('history:request');
    api.bus.on('view:fullbright-request', publishFullbright);
    publishFullbright();

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      for (const name of ['--gw-menu-h', '--gw-bg', '--gw-text', '--gw-muted', '--gw-hover', '--gw-press', '--gw-well', '--gw-line', '--gw-font', '--gw-shadow']) {
        theme.removeProperty(name);
      }
    };
  },
};
