// Editable solid: planar faces + shared vertices (SketchUp-style draw / push-pull).
import { ShapeUtils, Vector2 } from './three.module.js';

const EPS = 1e-6;

export function cloneSolid(solid) {
  if (!solid) return null;
  return {
    vertices: solid.vertices.map((v) => v.slice(0, 3)),
    faces: solid.faces.map((face) => ({
      id: face.id,
      verts: face.verts.slice(),
      holes: Array.isArray(face.holes) ? face.holes.map((hole) => hole.slice()) : undefined,
      bordered: face.bordered ? true : undefined,
      rim: Array.isArray(face.rim) ? face.rim.slice() : undefined,
      wallOf: face.wallOf || undefined,
    })),
    nextFace: solid.nextFace || solid.faces.length + 1,
  };
}

export function boxSolid(w, h, d) {
  const x = Math.max(0.2, w) / 2;
  const y = Math.max(0.2, h) / 2;
  const z = Math.max(0.2, d) / 2;
  const vertices = [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z],
    [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z],
  ];
  const faces = [
    { id: 'f1', verts: [0, 1, 2, 3] },
    { id: 'f2', verts: [4, 7, 6, 5] },
    { id: 'f3', verts: [0, 4, 5, 1] },
    { id: 'f4', verts: [3, 2, 6, 7] },
    { id: 'f5', verts: [0, 3, 7, 4] },
    { id: 'f6', verts: [1, 5, 6, 2] },
  ];
  return { vertices, faces, nextFace: 7 };
}

export function boundsOfSolid(solid) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of solid.vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [Math.max(0.2, maxX - minX), Math.max(0.2, maxY - minY), Math.max(0.2, maxZ - minZ)],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

/** Scale solid vertices about the bounds center (local space). */
export function scaleSolid(solid, sx = 1, sy = 1, sz = 1) {
  if (!solid) return null;
  const next = cloneSolid(solid);
  const box = boundsOfSolid(next);
  const c = box.center;
  const fx = Number.isFinite(sx) && sx > 1e-6 ? sx : 1;
  const fy = Number.isFinite(sy) && sy > 1e-6 ? sy : 1;
  const fz = Number.isFinite(sz) && sz > 1e-6 ? sz : 1;
  if (Math.abs(fx - 1) < 1e-12 && Math.abs(fy - 1) < 1e-12 && Math.abs(fz - 1) < 1e-12) return next;
  for (const v of next.vertices) {
    v[0] = c[0] + (v[0] - c[0]) * fx;
    v[1] = c[1] + (v[1] - c[1]) * fy;
    v[2] = c[2] + (v[2] - c[2]) * fz;
  }
  return next;
}

function faceNormal(solid, face) {
  const a = solid.vertices[face.verts[0]];
  const b = solid.vertices[face.verts[1]];
  const c = solid.vertices[face.verts[2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function faceFrame(solid, face) {
  const origin = solid.vertices[face.verts[0]].slice();
  const normal = faceNormal(solid, face);
  // IngeTrazo-style: project world +X onto the plane (or +Y if near-parallel).
  let ref = [1, 0, 0];
  let tangent = [
    ref[0] - normal[0] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
    ref[1] - normal[1] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
    ref[2] - normal[2] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
  ];
  if (Math.hypot(tangent[0], tangent[1], tangent[2]) < 0.1) {
    ref = [0, 1, 0];
    tangent = [
      ref[0] - normal[0] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
      ref[1] - normal[1] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
      ref[2] - normal[2] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]),
    ];
  }
  const tl = Math.hypot(tangent[0], tangent[1], tangent[2]) || 1;
  tangent = [tangent[0] / tl, tangent[1] / tl, tangent[2] / tl];
  const bitangent = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ];
  const bl = Math.hypot(bitangent[0], bitangent[1], bitangent[2]) || 1;
  return {
    origin,
    normal,
    tangent,
    bitangent: [bitangent[0] / bl, bitangent[1] / bl, bitangent[2] / bl],
  };
}

