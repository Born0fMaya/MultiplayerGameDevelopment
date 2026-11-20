// Studio viewport. Loads with the window: baseplate and a fly camera.
// Right mouse looks and flies (WASD, Q/E, Shift). Middle mouse pans. Scroll zooms.
import * as THREE from '/Assets/lib/three.module.js';
import {
  boxSolid,
  cloneSolid,
  boundsOfSolid,
  solidToGeometry,
  hitSolid,
  splitFaceWithLoop,
  extrudeFace,
  rectangleLoop,
  circleLoop,
  solidEdgePositions,
  oppositeDepth,
  projectPointToFace,
  faceNormal,
  eraseEdges,
  hitSolidEdge,
  scaleSolid,
} from '/Assets/lib/solid.js?v=11';
import { createPostStack } from '/Assets/lib/viewport-gfx.js?v=6';
import * as CANNON from '/Assets/lib/cannon-es.js';

export const order = 0;

export default {
  mount(root, api) {
    root.tabIndex = 0;
    root.style.cssText = 'position:fixed;top:calc(var(--gw-menu-h,0px) + var(--gw-toolbar-h,0px));left:0;right:0;bottom:var(--gw-taskbar-h,0px);z-index:0;overflow:hidden;background:#c5d8e8;outline:none;touch-action:none;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    root.append(canvas);

    const hint = document.createElement('div');
    hint.textContent = 'Left click selects  ·  Ctrl-click adds  ·  Drag a box with Select  ·  F frames  ·  Right mouse look and fly (WASD, Q/E)  ·  Middle mouse pan  ·  Scroll zoom';
    hint.style.cssText = 'position:absolute;left:16px;bottom:14px;color:rgba(22,26,30,.72);font:12px/1.4 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif);pointer-events:none;text-shadow:0 1px 2px rgba(255,255,255,.45);transition:opacity .5s ease;';
    root.append(hint);

    const gizmo = document.createElement('canvas');
    gizmo.style.cssText = 'position:absolute;top:10px;right:10px;width:92px;height:92px;';
    root.append(gizmo);
    const gizmoCtx = gizmo.getContext('2d');
    const gizmoSize = 92;
    const gizmoDpr = Math.min(devicePixelRatio || 1, 2);
    gizmo.width = gizmoSize * gizmoDpr;
    gizmo.height = gizmoSize * gizmoDpr;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (err) {
      root.textContent = 'This viewport needs WebGL.';
      api.log(err);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xc5d8e8, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xc5d8e8, 520, 1500);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.15, 8000);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x6eaddf) },
          horizon: { value: new THREE.Color(0xd7e7f4) },
          bottom: { value: new THREE.Color(0xb7c0c8) },
        },
        vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec3 vPos;
          uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
          void main() {
            float h = normalize(vPos).y;
            vec3 col = mix(horizon, top, smoothstep(0.0, 0.45, h));
            col = mix(bottom, col, smoothstep(-0.2, 0.08, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);

    const hemi = new THREE.HemisphereLight(0xd4e7f8, 0x8a8a90, 0.9);
    const ambient = new THREE.AmbientLight(0xffffff, 0.28);
    // Near + far cascade lights share the sun direction. Intensity is split so
    // the scene stays about as bright as the old single 1.55 sun.
    const sunOffset = new THREE.Vector3(56, 96, 36);
    const sun = new THREE.DirectionalLight(0xfff3e2, 0.95);
    const sunFar = new THREE.DirectionalLight(0xfff3e2, 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 1.6;
    sun.shadow.blurSamples = 12;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sunFar.castShadow = true;
    sunFar.shadow.mapSize.set(2048, 2048);
    sunFar.shadow.bias = -0.00012;
    sunFar.shadow.normalBias = 0.06;
    sunFar.shadow.radius = 3.2;
    sunFar.shadow.blurSamples = 8;
    sunFar.shadow.camera.near = 0.5;
    sunFar.shadow.camera.far = 800;
    sunFar.shadow.camera.left = -160;
    sunFar.shadow.camera.right = 160;
    sunFar.shadow.camera.top = 160;
    sunFar.shadow.camera.bottom = -160;
    scene.add(hemi, ambient, sun, sun.target, sunFar, sunFar.target);

    const post = createPostStack(renderer);
    const place = new THREE.Group();
    scene.add(place);

    const lit = {
      hemi: hemi.intensity,
      ambient: ambient.intensity,
      sun: sun.intensity,
      sunFar: sunFar.intensity,
      exposure: renderer.toneMappingExposure,
      toneMapping: renderer.toneMapping,
    };
    let fullbright = false;

    // Fullbright is unlit albedo: push each surface color into emissive so
    // MeshStandard materials read at their true color with no shade from the sun.
    function paintFullbrightMaterial(mat, on) {
      if (!mat || !mat.color || !mat.emissive) return;
      if (on) {
        if (!mat.userData._fb) {
          mat.userData._fb = {
            emissive: mat.emissive.clone(),
            emissiveIntensity: mat.emissiveIntensity ?? 0,
            metalness: mat.metalness,
            roughness: mat.roughness,
          };
        }
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = 1;
        if (typeof mat.metalness === 'number') mat.metalness = 0;
        if (typeof mat.roughness === 'number') mat.roughness = 1;
        mat.needsUpdate = true;
      } else if (mat.userData._fb) {
        mat.emissive.copy(mat.userData._fb.emissive);
        mat.emissiveIntensity = mat.userData._fb.emissiveIntensity;
        if (typeof mat.userData._fb.metalness === 'number') mat.metalness = mat.userData._fb.metalness;
        if (typeof mat.userData._fb.roughness === 'number') mat.roughness = mat.userData._fb.roughness;
        delete mat.userData._fb;
        mat.needsUpdate = true;
      }
    }

    function syncFullbrightMaterials() {
      place.traverse((obj) => {
        if (!obj.isMesh) return;
        for (const mat of [].concat(obj.material || [])) paintFullbrightMaterial(mat, fullbright);
      });
    }

    const applyFullbright = (on) => {
      fullbright = !!on;
      if (fullbright) {
        // Flat fill + emissive albedo. No sun/hemi so faces do not pick up
        // directional shade; ambient alone keeps the whole place evenly lit.
        hemi.intensity = 0;
        ambient.intensity = 2.2;
        sun.intensity = 0;
        sunFar.intensity = 0;
        sun.castShadow = false;
        sunFar.castShadow = false;
        renderer.shadowMap.enabled = false;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        post.setAoAmount(0);
      } else {
        hemi.intensity = lit.hemi;
        ambient.intensity = lit.ambient;
        sun.intensity = lit.sun;
        sunFar.intensity = lit.sunFar;
        sun.castShadow = true;
        sunFar.castShadow = true;
        renderer.shadowMap.enabled = true;
        renderer.toneMapping = lit.toneMapping;
        renderer.toneMappingExposure = lit.exposure;
        post.restoreAo();
      }
      syncFullbrightMaterials();
      for (const model of models) syncEmissive(model);
    };
    api.bus.on('view:fullbright', applyFullbright);
    const models = [];
    let tool = 'select';
    let snap = { move: true, moveStuds: 4, rotate: true, rotateDegrees: 45 };
    let selected = null;
    let selection = [];
    let drag = null;
    let pendingClick = null;
    let playMode = 'edit';
    const isLive = () => playMode === 'live';
    const claims = new Map();
    let locked = new Set();
    const isLocked = (kind) => !!kind && locked.has(kind);

    function disposeObject(obj) {
      clearEmissiveLight(obj);
      const geos = new Set();
      const mats = new Set();
      obj.traverse((child) => {
        if (child.geometry && !geos.has(child.geometry)) {
          geos.add(child.geometry);
          child.geometry.dispose();
        }
        for (const m of [].concat(child.material ?? [])) {
          if (!m || mats.has(m)) continue;
          mats.add(m);
          if (m.map) m.map.dispose();
          m.dispose();
        }
      });
    }

    function shapeGeometry(shape, x, y, z) {
      if (shape === 'sphere') {
        const geo = new THREE.SphereGeometry(0.5, 28, 18);
        geo.scale(x, y, z);
        return geo;
      }
      if (shape === 'cylinder') {
        const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
        geo.scale(x, y, z);
        return geo;
      }
      if (shape === 'wedge') return wedgeGeometry(x, y, z);
      if (shape === 'corner') return cornerGeometry(x, y, z);
      if (shape === 'camera') return cameraGeometry(x, y, z);
      return new THREE.BoxGeometry(x, y, z);
    }

    // Edit-mode Camera gizmo: body + lens frustum facing local -Z (Studio look).
    function cameraGeometry(w, h, d) {
      const hw = w / 2;
      const hh = h / 2;
      const hd = d / 2;
      const bodyZ = hd * 0.35;
      const positions = [];
      const push = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      };
      // Body box (rear).
      const x0 = -hw * 0.7;
      const x1 = hw * 0.7;
      const y0 = -hh * 0.7;
      const y1 = hh * 0.7;
      const z0 = -bodyZ;
      const z1 = hd * 0.15;
      const box = [
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      ];
      const faces = [
        [0, 1, 2], [0, 2, 3],
        [5, 4, 7], [5, 7, 6],
        [4, 0, 3], [4, 3, 7],
        [1, 5, 6], [1, 6, 2],
        [3, 2, 6], [3, 6, 7],
        [4, 5, 1], [4, 1, 0],
      ];
      for (const face of faces) {
        const a = box[face[0]];
        const b = box[face[1]];
        const c = box[face[2]];
        push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
      // Frustum pyramid pointing toward -Z.
      const tip = [0, 0, -hd];
      const rim = [
        [-hw, -hh, z0],
        [hw, -hh, z0],
        [hw, hh, z0],
        [-hw, hh, z0],
      ];
      push(rim[0][0], rim[0][1], rim[0][2], tip[0], tip[1], tip[2], rim[1][0], rim[1][1], rim[1][2]);
      push(rim[1][0], rim[1][1], rim[1][2], tip[0], tip[1], tip[2], rim[2][0], rim[2][1], rim[2][2]);
      push(rim[2][0], rim[2][1], rim[2][2], tip[0], tip[1], tip[2], rim[3][0], rim[3][1], rim[3][2]);
      push(rim[3][0], rim[3][1], rim[3][2], tip[0], tip[1], tip[2], rim[0][0], rim[0][1], rim[0][2]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      return geo;
    }

    function wedgeGeometry(w, h, d) {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, -h / 2);
      shape.lineTo(d / 2, -h / 2);
      shape.lineTo(-d / 2, h / 2);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      geo.translate(0, 0, -w / 2);
      geo.rotateY(Math.PI / 2);
      geo.computeVertexNormals();
      return geo;
    }

    function cornerGeometry(w, h, d) {
      const hw = w / 2;
      const hh = h / 2;
      const hd = d / 2;
      const v = [
        [-hw, -hh, -hd],
        [hw, -hh, -hd],
        [-hw, -hh, hd],
        [-hw, hh, -hd],
      ];
      const faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];
      const positions = [];
      for (const face of faces) {
        for (const index of face) positions.push(...v[index]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      return geo;
    }

    function setPartSize(group, x, y, z, fromSolid = null) {
      const size = group.userData.size;
      const nx = Math.max(0.2, x);
      const ny = Math.max(0.2, y);
      const nz = Math.max(0.2, z);
      if (group.userData.solid || fromSolid) {
        const base = fromSolid || group.userData.solid;
        const box = boundsOfSolid(base);
        const sx = nx / Math.max(0.2, box.size[0]);
        const sy = ny / Math.max(0.2, box.size[1]);
        const sz = nz / Math.max(0.2, box.size[2]);
        applySolidMesh(group, scaleSolid(base, sx, sy, sz));
        return;
      }
      size.x = nx;
      size.y = ny;
      size.z = nz;
      const body = group.userData.body;
      body.geometry.dispose();
      body.geometry = shapeGeometry(group.userData.shape || 'block', size.x, size.y, size.z);
    }

    function applySolidMesh(group, solid) {
      const body = group.userData.body;
      const built = solidToGeometry(solid);
      body.geometry.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(built.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(built.normals, 3));
      body.geometry = geo;
      // Tunnel / pocket interiors are viewed from inside — keep both sides lit.
      [].concat(body.material || []).forEach((mat) => {
        if (mat && mat.side !== undefined) mat.side = THREE.DoubleSide;
      });
      group.userData.solid = cloneSolid(solid);
      group.userData.shape = 'solid';
      group.userData.faceMap = built.faceMap;
      if (group.userData.edges) {
        group.remove(group.userData.edges);
        group.userData.edges.geometry.dispose();
        group.userData.edges.material.dispose();
      }
      const edgePos = solidEdgePositions(solid);
      const edges = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3)),
        new THREE.LineBasicMaterial({ color: 0x2a2e33, toneMapped: false }),
      );
      edges.raycast = () => {};
      group.add(edges);
      group.userData.edges = edges;
      const box = boundsOfSolid(solid);
      group.userData.size = { x: box.size[0], y: box.size[1], z: box.size[2] };
      group.userData.solidCenter = {
        x: (box.min[0] + box.max[0]) / 2,
        y: (box.min[1] + box.max[1]) / 2,
        z: (box.min[2] + box.max[2]) / 2,
      };
    }

    function clearSolidMesh(group) {
      if (!group.userData.solid && !group.userData.edges) return;
      group.userData.solid = null;
      group.userData.faceMap = null;
      group.userData.solidCenter = null;
      if (group.userData.edges) {
        group.remove(group.userData.edges);
        group.userData.edges.geometry.dispose();
        group.userData.edges.material.dispose();
        group.userData.edges = null;
      }
    }

    function ensureSolid(group) {
      if (group.userData.solid) return group.userData.solid;
      const size = group.userData.size;
      const solid = boxSolid(size.x, size.y, size.z);
      applySolidMesh(group, solid);
      const mats = [].concat(group.userData.body.material || []);
      if (mats[0] && !mats[0].isMeshStandardMaterial) {
        /* keep */
      } else if (mats.length === 1) {
        /* already standard */
      }
      return solid;
    }

    function commitSolid(group, solid, live = false) {
      applySolidMesh(group, solid);
      const box = boundsOfSolid(solid);
      api.bus.emit('project:solid', {
        kind: group.userData.kind,
        solid: cloneSolid(solid),
        size: { x: box.size[0], y: box.size[1], z: box.size[2] },
        live,
      });
    }

    function makeModel(kind, name, size, position, rotation, extras) {
      const group = new THREE.Group();
      group.name = name;
      group.userData.selectable = true;
      group.userData.kind = kind;
      group.userData.size = { x: size.x, y: size.y, z: size.z };
      group.position.set(position[0], position[1], position[2]);
      group.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
      body.castShadow = kind !== 'baseplate';
      body.receiveShadow = true;
      group.userData.body = body;
      group.add(body);
      if (extras) extras(group, body);
      setPartSize(group, size.x, size.y, size.z);
      return group;
    }

    function buildPlace(doc) {
      selected = null;
      selection = [];
      drag = null;
      pendingClick = null;
      for (const model of models) model.removeFromParent();
      for (const child of [...place.children]) {
        place.remove(child);
        disposeObject(child);
      }
      for (const model of models) disposeObject(model);
      models.length = 0;

      const specified = doc != null;
      const plate = doc?.baseplate ?? {};
      const plateSize = { x: plate.width ?? 512, y: plate.thickness ?? 20, z: plate.depth ?? 512 };
      const base = (!specified || doc.baseplate) ? makeModel(
        'baseplate',
        plate.name || 'Baseplate',
        plateSize,
        plate.position ?? [0, -plateSize.y / 2, 0],
        plate.rotation ?? [0, 0, 0],
        (group, body) => {
          const old = body.material;
          const sideMat = new THREE.MeshStandardMaterial({ color: 0x8f8e92, roughness: 0.94, metalness: 0 });
          body.material = [sideMat, sideMat, baseplateMaterial(), sideMat, sideMat, sideMat];
          old.dispose();
        },
      ) : null;
      if (base) {
        place.add(base);
        models.push(base);
      }
      const placement = doc?.placement && typeof doc.placement === 'object' ? doc.placement : {};
      for (const part of doc?.parts ?? []) {
        if (!part || part.shape === 'controller') continue;
        const model = addUserPart({ ...part, parent: placement[part.id] || null });
        place.add(model);
        models.push(model);
      }
      if (base) applyColor(base, 'baseplate', doc?.baseplate?.color);
      syncAllCameraRigs();
      publishScene();
      if (fullbright) syncFullbrightMaterials();
    }

    function defaultColor(kind) {
      if (kind === 'baseplate') return '#a3a2a5';
      return '#b1b2b5';
    }

    function applyColor(model, kind, color) {
      const body = model?.userData?.body;
      if (!body) return;
      const custom = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '';
      const resolved = (custom || defaultColor(kind)).toLowerCase();
      model.userData.color = resolved;
      const top = new THREE.Color(resolved);
      [].concat(body.material || []).forEach((mat, index) => {
        if (!mat?.color) return;
        if (kind === 'baseplate' && !custom && index !== 2) mat.color.setHex(0x8f8e92);
        else mat.color.copy(top);
        if (fullbright) paintFullbrightMaterial(mat, true);
        else mat.needsUpdate = true;
      });
      // Emissive light/self-glow always tracks the part color — never a separate tint.
      if (model.userData.emissive) syncEmissive(model);
    }

    function clearEmissiveLight(model) {
      const light = model?.userData?.emitLight;
      if (!light) return;
      light.removeFromParent();
      if (light.dispose) light.dispose();
      model.userData.emitLight = null;
    }

    function syncEmissive(model) {
      const body = model?.userData?.body;
      if (!body) return;
      const on = !!model.userData.emissive && model.userData.kind !== 'baseplate' && !fullbright;
      const intensity = Math.max(0, Number(model.userData.emissiveIntensity) || 0);
      const mats = [].concat(body.material || []);
      const albedo = mats.find((mat) => mat?.color)?.color || new THREE.Color(0xffffff);

      for (const mat of mats) {
        if (!mat?.emissive) continue;
        if (fullbright) continue;
        if (on && intensity > 0) {
          // Self-glow in the part color. Boost past albedo so it reads as lit
          // under ACES + sunlight, not just a slightly brighter diffuse.
          mat.emissive.copy(albedo);
          mat.emissiveIntensity = Math.max(2, intensity * 3);
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
        mat.needsUpdate = true;
      }

      if (!on || intensity <= 0) {
        clearEmissiveLight(model);
        return;
      }

      let light = model.userData.emitLight;
      if (!light) {
        light = new THREE.PointLight(0xffffff, 1, 0, 2);
        light.castShadow = false;
        light.userData.emitLight = true;
        model.add(light);
        model.userData.emitLight = light;
      } else if (light.parent !== model) {
        light.removeFromParent();
        model.add(light);
      }
      light.color.copy(albedo);
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      const extent = Math.max(0.5, Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));
      // Physical PointLight intensity is candela — scale so Intensity 1 clearly
      // washes nearby surfaces in the part color under the studio sun.
      light.intensity = intensity * 140;
      light.distance = Math.max(12, extent * (10 + intensity * 5));
      light.decay = 1.5;
      light.visible = true;
    }

    function applyAppearance(model, part) {
      const body = model?.userData?.body;
      if (!body || !part) return;
      const on = !!part.emissive && model.userData.kind !== 'baseplate';
      const intensity = Number.isFinite(part.emissiveIntensity) ? Math.max(0, part.emissiveIntensity) : 1;
      model.userData.emissive = on;
      model.userData.emissiveIntensity = intensity;
      model.userData.physics = part.physics && typeof part.physics === 'object' ? { ...part.physics } : null;
      model.userData.camera = part.camera && typeof part.camera === 'object' ? { ...part.camera } : null;
      model.userData.script = part.script && typeof part.script === 'object' ? { ...part.script } : null;
      model.userData.parentId = typeof part.parent === 'string' && part.parent ? part.parent : null;
      syncEmissive(model);
      hideScriptHelper(model);
    }

    function addUserPart(part) {
      const tint = (typeof part.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(part.color))
        ? part.color
        : defaultColor(part.id);
      const model = makeModel(
        part.id,
        part.name || 'Part',
        { x: part.width, y: part.height, z: part.depth },
        part.position ?? [0, part.height / 2, 0],
        part.rotation ?? [0, 0, 0],
        (group, body) => {
          group.userData.shape = part.shape || 'block';
          const old = body.material;
          body.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(tint),
            roughness: 0.58,
            metalness: 0.04,
            emissive: 0x000000,
            emissiveIntensity: 0,
          });
          old.dispose();
          if (part.solid && part.solid.vertices && part.solid.faces) {
            applySolidMesh(group, cloneSolid(part.solid));
          }
        },
      );
      // Open / rebuild used to leave parts on the default gray mesh tint.
      applyColor(model, part.id, part.color);
      applyAppearance(model, part);
      hideScriptHelper(model);
      return model;
    }

    // Scripts are data-only (Explorer). Never draw or pick them in the viewport.
    function hideScriptHelper(model) {
      if (!model || model.userData.shape !== 'script') return;
      model.userData.selectable = false;
      model.visible = false;
      const body = model.userData.body;
      if (!body) return;
      body.visible = false;
      body.castShadow = false;
      body.receiveShadow = false;
      body.raycast = () => {};
    }

    function publishScene() {
      api.bus.emit('scene:objects', models.map((model) => ({
        id: model.userData.kind,
        name: model.name,
        shape: model.userData.shape || (model.userData.kind === 'baseplate' ? 'baseplate' : 'block'),
      })));
      api.bus.emit('scene:selected', selection.length ? selection.map((model) => model.userData.kind) : null);
    }

    // Undo and redo update the parts already in the scene. Rebuilding would
    // allocate new geometries and textures on every step.
    const num = (value) => Number.isFinite(value) ? value : 0;

    function applyDoc(doc) {
      if (!doc || models.length === 0) return false;
      const entries = [
        ...(doc.baseplate ? [['baseplate', doc.baseplate, 'block']] : []),
        ...(doc.parts || [])
          .filter((part) => part && part.shape !== 'controller')
          .map((part) => [part.id, part, part.shape || 'block']),
      ];
      const keep = new Set(entries.map((entry) => entry[0]));
      for (let i = models.length - 1; i >= 0; i--) {
        if (keep.has(models[i].userData.kind)) continue;
        const model = models[i];
        // Cameras (and other helpers) may be scene-graph children of this Part.
        // Re-home ones we are keeping so dispose does not wipe their meshes.
        for (const child of [...model.children]) {
          if (child.userData?.kind && keep.has(child.userData.kind)) place.attach(child);
        }
        const index = selection.indexOf(model);
        if (index >= 0) selection.splice(index, 1);
        if (selected === model) selected = selection[selection.length - 1] ?? null;
        model.removeFromParent();
        disposeObject(model);
        models.splice(i, 1);
      }
      const placement = doc.placement && typeof doc.placement === 'object' ? doc.placement : {};
      for (const [kind, part, shape] of entries) {
        let model = models.find((item) => item.userData.kind === kind);
        if (!model) {
          if (kind === 'baseplate') return false;
          model = addUserPart({ ...part, id: kind, shape, parent: placement[kind] || null });
          place.add(model);
          models.push(model);
        }
        // Doc poses are world-space. Detach before writing so nested cameras
        // do not treat world values as local offsets under a parent Part.
        if (model.parent && model.parent !== place) place.attach(model);
        const position = part.position ?? [0, 0, 0];
        const rotation = part.rotation ?? [0, 0, 0];
        model.position.set(num(position[0]), num(position[1]), num(position[2]));
        model.rotation.set(num(rotation[0]), num(rotation[1]), num(rotation[2]));
        model.name = part.name || (kind === 'baseplate' ? 'Baseplate' : 'Part');
        if (part.solid && part.solid.vertices && part.solid.faces) {
          applySolidMesh(model, cloneSolid(part.solid));
        } else {
          const next = kind === 'baseplate'
            ? { x: part.width, y: part.thickness, z: part.depth }
            : { x: part.width, y: part.height, z: part.depth };
          const wasSolid = !!model.userData.solid;
          clearSolidMesh(model);
          model.userData.shape = shape === 'solid' ? 'block' : (shape || 'block');
          if (wasSolid || next.x !== model.userData.size.x || next.y !== model.userData.size.y || next.z !== model.userData.size.z) {
            setPartSize(model, next.x, next.y, next.z);
          }
        }
        applyColor(model, kind, part.color);
        applyAppearance(model, { ...part, parent: placement[kind] || null });
      }
      syncAllCameraRigs();
      return true;
    }

    const target = new THREE.Vector3(0, 0.6, 0);
    let yaw = Math.PI / 4;
    let pitch = -0.58;
    let distance = 30;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();
    const hit = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pointer = new THREE.Vector2();
    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const _c = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _plane = new THREE.Plane();

    function disposeOutline(group) {
      group.removeFromParent();
      const fill = group.userData.fill;
      const lines = group.userData.lines;
      const glow = group.userData.glow;
      if (fill?.geometry) fill.geometry.dispose();
      if (lines?.geometry) lines.geometry.dispose();
      // glow shares fill.geometry
      group.traverse((child) => {
        if (child.material) child.material.dispose();
      });
    }

    // Highlight follows the real body mesh (including push/pull tunnels and
    // protrusions), not a bounding box estimated from size.
    function makeOutline(color, hover = false) {
      const group = new THREE.Group();
      group.visible = false;
      group.frustumCulled = false;
      group.raycast = () => {};
      const fill = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: hover ? 0.08 : 0.18,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      fill.renderOrder = 898;
      fill.raycast = () => {};
      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: hover ? 0.05 : 0.1,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
        side: THREE.BackSide,
      });
      glowMat.customProgramCacheKey = () => 'gw-outline-glow';
      glowMat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          'vec3 transformed = position + normal * 0.05;',
        );
      };
      const glow = new THREE.Mesh(fill.geometry, glowMat);
      glow.renderOrder = 897;
      glow.raycast = () => {};
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color,
          toneMapped: false,
          depthTest: true,
          depthWrite: false,
          transparent: true,
          opacity: hover ? 0.85 : 1,
        }),
      );
      lines.renderOrder = 900;
      lines.raycast = () => {};
      group.add(glow, fill, lines);
      group.userData.fill = fill;
      group.userData.glow = glow;
      group.userData.lines = lines;
      group.userData.geoSig = '';
      scene.add(group);
      return group;
    }

    const selectionBoxes = [];
    const hoverBox = makeOutline(0xc5ced6, true);

    function syncOutlines() {
      while (selectionBoxes.length < selection.length) selectionBoxes.push(makeOutline(0x6eb6ff));
      for (let i = 0; i < selectionBoxes.length; i++) {
        if (i < selection.length) placeOutline(selectionBoxes[i], selection[i]);
        else selectionBoxes[i].visible = false;
      }
    }

    function bindOutlineGeometry(outline, object) {
      const body = object.userData.body;
      const src = body?.geometry;
      if (!src) return;
      const count = src.getAttribute('position')?.count || 0;
      const solid = object.userData.solid;
      const sig = `${src.uuid}:${count}:${solid ? solid.faces?.length : 'box'}`;
      if (outline.userData.geoSig === sig) return;
      outline.userData.geoSig = sig;

      const fill = outline.userData.fill;
      const glow = outline.userData.glow;
      const lines = outline.userData.lines;
      if (fill.geometry) fill.geometry.dispose();
      if (lines.geometry) lines.geometry.dispose();

      const cloned = src.clone();
      if (!cloned.getAttribute('normal')) cloned.computeVertexNormals();
      fill.geometry = cloned;
      glow.geometry = cloned;

      if (solid) {
        const edgePos = solidEdgePositions(solid);
        lines.geometry = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(edgePos, 3),
        );
      } else {
        lines.geometry = new THREE.EdgesGeometry(src, 20);
      }
    }

    function placeOutline(outline, object) {
      if (!object) {
        outline.visible = false;
        outline.userData.target = null;
        return;
      }
      if (outline.userData.target !== object) {
        outline.userData.target = object;
        outline.userData.geoSig = '';
      }
      object.updateMatrixWorld(true);
      outline.visible = true;
      outline.position.copy(object.getWorldPosition(_a));
      outline.quaternion.copy(object.getWorldQuaternion(_q));
      outline.scale.set(1, 1, 1);
      bindOutlineGeometry(outline, object);
    }

    const readout = document.createElement('div');
    readout.style.cssText = 'position:fixed;z-index:40;display:none;pointer-events:none;color:var(--gw-text, #e8eaed);background:var(--gw-bg, #1c1c1c);border:1px solid var(--gw-line, rgba(255,255,255,.08));font:12px/1.3 var(--gw-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif);padding:4px 8px;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.35);';
    root.append(readout);

    const AXIS_COLOR = [0xe23d3d, 0x3caf4c, 0x3a7ae6];
    const toolPivot = new THREE.Group();
    const moveRoot = new THREE.Group();
    const rotateRoot = new THREE.Group();
    const scaleRoot = new THREE.Group();
    toolPivot.add(moveRoot, rotateRoot);
    scene.add(toolPivot, scaleRoot);
    toolPivot.visible = false;
    scaleRoot.visible = false;

    function handleMaterial(color, opacity = 1) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      return mat;
    }

    function localAxis(axis, out) {
      return out.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    }

    function axisWorld(object, axis, out) {
      object.updateMatrixWorld(true);
      return localAxis(axis, out).transformDirection(object.matrixWorld).normalize();
    }

    function addArrow(axis) {
      const group = new THREE.Group();
      const mat = handleMaterial(AXIS_COLOR[axis]);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 10), mat);
      shaft.position.y = 0.46;
      shaft.raycast = () => {};
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 12), mat);
      head.position.y = 0.88;
      head.raycast = () => {};
      const pick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 1.15, 8),
        handleMaterial(0xffffff, 0),
      );
      pick.position.y = 0.55;
      pick.userData.handle = { mode: 'move', axis };
      pick.userData.paint = mat;
      group.add(shaft, head, pick);
      if (axis === 0) group.rotation.z = -Math.PI / 2;
      if (axis === 2) group.rotation.x = Math.PI / 2;
      moveRoot.add(group);
    }

    function addRing(axis) {
      const group = new THREE.Group();
      const mat = handleMaterial(AXIS_COLOR[axis]);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.028, 8, 64), mat);
      ring.raycast = () => {};
      const pick = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 6, 32), handleMaterial(0xffffff, 0));
      pick.userData.handle = { mode: 'rotate', axis };
      pick.userData.paint = mat;
      group.add(ring, pick);
      if (axis === 0) group.rotation.y = Math.PI / 2;
      if (axis === 1) group.rotation.x = Math.PI / 2;
      rotateRoot.add(group);
    }

    const scaleHandles = [];
    for (let axis = 0; axis < 3; axis++) {
      addArrow(axis);
      addRing(axis);
      for (const sign of [1, -1]) {
        const mat = handleMaterial(AXIS_COLOR[axis]);
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        box.raycast = () => {};
        const pick = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), handleMaterial(0xffffff, 0));
        pick.userData.handle = { mode: 'scale', axis, sign };
        pick.userData.paint = mat;
        const group = new THREE.Group();
        group.userData.face = { axis, sign };
        group.add(box, pick);
        scaleRoot.add(group);
        scaleHandles.push(group);
      }
    }
    const raise = (obj) => {
      obj.renderOrder = 1000;
      obj.frustumCulled = false;
      obj.traverse((child) => {
        child.renderOrder = 1000;
        child.frustumCulled = false;
      });
    };
    raise(toolPivot);
    raise(scaleRoot);

    function paintHandles(active) {
      const walk = (rootNode) => {
        rootNode.traverse((obj) => {
          if (!obj.userData.paint) return;
          const info = obj.userData.handle;
          const hot = active && info && info.mode === active.mode && info.axis === active.axis && info.sign === active.sign;
          obj.userData.paint.color.setHex(hot ? 0xffe36b : AXIS_COLOR[info.axis]);
        });
      };
      walk(moveRoot);
      walk(rotateRoot);
      walk(scaleRoot);
    }

    function showReadout(text, x, y) {
      readout.textContent = text;
      readout.style.display = 'block';
      readout.style.left = `${x + 14}px`;
      readout.style.top = `${y + 14}px`;
    }

    function hideReadout() {
      readout.style.display = 'none';
    }

    const groupBox = new THREE.Box3();
    const groupSize = new THREE.Vector3();
    const groupCenter = new THREE.Vector3();

    function activeSelection() {
      // Keep parts we just claimed even if locks have not cleared yet.
      return selection.filter((model) => {
        if (!model) return false;
        const id = model.userData.kind;
        return !isLocked(id) || claims.has(id);
      });
    }

    function selectionBounds(list, targetBox = groupBox) {
      targetBox.makeEmpty();
      for (const model of list) {
        model.updateMatrixWorld(true);
        targetBox.expandByObject(model);
      }
      return !targetBox.isEmpty();
    }

    function syncTools() {
      if (isLive()) {
        toolPivot.visible = false;
        scaleRoot.visible = false;
        hoverBox.visible = false;
        for (const box of selectionBoxes) box.visible = false;
        gizmo.style.visibility = 'hidden';
        return;
      }
      gizmo.style.visibility = '';
      const members = activeSelection();
      const show = members.length && (tool === 'move' || tool === 'rotate' || tool === 'scale');
      toolPivot.visible = !!(show && (tool === 'move' || tool === 'rotate'));
      moveRoot.visible = tool === 'move';
      rotateRoot.visible = tool === 'rotate';
      scaleRoot.visible = !!(show && tool === 'scale');
      syncOutlines();
      if (!members.length) {
        hoverBox.visible = false;
        return;
      }
      const pivot = selected && members.includes(selected) ? selected : members[members.length - 1];
      if (!selectionBounds(members)) return;
      groupBox.getCenter(groupCenter);
      groupBox.getSize(groupSize);
      const dist = Math.max(camera.position.distanceTo(groupCenter), 2);
      const screen = dist * 0.1;
      toolPivot.position.copy(groupCenter);
      if (members.length === 1) toolPivot.quaternion.copy(pivot.getWorldQuaternion(_q));
      else toolPivot.quaternion.identity();
      toolPivot.scale.setScalar(screen);
      scaleRoot.position.copy(groupCenter);
      scaleRoot.quaternion.copy(toolPivot.quaternion);
      toolPivot.updateMatrixWorld(true);
      scaleRoot.updateMatrixWorld(true);
      const handleSize = dist * 0.02;
      const size = members.length === 1
        ? pivot.userData.size
        : { x: Math.max(0.2, groupSize.x), y: Math.max(0.2, groupSize.y), z: Math.max(0.2, groupSize.z) };
      for (const group of scaleHandles) {
        const { axis, sign } = group.userData.face;
        group.position.set(
          axis === 0 ? sign * size.x / 2 : 0,
          axis === 1 ? sign * size.y / 2 : 0,
          axis === 2 ? sign * size.z / 2 : 0,
        );
        group.scale.setScalar(handleSize);
      }
    }

    function setPointer(e) {
      const rect = root.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    }

    function toScreen(world) {
      _c.copy(world).project(camera);
      const rect = root.getBoundingClientRect();
      return {
        x: (_c.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-_c.y * 0.5 + 0.5) * rect.height + rect.top,
        behind: _c.z < -1 || _c.z > 1,
      };
    }

    function pickHandle(e) {
      const roots = [];
      if (toolPivot.visible && moveRoot.visible) roots.push(moveRoot);
      if (toolPivot.visible && rotateRoot.visible) roots.push(rotateRoot);
      if (scaleRoot.visible) roots.push(scaleRoot);
      if (!roots.length) return null;
      for (const obj of roots) obj.updateMatrixWorld(true);
      const hits = raycaster.intersectObjects(roots, true);
      const direct = hits.find((hit) => hit.object.userData.handle);
      if (direct) return direct.object.userData.handle;
      if (!e) return null;
      let best = null;
      let bestDist = 28;
      for (const obj of roots) {
        obj.traverse((child) => {
          const info = child.userData.handle;
          if (!info) return;
          if (info.mode === 'rotate') {
            const centerWorld = child.getWorldPosition(_a).clone();
            const radial = new THREE.Vector3(1, 0, 0).transformDirection(child.matrixWorld).multiplyScalar(child.getWorldScale(_b).x || 1);
            const center = toScreen(centerWorld);
            if (center.behind) return;
            const edge = toScreen(centerWorld.add(radial));
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            const dist = Math.abs(Math.hypot(e.clientX - center.x, e.clientY - center.y) - radius);
            if (dist < bestDist) { bestDist = dist; best = info; }
            return;
          }
          const p = toScreen(child.getWorldPosition(_a));
          if (p.behind) return;
          const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
          if (dist < bestDist) { bestDist = dist; best = info; }
        });
      }
      return best;
    }

    function pickModel() {
      const hits = raycaster.intersectObjects(models, true);
      for (const item of hits) {
        let obj = item.object;
        while (obj && !obj.userData.selectable) obj = obj.parent;
        if (obj) return obj;
      }
      return null;
    }

    function cameraPlane(origin) {
      camera.getWorldDirection(_b);
      return _plane.setFromNormalAndCoplanarPoint(_b, origin).clone();
    }

    function snapshotMembers(list) {
      return list.map((model) => ({
        model,
        kind: model.userData.kind,
        startPos: model.position.clone(),
        startQuat: model.quaternion.clone(),
        startSize: { ...model.userData.size },
        startSolid: model.userData.solid ? cloneSolid(model.userData.solid) : null,
      }));
    }

    function worldPoseArrays(model) {
      model.updateMatrixWorld(true);
      model.getWorldPosition(_a);
      model.getWorldQuaternion(_q);
      const eul = new THREE.Euler().setFromQuaternion(_q, model.rotation.order);
      return {
        position: [_a.x, _a.y, _a.z],
        rotation: [eul.x, eul.y, eul.z],
      };
    }

    function memberChange(entry) {
      const size = entry.model.userData.size;
      const pose = worldPoseArrays(entry.model);
      const change = {
        kind: entry.kind,
        position: pose.position,
        rotation: pose.rotation,
        size: { x: size.x, y: size.y, z: size.z },
      };
      if (entry.model.userData.solid) change.solid = cloneSolid(entry.model.userData.solid);
      return change;
    }

    function attachedCameraChanges(parents) {
      const hostIds = new Set((parents || []).map((model) => model.userData.kind).filter(Boolean));
      if (!hostIds.size) return [];
      const changes = [];
      for (const model of models) {
        if (model.userData.shape !== 'camera') continue;
        if (!hostIds.has(model.userData.parentId)) continue;
        const size = model.userData.size || { x: 1, y: 1, z: 1 };
        const pose = worldPoseArrays(model);
        changes.push({
          kind: model.userData.kind,
          position: pose.position,
          rotation: pose.rotation,
          size: { x: size.x, y: size.y, z: size.z },
        });
      }
      return changes;
    }

    function hostPart(model) {
      const parentId = model?.userData?.parentId;
      if (!parentId || String(parentId).startsWith('folder-')) return null;
      return models.find((item) => item.userData.kind === parentId) || null;
    }

    // Cameras parented under a Part stay glued to that Part via the scene graph.
    function syncCameraRig(model) {
      if (!model || model.userData.shape !== 'camera') return;
      const host = hostPart(model);
      if (!host) {
        if (model.parent !== place) place.attach(model);
        return;
      }
      if (model.parent !== host) host.attach(model);
    }

    function syncAllCameraRigs() {
      for (const model of models) syncCameraRig(model);
    }

    function extentAlongWorldNormal(model, worldNormal) {
      model.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const localN = worldNormal.clone().transformDirection(inv).normalize();
      const s = model.userData.size || { x: 1, y: 1, z: 1 };
      return Math.abs(localN.x) * s.x * 0.5
        + Math.abs(localN.y) * s.y * 0.5
        + Math.abs(localN.z) * s.z * 0.5;
    }

    /**
     * Snap a part center so its min corner on each snapped axis lands on the stud grid.
     * Keeps created parts lined up with the baseplate squares while moving.
     */
    function snapCenterToGrid(center, size, studs, mask = { x: true, y: true, z: true }) {
      const out = center.clone();
      if (!(studs > 0)) return out;
      if (mask.x) {
        const half = (size?.x || 0) * 0.5;
        out.x = Math.round((out.x - half) / studs) * studs + half;
      }
      if (mask.y) {
        const half = (size?.y || 0) * 0.5;
        out.y = Math.round((out.y - half) / studs) * studs + half;
      }
      if (mask.z) {
        const half = (size?.z || 0) * 0.5;
        out.z = Math.round((out.z - half) / studs) * studs + half;
      }
      return out;
    }

    function snapOnSurface(point, normal, size, studs) {
      const n = normal.clone().normalize();
      // Horizontal-ish: snap footprint XZ. Vertical: snap the two in-plane world axes.
      const mask = {
        x: Math.abs(n.x) < 0.5,
        y: Math.abs(n.y) < 0.5,
        z: Math.abs(n.z) < 0.5,
      };
      // Treat the contact point as the part center projected onto the plane (center - n*extent).
      // Snapping that contact via footprint, then the caller adds n*extent back.
      const extent = Math.abs(n.x) * (size?.x || 0) * 0.5
        + Math.abs(n.y) * (size?.y || 0) * 0.5
        + Math.abs(n.z) * (size?.z || 0) * 0.5;
      const centerGuess = point.clone().addScaledVector(n, extent);
      const snappedCenter = snapCenterToGrid(centerGuess, size, studs, mask);
      return snappedCenter.addScaledVector(n, -extent);
    }

    /** Raycast other parts/baseplate; fall back to a ground plane under the cursor. */
    function pickSurfaceTarget(excludeKinds, fallbackY = 0) {
      const hits = raycaster.intersectObjects(models, true);
      for (const hit of hits) {
        let obj = hit.object;
        while (obj && !obj.userData.selectable) obj = obj.parent;
        if (!obj || excludeKinds.has(obj.userData.kind)) continue;
        let normal = new THREE.Vector3(0, 1, 0);
        if (hit.face) {
          normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        }
        if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
        return { model: obj, point: hit.point.clone(), normal };
      }
      const plane = _plane.set(new THREE.Vector3(0, 1, 0), -fallbackY);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return null;
      return { model: null, point, normal: new THREE.Vector3(0, 1, 0) };
    }

    function beginSurfaceDrag(model, e) {
      if (!selection.includes(model)) applySelection(model.userData.kind);
      const members = activeSelection();
      if (!members.length) return;
      if (members.some((item) => isLocked(item.userData.kind))) return;
      const primary = members.includes(model) ? model : members[members.length - 1];
      setPointer(e);
      drag = {
        mode: 'surface',
        primary,
        members: snapshotMembers(members),
        exclude: new Set(members.map((item) => item.userData.kind)),
        pointerId: e.pointerId,
        fallbackY: primary.position.y - extentAlongWorldNormal(primary, new THREE.Vector3(0, 1, 0)),
      };
      paintHandles(null);
      root.style.cursor = 'grabbing';
      hideHint();
      updateToolDrag(e);
    }

    function beginToolDrag(info, e) {
      const members = activeSelection();
      if (!members.length) return;
      if (members.some((model) => isLocked(model.userData.kind))) return;
      const pivot = selected && members.includes(selected) ? selected : members[members.length - 1];
      if (!selectionBounds(members)) return;
      groupBox.getCenter(groupCenter);
      groupBox.getSize(groupSize);
      const origin = groupCenter.clone();
      const axisDir = members.length === 1
        ? axisWorld(pivot, info.axis, _b).clone()
        : localAxis(info.axis, _b).clone();
      const plane = info.mode === 'rotate'
        ? _plane.setFromNormalAndCoplanarPoint(axisDir, origin).clone()
        : cameraPlane(origin);
      setPointer(e);
      const startHit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!startHit) return;
      drag = {
        ...info,
        plane,
        axisDir,
        origin,
        startHit: startHit.clone(),
        members: snapshotMembers(members),
        startSpan: {
          x: Math.max(0.2, groupSize.x),
          y: Math.max(0.2, groupSize.y),
          z: Math.max(0.2, groupSize.z),
        },
        pointerId: e.pointerId,
      };
      paintHandles(drag);
      root.style.cursor = 'grabbing';
    }

    function updateToolDrag(e) {
      setPointer(e);
      if (!drag?.members?.length) return;
      if (drag.mode === 'surface') {
        const hit = pickSurfaceTarget(drag.exclude, drag.fallbackY);
        if (!hit) return;
        let point = hit.point;
        const normal = hit.normal.clone().normalize();
        const primaryEntry = drag.members.find((entry) => entry.model === drag.primary) || drag.members[0];
        const size = drag.primary.userData.size;
        if (snap.move && snap.moveStuds > 0) point = snapOnSurface(point, normal, size, snap.moveStuds);
        const extent = extentAlongWorldNormal(drag.primary, normal);
        const target = point.clone().addScaledVector(normal, extent + 0.001);
        const delta = target.sub(primaryEntry.startPos);
        for (const entry of drag.members) {
          entry.model.position.copy(entry.startPos).add(delta);
        }
        const label = hit.model ? (hit.model.name || 'Part') : 'Ground';
        showReadout(label, e.clientX, e.clientY);
        syncTools();
        publishLive();
        return;
      }
      let point = raycaster.ray.intersectPlane(drag.plane, _c);
      if (!point && drag.mode === 'rotate') point = raycaster.ray.intersectPlane(cameraPlane(drag.origin), _c);
      if (!point) return;
      if (drag.mode === 'move') {
        let delta = point.clone().sub(drag.startHit).dot(drag.axisDir);
        if (snap.move && snap.moveStuds > 0) {
          // Snap the primary part's min face along the move axis so footprints stay on-grid.
          const primaryEntry = drag.members.find((entry) => entry.model === selected)
            || drag.members[drag.members.length - 1];
          const extent = extentAlongWorldNormal(primaryEntry.model, drag.axisDir);
          const startAlong = primaryEntry.startPos.dot(drag.axisDir);
          const corner = startAlong + delta - extent;
          const snappedCorner = Math.round(corner / snap.moveStuds) * snap.moveStuds;
          delta = (snappedCorner + extent) - startAlong;
        }
        for (const entry of drag.members) {
          entry.model.position.copy(entry.startPos).addScaledVector(drag.axisDir, delta);
        }
        showReadout(`${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, e.clientX, e.clientY);
      } else if (drag.mode === 'rotate') {
        const flatten = (p, out) => {
          out.copy(p).sub(drag.origin);
          return out.addScaledVector(drag.axisDir, -out.dot(drag.axisDir));
        };
        const start = flatten(drag.startHit, new THREE.Vector3());
        const current = flatten(point, new THREE.Vector3());
        if (start.lengthSq() < 1e-8 || current.lengthSq() < 1e-8) return;
        let angle = Math.atan2(start.clone().cross(current).dot(drag.axisDir), start.dot(current));
        if (snap.rotate && snap.rotateDegrees > 0) {
          const step = THREE.MathUtils.degToRad(snap.rotateDegrees);
          angle = Math.round(angle / step) * step;
        }
        const rot = _q.setFromAxisAngle(drag.axisDir, angle);
        for (const entry of drag.members) {
          const offset = entry.startPos.clone().sub(drag.origin).applyQuaternion(rot);
          entry.model.position.copy(drag.origin).add(offset);
          entry.model.quaternion.copy(rot).multiply(entry.startQuat);
        }
        const degrees = Math.round(THREE.MathUtils.radToDeg(angle));
        showReadout(`${degrees}°`, e.clientX, e.clientY);
      } else {
        const key = drag.axis === 0 ? 'x' : drag.axis === 1 ? 'y' : 'z';
        const delta = point.clone().sub(drag.startHit).dot(drag.axisDir);
        const growth = delta * drag.sign;
        const nextSpan = Math.max(0.2, drag.startSpan[key] + growth);
        const factor = nextSpan / drag.startSpan[key];
        const pivotAlong = drag.origin[key] - drag.sign * drag.startSpan[key] / 2;
        for (const entry of drag.members) {
          const size = {
            x: Math.max(0.2, entry.startSize.x * (key === 'x' ? factor : 1)),
            y: Math.max(0.2, entry.startSize.y * (key === 'y' ? factor : 1)),
            z: Math.max(0.2, entry.startSize.z * (key === 'z' ? factor : 1)),
          };
          setPartSize(entry.model, size.x, size.y, size.z, entry.startSolid);
          const next = entry.startPos.clone();
          next[key] = pivotAlong + (entry.startPos[key] - pivotAlong) * factor;
          entry.model.position.copy(next);
        }
        showReadout(nextSpan.toFixed(2), e.clientX, e.clientY);
      }
      syncTools();
      publishLive();
    }

    let liveAt = 0;
    function publishLive() {
      if (!drag?.members?.length) return;
      const now = performance.now();
      if (now - liveAt < 50) return;
      liveAt = now;
      const parents = drag.members.map((entry) => entry.model);
      api.bus.emit('project:live', {
        changes: [
          ...drag.members.map(memberChange),
          ...attachedCameraChanges(parents),
        ],
      });
    }

    function finishToolDrag() {
      if (!drag?.members?.length) {
        drag = null;
        hideReadout();
        paintHandles(null);
        root.style.cursor = 'default';
        return;
      }
      const moved = drag.members.some((entry) => {
        const size = entry.model.userData.size;
        return entry.model.position.distanceTo(entry.startPos) > 1e-4
          || entry.model.quaternion.angleTo(entry.startQuat) > 1e-4
          || Math.abs(size.x - entry.startSize.x) > 1e-4
          || Math.abs(size.y - entry.startSize.y) > 1e-4
          || Math.abs(size.z - entry.startSize.z) > 1e-4;
      });
      if (moved) {
        const parents = drag.members.map((entry) => entry.model);
        const changes = [
          ...drag.members.map(memberChange),
          ...attachedCameraChanges(parents),
        ];
        api.bus.emit('project:change', { changes });
      } else api.bus.emit('project:preview-end');
      drag = null;
      hideReadout();
      paintHandles(null);
      root.style.cursor = 'default';
    }

    function updateHover(e) {
      if (!selected && tool === 'select') hoverBox.visible = false;
      setPointer(e);
      const handle = pickHandle(e);
      paintHandles(handle);
      root.style.cursor = handle ? 'grab' : 'default';
      if (handle || drag) {
        hoverBox.visible = false;
        return;
      }
      const model = pickModel();
      if (model && !selection.includes(model)) placeOutline(hoverBox, model);
      else hoverBox.visible = false;
    }

    function aimForward(out) {
      const cp = Math.cos(pitch);
      return out.set(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
    }

    function applyOrbit() {
      aimForward(forward);
      camera.position.copy(target).addScaledVector(forward, -distance);
      camera.lookAt(target);
      camera.up.set(0, 1, 0);
    }

    function resetView() {
      yaw = Math.PI / 4;
      pitch = -0.58;
      distance = 30;
      target.set(0, 0.6, 0);
      for (const k of Object.keys(keys)) keys[k] = false;
      draggingLook = false;
      draggingPan = false;
      applyOrbit();
      saveCamera();
    }

    const CAM_KEY = 'gw-camera';
    function saveCamera() {
      if (isLive()) return;
      try {
        const raw = JSON.stringify({
          yaw,
          pitch,
          distance,
          target: [target.x, target.y, target.z],
        });
        sessionStorage.setItem(CAM_KEY, raw);
        localStorage.setItem(CAM_KEY, raw);
      } catch { /* private mode */ }
    }
    function restoreCamera() {
      try {
        const raw = JSON.parse(sessionStorage.getItem(CAM_KEY) || localStorage.getItem(CAM_KEY) || '');
        if (!raw || !Array.isArray(raw.target) || raw.target.length < 3) return false;
        const nextYaw = Number(raw.yaw);
        const nextPitch = Number(raw.pitch);
        const nextDist = Number(raw.distance);
        const nextTarget = raw.target.map(Number);
        if (![nextYaw, nextPitch, nextDist, ...nextTarget].every((n) => Number.isFinite(n))) return false;
        yaw = nextYaw;
        pitch = Math.max(-1.4, Math.min(1.4, nextPitch));
        distance = Math.min(1400, Math.max(2.5, nextDist));
        target.set(nextTarget[0], nextTarget[1], nextTarget[2]);
        applyOrbit();
        return true;
      } catch {
        return false;
      }
    }

    const keys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false, space: false };
    const keyCodes = new Set();
    let liveSpawnSeq = 1;
    let draggingLook = false;
    let rightClick = null;
    let rightMenu = null;
    let draggingPan = false;
    let hinted = false;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    function hideHint() {
      if (hinted) return;
      hinted = true;
      hint.style.opacity = '0';
    }

    let editCamBackup = null;
    let liveHoldDoc = null;
    let flashTimer = 0;
    let presenceRaw = [];
    let presence = [];

    // S&box-style rigidbodies for Live Mode:
    // - Statics: exact primitives, or triangle mesh for edited solids (PhysicsMesh).
    // - Dynamics: convex primitives / surface sphere compounds (PhysicsHull-like),
    //   because cannon-es only resolves Trimesh contacts against Sphere/Plane.
    let physWorld = null;
    const physBodies = new Map();
    const physMat = new CANNON.Material('part');
    const physContact = new CANNON.ContactMaterial(physMat, physMat, {
      friction: 0.55,
      restitution: 0.02,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 3,
    });

    function autoMass(model) {
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      const volume = Math.max(0.01, Math.abs(size.x * size.y * size.z));
      return Math.max(0.05, volume * 0.08);
    }

    function boxHalfFromModel(model) {
      const size = model?.userData?.size || { x: 1, y: 1, z: 1 };
      return new CANNON.Vec3(
        Math.max(0.05, Math.abs(size.x) / 2),
        Math.max(0.05, Math.abs(size.y) / 2),
        Math.max(0.05, Math.abs(size.z) / 2),
      );
    }

    function solidToTrimesh(solid) {
      if (!solid?.vertices?.length || !solid?.faces?.length) return null;
      const { positions } = solidToGeometry(solid);
      const vertCount = (positions?.length || 0) / 3;
      // Int16 indices in cannon-es Trimesh overflow past 32767.
      if (vertCount < 3 || vertCount > 32000) return null;
      const indices = new Array(vertCount);
      for (let i = 0; i < vertCount; i++) indices[i] = i;
      try {
        return new CANNON.Trimesh(positions, indices);
      } catch {
        return null;
      }
    }

    function collisionCenterOffset(model) {
      const c = model?.userData?.solidCenter;
      if (!c) return null;
      if (Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6 && Math.abs(c.z) < 1e-6) return null;
      return new CANNON.Vec3(c.x, c.y, c.z);
    }

    function solidHasHoles(solid) {
      return !!solid?.faces?.some((face) => face.holes?.length);
    }

    /** Convex hull collider from a hole-free solid (S&box PhysicsHull). */
    function solidToConvex(solid) {
      if (!solid?.vertices?.length || !solid?.faces?.length || solidHasHoles(solid)) return null;
      const vertices = solid.vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2]));
      const faces = [];
      for (const face of solid.faces) {
        if (!face?.verts || face.verts.length < 3) continue;
        if (face.wallOf && face.verts.length === 4) {
          faces.push([face.verts[0], face.verts[1], face.verts[2]]);
          faces.push([face.verts[0], face.verts[2], face.verts[3]]);
          continue;
        }
        for (let i = 1; i < face.verts.length - 1; i++) {
          faces.push([face.verts[0], face.verts[i], face.verts[i + 1]]);
        }
      }
      if (faces.length < 4) return null;
      try {
        return new CANNON.ConvexPolyhedron({ vertices, faces });
      } catch {
        return null;
      }
    }

    /** Exact primitive collider matching the part shape (S&box PhysicsShape*). */
    function primitiveShapeForModel(model) {
      const shape = model?.userData?.shape || 'block';
      const half = boxHalfFromModel(model);
      const origin = collisionCenterOffset(model);
      if (shape === 'sphere') {
        const r = Math.max(half.x, half.y, half.z);
        return { shape: new CANNON.Sphere(r), offset: origin };
      }
      if (shape === 'cylinder') {
        // Cannon Cylinder is Y-up with radius at XZ and height along Y.
        const radius = Math.max(half.x, half.z);
        return {
          shape: new CANNON.Cylinder(radius, radius, Math.max(0.1, half.y * 2), 16),
          offset: origin,
        };
      }
      // Wedge/corner without an authored solid approximate as a box; solids use convex/mesh paths.
      return { shape: new CANNON.Box(half), offset: origin };
    }

    /**
     * Surface-fitted sphere compound (S&box-like hull fidelity under cannon limits).
     * Samples solid vertices, edge midpoints, and face centroids so contacts
     * follow the real mesh instead of a coarse AABB blob.
     */
    function fillSurfaceSpheres(body, model, solid) {
      const half = boxHalfFromModel(model);
      const origin = collisionCenterOffset(model) || new CANNON.Vec3(0, 0, 0);
      const samples = [];
      const pushSample = (x, y, z) => {
        samples.push([x, y, z]);
      };

      if (solid?.vertices?.length) {
        for (const v of solid.vertices) pushSample(v[0], v[1], v[2]);
        for (const face of solid.faces || []) {
          if (!face?.verts?.length) continue;
          let cx = 0;
          let cy = 0;
          let cz = 0;
          for (const index of face.verts) {
            const v = solid.vertices[index];
            cx += v[0];
            cy += v[1];
            cz += v[2];
          }
          const n = face.verts.length;
          pushSample(cx / n, cy / n, cz / n);
          for (let i = 0; i < face.verts.length; i++) {
            const a = solid.vertices[face.verts[i]];
            const b = solid.vertices[face.verts[(i + 1) % face.verts.length]];
            pushSample((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
          }
        }
      } else {
        // Primitive: face centers + edge midpoints + corners of the AABB.
        const hx = half.x;
        const hy = half.y;
        const hz = half.z;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) pushSample(sx * hx, sy * hy, sz * hz);
          }
        }
        for (const sx of [-1, 0, 1]) {
          for (const sy of [-1, 0, 1]) {
            for (const sz of [-1, 0, 1]) {
              if (sx === 0 && sy === 0 && sz === 0) continue;
              const count = (sx ? 1 : 0) + (sy ? 1 : 0) + (sz ? 1 : 0);
              if (count === 1 || count === 2) pushSample(sx * hx, sy * hy, sz * hz);
            }
          }
        }
      }

      // Weld duplicates, then pick a sphere radius from local spacing.
      const welded = [];
      const weld = Math.max(0.04, Math.min(half.x, half.y, half.z) * 0.18);
      for (const p of samples) {
        if (welded.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= weld)) continue;
        welded.push(p);
      }
      let rad = Math.max(0.06, Math.min(0.35, weld * 0.85));
      // Character-sized parts: prefer a vertical capsule stack for stable walking.
      const isPawnLike = (model.userData.size?.y || 1) >= (model.userData.size?.x || 1) * 0.9
        && (model.userData.size?.y || 1) >= (model.userData.size?.z || 1) * 0.9
        && !solid;
      if (isPawnLike) {
        const radius = Math.max(0.15, Math.min(half.x, half.z) * 0.92);
        const top = half.y - radius;
        const bot = -half.y + radius;
        const span = Math.max(0, top - bot);
        const steps = Math.max(1, Math.ceil(span / (radius * 0.85)));
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 0.5 : i / steps;
          const y = bot + (top - bot) * t;
          body.addShape(
            new CANNON.Sphere(radius),
            new CANNON.Vec3(origin.x, origin.y + y, origin.z),
          );
        }
        body.userData = { ...(body.userData || {}), sphereCapsule: true };
        return;
      }

      const maxSpheres = 160;
      let list = welded;
      if (list.length > maxSpheres) {
        const step = Math.ceil(list.length / maxSpheres);
        list = list.filter((_, i) => i % step === 0);
        rad = Math.max(rad, weld * 1.05);
      }
      for (const p of list) {
        body.addShape(
          new CANNON.Sphere(rad),
          new CANNON.Vec3(origin.x + p[0], origin.y + p[1], origin.z + p[2]),
        );
      }
      body.userData = { ...(body.userData || {}), surfaceSpheres: true, sphereCount: list.length };
    }

    function attachCollisionShapes(body, model) {
      const solid = model?.userData?.solid;
      const dynamic = body.mass > 0 || body.type === CANNON.Body.DYNAMIC;
      const shapeName = model?.userData?.shape || 'block';

      // Static sketch meshes → triangle mesh (S&box PhysicsMesh). Keeps holes walkable.
      if (!dynamic && solid?.vertices?.length && solid?.faces?.length) {
        const mesh = solidToTrimesh(solid);
        if (mesh) {
          body.addShape(mesh);
          body.userData = { ...(body.userData || {}), meshCollider: true };
          return;
        }
      }

      // Static primitives / hole-free solids → exact Box / Sphere / Cylinder / convex hull.
      if (!dynamic) {
        if (solid && !solidHasHoles(solid)) {
          const convex = solidToConvex(solid);
          if (convex) {
            body.addShape(convex);
            body.userData = { ...(body.userData || {}), convexCollider: true };
            return;
          }
        }
        const prim = primitiveShapeForModel(model);
        body.addShape(prim.shape, prim.offset || undefined);
        body.userData = { ...(body.userData || {}), primitiveCollider: shapeName };
        return;
      }

      // Dynamics use surface sphere compounds so they collide with mesh colliders
      // (cannon-es Trimesh only contacts Sphere/Plane — same constraint as before,
      // but samples follow the real mesh like an S&box hull approximation).
      fillSurfaceSpheres(body, model, solid);
    }

    function releaseRemoteCollider(avatar) {
      const body = avatar?.userData?.physBody;
      if (!body) return;
      if (physWorld) {
        try { physWorld.removeBody(body); } catch { /* already removed */ }
      }
      avatar.userData.physBody = null;
    }

    function ensureRemoteCollider(avatar, template) {
      if (!physWorld || !avatar?.userData?.isCharacter) return;
      const cfg = template?.userData?.physics || {};
      if (cfg.canCollide === false) {
        releaseRemoteCollider(avatar);
        return;
      }
      if (avatar.userData.physBody) return;
      const body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        material: physMat,
      });
      body.userData = { remoteAvatar: true, gravityScale: 0 };
      attachCollisionShapes(body, template);
      body.position.set(avatar.position.x, avatar.position.y, avatar.position.z);
      body.quaternion.set(avatar.quaternion.x, avatar.quaternion.y, avatar.quaternion.z, avatar.quaternion.w);
      body.updateAABB();
      physWorld.addBody(body);
      avatar.userData.physBody = body;
    }

    function syncRemoteColliders() {
      if (!physWorld) return;
      for (const avatar of avatars.values()) {
        const body = avatar.userData.physBody;
        if (!body) continue;
        // Drive colliders from the networked goal so hits track the remote pawn, not the visual lerp lag.
        const goal = avatar.userData.goal || avatar.position;
        body.position.set(goal.x, goal.y, goal.z);
        body.quaternion.set(avatar.quaternion.x, avatar.quaternion.y, avatar.quaternion.z, avatar.quaternion.w);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        body.aabbNeedsUpdate = true;
        body.updateAABB();
      }
    }

    function stopPhysics() {
      if (!physWorld) return;
      for (const avatar of avatars.values()) releaseRemoteCollider(avatar);
      for (const body of physBodies.values()) physWorld.removeBody(body);
      physBodies.clear();
      physWorld = null;
    }

    function startPhysics() {
      stopPhysics();
      physWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -60, 0) });
      physWorld.allowSleep = true;
      physWorld.defaultContactMaterial = physContact;
      physWorld.addContactMaterial(physContact);
      if (physWorld.solver) {
        physWorld.solver.iterations = 16;
        physWorld.solver.tolerance = 0.0005;
      }
      physWorld.quatNormalizeSkip = 0;
      physWorld.quatNormalizeFast = false;
      // Live pawn needs a dynamic body so character motion collides with static Parts.
      const pawnKind = findPlayCharacter()?.host?.userData?.kind || null;
      for (const model of models) {
        const kind = model.userData.kind;
        if (kind === 'baseplate') {
          const body = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            material: physMat,
            shape: new CANNON.Box(boxHalfFromModel(model)),
          });
          body.position.set(model.position.x, model.position.y, model.position.z);
          body.quaternion.set(model.quaternion.x, model.quaternion.y, model.quaternion.z, model.quaternion.w);
          body.updateAABB();
          physWorld.addBody(body);
          physBodies.set(kind, body);
          continue;
        }
        if (model.userData.shape === 'camera' || model.userData.shape === 'script') continue;
        const cfg = model.userData.physics || {};
        // Can Collide defaults on — only skip when explicitly disabled.
        if (cfg.canCollide === false) continue;
        const motion = !!cfg.enabled;
        const isPawn = pawnKind && kind === pawnKind;
        if (!motion && !isPawn) {
          const body = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            material: physMat,
          });
          body.userData = { gravityScale: 0, anchored: true };
          attachCollisionShapes(body, model);
          body.position.set(model.position.x, model.position.y, model.position.z);
          body.quaternion.set(model.quaternion.x, model.quaternion.y, model.quaternion.z, model.quaternion.w);
          body.updateAABB();
          physWorld.addBody(body);
          physBodies.set(kind, body);
          continue;
        }
        const massOverride = Number(cfg.massOverride);
        const mass = Number.isFinite(massOverride) && massOverride > 0 ? massOverride : autoMass(model);
        const body = new CANNON.Body({
          mass,
          material: physMat,
          linearDamping: Number.isFinite(cfg.linearDamping) ? cfg.linearDamping : 0,
          angularDamping: Number.isFinite(cfg.angularDamping) ? cfg.angularDamping : 0.05,
          allowSleep: true,
        });
        // cannon-es has no native gravityScale; approximate via force each step.
        // Character pawn without Motion Enabled stays dynamic for wall hits but skips gravity.
        const gravityOn = motion && cfg.gravity !== false;
        body.userData = {
          gravityScale: gravityOn
            ? (Number.isFinite(cfg.gravityScale) ? cfg.gravityScale : 1)
            : 0,
        };
        attachCollisionShapes(body, model);
        body.position.set(model.position.x, model.position.y, model.position.z);
        body.quaternion.set(model.quaternion.x, model.quaternion.y, model.quaternion.z, model.quaternion.w);
        body.updateAABB();
        if (cfg.startAsleep && motion) body.sleep();
        physWorld.addBody(body);
        physBodies.set(kind, body);
      }
      // Remotes that already exist need colliders once the world is up.
      const template = findPlayCharacter()?.host;
      if (template) {
        for (const avatar of avatars.values()) ensureRemoteCollider(avatar, template);
      }
    }

    function stepPhysics(dt) {
      if (!physWorld || playMode !== 'live') return;
      for (const body of physBodies.values()) {
        if (!body.mass) continue;
        const scale = body.userData?.gravityScale;
        if (scale == null || scale === 1) continue;
        // Cancel default gravity then apply scaled gravity (world -60 on Y).
        body.force.y += body.mass * 60 * (1 - scale);
      }
      physWorld.step(1 / 60, Math.min(0.05, dt), 6);
      for (const [kind, body] of physBodies) {
        if (!body.mass) continue;
        const model = models.find((item) => item.userData.kind === kind);
        if (!model) continue;
        model.position.set(body.position.x, body.position.y, body.position.z);
        model.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    }

    function flashHint(text) {
      if (flashTimer) clearTimeout(flashTimer);
      hint.textContent = text;
      hint.style.opacity = '1';
      hinted = false;
      flashTimer = setTimeout(() => {
        flashTimer = 0;
        hideHint();
      }, 3200);
    }

    function applyPresenceFilter() {
      const wanted = playMode === 'live' ? 'live' : 'edit';
      presence = presenceRaw.filter((person) => (person?.mode === 'live' ? 'live' : 'edit') === wanted);
    }

    function findPlayCamera() {
      const cams = models.filter((model) => model.userData.shape === 'camera' || /^camera\b/i.test(model.name || ''));
      if (!cams.length) return null;
      return cams.find((model) => (model.name || '').toLowerCase() === 'camera') || cams[0];
    }

    function cameraModeOf(model) {
      const mode = model?.userData?.camera?.mode;
      if (mode === 'thirdPerson' || mode === 'topDown' || mode === 'firstPerson') return mode;
      return 'firstPerson';
    }

    function liveCameraInfo() {
      const camPart = findPlayCamera();
      if (!camPart) return null;
      const host = hostPart(camPart);
      return { camPart, host, subject: host || camPart, mode: cameraModeOf(camPart) };
    }

    // Live Mode character = Part that parents the play Camera (scripts will own movement later).
    function findPlayCharacter() {
      const cam = findPlayCamera();
      if (!cam) return null;
      const host = hostPart(cam);
      if (!host || host.userData.kind === 'baseplate') return null;
      if (host.userData.shape === 'camera' || host.userData.shape === 'script') return null;
      return { host, camera: cam };
    }

    function findModelById(id) {
      if (!id) return null;
      return models.find((item) => item.userData.kind === id) || null;
    }

    function syncPhysTransform(model) {
      if (!model) return;
      const body = physBodies.get(model.userData.kind);
      if (!body) return;
      body.position.set(model.position.x, model.position.y, model.position.z);
      body.quaternion.set(model.quaternion.x, model.quaternion.y, model.quaternion.z, model.quaternion.w);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.wakeUp?.();
    }

    function scriptRecord(model) {
      if (!model) return null;
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      return {
        name: model.name || model.userData.kind,
        shape: model.userData.shape || (model.userData.kind === 'baseplate' ? 'baseplate' : 'block'),
        parent: model.userData.parentId || null,
        position: { x: model.position.x, y: model.position.y, z: model.position.z },
        rotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z },
        width: size.x,
        height: size.y,
        depth: size.z,
        color: model.userData.color || defaultColor(model.userData.kind),
        physics: model.userData.physics || null,
        script: model.userData.script || null,
      };
    }

    function scriptChildren(parentId) {
      const out = [];
      for (const model of models) {
        const pid = model.userData.parentId || null;
        if (parentId == null || parentId === '' || parentId === 'workspace') {
          if (!pid || String(pid).startsWith('folder-')) out.push(model.userData.kind);
        } else if (pid === parentId) {
          out.push(model.userData.kind);
        }
      }
      return out;
    }

    function scriptDescendants(parentId) {
      const kids = scriptChildren(parentId);
      const out = [...kids];
      for (const id of kids) out.push(...scriptDescendants(id));
      return out;
    }

    function scriptFindChild(parentId, name) {
      const want = String(name || '');
      for (const id of scriptChildren(parentId)) {
        const model = findModelById(id);
        if (model && model.name === want) return id;
      }
      return null;
    }

    function scriptSetProp(id, key, value) {
      if (!isLive()) return;
      const model = findModelById(id);
      if (!model || model.userData.kind === 'baseplate') return;
      if (key === 'Name') {
        model.name = String(value || 'Part');
        return;
      }
      if (key === 'Parent') {
        const parentId = value ? String(value) : null;
        model.userData.parentId = parentId;
        if (model.userData.shape === 'camera') syncCameraRig(model);
        else if (parentId) {
          const host = findModelById(parentId);
          if (host) host.attach(model);
          else place.attach(model);
        } else {
          place.attach(model);
        }
        return;
      }
      if (key === 'Position' && value && typeof value === 'object') {
        const x = Number(value.x ?? value.X) || 0;
        const y = Number(value.y ?? value.Y) || 0;
        const z = Number(value.z ?? value.Z) || 0;
        model.position.set(x, y, z);
        syncPhysTransform(model);
        return;
      }
      if (key === 'Orientation' && value && typeof value === 'object') {
        const x = Number(value.x ?? value.X) || 0;
        const y = Number(value.y ?? value.Y) || 0;
        const z = Number(value.z ?? value.Z) || 0;
        model.rotation.set(x, y, z);
        syncPhysTransform(model);
        return;
      }
      if (key === 'CFrame' && value && typeof value === 'object') {
        const x = Number(value.x ?? value.X) || 0;
        const y = Number(value.y ?? value.Y) || 0;
        const z = Number(value.z ?? value.Z) || 0;
        const rx = Number(value.rx ?? value.RX) || 0;
        const ry = Number(value.ry ?? value.RY) || 0;
        const rz = Number(value.rz ?? value.RZ) || 0;
        model.position.set(x, y, z);
        model.rotation.set(rx, ry, rz);
        syncPhysTransform(model);
        return;
      }
      if (key === 'Size' && value && typeof value === 'object') {
        setPartSize(
          model,
          Number(value.x ?? value.X) || 1,
          Number(value.y ?? value.Y) || 1,
          Number(value.z ?? value.Z) || 1,
        );
        return;
      }
      if (key === 'Color' && typeof value === 'string') {
        applyColor(model, model.userData.kind, value);
        return;
      }
      if (key === 'Anchored') {
        const phys = model.userData.physics && typeof model.userData.physics === 'object'
          ? { ...model.userData.physics }
          : { canCollide: true, enabled: false };
        phys.enabled = !value;
        model.userData.physics = phys;
        const body = physBodies.get(id);
        if (body) {
          body.type = value ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
          body.mass = value ? 0 : (Number(phys.massOverride) > 0 ? phys.massOverride : autoMass(model));
          body.updateMassProperties();
          syncPhysTransform(model);
        }
        return;
      }
      if (key === 'CanCollide') {
        const phys = model.userData.physics && typeof model.userData.physics === 'object'
          ? { ...model.userData.physics }
          : { canCollide: true, enabled: false };
        phys.canCollide = !!value;
        model.userData.physics = phys;
        const body = physBodies.get(id);
        if (body) body.collisionFilterMask = value ? -1 : 0;
        return;
      }
      if (key === 'Enabled' && model.userData.shape === 'script') {
        const scr = model.userData.script && typeof model.userData.script === 'object'
          ? { ...model.userData.script }
          : { source: '', enabled: true };
        scr.enabled = !!value;
        model.userData.script = scr;
      }
    }

    function scriptInstanceNew(className) {
      if (!isLive()) return null;
      const kind = String(className || 'Part').toLowerCase();
      const id = `live-${liveSpawnSeq++}`;
      let shape = 'block';
      if (kind === 'camera') shape = 'camera';
      else if (kind === 'script') shape = 'script';
      else if (kind === 'part' || kind === 'block') shape = 'block';
      else if (kind === 'sphere') shape = 'sphere';
      else if (kind === 'cylinder') shape = 'cylinder';
      else if (kind === 'wedge') shape = 'wedge';
      const model = addUserPart({
        id,
        name: className || 'Part',
        shape,
        width: 4,
        height: shape === 'script' || shape === 'camera' ? 1 : 1,
        depth: 4,
        position: [0, 2, 0],
        rotation: [0, 0, 0],
        color: '#b1b2b5',
        script: shape === 'script' ? { source: '', enabled: true } : undefined,
        camera: shape === 'camera' ? { fieldOfView: 70, mode: 'firstPerson', turnParent: true } : undefined,
      });
      place.add(model);
      models.push(model);
      return id;
    }

    function scriptApplyImpulse(id, impulse) {
      if (!isLive() || !impulse) return;
      const body = physBodies.get(id);
      if (!body || body.type !== CANNON.Body.DYNAMIC) return;
      const x = Number(impulse.x ?? impulse.X) || 0;
      const y = Number(impulse.y ?? impulse.Y) || 0;
      const z = Number(impulse.z ?? impulse.Z) || 0;
      body.wakeUp?.();
      // cannon-es second arg is offset from COM, not a world point.
      body.applyImpulse(new CANNON.Vec3(x, y, z), new CANNON.Vec3(0, 0, 0));
    }

    function scriptSetVelocity(id, velocity) {
      if (!isLive() || !velocity) return;
      const body = physBodies.get(id);
      if (!body || body.type !== CANNON.Body.DYNAMIC) return;
      body.wakeUp?.();
      body.velocity.set(
        Number(velocity.x ?? velocity.X) || 0,
        Number(velocity.y ?? velocity.Y) || 0,
        Number(velocity.z ?? velocity.Z) || 0,
      );
    }

    function scriptGetVelocity(id) {
      const body = physBodies.get(id);
      if (!body) return { x: 0, y: 0, z: 0 };
      return { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z };
    }

    function scriptDestroy(id) {
      if (!isLive()) return;
      const model = findModelById(id);
      if (!model || model.userData.kind === 'baseplate') return;
      const body = physBodies.get(id);
      if (body && physWorld) {
        physWorld.removeBody(body);
        physBodies.delete(id);
      }
      for (const child of [...model.children]) {
        if (child.userData?.kind) place.attach(child);
      }
      const index = models.indexOf(model);
      if (index >= 0) models.splice(index, 1);
      model.removeFromParent();
      disposeObject(model);
    }

    function scriptClone(id) {
      if (!isLive()) return null;
      const model = findModelById(id);
      if (!model || model.userData.kind === 'baseplate') return null;
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      const nid = `live-${liveSpawnSeq++}`;
      const copy = addUserPart({
        id: nid,
        name: `${model.name || 'Part'} Clone`,
        shape: model.userData.shape || 'block',
        width: size.x,
        height: size.y,
        depth: size.z,
        position: [model.position.x + 2, model.position.y, model.position.z],
        rotation: [model.rotation.x, model.rotation.y, model.rotation.z],
        color: model.userData.color,
        physics: model.userData.physics ? { ...model.userData.physics } : undefined,
        script: model.userData.script ? { ...model.userData.script } : undefined,
        camera: model.userData.camera ? { ...model.userData.camera } : undefined,
        solid: model.userData.solid ? cloneSolid(model.userData.solid) : undefined,
        parent: model.userData.parentId || null,
      });
      place.add(copy);
      models.push(copy);
      if (copy.userData.shape === 'camera') syncCameraRig(copy);
      return nid;
    }

    const KEY_ALIASES = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e',
      Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift',
      w: 'w', a: 'a', s: 's', d: 'd', q: 'q', e: 'e', space: 'space', shift: 'shift',
    };

    function scriptCameraBasis() {
      aimForward(forward);
      // Horizontal right = yaw + 90° on XZ (matches Live look).
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      return {
        look: { x: forward.x, y: forward.y, z: forward.z },
        right: { x: rightX, y: 0, z: rightZ },
        up: { x: 0, y: 1, z: 0 },
      };
    }

    function scriptIsGrounded(id) {
      if (!isLive() || !physWorld) return false;
      const body = physBodies.get(id);
      const model = findModelById(id);
      if (!body || !model) return false;
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      const halfY = Math.max(0.1, (Number(size.y) || 1) / 2);
      const from = new CANNON.Vec3(body.position.x, body.position.y, body.position.z);
      const to = new CANNON.Vec3(body.position.x, body.position.y - halfY - 0.4, body.position.z);
      const result = new CANNON.RaycastResult();
      const ray = new CANNON.Ray(from, to);
      ray.intersectWorld(physWorld, {
        mode: CANNON.Ray.CLOSEST,
        result,
        skipBody: body,
        collisionFilterMask: -1,
      });
      if (!result.hasHit) return false;
      // Still rising hard after a jump — treat as airborne.
      if (body.velocity.y > 4) return false;
      return true;
    }

    window.__gwScriptApi = {
      listScripts() {
        return models
          .filter((model) => model.userData.shape === 'script')
          .map((model) => ({
            id: model.userData.kind,
            name: model.name || 'Script',
            source: model.userData.script?.source || '',
            enabled: model.userData.script?.enabled !== false,
          }));
      },
      getRecord: (id) => scriptRecord(findModelById(id)),
      getChildren: (id) => scriptChildren(id),
      getDescendants: (id) => scriptDescendants(id),
      findFirstChild: (id, name) => scriptFindChild(id, name),
      getCharacterId: () => findPlayCharacter()?.host?.userData?.kind || null,
      getCameraId: () => findPlayCamera()?.userData?.kind || null,
      getCameraBasis: () => scriptCameraBasis(),
      isGrounded: (id) => scriptIsGrounded(id),
      setProp: scriptSetProp,
      destroy: scriptDestroy,
      clone: scriptClone,
      instanceNew: scriptInstanceNew,
      applyImpulse: scriptApplyImpulse,
      setVelocity: scriptSetVelocity,
      getVelocity: scriptGetVelocity,
      isKeyDown(code) {
        const raw = String(code || '');
        if (keyCodes.has(raw)) return true;
        const alias = KEY_ALIASES[raw];
        if (alias && keys[alias]) return true;
        if (keys[raw]) return true;
        return false;
      },
    };

    function setHelperGizmosVisible(visible) {
      for (const model of models) {
        if (model.userData.shape === 'camera') model.visible = visible;
        else if (model.userData.shape === 'script') model.visible = false;
      }
    }

    function liveMoveConfig() {
      // Edit Mode freecam. Live Mode has no built-in movement — Scripts drive the pawn.
      if (!isLive()) return { allowed: true, speedScale: 1, pawn: null };
      const character = findPlayCharacter();
      if (character?.host) return { allowed: true, speedScale: 1, pawn: character.host };
      return { allowed: false, speedScale: 1, pawn: null };
    }

    function alignParentToView(host, camPart) {
      if (!host || !camPart) return;
      const cfg = camPart.userData.camera || {};
      if (cfg.turnParent === false) return;
      // Match horizontal look: aimForward XZ is (-sin(yaw), -cos(yaw)).
      host.rotation.x = 0;
      host.rotation.z = 0;
      host.rotation.y = yaw;
      const body = physBodies.get(host.userData.kind);
      if (body) {
        _q.setFromEuler(host.rotation);
        body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
        body.angularVelocity.set(0, 0, 0);
      }
    }

    function updateLiveCamera() {
      if (!isLive()) return;
      const info = liveCameraInfo();
      if (!info) return;
      const { camPart, host, subject, mode } = info;
      alignParentToView(host, camPart);
      subject.updateMatrixWorld(true);
      subject.getWorldPosition(_a);
      const size = subject.userData.size || { x: 2, y: 2, z: 2 };
      const cfg = camPart.userData.camera || {};
      const dist = Number.isFinite(cfg.distance) ? Math.max(2, cfg.distance) : 10;
      const configuredHeight = Number.isFinite(cfg.height) ? cfg.height : null;

      if (mode === 'topDown') {
        const height = configuredHeight != null ? Math.max(2, configuredHeight) : Math.max(24, size.y * 8 + 16);
        pitch = -1.45;
        target.set(_a.x, _a.y, _a.z);
        camera.position.set(
          _a.x + Math.sin(yaw) * 0.05,
          _a.y + height,
          _a.z + Math.cos(yaw) * 0.05,
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        distance = height;
        return;
      }

      if (mode === 'thirdPerson') {
        const height = configuredHeight != null ? configuredHeight : size.y * 0.35;
        distance = dist;
        target.set(_a.x, _a.y + height, _a.z);
        aimForward(forward);
        camera.position.copy(target).addScaledVector(forward, -distance);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        return;
      }

      // First person: eyes on the subject, look with yaw/pitch.
      const eye = configuredHeight != null ? configuredHeight : Math.max(0.4, size.y * 0.35);
      camera.position.set(_a.x, _a.y + eye, _a.z);
      distance = 8;
      aimForward(forward);
      target.copy(camera.position).addScaledVector(forward, distance);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
    }

    function yawPitchFromDir(dir) {
      const flat = Math.hypot(dir.x, dir.z) || 1e-6;
      yaw = Math.atan2(-dir.x, -dir.z);
      pitch = Math.atan2(dir.y, flat);
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }

    function enterLiveMode() {
      if (playMode === 'live') return false;
      const camPart = findPlayCamera();
      if (!camPart) {
        flashHint('Place a Camera in Edit Mode before entering Live Mode.');
        return false;
      }
      if (drag) finishToolDrag();
      if (sketch) {
        if (sketch.mode === 'pushpull' && sketch.base) applySolidMesh(sketch.model, sketch.base);
        sketch = null;
        clearSketchPreview();
      }
      pendingClick = null;
      hideReadout();
      paintHandles(null);
      applySelection(null);
      editCamBackup = {
        yaw,
        pitch,
        distance,
        target: target.clone(),
        position: camera.position.clone(),
      };
      liveHoldDoc = null;
      playMode = 'live';
      clearPresenceAvatars();
      applyPresenceFilter();
      setHelperGizmosVisible(false);
      camPart.updateMatrixWorld(true);
      camera.position.copy(camPart.getWorldPosition(_a));
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camPart.getWorldQuaternion(_q)).normalize();
      yawPitchFromDir(dir);
      distance = 8;
      target.copy(camera.position).addScaledVector(dir, distance);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      const fov = Number(camPart.userData.camera?.fieldOfView);
      camera.userData._editFov = camera.fov;
      camera.fov = Number.isFinite(fov) ? Math.max(1, Math.min(120, fov)) : 70;
      camera.updateProjectionMatrix();
      syncTools();
      try {
        startPhysics();
      } catch (err) {
        api.log(err);
        stopPhysics();
      }
      // Snapshot the edit document after physics starts so Live mutations stay local.
      api.bus.emit('mode:set', 'live');
      api.bus.emit('project:request');
      updateLiveCamera();
      const mode = cameraModeOf(camPart);
      const modeLabel = mode === 'thirdPerson' ? 'Third Person' : mode === 'topDown' ? 'Top Down' : 'First Person';
      flashHint(`Live Mode  ·  ${modeLabel}  ·  Physics on  ·  Right mouse look  ·  Movement via Scripts  ·  Stop returns to Edit Mode`);
      return true;
    }

    function exitLiveMode() {
      // Always publish Edit Mode, even when recovering from a half-finished Stop
      // (e.g. restore threw after playMode flipped and the toolbar stayed on Live).
      if (playMode !== 'live') {
        api.bus.emit('mode:set', 'edit');
        return false;
      }
      try {
        stopPhysics();
        playMode = 'edit';
        clearPresenceAvatars();
        applyPresenceFilter();
        setHelperGizmosVisible(true);
        if (Number.isFinite(camera.userData._editFov)) {
          camera.fov = camera.userData._editFov;
          delete camera.userData._editFov;
          camera.updateProjectionMatrix();
        }
        if (editCamBackup) {
          yaw = editCamBackup.yaw;
          pitch = editCamBackup.pitch;
          distance = editCamBackup.distance;
          target.copy(editCamBackup.target);
          camera.position.copy(editCamBackup.position);
          applyOrbit();
          editCamBackup = null;
        } else {
          applyOrbit();
        }
        const held = liveHoldDoc;
        liveHoldDoc = null;
        if (held) {
          try {
            if (!applyDoc(held)) buildPlace(held);
            publishScene();
            publishSelection();
          } catch (err) {
            api.log(err);
          }
        }
        syncTools();
      } finally {
        playMode = 'edit';
        api.bus.emit('mode:set', 'edit');
      }
      return true;
    }

    function resize() {
      const w = root.clientWidth || window.innerWidth;
      const h = root.clientHeight || window.innerHeight;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      post.resize(w, h);
    }

    function endDrag() {
      draggingLook = draggingPan = false;
    }

    const marquee = document.createElement('div');
    marquee.hidden = true;
    marquee.style.cssText = 'position:fixed;z-index:21;border:1px solid #6eb6ff;background:rgba(110,182,255,.16);pointer-events:none;';
    document.body.append(marquee);
    const showMarquee = (x0, y0, x1, y1) => {
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      marquee.hidden = false;
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${Math.abs(x1 - x0)}px`;
      marquee.style.height = `${Math.abs(y1 - y0)}px`;
    };
    const hideMarquee = () => { marquee.hidden = true; };

    function screenCenter(model) {
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return null;
      box.getCenter(_c).project(camera);
      if (_c.z < -1 || _c.z > 1) return null;
      const rect = root.getBoundingClientRect();
      return {
        x: (_c.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-_c.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    }

    function modelsInRect(x0, y0, x1, y1) {
      const pick = {
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        right: Math.max(x0, x1),
        bottom: Math.max(y0, y1),
      };
      return models.filter((model) => {
        if (isLocked(model.userData.kind)) return false;
        const point = screenCenter(model);
        return point && point.x >= pick.left && point.x <= pick.right && point.y >= pick.top && point.y <= pick.bottom;
      });
    }

    function frameSelection() {
      const list = selection.length ? selection : models;
      if (!list.length) return;
      const box = new THREE.Box3();
      for (const model of list) box.expandByObject(model);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() * 0.5, 1);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      distance = Math.min(1400, Math.max(2.5, (radius / Math.sin(fov / 2)) * 1.15));
      target.copy(box.getCenter(new THREE.Vector3()));
      applyOrbit();
      hideHint();
    }

    const DRAW_IDS = new Set(['pencil', 'line', 'rectangle', 'circle', 'pushpull', 'erase']);
    let sketch = null;
    const sketchLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1d7afc, toneMapped: false, depthTest: false }),
    );
    sketchLine.frustumCulled = false;
    sketchLine.renderOrder = 950;
    sketchLine.visible = false;
    scene.add(sketchLine);
    const eraseLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xe23b2f, toneMapped: false, depthTest: false }),
    );
    eraseLine.frustumCulled = false;
    eraseLine.renderOrder = 960;
    eraseLine.visible = false;
    scene.add(eraseLine);
    const sketchWorld = new THREE.Vector3();
    const localHit = new THREE.Vector3();
    const invMat = new THREE.Matrix4();

    function clearSketchPreview() {
      sketchLine.visible = false;
      sketchLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      eraseLine.visible = false;
      eraseLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    }

    function setErasePreview(pairs, model) {
      if (!pairs?.length || !model) {
        eraseLine.visible = false;
        return;
      }
      const solid = model.userData.solid;
      if (!solid) return;
      const data = [];
      const seen = new Set();
      for (const [a, b] of pairs) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const va = solid.vertices[a];
        const vb = solid.vertices[b];
        if (!va || !vb) continue;
        localHit.set(va[0], va[1], va[2]).applyMatrix4(model.matrixWorld);
        data.push(localHit.x, localHit.y, localHit.z);
        localHit.set(vb[0], vb[1], vb[2]).applyMatrix4(model.matrixWorld);
        data.push(localHit.x, localHit.y, localHit.z);
      }
      eraseLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
      eraseLine.visible = data.length > 0;
    }

    function hitEraseEdge(e) {
      setPointer(e);
      const model = pickModel();
      if (!model || model.userData.kind === 'baseplate') return null;
      if (isLocked(model.userData.kind)) return null;
      const solid = model.userData.solid;
      if (!solid) return null;
      model.updateWorldMatrix(true, true);
      invMat.copy(model.matrixWorld).invert();
      const origin = raycaster.ray.origin.clone().applyMatrix4(invMat);
      const dir = raycaster.ray.direction.clone().transformDirection(invMat).normalize();
      // Scale pick tolerance by part size so thin edges stay hittable.
      const size = model.userData.size || { x: 1, y: 1, z: 1 };
      const tol = Math.max(0.08, Math.min(size.x, size.y, size.z) * 0.04);
      const hit = hitSolidEdge(solid, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z], tol);
      if (!hit) return null;
      return { model, a: hit.a, b: hit.b, faceId: hit.faceId };
    }

    function expandEraseContour(solid, a, b) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const pairs = [];
      const addRing = (ring) => {
        if (!ring) return false;
        let hit = false;
        for (let i = 0; i < ring.length; i++) {
          const ia = ring[i];
          const ib = ring[(i + 1) % ring.length];
          const k = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
          if (k === key) hit = true;
        }
        if (!hit) return false;
        for (let i = 0; i < ring.length; i++) {
          pairs.push([ring[i], ring[(i + 1) % ring.length]]);
        }
        return true;
      };
      for (const face of solid.faces) {
        if (face.bordered && (addRing(face.verts) || addRing(face.rim))) return pairs;
        if (face.holes) {
          for (const hole of face.holes) {
            if (addRing(hole)) return pairs;
          }
        }
      }
      pairs.push([a, b]);
      return pairs;
    }

    function setSketchPreview(points) {
      if (!points?.length) {
        clearSketchPreview();
        return;
      }
      const data = [];
      for (const p of points) data.push(p[0], p[1], p[2]);
      if (points.length === 1) data.push(points[0][0], points[0][1], points[0][2]);
      sketchLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
      sketchLine.geometry.setDrawRange(0, points.length === 1 ? 2 : points.length);
      sketchLine.visible = true;
    }

    function hitDrawFace(e) {
      setPointer(e);
      const model = pickModel();
      if (!model || model.userData.kind === 'baseplate') return null;
      if (isLocked(model.userData.kind)) return null;
      ensureSolid(model);
      const solid = model.userData.solid;
      if (!solid) return null;
      model.updateWorldMatrix(true, true);
      invMat.copy(model.matrixWorld).invert();
      const origin = raycaster.ray.origin.clone().applyMatrix4(invMat);
      const dir = raycaster.ray.direction.clone().transformDirection(invMat).normalize();
      const hit = hitSolid(
        solid,
        [origin.x, origin.y, origin.z],
        [dir.x, dir.y, dir.z],
        { preferSimple: tool === 'pushpull' },
      ) || hitSolid(solid, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z]);
      if (!hit) return null;
      localHit.set(hit.point[0], hit.point[1], hit.point[2]);
      sketchWorld.copy(localHit).applyMatrix4(model.matrixWorld);
      return {
        model,
        faceId: hit.faceId,
        local: hit.point.slice(),
        world: [sketchWorld.x, sketchWorld.y, sketchWorld.z],
        normal: hit.normal,
      };
    }

    function closeSketchLoop() {
      if (!sketch || sketch.points.length < 3) return;
      const solid = ensureSolid(sketch.model);
      const result = splitFaceWithLoop(solid, sketch.faceId, sketch.points);
      if (result) {
        commitSolid(sketch.model, result.solid, false);
        applySelection(sketch.model.userData.kind);
      }
      sketch = null;
      clearSketchPreview();
    }

    function commitShapeLoop() {
      if (!sketch || (sketch.mode !== 'rectangle' && sketch.mode !== 'circle')) return false;
      const solid = ensureSolid(sketch.model);
      const end = sketch.points[sketch.points.length - 1] || sketch.start;
      const loop = sketch.mode === 'rectangle'
        ? rectangleLoop(solid, sketch.faceId, sketch.start, end)
        : circleLoop(solid, sketch.faceId, sketch.start, end);
      if (loop) {
        const result = splitFaceWithLoop(solid, sketch.faceId, loop);
        if (result) {
          commitSolid(sketch.model, result.solid, false);
          applySelection(sketch.model.userData.kind);
        }
      }
      sketch = null;
      clearSketchPreview();
      return true;
    }

    function commitPushPull() {
      if (!sketch || sketch.mode !== 'pushpull') return false;
      if (Math.abs(sketch.distance) > 0.02 && sketch.model.userData.solid) {
        commitSolid(sketch.model, sketch.model.userData.solid, false);
      } else if (sketch.base) {
        applySolidMesh(sketch.model, sketch.base);
      }
      sketch = null;
      clearSketchPreview();
      return true;
    }

    function updatePushPullDistance(e) {
      if (!sketch || sketch.mode !== 'pushpull') return;
      setPointer(e);
      const n = sketch.normal;
      const worldStart = localHit.set(sketch.start[0], sketch.start[1], sketch.start[2]).applyMatrix4(sketch.model.matrixWorld).clone();
      const normalWorld = new THREE.Vector3(n[0], n[1], n[2]).transformDirection(sketch.model.matrixWorld).normalize();
      const side = camera.getWorldDirection(new THREE.Vector3()).cross(normalWorld);
      if (side.lengthSq() < 1e-8) return;
      side.normalize();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        side.clone().cross(normalWorld).normalize(),
        worldStart,
      );
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, point)) return;
      let distance = point.clone().sub(worldStart).dot(normalWorld);
      if (distance < 0) {
        // Cache thickness at drag start so a deep push snaps to a through-cut
        // instead of keeping a solid finger out the back.
        if (!(sketch.oppDepth > 0)) {
          const opp = oppositeDepth(sketch.base, sketch.faceId);
          sketch.oppDepth = opp && opp.depth > 0 ? opp.depth : 0;
        }
        if (sketch.oppDepth > 0 && -distance >= sketch.oppDepth * 0.92) {
          distance = -sketch.oppDepth;
        }
      }
      sketch.distance = distance;
      const next = extrudeFace(sketch.base, sketch.faceId, distance);
      if (next) applySolidMesh(sketch.model, next);
    }

    function localOnSketchFace(e) {
      if (!sketch?.model) return null;
      const solid = sketch.model.userData.solid;
      if (!solid) return null;
      sketch.model.updateWorldMatrix(true, true);
      invMat.copy(sketch.model.matrixWorld).invert();
      setPointer(e);
      const origin = raycaster.ray.origin.clone().applyMatrix4(invMat);
      const dir = raycaster.ray.direction.clone().transformDirection(invMat).normalize();
      const face = solid.faces.find((item) => item.id === sketch.faceId);
      if (!face) return null;
      const n = faceNormal(solid, face);
      const p0 = solid.vertices[face.verts[0]];
      const denom = n[0] * dir.x + n[1] * dir.y + n[2] * dir.z;
      if (Math.abs(denom) < 1e-8) return null;
      const t = ((p0[0] - origin.x) * n[0] + (p0[1] - origin.y) * n[1] + (p0[2] - origin.z) * n[2]) / denom;
      if (t < 0) return null;
      const point = [origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t];
      const projected = projectPointToFace(solid, sketch.faceId, point);
      return projected ? projected.world : point;
    }

    function updateShapePreview(e) {
      if (!sketch || (sketch.mode !== 'rectangle' && sketch.mode !== 'circle')) return;
      setPointer(e);
      const local = localOnSketchFace(e);
      if (!local) return;
      sketch.points = [sketch.start, local];
      const solid = sketch.model.userData.solid;
      const loop = sketch.mode === 'rectangle'
        ? rectangleLoop(solid, sketch.faceId, sketch.start, local)
        : circleLoop(solid, sketch.faceId, sketch.start, local);
      if (loop) {
        setSketchPreview(loop.map((p) => {
          localHit.set(p[0], p[1], p[2]).applyMatrix4(sketch.model.matrixWorld);
          return [localHit.x, localHit.y, localHit.z];
        }).concat([loop[0]].map((p) => {
          localHit.set(p[0], p[1], p[2]).applyMatrix4(sketch.model.matrixWorld);
          return [localHit.x, localHit.y, localHit.z];
        })));
      }
    }

    function onPointerDown(e) {
      if (e.target === gizmo) return;
      markActive();
      rightMenu = null;
      root.focus({ preventScroll: true });
      pointerX = e.clientX;
      pointerY = e.clientY;
      try { root.setPointerCapture(e.pointerId); } catch { /* already captured */ }
      // Live Mode is play-only: right-mouse look. Character movement is Scripts-only.
      if (isLive()) {
        if (e.button === 2) {
          draggingLook = true;
          hideHint();
        }
        return;
      }
      if (e.button === 0 && DRAW_IDS.has(tool)) {
        setPointer(e);
        hideHint();
        if (tool === 'erase') {
          const hit = hitEraseEdge(e);
          if (!hit) return;
          const solid = hit.model.userData.solid;
          const pairs = expandEraseContour(solid, hit.a, hit.b);
          sketch = {
            mode: 'erase',
            model: hit.model,
            pairs,
            stroking: true,
          };
          setErasePreview(pairs, hit.model);
          applySelection(hit.model.userData.kind);
          return;
        }
        if (tool === 'pushpull') {
          // Second click commits (IngeTrazo click-move-click).
          if (sketch?.mode === 'pushpull') {
            commitPushPull();
            return;
          }
          const hit = hitDrawFace(e);
          if (!hit) return;
          sketch = {
            mode: 'pushpull',
            model: hit.model,
            faceId: hit.faceId,
            start: hit.local.slice(),
            normal: hit.normal.slice(),
            base: cloneSolid(hit.model.userData.solid),
            distance: 0,
            pointerDown: true,
            dragged: false,
            downX: e.clientX,
            downY: e.clientY,
          };
          applySelection(hit.model.userData.kind);
          return;
        }
        if (tool === 'line') {
          if (sketch?.mode === 'line' && sketch.model) {
            const local = localOnSketchFace(e) || hitDrawFace(e)?.local;
            if (!local) return;
            const first = sketch.points[0];
            const close = Math.hypot(local[0] - first[0], local[1] - first[1], local[2] - first[2]) < 0.15;
            if (close && sketch.points.length >= 3) {
              closeSketchLoop();
              return;
            }
            sketch.points.push(local);
            setSketchPreview(sketch.points.map((p) => {
              localHit.set(p[0], p[1], p[2]).applyMatrix4(sketch.model.matrixWorld);
              return [localHit.x, localHit.y, localHit.z];
            }));
            return;
          }
          const hit = hitDrawFace(e);
          if (!hit) return;
          sketch = { mode: 'line', model: hit.model, faceId: hit.faceId, points: [hit.local] };
          applySelection(hit.model.userData.kind);
          setSketchPreview([hit.world]);
          return;
        }
        if (tool === 'pencil') {
          const hit = hitDrawFace(e);
          if (!hit) return;
          sketch = { mode: 'pencil', model: hit.model, faceId: hit.faceId, points: [hit.local], drawing: true };
          applySelection(hit.model.userData.kind);
          setSketchPreview([hit.world]);
          return;
        }
        if (tool === 'rectangle' || tool === 'circle') {
          // Second click commits opposite corner / radius.
          if (sketch?.mode === tool && sketch.model) {
            const local = localOnSketchFace(e);
            if (local) sketch.points = [sketch.start, local];
            commitShapeLoop();
            return;
          }
          const hit = hitDrawFace(e);
          if (!hit) return;
          sketch = {
            mode: tool,
            model: hit.model,
            faceId: hit.faceId,
            start: hit.local.slice(),
            points: [hit.local],
            pointerDown: true,
            dragged: false,
            downX: e.clientX,
            downY: e.clientY,
          };
          applySelection(hit.model.userData.kind);
          setSketchPreview([hit.world]);
          return;
        }
        return;
      }
      if (e.button === 0) {
        setPointer(e);
        const handle = selected ? pickHandle(e) : null;
        if (handle) {
          beginToolDrag(handle, e);
          return;
        }
        if (tool === 'move') {
          const model = pickModel();
          if (model && model.userData.kind !== 'baseplate') {
            if (e.ctrlKey || e.metaKey) {
              const id = model.userData.kind;
              const ids = selection.map((item) => item.userData.kind);
              if (!ids.includes(id)) applySelection([...ids, id]);
            } else if (!selection.includes(model)) {
              applySelection(model.userData.kind);
            }
            // Selection publish unlocks our claim synchronously; retry lock check after.
            if (!isLocked(model.userData.kind)) beginSurfaceDrag(model, e);
            return;
          }
        }
        pendingClick = { x: e.clientX, y: e.clientY, model: pickModel(), dragged: false, ctrl: e.ctrlKey || e.metaKey };
        return;
      }
      if (e.button === 2) {
        setPointer(e);
        const model = pickModel();
        const kind = model?.userData.kind ?? null;
        const onSelection = kind != null && selection.some((item) => item.userData.kind === kind);
        rightClick = { x: e.clientX, y: e.clientY, moved: false, kind: onSelection ? kind : null };
        if (!onSelection) draggingLook = true;
      } else if (e.button === 1) { draggingPan = true; e.preventDefault(); }
      if (draggingLook || draggingPan) hideHint();
    }

    function onPointerUp(e) {
      if (isLive()) {
        rightMenu = null;
        rightClick = null;
        endDrag();
        return;
      }
      if (sketch && e.button === 0) {
        if (sketch.mode === 'pencil' && sketch.drawing) {
          sketch.drawing = false;
          if (sketch.points.length >= 3) {
            const first = sketch.points[0];
            const last = sketch.points[sketch.points.length - 1];
            if (Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]) < 0.25) {
              closeSketchLoop();
            } else {
              sketch = null;
              clearSketchPreview();
            }
          } else {
            sketch = null;
            clearSketchPreview();
          }
          return;
        }
        if (sketch.mode === 'erase' && sketch.stroking) {
          sketch.stroking = false;
          if (sketch.pairs?.length && sketch.model?.userData?.solid) {
            const next = eraseEdges(sketch.model.userData.solid, sketch.pairs);
            if (next) {
              commitSolid(sketch.model, next, false);
              applySelection(sketch.model.userData.kind);
            }
          }
          sketch = null;
          clearSketchPreview();
          return;
        }
        // Drag-release commits; a simple click leaves the tool in click-move-click.
        if (sketch.mode === 'rectangle' || sketch.mode === 'circle') {
          sketch.pointerDown = false;
          if (sketch.dragged) commitShapeLoop();
          return;
        }
        if (sketch.mode === 'pushpull') {
          sketch.pointerDown = false;
          if (sketch.dragged) commitPushPull();
          return;
        }
      }
      if (drag) finishToolDrag();
      else if (pendingClick && e.button === 0) {
        const click = pendingClick;
        pendingClick = null;
        hideMarquee();
        if (click.dragged && tool === 'select') {
          const hits = modelsInRect(click.x, click.y, e.clientX, e.clientY).map((model) => model.userData.kind);
          if (click.ctrl) {
            const next = new Set(selection.map((model) => model.userData.kind));
            for (const id of hits) next.add(id);
            api.bus.emit('scene:select', [...next]);
          } else api.bus.emit('scene:select', hits);
        } else if (!click.dragged) {
          // Selecting a locked part claims it (presence last-writer-wins); do not ignore the click.
          if (click.ctrl && click.model) {
            const id = click.model.userData.kind;
            const ids = selection.map((model) => model.userData.kind);
            api.bus.emit('scene:select', ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
          } else api.bus.emit('scene:select', click.model ? click.model.userData.kind : null);
        }
        syncTools();
      }
      if (e.button === 2) rightMenu = rightClick;
      rightClick = null;
      endDrag();
    }

    function onPointerMove(e) {
      if (e.clientX || e.clientY) { pointerX = e.clientX; pointerY = e.clientY; }
      if (isLive()) {
        if (!(draggingLook || draggingPan)) return;
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;
        if (dx === 0 && dy === 0) return;
        if (draggingLook) {
          const sens = 0.0032;
          const mode = liveCameraInfo()?.mode || 'firstPerson';
          yaw -= dx * sens;
          if (mode !== 'topDown') {
            pitch -= dy * sens;
            pitch = Math.max(-1.45, Math.min(1.45, pitch));
          }
          updateLiveCamera();
        }
        return;
      }
      // Active sketch previews follow the cursor (click-move-click), not only drag.
      if (sketch) {
        setPointer(e);
        if (sketch.mode === 'erase' && sketch.stroking) {
          const hit = hitEraseEdge(e);
          if (hit && hit.model === sketch.model) {
            const more = expandEraseContour(hit.model.userData.solid, hit.a, hit.b);
            const seen = new Set(sketch.pairs.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
            for (const [a, b] of more) {
              const key = a < b ? `${a}:${b}` : `${b}:${a}`;
              if (seen.has(key)) continue;
              seen.add(key);
              sketch.pairs.push([a, b]);
            }
            setErasePreview(sketch.pairs, sketch.model);
          }
          return;
        }
        if (sketch.mode === 'pencil' && sketch.drawing && (e.buttons & 1)) {
          const hit = hitDrawFace(e);
          if (hit && hit.model === sketch.model && hit.faceId === sketch.faceId) {
            const last = sketch.points[sketch.points.length - 1];
            if (Math.hypot(hit.local[0] - last[0], hit.local[1] - last[1], hit.local[2] - last[2]) > 0.08) {
              sketch.points.push(hit.local);
              setSketchPreview(sketch.points.map((p) => {
                localHit.set(p[0], p[1], p[2]).applyMatrix4(sketch.model.matrixWorld);
                return [localHit.x, localHit.y, localHit.z];
              }));
            }
          }
          return;
        }
        if (sketch.mode === 'rectangle' || sketch.mode === 'circle') {
          if (sketch.pointerDown && Math.hypot(e.clientX - sketch.downX, e.clientY - sketch.downY) > 4) {
            sketch.dragged = true;
          }
          updateShapePreview(e);
          return;
        }
        if (sketch.mode === 'pushpull') {
          if (sketch.pointerDown && Math.hypot(e.clientX - sketch.downX, e.clientY - sketch.downY) > 4) {
            sketch.dragged = true;
          }
          updatePushPullDistance(e);
          return;
        }
        if (sketch.mode === 'line' && sketch.points.length) {
          const local = localOnSketchFace(e);
          if (!local) return;
          const pts = sketch.points.map((p) => {
            localHit.set(p[0], p[1], p[2]).applyMatrix4(sketch.model.matrixWorld);
            return [localHit.x, localHit.y, localHit.z];
          });
          localHit.set(local[0], local[1], local[2]).applyMatrix4(sketch.model.matrixWorld);
          pts.push([localHit.x, localHit.y, localHit.z]);
          setSketchPreview(pts);
          return;
        }
      }
      if (drag) {
        updateToolDrag(e);
        return;
      }
      if (pendingClick && (e.buttons & 1)) {
        if (Math.hypot(e.clientX - pendingClick.x, e.clientY - pendingClick.y) > 4) {
          pendingClick.dragged = true;
          if (tool === 'select') showMarquee(pendingClick.x, pendingClick.y, e.clientX, e.clientY);
        }
        return;
      }
      if (rightClick && !draggingLook && (e.buttons & 2)) {
        if (Math.hypot(e.clientX - rightClick.x, e.clientY - rightClick.y) > 4) {
          rightClick.moved = true;
          draggingLook = true;
          hideHint();
        }
      }
      if (!(draggingLook || draggingPan)) {
        if (!e.buttons && tool === 'erase' && !sketch) {
          const hit = hitEraseEdge(e);
          if (hit) {
            const pairs = expandEraseContour(hit.model.userData.solid, hit.a, hit.b);
            setErasePreview(pairs, hit.model);
          } else {
            eraseLine.visible = false;
          }
          return;
        }
        if (!e.buttons) {
          if (eraseLine.visible) eraseLine.visible = false;
          updateHover(e);
        }
        return;
      }
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (dx === 0 && dy === 0) return;
      if (draggingPan) {
        const scale = distance * 0.0015;
        right.setFromMatrixColumn(camera.matrix, 0);
        const up = camera.up;
        const pan = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
        camera.position.add(pan);
        target.add(pan);
        return;
      }
      const sens = 0.0032;
      yaw -= dx * sens;
      pitch -= dy * sens;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      aimForward(forward);
      target.copy(camera.position).addScaledVector(forward, distance);
      camera.lookAt(target);
    }

    function zoom(deltaY) {
      const factor = Math.pow(0.9, -deltaY / 100);
      const rect = root.getBoundingClientRect();
      pointer.set(
        ((pointerX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((pointerY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const next = Math.min(1400, Math.max(2.5, distance * factor));
      if (raycaster.ray.intersectPlane(ground, hit) && hit.distanceTo(camera.position) < 4000) {
        const traveled = 1 - next / distance;
        camera.position.lerp(hit, traveled);
        distance = next;
        aimForward(forward);
        target.copy(camera.position).addScaledVector(forward, distance);
        camera.lookAt(target);
      } else {
        distance = next;
        applyOrbit();
      }
      hideHint();
    }

    function lookFrom(dir) {
      const look = dir.clone().negate().normalize();
      pitch = Math.max(-1.45, Math.min(1.2, Math.asin(look.y)));
      const c = Math.cos(pitch);
      if (Math.abs(c) > 0.02) yaw = Math.atan2(-look.x / c, -look.z / c);
      applyOrbit();
      hideHint();
    }

    const axes = [
      { v: new THREE.Vector3(1, 0, 0), color: '#d64545', name: 'X' },
      { v: new THREE.Vector3(0, 1, 0), color: '#3aaa4a', name: 'Y' },
      { v: new THREE.Vector3(0, 0, 1), color: '#3a74e6', name: 'Z' },
    ];
    const tips = [];

    function drawGizmo() {
      const ctx = gizmoCtx;
      ctx.setTransform(gizmoDpr, 0, 0, gizmoDpr, 0, 0);
      ctx.clearRect(0, 0, gizmoSize, gizmoSize);
      const inv = camera.quaternion.clone().invert();
      const ordered = axes.map((axis) => ({ ...axis, local: axis.v.clone().applyQuaternion(inv) }))
        .sort((a, b) => a.local.z - b.local.z);
      const cx = gizmoSize / 2;
      const cy = gizmoSize / 2;
      const scale = 30;
      tips.length = 0;
      for (const axis of ordered) {
        const x = cx + axis.local.x * scale;
        const y = cy - axis.local.y * scale;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = axis.color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = axis.color;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '600 11px "Segoe UI Variable", Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(axis.name, x, y + 0.5);
        tips.push({ x, y, dir: axis.v });
      }
    }

    function onGizmoDown(e) {
      markActive();
      const rect = gizmo.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      e.stopPropagation();
      e.preventDefault();
      let best = null;
      let bestD = 18;
      for (const tip of tips) {
        const d = Math.hypot(tip.x - x, tip.y - y);
        if (d < bestD) { best = tip; bestD = d; }
      }
      if (best) lookFrom(best.dir);
    }

    const keyOf = (e) => {
      switch (e.code) {
        case 'KeyW': return 'w';
        case 'KeyA': return 'a';
        case 'KeyS': return 's';
        case 'KeyD': return 'd';
        case 'KeyQ': return 'q';
        case 'KeyE': return 'e';
        case 'Space': return 'space';
        case 'ShiftLeft':
        case 'ShiftRight': return 'shift';
        default: return null;
      }
    };

    function onKey(e, down) {
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (down) markActive();
      if (down && e.key === 'Escape' && sketch) {
        e.preventDefault();
        if (sketch.mode === 'pushpull' && sketch.base) applySolidMesh(sketch.model, sketch.base);
        sketch = null;
        clearSketchPreview();
        return;
      }
      if (down && (e.key === 'Enter') && sketch?.mode === 'line' && sketch.points.length >= 3) {
        e.preventDefault();
        closeSketchLoop();
        return;
      }
      if (down && e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !typing) {
        if (isLive()) return;
        e.preventDefault();
        frameSelection();
        return;
      }
      if (down && e.key === 'Delete' && !e.repeat) {
        if (isLive() || typing || !selection.length) return;
        if (drag) {
          drag = null;
          pendingClick = null;
          hideReadout();
        }
        e.preventDefault();
        const ids = selection.map((model) => model.userData.kind).filter((id) => !isLocked(id));
        for (const id of ids) api.bus.emit('project:delete', id);
        return;
      }
      if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      if (isLive()) {
        if (down) keyCodes.add(e.code);
        else keyCodes.delete(e.code);
        if (!e.repeat) {
          api.bus.emit('script:input', {
            kind: down ? 'began' : 'ended',
            code: e.code,
            userInputType: 'Keyboard',
          });
        }
      }
      const key = keyOf(e);
      if (!key) {
        if (isLive()) e.preventDefault();
        return;
      }
      keys[key] = down;
      e.preventDefault();
    }

    function clearKeys() {
      for (const k of Object.keys(keys)) keys[k] = false;
      keyCodes.clear();
      if (drag) finishToolDrag();
      pendingClick = null;
      hideMarquee();
      endDrag();
    }

    const listeners = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      listeners.push([el, type, fn, opts]);
    };
    on(root, 'pointerdown', onPointerDown);
    on(window, 'pointermove', onPointerMove);
    on(window, 'pointerup', onPointerUp);
    on(window, 'pointercancel', onPointerUp);
    on(root, 'wheel', (e) => {
      markActive();
      e.preventDefault();
      if (isLive()) return;
      zoom(e.deltaY);
    }, { passive: false });
    on(root, 'contextmenu', (e) => {
      e.preventDefault();
      if (isLive()) return;
      const click = rightMenu;
      rightMenu = null;
      if (!click || click.moved || !click.kind) return;
      api.bus.emit('explorer:context', { x: click.x, y: click.y, id: click.kind });
    });
    on(root, 'auxclick', (e) => e.preventDefault());
    on(window, 'keydown', (e) => onKey(e, true));
    on(window, 'keyup', (e) => onKey(e, false));
    on(window, 'blur', clearKeys);
    on(gizmo, 'pointerdown', (e) => {
      if (isLive()) return;
      onGizmoDown(e);
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    buildPlace();
    api.bus.emit('view:fullbright-request');
    api.bus.on('project:opened', (doc) => {
      if (isLive()) {
        // Live Mode keeps its own snapshot; apply the edit doc when Stop is pressed.
        liveHoldDoc = doc;
        return;
      }
      buildPlace(doc);
      // Keep the current / restored camera. Hot reload re-publishes the open
      // project and used to fling every user back to the default orbit.
      publishSelection();
      syncTools();
    });
    api.bus.on('project:reverted', (doc) => {
      if (isLive()) {
        liveHoldDoc = doc;
        return;
      }
      drag = null;
      pendingClick = null;
      hideReadout();
      paintHandles(null);
      const kinds = selection.map((model) => model.userData.kind);
      if (!applyDoc(doc)) {
        buildPlace(doc);
        selection = kinds.map((kind) => models.find((model) => model.userData.kind === kind)).filter(Boolean);
        selected = selection[selection.length - 1] ?? null;
      }
      hoverBox.visible = false;
      syncTools();
      publishScene();
      publishSelection();
    });
    api.bus.on('mode:play', () => { enterLiveMode(); });
    api.bus.on('mode:stop', () => { exitLiveMode(); });
    // Hot reload can remount the viewport while project is still Live — resync.
    api.bus.on('mode:changed', (mode) => {
      if (mode === 'live') {
        if (playMode !== 'live' && !enterLiveMode()) api.bus.emit('mode:set', 'edit');
      } else if (playMode === 'live') {
        exitLiveMode();
      }
    });
    api.bus.emit('mode:request');
    const SHAPE_SIZE = {
      block: { x: 4, y: 1, z: 4 },
      sphere: { x: 4, y: 4, z: 4 },
      cylinder: { x: 4, y: 4, z: 4 },
      wedge: { x: 4, y: 2, z: 4 },
      corner: { x: 4, y: 2, z: 4 },
      camera: { x: 2, y: 1.5, z: 3 },
    };

    // Baseplate minor grid is 4 studs; snap the part's footprint corner onto that grid
    // so edges sit on the square lines (a 4×4 part fills one square).
    const GRID_CELL = 4;

    function creationPoint(height, width = 4, depth = 4) {
      camera.getWorldDirection(forward);
      let x = target.x;
      let z = target.z;
      if (forward.y < -0.05) {
        const t = -camera.position.y / forward.y;
        if (t > 0) {
          x = camera.position.x + forward.x * t;
          z = camera.position.z + forward.z * t;
        }
      } else {
        x = target.x + forward.x * 10;
        z = target.z + forward.z * 10;
      }
      x = Math.max(-240, Math.min(240, x));
      z = Math.max(-240, Math.min(240, z));
      let cornerX = Math.round((x - width / 2) / GRID_CELL) * GRID_CELL;
      let cornerZ = Math.round((z - depth / 2) / GRID_CELL) * GRID_CELL;
      for (let i = 0; i < 16; i++) {
        const cx = cornerX + width / 2;
        const cz = cornerZ + depth / 2;
        const taken = models.some((model) => model.userData.kind !== 'baseplate'
          && Math.abs(model.position.x - cx) < 0.2
          && Math.abs(model.position.z - cz) < 0.2);
        if (!taken) return [cx, height / 2, cz];
        cornerX += GRID_CELL;
      }
      return [cornerX + width / 2, height / 2, cornerZ + depth / 2];
    }

    api.bus.on('part:create', (shape) => {
      if (isLive()) return;
      const size = SHAPE_SIZE[shape] || SHAPE_SIZE.block;
      const point = creationPoint(size.y, size.x, size.z);
      if (shape === 'camera') point[1] = Math.max(point[1], 5);
      if (shape === 'controller' || shape === 'script') return;
      api.bus.emit('project:insert', {
        shape: SHAPE_SIZE[shape] ? shape : 'block',
        name: shape === 'camera' ? 'Camera' : undefined,
        width: size.x,
        height: size.y,
        depth: size.z,
        position: point,
        rotation: [0, 0, 0],
        color: shape === 'camera' ? '#5b9dff' : undefined,
        camera: shape === 'camera' ? { fieldOfView: 70, mode: 'firstPerson', turnParent: true } : undefined,
      });
    });
    api.bus.on('scene:request', publishScene);
    function publishSelection() {
      const ids = selection.map((model) => model.userData.kind);
      const now = Date.now();
      for (const id of [...claims.keys()]) if (!ids.includes(id)) claims.delete(id);
      for (const id of ids) {
        // Fresh claim time when taking a locked part so last-writer-wins can steal it.
        if (!claims.has(id) || isLocked(id)) claims.set(id, now);
      }
      api.bus.emit('presence:selection', ids.map((id) => ({ id, at: claims.get(id) })));
    }
    function applySelection(spec) {
      if (drag) finishToolDrag();
      pendingClick = null;
      if (isLive()) {
        if (selection.length || selected) {
          selection = [];
          selected = null;
          syncTools();
          publishScene();
          publishSelection();
        }
        return;
      }
      const ids = spec == null ? [] : (Array.isArray(spec) ? spec : [spec]);
      const next = [];
      for (const id of ids) {
        // Allow selecting locked parts so the click can take the claim (last writer wins).
        const model = models.find((item) => item.userData.kind === id);
        if (model && !next.includes(model)) next.push(model);
      }
      const same = next.length === selection.length && next.every((model, index) => model === selection[index]);
      if (same) return;
      selection = next;
      selected = next[next.length - 1] ?? null;
      syncTools();
      publishScene();
      publishSelection();
    }
    function releaseLocked() {
      const foreignLock = (id) => isLocked(id) && !claims.has(id);
      if (drag && selected && foreignLock(selected.userData.kind)) {
        drag = null;
        pendingClick = null;
        hideReadout();
        paintHandles(null);
        root.style.cursor = 'default';
        api.bus.emit('project:revert-request');
      }
      if (!selection.some((model) => foreignLock(model.userData.kind))) return;
      selection = selection.filter((model) => !foreignLock(model.userData.kind));
      selected = selection[selection.length - 1] ?? null;
      syncTools();
      publishScene();
      publishSelection();
    }
    api.bus.on('camera:frame', (id) => {
      const ids = Array.isArray(id) ? id.filter((item) => typeof item === 'string') : (typeof id === 'string' ? [id] : []);
      if (ids.length) {
        const usable = ids.filter((item) => models.some((model) => model.userData.kind === item));
        if (!usable.length) return;
        applySelection(usable.length === 1 ? usable[0] : usable);
      }
      frameSelection();
    });
    api.bus.on('scene:select', (spec) => {
      applySelection(spec);
    });
    api.bus.on('project:locks', (ids) => {
      locked = new Set(Array.isArray(ids) ? ids : []);
      releaseLocked();
    });
    api.bus.on('tool:changed', (id) => {
      if (isLive()) return;
      if (sketch) {
        if (sketch.mode === 'pushpull' && sketch.base) applySolidMesh(sketch.model, sketch.base);
        sketch = null;
        clearSketchPreview();
      }
      tool = id;
      syncTools();
    });
    api.bus.on('snap:changed', (next) => {
      if (!next) return;
      snap = {
        move: !!next.move,
        moveStuds: Number(next.moveStuds) > 0 ? Number(next.moveStuds) : snap.moveStuds,
        rotate: !!next.rotate,
        rotateDegrees: Number(next.rotateDegrees) > 0 ? Number(next.rotateDegrees) : snap.rotateDegrees,
      };
    });
    api.bus.emit('project:request');
    api.bus.emit('tool:request');
    api.bus.emit('snap:request');

    resize();
    if (!restoreCamera()) applyOrbit();
    root.focus({ preventScroll: true });

    let raf = 0;
    const avatars = new Map();
    const poseForward = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    let poseSent = 0;
    let inputAt = 0;
    const markActive = () => { inputAt = performance.now(); };

    function nameSprite(text) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      const draw = (value) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '600 42px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const width = Math.min(460, Math.ceil(ctx.measureText(value).width) + 36);
      ctx.fillStyle = 'rgba(16,16,18,.78)';
      ctx.beginPath();
      ctx.roundRect(256 - width / 2, 16, width, 64, 16);
      ctx.fill();
      ctx.fillStyle = '#f4f6f8';
      ctx.fillText(value, 256, 50);
      };
      draw(text);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      sprite.position.y = 2.85;
      sprite.scale.set(7.2, 1.35, 1);
      sprite.raycast = () => {};
      sprite.userData.draw = draw;
      sprite.userData.texture = texture;
      return sprite;
    }

    function makeEye(x) {
      const eye = new THREE.Group();
      eye.position.set(x, 0.32, 1.42);
      const white = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 20, 16),
        new THREE.MeshStandardMaterial({ color: 0xf7f8fa, roughness: 0.28, metalness: 0, transparent: true }),
      );
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.4, metalness: 0, transparent: true }),
      );
      pupil.position.z = 0.26;
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
      );
      shine.position.set(0.04, 0.06, 0.36);
      eye.add(white, pupil, shine);
      eye.userData.pupil = pupil;
      eye.userData.shine = shine;
      eye.userData.pupilGoal = new THREE.Vector3(0, 0, 0.26);
      eye.traverse((child) => { child.raycast = () => {}; });
      return eye;
    }

    function makeAvatar(color) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 32, 24),
        new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05, transparent: true }),
      );
      body.castShadow = true;
      const left = makeEye(-0.48);
      const right = makeEye(0.48);
      const label = nameSprite('User');
      group.add(body, left, right, label);
      group.traverse((child) => { child.raycast = () => {}; });
      group.userData.body = body;
      group.userData.eyes = [left, right];
      group.userData.label = label;
      group.userData.isCharacter = false;
      group.userData.goal = new THREE.Vector3();
      group.userData.look = new THREE.Vector3(0, 0, -1);
      group.userData.aim = new THREE.Vector3();
      group.userData.hasAim = false;
      group.userData.goalQuat = new THREE.Quaternion();
      group.userData.blink = { phase: 'wait', close: 0, extra: false, until: performance.now() + Math.random() * 2500 };
      group.userData.activeAt = performance.now();
      group.userData.baseLabelScale = { x: 7.2, y: 1.35 };
      group.userData.labelHeight = 2.85;
      scene.add(group);
      return group;
    }

    // Live Mode remotes appear as the playable Part (Camera host), not spheres.
    function makeCharacterAvatar(template, color) {
      const group = new THREE.Group();
      const src = template?.userData?.body;
      const size = template?.userData?.size || { x: 2, y: 2, z: 2 };
      let geometry;
      if (src?.geometry) geometry = src.geometry.clone();
      else geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      const partColor = (() => {
        const mat = [].concat(src?.material || [])[0];
        if (mat?.color) return mat.color.clone();
        return new THREE.Color(color || '#b1b2b5');
      })();
      const body = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: partColor,
          roughness: 0.55,
          metalness: 0.04,
          transparent: true,
        }),
      );
      body.castShadow = true;
      body.receiveShadow = true;
      const label = nameSprite('User');
      const labelHeight = size.y * 0.5 + 1.1;
      label.position.y = labelHeight;
      group.add(body, label);
      group.traverse((child) => { child.raycast = () => {}; });
      group.userData.body = body;
      group.userData.eyes = [];
      group.userData.label = label;
      group.userData.isCharacter = true;
      group.userData.goal = new THREE.Vector3();
      group.userData.look = new THREE.Vector3(0, 0, -1);
      group.userData.aim = new THREE.Vector3();
      group.userData.hasAim = false;
      group.userData.goalQuat = new THREE.Quaternion();
      group.userData.blink = { phase: 'wait', close: 0, extra: false, until: 0 };
      group.userData.activeAt = performance.now();
      group.userData.baseLabelScale = { x: 7.2, y: 1.35 };
      group.userData.labelHeight = labelHeight;
      // Soft tint from the remote profile color without replacing the Part look.
      if (color && /^#[0-9a-fA-F]{6}$/i.test(color)) {
        body.material.emissive = new THREE.Color(color);
        body.material.emissiveIntensity = 0.12;
      }
      scene.add(group);
      return group;
    }

    function clearPresenceAvatars() {
      for (const [id, avatar] of avatars) {
        disposeAvatar(avatar);
        avatars.delete(id);
      }
    }

    const pupilLocal = new THREE.Vector3();
    function aimPupils(avatar, dt) {
      const eyes = avatar.userData.eyes;
      if (!eyes?.length) return;
      const target = avatar.userData.hasAim
        ? avatar.userData.aim
        : lookAt.copy(avatar.position).addScaledVector(avatar.userData.look, 40);
      const blend = 1 - Math.exp(-14 * dt);
      for (const eye of eyes) {
        eye.updateWorldMatrix(true, false);
        pupilLocal.copy(target);
        eye.worldToLocal(pupilLocal);
        // Face sits on +Z; keep the pupil on that side of the sclera.
        if (pupilLocal.z < 0.08) pupilLocal.z = 0.08;
        pupilLocal.normalize();
        const x = THREE.MathUtils.clamp(pupilLocal.x * 0.24, -0.2, 0.2);
        const y = THREE.MathUtils.clamp(pupilLocal.y * 0.22, -0.17, 0.17);
        const z = Math.sqrt(Math.max(0.05, 0.268 * 0.268 - x * x * 0.45 - y * y * 0.45));
        eye.userData.pupilGoal.set(x, y, z);
        eye.userData.pupil.position.lerp(eye.userData.pupilGoal, blend);
        eye.userData.shine.position.set(
          eye.userData.pupil.position.x * 0.55 + 0.04,
          eye.userData.pupil.position.y * 0.55 + 0.06,
          eye.userData.pupil.position.z + 0.1,
        );
      }
    }

    function setAvatarOpacity(avatar, opacity) {
      const alpha = Math.max(0.05, Math.min(1, opacity));
      avatar.traverse((child) => {
        const mats = child.material ? [].concat(child.material) : [];
        for (const material of mats) {
          if (!material || material.opacity == null) continue;
          material.transparent = true;
          material.opacity = alpha;
          material.depthWrite = alpha > 0.85;
        }
      });
      if (avatar.userData.label?.material) {
        avatar.userData.label.material.opacity = alpha;
        avatar.userData.label.material.depthWrite = false;
      }
    }

    function makePointerDot(color) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.92,
          depthTest: true,
          toneMapped: false,
        }),
      );
      mesh.renderOrder = 850;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    }

    const pointerDots = new Map();
    const remoteOutlines = new Map();
    const AFK_MS = 10 * 60 * 1000;
    const CLOSE_FADE_START = 5.5;
    const CLOSE_FADE_END = 2.2;
    const lookScratch = new THREE.Object3D();
    scene.add(lookScratch);
    lookScratch.visible = false;

    function disposeAvatar(group) {
      releaseRemoteCollider(group);
      group.removeFromParent();
      group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        const maps = child.material ? [].concat(child.material) : [];
        for (const material of maps) {
          material.map?.dispose();
          material.dispose();
        }
      });
    }

    function stepBlink(state, now, dt) {
      if (state.phase === 'wait' && now >= state.until) {
        state.phase = 'shut';
        state.extra = Math.random() < 0.22;
      }
      if (state.phase === 'shut') {
        state.close = Math.min(1, state.close + dt / 0.065);
        if (state.close >= 1) state.phase = 'open';
      } else if (state.phase === 'open') {
        state.close = Math.max(0, state.close - dt / 0.12);
        if (state.close <= 0) {
          if (state.extra) {
            state.extra = false;
            state.phase = 'shut';
          } else {
            state.phase = 'wait';
            state.until = now + 1400 + Math.random() * 4600;
          }
        }
      }
      return Math.max(0.08, 1 - Math.sin((state.close || 0) * Math.PI / 2) * 0.92);
    }

    let beamImage = null;
    function beamMap() {
      if (!beamImage) {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(16, 128);
        for (let y = 0; y < 128; y++) {
          const wave = Math.sin((y / 128) * Math.PI * 2);
          const pulse = wave > 0 ? wave * wave : 0;
          const alpha = 0.3 + pulse * 0.7;
          for (let x = 0; x < 16; x++) {
            const edge = Math.sin(((x + 0.5) / 16) * Math.PI);
            const a = Math.max(0, Math.min(255, Math.round(255 * alpha * edge)));
            const i = (y * 16 + x) * 4;
            image.data[i] = 255;
            image.data[i + 1] = 255;
            image.data[i + 2] = 255;
            image.data[i + 3] = a;
          }
        }
        ctx.putImageData(image, 0, 0);
        beamImage = new THREE.CanvasTexture(canvas);
        beamImage.wrapS = THREE.RepeatWrapping;
        beamImage.wrapT = THREE.RepeatWrapping;
        beamImage.colorSpace = THREE.SRGBColorSpace;
      }
      const map = beamImage.clone();
      map.needsUpdate = true;
      return map;
    }

    const beamRoot = new THREE.Group();
    scene.add(beamRoot);
    const beamByUser = new Map();
    const beamUp = new THREE.Vector3(0, 1, 0);
    const beamStart = new THREE.Vector3();
    const beamEnd = new THREE.Vector3();
    const beamDir = new THREE.Vector3();
    const beamBox = new THREE.Box3();

    function makeBeam(color) {
      const map = beamMap();
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          map,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      beamRoot.add(mesh);
      return mesh;
    }

    function disposeBeam(mesh) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.map = null;
      mesh.material.dispose();
    }

    function syncBeams(now) {
      const seenUsers = new Set();
      for (const person of presence) {
        if (!person?.id) continue;
        seenUsers.add(person.id);
        const avatar = avatars.get(person.id);
        let bag = beamByUser.get(person.id);
        if (!bag) {
          bag = new Map();
          beamByUser.set(person.id, bag);
        }
        const wanted = new Set();
        const stale = Number.isFinite(person.activeAt) && (Date.now() - person.activeAt > AFK_MS);
        if (avatar && !stale) {
          for (const claim of person.selection || []) {
            const id = claim?.id;
            if (typeof id !== 'string') continue;
            const model = models.find((item) => item.userData.kind === id);
            if (!model) continue;
            wanted.add(id);
            let beam = bag.get(id);
            if (!beam) {
              beam = makeBeam(person.color || '#5b9dff');
              bag.set(id, beam);
            }
            beam.material.color.set(person.color || '#5b9dff');
            beamStart.copy(avatar.position);
            beamBox.setFromObject(model);
            if (beamBox.isEmpty()) model.getWorldPosition(beamEnd);
            else beamBox.getCenter(beamEnd);
            beamDir.subVectors(beamEnd, beamStart);
            const span = beamDir.length();
            if (span < 0.001) {
              beam.visible = false;
              continue;
            }
            beamDir.multiplyScalar(1 / span);
            beamStart.addScaledVector(beamDir, Math.min(1.55, span * 0.45));
            const len = beamEnd.distanceTo(beamStart);
            if (len < 0.25) {
              beam.visible = false;
              continue;
            }
            beam.visible = true;
            if (beamDir.y < -0.9999) beam.quaternion.set(1, 0, 0, 0);
            else beam.quaternion.setFromUnitVectors(beamUp, beamDir);
            beam.position.copy(beamStart).lerp(beamEnd, 0.5);
            beam.scale.set(1, len, 1);
            const map = beam.material.map;
            if (map) {
              map.repeat.y = Math.max(1, len / 3);
              map.offset.y = -((now * 0.0012) % 1);
            }
          }
        }
        for (const [id, beam] of bag) {
          if (wanted.has(id)) continue;
          disposeBeam(beam);
          bag.delete(id);
        }
      }
      for (const [id, bag] of beamByUser) {
        if (seenUsers.has(id)) continue;
        for (const beam of bag.values()) disposeBeam(beam);
        beamByUser.delete(id);
      }
    }

    function syncRemoteOutlines() {
      const wanted = new Set();
      for (const person of presence) {
        if (Number.isFinite(person.activeAt) && (Date.now() - person.activeAt > AFK_MS)) continue;
        const color = person.color || '#5b9dff';
        for (const claim of person.selection || []) {
          const id = claim?.id;
          if (typeof id !== 'string') continue;
          const model = models.find((item) => item.userData.kind === id);
          if (!model) continue;
          const key = `${person.id}:${id}`;
          wanted.add(key);
          let box = remoteOutlines.get(key);
          if (!box) {
            box = makeOutline(new THREE.Color(color).getHex());
            remoteOutlines.set(key, box);
          }
          box.userData.fill.material.color.set(color);
          box.userData.glow.material.color.set(color);
          box.userData.lines.material.color.set(color);
          placeOutline(box, model);
        }
      }
      for (const [key, box] of remoteOutlines) {
        if (wanted.has(key)) continue;
        disposeOutline(box);
        remoteOutlines.delete(key);
      }
    }

    function syncPointerDots() {
      const seen = new Set();
      for (const person of presence) {
        if (!person?.id || !Array.isArray(person.pointer)) continue;
        seen.add(person.id);
        let dot = pointerDots.get(person.id);
        if (!dot) {
          dot = makePointerDot(person.color || '#5b9dff');
          pointerDots.set(person.id, dot);
        }
        dot.material.color.set(person.color || '#5b9dff');
        dot.position.set(person.pointer[0], person.pointer[1], person.pointer[2]);
        const stale = Number.isFinite(person.activeAt) && (Date.now() - person.activeAt > AFK_MS);
        dot.visible = !stale;
        if (dot.visible) {
          const dist = camera.position.distanceTo(dot.position);
          const size = Math.min(0.55, Math.max(0.14, dist * 0.012));
          dot.scale.setScalar(size / 0.22);
        }
      }
      for (const [id, dot] of pointerDots) {
        if (seen.has(id)) continue;
        dot.removeFromParent();
        dot.geometry.dispose();
        dot.material.dispose();
        pointerDots.delete(id);
      }
    }

    function pointerHit() {
      const rect = root.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      pointer.set(
        ((pointerX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((pointerY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(models, true);
      for (const item of hits) {
        let obj = item.object;
        while (obj && !obj.userData.selectable) obj = obj.parent;
        if (obj && item.point) return [item.point.x, item.point.y, item.point.z];
      }
      if (raycaster.ray.intersectPlane(ground, hit)) {
        if (hit.distanceTo(camera.position) < 4000) return [hit.x, hit.y, hit.z];
      }
      return null;
    }

    function takeAvatarStash(person) {
      const stash = window.__gwAvatarState;
      if (!Array.isArray(stash) || !stash.length) return null;
      const name = (person.name || 'User').toLowerCase();
      const color = (person.color || '').toLowerCase();
      let index = stash.findIndex((item) => item?.id === person.id);
      if (index < 0) {
        index = stash.findIndex((item) => (item?.name || '').toLowerCase() === name
          && (!color || (item?.color || '').toLowerCase() === color.replace(/^#/, '')));
      }
      if (index < 0) return null;
      const [item] = stash.splice(index, 1);
      return item;
    }

    function updateAvatars(now, dt) {
      const seen = new Set();
      const wall = Date.now();
      const character = isLive() ? findPlayCharacter()?.host : null;
      const wantCharacter = !!character;
      for (const person of presence) {
        if (!person?.id || !Array.isArray(person.position)) continue;
        // Live remotes who are still in Edit Mode keep spheres; Live peers use the Part.
        const personLive = (person.mode === 'live' ? 'live' : 'edit') === 'live';
        const useCharacter = wantCharacter && personLive;
        seen.add(person.id);
        let avatar = avatars.get(person.id);
        if (avatar && !!avatar.userData.isCharacter !== useCharacter) {
          disposeAvatar(avatar);
          avatars.delete(person.id);
          avatar = null;
        }
        if (!avatar) {
          // Hot reload can mint a new session id for the same person. Reuse
          // their existing avatar so they do not pop/teleport on screen.
          const baseName = person.name || 'User';
          const color = (person.color || '').toLowerCase();
          for (const [oldId, other] of avatars) {
            if (seen.has(oldId)) continue;
            if (!!other.userData.isCharacter !== useCharacter) continue;
            if ((other.userData.personName || '') !== baseName) continue;
            // Character clones keep the Part color; only sphere avatars match on profile color.
            if (!useCharacter) {
              const otherColor = other.userData.body?.material?.color?.getHexString?.() || '';
              if (color && otherColor && color.replace(/^#/, '') !== otherColor.toLowerCase()) continue;
            }
            avatar = other;
            avatars.delete(oldId);
            avatars.set(person.id, avatar);
            break;
          }
        }
        if (!avatar) {
          avatar = useCharacter
            ? makeCharacterAvatar(character, person.color || '#5b9dff')
            : makeAvatar(person.color || '#5b9dff');
          avatars.set(person.id, avatar);
          if (useCharacter) ensureRemoteCollider(avatar, character);
          const saved = takeAvatarStash(person);
          if (saved?.position?.length >= 3) {
            avatar.position.set(saved.position[0], saved.position[1], saved.position[2]);
            if (saved.goal?.length >= 3) avatar.userData.goal.set(saved.goal[0], saved.goal[1], saved.goal[2]);
            else avatar.userData.goal.copy(avatar.position);
            if (saved.look?.length >= 3) avatar.userData.look.set(saved.look[0], saved.look[1], saved.look[2]);
            if (saved.quaternion?.length >= 4) {
              avatar.quaternion.set(saved.quaternion[0], saved.quaternion[1], saved.quaternion[2], saved.quaternion[3]);
            }
          } else {
            avatar.position.set(person.position[0], person.position[1], person.position[2]);
            avatar.userData.goal.copy(avatar.position);
          }
        }
        avatar.userData.missingSince = 0;
        avatar.userData.personName = person.name || 'User';
        if (!avatar.userData.isCharacter) {
          avatar.userData.body.material.color.set(person.color || '#5b9dff');
        } else if (person.color && /^#[0-9a-fA-F]{6}$/i.test(person.color)) {
          avatar.userData.body.material.emissive?.set?.(person.color);
        }
        const afk = person.afk || (Number.isFinite(person.activeAt) && wall - person.activeAt > AFK_MS);
        const baseName = person.name || 'User';
        const label = afk ? `${baseName} (AFK)` : baseName;
        if (avatar.userData.label.userData.text !== label) {
          avatar.userData.label.userData.text = label;
          avatar.userData.label.userData.draw(label);
          avatar.userData.label.userData.texture.needsUpdate = true;
        }
        const nextX = person.position[0];
        const nextY = person.position[1];
        const nextZ = person.position[2];
        // Ignore one-frame spawn flashes ([0,2,8]) while a real pose is in flight.
        const looksDefault = Math.abs(nextX) < 0.05 && Math.abs(nextY - 2) < 0.05 && Math.abs(nextZ - 8) < 0.05;
        const dx = nextX - avatar.position.x;
        const dy = nextY - avatar.position.y;
        const dz = nextZ - avatar.position.z;
        const farFromAvatar = (dx * dx + dy * dy + dz * dz) > 1;
        if (looksDefault && farFromAvatar && avatar.position.lengthSq() > 1) {
          avatar.userData.goal.copy(avatar.position);
        } else {
          avatar.userData.goal.set(nextX, nextY, nextZ);
        }
        const facing = person.forward;
        if (Array.isArray(facing) && facing.length >= 3) avatar.userData.look.set(facing[0], facing[1], facing[2]);
        if (!afk && Array.isArray(person.pointer) && person.pointer.length >= 3) {
          avatar.userData.aim.set(person.pointer[0], person.pointer[1], person.pointer[2]);
          avatar.userData.hasAim = true;
        } else {
          avatar.userData.hasAim = false;
        }
        avatar.userData.activeAt = Number.isFinite(person.activeAt) ? person.activeAt : wall;
        avatar.userData.afk = afk;
        if (useCharacter) ensureRemoteCollider(avatar, character);
        else releaseRemoteCollider(avatar);
      }
      for (const [id, avatar] of avatars) {
        if (seen.has(id)) continue;
        if (!avatar.userData.missingSince) avatar.userData.missingSince = wall;
        // Keep them for a moment across hot-reload presence gaps.
        if (wall - avatar.userData.missingSince < 2500) continue;
        disposeAvatar(avatar);
        avatars.delete(id);
      }
      const blend = 1 - Math.exp(-10 * dt);
      const lookBlend = 1 - Math.exp(-8 * dt);
      for (const avatar of avatars.values()) {
        avatar.position.lerp(avatar.userData.goal, blend);
        if (avatar.userData.look.lengthSq() > 1e-6) {
          if (avatar.userData.isCharacter) {
            // Yaw-only facing so the Part stays upright like the local pawn.
            const flatX = avatar.userData.look.x;
            const flatZ = avatar.userData.look.z;
            if (flatX * flatX + flatZ * flatZ > 1e-6) {
              const faceYaw = Math.atan2(-flatX, -flatZ);
              avatar.userData.goalQuat.setFromEuler(new THREE.Euler(0, faceYaw, 0));
              avatar.quaternion.slerp(avatar.userData.goalQuat, lookBlend);
            }
          } else {
            lookAt.copy(avatar.position).add(avatar.userData.look);
            lookScratch.position.copy(avatar.position);
            lookScratch.up.set(0, 1, 0);
            lookScratch.lookAt(lookAt);
            avatar.userData.goalQuat.copy(lookScratch.quaternion);
            avatar.quaternion.slerp(avatar.userData.goalQuat, lookBlend);
          }
        }
        const dist = camera.position.distanceTo(avatar.position);
        let opacity = 1;
        if (dist < CLOSE_FADE_START) {
          opacity = dist <= CLOSE_FADE_END
            ? 0.08
            : 0.08 + 0.92 * ((dist - CLOSE_FADE_END) / (CLOSE_FADE_START - CLOSE_FADE_END));
        }
        if (wall - avatar.userData.activeAt > AFK_MS) opacity *= 0.35;
        setAvatarOpacity(avatar, opacity);
        const labelScale = avatar.userData.baseLabelScale;
        const tag = Math.min(14, Math.max(3.2, dist * 0.22));
        const ratio = tag / 7.2;
        avatar.userData.label.scale.set(labelScale.x * ratio, labelScale.y * ratio, 1);
        const labelHeight = avatar.userData.labelHeight || 2.85;
        avatar.userData.label.position.y = labelHeight + Math.min(2.5, dist * 0.02);
        if (avatar.userData.eyes?.length) {
          aimPupils(avatar, dt);
          const squash = stepBlink(avatar.userData.blink, now, dt);
          for (const eye of avatar.userData.eyes) eye.scale.y = squash;
        }
      }
      syncBeams(now);
      syncRemoteOutlines();
      syncPointerDots();
    }

    let emptyPresenceTimer = 0;
    if (Array.isArray(window.__gwPresenceRaw) && window.__gwPresenceRaw.length) {
      presenceRaw = window.__gwPresenceRaw;
      applyPresenceFilter();
    }
    api.bus.on('project:presence', (list) => {
      if (!Array.isArray(list)) return;
      // Hot reload can briefly publish []. Ignore that flash so remotes do not
      // get destroyed and recreated at a new spot.
      if (!list.length && presenceRaw.length) {
        if (emptyPresenceTimer) clearTimeout(emptyPresenceTimer);
        emptyPresenceTimer = setTimeout(() => {
          emptyPresenceTimer = 0;
          presenceRaw = [];
          window.__gwPresenceRaw = presenceRaw;
          applyPresenceFilter();
        }, 1500);
        return;
      }
      if (emptyPresenceTimer) {
        clearTimeout(emptyPresenceTimer);
        emptyPresenceTimer = 0;
      }
      presenceRaw = list;
      window.__gwPresenceRaw = presenceRaw;
      applyPresenceFilter();
    });
    api.bus.on('camera:home', () => resetView());
    api.bus.emit('project:presence-request');

    delete window.__gwShadows;

    // Hidden body at the camera. Only the shadow map draws it, so this PC
    // still sees the same sphere shadow that everyone else sees for you.
    const localAvatar = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 24, 16),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    localAvatar.customDepthMaterial = new THREE.MeshDepthMaterial();
    localAvatar.castShadow = true;
    localAvatar.receiveShadow = false;
    localAvatar.frustumCulled = false;
    localAvatar.raycast = () => {};
    scene.add(localAvatar);

    const shadowBox = new THREE.Box3();
    const nearShadowBox = new THREE.Box3();
    const shadowCenter = new THREE.Vector3();
    const shadowSize = new THREE.Vector3();
    const shadowPoint = new THREE.Vector3();
    const nearFocus = new THREE.Vector3();
    const shadowLightDir = sunOffset.clone().normalize();
    const shadowCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
    const NEAR_CASCADE = 72;

    function expandShadowSphere(box, center, radius) {
      box.expandByPoint(shadowPoint.set(center.x - radius, center.y - radius, center.z - radius));
      box.expandByPoint(shadowPoint.set(center.x + radius, center.y + radius, center.z + radius));
    }

    function padShadowBox(box) {
      const groundY = Math.min(0, box.min.y);
      const height = Math.max(4, box.max.y - groundY);
      const reach = height * 1.2 + 8;
      box.min.x -= Math.abs(shadowLightDir.x) * reach + 8;
      box.max.x += Math.abs(shadowLightDir.x) * reach + 8;
      box.min.z -= Math.abs(shadowLightDir.z) * reach + 8;
      box.max.z += Math.abs(shadowLightDir.z) * reach + 8;
      box.min.y = Math.min(box.min.y, groundY - 2);
      box.max.y += 6;
    }

    function fitLightToBox(light, box, maxSpan) {
      box.getCenter(shadowCenter);
      box.getSize(shadowSize);
      const radius = Math.max(shadowSize.x, shadowSize.y, shadowSize.z) * 0.5;
      light.target.position.copy(shadowCenter);
      light.position.copy(shadowCenter).addScaledVector(shadowLightDir, Math.max(140, radius + 160));
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();

      const shadowCamera = light.shadow.camera;
      shadowCamera.position.copy(light.position);
      shadowCamera.up.set(0, 1, 0);
      shadowCamera.lookAt(light.target.position);
      shadowCamera.updateMatrixWorld();
      const view = shadowCamera.matrixWorldInverse;
      const min = box.min;
      const max = box.max;
      let corner = 0;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            shadowCorners[corner].set(x, y, z).applyMatrix4(view);
            corner += 1;
          }
        }
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const point of shadowCorners) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
      const pad = 4;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;
      let spanX = Math.max(20, maxX - minX);
      let spanY = Math.max(20, maxY - minY);
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      if (spanX > maxSpan) spanX = maxSpan;
      if (spanY > maxSpan) spanY = maxSpan;
      const texelX = spanX / light.shadow.mapSize.x;
      const texelY = spanY / light.shadow.mapSize.y;
      const snappedMinX = Math.floor((midX - spanX / 2) / texelX) * texelX;
      const snappedMinY = Math.floor((midY - spanY / 2) / texelY) * texelY;
      shadowCamera.left = snappedMinX;
      shadowCamera.right = snappedMinX + Math.ceil(spanX / texelX) * texelX;
      shadowCamera.bottom = snappedMinY;
      shadowCamera.top = snappedMinY + Math.ceil(spanY / texelY) * texelY;
      shadowCamera.near = Math.max(0.5, -maxZ - 24);
      shadowCamera.far = Math.max(shadowCamera.near + 24, -minZ + 24);
      shadowCamera.updateProjectionMatrix();
      const texel = Math.max(shadowCamera.right - shadowCamera.left, shadowCamera.top - shadowCamera.bottom) / light.shadow.mapSize.x;
      light.shadow.normalBias = Math.min(0.35, Math.max(0.02, texel * 1.35));
      light.shadow.bias = -Math.min(0.00035, Math.max(0.00004, texel * 0.0009));
    }

    // Near cascade stays tight around the camera for crisp close shadows.
    // Far cascade covers every caster so distant shadows do not drop out.
    function fitSunShadow() {
      shadowBox.makeEmpty();
      nearShadowBox.makeEmpty();
      camera.getWorldDirection(forward);
      nearFocus.copy(camera.position).addScaledVector(forward, NEAR_CASCADE * 0.45);
      for (const model of models) {
        if (model.userData.kind === 'baseplate') continue;
        shadowBox.expandByObject(model);
        model.getWorldPosition(shadowPoint);
        if (shadowPoint.distanceTo(nearFocus) <= NEAR_CASCADE + 24) nearShadowBox.expandByObject(model);
      }
      for (const avatar of avatars.values()) {
        expandShadowSphere(shadowBox, avatar.position, 1.6);
        if (avatar.position.distanceTo(nearFocus) <= NEAR_CASCADE + 8) {
          expandShadowSphere(nearShadowBox, avatar.position, 1.6);
        }
      }
      expandShadowSphere(shadowBox, localAvatar.position, 1.6);
      expandShadowSphere(nearShadowBox, localAvatar.position, 1.6);
      if (shadowBox.isEmpty()) {
        shadowCenter.copy(camera.position);
        shadowBox.setFromCenterAndSize(shadowCenter, shadowSize.set(48, 48, 48));
      }
      if (nearShadowBox.isEmpty()) {
        nearShadowBox.setFromCenterAndSize(nearFocus, shadowSize.set(NEAR_CASCADE, NEAR_CASCADE, NEAR_CASCADE));
      }
      padShadowBox(shadowBox);
      padShadowBox(nearShadowBox);
      fitLightToBox(sun, nearShadowBox, NEAR_CASCADE * 2);
      fitLightToBox(sunFar, shadowBox, 520);
    }

    publishSelection();

    let last = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      const moveCfg = liveMoveConfig();
      if (!typing && !isLive() && moveCfg.allowed && (keys.w || keys.a || keys.s || keys.d || keys.q || keys.e)) {
        // Edit Mode freecam only.
        camera.getWorldDirection(forward);
        right.setFromMatrixColumn(camera.matrix, 0);
        move.set(0, 0, 0);
        if (keys.w) move.add(forward);
        if (keys.s) move.sub(forward);
        if (keys.d) move.add(right);
        if (keys.a) move.sub(right);
        if (keys.e) move.y += 1;
        if (keys.q) move.y -= 1;
        if (move.lengthSq() > 0) {
          const speed = (keys.shift ? 3.2 : 1.15) * Math.max(24, distance);
          move.normalize().multiplyScalar(speed * dt);
          camera.position.add(move);
          target.add(move);
          hideHint();
        }
      }
      // Live Mode: no built-in character movement — Scripts control the pawn.
      sky.position.copy(camera.position);
      if (now - poseSent > 100) {
        poseSent = now;
        try {
          const moving = !!(keys.w || keys.a || keys.s || keys.d || keys.q || keys.e || keys.space);
          const livePawn = isLive() ? liveMoveConfig().pawn : null;
          if (livePawn) {
            livePawn.updateMatrixWorld(true);
            livePawn.getWorldPosition(_a);
            poseForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
            api.bus.emit('presence:pose', {
              position: [_a.x, _a.y, _a.z],
              forward: [poseForward.x, poseForward.y, poseForward.z],
              pointer: pointerHit(),
              active: moving || (now - inputAt < 1500),
            });
          } else {
            camera.getWorldDirection(poseForward);
            api.bus.emit('presence:pose', {
              position: [camera.position.x, camera.position.y, camera.position.z],
              forward: [poseForward.x, poseForward.y, poseForward.z],
              pointer: pointerHit(),
              active: moving || (now - inputAt < 1500),
            });
          }
          saveCamera();
        } catch (err) {
          // Presence must never abort the render loop (that freezes push/pull previews).
          api.log(err);
        }
      }
      // Remotes update first so their colliders exist before the local pawn steps.
      updateAvatars(now, dt);
      syncRemoteColliders();
      stepPhysics(dt);
      if (isLive()) {
        try { api.bus.emit('script:tick', dt); } catch (err) { api.log(err); }
        updateLiveCamera();
      }
      const shadowPawn = isLive() ? liveMoveConfig().pawn : null;
      if (shadowPawn) {
        // The playable Part already casts a shadow — hide the edit-mode sphere caster.
        localAvatar.visible = false;
      } else {
        localAvatar.visible = true;
        localAvatar.position.copy(camera.position);
        localAvatar.updateMatrixWorld(true);
      }
      if (!fullbright) fitSunShadow();
      syncTools();
      if (fullbright) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      } else {
        post.render(scene, camera);
      }
      drawGizmo();
    };
    raf = requestAnimationFrame(frame);

    async function writeExport(target) {
      const materials = new Map();
      const baseName = target.split(/[/\\]/).pop();
      const mtlFile = /\.obj$/i.test(baseName) ? baseName.replace(/\.obj$/i, '.mtl') : `${baseName}.mtl`;
      const lines = ['# GameWindow export', `mtllib ${mtlFile}`];
      const corner = new THREE.Vector3();
      let vertex = 1;
      for (const model of models) {
        model.updateWorldMatrix(true, true);
        model.traverse((mesh) => {
          if (!mesh.isMesh || !mesh.geometry) return;
          const geo = mesh.geometry;
          const pos = geo.getAttribute('position');
          if (!pos) return;
          const index = geo.getIndex();
          const groups = geo.groups?.length
            ? geo.groups
            : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
          const mats = [].concat(mesh.material || []);
          lines.push(`o ${(model.name || model.userData.kind || 'Object').replace(/\s+/g, '_')}`);
          for (let i = 0; i < pos.count; i++) {
            corner.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            lines.push(`v ${corner.x.toFixed(5)} ${corner.y.toFixed(5)} ${corner.z.toFixed(5)}`);
          }
          for (const group of groups) {
            const mat = mats[group.materialIndex] || mats[0];
            const hex = mat?.color ? mat.color.getHexString() : 'b1b2b5';
            if (!materials.has(hex)) materials.set(hex, `color_${hex}`);
            lines.push(`usemtl ${materials.get(hex)}`);
            const end = group.start + group.count;
            if (index) {
              for (let i = group.start; i + 2 < end; i += 3) {
                lines.push(`f ${vertex + index.getX(i)} ${vertex + index.getX(i + 1)} ${vertex + index.getX(i + 2)}`);
              }
            } else {
              for (let i = group.start; i + 2 < end; i += 3) {
                lines.push(`f ${vertex + i} ${vertex + i + 1} ${vertex + i + 2}`);
              }
            }
          }
          vertex += pos.count;
        });
      }
      const mtl = ['# GameWindow materials'];
      for (const [hex, name] of materials) {
        const r = (parseInt(hex.slice(0, 2), 16) / 255).toFixed(4);
        const g = (parseInt(hex.slice(2, 4), 16) / 255).toFixed(4);
        const b = (parseInt(hex.slice(4, 6), 16) / 255).toFixed(4);
        mtl.push(`newmtl ${name}`, `Kd ${r} ${g} ${b}`, 'illum 2');
      }
      const mtlPath = /\.obj$/i.test(target) ? target.replace(/\.obj$/i, '.mtl') : `${target}.mtl`;
      await api.host.fs.write(target, `${lines.join('\n')}\n`);
      await api.host.fs.write(mtlPath, `${mtl.join('\n')}\n`);
    }

    api.bus.on('project:export', (target) => {
      if (typeof target !== 'string' || !target) return;
      writeExport(target).catch((err) => api.log(err));
    });

    return () => {
      if (window.__gwScriptApi) delete window.__gwScriptApi;
      saveCamera();
      stopPhysics();
      if (emptyPresenceTimer) clearTimeout(emptyPresenceTimer);
      sketch = null;
      sketchLine.removeFromParent();
      sketchLine.geometry.dispose();
      sketchLine.material.dispose();
      // Keep transforms across hot reload so remotes do not pop back to spawn.
      window.__gwAvatarState = [...avatars.entries()].map(([id, avatar]) => ({
        id,
        name: avatar.userData.personName || 'User',
        color: avatar.userData.body?.material?.color?.getHexString?.() || '',
        position: avatar.position.toArray(),
        goal: avatar.userData.goal?.toArray?.() || avatar.position.toArray(),
        look: avatar.userData.look?.toArray?.() || [0, 0, -1],
        quaternion: avatar.quaternion.toArray(),
      }));
      for (const avatar of avatars.values()) disposeAvatar(avatar);
      avatars.clear();
      for (const dot of pointerDots.values()) {
        dot.removeFromParent();
        dot.geometry.dispose();
        dot.material.dispose();
      }
      pointerDots.clear();
      for (const box of remoteOutlines.values()) disposeOutline(box);
      remoteOutlines.clear();
      for (const box of selectionBoxes) disposeOutline(box);
      selectionBoxes.length = 0;
      disposeOutline(hoverBox);
      lookScratch.removeFromParent();
      localAvatar.removeFromParent();
      localAvatar.geometry.dispose();
      localAvatar.material.dispose();
      localAvatar.customDepthMaterial.dispose();
      for (const bag of beamByUser.values()) {
        for (const beam of bag.values()) disposeBeam(beam);
      }
      beamByUser.clear();
      beamImage?.dispose();
      post.dispose();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      for (const [el, type, fn, opts] of listeners) el.removeEventListener(type, fn, opts);
      const seenG = new Set();
      const seenM = new Set();
      scene.traverse((obj) => {
        if (obj.geometry && !seenG.has(obj.geometry)) { seenG.add(obj.geometry); obj.geometry.dispose(); }
        const mats = obj.material ? [].concat(obj.material) : [];
        for (const m of mats) {
          if (seenM.has(m)) continue;
          seenM.add(m);
          if (m.map) m.map.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      marquee.remove();
    };
  },
};

// Grid is computed from world XZ, not a texture. Minor lines sit on exact multiples of
// 4 studs, major lines on exact multiples of 16. The 512 plate runs from -256 to 256,
// so both divide it evenly and every cell is a square.
function baseplateMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xa3a2a5, roughness: 0.92, metalness: 0 });
  mat.customProgramCacheKey = () => 'baseplate-grid';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vGridWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGridWorld;
float gridLine(vec2 xz, float cell, float thickness) {
  vec2 fw = max(fwidth(xz), vec2(1e-5));
  vec2 q = xz / cell;
  vec2 dist = (0.5 - abs(fract(q) - 0.5)) * cell;
  float d = min(dist.x / fw.x, dist.y / fw.y);
  float mask = 1.0 - smoothstep(thickness - 0.6, thickness + 0.6, d);
  float cellPx = cell / max(fw.x, fw.y);
  return mask * smoothstep(1.2, 2.8, cellPx);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 xz = vGridWorld.xz;
  float minor = gridLine(xz, 4.0, 1.0);
  float major = gridLine(xz, 16.0, 1.25);
  vec3 base = diffuseColor.rgb;
  diffuseColor.rgb = mix(base, base * 0.80, clamp(minor - major, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.62, major);
}`,
      );
  };
  return mat;
}

