// In-editor Assistant — Roblox-style chat backed by a GameWindow-owned local model.
import { frameWindow } from '/Assets/lib/window.js?v=11';
import {
  createAssistantRuntime,
  ASSISTANT_MODEL,
} from '/Assets/lib/assistant-runtime.js?v=2';

export const order = 8;

const ICON = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="8" cy="8" r="2.2" fill="currentColor"/>
    <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
      d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1"/>
  </svg>`;

const SUGGESTIONS = [
  'Check if Live Mode is ready',
  'Add a Camera and a Script on the Player',
  'Make a 5×5 red tile floor',
  'Frame the selection',
];

const SYSTEM = `You are GameWindow Assistant — an in-editor helper for a SketchUp-like 3D game editor.
Prefer tools for any scene change. You MUST use the native tool-calling interface (tool_calls). Never write JSON tool calls in your message text. Never narrate plans, draft Lua in chat, or pretend you called a tool — call it.
After tools finish, give a short confirmation only (no chain-of-thought).

Tool discipline (critical):
- Every parent=, ids=, id= argument MUST be an id from a tool result (e.g. "part-8", "folder-1"), NEVER a display name like "Player".
- Workflow for named objects: find_by_name → read the match.id → pass that id into create_script/set_parent/patch/etc.
- After creating or parenting, verify with describe_selection or list_folders that parent equals that id.
- For Scripts: ALWAYS call get_scripting_guide first. create_script / write_script AUTOMATICALLY delete sibling scripts under the same parent and orphan scripts with invalid parents — you do not need to delete those manually after a successful save.
- If audit_scripts still shows extras, call cleanup_scripts with keep=<good id>. After writing movement Scripts, probe_live_scripts (key=KeyW) and rewrite until healthy.
- If a tool returns an error or lint issues, fix and retry; do not claim success.

Product:
- Edit tools: Select, Move, Rotate, Scale, Pencil, Line, Rectangle, Circle, Push/Pull, Erase
- Live Mode needs a Camera parented under the player Part. There are no Controllers.
- Movement/gameplay = enabled Scripts only.

GameWindow Lua (mandatory — call get_scripting_guide before writing Scripts):
- Prefer game:GetService("Players"|"RunService"|"UserInputService"). game.Players / game.RunService / game.UserInputService also work.
- Character = game.Players.LocalPlayer.Character (the Part that owns the play Camera). Guard nil. NO Humanoid, NO :Move/:Jump.
- Mouse look is BUILT INTO Live Mode (right-mouse drag). NEVER set camera.CFrame or use InputChanged/GetMouseLocation/Vector2.
- Move with AssemblyLinearVelocity or Position; set character.Anchored=false; multiply motion by Heartbeat dt.
- Face-relative WASD: use character.Orientation.Y (degrees) → yaw=math.rad(...); forward=(-sin(yaw),0,-cos(yaw)).
- Jump: on InputBegan, check input.KeyCode.Name == "Space" (KeyCode is a table — never compare KeyCode == Enum.KeyCode.Space).
- Walk velocity: AssemblyLinearVelocity = Vector3.new(dir.X * speed, current.Y, dir.Z * speed). Do NOT multiply velocity by dt. Do NOT zero Y.
- UserInputService: only IsKeyDown / InputBegan / InputEnded. Enum.KeyCode.W/A/S/D/Space.