export function projectToFace(solid, faceId, point) {
  const face = solid.faces.find((item) => item.id === faceId);
  if (!face) return null;
  const frame = faceFrame(solid, face);
  const rel = [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]];
  const u = rel[0] * frame.tangent[0] + rel[1] * frame.tangent[1] + rel[2] * frame.tangent[2];
  const v = rel[0] * frame.bitangent[0] + rel[1] * frame.bitangent[1] + rel[2] * frame.bitangent[2];
  const world = [
    frame.origin[0] + frame.tangent[0] * u + frame.bitangent[0] * v,
    frame.origin[1] + frame.tangent[1] * u + frame.bitangent[1] * v,
    frame.origin[2] + frame.tangent[2] * u + frame.bitangent[2] * v,
  ];
  return { u, v, world, frame, face };
}

function findOrAddVertex(solid, point, weld = 0.05) {
  for (let i = 0; i < solid.vertices.length; i++) {
    const v = solid.vertices[i];
    if (Math.hypot(v[0] - point[0], v[1] - point[1], v[2] - point[2]) <= weld) return i;
  }
  solid.vertices.push(point.slice(0, 3));
  return solid.vertices.length - 1;
}

function pointInPoly2(poly, u, v) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ui = poly[i][0];
    const vi = poly[i][1];
    const uj = poly[j][0];
    const vj = poly[j][1];
    const intersect = ((vi > v) !== (vj > v)) && (u < ((uj - ui) * (v - vi)) / ((vj - vi) || EPS) + ui);
    if (intersect) inside = !inside;
  }
  return inside;
}

function toUV(solid, frame, index) {
  const p = solid.vertices[index];
  const rel = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]];
  return [
    rel[0] * frame.tangent[0] + rel[1] * frame.tangent[1] + rel[2] * frame.tangent[2],
    rel[0] * frame.bitangent[0] + rel[1] * frame.bitangent[1] + rel[2] * frame.bitangent[2],
  ];
}

/**
 * Triangulate a face (with optional holes) via Three's earcut.
 * Custom keyhole ear-clip left diagonal gaps on parent faces after drawing.
 */
function triangulateFace(solid, face) {
  if (face.verts.length < 3) return [];
  const frame = faceFrame(solid, face);
  const map = [];
  const contour = [];
  for (const index of face.verts) {
    const uv = toUV(solid, frame, index);
    contour.push(new Vector2(uv[0], uv[1]));
    map.push(index);
  }
  // Earcut expects outer CCW.
  if (ShapeUtils.isClockWise(contour)) {
    contour.reverse();
    map.reverse();
  }

  const holePts = [];
  const holes = Array.isArray(face.holes) ? face.holes : [];
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    const pts = [];
    const holeMap = [];
    for (const index of hole) {
      const uv = toUV(solid, frame, index);
      pts.push(new Vector2(uv[0], uv[1]));
      holeMap.push(index);
    }
    // Holes CW.
    if (!ShapeUtils.isClockWise(pts)) {
      pts.reverse();
      holeMap.reverse();
    }
    holePts.push(pts);
    map.push(...holeMap);
  }

  const faces = ShapeUtils.triangulateShape(contour, holePts);
  const tris = [];
  for (const tri of faces) {
    if (tri.length < 3) continue;
    tris.push(map[tri[0]], map[tri[1]], map[tri[2]]);
  }
  return tris;
}

