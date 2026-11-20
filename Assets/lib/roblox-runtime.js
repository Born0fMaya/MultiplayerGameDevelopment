// Roblox-like script runtime for GameWindow Live Mode (Lua via wasmoon).
import { createLuaFactory } from '/Assets/lib/lua/load-wasmoon.js?v=2';

const BOOTSTRAP = `
local gw = ...

local function isVec(v)
  return type(v) == 'table' and v.__type == 'Vector3'
end
local function isCF(v)
  return type(v) == 'table' and v.__type == 'CFrame'
end
local function isColor(v)
  return type(v) == 'table' and v.__type == 'Color3'
end

local function asList(raw)
  local out = {}
  if raw == nil then return out end
  local len = tonumber(raw.length)
  if len then
    for i = 0, len - 1 do out[#out + 1] = raw[i] end
    return out
  end
  for i, v in ipairs(raw) do out[i] = v end
  if #out > 0 then return out end
  for _, v in pairs(raw) do out[#out + 1] = v end
  return out
end

local function num3(obj, ax, ay, az)
  if obj == nil then return 0, 0, 0 end
  return tonumber(obj[ax]) or 0, tonumber(obj[ay]) or 0, tonumber(obj[az]) or 0
end

Vector3 = {}
Vector3.__index = Vector3
function Vector3.new(x, y, z)
  if type(x) == 'table' and x.__type == 'Vector3' then
    return setmetatable({ X = x.X, Y = x.Y, Z = x.Z, __type = 'Vector3' }, Vector3)
  end
  return setmetatable({
    X = tonumber(x) or 0, Y = tonumber(y) or 0, Z = tonumber(z) or 0, __type = 'Vector3',
  }, Vector3)
end
function Vector3:__tostring()
  return string.format('%g, %g, %g', self.X, self.Y, self.Z)
end
function Vector3:__add(o) return Vector3.new(self.X + o.X, self.Y + o.Y, self.Z + o.Z) end
function Vector3:__sub(o) return Vector3.new(self.X - o.X, self.Y - o.Y, self.Z - o.Z) end
function Vector3:__mul(o)
  if type(o) == 'number' then return Vector3.new(self.X * o, self.Y * o, self.Z * o) end
  return Vector3.new(self.X * o.X, self.Y * o.Y, self.Z * o.Z)
end
function Vector3:__div(o)
  if type(o) == 'number' then return Vector3.new(self.X / o, self.Y / o, self.Z / o) end
  return Vector3.new(self.X / o.X, self.Y / o.Y, self.Z / o.Z)
end
function Vector3:__unm() return Vector3.new(-self.X, -self.Y, -self.Z) end
function Vector3:Dot(o) return self.X * o.X + self.Y * o.Y + self.Z * o.Z end
function Vector3:Cross(o)
  return Vector3.new(self.Y * o.Z - self.Z * o.Y, self.Z * o.X - self.X * o.Z, self.X * o.Y - self.Y * o.X)
end
function Vector3:Magnitude() return math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z) end
function Vector3:Unit()
  local m = self:Magnitude()
  if m < 1e-9 then return Vector3.new() end
  return self * (1 / m)
end
function Vector3:Lerp(goal, a)
  a = tonumber(a) or 0
  return Vector3.new(self.X + (goal.X - self.X) * a, self.Y + (goal.Y - self.Y) * a, self.Z + (goal.Z - self.Z) * a)
end
setmetatable(Vector3, { __call = function(_, x, y, z) return Vector3.new(x, y, z) end })
Vector3.zero, Vector3.one = Vector3.new(), Vector3.new(1, 1, 1)
Vector3.xAxis, Vector3.yAxis, Vector3.zAxis = Vector3.new(1, 0, 0), Vector3.new(0, 1, 0), Vector3.new(0, 0, 1)

CFrame = {}
local function cfLookFromEuler(rx, ry)
  local pitch = tonumber(rx) or 0
  local yaw = tonumber(ry) or 0
  local cp = math.cos(pitch)
  return Vector3.new(-cp * math.sin(yaw), math.sin(pitch), -cp * math.cos(yaw))
end
local function cfRightFromEuler(ry)
  local yaw = tonumber(ry) or 0
  return Vector3.new(math.cos(yaw), 0, -math.sin(yaw))
end
local function makeCF(x, y, z, rx, ry, rz, look, right, up)
  return setmetatable({
    X = tonumber(x) or 0, Y = tonumber(y) or 0, Z = tonumber(z) or 0,
    RX = tonumber(rx) or 0, RY = tonumber(ry) or 0, RZ = tonumber(rz) or 0,
    __look = look, __right = right, __up = up,
    __type = 'CFrame',
  }, CFrame)
end
function CFrame.new(x, y, z)
  if isVec(x) then return makeCF(x.X, x.Y, x.Z, 0, 0, 0) end
  return makeCF(x, y, z, 0, 0, 0)
end
function CFrame.Angles(rx, ry, rz)
  return makeCF(0, 0, 0, rx, ry, rz)
end
function CFrame:__add(v) return CFrame.new(self.X + v.X, self.Y + v.Y, self.Z + v.Z) end
function CFrame:Position() return Vector3.new(self.X, self.Y, self.Z) end
function CFrame:__index(key)
  if key == 'LookVector' then
    if self.__look then return self.__look end
    return cfLookFromEuler(self.RX, self.RY)
  end
  if key == 'RightVector' then
    if self.__right then return self.__right end
    return cfRightFromEuler(self.RY)
  end
  if key == 'UpVector' then
    if self.__up then return self.__up end
    return Vector3.new(0, 1, 0)
  end
  return rawget(CFrame, key)
end

Color3 = {}
Color3.__index = Color3
function Color3.new(r, g, b)
  return setmetatable({ R = tonumber(r) or 0, G = tonumber(g) or 0, B = tonumber(b) or 0, __type = 'Color3' }, Color3)
end
function Color3.fromRGB(r, g, b)
  return Color3.new((tonumber(r) or 0) / 255, (tonumber(g) or 0) / 255, (tonumber(b) or 0) / 255)
end
function Color3.fromHex(hex)
  hex = tostring(hex or ''):gsub('#', '')
  local n = tonumber(hex, 16) or 0
  return Color3.fromRGB(math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256)
end

Enum = {
  KeyCode = {
    W = 'KeyW', A = 'KeyA', S = 'KeyS', D = 'KeyD', Q = 'KeyQ', E = 'KeyE',
    Space = 'Space', LeftShift = 'ShiftLeft', RightShift = 'ShiftRight',
    Up = 'ArrowUp', Down = 'ArrowDown', Left = 'ArrowLeft', Right = 'ArrowRight',
  },
  UserInputType = { Keyboard = 'Keyboard', MouseButton1 = 'MouseButton1', MouseButton2 = 'MouseButton2' },
}

local waitQueue = {}
local deferred = {}
local delayed = {}

local function resumeCo(co)
  if type(co) ~= 'thread' then return end
  if coroutine.status(co) ~= 'suspended' then return end
  local ok, err = coroutine.resume(co)
  if not ok then gw.warn(tostring(err)) end
end

local function runInThread(fn, ...)
  if type(fn) ~= 'function' then return end
  local args = { ... }
  local co = coroutine.create(function()
    local ok, err = pcall(fn, table.unpack(args))
    if not ok then gw.warn(tostring(err)) end
  end)
  resumeCo(co)
end

local function signal()
  local subs = {}
  local ev = {}
  function ev:Connect(fn)
    if type(fn) ~= 'function' then return { Disconnect = function() end } end
    subs[#subs + 1] = fn
    return {
      Disconnect = function()
        for i = #subs, 1, -1 do
          if subs[i] == fn then table.remove(subs, i) break end
        end
      end,
    }
  end
  function ev:Once(fn)
    local conn
    conn = self:Connect(function(...)
      conn:Disconnect()
      fn(...)
    end)
    return conn
  end
  function ev:Fire(...)
    local copy = { table.unpack(subs) }
    for i = 1, #copy do runInThread(copy[i], ...) end
  end
  function ev:Wait()
    local co = coroutine.running()
    assert(co, 'Wait must run inside a script coroutine')
    local conn
    conn = self:Connect(function(...)
      conn:Disconnect()
      coroutine.resume(co, ...)
    end)
    return coroutine.yield()
  end
  return ev
end

local proxies = {}

local function classOf(rec)
  if not rec then return 'Instance' end
  if rec.shape == 'script' then return 'Script' end
  if rec.shape == 'camera' then return 'Camera' end
  if rec.shape == 'folder' then return 'Folder' end
  return 'Part'
end

local wrap
wrap = function(id)
  if id == nil or id == '' then return nil end
  id = tostring(id)
  if proxies[id] then return proxies[id] end
  local proxy = { __id = id }
  local mt = {}
  function mt:__index(key)
    if key == 'GetChildren' then
      return function()
        local kids, out = asList(gw.getChildren(id)), {}
        for i = 1, #kids do out[i] = wrap(kids[i]) end
        return out
      end
    end
    if key == 'GetDescendants' then
      return function()
        local kids, out = asList(gw.getDescendants(id)), {}
        for i = 1, #kids do out[i] = wrap(kids[i]) end
        return out
      end
    end
    if key == 'FindFirstChild' then
      return function(_, name)
        local child = gw.findFirstChild(id, tostring(name or ''))
        return child and wrap(child) or nil
      end
    end
    if key == 'WaitForChild' then
      return function(_, name, timeout)
        name = tostring(name or '')
        local child = gw.findFirstChild(id, name)
        if child then return wrap(child) end
        local deadline = gw.now() + (tonumber(timeout) or 5)
        while gw.now() < deadline do
          task.wait()
          child = gw.findFirstChild(id, name)
          if child then return wrap(child) end
        end
        error('WaitForChild timed out: ' .. name, 2)
      end
    end
    if key == 'IsA' then
      return function(_, className)
        return classOf(gw.getRecord(id)) == tostring(className)
      end
    end
    if key == 'Destroy' then
      return function()
        gw.destroy(id)
        proxies[id] = nil
      end
    end
    if key == 'Clone' then
      return function()
        local nid = gw.clone(id)
        return nid and wrap(nid) or nil
      end
    end
    if key == 'ApplyImpulse' then
      return function(_, impulse)
        if isVec(impulse) then
          gw.applyImpulse(id, { x = impulse.X, y = impulse.Y, z = impulse.Z })
        end
      end
    end
    if key == 'IsGrounded' then
      return function()
        return not not gw.isGrounded(id)
      end
    end

    local rec = gw.getRecord(id)
    if not rec then return nil end
    if key == 'Name' then return rec.name end
    if key == 'AssemblyLinearVelocity' then
      local v = gw.getVelocity(id) or { x = 0, y = 0, z = 0 }
      return Vector3.new(tonumber(v.x) or 0, tonumber(v.y) or 0, tonumber(v.z) or 0)
    end
    if key == 'ClassName' then return classOf(rec) end
    if key == 'Parent' then return rec.parent and wrap(rec.parent) or nil end
    if key == 'Position' then
      local x, y, z = num3(rec.position, 'x', 'y', 'z')
      return Vector3.new(x, y, z)
    end
    if key == 'Size' then
      return Vector3.new(tonumber(rec.width) or 1, tonumber(rec.height) or 1, tonumber(rec.depth) or 1)
    end
    if key == 'Orientation' then
      local x, y, z = num3(rec.rotation, 'x', 'y', 'z')
      return Vector3.new(math.deg(x), math.deg(y), math.deg(z))
    end
    if key == 'CFrame' then
      local x, y, z = num3(rec.position, 'x', 'y', 'z')
      local rx, ry, rz = num3(rec.rotation, 'x', 'y', 'z')
      local look, right, up = nil, nil, nil
      if id ~= nil and id == gw.getCameraId() and gw.getCameraBasis then
        local basis = gw.getCameraBasis()
        if basis and basis.look then
          look = Vector3.new(tonumber(basis.look.x) or 0, tonumber(basis.look.y) or 0, tonumber(basis.look.z) or 0)
        end
        if basis and basis.right then
          right = Vector3.new(tonumber(basis.right.x) or 0, tonumber(basis.right.y) or 0, tonumber(basis.right.z) or 0)
        end
        if basis and basis.up then
          up = Vector3.new(tonumber(basis.up.x) or 0, tonumber(basis.up.y) or 0, tonumber(basis.up.z) or 0)
        end
      end
      return makeCF(x, y, z, rx, ry, rz, look, right, up)
    end
    if key == 'Color' or key == 'Color3' then
      return Color3.fromHex(tostring(rec.color or '#b1b2b5'))
    end
    if key == 'Anchored' then
      local phys = rec.physics
      return not (phys and phys.enabled)
    end
    if key == 'CanCollide' then
      local phys = rec.physics
      return not phys or phys.canCollide ~= false
    end
    if key == 'Transparency' then return 0 end
    if key == 'Source' then
      local scr = rec.script
      return (scr and scr.source) or ''
    end
    if key == 'Enabled' then
      local scr = rec.script
      return not scr or scr.enabled ~= false
    end
    local child = gw.findFirstChild(id, tostring(key))
    if child then return wrap(child) end
    return nil
  end

  function mt:__newindex(key, value)
    if key == 'Name' then gw.setProp(id, 'Name', tostring(value or '')) return end
    if key == 'Parent' then
      gw.setProp(id, 'Parent', type(value) == 'table' and value.__id or nil)
      return
    end
    if key == 'Position' and isVec(value) then
      gw.setProp(id, 'Position', { x = value.X, y = value.Y, z = value.Z })
      return
    end
    if key == 'Size' and isVec(value) then
      gw.setProp(id, 'Size', { x = value.X, y = value.Y, z = value.Z })
      return
    end
    if key == 'Orientation' and isVec(value) then
      gw.setProp(id, 'Orientation', { x = math.rad(value.X), y = math.rad(value.Y), z = math.rad(value.Z) })
      return
    end
    if key == 'CFrame' and isCF(value) then
      gw.setProp(id, 'CFrame', {
        x = value.X, y = value.Y, z = value.Z,
        rx = value.RX or 0, ry = value.RY or 0, rz = value.RZ or 0,
      })
      return
    end
    if (key == 'Color' or key == 'Color3') and isColor(value) then
      local r = math.floor(math.max(0, math.min(1, value.R)) * 255 + 0.5)
      local g = math.floor(math.max(0, math.min(1, value.G)) * 255 + 0.5)
      local b = math.floor(math.max(0, math.min(1, value.B)) * 255 + 0.5)
      gw.setProp(id, 'Color', string.format('#%02x%02x%02x', r, g, b))
      return
    end
    if key == 'Anchored' then gw.setProp(id, 'Anchored', not not value) return end
    if key == 'CanCollide' then gw.setProp(id, 'CanCollide', not not value) return end
    if key == 'Enabled' then gw.setProp(id, 'Enabled', not not value) return end
    if key == 'AssemblyLinearVelocity' and isVec(value) then
      gw.setVelocity(id, { x = value.X, y = value.Y, z = value.Z })
      return
    end
  end

  function mt:__tostring()
    local rec = gw.getRecord(id)
    return string.format('%s (%s)', rec and rec.name or 'Instance', id)
  end

  setmetatable(proxy, mt)
  proxies[id] = proxy
  return proxy
end

local Heartbeat, RenderStepped, Stepped = signal(), signal(), signal()
local InputBegan, InputEnded = signal(), signal()

local RunService = {
  Heartbeat = Heartbeat,
  RenderStepped = RenderStepped,
  Stepped = Stepped,
}
local UserInputService = {
  InputBegan = InputBegan,
  InputEnded = InputEnded,
  IsKeyDown = function(_, code)
    if type(code) == 'table' then code = code.Name or code.Value end
    return gw.isKeyDown(tostring(code or ''))
  end,
}

workspace = nil
game = nil

local Workspace = { __id = 'workspace' }
do
  local mt = {}
  function mt:__index(key)
    if key == 'Name' then return 'Workspace' end
    if key == 'ClassName' then return 'Workspace' end
    if key == 'Parent' then return game end
    if key == 'CurrentCamera' then return wrap(gw.getCameraId()) end
    if key == 'GetChildren' then
      return function()
        local kids, out = asList(gw.getChildren(nil)), {}
        for i = 1, #kids do out[i] = wrap(kids[i]) end
        return out
      end
    end
    if key == 'FindFirstChild' then
      return function(_, name)
        local child = gw.findFirstChild(nil, tostring(name or ''))
        return child and wrap(child) or nil
      end
    end
    if key == 'WaitForChild' then
      return function(_, name, timeout)
        name = tostring(name or '')
        local child = gw.findFirstChild(nil, name)
        if child then return wrap(child) end
        local deadline = gw.now() + (tonumber(timeout) or 5)
        while gw.now() < deadline do
          task.wait()
          child = gw.findFirstChild(nil, name)
          if child then return wrap(child) end
        end
        error('WaitForChild timed out: ' .. name, 2)
      end
    end
    local child = gw.findFirstChild(nil, tostring(key))
    if child then return wrap(child) end
    return nil
  end
  function mt:__newindex() end
  function mt:__tostring() return 'Workspace' end
  setmetatable(Workspace, mt)
end
workspace = Workspace

local services = {
  Workspace = Workspace,
  RunService = RunService,
  UserInputService = UserInputService,
  Players = {
    LocalPlayer = {
      Character = nil,
      GetMouse = function()
        return { Hit = CFrame.new(), Target = nil }
      end,
    },
  },
}

game = {
  Workspace = Workspace,
  Players = services.Players,
  RunService = services.RunService,
  UserInputService = services.UserInputService,
  GetService = function(_, name)
    local s = services[tostring(name)]
    if not s then error('GetService: unknown service ' .. tostring(name), 2) end
    return s
  end,
  GetChildren = function() return { Workspace } end,
  FindFirstChild = function(_, name)
    local key = tostring(name)
    if key == 'Workspace' then return Workspace end
    if key == 'Players' then return services.Players end
    if key == 'RunService' then return services.RunService end
    if key == 'UserInputService' then return services.UserInputService end
    return nil
  end,
}

do
  local charId = gw.getCharacterId()
  if charId then services.Players.LocalPlayer.Character = wrap(charId) end
end

Instance = {
  new = function(className)
    local id = gw.instanceNew(tostring(className or 'Part'))
    if not id then error('Instance.new failed for ' .. tostring(className), 2) end
    return wrap(id)
  end,
}

task = {
  wait = function(seconds)
    seconds = tonumber(seconds) or 0
    local co = coroutine.running()
    assert(co, 'task.wait must run inside a script coroutine')
    waitQueue[#waitQueue + 1] = { co = co, at = gw.now() + math.max(0, seconds) }
    return coroutine.yield()
  end,
  spawn = function(fn, ...)
    runInThread(fn, ...)
  end,
  defer = function(fn, ...)
    if type(fn) ~= 'function' then return end
    deferred[#deferred + 1] = { fn = fn, args = { ... } }
  end,
  delay = function(seconds, fn, ...)
    if type(fn) ~= 'function' then return end
    delayed[#delayed + 1] = {
      at = gw.now() + math.max(0, tonumber(seconds) or 0),
      fn = fn,
      args = { ... },
    }
  end,
}

function wait(seconds)
  return task.wait(seconds)
end

function print(...)
  local n = select('#', ...)
  local parts = {}
  for i = 1, n do parts[i] = tostring(select(i, ...)) end
  gw.log(table.concat(parts, '\\t'))
end

function warn(...)
  local n = select('#', ...)
  local parts = {}
  for i = 1, n do parts[i] = tostring(select(i, ...)) end
  gw.warn(table.concat(parts, '\\t'))
end

function tick() return gw.now() end
function time() return gw.now() end

function __pump(dt)
  local now = gw.now()
  local i = 1
  while i <= #waitQueue do
    local w = waitQueue[i]
    if now >= w.at then
      table.remove(waitQueue, i)
      resumeCo(w.co)
    else
      i = i + 1
    end
  end
  local queued = deferred
  deferred = {}
  for j = 1, #queued do
    local item = queued[j]
    runInThread(item.fn, table.unpack(item.args))
  end
  i = 1
  while i <= #delayed do
    local item = delayed[i]
    if now >= item.at then
      table.remove(delayed, i)
      runInThread(item.fn, table.unpack(item.args))
    else
      i = i + 1
    end
  end
  local charId = gw.getCharacterId()
  services.Players.LocalPlayer.Character = charId and wrap(charId) or nil
  Stepped:Fire(dt, dt)
  Heartbeat:Fire(dt)
  RenderStepped:Fire(dt)
end

function __startScript(id, name, source)
  id = tostring(id or '')
  name = tostring(name or 'Script')
  source = tostring(source or '')
  if source == '' then return end
  script = wrap(id)
  local fn, err = load(source, '=' .. name)
  if not fn then
    gw.warn('[' .. name .. '] ' .. tostring(err))
    return
  end
  runInThread(fn)
end

function __input(kind, code, userInputType)
  local obj = {
    KeyCode = { Name = tostring(code or ''), Value = tostring(code or '') },
    UserInputType = { Name = tostring(userInputType or 'Keyboard') },
  }
  if kind == 'began' then InputBegan:Fire(obj, false) else InputEnded:Fire(obj, false) end
end

__wrap = wrap
return true
`;

