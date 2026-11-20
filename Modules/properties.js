// Properties for the current selection. Collapsible categories; numbers commit on blur.
import { frameWindow } from '/Assets/lib/window.js?v=11';

export const order = 6;

const ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M2.2 4.2h11.6M2.2 8h11.6M2.2 11.8h11.6"/>
    <circle cx="5.2" cy="4.2" r="1.5" fill="currentColor"/>
    <circle cx="10.6" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="6.4" cy="11.8" r="1.5" fill="currentColor"/>
  </svg>`;

const round = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return String(Math.round(number * 100) / 100);
};

const shared = (values) => {
  if (!values.length) return null;
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : null;
};

const defaultPhysics = () => ({
  canCollide: true,
  enabled: false,
  gravity: true,
  gravityScale: 1,
  massOverride: 0,
  linearDamping: 0,
  angularDamping: 0.05,
  startAsleep: false,
});

export default {
  mount(root, api) {
    const frame = frameWindow(root, api, {
      id: 'properties',
      title: 'Properties',
      icon: ICON,
      width: 320,
      height: 430,
      snap: 'right',
    });

    const form = document.createElement('div');
    form.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:8px;';
    frame.body.append(form);

    let ids = [];
    let parts = [];
    let writing = false;
    let liveMode = false;
    const openCats = (() => {
      try {
        return JSON.parse(sessionStorage.getItem('gw-props-cats') || '{}');
      } catch {
        return {};
      }
    })();

    const focused = () => form.contains(document.activeElement);

    const note = (text) => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'color:var(--gw-muted, #aeb4bb);padding:8px 0;';
      return el;
    };

    const textInput = (value, placeholder = '') => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.style.cssText = 'width:100%;min-width:0;border:0;outline:none;background:transparent;color:inherit;font:inherit;padding:0;';
      return input;
    };

    const well = (child) => {
      const box = document.createElement('div');
      box.style.cssText = [
        'display:flex',
        'align-items:center',
        'height:26px',
        'padding:0 8px',
        'border-radius:4px',
        'background:var(--gw-well, #1c1c1c)',
        'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
        'min-width:0',
        'flex:1 1 0',
        'overflow:hidden',
      ].join(';');
      const input = child;
      input.addEventListener('focus', () => { box.style.borderColor = 'rgba(255,255,255,.28)'; });
      input.addEventListener('blur', () => { box.style.borderColor = ''; });
      box.append(input);
      return box;
    };

    const labeled = (label, control) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(104px,44%) minmax(0,1fr);align-items:center;gap:8px;';
      const name = document.createElement('span');
      name.textContent = label;
      name.title = label;
      name.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gw-muted, #aeb4bb);';
      const slot = document.createElement('div');
      slot.style.cssText = 'min-width:0;display:flex;align-items:center;';
      slot.append(control);
      row.append(name, slot);
      return row;
    };

    const category = (id, title, build) => {
      const open = openCats[id] !== false;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border:1px solid var(--gw-line, rgba(255,255,255,.08));border-radius:6px;overflow:hidden;';
      const head = document.createElement('button');
      head.type = 'button';
      head.style.cssText = [
        'appearance:none',
        'width:100%',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'margin:0',
        'padding:7px 10px',
        'border:0',
        'background:rgba(255,255,255,.03)',
        'color:inherit',
        'font:600 12px/1 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
        'cursor:pointer',
        'text-align:left',
      ].join(';');
      const chevron = document.createElement('span');
      chevron.style.cssText = 'width:12px;flex:0 0 auto;color:var(--gw-muted, #aeb4bb);';
      const label = document.createElement('span');
      label.textContent = title;
      head.append(chevron, label);
      const body = document.createElement('div');
      body.style.cssText = 'flex-direction:column;gap:8px;padding:10px;border-top:1px solid var(--gw-line, rgba(255,255,255,.08));';
      const setOpen = (next) => {
        body.style.display = next ? 'flex' : 'none';
        chevron.textContent = next ? '▾' : '▸';
        openCats[id] = next;
        try { sessionStorage.setItem('gw-props-cats', JSON.stringify(openCats)); } catch { /* private mode */ }
      };
      setOpen(open);
      build(body);
      head.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(body.style.display === 'none');
      });
      wrap.append(head, body);
      return wrap;
    };

    const axisRow = (title, values) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;';
      const heading = document.createElement('div');
      heading.textContent = title;
      heading.style.cssText = 'color:var(--gw-muted, #aeb4bb);font-size:12px;';
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;gap:6px;min-width:0;';
      const inputs = ['X', 'Y', 'Z'].map((axis, index) => {
        const value = values[index];
        const input = textInput(value == null ? '' : round(value), value == null ? '—' : '');
        input.setAttribute('aria-label', `${title} ${axis}`);
        const cell = well(input);
        const mark = document.createElement('span');
        mark.textContent = axis;
        mark.style.cssText = 'color:var(--gw-muted, #aeb4bb);margin-right:4px;flex:0 0 auto;';
        cell.insertBefore(mark, input);
        line.append(cell);
        return input;
      });
      wrap.append(heading, line);
      return { wrap, inputs };
    };

    const readOptional = (inputs) => [...inputs].map((input) => {
      const raw = input.value.trim();
      if (!raw) return null;
      const number = Number(raw);
      return Number.isFinite(number) ? number : NaN;
    });

    const commitNumbers = () => {
      if (liveMode || writing || !parts.length) return;
      const position = readOptional(form.querySelectorAll('[data-axis="position"]'));
      const size = readOptional(form.querySelectorAll('[data-axis="size"]'));
      const rotation = readOptional(form.querySelectorAll('[data-axis="rotation"]'));
      if ([...position, ...size, ...rotation].some((value) => Number.isNaN(value))) return;
      if (size.some((value) => value != null && value <= 0)) return;
      const touched = [...position, ...size, ...rotation].some((value) => value != null);
      if (!touched) return;
      writing = true;
      const changes = parts.map((part) => {
        const nextPos = (part.position || [0, 0, 0]).slice(0, 3);
        const nextRot = (part.rotation || [0, 0, 0]).slice(0, 3);
        const nextSize = { x: part.width, y: part.height, z: part.depth };
        for (let i = 0; i < 3; i += 1) {
          if (position[i] != null) nextPos[i] = position[i];
          if (rotation[i] != null) nextRot[i] = rotation[i] * Math.PI / 180;
          if (size[i] != null) {
            if (i === 0) nextSize.x = size[i];
            if (i === 1) nextSize.y = size[i];
            if (i === 2) nextSize.z = size[i];
          }
        }
        return { kind: part.kind, position: nextPos, rotation: nextRot, size: nextSize };
      });
      api.bus.emit('project:change', { changes });
      writing = false;
    };

    const wireNumber = (input, group) => {
      input.dataset.axis = group;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('blur', () => commitNumbers());
    };

    const patch = (fields) => {
      if (liveMode || writing || !ids.length) return;
      writing = true;
      api.bus.emit('project:patch', { kinds: ids.slice(), ...fields });
      writing = false;
    };

    const colorControl = (label, value, onLive, onCommit) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#b1b2b5';
      input.style.cssText = 'width:42px;height:22px;padding:0;border:0;background:transparent;cursor:default;';
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('input', () => onLive?.(input.value));
      input.addEventListener('change', () => onCommit?.(input.value));
      input.addEventListener('blur', () => api.bus.emit('project:preview-end'));
      return labeled(label, input);
    };

    const checkControl = (label, checked, onChange) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      input.style.cssText = 'width:16px;height:16px;margin:0;accent-color:#5b9dff;';
      input.addEventListener('change', () => onChange(!!input.checked));
      return labeled(label, input);
    };

    const numberControl = (label, value, opts, onCommit) => {
      const input = textInput(value == null ? '' : round(value), opts?.placeholder || '');
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('blur', () => {
        const raw = input.value.trim();
        if (!raw) {
          if (opts?.allowEmpty) onCommit(null);
          return;
        }
        const number = Number(raw);
        if (!Number.isFinite(number)) return;
        if (opts?.min != null && number < opts.min) return;
        if (opts?.max != null && number > opts.max) return;
        onCommit(number);
      });
      return labeled(label, well(input));
    };

    const selectControl = (label, value, choices, onChange) => {
      const select = document.createElement('select');
      select.style.cssText = [
        'width:100%',
        'min-width:0',
        'height:26px',
        'box-sizing:border-box',
        'border-radius:4px',
        'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
        'background:var(--gw-well, #1c1c1c)',
        'color:inherit',
        'font:inherit',
        'padding:0 6px',
      ].join(';');
      for (const choice of choices) {
        const opt = document.createElement('option');
        opt.value = choice.value;
        opt.textContent = choice.label;
        if (choice.value === value) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('keydown', (e) => e.stopPropagation());
      select.addEventListener('change', () => onChange(select.value));
      return labeled(label, select);
    };

    const modeToggle = (value, choices, onChange) => {
      const row = document.createElement('div');
      row.style.cssText = [
        'display:grid',
        `grid-template-columns:repeat(${Math.max(1, choices.length)}, minmax(0, 1fr))`,
        'gap:4px',
      ].join(';');
      const buttons = [];
      const paint = (active) => {
        for (const button of buttons) {
          const on = button.dataset.value === active;
          button.style.background = on ? 'rgba(91,157,255,.22)' : 'var(--gw-well, #1c1c1c)';
          button.style.borderColor = on ? 'rgba(91,157,255,.55)' : 'var(--gw-line, rgba(255,255,255,.08))';
          button.style.color = on ? '#e8eaed' : 'var(--gw-muted, #aeb4bb)';
        }
      };
      for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = choice.value;
        button.textContent = choice.label;
        button.style.cssText = [
          'appearance:none',
          'margin:0',
          'padding:7px 6px',
          'border-radius:5px',
          'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
          'background:var(--gw-well, #1c1c1c)',
          'color:var(--gw-muted, #aeb4bb)',
          'font:600 11px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
          'cursor:pointer',
          'text-align:center',
        ].join(';');
        button.addEventListener('click', () => {
          if (choice.value === value) return;
          paint(choice.value);
          onChange(choice.value);
        });
        buttons.push(button);
        row.append(button);
      }
      paint(value);
      return row;
    };

    const tipLine = (text) => {
      const tip = document.createElement('div');
      tip.textContent = text;
      tip.style.cssText = 'color:var(--gw-muted, #aeb4bb);font-size:11px;line-height:1.35;';
      return tip;
    };

    const physicsOf = (part) => ({ ...defaultPhysics(), ...(part.physics || {}) });

    const paint = (force = false) => {
      if (!force && focused()) return;
      form.replaceChildren();
      form.style.pointerEvents = liveMode ? 'none' : '';
      form.style.opacity = liveMode ? '0.55' : '1';
      if (liveMode) {
        form.append(note('Properties are read-only in Live Mode. Press Stop to edit.'));
        return;
      }
      if (!ids.length || !parts.length) {
        form.append(note(ids.length ? 'Loading…' : 'Nothing selected'));
        return;
      }

      const multi = parts.length > 1;
      if (multi) form.append(note(`${parts.length} objects selected`));

      const onlyShape = !multi ? parts[0]?.shape : null;
      const isCamera = onlyShape === 'camera';
      const isScript = onlyShape === 'script';
      const dynamicParts = parts.filter((part) => part.kind !== 'baseplate' && part.shape !== 'camera' && part.shape !== 'script');
      const canPhysics = !isCamera && !isScript && dynamicParts.length > 0 && dynamicParts.length === parts.length;
      const canEmissive = !isCamera && !isScript && parts.some((part) => part.kind !== 'baseplate');

      if (!multi) {
        form.append(category('object', 'Object', (body) => {
          const part = parts[0];
          const name = textInput(part.name || '');
          name.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') name.blur();
          });
          name.addEventListener('blur', () => {
            const next = name.value.trim();
            if (!next || next === part.name) return;
            writing = true;
            api.bus.emit('project:rename', { kind: part.kind, name: next });
            writing = false;
          });
          body.append(labeled('Name', well(name)));
          const shapeNames = {
            block: 'Block', sphere: 'Sphere', cylinder: 'Cylinder', wedge: 'Wedge',
            corner: 'Corner Wedge', camera: 'Camera', script: 'Script', solid: 'Solid',
          };
          const shape = document.createElement('div');
          shape.textContent = shapeNames[part.shape] || 'Block';
          shape.style.cssText = 'color:var(--gw-muted, #aeb4bb);';
          body.append(labeled('Class', shape));
        }));
      }

      if (isScript) {
        const scr = parts[0].script || {};
        form.append(category('script', 'Script', (body) => {
          body.append(checkControl(
            'Enabled',
            scr.enabled !== false,
            (checked) => patch({ script: { enabled: checked } }),
          ));
          const area = document.createElement('textarea');
          area.value = typeof scr.source === 'string' ? scr.source : '';
          area.spellcheck = false;
          area.placeholder = '-- Script source (runs later, like Roblox)';
          area.style.cssText = [
            'width:100%',
            'min-height:160px',
            'box-sizing:border-box',
            'resize:vertical',
            'margin:0',
            'padding:8px',
            'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
            'border-radius:6px',
            'background:var(--gw-bg, #1c1c1c)',
            'color:var(--gw-text, #e8eaed)',
            'font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            'outline:none',
          ].join(';');
          area.addEventListener('keydown', (e) => e.stopPropagation());
          area.addEventListener('blur', () => {
            const next = area.value;
            const prev = typeof scr.source === 'string' ? scr.source : '';
            if (next === prev) return;
            patch({ script: { source: next } });
          });
          body.append(area);
          body.append(tipLine('Parent Scripts under Parts in Explorer. Runtime execution comes next.'));
        }));
        return;
      }

      if (isCamera) {
        const cam = parts[0].camera || {};
        const mode = ['firstPerson', 'thirdPerson', 'topDown'].includes(cam.mode) ? cam.mode : 'firstPerson';
        const fov = Number(cam.fieldOfView);
        const hasPartParent = !!(parts[0].parent && !String(parts[0].parent).startsWith('folder-'));

        form.append(category('camera', 'Camera', (body) => {
          const modeLabel = document.createElement('div');
          modeLabel.textContent = 'Mode';
          modeLabel.style.cssText = 'color:var(--gw-muted, #aeb4bb);font-size:12px;';
          body.append(modeLabel);
          body.append(modeToggle(
            mode,
            [
              { value: 'firstPerson', label: 'First Person' },
              { value: 'thirdPerson', label: 'Third Person' },
              { value: 'topDown', label: 'Top Down' },
            ],
            (value) => {
              patch({ camera: { mode: value } });
              if (parts[0]) {
                parts[0] = {
                  ...parts[0],
                  camera: { ...(parts[0].camera || {}), mode: value },
                };
              }
              paint(true);
            },
          ));
          body.append(tipLine(
            mode === 'thirdPerson'
              ? 'Orbit behind the parent Part. Distance and Height set the chase offset.'
              : mode === 'topDown'
                ? 'Look straight down from above. Height is how far above the Part the view sits.'
                : 'Eyes on the parent Part. Eye Height is the vertical offset from the Part center.',
          ));
          body.append(numberControl(
            'Field Of View',
            Number.isFinite(fov) ? fov : 70,
            { min: 1, max: 120 },
            (value) => patch({ camera: { fieldOfView: value } }),
          ));
          if (mode === 'thirdPerson') {
            body.append(numberControl(
              'Distance',
              Number.isFinite(cam.distance) ? cam.distance : 10,
              { min: 1, max: 200 },
              (value) => patch({ camera: { distance: value } }),
            ));
            body.append(numberControl(
              'Height',
              Number.isFinite(cam.height) ? cam.height : 1.5,
              { min: -50, max: 400 },
              (value) => patch({ camera: { height: value } }),
            ));
          } else if (mode === 'topDown') {
            body.append(numberControl(
              'Height',
              Number.isFinite(cam.height) ? cam.height : 40,
              { min: 2, max: 400 },
              (value) => patch({ camera: { height: value } }),
            ));
          } else {
            body.append(numberControl(
              'Eye Height',
              Number.isFinite(cam.height) ? cam.height : 1.5,
              { min: -50, max: 400 },
              (value) => patch({ camera: { height: value } }),
            ));
          }
        }));

        form.append(category('camera-parent', 'Parent', (body) => {
          if (!hasPartParent) {
            body.append(tipLine('Parent this Camera under a Part in Explorer so it follows that Part in Edit and Live Mode.'));
            return;
          }
          body.append(checkControl(
            'Rotate Parent',
            cam.turnParent !== false,
            (checked) => {
              patch({ camera: { turnParent: checked } });
              if (parts[0]) {
                parts[0] = {
                  ...parts[0],
                  camera: { ...(parts[0].camera || {}), turnParent: checked },
                };
              }
            },
          ));
          body.append(tipLine(
            'When enabled, the parent Part yaws to face the camera look direction in Live Mode.',
          ));
        }));
      }

      form.append(category('transform', 'Transform', (body) => {
        const positionValues = [0, 1, 2].map((index) => shared(parts.map((part) => Number((part.position || [0, 0, 0])[index]) || 0)));
        const sizeValues = [
          shared(parts.map((part) => Number(part.width))),
          shared(parts.map((part) => Number(part.height))),
          shared(parts.map((part) => Number(part.depth))),
        ];
        const rotationValues = [0, 1, 2].map((index) => {
          const degrees = parts.map((part) => (Number((part.rotation || [0, 0, 0])[index]) || 0) * 180 / Math.PI);
          return shared(degrees.map((value) => Math.round(value * 100) / 100));
        });
        const position = axisRow('Position', positionValues);
        const size = axisRow('Size', sizeValues);
        const rotation = axisRow('Rotation', rotationValues);
        position.inputs.forEach((input) => wireNumber(input, 'position'));
        size.inputs.forEach((input) => wireNumber(input, 'size'));
        rotation.inputs.forEach((input) => wireNumber(input, 'rotation'));
        if (isCamera) body.append(position.wrap, rotation.wrap);
        else body.append(position.wrap, size.wrap, rotation.wrap);
      }));

      if (!isCamera) {
        form.append(category('appearance', 'Appearance', (body) => {
          const color = shared(parts.map((part) => (part.color || '').toLowerCase()));
          body.append(colorControl(
            'Color',
            color || '#b1b2b5',
            (value) => api.bus.emit('project:recolor', { kinds: ids.slice(), color: value, live: true }),
            (value) => api.bus.emit('project:recolor', { kinds: ids.slice(), color: value }),
          ));

          if (!canEmissive) return;
          const emissiveOn = shared(parts.map((part) => !!part.emissive));
          const emissiveIntensity = shared(parts.map((part) => Number(part.emissiveIntensity)));
          body.append(checkControl('Emissive', !!emissiveOn, (checked) => patch({ emissive: checked })));
          body.append(numberControl(
            'Intensity',
            emissiveIntensity == null ? 1 : emissiveIntensity,
            { min: 0, max: 20 },
            (value) => patch({ emissiveIntensity: value }),
          ));
          body.append(tipLine('Lights nearby surfaces using this part\'s color. Intensity scales the light.'));
        }));
      } else {
        form.append(category('appearance', 'Appearance', (body) => {
          const color = shared(parts.map((part) => (part.color || '').toLowerCase()));
          body.append(colorControl(
            'Gizmo Color',
            color || '#5b9dff',
            (value) => api.bus.emit('project:recolor', { kinds: ids.slice(), color: value, live: true }),
            (value) => api.bus.emit('project:recolor', { kinds: ids.slice(), color: value }),
          ));
          body.append(tipLine('Only affects the Camera gizmo in Edit Mode.'));
        }));
      }

      if (canPhysics) {
        form.append(category('physics', 'Physics', (body) => {
          const phys = parts.map(physicsOf);
          const canCollide = shared(phys.map((p) => p.canCollide !== false));
          const enabled = shared(phys.map((p) => !!p.enabled));
          const gravity = shared(phys.map((p) => !!p.gravity));
          const gravityScale = shared(phys.map((p) => Number(p.gravityScale)));
          const massOverride = shared(phys.map((p) => Number(p.massOverride)));
          const linearDamping = shared(phys.map((p) => Number(p.linearDamping)));
          const angularDamping = shared(phys.map((p) => Number(p.angularDamping)));
          const startAsleep = shared(phys.map((p) => !!p.startAsleep));

          body.append(checkControl('Can Collide', canCollide !== false, (checked) => patch({ physics: { canCollide: checked } })));
          body.append(checkControl('Motion Enabled', !!enabled, (checked) => patch({ physics: { enabled: checked } })));
          body.append(checkControl('Gravity', gravity !== false, (checked) => patch({ physics: { gravity: checked } })));
          body.append(numberControl(
            'Gravity Scale',
            gravityScale == null ? 1 : gravityScale,
            { min: 0, max: 20 },
            (value) => patch({ physics: { gravityScale: value } }),
          ));
          body.append(numberControl(
            'Mass Override',
            massOverride == null ? 0 : massOverride,
            { min: 0, max: 100000, placeholder: '0 = auto' },
            (value) => patch({ physics: { massOverride: value } }),
          ));
          body.append(numberControl(
            'Linear Damp',
            linearDamping == null ? 0 : linearDamping,
            { min: 0, max: 10 },
            (value) => patch({ physics: { linearDamping: value } }),
          ));
          body.append(numberControl(
            'Angular Damp',
            angularDamping == null ? 0.05 : angularDamping,
            { min: 0, max: 10 },
            (value) => patch({ physics: { angularDamping: value } }),
          ));
          body.append(checkControl('Start Asleep', !!startAsleep, (checked) => patch({ physics: { startAsleep: checked } })));
          const tip = document.createElement('div');
          tip.textContent = 'Can Collide is on by default. Motion Enabled runs simulation in Live Mode; Mass Override 0 uses volume-based mass.';
          tip.style.cssText = 'color:var(--gw-muted, #aeb4bb);font-size:11px;line-height:1.35;';
          body.append(tip);
        }));
      }
    };

    const refresh = () => {
      if (!ids.length) {
        parts = [];
        paint();
        return;
      }
      if (ids.length === 1) api.bus.emit('project:describe', ids[0]);
      else api.bus.emit('project:describe-many', ids.slice());
    };

    api.bus.on('app:open', (id) => {
      if (id === 'properties') frame.show();
    });
    api.bus.on('scene:selected', (id) => {
      ids = Array.isArray(id) ? id.filter(Boolean) : (id ? [id] : []);
      parts = [];
      refresh();
      paint();
    });
    api.bus.on('project:described', (next) => {
      if (ids.length !== 1) return;
      parts = next ? [{ ...next, kind: next.kind || ids[0] }] : [];
      paint();
    });
    api.bus.on('project:described-many', (list) => {
      if (ids.length < 2) return;
      const byId = new Map((Array.isArray(list) ? list : []).map((part) => [part.kind, part]));
      parts = ids.map((id) => byId.get(id)).filter(Boolean);
      paint();
    });
    api.bus.on('project:reverted', () => {
      if (writing || focused()) return;
      refresh();
    });
    api.bus.on('mode:changed', (mode) => {
      liveMode = mode === 'live';
      paint();
    });
    api.bus.emit('mode:request');
    api.bus.emit('scene:request');
    if (window.__propertiesOpen) {
      frame.show();
      delete window.__propertiesOpen;
    }

    return () => {
      if (root.style.display !== 'none') window.__propertiesOpen = true;
    };
  },
};