/** Visible boundary edges only (outer rings + holes). No triangulation bridges. */
export function solidEdgePositions(solid) {
  const data = [];
  const pushRing = (ring) => {
    if (!ring || ring.length < 2) return;
    for (let i = 0; i < ring.length; i++) {
      const a = solid.vertices[ring[i]];
      const b = solid.vertices[ring[(i + 1) % ring.length]];
      data.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  };
  for (const face of solid.faces) {
    pushRing(face.verts);
    if (Array.isArray(face.holes)) for (const hole of face.holes) pushRing(hole);
  }
  return data;
}

function ringToUV(solid, frame, ring) {
  return ring.map((index) => toUV(solid, frame, index));
}

/** True if (u,v) lies in the drawable region of a face (inside outer, outside holes). */
function pointInFaceRegion(solid, face, frame, u, v) {
  const outer2 = ringToUV(solid, frame, face.verts);
  if (!pointInPoly2(outer2, u, v)) return false;
  if (Array.isArray(face.holes)) {
    for (const hole of face.holes) {
      if (pointInPoly2(ringToUV(solid, frame, hole), u, v)) return false;
    }
  }
  return true;
}

/** Insert a closed loop on a face: outer gains a hole, new face is the island.
 *  Supports multiple loops on the same face (IngeTrazo / SketchUp parity). */
export function splitFaceWithLoop(solid, faceId, loopPoints) {
  const next = cloneSolid(solid);
  const faceIndex = next.faces.findIndex((face) => face.id === faceId);
  if (faceIndex < 0 || !loopPoints || loopPoints.length < 3) return null;
  const face = next.faces[faceIndex];
  const frame = faceFrame(next, face);
  const innerIdx = [];
  const inner2 = [];
  for (const point of loopPoints) {
    const projected = projectToFace(next, faceId, point);
    if (!projected) return null;
    if (!pointInFaceRegion(next, face, frame, projected.u, projected.v)) return null;
    innerIdx.push(findOrAddVertex(next, projected.world));
    inner2.push([projected.u, projected.v]);
  }
  let area = 0;
  for (let i = 0; i < inner2.length; i++) {
    const a = inner2[i];
    const b = inner2[(i + 1) % inner2.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 0.01) return null;

  // Reject loops that cross existing holes (centroid + mid-edges in region).
  let cu = 0;
  let cv = 0;
  for (const p of inner2) {
    cu += p[0];
    cv += p[1];
  }
  cu /= inner2.length;
  cv /= inner2.length;
  if (!pointInFaceRegion(next, face, frame, cu, cv)) return null;

  const innerId = `f${next.nextFace++}`;
  const holes = Array.isArray(face.holes) ? face.holes.map((hole) => hole.slice()) : [];
  holes.push(innerIdx.slice());
  const outerFace = {
    id: face.id,
    verts: face.verts.slice(),
    holes,
  };
  // Island winding matches the original face normal. bordered = embedded in a parent face
  // (IngeTrazo "attached"): push/pull makes walls / through-holes instead of moving shared verts.
  const island = {
    id: innerId,
    verts: area > 0 ? innerIdx.slice() : innerIdx.slice().reverse(),
    bordered: true,
    rim: innerIdx.slice(), // stable parent-hole ring (survives push/pull)
  };
  next.faces.splice(faceIndex, 1, outerFace, island);
  return { solid: next, faceId: innerId };
}

function faceCentroid(solid, face) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of face.verts) {
    const v = solid.vertices[index];
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const n = face.verts.length || 1;
  return [x / n, y / n, z / n];
}

function sameRing(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((index) => set.has(index));
}

function isIslandFace(solid, face) {
  if (face.bordered) return true;
  return solid.faces.some((other) => other.holes?.some((hole) => sameRing(hole, face.verts)));
}

/** Inward thickness of the solid along a face normal (bbox), from the face plane. */
function inwardThickness(solid, normal, origin) {
  let min = 0;
  for (const v of solid.vertices) {
    const d = (v[0] - origin[0]) * normal[0]
      + (v[1] - origin[1]) * normal[1]
      + (v[2] - origin[2]) * normal[2];
    if (d < min) min = d;
  }
  return Math.max(0.05, -min);
}

/**
 * Depth from a face to the nearest parallel opposite face (IngeTrazo through-face).
 * Prefers faces whose normal opposes ours and that lie inward along -normal.
 * Ray probes first so thin slabs still punch through even when other faces are messy.
 */
export function oppositeDepth(solid, faceId) {
  const face = solid.faces.find((item) => item.id === faceId);
  if (!face) return null;
  const normal = faceNormal(solid, face);
  const rim = (face.rim && face.rim.length) ? face.rim : face.verts;
  const c = faceCentroid(solid, { verts: rim });
  const maxDepth = inwardThickness(solid, normal, c);

  // Skip the island and its parent (same plane) — otherwise the probe "hits" the
  // face it started on and reports a near-zero depth.
  const skipIds = new Set([faceId]);
  for (const other of solid.faces) {
    if (other.id === faceId) continue;
    if (other.holes?.some((hole) => sameRing(hole, rim) || sameRing(hole, face.verts))) {
      skipIds.add(other.id);
      continue;
    }
    const on = faceNormal(solid, other);
    const align = on[0] * normal[0] + on[1] * normal[1] + on[2] * normal[2];
    if (Math.abs(align) < 0.98) continue;
    const p0 = solid.vertices[other.verts[0]];
    if (!p0) continue;
    const planeDist = (p0[0] - c[0]) * normal[0]
      + (p0[1] - c[1]) * normal[1]
      + (p0[2] - c[2]) * normal[2];
    if (Math.abs(planeDist) < 0.08) skipIds.add(other.id);
  }

  // Ray from just inside the face toward the far side — most reliable for cutouts.
  const dir = [-normal[0], -normal[1], -normal[2]];
  const probes = [c];
  for (const index of rim) {
    const v = solid.vertices[index];
    if (!v) continue;
    probes.push([
      (v[0] + c[0]) * 0.5,
      (v[1] + c[1]) * 0.5,
      (v[2] + c[2]) * 0.5,
    ]);
  }
  let rayBest = null;
  for (const probe of probes) {
    const origin = [
      probe[0] - normal[0] * 0.08,
      probe[1] - normal[1] * 0.08,
      probe[2] - normal[2] * 0.08,
    ];
    // hitSolid only excludes one id — pick the nearest hit that isn't skipped.
    const { positions, faceMap } = solidToGeometry(solid);
    let hit = null;
    for (let i = 0; i < positions.length; i += 9) {
      const faceIndex = faceMap[i / 3];
      const hitFace = solid.faces[faceIndex];
      if (!hitFace || skipIds.has(hitFace.id)) continue;
      const tri = rayTriangle(
        origin,
        dir,
        [positions[i], positions[i + 1], positions[i + 2]],
        [positions[i + 3], positions[i + 4], positions[i + 5]],
        [positions[i + 6], positions[i + 7], positions[i + 8]],
      );
      if (!tri || tri.t <= 0.02) continue;
      if (!hit || tri.t < hit.t) {
        hit = { t: tri.t, faceId: hitFace.id, face: hitFace, point: tri.point };
      }
    }
    if (!hit) continue;
    const depth = Math.min(maxDepth, hit.t + 0.08);
    if (depth < 0.1) continue;
    if (!rayBest || depth < rayBest.depth) {
      const hitFace = hit.face;
      const on = faceNormal(solid, hitFace);
      const planePoint = solid.vertices[hitFace.verts[0]].slice();
      rayBest = {
        depth,
        faceId: hit.faceId,
        face: hitFace,
        normal,
        planeNormal: on,
        planePoint,
      };
    }
  }
  if (rayBest) return rayBest;

  let best = null;
  for (const other of solid.faces) {
    if (other.id === faceId) continue;
    if (other.wallOf) continue;
    const on = faceNormal(solid, other);
    const align = on[0] * normal[0] + on[1] * normal[1] + on[2] * normal[2];
    if (align > -0.85) continue; // not opposite-parallel
    // Plane distance from face origin to the other face (not centroid — holes shift those).
    const p0 = solid.vertices[other.verts[0]];
    if (!p0) continue;
    const toOther = (p0[0] - c[0]) * normal[0]
      + (p0[1] - c[1]) * normal[1]
      + (p0[2] - c[2]) * normal[2];
    if (toOther >= -EPS) continue; // coplanar or outward
    const depth = Math.min(maxDepth, -toOther);
    if (!best || depth < best.depth) {
      best = {
        depth,
        faceId: other.id,
        face: other,
        normal,
        planeNormal: on,
        planePoint: p0.slice(),
      };
    }
  }
  if (best) return best;

  // Last resort: punch through the bbox thickness.
  return {
    depth: maxDepth,
    faceId: null,
    face: null,
    normal,
    planeNormal: [-normal[0], -normal[1], -normal[2]],
    planePoint: [
      c[0] - normal[0] * maxDepth,
      c[1] - normal[1] * maxDepth,
      c[2] - normal[2] * maxDepth,
    ],
  };
}

/**
 * Push/pull a face. Pull (distance > 0) extrudes outward.
 * Push (distance < 0) recesses; past the opposite face becomes a through-cutout
 * for bordered islands (SketchUp / IngeTrazo) instead of poking out the far side.
 * Whole (non-island) faces move shared vertices so adjacent faces follow.
 */
export function extrudeFace(solid, faceId, distance) {
  const face = solid.faces.find((item) => item.id === faceId);
  if (!face || Math.abs(distance) < EPS) return null;
  if (face.holes?.length) return null;

  const island = isIslandFace(solid, face);
  const opp = (distance < 0) ? oppositeDepth(solid, faceId) : null;

  // Through-cut when pushing an island past (or flush with) the opposite face.
  // Rim-plane thickness so a deep drag never pokes a solid finger out the back.
  if (distance < 0 && island && opp && -distance >= opp.depth * 0.92) {
    return cutThrough(solid, faceId, opp);
  }

  const next = cloneSolid(solid);
  const live = next.faces.find((item) => item.id === faceId);
  const normal = faceNormal(next, live);

  // Outer face of a solid: move shared verts (sides shrink/grow with the face).
  if (!island) {
    let dist = distance;
    if (dist < 0 && opp) {
      if (-dist >= opp.depth - 0.05) dist = -(Math.max(0.05, opp.depth - 0.05));
    }
    for (const index of live.verts) {
      const v = next.vertices[index];
      v[0] += normal[0] * dist;
      v[1] += normal[1] * dist;
      v[2] += normal[2] * dist;
    }
    return next;
  }

  // Bordered island: walls always run from the stable rim to the moved cap.
  // Drop prior extrusion walls so pull-then-push doesn't leave a protruding shell.
  const rim = (live.rim && live.rim.length === live.verts.length) ? live.rim : live.verts;
  stripIslandWalls(next, faceId, live);

  // Overshooting the far plane must punch through — never keep growing a spike.
  if (distance < 0 && opp && -distance >= opp.depth - 0.02) {
    return cutThrough(solid, faceId, opp);
  }

  const newVerts = live.verts.map((index) => {
    const v = next.vertices[index];
    const moved = [
      v[0] + normal[0] * distance,
      v[1] + normal[1] * distance,
      v[2] + normal[2] * distance,
    ];
    next.vertices.push(moved);
    return next.vertices.length - 1;
  });

  // Snap back to a flat island on the parent when the cap returns to the rim plane.
  let offset = 0;
  for (let i = 0; i < rim.length; i++) {
    const r = next.vertices[rim[i]];
    const c = next.vertices[newVerts[i]];
    offset += (c[0] - r[0]) * normal[0] + (c[1] - r[1]) * normal[1] + (c[2] - r[2]) * normal[2];
  }
  offset /= rim.length || 1;
  if (Math.abs(offset) < 0.04) {
    live.verts = rim.slice();
    return next;
  }

  // Pocket/tunnel walls face the opening axis; pulled walls face outward.
  const axis = faceCentroid(next, { verts: rim });
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % rim.length];
    const c = newVerts[(i + 1) % newVerts.length];
    const d = newVerts[i];
    const towardAxis = offset < 0;
    next.faces.push({
      id: `f${next.nextFace++}`,
      verts: orientWallQuad(next, a, b, c, d, axis, towardAxis),
      wallOf: faceId,
    });
  }
  live.verts = newVerts;
  if (!live.rim) live.rim = rim.slice();
  return next;
}