For destructive file ops (new/open), require clear user confirmation then confirm=true.`;

const vec3 = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_scene',
      description: 'List parts and helpers currently in the scene.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_selection',
      description: 'Describe the current selection (or specific part ids).',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Optional part ids; omit for current selection.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_by_name',
      description: 'Find parts/scripts/cameras by name. Returns matches with id fields — always use those ids (not names) in later tools.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          exact: { type: 'boolean', description: 'If true, require exact name match; otherwise substring.' },
          select: { type: 'boolean', description: 'If true, select all matches.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scripting_guide',
      description: 'Return the GameWindow Live Mode Lua API cheat sheet and a working movement recipe. REQUIRED before writing movement/gameplay Scripts.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lint_script',
      description: 'Lint a Script id (or raw source) for GameWindow-incompatible APIs. Fix issues with write_script before claiming done.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source: { type: 'string', description: 'Optional raw source to lint without reading an id.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'audit_scripts',
      description: 'Audit every Script in the project (or under a parent id): name, parent, enabled, source length, lint, and whether it looks like movement. Use this to find conflicting movement scripts.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Optional part/folder id to only include scripts parented under it.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'probe_live_scripts',
      description: 'Enter Live Mode briefly, capture script runtime log lines, optionally simulate a key, then return to Edit Mode. Use to verify movement scripts actually run.',
      parameters: {
        type: 'object',
        properties: {
          holdMs: { type: 'number', description: 'How long to stay in Live Mode (default 900, max 3000).' },
          key: { type: 'string', description: 'Optional key code to hold while live, e.g. KeyW or Space.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cleanup_scripts',
      description: 'Delete conflicting/orphan Scripts. Pass keep=id to preserve one script; deletes other scripts under the same parent plus scripts with invalid parents. If parent is set without keep, deletes all scripts under that parent.',
      parameters: {
        type: 'object',
        properties: {
          keep: { type: 'string', description: 'Script id to keep.' },
          parent: { type: 'string', description: 'Optional parent part id to scope cleanup.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_parts',
      description: 'Select one or more parts by id. Pass empty to clear selection.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_part',
      description: 'Insert a part or Camera. For Scripts use create_script.',
      parameters: {
        type: 'object',
        properties: {
          shape: { type: 'string', enum: ['block', 'sphere', 'cylinder', 'wedge', 'corner', 'camera'] },
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex (#e23d3d) or name (red, blue, …)' },
          width: { type: 'number' },
          height: { type: 'number' },
          depth: { type: 'number' },
          position: vec3,
          rotation: vec3,
          parent: { type: 'string', description: 'Optional folder or part id to parent under.' },
        },
        required: ['shape'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_grid',
      description: 'Insert a grid of identical parts (e.g. a tiled floor). Caps at 100 cells.',
      parameters: {
        type: 'object',
        properties: {
          shape: { type: 'string', enum: ['block', 'sphere', 'cylinder', 'wedge', 'corner'] },
          color: { type: 'string' },
          namePrefix: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          depth: { type: 'number' },
          countX: { type: 'number' },
          countZ: { type: 'number' },
          gap: { type: 'number', description: 'Extra spacing between cells (default 0).' },
          origin: vec3,
          parent: { type: 'string' },
        },
        required: ['shape', 'countX', 'countZ'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transform_parts',
      description: 'Set or offset position/rotation/size on parts. Use relativeTo to place beside/on another part.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          position: vec3,
          rotation: vec3,
          offset: vec3,
          width: { type: 'number' },
          height: { type: 'number' },
          depth: { type: 'number' },
          relativeTo: { type: 'string', description: 'Anchor part id for placement.' },
          place: {
            type: 'string',
            enum: ['at', 'on-top', 'beside-x', 'beside-z'],
            description: 'How to place relative to relativeTo (default on-top).',
          },
        },
        required: ['ids'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'duplicate_parts',
      description: 'Duplicate parts (and optional children scripts parented under them) with a position offset.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          offset: vec3,
        },
        required: ['ids'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_part',
      description: 'Rename a part, camera, or script.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Create an Explorer folder.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          parent: { type: 'string', description: 'Optional parent folder id.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_parent',
      description: 'Parent parts under a folder or part by id. parent must be an id (part-8 / folder-1) or empty to unparent — never a display name.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          parent: { type: 'string', description: 'Folder/part id, or empty string to unparent.' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_folders',
      description: 'List Explorer folders and part placement parents.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_parts',
      description: 'Patch color, size, emissive, physics, or camera fields.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          color: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          depth: { type: 'number' },
          emissive: { type: 'boolean' },
          emissiveIntensity: { type: 'number' },
          physics: { type: 'object' },
          camera: { type: 'object' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_parts',
      description: 'Delete parts by id. Only when the user clearly asks to delete.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['ids'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_script',
      description: 'Create a Script. parent MUST be a part id from find_by_name/list_scene (e.g. part-8), never a display name. Prefer passing full Lua source here.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          parent: { type: 'string', description: 'Parent part id like part-8 (required when attaching under an object).' },
          source: { type: 'string', description: 'Initial Lua source.' },
          enabled: { type: 'boolean' },
          open: { type: 'boolean', description: 'Open Script Editor after create.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_script',
      description: 'Set Lua source and/or enabled on an existing Script.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          enabled: { type: 'boolean' },
          open: { type: 'boolean' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_script',
      description: 'Read a Script\'s source and enabled flag.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_script_editor',
      description: 'Open the Script Editor for a Script id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'frame_selection',
      description: 'Frame the camera on selection or specific ids. Pass home=true to reset the edit camera.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          home: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo_redo',
      description: 'Undo or redo the last project edit.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['undo', 'redo'] },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_live_ready',
      description: 'Report whether Live Mode can run usefully (Camera present, enabled Scripts with source, etc.).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_snap',
      description: 'Configure move/rotate snap for Edit Mode.',
      parameters: {
        type: 'object',
        properties: {
          move: { type: 'boolean' },
          rotate: { type: 'boolean' },
          moveStuds: { type: 'number' },
          rotateDegrees: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_fullbright',
      description: 'Toggle fullbright lighting in the viewport.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
        required: ['enabled'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'project_file',
      description: 'Project file command: save, save-as, open, new, export. new/open require confirm=true after user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['save', 'save-as', 'open', 'new', 'export'] },
          confirm: { type: 'boolean' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_tool',
      description: 'Switch the active editor tool.',
      parameters: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            enum: ['select', 'move', 'rotate', 'scale', 'pencil', 'line', 'rectangle', 'circle', 'pushpull', 'erase'],
          },
        },
        required: ['tool'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_mode',
      description: 'Enter Live Mode (play) or return to Edit Mode (stop). Prefer check_live_ready first when starting Live.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['edit', 'live'] },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
  },
];

const TOOL_LABELS = {
  list_scene: 'Listing scene',
  describe_selection: 'Reading selection',
  find_by_name: 'Finding by name',
  get_scripting_guide: 'Reading script guide',
  lint_script: 'Linting script',
  audit_scripts: 'Auditing scripts',
  probe_live_scripts: 'Probing Live scripts',
  cleanup_scripts: 'Cleaning scripts',
  select_parts: 'Selecting',
  insert_part: 'Inserting',
  insert_grid: 'Building grid',
  transform_parts: 'Transforming',
  duplicate_parts: 'Duplicating',
  rename_part: 'Renaming',
  create_folder: 'Creating folder',
  set_parent: 'Reparenting',
  list_folders: 'Listing folders',
  patch_parts: 'Updating parts',
  delete_parts: 'Deleting',
  create_script: 'Creating script',
  write_script: 'Writing script',
  read_script: 'Reading script',
  open_script_editor: 'Opening script',
  frame_selection: 'Framing camera',
  undo_redo: 'History',
  check_live_ready: 'Checking Live Mode',
  set_snap: 'Setting snap',
  set_fullbright: 'Toggling fullbright',
  project_file: 'Project file',
  set_tool: 'Switching tool',
  set_mode: 'Switching mode',
};

function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

const NAMED_COLORS = {
  red: '#e23d3d',
  green: '#3caf4c',
  blue: '#3a7ae6',
  yellow: '#e2b93d',
  orange: '#e67a3a',
  purple: '#8b5cf6',
  pink: '#ec4899',
  white: '#f5f5f5',
  black: '#1a1a1a',
  gray: '#9ca3af',
  grey: '#9ca3af',
  cyan: '#22d3ee',
  teal: '#14b8a6',
};

function normalizeColor(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return NAMED_COLORS[raw.toLowerCase()] || '';
}

function waitOnce(bus, event, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(null);
    }, timeoutMs);
    const off = bus.on(event, (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(data);
    });
  });
}

export default {
  mount(root, api) {
    const frame = frameWindow(root, api, {
      id: 'assistant',
      title: 'Assistant',
      icon: ICON,
      width: 400,
      height: 560,
      left: Math.max(24, (window.innerWidth || 1200) - 440),
      top: 72,
      minWidth: 320,
      minHeight: 360,
    });

    const runtime = createAssistantRuntime(api);
    let sceneObjects = [];
    let selectionIds = [];
    let history = [];
    let busy = false;
    let abortCtrl = null;
    let status = { status: 'offline', detail: '' };

    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;user-select:text;-webkit-user-select:text;';

    const statusBar = document.createElement('div');
    statusBar.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:8px 12px',
      'border-bottom:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'font:12px/1.2 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'color:var(--gw-muted, #aeb4bb)',
      'flex:0 0 auto',
      'user-select:text',
    ].join(';');
    const statusDot = document.createElement('span');
    statusDot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#6b7280;flex:0 0 auto;';
    const statusText = document.createElement('span');
    statusText.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    statusBar.append(statusDot, statusText);

    const list = document.createElement('div');
    list.tabIndex = 0;
    list.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;user-select:text;-webkit-user-select:text;outline:none;';

    const composer = document.createElement('div');
    composer.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--gw-line, rgba(255,255,255,.08));flex:0 0 auto;';
    const input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = 'Ask Assistant to build or explain…';
    input.spellcheck = true;
    input.style.cssText = [
      'width:100%',
      'box-sizing:border-box',
      'resize:none',
      'min-height:54px',
      'max-height:120px',
      'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
      'border-radius:8px',
      'background:var(--gw-well, #16181c)',
      'color:var(--gw-text, #e8eaed)',
      'font:13px/1.35 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
      'padding:10px 12px',
      'user-select:text',
    ].join(';');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Stop';
    stopBtn.hidden = true;
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    const btnStyle = [
      'appearance:none',
      'border:0',
      'margin:0',
      'height:30px',
      'padding:0 14px',
      'border-radius:6px',
      'background:var(--gw-press)',
      'color:inherit',
      'font:inherit',
      'cursor:default',
    ].join(';');
    stopBtn.style.cssText = `${btnStyle};background:rgba(226,59,47,.22)`;
    sendBtn.style.cssText = btnStyle;
    row.append(stopBtn, sendBtn);
    composer.append(input, row);
    wrap.append(statusBar, list, composer);
    frame.body.append(wrap);

    let stickBottom = true;
    const paintStatus = () => {
      const map = {
        offline: '#6b7280',
        starting: '#eab308',
        downloading: '#3b82f6',
        ready: '#22c55e',
      };
      statusDot.style.background = map[status.status] || map.offline;
      const label = status.status === 'ready' ? `Ready · ${ASSISTANT_MODEL}`
        : status.status === 'downloading' ? (status.detail || 'Downloading model…')
          : status.status === 'starting' ? (status.detail || 'Starting local AI…')
            : (status.detail || 'Offline');
      statusText.textContent = label;
      const canSend = status.status === 'ready' && !busy;
      sendBtn.disabled = !canSend;
      input.disabled = status.status !== 'ready' && status.status !== 'starting' && status.status !== 'downloading';
      sendBtn.style.opacity = canSend ? '1' : '0.45';
      stopBtn.hidden = !busy;
    };

    const bubble = (role, text, opts = {}) => {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `display:flex;flex-direction:column;gap:4px;align-items:${role === 'user' ? 'flex-end' : 'flex-start'};`;
      if (opts.tool) {
        const chip = document.createElement('div');
        chip.textContent = text;
        chip.style.cssText = [
          'font:12px/1.3 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif)',
          'color:var(--gw-muted, #aeb4bb)',
          'background:rgba(255,255,255,.04)',
          'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
          'border-radius:999px',
          'padding:4px 10px',
        ].join(';');
        rowEl.append(chip);
        return rowEl;
      }
      if (role === 'assistant') {
        const mark = document.createElement('div');
        mark.textContent = 'Assistant';
        mark.style.cssText = 'font:11px/1 var(--gw-font);color:#5b9dff;font-weight:600;padding:0 4px;';
        rowEl.append(mark);
      }
      const body = document.createElement('div');
      body.dataset.bubble = role;
      body.textContent = text || '';
      body.style.cssText = [
        'max-width:92%',
        'white-space:pre-wrap',
        'word-break:break-word',
        'line-height:1.4',
        'padding:8px 11px',
        'border-radius:10px',
        'user-select:text',
        '-webkit-user-select:text',
        'cursor:text',
        role === 'user'
          ? 'background:rgba(91,157,255,.18);color:var(--gw-text, #e8eaed);border-bottom-right-radius:4px'
          : 'background:rgba(255,255,255,.05);color:var(--gw-text, #e8eaed);border:1px solid var(--gw-line, rgba(255,255,255,.08));border-bottom-left-radius:4px',
      ].join(';');
      if (opts.streaming) {
        const caret = document.createElement('span');
        caret.textContent = '▍';
        caret.style.cssText = 'display:inline-block;margin-left:2px;animation:gw-blink 1s step-end infinite;opacity:.7;';
        body.append(caret);
      }
      rowEl.append(body);
      rowEl._body = body;
      return rowEl;
    };

    const paintEmpty = () => {
      list.replaceChildren();
      const intro = document.createElement('div');
      intro.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:8px 4px;';
      const title = document.createElement('div');
      title.textContent = 'What do you want to make?';
      title.style.cssText = 'font:600 15px/1.3 var(--gw-font);color:var(--gw-text, #e8eaed);';
      const blurb = document.createElement('div');
      blurb.textContent = 'I can build scenes, write Scripts, organize folders, and get Live Mode ready — all on a local model.';
      blurb.style.cssText = 'color:var(--gw-muted, #aeb4bb);line-height:1.4;';
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;';
      for (const tip of SUGGESTIONS) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = tip;
        chip.style.cssText = [
          'appearance:none',
          'border:1px solid var(--gw-line, rgba(255,255,255,.08))',
          'background:rgba(255,255,255,.03)',
          'color:var(--gw-text, #e8eaed)',
          'border-radius:999px',
          'padding:7px 12px',
          'font:12px/1.2 var(--gw-font)',
          'cursor:default',
          'text-align:left',
        ].join(';');
        chip.addEventListener('mouseenter', () => { chip.style.background = 'var(--gw-hover)'; });
        chip.addEventListener('mouseleave', () => { chip.style.background = 'rgba(255,255,255,.03)'; });
        chip.addEventListener('click', () => {
          input.value = tip;
          sendMessage();
        });
        chips.append(chip);
      }
      intro.append(title, blurb, chips);
      list.append(intro);
    };

    const paintHistory = () => {
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      list.replaceChildren();
      if (!history.length) {
        paintEmpty();
        return;
      }
      const frag = document.createDocumentFragment();
      for (const item of history) {
        if (item.role === 'tool') continue; // API transcript only — chips use tool-ui
        frag.append(bubble(item.role, item.content, { tool: item.role === 'tool-ui', streaming: item.streaming }));
      }
      list.append(frag);
      if (stickBottom || nearBottom) list.scrollTop = list.scrollHeight;
    };

    const describeMany = async (ids) => {
      if (!ids.length) return [];
      const pending = waitOnce(api.bus, 'project:described-many', 3000);
      api.bus.emit('project:describe-many', ids);
      return (await pending) || [];
    };

    const foldersState = async () => {
      const pending = waitOnce(api.bus, 'project:folders-state', 2000);
      api.bus.emit('project:folders-request');
      return (await pending) || { folders: [], placement: {}, nextFolder: 1 };
    };

    const partId = (part) => part?.kind || part?.id || null;

    const SCRIPTING_GUIDE = `GameWindow Live Mode Lua — READ THIS BEFORE WRITING MOVEMENT SCRIPTS

