// Script editor window. Opened by double-clicking a Script in Explorer.
import { frameWindow } from '/Assets/lib/window.js?v=11';

export const order = 8;

const ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M3.2 1.8h7.2l2.4 2.4v10c0 .7-.6 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V3c0-.7.5-1.2 1.2-1.2z"/>
    <path fill="var(--gw-bg, #1c1c1c)" d="M9.8 2.2v2.2h2.2zM4.4 6.2h7.2v1.1H4.4zm0 2.4h7.2v1.1H4.4zm0 2.4h5.2v1.1H4.4z"/>
  </svg>`;

export default {
  mount(root, api) {
    const frame = frameWindow(root, api, {
      id: 'script-editor',
      title: 'Script',
      icon: ICON,
      width: 720,
      height: 520,
      left: 120,
      top: 72,
      minWidth: 360,
      minHeight: 240,
    });

    const shell = document.createElement('div');
    shell.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:10px',
      'padding:6px 10px',
      'border-bottom:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'flex:0 0 auto',
      'background:rgba(255,255,255,.02)',
    ].join(';');

    const pathLabel = document.createElement('div');
    pathLabel.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gw-muted, #aeb4bb);font-size:12px;';
    pathLabel.textContent = 'No script open';

    const enabledWrap = document.createElement('label');
    enabledWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;font-size:12px;color:var(--gw-muted, #aeb4bb);cursor:default;';
    const enabledBox = document.createElement('input');
    enabledBox.type = 'checkbox';
    enabledBox.checked = true;
    enabledWrap.append(enabledBox, document.createTextNode('Enabled'));

    toolbar.append(pathLabel, enabledWrap);

    const editor = document.createElement('div');
    editor.style.cssText = 'flex:1;min-height:0;display:flex;overflow:hidden;background:#1e1e1e;';

    const gutter = document.createElement('pre');
    gutter.setAttribute('aria-hidden', 'true');
    gutter.style.cssText = [
      'margin:0',
      'padding:12px 8px 12px 12px',
      'min-width:2.5em',
      'text-align:right',
      'color:rgba(255,255,255,.28)',
      'font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      'user-select:none',
      'overflow:hidden',
      'border-right:1px solid rgba(255,255,255,.06)',
      'background:#1a1a1a',
      'flex:0 0 auto',
    ].join(';');

    const area = document.createElement('textarea');
    area.spellcheck = false;
    area.wrap = 'off';
    area.placeholder = '-- Write your script here';
    area.style.cssText = [
      'flex:1',
      'min-width:0',
      'min-height:0',
      'box-sizing:border-box',
      'resize:none',
      'margin:0',
      'padding:12px 14px',
      'border:0',
      'outline:none',
      'background:transparent',
      'color:#d4d4d4',
      'caret-color:#ffffff',
      'font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      'white-space:pre',
      'overflow:auto',
      'tab-size:4',
    ].join(';');

    editor.append(gutter, area);
    shell.append(toolbar, editor);
    frame.body.append(shell);

    let scriptId = null;
    let scriptName = 'Script';
    let loading = false;
    let saveTimer = 0;
    let lastSaved = { source: '', enabled: true };

    const lineCount = (text) => Math.max(1, String(text || '').split('\n').length);

    const paintGutter = () => {
      const count = lineCount(area.value);
      let html = '';
      for (let i = 1; i <= count; i += 1) html += `${i}\n`;
      gutter.textContent = html;
      gutter.scrollTop = area.scrollTop;
    };

    const setEmpty = () => {
      scriptId = null;
      scriptName = 'Script';
      loading = true;
      area.value = '';
      area.disabled = true;
      enabledBox.checked = true;
      enabledBox.disabled = true;
      pathLabel.textContent = 'No script open';
      frame.setTitle('Script');
      lastSaved = { source: '', enabled: true };
      paintGutter();
      loading = false;
    };

    const applyPart = (part) => {
      if (!part || part.shape !== 'script') {
        if (scriptId && part?.kind === scriptId) setEmpty();
        return;
      }
      if (scriptId && part.kind !== scriptId) return;
      scriptId = part.kind;
      scriptName = part.name || 'Script';
      const scr = part.script && typeof part.script === 'object' ? part.script : {};
      const source = typeof scr.source === 'string' ? scr.source : '';
      const enabled = scr.enabled !== false;
      loading = true;
      area.disabled = false;
      enabledBox.disabled = false;
      if (document.activeElement !== area) area.value = source;
      if (document.activeElement !== enabledBox) enabledBox.checked = enabled;
      lastSaved = { source: area.value, enabled: enabledBox.checked };
      pathLabel.textContent = scriptName;
      frame.setTitle(scriptName);
      paintGutter();
      loading = false;
    };

    const commit = (force = false) => {
      if (!scriptId || loading) return;
      const source = area.value;
      const enabled = !!enabledBox.checked;
      if (!force && source === lastSaved.source && enabled === lastSaved.enabled) return;
      lastSaved = { source, enabled };
      api.bus.emit('project:patch', {
        kinds: [scriptId],
        script: { source, enabled },
      });
    };

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = 0;
        commit();
      }, 280);
    };

    const openScript = (id) => {
      if (!id) return;
      scriptId = id;
      area.disabled = false;
      enabledBox.disabled = false;
      frame.show();
      api.bus.emit('scene:select', id);
      api.bus.emit('project:describe', id);
      requestAnimationFrame(() => {
        area.focus();
        paintGutter();
      });
    };

    area.addEventListener('input', () => {
      paintGutter();
      scheduleSave();
    });
    area.addEventListener('scroll', () => {
      gutter.scrollTop = area.scrollTop;
    });
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = area.selectionStart;
        const end = area.selectionEnd;
        const value = area.value;
        area.value = `${value.slice(0, start)}\t${value.slice(end)}`;
        area.selectionStart = area.selectionEnd = start + 1;
        paintGutter();
        scheduleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        commit(true);
      }
    });
    area.addEventListener('blur', () => commit(true));
    enabledBox.addEventListener('change', () => commit(true));

    api.bus.on('script-editor:open', (spec) => {
      const id = typeof spec === 'string' ? spec : spec?.id;
      openScript(id);
    });
    api.bus.on('window:command', (command) => {
      if (command?.id === 'script-editor' && command.action === 'show') frame.show();
    });
    api.bus.on('project:described', (part) => {
      if (!scriptId) return;
      if (part?.kind !== scriptId) return;
      applyPart(part);
    });
    api.bus.on('project:reverted', (doc) => {
      if (!scriptId) return;
      const part = (doc?.parts || []).find((item) => item.id === scriptId);
      if (!part || part.shape !== 'script') {
        setEmpty();
        return;
      }
      applyPart({
        kind: part.id,
        name: part.name,
        shape: 'script',
        script: part.script,
      });
    });
    api.bus.on('scene:selected', (id) => {
      // Keep editor focused on its script; selection elsewhere does not close it.
      if (!scriptId) return;
      const ids = Array.isArray(id) ? id : (id ? [id] : []);
      if (ids.includes(scriptId)) pathLabel.style.color = 'var(--gw-text, #e8eaed)';
      else pathLabel.style.color = 'var(--gw-muted, #aeb4bb)';
    });

    setEmpty();
    api.onDispose(() => {
      if (saveTimer) clearTimeout(saveTimer);
      commit(true);
    });
  },
};