/** Remove extrusion side walls for an island (tagged wallOf, or any face on the pulled cap). */
function stripIslandWalls(solid, faceId, face) {
  const rim = face.rim || face.verts;
  const rimSet = new Set(rim);
  const capOnly = new Set((face.verts || []).filter((index) => !rimSet.has(index)));
  const rimKeys = new Set(ringEdges(rim));
  const capKeys = new Set(ringEdges(face.verts));
  solid.faces = solid.faces.filter((item) => {
    if (item.wallOf === faceId) return false;
    if (item.id === faceId) return true;
    if (item.bordered || item.holes?.length) return true;
    // Any face that still uses a pulled/recessed cap vertex is part of the old shell.
    if (capOnly.size && item.verts.some((index) => capOnly.has(index))) return false;
    if (!capOnly.size || item.verts.length !== 4) return true;
    const keys = ringEdges(item.verts);
    const hitRim = keys.some((key) => rimKeys.has(key));
    const hitCap = keys.some((key) => capKeys.has(key));
    return !(hitRim && hitCap);
  });
}

/** Punch a tunnel from the original rim to the far face; strip any prior pull/push walls. */
function cutThrough(solid, faceId, opp) {
  const next = cloneSolid(solid);
  const face = next.faces.find((item) => item.id === faceId);
  if (!face) return null;
  const normal = faceNormal(next, face);
  // Front of the tunnel is the parent hole rim — not a previously pulled cap.
  const rim = (face.rim && face.rim.length) ? face.rim.slice() : face.verts.slice();
  stripIslandWalls(next, faceId, face);
  next.faces = next.faces.filter((item) => item.id !== faceId);

  let back = opp.faceId ? next.faces.find((item) => item.id === opp.faceId) : null;
  const planeN = opp.planeNormal || (back ? faceNormal(next, back) : [-normal[0], -normal[1], -normal[2]]);
  const planeP = opp.planePoint || (back ? next.vertices[back.verts[0]].slice() : null);
  const depth = Math.max(0.05, opp.depth || 0.05);
  const newVerts = rim.map((index) => {
    const v = next.vertices[index];
    let point = null;
    if (planeP) {
      const denom = planeN[0] * -normal[0] + planeN[1] * -normal[1] + planeN[2] * -normal[2];
      if (Math.abs(denom) > EPS) {
        const t = ((planeP[0] - v[0]) * planeN[0] + (planeP[1] - v[1]) * planeN[1] + (planeP[2] - v[2]) * planeN[2]) / denom;
        // Keep the exit on the far plane — never beyond it.
        const clamped = Math.max(0.02, Math.min(depth + 0.05, t));
        point = [v[0] - normal[0] * clamped, v[1] - normal[1] * clamped, v[2] - normal[2] * clamped];
      }
    }
    if (!point) {
      point = [v[0] - normal[0] * depth, v[1] - normal[1] * depth, v[2] - normal[2] * depth];
    }
    return findOrAddVertex(next, point, 0.02);
  });

  // If we only had a plane (no face id), pick the face that owns the exit ring.
  if (!back) {
    const exit = next.vertices[newVerts[0]];
    let best = null;
    for (const other of next.faces) {
      if (other.wallOf || other.bordered) continue;
      const on = faceNormal(next, other);
      const align = on[0] * normal[0] + on[1] * normal[1] + on[2] * normal[2];
      if (align > -0.5) continue;
      const p0 = next.vertices[other.verts[0]];
      const dist = Math.abs(
        (exit[0] - p0[0]) * on[0] + (exit[1] - p0[1]) * on[1] + (exit[2] - p0[2]) * on[2],
      );
      if (dist > 0.15) continue;
      if (!best || dist < best.dist) best = { face: other, dist };
    }
    back = best?.face || null;
  }

  // Tunnel walls must face the bore (visible from inside the cutout).
  const axis = faceCentroid(next, { verts: rim });
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % rim.length];
    const c = newVerts[(i + 1) % newVerts.length];
    const d = newVerts[i];
    next.faces.push({
      id: `f${next.nextFace++}`,
      verts: orientWallQuad(next, a, b, c, d, axis, true),
    });
  }
  if (back) {
    if (!back.holes) back.holes = [];
    back.holes.push(newVerts.slice().reverse());
  } else {
    // No matching back face — still close the tunnel with an exit cap opening outward.
    next.faces.push({
      id: `f${next.nextFace++}`,
      verts: newVerts.slice().reverse(),
    });
  }
  return next;
}