Services (both forms work):
- local Players = game:GetService("Players")  — also game.Players
- local RunService = game:GetService("RunService") — also game.RunService
- local UIS = game:GetService("UserInputService") — also game.UserInputService

Character:
- local character = game.Players.LocalPlayer.Character
- if not character then return end
- Character is the playable Part (host of the play Camera).
- NO Humanoid. NO Humanoid:Move / :Jump / WaitForChild("Humanoid") — those hang or error.

Look / camera:
- Live Mode already handles right-mouse look and turns the character (Camera.turnParent).
- DO NOT set workspace.CurrentCamera.CFrame.
- DO NOT use InputChanged, GetMouseLocation, MouseMovement, MouseButton1Down, Vector2.
- Camera-relative WASD MUST use workspace.CurrentCamera.CFrame.LookVector / RightVector (read every Heartbeat).
- Flatten on the ground: forward = Vector3.new(look.X, 0, look.Z); if forward:Magnitude() > 0 then forward = forward:Unit() end (same for right).
- Do NOT build move direction from character.Orientation / yaw math — that is not camera-relative.

Input (only these):
- UserInputService:IsKeyDown(Enum.KeyCode.W) — KeyCodes: W A S D Space (values KeyW/KeyA/…/Space)
- UserInputService.InputBegan / InputEnded — input.KeyCode.Name is KeyW or Space

Motion each frame:
- local RunService = game:GetService("RunService"); RunService.Heartbeat:Connect(function(dt) … end)
- Vector3 methods use colon: moveDir:Magnitude(), moveDir:Unit() (dot calls are wrong)
- character.Anchored = false before using velocity/impulse
- Prefer AssemblyLinearVelocity for walk; keep existing Y when setting XZ
- Camera-relative WASD (use ifs, not boolean arithmetic):
  local cam = workspace.CurrentCamera
  local look = cam.CFrame.LookVector
  local right = cam.CFrame.RightVector
  local forward = Vector3.new(look.X, 0, look.Z)
  right = Vector3.new(right.X, 0, right.Z)
  if forward:Magnitude() > 0 then forward = forward:Unit() end
  if right:Magnitude() > 0 then right = right:Unit() end
  local moveDir = Vector3.new(0,0,0)
  if UIS:IsKeyDown(Enum.KeyCode.W) then moveDir = moveDir + forward end
  if UIS:IsKeyDown(Enum.KeyCode.S) then moveDir = moveDir - forward end
  if UIS:IsKeyDown(Enum.KeyCode.A) then moveDir = moveDir - right end
  if UIS:IsKeyDown(Enum.KeyCode.D) then moveDir = moveDir + right end
  if moveDir:Magnitude() > 0 then moveDir = moveDir:Unit() end
  Always set XZ velocity even when moveDir is 0 (so you stop): local v = character.AssemblyLinearVelocity; character.AssemblyLinearVelocity = Vector3.new(moveDir.X * speed, v.Y, moveDir.Z * speed)
- Jump ONCE on InputBegan when input.KeyCode.Name == "Space". Never compare KeyCode == Enum.KeyCode.Space.
- Grounded jump ONLY: if character:IsGrounded() then ApplyImpulse(...). Never use character.Position.Y as a grounded check (that allows infinite air jumps).
- Walk: NEVER * dt on velocity. ALWAYS keep v.Y.
- ApplyImpulse jumpForce ~40–80.

Parts API: Position, Orientation (degrees), CFrame, Size, Color, Anchored, CanCollide, AssemblyLinearVelocity, ApplyImpulse

Workflow: get_scripting_guide → find Player id → delete ALL old movement/Script clones under it → ensure Camera parented under Player → create_script(parent=id, source=…) → lint_script → write_script until lint is clean → read_script to confirm.

