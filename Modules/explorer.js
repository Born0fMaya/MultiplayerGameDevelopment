// Floating Explorer window. Lists the objects currently in the scene.
import { frameWindow } from '/Assets/lib/window.js?v=11';

export const order = 5;

const ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M1.6 3.2A1.4 1.4 0 0 1 3 1.8h3.1l1.2 1.3H13a1.4 1.4 0 0 1 1.4 1.4v7.3A1.4 1.4 0 0 1 13 13.2H3a1.4 1.4 0 0 1-1.4-1.4V3.2z"/>
  </svg>`;

const PART_ICON = `
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M8 1.4 13.5 4.6v6.8L8 14.6 2.5 11.4V4.6L8 1.4zm0 1.8L4.1 5.5 8 7.8l3.9-2.3L8 3.2zM3.6 6.6v3.9L7.4 12.8V8.8L3.6 6.6zm8.8 0L8.6 8.8v4l3.8-2.3V6.6z"/>
  </svg>`;

const CAMERA_ICON = `
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M1.8 4.6h7.4v6.8H1.8zm8.2 1.6 4.2-1.8v8.2L10 10.6z"/>
    <circle cx="5.5" cy="8" r="1.7" fill="var(--gw-bg, #1c1c1c)"/>
  </svg>`;

const SCRIPT_ICON = `
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M3.2 1.8h7.2l2.4 2.4v10c0 .7-.6 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V3c0-.7.5-1.2 1.2-1.2z"/>
    <path fill="var(--gw-bg, #1c1c1c)" d="M9.8 2.2v2.2h2.2zM4.4 6.2h7.2v1.1H4.4zm0 2.4h7.2v1.1H4.4zm0 2.4h5.2v1.1H4.4z"/>
  </svg>`;

const FOLDER_ICON = `
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M1.5 3.6A1.3 1.3 0 0 1 2.8 2.3h3.1l1.2 1.3h6.1A1.3 1.3 0 0 1 14.5 4.9v6.8a1.3 1.3 0 0 1-1.3 1.3H2.8a1.3 1.3 0 0 1-1.3-1.3V3.6z"/>
  </svg>`;

const CHEVRON = `
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
    <path fill="currentColor" d="M4.1 2.1 8.2 6 4.1 9.9z"/>
  </svg>`;

export default {
  mount(root, api) {
    const frame = frameWindow(root, api, {
      id: 'explorer',
      title: 'Explorer',
      icon: ICON,
      width: 320,
      height: 440,
      snap: 'right',
    });

    let liveMode = false;
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:4px;';
    let locked = new Set();

    for (const leftover of document.querySelectorAll('[data-explorer-menu]')) leftover.remove();

    const menu = document.createElement('div');
    menu.hidden = true;
    menu.dataset.explorerMenu = 'true';
    menu.style.cssText = [
      'position:fixed',
      'z-index:40',
      'min-width:168px',
      'padding:4px',
      'background:var(--gw-bg, #1c1c1c)',
      'color:var(--gw-text, #e8eaed)',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:8px',
      'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
      'font:13px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
    ].join(';');
    document.body.append(menu);

    const submenu = document.createElement('div');
    submenu.hidden = true;
    submenu.dataset.explorerMenu = 'true';
    submenu.style.cssText = [
      'position:fixed',
      'z-index:41',
      'min-width:140px',
      'padding:4px',
      'background:var(--gw-bg, #1c1c1c)',
      'color:var(--gw-text, #e8eaed)',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:8px',
      'box-shadow:var(--gw-shadow, 0 16px 40px rgba(0,0,0,.45))',
      'font:13px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
    ].join(';');
    document.body.append(submenu);

    const itemStyle = [
      'display:block',
      'width:100%',
      'appearance:none',
      'border:0',
      'margin:0',
      'padding:7px 10px',
      'border-radius:4px',
      'background:transparent',
      'color:inherit',
      'font:inherit',
      'text-align:left',
      'cursor:default',
    ].join(';');

    let objects = [];
    let selectedIds = new Set();
    let folders = [];
    let nextFolder = 1;
    const parents = new Map();
    const expanded = new Set();
    let drag = null;
    let lastTap = null;
    let clipboard = null;
    let renaming = null;
    let described = null;
    let placing = false;
    let placeParent = null;
    let placedIds = [];
    let structureShot = '';
    let structureMute = false;

    const structurePayload = () => ({
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name, parent: folder.parent || null })),
      placement: Object.fromEntries(parents),
      nextFolder,
    });

    const commitFolders = () => {
      if (structureMute) return;
      const payload = structurePayload();
      structureShot = JSON.stringify(payload);
      api.bus.emit('project:folders', payload);
    };

    const applyStructure = (source) => {
      const payload = {
        folders: Array.isArray(source?.folders) ? source.folders : [],
        placement: source?.placement && typeof source.placement === 'object' ? source.placement : {},
        nextFolder: Number.isFinite(source?.nextFolder) ? source.nextFolder : 1,
      };
      const shot = JSON.stringify(payload);
      if (shot === structureShot) return;
      structureShot = shot;
      structureMute = true;
      folders = payload.folders.map((folder) => ({
        id: folder.id,
        name: folder.name || 'Folder',
        parent: folder.parent || null,
      })).filter((folder) => folder.id);
      nextFolder = payload.nextFolder;
      const knownFolders = new Set(folders.map((folder) => folder.id));
      parents.clear();
      for (const [id, parentId] of Object.entries(payload.placement)) {
        if (typeof id !== 'string' || typeof parentId !== 'string' || !parentId) continue;
        // Folders must exist; part/object parents are kept so Cameras can live under Parts.
        if (parentId.startsWith('folder-') && !knownFolders.has(parentId)) continue;
        parents.set(id, parentId);
      }
      structureMute = false;
      closeMenu();
      render();
    };

    const folderById = (id) => folders.find((folder) => folder.id === id) ?? null;
    const parentOf = (id) => {
      const folder = folderById(id);
      return folder ? (folder.parent || null) : (parents.get(id) || null);
    };
    const contains = (ancestor, id) => {
      let current = id;
      while (current) {
        if (current === ancestor) return true;
        current = parentOf(current);
      }
      return false;
    };

    const closeSubmenu = () => {
      submenu.hidden = true;
      submenu.replaceChildren();
    };

    const closeMenu = () => {
      closeSubmenu();
      menu.hidden = true;
    };

    const placeSubmenu = (anchor) => {
      submenu.hidden = false;
      submenu.style.left = '0px';
      submenu.style.top = '0px';
      const parent = menu.getBoundingClientRect();
      const rect = submenu.getBoundingClientRect();
      let left = parent.right - 4;
      if (left + rect.width > window.innerWidth - 8) left = parent.left - rect.width + 4;
      let top = anchor.getBoundingClientRect().top - 4;
      top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
    };

    const fillSubmenu = (entries, anchor) => {
      submenu.replaceChildren();
      for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = entry.enabled === false;
        button.style.cssText = itemStyle;
        button.style.color = entry.enabled === false ? 'var(--gw-muted, #aeb4bb)' : 'inherit';
        button.textContent = entry.label;
        if (entry.enabled !== false) {
          button.addEventListener('mouseenter', () => { button.style.background = 'var(--gw-hover)'; });
          button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
          button.addEventListener('click', () => {
            closeMenu();
            entry.action();
          });
        }
        submenu.append(button);
      }
      placeSubmenu(anchor);
    };

    const fillMenu = (entries) => {
      closeSubmenu();
      menu.replaceChildren();
      for (const entry of entries) {
        if (entry.separated) {
          const rule = document.createElement('div');
          rule.style.cssText = 'height:1px;margin:4px 6px;background:var(--gw-line, rgba(255,255,255,.08))';
          menu.append(rule);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '';
        button.disabled = !entry.enabled;
        button.style.cssText = itemStyle;
        button.style.display = 'flex';
        button.style.justifyContent = 'space-between';
        button.style.alignItems = 'center';
        button.style.gap = '18px';
        button.style.color = entry.enabled ? 'inherit' : 'var(--gw-muted, #aeb4bb)';
        const name = document.createElement('span');
        name.textContent = entry.label;
        button.append(name);
        if (entry.submenu) {
          const mark = document.createElement('span');
          mark.textContent = '›';
          mark.style.cssText = 'color:var(--gw-muted, #aeb4bb);font-size:14px;line-height:1;';
          button.append(mark);
        } else if (entry.shortcut) {
          const keys = document.createElement('span');
          keys.textContent = entry.shortcut;
          keys.style.color = 'var(--gw-muted, #aeb4bb)';
          button.append(keys);
        }
        if (entry.enabled) {
          button.addEventListener('mouseenter', () => {
            button.style.background = 'var(--gw-hover)';
            if (entry.submenu) fillSubmenu(entry.submenu, button);
            else closeSubmenu();
          });
          button.addEventListener('mouseleave', (e) => {
            if (entry.submenu && submenu.contains(e.relatedTarget)) return;
            button.style.background = 'transparent';
            if (!entry.submenu) closeSubmenu();
          });
          if (!entry.submenu) {
            button.addEventListener('click', () => {
              closeMenu();
              entry.action();
            });
          }
        }
        menu.append(button);
      }
    };

    const createFolder = () => {
      const names = new Set(folders.map((folder) => folder.name));
      let name = 'Folder';
      if (names.has(name)) {
        let n = 2;
        while (names.has(`Folder ${n}`)) n += 1;
        name = `Folder ${n}`;
      }
      const id = `folder-${nextFolder}`;
      nextFolder += 1;
      folders.push({ id, name, parent: null });
      expanded.add(id);
      render();
      commitFolders();
    };

    const openMenu = (x, y) => {
      menu.hidden = false;
      menu.style.left = '0px';
      menu.style.top = '0px';
      const rect = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };

    const describe = (id) => {
      described = null;
      api.bus.emit('project:describe', id);
      return described ? {
        ...described,
        position: described.position.slice(),
        rotation: described.rotation.slice(),
      } : null;
    };

    const uniqueFolderName = (name) => {
      const names = new Set(folders.map((folder) => folder.name));
      if (!names.has(name)) return name;
      let n = 2;
      while (names.has(`${name} ${n}`)) n += 1;
      return `${name} ${n}`;
    };

    const addFolder = (name, parent) => {
      const id = `folder-${nextFolder}`;
      nextFolder += 1;
      folders.push({ id, name: uniqueFolderName(name), parent: parent || null });
      expanded.add(id);
      if (parent) expanded.add(parent);
      return id;
    };

    const holdsLocked = (id) => {
      if (locked.has(id)) return true;
      if (!folderById(id)) return false;
      const { objectIds } = subtree(id);
      return objectIds.some((objectId) => locked.has(objectId));
    };
    const subtree = (id) => {
      const folderIds = [];
      const objectIds = [];
      const walkIds = (parent) => {
        for (const folder of folders) {
          if ((folder.parent || null) !== parent) continue;
          folderIds.push(folder.id);
          walkIds(folder.id);
        }
        for (const object of objects) {
          if ((parents.get(object.id) || null) !== parent) continue;
          objectIds.push(object.id);
        }
      };
      walkIds(id);
      return { folderIds, objectIds };
    };

    const selectedTargets = () => {
      const chosen = [];
      const walkChosen = (parent) => {
        for (const folder of folders) {
          if ((folder.parent || null) !== parent) continue;
          if (selectedIds.has(folder.id)) chosen.push({ id: folder.id, kind: 'folder' });
          walkChosen(folder.id);
        }
        for (const object of objects) {
          if ((parents.get(object.id) || null) !== parent) continue;
          if (selectedIds.has(object.id)) chosen.push({ id: object.id, kind: 'object' });
        }
      };
      walkChosen(null);
      return chosen;
    };

    const withoutDescendants = (targets) => {
      const hidden = new Set();
      for (const target of targets) {
        if (target.kind !== 'folder') continue;
        const sub = subtree(target.id);
        for (const folderId of sub.folderIds) hidden.add(folderId);
        for (const objectId of sub.objectIds) hidden.add(objectId);
      }
      return targets.filter((target) => !hidden.has(target.id));
    };

    const snapshot = (id, kind) => {
      if (kind === 'object') {
        const spec = describe(id);
        return spec ? [{ kind: 'object', spec, relParent: null }] : null;
      }
      const folder = folderById(id);
      if (!folder) return null;
      const nodes = [{ kind: 'folder', source: id, name: folder.name, relParent: null }];
      const walkNodes = (parent) => {
        for (const child of folders) {
          if ((child.parent || null) !== parent) continue;
          nodes.push({ kind: 'folder', source: child.id, name: child.name, relParent: child.parent });
          walkNodes(child.id);
        }
        for (const object of objects) {
          if ((parents.get(object.id) || null) !== parent) continue;
          const spec = describe(object.id);
          if (spec) nodes.push({ kind: 'object', spec, relParent: parent });
        }
      };
      walkNodes(id);
      return nodes;
    };

    const snapshotMany = (targets) => {
      const nodes = [];
      for (const target of withoutDescendants(targets)) {
        const part = snapshot(target.id, target.kind);
        if (part) nodes.push(...part);
      }
      return nodes.length ? nodes : null;
    };

    const insertCopy = (spec, parent) => {
      if (liveMode) return;
      placing = true;
      placeParent = parent || null;
      api.bus.emit('project:insert', parent ? { ...spec, folder: parent } : spec);
      placing = false;
    };

    const pasteNodes = (nodes, parent, times) => {
      const sample = nodes.find((node) => node.kind === 'object');
      const shift = (Number(times) || 0) * (sample?.spec.width || 4);
      const idMap = new Map();
      for (const node of nodes) {
        if (node.kind !== 'folder') continue;
        const dest = node.relParent ? idMap.get(node.relParent) : parent;
        idMap.set(node.source, addFolder(node.name, dest || null));
      }
      if (idMap.size) commitFolders();
      for (const node of nodes) {
        if (node.kind !== 'object') continue;
        const position = node.spec.position.slice();
        position[0] += shift;
        const dest = node.relParent ? idMap.get(node.relParent) : parent;
        insertCopy({ ...node.spec, position }, dest || null);
      }
      render();
    };

    const removeNode = (id, kind) => {
      if (liveMode) return;
      if (holdsLocked(id)) return;
      if (kind === 'object') {
        const childIds = [...parents.entries()]
          .filter(([, parentId]) => parentId === id)
          .map(([childId]) => childId);
        for (const childId of childIds) {
          parents.delete(childId);
          api.bus.emit('project:delete', childId);
        }
        parents.delete(id);
        api.bus.emit('project:delete', id);
        commitFolders();
        return;
      }
      const { folderIds, objectIds } = subtree(id);
      for (const objectId of objectIds) {
        parents.delete(objectId);
        api.bus.emit('project:delete', objectId);
      }
      const drop = new Set([id, ...folderIds]);
      folders = folders.filter((folder) => !drop.has(folder.id));
      for (const folderId of drop) expanded.delete(folderId);
      render();
      commitFolders();
    };

    const targetParent = (id, kind) => (kind === 'folder' ? id : parentOf(id));

    const finishRename = (id, kind, value, commit) => {
      if (liveMode) {
        renaming = null;
        render();
        return;
      }
      if (!renaming || renaming.id !== id || renaming.kind !== kind) return;
      renaming = null;
      if (kind === 'object' && locked.has(id)) {
        render();
        return;
      }
      const name = commit ? value.trim() : '';
      if (kind === 'folder') {
        const folder = folderById(id);
        if (folder && name && name !== folder.name) {
          folder.name = name;
          commitFolders();
        }
        render();
        return;
      }
      if (name) api.bus.emit('project:rename', { kind: id, name });
      render();
    };

    const beginRename = (id, kind) => {
      if (liveMode) return;
      if (kind === 'object' && locked.has(id)) return;
      renaming = { id, kind };
      api.bus.emit('window:command', { id: 'explorer', action: 'show' });
      render();
      const input = list.querySelector('[data-rename]');
      if (!input) return;
      input.focus();
      input.select();
    };

    const openObjectMenu = (x, y, id, kind) => {
      if (liveMode) return;
      const clicked = { id, kind };
      let targets = [clicked];
      if (kind === 'object' && selectedIds.has(id)) {
        const many = selectedTargets();
        if (many.length) targets = many;
      } else if (kind === 'object') {
        api.bus.emit('scene:select', id);
      }
      const blocked = targets.some((target) => holdsLocked(target.id));
      const host = targets.length === 1 && targets[0].kind === 'object'
        ? objects.find((item) => item.id === targets[0].id)
        : null;
      const canInsertScript = !!(host
        && host.shape !== 'script'
        && host.shape !== 'baseplate'
        && host.id !== 'baseplate'
        && !blocked);
      const entries = [
        { label: 'Rename', shortcut: 'F2', enabled: targets.length === 1 && !blocked, action: () => beginRename(targets[0].id, targets[0].kind) },
        { label: 'Cut', shortcut: 'Ctrl+X', enabled: !blocked, separated: true, action: () => runCommand('cut', targets) },
        { label: 'Copy', shortcut: 'Ctrl+C', enabled: true, action: () => runCommand('copy', targets) },
        { label: 'Paste', shortcut: 'Ctrl+V', enabled: !!clipboard, action: () => runCommand('paste', targets, clicked) },
        { label: 'Duplicate', shortcut: 'Ctrl+D', enabled: true, action: () => runCommand('duplicate', targets) },
        {
          label: 'Zoom to',
          enabled: targets.some((target) => {
            if (target.kind !== 'object') return false;
            const obj = objects.find((item) => item.id === target.id);
            return obj && obj.shape !== 'script';
          }),
          action: () => {
            const ids = targets
              .filter((target) => target.kind === 'object')
              .map((target) => target.id)
              .filter((id) => {
                const obj = objects.find((item) => item.id === id);
                return obj && obj.shape !== 'script';
              });
            if (!ids.length) return;
            api.bus.emit('camera:frame', ids.length === 1 ? ids[0] : ids);
          },
        },
      ];
      if (canInsertScript) {
        entries.push({
          label: 'Insert',
          enabled: true,
          separated: true,
          submenu: [
            { label: 'Script', action: () => insertScript(host.id) },
          ],
        });
      }
      entries.push({ label: 'Delete', enabled: !blocked, separated: true, action: () => runCommand('delete', targets) });
      fillMenu(entries);
      openMenu(x, y);
    };

    const selectPlaced = () => {
      if (!placedIds.length) return;
      api.bus.emit('scene:select', placedIds.slice());
    };

    const runCommand = (command, targets, clicked) => {
      if (liveMode && command !== 'copy') return;
      const roots = withoutDescendants(targets);
      if (!roots.length) return;
      if (command === 'copy' || command === 'cut') {
        const nodes = snapshotMany(roots);
        if (!nodes) return;
        clipboard = { mode: command, nodes };
        if (command === 'cut') {
          for (const target of roots) removeNode(target.id, target.kind);
        }
        return;
      }
      if (command === 'paste') {
        if (!clipboard) return;
        const times = clipboard.mode === 'cut' ? 0 : (clipboard.pastes || 0) + 1;
        const dest = clicked || roots[0];
        placedIds = [];
        pasteNodes(clipboard.nodes, targetParent(dest.id, dest.kind), times);
        selectPlaced();
        if (clipboard.mode === 'cut') clipboard = null;
        else clipboard.pastes = times;
        return;
      }
      if (command === 'duplicate') {
        placedIds = [];
        for (const target of roots) {
          const nodes = snapshot(target.id, target.kind);
          if (nodes) pasteNodes(nodes, parentOf(target.id), 1);
        }
        selectPlaced();
        return;
      }
      if (command === 'delete') {
        for (const target of roots) removeNode(target.id, target.kind);
      }
    };

    const place = (id, parent) => {
      if (holdsLocked(id)) return;
      if (parent === id) return;
      if (parent && contains(id, parent)) return;
      const folder = folderById(id);
      if (folder) folder.parent = parent;
      else parents.set(id, parent);
      if (parent) expanded.add(parent);
      render();
      commitFolders();
    };

    const dropParent = (x, y) => {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        const row = el.closest?.('[data-node]');
        if (!row || !list.contains(row) || row.dataset.node === drag?.id) continue;
        // Folders and parts can both host children (Camera under a Part).
        return row.dataset.node;
      }
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === list || list.contains(hit))) return null;
      return undefined;
    };

    const paintDrop = (parent) => {
      for (const row of list.querySelectorAll('[data-node]')) {
        const hot = !!parent && row.dataset.node === parent;
        row.style.boxShadow = hot ? 'inset 0 0 0 1px var(--gw-text, #e8eaed)' : '';
      }
    };

    const finishDrag = (e) => {
      if (!drag) return;
      const info = drag;
      drag = null;
      paintDrop(null);
      if (!info.active) {
        if (info.double) {
          if (info.kind === 'object') {
            const obj = objects.find((item) => item.id === info.id);
            if (obj?.shape === 'script') {
              // Double-click Script (icon or name) opens the script editor.
              api.bus.emit('script-editor:open', { id: info.id });
              return;
            }
          }
          if (info.zone === 'label') beginRename(info.id, info.kind);
          else if (info.zone === 'icon' && info.kind === 'object') {
            api.bus.emit('camera:frame', info.id);
            api.bus.emit('app:open', 'properties');
          }
          return;
        }
        lastTap = { id: info.id, zone: info.zone, time: info.time, x: info.x, y: info.y };
        if (info.kind === 'object') {
          if (e.ctrlKey) {
            const next = new Set(selectedIds);
            if (next.has(info.id)) next.delete(info.id);
            else next.add(info.id);
            api.bus.emit('scene:select', [...next]);
          } else {
            api.bus.emit('scene:select', info.id);
          }
        } else if (info.kind === 'folder') {
          if (expanded.has(info.id)) expanded.delete(info.id);
          else expanded.add(info.id);
          render();
        } else {
          api.bus.emit('scene:select', info.id);
        }
        return;
      }
      const parent = dropParent(e.clientX, e.clientY);
      if (parent === undefined || parent === parentOf(info.id)) {
        render();
        return;
      }
      place(info.id, parent);
    };

    const onPointerMove = (e) => {
      if (!drag) return;
      if (!drag.active) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (dx * dx + dy * dy < 16) return;
        drag.active = true;
      }
      paintDrop(dropParent(e.clientX, e.clientY));
    };

    const render = () => {
      list.replaceChildren();
      const addRow = (id, kind, name, depth, selected, shape, expandable = false) => {
        const row = document.createElement('div');
        row.dataset.node = id;
        row.dataset.kind = kind;
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-selected', selected ? 'true' : 'false');
        row.style.cssText = [
          'display:flex',
          'align-items:center',
          'gap:6px',
          'width:100%',
          'box-sizing:border-box',
          'margin:0',
          'text-align:left',
          `padding:6px 8px 6px ${8 + depth * 16}px`,
          'border-radius:4px',
          `background:${selected ? 'var(--gw-press)' : 'transparent'}`,
          'color:inherit',
          'cursor:default',
        ].join(';');

        if (kind === 'folder' || expandable) {
          const twist = document.createElement('span');
          twist.dataset.twist = 'true';
          twist.innerHTML = CHEVRON;
          twist.style.cssText = [
            'width:12px',
            'height:12px',
            'display:grid',
            'place-items:center',
            'flex:0 0 auto',
            `transform:${expanded.has(id) ? 'rotate(90deg)' : 'none'}`,
          ].join(';');
          twist.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (expanded.has(id)) expanded.delete(id);
            else expanded.add(id);
            render();
          });
          row.append(twist);
        } else {
          const spacer = document.createElement('span');
          spacer.style.cssText = 'width:12px;flex:0 0 auto;';
          row.append(spacer);
        }

        const icon = document.createElement('span');
        icon.dataset.icon = 'true';
        icon.style.cssText = 'display:grid;place-items:center;flex:0 0 auto;';
        icon.innerHTML = kind === 'folder'
          ? FOLDER_ICON
          : shape === 'camera'
            ? CAMERA_ICON
            : shape === 'script'
              ? SCRIPT_ICON
              : PART_ICON;
        if (renaming && renaming.id === id && renaming.kind === kind) {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = name;
          input.dataset.rename = 'true';
          input.spellcheck = false;
          input.style.cssText = [
            'flex:1',
            'min-width:0',
            'box-sizing:border-box',
            'border:1px solid rgba(255,255,255,.28)',
            'border-radius:3px',
            'margin:0',
            'padding:1px 4px',
            'background:var(--gw-bg, #1c1c1c)',
            'color:inherit',
            'font:inherit',
            'outline:none',
          ].join(';');
          input.addEventListener('pointerdown', (e) => e.stopPropagation());
          input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              finishRename(id, kind, input.value, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finishRename(id, kind, '', false);
            }
          });
          input.addEventListener('blur', () => finishRename(id, kind, input.value, true));
          row.append(icon, input);
        } else {
          const label = document.createElement('span');
          label.dataset.label = 'true';
          label.textContent = name;
          label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          row.append(icon, label);
        }

        row.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || drag) return;
          const zone = e.target.closest?.('[data-icon]') ? 'icon' : (e.target.closest?.('[data-label]') ? 'label' : 'row');
          const now = performance.now();
          const repeat = lastTap
            && lastTap.id === id
            && lastTap.zone === zone
            && now - lastTap.time < 500
            && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 8;
          if (repeat) lastTap = null;
          drag = { id, kind, zone, time: now, x: e.clientX, y: e.clientY, active: false, double: !!repeat };
          try { row.setPointerCapture(e.pointerId); } catch { /* untrusted */ }
        });
        row.addEventListener('pointerenter', () => {
          if (!selected && drag?.id !== id) row.style.background = 'var(--gw-hover)';
        });
        row.addEventListener('pointerleave', () => {
          if (drag?.id !== id) row.style.background = selected ? 'var(--gw-press)' : 'transparent';
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openObjectMenu(e.clientX, e.clientY, id, kind);
        });
        list.append(row);
      };

      const childObjects = (parent) => objects.filter((object) => (parents.get(object.id) || null) === parent);

      const walk = (parent, depth) => {
        let count = 0;
        for (const folder of folders) {
          if ((folder.parent || null) !== parent) continue;
          count += 1;
          addRow(folder.id, 'folder', folder.name, depth, false);
          if (expanded.has(folder.id)) count += walk(folder.id, depth + 1);
        }
        for (const object of objects) {
          if ((parents.get(object.id) || null) !== parent) continue;
          count += 1;
          const kids = childObjects(object.id);
          addRow(
            object.id,
            'object',
            object.name,
            depth,
            selectedIds.has(object.id),
            object.shape,
            kids.length > 0,
          );
          if (kids.length && expanded.has(object.id)) count += walk(object.id, depth + 1);
        }
        return count;
      };

      if (!walk(null, 0)) {
        const empty = document.createElement('div');
        empty.textContent = 'No objects';
        empty.style.cssText = 'padding:12px 10px;color:var(--gw-muted, #aeb4bb);';
        list.append(empty);
      }
    };

    const insertCamera = () => {
      placeParent = null;
      placing = true;
      placedIds = [];
      api.bus.emit('part:create', 'camera');
      placing = false;
    };

    const insertScript = (parentId = null) => {
      placeParent = parentId || null;
      placing = true;
      placedIds = [];
      if (parentId) expanded.add(parentId);
      api.bus.emit('project:insert', {
        shape: 'script',
        name: 'Script',
        width: 1,
        height: 1,
        depth: 1,
        position: [0, 2, 0],
        rotation: [0, 0, 0],
        color: '#fcfcfc',
        folder: parentId || undefined,
        script: { enabled: true, source: '' },
      });
      placing = false;
    };

    list.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-node]')) return;
      e.preventDefault();
      fillMenu([
        { label: 'New Folder', enabled: true, action: createFolder },
        {
          label: 'Insert',
          enabled: true,
          submenu: [
            { label: 'Camera', action: insertCamera },
            { label: 'Script', action: () => insertScript(null) },
          ],
        },
      ]);
      openMenu(e.clientX, e.clientY);
    });

    submenu.addEventListener('mouseleave', (e) => {
      if (menu.contains(e.relatedTarget)) return;
      closeSubmenu();
    });

    const onPointerDown = (e) => {
      if (menu.hidden && submenu.hidden) return;
      if (menu.contains(e.target) || submenu.contains(e.target)) return;
      closeMenu();
    };
    const typing = () => {
      const el = document.activeElement;
      return !!(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
    };
    const textSelected = () => {
      const sel = window.getSelection();
      return !!(sel && !sel.isCollapsed && String(sel));
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeMenu();
      if (typing() || e.repeat) return;
      if (e.key === 'F2') {
        const targets = selectedTargets();
        if (targets.length !== 1) return;
        e.preventDefault();
        closeMenu();
        beginRename(targets[0].id, targets[0].kind);
        return;
      }
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      const command = e.code === 'KeyC' ? 'copy'
        : e.code === 'KeyX' ? 'cut'
        : e.code === 'KeyV' ? 'paste'
        : e.code === 'KeyD' ? 'duplicate'
        : null;
      if (!command) return;
      // Don't steal OS clipboard when the user is copying/cutting selected UI text
      // (e.g. Assistant chat bubbles).
      if ((command === 'copy' || command === 'cut') && textSelected()) return;
      e.preventDefault();
      closeMenu();
      const targets = selectedTargets();
      if (command === 'paste') {
        if (!clipboard) return;
        const dest = targets[0] || { id: 'root', kind: 'object' };
        runCommand('paste', targets.length ? targets : [dest], dest);
        return;
      }
      if (targets.length) runCommand(command, targets);
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('keydown', onKey);

    api.bus.on('explorer:context', (spec) => {
      if (!spec || spec.id == null) return;
      openObjectMenu(spec.x || 0, spec.y || 0, spec.id, 'object');
    });
    api.bus.on('app:open', (id) => {
      if (id !== 'explorer') return;
      frame.show();
      api.bus.emit('scene:request');
    });
    api.bus.on('project:described', (part) => { described = part; });
    api.bus.on('project:inserted', (id) => {
      if (!placing || !id) return;
      placedIds.push(id);
      if (placeParent) {
        parents.set(id, placeParent);
        expanded.add(placeParent);
      }
    });
    api.bus.on('project:locks', (ids) => {
      locked = new Set(Array.isArray(ids) ? ids : []);
    });
    api.bus.on('scene:objects', (next) => {
      objects = Array.isArray(next) ? next : [];
      render();
    });
    api.bus.on('scene:selected', (id) => {
      const ids = Array.isArray(id) ? id.filter(Boolean) : (id ? [id] : []);
      const same = ids.length === selectedIds.size && ids.every((item) => selectedIds.has(item));
      if (same) return;
      selectedIds = new Set(ids);
      render();
    });
    api.bus.on('project:opened', (doc) => applyStructure(doc));
    api.bus.on('project:reverted', (doc) => applyStructure(doc));
    api.bus.on('project:folders-state', (doc) => applyStructure(doc));
    api.bus.on('mode:changed', (mode) => {
      liveMode = mode === 'live';
      if (liveMode) closeMenu();
    });
    api.bus.emit('mode:request');
    api.bus.emit('project:folders-request');

    frame.body.append(list);
    api.bus.emit('scene:request');
    if (window.__explorerOpen) {
      frame.show();
      delete window.__explorerOpen;
    }

    return () => {
      if (root.style.display !== 'none') window.__explorerOpen = true;
      closeMenu();
      menu.remove();
      submenu.remove();
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('keydown', onKey);
    };
  },
};