/**
 * Build a wall quad between rim edge a-b and far edge d-c.
 * `faceTowardAxis` true → normal points toward axisPoint (tunnel/pocket interior).
 */
function orientWallQuad(solid, a, b, c, d, axisPoint, faceTowardAxis) {
  const pa = solid.vertices[a];
  const pb = solid.vertices[b];
  const pc = solid.vertices[c];
  const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const mid = [
    (pa[0] + pc[0]) * 0.5,
    (pa[1] + pc[1]) * 0.5,
    (pa[2] + pc[2]) * 0.5,
  ];
  const toAxis = [axisPoint[0] - mid[0], axisPoint[1] - mid[1], axisPoint[2] - mid[2]];
  const toward = n[0] * toAxis[0] + n[1] * toAxis[1] + n[2] * toAxis[2];
  if ((toward > 0) === !!faceTowardAxis) return [a, b, c, d];
  return [a, d, c, b];
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function ringEdges(ring) {
  const keys = [];
  if (!ring || ring.length < 2) return keys;
  for (let i = 0; i < ring.length; i++) {
    keys.push(edgeKey(ring[i], ring[(i + 1) % ring.length]));
  }
  return keys;
}

/**
 * Erase edges (IngeTrazo Eraser). Drawn contours erase as a whole:
 * any edge of a bordered island (or its rim/hole) deletes the island and heals the parent.
 * Erasing a through-hole rim removes that opening and wall faces that used the rim.
 */
export function eraseEdges(solid, pairs) {
  if (!solid || !pairs?.length) return null;
  const wanted = new Set(pairs.map(([a, b]) => edgeKey(a, b)));
  const next = cloneSolid(solid);
  const removeFaceIds = new Set();
  const holesToDrop = []; // { faceId, hole }

  const markIsland = (island) => {
    removeFaceIds.add(island.id);
    const rim = island.rim || island.verts;
    for (const other of next.faces) {
      if (!other.holes?.length) continue;
      for (const hole of other.holes) {
        if (sameRing(hole, rim) || sameRing(hole, island.verts)) {
          holesToDrop.push({ faceId: other.id, hole });
        }
      }
    }
  };

  for (const face of next.faces) {
    if (!face.bordered) continue;
    const keys = new Set([...ringEdges(face.verts), ...ringEdges(face.rim)]);
    if ([...keys].some((key) => wanted.has(key))) markIsland(face);
  }

  // Through-cut openings / leftover holes: erasing any rim edge drops the whole contour.
  for (const face of next.faces) {
    if (!face.holes?.length) continue;
    for (const hole of face.holes) {
      const keys = ringEdges(hole);
      if (!keys.some((key) => wanted.has(key))) continue;
      holesToDrop.push({ faceId: face.id, hole });
      for (const island of next.faces) {
        if (!island.bordered) continue;
        if (sameRing(island.rim || [], hole) || sameRing(island.verts, hole)) markIsland(island);
      }
      // Drop tunnel walls that share a hole edge (quads using both endpoints).
      const holeSet = new Set(keys);
      for (const wall of next.faces) {
        if (wall.id === face.id || wall.bordered || wall.holes?.length) continue;
        if (wall.verts.length !== 4) continue;
        const wKeys = ringEdges(wall.verts);
        if (wKeys.some((key) => holeSet.has(key))) removeFaceIds.add(wall.id);
      }
    }
  }

  for (const item of holesToDrop) {
    const parent = next.faces.find((face) => face.id === item.faceId);
    if (!parent?.holes) continue;
    parent.holes = parent.holes.filter((hole) => !sameRing(hole, item.hole));
    if (!parent.holes.length) delete parent.holes;
  }

  if (removeFaceIds.size) {
    next.faces = next.faces.filter((face) => !removeFaceIds.has(face.id));
  }

  if (!removeFaceIds.size && !holesToDrop.length) return null;
  return next;
}

/** Pick the closest edge under a local-space ray; returns {a,b,faceId,t,point}. */
export function hitSolidEdge(solid, origin, direction, maxDist = 0.12) {
  let best = null;
  const checkRing = (ring, faceId) => {
    if (!ring || ring.length < 2) return;
    for (let i = 0; i < ring.length; i++) {
      const ia = ring[i];
      const ib = ring[(i + 1) % ring.length];
      const a = solid.vertices[ia];
      const b = solid.vertices[ib];
      const hit = raySegmentDistance(origin, direction, a, b);
      if (!hit || hit.dist > maxDist) continue;
      if (!best || hit.t < best.t || (Math.abs(hit.t - best.t) < 1e-6 && hit.dist < best.dist)) {
        best = { a: ia, b: ib, faceId, t: hit.t, dist: hit.dist, point: hit.point };
      }
    }
  };
  for (const face of solid.faces) {
    checkRing(face.verts, face.id);
    if (face.holes) for (const hole of face.holes) checkRing(hole, face.id);
  }
  return best;
}

function raySegmentDistance(origin, dir, a, b) {
  // Closest approach between ray P(t)=o+t*d (t>=0) and segment Q(u)=a+u*(b-a), u in [0,1].
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ao = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const dAdB = dir[0] * ab[0] + dir[1] * ab[1] + dir[2] * ab[2];
  const dAdA = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  const bAbA = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const aOdA = ao[0] * dir[0] + ao[1] * dir[1] + ao[2] * dir[2];
  const aObA = ao[0] * ab[0] + ao[1] * ab[1] + ao[2] * ab[2];
  const denom = dAdA * bAbA - dAdB * dAdB;
  let t = 0;
  let u = 0;
  if (Math.abs(denom) < EPS) {
    u = Math.max(0, Math.min(1, aObA / (bAbA || 1)));
  } else {
    t = (dAdB * aObA - bAbA * aOdA) / denom;
    u = (dAdA * aObA - dAdB * aOdA) / denom;
    if (u < 0) {
      u = 0;
      t = -aOdA / (dAdA || 1);
    } else if (u > 1) {
      u = 1;
      t = ((a[0] + ab[0] - origin[0]) * dir[0] + (a[1] + ab[1] - origin[1]) * dir[1] + (a[2] + ab[2] - origin[2]) * dir[2]) / (dAdA || 1);
    }
  }
  if (t < 0) return null;
  const point = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
  const rp = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const dist = Math.hypot(point[0] - rp[0], point[1] - rp[1], point[2] - rp[2]);
  return { t, u, dist, point };
}

export function solidToGeometry(solid) {
  const positions = [];
  const normals = [];
  const faceMap = [];
  for (let f = 0; f < solid.faces.length; f++) {
    const face = solid.faces[f];
    if (face.verts.length < 3) continue;
    const n = faceNormal(solid, face);
    const tris = triangulateFace(solid, face);
    for (let i = 0; i < tris.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = solid.vertices[tris[i + k]];
        positions.push(v[0], v[1], v[2]);
        normals.push(n[0], n[1], n[2]);
        faceMap.push(f);
      }
    }
  }
  return { positions, normals, faceMap };
}