Banned (lint will fail): Humanoid, InputChanged, GetMouseLocation, MouseMovement, MouseButton1, Vector2, camera.CFrame =, CurrentCamera.CFrame =, KeyCode == Enum, velocity * dt`;

    const lintLuaSource = (source) => {
      const src = String(source || '');
      const issues = [];
      if (!src.trim()) {
        issues.push('Source is empty.');
        return { ok: false, issues };
      }
      const bans = [
        [/Humanoid/i, 'Humanoid is not supported — use the Character Part directly.'],
        [/InputChanged/i, 'InputChanged is not supported — use IsKeyDown / InputBegan / InputEnded only.'],
        [/GetMouseLocation/i, 'GetMouseLocation is not supported — Live Mode already handles mouse look.'],
        [/MouseMovement/i, 'MouseMovement is not supported — do not implement mouse look in Scripts.'],
        [/MouseButton1/i, 'MouseButton APIs are not supported for look — right-mouse look is built-in.'],
        [/Vector2/i, 'Vector2 is not available — use Vector3 only.'],
        [/CurrentCamera\s*\.\s*CFrame\s*=/i, 'Do not set CurrentCamera.CFrame — the engine owns Live look.'],
        [/camera\s*\.\s*CFrame\s*=/i, 'Do not set camera.CFrame — the engine owns Live look.'],
        [/:Jump\s*\(/i, 'Humanoid:Jump is not supported — use ApplyImpulse or AssemblyLinearVelocity.'],
        [/:Move\s*\(/i, 'Humanoid:Move is not supported — set AssemblyLinearVelocity or Position.'],
      ];
      for (const [re, msg] of bans) {
        if (re.test(src)) issues.push(msg);
      }
      if (!/IsKeyDown/i.test(src) && !/InputBegan/i.test(src)) {
        issues.push('Expected UserInputService IsKeyDown and/or InputBegan for controls.');
      }
      if (!/Heartbeat/i.test(src)) {
        issues.push('Expected RunService.Heartbeat for per-frame movement.');
      }
      if (!/Anchored\s*=\s*false/i.test(src) && /AssemblyLinearVelocity|ApplyImpulse/i.test(src)) {
        issues.push('Set character.Anchored = false before using velocity/impulse.');
      }
      if (/IsKeyDown\s*\(\s*Enum\.KeyCode\.Space[\s\S]{0,120}Heartbeat/i.test(src)
        || (/KeyCode\.Space/i.test(src) && /Heartbeat[\s\S]*IsKeyDown\([\s\S]*Space/i.test(src))) {
        // Soft warning style — only if Space polled inside patterns that look continuous; keep as issue when Space+IsKeyDown appears with Position Y bump every frame heuristically.
      }
      if (/IsKeyDown\s*\(\s*Enum\.KeyCode\.Space\s*\)[\s\S]{0,200}Position/i.test(src)) {
        issues.push('Do not hold-IsKeyDown Space to add Position every frame (that flies). Jump once on InputBegan.');
      }
      if (/KeyCode\s*==\s*Enum\.KeyCode/i.test(src) || /Enum\.KeyCode[^\n]*==\s*input\.KeyCode/i.test(src)) {
        issues.push('Compare input.KeyCode.Name to "Space"/"KeyW" (or Enum.KeyCode.Space). KeyCode == Enum.KeyCode.Space never succeeds.');
      }
      if (/AssemblyLinearVelocity\s*=\s*[^\n]*\*\s*dt/i.test(src) || /AssemblyLinearVelocity\s*=\s*[^\n]*dt\s*\*/i.test(src)) {
        issues.push('Do not multiply AssemblyLinearVelocity by dt — velocity is already studs/sec. Preserve Y: Vector3.new(vx, v.Y, vz).');
      }
      if (/AssemblyLinearVelocity\s*=/.test(src)) {
        const assign = src.match(/AssemblyLinearVelocity\s*=\s*([^\n]+)/);
        const rhs = assign?.[1] || '';
        if (rhs && !/\.Y|v\.Y|currentY|vel\.Y/i.test(rhs) && !/Vector3\.new\([^)]*\.Y/.test(src.slice(src.indexOf('AssemblyLinearVelocity')))) {
          // Allow if a Vector3.new(vx, v.Y, vz) form appears on the same or next lines
          const window = src.slice(Math.max(0, src.search(/AssemblyLinearVelocity\s*=/) - 80), src.search(/AssemblyLinearVelocity\s*=/) + 180);
          if (!/Vector3\.new\([^;]*\.Y/.test(window)) {
            issues.push('Preserve vertical velocity when walking: local v = character.AssemblyLinearVelocity; character.AssemblyLinearVelocity = Vector3.new(vx, v.Y, vz).');
          }
        }
      }
      if (/IsKeyDown\s*\([^)]*\)\s*and\s*[-\w.]+/.test(src) && /\+\s*\(/.test(src)) {
        issues.push('Do not add IsKeyDown results with and/or arithmetic (false+number errors in Lua). Use if IsKeyDown then moveDir = moveDir + forward end.');
      }
      if (/RunService\.Heartbeat/.test(src) && !/GetService\(\s*["']RunService["']\s*\)/.test(src)) {
        issues.push('Use game:GetService("RunService").Heartbeat — bare RunService is nil.');
      }
      if (/\.Magnitude\s*\(/.test(src) || /\.Unit\s*\(/.test(src)) {
        issues.push('Call Vector3 methods with a colon: moveDir:Magnitude() / moveDir:Unit(), not with a dot.');
      }
      if (/Heartbeat[\s\S]*IsKeyDown\s*\(\s*Enum\.KeyCode\.Space[\s\S]*ApplyImpulse|function\s+update[\s\S]*IsKeyDown\s*\(\s*Enum\.KeyCode\.Space[\s\S]*ApplyImpulse/i.test(src)) {
        issues.push('Do not ApplyImpulse every Heartbeat while Space IsKeyDown (that flies). Use InputBegan and KeyCode.Name == "Space" once.');
      }
      if (!/InputBegan/i.test(src) && /ApplyImpulse/i.test(src)) {
        issues.push('Hook jump with UserInputService.InputBegan, not only Heartbeat polling.');
      }
      if (/Position\s*\.\s*Y\s*[<>]=?\s*/.test(src) && /ground|Jump|Space|ApplyImpulse/i.test(src)) {
        issues.push('Do not use character.Position.Y as grounded — that allows air jumps. Use character:IsGrounded() before ApplyImpulse.');
      }
      if (/grounded\s*=\s*character\.Position|grounded\s*=\s*.*Position\.Y/i.test(src)) {
        issues.push('grounded = Position.Y… is invalid. Use character:IsGrounded() when handling Space.');
      }
      if (/Orientation\.Y|math\.rad\(\s*character\.Orientation/i.test(src) && /IsKeyDown/i.test(src)) {
        issues.push('Do not derive WASD from character.Orientation — use workspace.CurrentCamera.CFrame.LookVector/RightVector flattened on Y.');
      }
      if (/IsKeyDown/i.test(src) && /AssemblyLinearVelocity/i.test(src) && !/CurrentCamera/i.test(src)) {
        issues.push('Camera-relative movement required: read workspace.CurrentCamera.CFrame.LookVector and RightVector each Heartbeat.');
      }
      if (/ApplyImpulse/i.test(src) && /InputBegan/i.test(src) && !/IsGrounded/i.test(src)) {
        issues.push('Only jump when character:IsGrounded() is true (prevents repeated air jumps).');
      }
      return { ok: issues.length === 0, issues };
    };

    const looksLikeId = (value) => {
      if (typeof value !== 'string' || !value.trim()) return false;
      const v = value.trim();
      if (v === 'baseplate') return true;
      return /^(part|folder)-\d+$/i.test(v);
    };

    const rejectBadParent = (parent) => {
      if (parent == null || parent === '' || parent === 'null') return null;
      if (looksLikeId(parent)) return null;
      return {
        error: `parent must be an id like "part-8" from find_by_name/list_scene, not the display name "${parent}". Call find_by_name first and use match.id.`,
      };
    };

    const buildInsertSpec = (a, shapeOverride) => {
      const shape = shapeOverride || a.shape || 'block';
      const color = normalizeColor(a.color);
      const defaults = {
        block: [4, 1, 4], sphere: [4, 4, 4], cylinder: [4, 4, 4],
        wedge: [4, 2, 4], corner: [4, 2, 4], camera: [2, 1.5, 3], script: [1, 1, 1],
      };
      const [dw, dh, dd] = defaults[shape] || defaults.block;
      const width = Number.isFinite(a.width) ? a.width : dw;
      const height = Number.isFinite(a.height) ? a.height : dh;
      const depth = Number.isFinite(a.depth) ? a.depth : dd;
      const position = Array.isArray(a.position) && a.position.length >= 3
        ? a.position.slice(0, 3).map(Number)
        : [0, height / 2, 0];
      if (shape === 'camera' && position[1] < 5) position[1] = 5;
      const rotation = Array.isArray(a.rotation) && a.rotation.length >= 3
        ? a.rotation.slice(0, 3).map(Number)
        : [0, 0, 0];
      const spec = {
        shape,
        name: a.name,
        color: color || (shape === 'camera' ? '#5b9dff' : shape === 'script' ? '#fcfcfc' : undefined),
        width,
        height,
        depth,
        position,
        rotation,
      };
      if (a.parent) spec.folder = a.parent;
      if (shape === 'camera') {
        spec.camera = { fieldOfView: 70, mode: 'firstPerson', turnParent: true };
      }
      if (shape === 'script') {
        spec.script = {
          enabled: a.enabled !== false,
          source: typeof a.source === 'string' ? a.source : '',
        };
      }
      return spec;
    };

    const insertOne = async (spec) => {
      const pending = waitOnce(api.bus, 'project:inserted', 3000);
      api.bus.emit('project:insert', spec);
      return await pending;
    };

    /** Remove sibling scripts under the same parent + orphans with invalid parents. */
    const cleanupConflictingScripts = async ({ keep = null, parent = null } = {}) => {
      api.bus.emit('scene:request');
      await new Promise((r) => setTimeout(r, 40));
      const state = await foldersState();
      const placement = { ...(state.placement || {}) };
      const keepId = keep || null;
      let parentId = parent || (keepId ? placement[keepId] : null) || null;
      if (parentId && !looksLikeId(parentId)) parentId = null;

      const scriptIds = sceneObjects
        .filter((o) => o.shape === 'script' && o.id)
        .map((o) => o.id);
      const described = scriptIds.length ? await describeMany(scriptIds) : [];
      const byId = new Map(described.map((p) => [partId(p), p]));

      const toDelete = [];
      for (const id of scriptIds) {
        if (keepId && id === keepId) continue;
        const p = placement[id] || byId.get(id)?.parent || null;
        const source = byId.get(id)?.script?.source || '';
        const name = byId.get(id)?.name || '';
        const movementLike = /IsKeyDown|AssemblyLinearVelocity|ApplyImpulse|Heartbeat|Humanoid/i.test(source)
          || /move|walk|jump|wasd|player/i.test(String(name));
        const invalidParent = p && !looksLikeId(p);
        const sameParent = parentId && p === parentId;
        const lint = lintLuaSource(source);
        if (sameParent || invalidParent || (movementLike && !lint.ok && !p)) {
          toDelete.push(id);
        }
      }
      // If we have a kept script under a parent, always clear other scripts on that parent.
      if (keepId && parentId) {
        for (const id of scriptIds) {
          if (id === keepId) continue;
          if (placement[id] === parentId && !toDelete.includes(id)) toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        api.bus.emit('project:delete', id);
        delete placement[id];
      }
      if (toDelete.length) {
        api.bus.emit('project:folders', {
          folders: state.folders || [],
          placement,
          nextFolder: state.nextFolder || 1,
        });
        api.bus.emit('scene:request');
        await new Promise((r) => setTimeout(r, 40));
      }
      return { deleted: toDelete, kept: keepId, parent: parentId };
    };

    const runTool = async (name, args) => {
      const a = args || {};
      switch (name) {
        case 'list_scene': {
          api.bus.emit('scene:request');
          await new Promise((r) => setTimeout(r, 40));
          const state = await foldersState();
          const placement = state.placement || {};
          return {
            objects: sceneObjects.map((o) => ({
              ...o,
              parent: placement[o.id] || null,
            })),
          };
        }
        case 'audit_scripts': {
          api.bus.emit('scene:request');
          await new Promise((r) => setTimeout(r, 40));
          const state = await foldersState();
          const placement = state.placement || {};
          const parentFilter = typeof a.parent === 'string' && a.parent ? a.parent : null;
          if (parentFilter) {
            const bad = rejectBadParent(parentFilter);
            if (bad) return bad;
          }
          const scriptObjs = sceneObjects.filter((o) => o.shape === 'script');
          const ids = scriptObjs.map((o) => o.id).filter(Boolean);
          const described = ids.length ? await describeMany(ids) : [];
          const byId = new Map(described.map((p) => [partId(p), p]));
          const reports = [];
          for (const obj of scriptObjs) {
            const parent = placement[obj.id] || byId.get(obj.id)?.parent || null;
            if (parentFilter && parent !== parentFilter) continue;
            const part = byId.get(obj.id);
            const source = part?.script?.source || '';
            const lint = lintLuaSource(source);
            const movementLike = /IsKeyDown|AssemblyLinearVelocity|ApplyImpulse|Heartbeat/i.test(source)
              || /move|walk|jump|wasd/i.test(String(obj.name || ''));
            reports.push({
              id: obj.id,
              name: obj.name || part?.name || 'Script',
              parent,
              enabled: part?.script?.enabled !== false,
              sourceLength: source.length,
              movementLike,
              lint,
            });
          }
          const conflicts = reports.filter((r) => r.movementLike || !r.lint.ok);
          return {
            scripts: reports,
            count: reports.length,
            movementOrBroken: conflicts.map((r) => r.id),
            hint: parentFilter
              ? `Under ${parentFilter}: keep one lint-clean movement script; delete_parts the other conflicting ids.`
              : 'Filter with parent=<part id> (e.g. Player id) when fixing conflicts under one object.',
          };
        }
        case 'probe_live_scripts': {
          const holdMs = Math.max(400, Math.min(3000, Number(a.holdMs) || 900));
          const key = typeof a.key === 'string' && a.key.trim() ? a.key.trim() : '';
          const logs = [];
          const pushLog = (level, text) => {
            const line = String(text || '');
            if (/\[script|script-runtime|Humanoid|Players|WaitForChild|attempt to/i.test(line)) {
              logs.push({ level, text: line.slice(0, 300) });
            }
          };
          const origLog = console.log;
          const origWarn = console.warn;
          const origErr = console.error;
          console.log = (...args) => { pushLog('log', args.join(' ')); return origLog.apply(console, args); };
          console.warn = (...args) => { pushLog('warn', args.join(' ')); return origWarn.apply(console, args); };
          console.error = (...args) => { pushLog('error', args.join(' ')); return origErr.apply(console, args); };
          let before = null;
          let after = null;
          let characterId = null;
          try {
            api.bus.emit('mode:stop');
            await new Promise((r) => setTimeout(r, 200));
            api.bus.emit('mode:play');
            await new Promise((r) => setTimeout(r, 500));
            const world = window.__gwScriptApi;
            characterId = world?.getCharacterId?.() || null;
            before = characterId ? {
              position: world.getRecord?.(characterId)?.position || null,
              velocity: world.getVelocity?.(characterId) || null,
            } : null;
            if (key) {
              const down = new KeyboardEvent('keydown', { code: key, key: key.replace(/^Key/, '').toLowerCase(), bubbles: true });
              window.dispatchEvent(down);
              document.querySelector('[data-module=viewport]')?.focus?.({ preventScroll: true });
            }
            await new Promise((r) => setTimeout(r, holdMs));
            after = characterId ? {
              position: world?.getRecord?.(characterId)?.position || null,
              velocity: world?.getVelocity?.(characterId) || null,
              keyDown: key ? !!world?.isKeyDown?.(key) : null,
            } : null;
            if (key) {
              window.dispatchEvent(new KeyboardEvent('keyup', { code: key, key: key.replace(/^Key/, '').toLowerCase(), bubbles: true }));
            }
          } finally {
            console.log = origLog;
            console.warn = origWarn;
            console.error = origErr;
            api.bus.emit('mode:stop');
          }
          const moved = !!(before?.position && after?.position && (
            Math.abs((after.position.x || 0) - (before.position.x || 0)) > 0.05
            || Math.abs((after.position.z || 0) - (before.position.z || 0)) > 0.05
            || Math.abs(after.velocity?.x || 0) > 0.5
            || Math.abs(after.velocity?.z || 0) > 0.5
          ));
          const errors = logs.filter((l) => /attempt to|Error|failed|Humanoid|nil value/i.test(l.text));
          return {
            characterId,
            key: key || null,
            before,
            after,
            moved,
            scriptLogs: logs.slice(-20),
            scriptErrors: errors.slice(-12),
            ok: errors.length === 0 && (!key || moved),
            hint: errors.length
              ? 'Script errors while live — delete or rewrite the failing Scripts, then probe again.'
              : (key && !moved
                ? 'No movement detected for that key — check IsKeyDown, AssemblyLinearVelocity, Anchored=false, and Character nil guards.'
                : 'Probe looks healthy.'),
          };
        }
        case 'describe_selection': {
          const ids = Array.isArray(a.ids) && a.ids.length ? a.ids : selectionIds.slice();
          if (!ids.length) return { selection: [], note: 'Nothing selected.' };
          return { parts: await describeMany(ids) };
        }
        case 'get_scripting_guide': {
          return { guide: SCRIPTING_GUIDE };
        }
        case 'lint_script': {
          let source = typeof a.source === 'string' ? a.source : '';
          let id = a.id || null;
          if (!source && id) {
            const parts = await describeMany([id]);
            const part = parts[0];
            if (!part || part.shape !== 'script') return { error: 'Not a script', id };
            source = part.script?.source || '';
          }
          if (!source && !id) return { error: 'id or source required' };
          const lint = lintLuaSource(source);
          return { id, ...lint, sourceLength: source.length };
        }
        case 'find_by_name': {
          const query = String(a.name || '').trim().toLowerCase();
          if (!query) return { error: 'name required' };
          api.bus.emit('scene:request');
          await new Promise((r) => setTimeout(r, 40));
          const matches = sceneObjects.filter((obj) => {
            const n = String(obj?.name || '').toLowerCase();
            return a.exact ? n === query : n.includes(query);
          }).map((obj) => ({ id: obj.id, name: obj.name, shape: obj.shape }));
          const ids = matches.map((m) => m.id).filter(Boolean);
          if (a.select && ids.length) {
            api.bus.emit('scene:select', ids.length === 1 ? ids[0] : ids);
          }
          return {
            matches,
            count: matches.length,
            hint: 'Use matches[].id (e.g. part-8) as parent/ids in other tools — never the name string.',
          };
        }
        case 'select_parts': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          api.bus.emit('scene:select', ids.length === 1 ? ids[0] : (ids.length ? ids : null));
          return { selected: ids };
        }
        case 'insert_part': {
          const shape = a.shape || 'block';
          if (shape === 'controller') {
            return { error: 'Controllers are removed. Use Scripts for movement and gameplay.' };
          }
          if (shape === 'script') {
            return { error: 'Use create_script for Scripts.' };
          }
          const badParent = rejectBadParent(a.parent);
          if (badParent) return badParent;
          const spec = buildInsertSpec(a, shape);
          const id = await insertOne(spec);
          if (!id) return { error: 'Insert failed (edit mode required; check size/position).', shape };
          return { inserted: id, shape, color: spec.color || null, position: spec.position };
        }
        case 'insert_grid': {
          const countX = Math.max(1, Math.min(20, Math.floor(Number(a.countX) || 1)));
          const countZ = Math.max(1, Math.min(20, Math.floor(Number(a.countZ) || 1)));
          if (countX * countZ > 100) return { error: 'Grid capped at 100 parts.' };
          const shape = a.shape || 'block';
          const gap = Number.isFinite(a.gap) ? a.gap : 0;
          const color = normalizeColor(a.color);
          const defaults = { block: [4, 1, 4], sphere: [4, 4, 4], cylinder: [4, 4, 4], wedge: [4, 2, 4], corner: [4, 2, 4] };
          const [dw, dh, dd] = defaults[shape] || defaults.block;
          const width = Number.isFinite(a.width) ? a.width : dw;
          const height = Number.isFinite(a.height) ? a.height : dh;
          const depth = Number.isFinite(a.depth) ? a.depth : dd;
          const origin = Array.isArray(a.origin) && a.origin.length >= 3
            ? a.origin.slice(0, 3).map(Number)
            : [0, height / 2, 0];
          const prefix = typeof a.namePrefix === 'string' && a.namePrefix.trim() ? a.namePrefix.trim() : 'Tile';
          const inserted = [];
          for (let z = 0; z < countZ; z += 1) {
            for (let x = 0; x < countX; x += 1) {
              const spec = {
                shape,
                name: `${prefix} ${x + 1},${z + 1}`,
                color: color || undefined,
                width,
                height,
                depth,
                position: [
                  origin[0] + x * (width + gap),
                  origin[1],
                  origin[2] + z * (depth + gap),
                ],
                rotation: [0, 0, 0],
              };
              if (a.parent) spec.folder = a.parent;
              const id = await insertOne(spec);
              if (id) inserted.push(id);
            }
          }
          return { inserted, count: inserted.length, countX, countZ };
        }
        case 'transform_parts': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          if (!ids.length) return { error: 'ids required' };
          const parts = await describeMany(ids);
          let anchor = null;
          if (a.relativeTo) {
            const list = await describeMany([a.relativeTo]);
            anchor = list[0] || null;
          }
          const changes = [];
          for (const part of parts) {
            const id = partId(part);
            if (!id) continue;
            let position = Array.isArray(part.position) ? part.position.slice(0, 3) : [0, 0, 0];
            let rotation = Array.isArray(part.rotation) ? part.rotation.slice(0, 3) : [0, 0, 0];
            const size = {
              x: Number.isFinite(a.width) ? a.width : part.width,
              y: Number.isFinite(a.height) ? a.height : (part.height ?? part.thickness ?? 1),
              z: Number.isFinite(a.depth) ? a.depth : part.depth,
            };
            if (anchor) {
              const place = a.place || 'on-top';
              const aw = Number(anchor.width) || 4;
              const ah = Number(anchor.height ?? anchor.thickness) || 1;
              const ad = Number(anchor.depth) || 4;
              const ap = Array.isArray(anchor.position) ? anchor.position : [0, 0, 0];
              if (place === 'on-top') {
                position = [ap[0], ap[1] + ah / 2 + size.y / 2, ap[2]];
              } else if (place === 'beside-x') {
                position = [ap[0] + aw / 2 + size.x / 2, ap[1], ap[2]];
              } else if (place === 'beside-z') {
                position = [ap[0], ap[1], ap[2] + ad / 2 + size.z / 2];
              } else if (place === 'at') {
                position = ap.slice(0, 3);
              }
            }
            if (Array.isArray(a.position) && a.position.length >= 3) {
              position = a.position.slice(0, 3).map(Number);
            }
            if (Array.isArray(a.offset) && a.offset.length >= 3) {
              position = [
                position[0] + Number(a.offset[0] || 0),
                position[1] + Number(a.offset[1] || 0),
                position[2] + Number(a.offset[2] || 0),
              ];
            }
            if (Array.isArray(a.rotation) && a.rotation.length >= 3) {
              rotation = a.rotation.slice(0, 3).map(Number);
            }
            changes.push({ kind: id, position, rotation, size });
          }
          if (changes.length) api.bus.emit('project:change', { changes });
          return { transformed: changes.map((c) => c.kind) };
        }
        case 'duplicate_parts': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          if (!ids.length) return { error: 'ids required' };
          const parts = await describeMany(ids);
          const offset = Array.isArray(a.offset) && a.offset.length >= 3
            ? a.offset.slice(0, 3).map(Number)
            : null;
          const created = [];
          for (const part of parts) {
            const id = partId(part);
            if (!id || id === 'baseplate') continue;
            const w = Number(part.width) || 4;
            const shift = offset || [w + 1, 0, 0];
            const pos = Array.isArray(part.position) ? part.position.slice(0, 3) : [0, 0, 0];
            const spec = {
              shape: part.shape === 'solid' ? 'block' : (part.shape || 'block'),
              name: part.name,
              color: part.color,
              width: part.width,
              height: part.height ?? part.thickness ?? 1,
              depth: part.depth,
              position: [pos[0] + shift[0], pos[1] + shift[1], pos[2] + shift[2]],
              rotation: Array.isArray(part.rotation) ? part.rotation.slice(0, 3) : [0, 0, 0],
            };
            if (part.parent) spec.folder = part.parent;
            if (part.shape === 'camera' && part.camera) spec.camera = part.camera;
            if (part.shape === 'script' && part.script) spec.script = part.script;
            if (part.solid) {
              // Solids: fall back to bounding block duplicate.
              spec.shape = 'block';
            }
            const newId = await insertOne(spec);
            if (newId) created.push(newId);
          }
          return { duplicated: created };
        }
        case 'rename_part': {
          const id = a.id;
          const name = typeof a.name === 'string' ? a.name.trim() : '';
          if (!id || !name) return { error: 'id and name required' };
          api.bus.emit('project:rename', { kind: id, name });
          return { renamed: id, name };
        }
        case 'create_folder': {
          const state = await foldersState();
          const folders = Array.isArray(state.folders) ? state.folders.slice() : [];
          let nextFolder = Number.isFinite(state.nextFolder) ? state.nextFolder : 1;
          const id = `folder-${nextFolder}`;
          nextFolder += 1;
          folders.push({
            id,
            name: String(a.name || 'Folder').trim() || 'Folder',
            parent: a.parent || null,
          });
          const payload = {
            folders,
            placement: state.placement && typeof state.placement === 'object' ? { ...state.placement } : {},
            nextFolder,
          };
          api.bus.emit('project:folders', payload);
          return { folder: id, name: a.name };
        }
        case 'set_parent': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          if (!ids.length) return { error: 'ids required' };
          const bad = rejectBadParent(a.parent);
          if (bad && a.parent != null && a.parent !== '' && a.parent !== 'null') return bad;
          const state = await foldersState();
          const placement = state.placement && typeof state.placement === 'object' ? { ...state.placement } : {};
          for (const id of ids) {
            if (a.parent == null || a.parent === '' || a.parent === 'null') delete placement[id];
            else placement[id] = a.parent;
          }
          api.bus.emit('project:folders', {
            folders: Array.isArray(state.folders) ? state.folders : [],
            placement,
            nextFolder: state.nextFolder || 1,
          });
          return { parented: ids, parent: a.parent ?? null };
        }
        case 'list_folders': {
          return await foldersState();
        }
        case 'patch_parts': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          if (!ids.length) return { error: 'ids required' };
          const color = normalizeColor(a.color);
          if (color) api.bus.emit('project:recolor', { kinds: ids, color });
          const patch = { kinds: ids };
          if (typeof a.emissive === 'boolean') patch.emissive = a.emissive;
          if (Number.isFinite(a.emissiveIntensity)) patch.emissiveIntensity = a.emissiveIntensity;
          if (a.physics && typeof a.physics === 'object') patch.physics = a.physics;
          if (a.camera && typeof a.camera === 'object') patch.camera = a.camera;
          api.bus.emit('project:patch', patch);
          if (Number.isFinite(a.width) || Number.isFinite(a.height) || Number.isFinite(a.depth)) {
            const described = await describeMany(ids);
            const changes = [];
            for (const part of described) {
              const id = partId(part);
              if (!id) continue;
              changes.push({
                kind: id,
                position: Array.isArray(part.position) ? part.position.slice(0, 3) : [0, 0, 0],
                rotation: Array.isArray(part.rotation) ? part.rotation.slice(0, 3) : [0, 0, 0],
                size: {
                  x: Number.isFinite(a.width) ? a.width : part.width,
                  y: Number.isFinite(a.height) ? a.height : (part.height ?? part.thickness ?? 1),
                  z: Number.isFinite(a.depth) ? a.depth : part.depth,
                },
              });
            }
            if (changes.length) api.bus.emit('project:change', { changes });
          }
          return { patched: ids };
        }
        case 'delete_parts': {
          const ids = Array.isArray(a.ids) ? a.ids : [];
          for (const id of ids) api.bus.emit('project:delete', id);
          return { deleted: ids };
        }
        case 'create_script': {
          const bad = rejectBadParent(a.parent);
          if (bad) return bad;
          if (a.parent) {
            api.bus.emit('scene:request');
            await new Promise((r) => setTimeout(r, 40));
            const host = sceneObjects.find((o) => o.id === a.parent);
            if (!host) {
              return {
                error: `Unknown parent id "${a.parent}". Call find_by_name or list_scene and use a real id.`,
              };
            }
          }
          const incomingSource = typeof a.source === 'string' ? a.source : '';
          const lint = incomingSource
            ? lintLuaSource(incomingSource)
            : { ok: false, issues: ['No source provided — call write_script with full Lua.'] };
          const spec = buildInsertSpec({
            ...a,
            shape: 'script',
            name: a.name || 'Script',
            width: 1,
            height: 1,
            depth: 1,
            position: [0, 2, 0],
            color: '#fcfcfc',
            // Only persist source when lint-clean; otherwise create empty and force write_script.
            source: lint.ok ? incomingSource : '',
            enabled: a.enabled !== false,
          }, 'script');
          const id = await insertOne(spec);
          if (!id) return { error: 'Script insert failed (edit mode required).' };
          // Confirm placement when parent was requested.
          let parent = a.parent || null;
          if (parent) {
            const state = await foldersState();
            const actual = state.placement?.[id] || null;
            if (actual !== parent) {
              const placement = { ...(state.placement || {}), [id]: parent };
              api.bus.emit('project:folders', {
                folders: state.folders || [],
                placement,
                nextFolder: state.nextFolder || 1,
              });
            }
          }
          if (a.open) api.bus.emit('script-editor:open', { id });
          const verify = await foldersState();
          let cleaned = { deleted: [] };
          if (lint.ok) {
            cleaned = await cleanupConflictingScripts({ keep: id, parent: verify.placement?.[id] || parent });
          }
          return {
            inserted: id,
            shape: 'script',
            parent: verify.placement?.[id] || parent,
            sourceLength: lint.ok ? incomingSource.length : 0,
            lint,
            cleaned,
            hint: lint.ok
              ? `Lint clean. Auto-removed ${cleaned.deleted.length} conflicting/orphan script(s).`
              : 'Source rejected by lint (script created empty). Call write_script with fixed Lua per lint.issues. Do not claim success yet.',
          };
        }
        case 'write_script': {
          const id = a.id;
          if (!id) return { error: 'id required' };
          const script = {};
          if (typeof a.source === 'string') script.source = a.source;
          if (typeof a.enabled === 'boolean') script.enabled = a.enabled;
          if (!Object.keys(script).length) return { error: 'source or enabled required' };
          let lint = null;
          if (typeof script.source === 'string') {
            lint = lintLuaSource(script.source);
            if (!lint.ok) {
              return {
                written: false,
                id,
                lint,
                error: 'Refusing to save incompatible Lua. Fix lint.issues and call write_script again.',
              };
            }
          }
          api.bus.emit('project:patch', { kinds: [id], script });
          if (a.open) api.bus.emit('script-editor:open', { id });
          const cleaned = (lint && lint.ok !== false)
            ? await cleanupConflictingScripts({ keep: id })
            : { deleted: [] };
          return {
            written: id,
            enabled: script.enabled,
            sourceLength: typeof script.source === 'string' ? script.source.length : undefined,
            lint: lint || { ok: true, issues: [] },
            cleaned,
          };
        }
        case 'cleanup_scripts': {
          const keep = a.keep || null;
          const parent = a.parent || null;
          if (parent) {
            const bad = rejectBadParent(parent);
            if (bad) return bad;
          }
          if (!keep && !parent) {
            return { error: 'Pass keep=<script id> and/or parent=<part id>.' };
          }
          return await cleanupConflictingScripts({ keep, parent });
        }
        case 'read_script': {
          const id = a.id;
          if (!id) return { error: 'id required' };
          const parts = await describeMany([id]);
          const part = parts[0];
          if (!part || part.shape !== 'script') return { error: 'Not a script', id };
          return {
            id,
            name: part.name,
            parent: part.parent,
            enabled: part.script?.enabled !== false,
            source: part.script?.source || '',
          };
        }
        case 'open_script_editor': {
          const id = a.id;
          if (!id) return { error: 'id required' };
          api.bus.emit('script-editor:open', { id });
          return { opened: id };
        }
        case 'frame_selection': {
          if (a.home) {
            api.bus.emit('camera:home');
            return { framed: 'home' };
          }
          const ids = Array.isArray(a.ids) && a.ids.length ? a.ids : selectionIds.slice();
          if (!ids.length) {
            api.bus.emit('camera:home');
            return { framed: 'home', note: 'Nothing selected; reset camera.' };
          }
          api.bus.emit('camera:frame', ids.length === 1 ? ids[0] : ids);
          return { framed: ids };
        }
        case 'undo_redo': {
          const action = a.action === 'redo' ? 'redo' : 'undo';
          api.bus.emit('edit:command', action);
          return { action };
        }
        case 'check_live_ready': {
          api.bus.emit('scene:request');
          await new Promise((r) => setTimeout(r, 40));
          const ids = sceneObjects.map((o) => o.id).filter(Boolean);
          const parts = await describeMany(ids);
          const cameras = parts.filter((p) => p?.shape === 'camera');
          const scripts = parts.filter((p) => p?.shape === 'script');
          const enabledScripts = scripts.filter((p) => p.script?.enabled !== false && String(p.script?.source || '').trim());
          const emptyScripts = scripts.filter((p) => !String(p.script?.source || '').trim());
          const issues = [];
          if (!cameras.length) issues.push('No Camera in the scene — Live Mode needs one.');
          if (!scripts.length) issues.push('No Scripts — movement/gameplay should be written in Scripts.');
          else if (!enabledScripts.length) {
            issues.push(emptyScripts.length
              ? 'Scripts exist but have empty source or are disabled.'
              : 'No enabled Scripts with source.');
          }
          return {
            ready: issues.length === 0,
            cameras: cameras.map((c) => ({ id: partId(c), name: c.name })),
            scripts: scripts.map((s) => ({
              id: partId(s),
              name: s.name,
              enabled: s.script?.enabled !== false,
              hasSource: !!String(s.script?.source || '').trim(),
              parent: s.parent,
            })),
            issues,
          };
        }
        case 'set_snap': {
          const next = {};
          if (typeof a.move === 'boolean') next.move = a.move;
          if (typeof a.rotate === 'boolean') next.rotate = a.rotate;
          if (Number.isFinite(a.moveStuds)) next.moveStuds = a.moveStuds;
          if (Number.isFinite(a.rotateDegrees)) next.rotateDegrees = a.rotateDegrees;
          api.bus.emit('snap:set', next);
          return { snap: next };
        }
        case 'set_fullbright': {
          api.bus.emit('view:fullbright', !!a.enabled);
          return { fullbright: !!a.enabled };
        }
        case 'project_file': {
          const command = a.command;
          if (!['save', 'save-as', 'open', 'new', 'export'].includes(command)) {
            return { error: 'Unknown file command' };
          }
          if ((command === 'new' || command === 'open') && !a.confirm) {
            return {
              error: `Refusing ${command} without confirm=true. Ask the user to confirm they are okay discarding unsaved work, then call again with confirm=true.`,
            };
          }
          api.bus.emit('file:command', command);
          return { command };
        }
        case 'set_tool': {
          const tool = a.tool || 'select';
          api.bus.emit('tool:changed', tool);
          return { tool };
        }
        case 'set_mode': {
          if (a.mode === 'live') api.bus.emit('mode:play');
          else api.bus.emit('mode:stop');
          return { mode: a.mode === 'live' ? 'live' : 'edit' };
        }
        default:
          return { error: `Unknown tool: ${name}` };
      }
    };

    const agentLoop = async (userText) => {
      await runtime.ensure();
      const messages = [
        { role: 'system', content: SYSTEM },
        ...history
          .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
          .map((m) => {
            if (m.role === 'tool') {
              return { role: 'tool', content: m.content, tool_name: m.tool_name };
            }
            return { role: m.role, content: m.content || '' };
          }),
        { role: 'user', content: userText },
      ];
      // Keep UI history separate from API payload construction above.
      history.push({ role: 'user', content: userText });
      paintHistory();

      let rounds = 0;
      let toolNudge = 0;
      const looksLikeMissedTools = (text) => {
        const t = String(text || '');
        return /find_by_name|create_script|write_script|get_scripting_guide|tool_calls|function call|I'll call|Let me call|first call/i.test(t);
      };
      while (rounds < 12) {
        rounds += 1;
        if (abortCtrl?.signal?.aborted) break;

        const streamEntry = { role: 'assistant', content: '…', streaming: true };
        history.push(streamEntry);
        paintHistory();

        const result = await runtime.chat({
          model: ASSISTANT_MODEL,
          messages,
          tools: TOOLS,
          think: false,
          options: { temperature: 0.15, num_ctx: 16384 },
        }, { signal: abortCtrl?.signal });

        streamEntry.streaming = false;
        streamEntry.content = result?.content || '';
        if (result?.aborted) {
          if (!streamEntry.content) streamEntry.content = '(stopped)';
          paintHistory();
          break;
        }

        const calls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
        if (!calls.length) {
          if (toolNudge < 2 && looksLikeMissedTools(streamEntry.content)) {
            toolNudge += 1;
            // Drop the prose bubble; force a real tool round.
            history.pop();
            messages.push({ role: 'assistant', content: '' });
            messages.push({
              role: 'user',
              content: 'You described tools instead of calling them. Emit native tool_calls now. Required order: get_scripting_guide → find_by_name Player → delete old movement scripts under that id → create_script(parent=Player id, full source following the guide) → lint_script → write_script until lint.ok. Never set camera.CFrame. Do not write Lua or JSON in the chat message.',
            });
            paintHistory();
            continue;
          }
          if (!streamEntry.content) streamEntry.content = '(no response)';
          // Hide long planning dumps from the UI.
          if (streamEntry.content.length > 600 && looksLikeMissedTools(streamEntry.content)) {
            streamEntry.content = 'I got stuck explaining instead of using tools. Please try that request again.';
          }
          messages.push({ role: 'assistant', content: streamEntry.content });
          paintHistory();
          break;
        }

        // Keep assistant message that requested tools in the API transcript.
        messages.push({
          role: 'assistant',
          content: streamEntry.content || '',
          tool_calls: calls,
        });
        if (!streamEntry.content || streamEntry.content.length > 400) {
          // Prefer tool chips over long thinking text.
          history.pop();
        } else {
          paintHistory();
        }

        for (const call of calls) {
          const fn = call.function || call;
          const name = fn.name || call.name;
          const args = parseArgs(fn.arguments ?? call.arguments);
          history.push({ role: 'tool-ui', content: TOOL_LABELS[name] || name });
          paintHistory();
          let toolResult;
          try {
            toolResult = await runTool(name, args);
          } catch (err) {
            toolResult = { error: String(err?.message || err) };
          }
          const content = JSON.stringify(toolResult);
          history.push({ role: 'tool', content, tool_name: name });
          messages.push({
            role: 'tool',
            tool_name: name,
            content,
          });
        }
        paintHistory();
      }
    };

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text || busy) return;
      input.value = '';
      busy = true;
      abortCtrl = new AbortController();
      paintStatus();
      stickBottom = true;
      try {
        await agentLoop(text);
      } catch (err) {
        history.push({ role: 'assistant', content: `Something went wrong: ${err?.message || err}` });
        paintHistory();
        api.log(err);
      } finally {
        busy = false;
        abortCtrl = null;
        paintStatus();
        input.focus({ preventScroll: true });
      }
    };

    list.addEventListener('scroll', () => {
      stickBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    });
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage();
    });
    stopBtn.addEventListener('click', (e) => {
      e.preventDefault();
      abortCtrl?.abort();
    });

    const readClipboardText = async () => {
      try {
        const text = await api.host.call('clipboard.readText');
        if (typeof text === 'string') return text;
      } catch { /* fall through */ }
      try {
        if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
      } catch { /* fall through */ }
      return '';
    };

    const writeClipboardText = async (text) => {
      const value = String(text ?? '');
      try {
        await api.host.call('clipboard.writeText', value);
        return true;
      } catch { /* fall through */ }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch { /* fall through */ }
      return false;
    };

    const insertAtCursor = (text) => {
      const value = String(text ?? '');
      if (!value) return;
      const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
      input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
      const pos = start + value.length;
      input.focus({ preventScroll: true });
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const selectedAssistantText = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return '';
      if (!wrap.contains(sel.anchorNode) && !wrap.contains(sel.focusNode)) return '';
      return String(sel);
    };

    const pasteIntoComposer = async () => {
      const text = await readClipboardText();
      if (!text) return;
      insertAtCursor(text);
    };

    // Keep Ctrl/Cmd shortcuts inside the Assistant from being stolen by Explorer/viewport.
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      if (e.code === 'KeyV' && document.activeElement !== input) {
        e.preventDefault();
        pasteIntoComposer();
        return;
      }
      if (e.code === 'KeyA' && document.activeElement !== input) {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(list);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      if (e.code === 'KeyC' || e.code === 'KeyX') {
        const text = selectedAssistantText();
        if (!text) return;
        // Browser copy usually works once we stopPropagation; force via host if needed.
        e.preventDefault();
        writeClipboardText(text);
      }
    });
    wrap.addEventListener('keyup', (e) => e.stopPropagation());
    wrap.addEventListener('keypress', (e) => e.stopPropagation());
    wrap.addEventListener('paste', (e) => {
      e.stopPropagation();
      if (document.activeElement === input) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text) insertAtCursor(text);
      else pasteIntoComposer();
    });
    wrap.addEventListener('copy', (e) => e.stopPropagation());
    wrap.addEventListener('cut', (e) => e.stopPropagation());
    list.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, textarea, input, a')) return;
      list.focus({ preventScroll: true });
    });
    list.addEventListener('contextmenu', (e) => {
      const text = selectedAssistantText() || (e.target.closest('[data-bubble]')?.textContent || '').trim();
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      writeClipboardText(text);
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('paste', (e) => e.stopPropagation());
    input.addEventListener('copy', (e) => e.stopPropagation());
    input.addEventListener('cut', (e) => e.stopPropagation());

    api.bus.on('scene:objects', (objects) => {
      sceneObjects = Array.isArray(objects) ? objects : [];
    });
    api.bus.on('scene:selected', (spec) => {
      selectionIds = spec == null ? [] : (Array.isArray(spec) ? spec : [spec]);
    });
    api.bus.emit('scene:request');

    const offStatus = runtime.onStatus((next) => {
      status = next;
      paintStatus();
    });

    const boot = async () => {
      try {
        await runtime.ensure();
      } catch (err) {
        api.log(err);
        paintStatus();
      }
    };

    api.bus.on('app:open', (id) => {
      if (id !== 'assistant') return;
      frame.show();
      boot();
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    });

    // Inject a tiny blink keyframe once.
    if (!document.getElementById('gw-assistant-style')) {
      const style = document.createElement('style');
      style.id = 'gw-assistant-style';
      style.textContent = '@keyframes gw-blink{50%{opacity:0}}';
      document.head.append(style);
    }

    paintEmpty();
    paintStatus();
    boot();

    return () => {
      offStatus();
      abortCtrl?.abort();
      runtime.dispose();
    };
  },
};