export async function createRobloxRuntime(host) {
  const factory = await createLuaFactory();
  const engine = await factory.createEngine({ enableProxy: true });

  let running = true;
  let clock = 0;

  const gw = {
    log: (text) => host.log?.(String(text ?? '')),
    warn: (text) => host.warn?.(String(text ?? '')),
    now: () => clock,
    getRecord: (id) => host.getRecord?.(id) ?? null,
    getChildren: (id) => host.getChildren?.(id) ?? [],
    getDescendants: (id) => host.getDescendants?.(id) ?? [],
    findFirstChild: (id, name) => host.findFirstChild?.(id, name) ?? null,
    getCharacterId: () => host.getCharacterId?.() ?? null,
    getCameraId: () => host.getCameraId?.() ?? null,
    getCameraBasis: () => host.getCameraBasis?.() ?? null,
    isGrounded: (id) => !!host.isGrounded?.(id),
    setProp: (id, key, value) => host.setProp?.(id, key, value),
    destroy: (id) => host.destroy?.(id),
    clone: (id) => host.clone?.(id) ?? null,
    instanceNew: (className) => host.instanceNew?.(className) ?? null,
    applyImpulse: (id, impulse) => host.applyImpulse?.(id, impulse),
    setVelocity: (id, velocity) => host.setVelocity?.(id, velocity),
    getVelocity: (id) => host.getVelocity?.(id) ?? { x: 0, y: 0, z: 0 },
    isKeyDown: (code) => !!host.isKeyDown?.(code),
  };

  engine.global.set('__gw', gw);
  engine.global.set('__bootstrap', BOOTSTRAP);
  await engine.doString(`
local chunk, err = load(__bootstrap, '=GameWindowRoblox')
assert(chunk, err)
assert(chunk(__gw), 'bootstrap failed')
`);

  const pump = engine.global.get('__pump');
  const startScript = engine.global.get('__startScript');
  const inputFn = engine.global.get('__input');

  return {
    async start(scripts) {
      running = true;
      clock = 0;
      for (const entry of scripts || []) {
        if (entry?.enabled === false) continue;
        const source = String(entry?.source || '');
        if (!source.trim()) continue;
        try {
          startScript(String(entry.id || ''), String(entry.name || 'Script'), source);
        } catch (err) {
          host.warn?.(`[${entry.name || 'Script'}] ${err?.message || err}`);
        }
      }
    },
    stop() {
      running = false;
      try { engine.global.close?.(); } catch { /* ignore */ }
      try { engine.close?.(); } catch { /* ignore */ }
    },
    tick(dt) {
      if (!running) return;
      clock += Math.max(0, Number(dt) || 0);
      try { pump(dt); } catch (err) { host.warn?.(`Script tick error: ${err}`); }
    },
    input(kind, payload) {
      if (!running) return;
      try {
        inputFn(String(kind || ''), String(payload?.code || ''), String(payload?.userInputType || 'Keyboard'));
      } catch (err) {
        host.warn?.(`Script input error: ${err}`);
      }
    },
  };
}