export function hitSolid(solid, origin, direction, opts = {}) {
  const preferSimple = !!opts.preferSimple;
  const excludeFaceId = opts.excludeFaceId || null;
  const { positions, faceMap } = solidToGeometry(solid);
  let best = null;
  for (let i = 0; i < positions.length; i += 9) {
    const face = solid.faces[faceMap[i / 3]];
    if (!face) continue;
    if (excludeFaceId && face.id === excludeFaceId) continue;
    if (preferSimple && face.holes?.length) continue;
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    const hit = rayTriangle(origin, direction, [ax, ay, az], [bx, by, bz], [cx, cy, cz]);
    if (!hit) continue;
    const score = hit.t + (face.holes?.length ? 0.0001 : 0);
    if (!best || score < best.score) {
      best = {
        t: hit.t,
        score,
        point: hit.point,
        faceId: face.id,
        face,
        normal: faceNormal(solid, face),
      };
    }
  }
  return best;
}

function rayTriangle(origin, dir, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [
    dir[1] * e2[2] - dir[2] * e2[1],
    dir[2] * e2[0] - dir[0] * e2[2],
    dir[0] * e2[1] - dir[1] * e2[0],
  ];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const s = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [
    s[1] * e1[2] - s[2] * e1[1],
    s[2] * e1[0] - s[0] * e1[2],
    s[0] * e1[1] - s[1] * e1[0],
  ];
  const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  if (t < EPS) return null;
  return {
    t,
    point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
  };
}

export function rectangleLoop(solid, faceId, a, b) {
  const pa = projectToFace(solid, faceId, a);
  const pb = projectToFace(solid, faceId, b);
  if (!pa || !pb) return null;
  const corners = [
    [pa.u, pa.v],
    [pb.u, pa.v],
    [pb.u, pb.v],
    [pa.u, pb.v],
  ];
  if (Math.abs(pa.u - pb.u) < 0.05 || Math.abs(pa.v - pb.v) < 0.05) return null;
  return corners.map(([u, v]) => [
    pa.frame.origin[0] + pa.frame.tangent[0] * u + pa.frame.bitangent[0] * v,
    pa.frame.origin[1] + pa.frame.tangent[1] * u + pa.frame.bitangent[1] * v,
    pa.frame.origin[2] + pa.frame.tangent[2] * u + pa.frame.bitangent[2] * v,
  ]);
}

export function circleLoop(solid, faceId, center, edge, segments = 24) {
  const pc = projectToFace(solid, faceId, center);
  const pe = projectToFace(solid, faceId, edge);
  if (!pc || !pe) return null;
  const radius = Math.hypot(pe.u - pc.u, pe.v - pc.v);
  if (radius < 0.05) return null;
  const points = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const u = pc.u + Math.cos(ang) * radius;
    const v = pc.v + Math.sin(ang) * radius;
    points.push([
      pc.frame.origin[0] + pc.frame.tangent[0] * u + pc.frame.bitangent[0] * v,
      pc.frame.origin[1] + pc.frame.tangent[1] * u + pc.frame.bitangent[1] * v,
      pc.frame.origin[2] + pc.frame.tangent[2] * u + pc.frame.bitangent[2] * v,
    ]);
  }
  return points;
}

export { faceNormal, faceFrame, projectToFace as projectPointToFace };
