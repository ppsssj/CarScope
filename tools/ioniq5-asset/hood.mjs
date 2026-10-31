// P3-A1: hood identification, hinge-axis candidates and rigid hood rotation (CarScope cm frame:
// +X forward, +Y left, +Z up). Browser-safe: the PoC page and the Node report share this module.
//
// Nothing here edits the source mesh. A rotation is applied to a copy of the hood triangles (Node) or
// to a pivot node inserted above the untouched hood node (browser); 0 degrees is the original pose.

export const HOOD_NODE = "Door_Front_0";
export const HOOD_GROUP = "Grp_Door_Front_0";
export const TAILGATE_NODE = "Door_Rear_0";
/** SIMULATION_ONLY sample angles; NOT the vehicle's opening range (real maximum opening angle UNVERIFIED). */
export const SAMPLE_ANGLES = Object.freeze([0, 5, 15, 30, 45, 60]);
export const PLACEHOLDER_TAG = "SYNTHETIC_DEBUG_PLACEHOLDER";

const centroid = (T) => { const s = [0, 0, 0]; for (let i = 0; i < T.length; i++) s[i % 3] += T[i]; return s.map((v) => v / (T.length / 3)); };
const boundsOf = (T) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.length; i++) { const c = i % 3; if (T[i] < lo[c]) lo[c] = T[i]; if (T[i] > hi[c]) hi[c] = T[i]; }
  return { lo, hi };
};
/** Area-weighted mean normal (unit), used to tell an upward-facing panel from a vertical one. */
function meanNormal(T) {
  const n = [0, 0, 0];
  for (let i = 0; i < T.length; i += 9) {
    const u = [T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]], v = [T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]];
    // Faces may point in or out (shells are two-sided): accumulate |n| oriented upward.
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const s = c[2] < 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) n[k] += s * c[k];
  }
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

/**
 * Find the hood among mesh nodes ([{ name, parent?, triangles }], CarScope cm) and refuse to guess:
 * the OpenX name, the position (front half, ahead of the tailgate) and the panel orientation (faces
 * up) must all agree, otherwise `problems` lists why.
 */
export function identifyHood(nodes) {
  const problems = [];
  const hood = nodes.find((n) => n.name === HOOD_NODE);
  const tailgate = nodes.find((n) => n.name === TAILGATE_NODE);
  if (!hood) return { hood: null, tailgate, problems: [`no ${HOOD_NODE} mesh node`] };
  const c = centroid(hood.triangles), b = boundsOf(hood.triangles), nrm = meanNormal(hood.triangles);
  if (c[0] <= 0) problems.push(`${HOOD_NODE} centroid x=${c[0].toFixed(1)} cm is not in the front half`);
  if (tailgate) {
    const t = centroid(tailgate.triangles);
    if (t[0] >= c[0]) problems.push(`${TAILGATE_NODE} (x=${t[0].toFixed(1)}) is ahead of ${HOOD_NODE} (x=${c[0].toFixed(1)}): hood and tailgate may be swapped`);
  }
  if (nrm[2] < 0.7) problems.push(`${HOOD_NODE} mean normal z=${nrm[2].toFixed(2)}: not an upward-facing panel`);
  if (hood.parent !== undefined && hood.parent !== HOOD_GROUP) problems.push(`${HOOD_NODE} parent is ${hood.parent}, expected ${HOOD_GROUP}`);
  return { hood, tailgate, centroid: c, bounds: b, meanNormal: nrm, problems };
}

/** 4x4 row-major rigid rotation by `deg` about the line through `point` along unit `dir`. */
export function rotationAbout(point, dir, deg) {
  const l = Math.hypot(...dir), [x, y, z] = dir.map((v) => v / l);
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  const R = [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
  const tr = [0, 1, 2].map((r) => point[r] - (R[r][0] * point[0] + R[r][1] * point[1] + R[r][2] * point[2]));
  return [[...R[0], tr[0]], [...R[1], tr[1]], [...R[2], tr[2]], [0, 0, 0, 1]];
}

/** Rotated copy of packed xyz coordinates. 0 degrees returns an exact copy (no floating-point drift). */
export function rotatePoints(P, axis, deg) {
  const out = Float64Array.from(P);
  if (deg === 0) return out;
  const M = rotationAbout(axis.point, axis.direction, deg);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    out[i] = M[0][0] * x + M[0][1] * y + M[0][2] * z + M[0][3];
    out[i + 1] = M[1][0] * x + M[1][1] * y + M[1][2] * z + M[1][3];
    out[i + 2] = M[2][0] * x + M[2][1] * y + M[2][2] * z + M[2][3];
  }
  return out;
}

/**
 * Orient an axis so that a positive angle lifts the hood's front edge (+Z at the front-most vertex).
 * Returns the same axis with `direction` possibly negated; `flipped` records it.
 */
export function orientOpening(axis, hoodTriangles) {
  let k = 0;
  for (let i = 0; i < hoodTriangles.length; i += 3) if (hoodTriangles[i] > hoodTriangles[k]) k = i;
  const front = [hoodTriangles[k], hoodTriangles[k + 1], hoodTriangles[k + 2]];
  const lifted = rotatePoints(Float64Array.from(front), axis, 10);
  const up = lifted[2] > front[2];
  return { ...axis, direction: up ? axis.direction : axis.direction.map((v) => -v), flipped: !up };
}

/** Hood outline in plan: rear edge (min X) and front edge (max X) per lateral band, plus top Z. */
export function edgeProfile(T, band = 10) {
  const rows = new Map();
  for (let i = 0; i < T.length; i += 3) {
    const y = Math.round(T[i + 1] / band) * band;
    const r = rows.get(y) ?? rows.set(y, { y, rearX: Infinity, rearZ: 0, frontX: -Infinity, frontZ: 0, topZ: -Infinity }).get(y);
    if (T[i] < r.rearX) { r.rearX = T[i]; r.rearZ = T[i + 2]; }
    if (T[i] > r.frontX) { r.frontX = T[i]; r.frontZ = T[i + 2]; }
    if (T[i + 2] > r.topZ) r.topZ = T[i + 2];
  }
  return [...rows.values()].sort((a, b) => a.y - b.y);
}

/**
 * Hinge-axis candidates. Coordinates are CarScope cm; every candidate carries its evidence class.
 *   A  OpenX group origin and the group's lateral axis: what the source file defines, nothing more.
 *   B  reference-informed: a lateral axis just under the hood's rear corners, where the owner's manual
 *      (front edge lifts) and the LH/RH hinge part listing put the two hinges. Offsets are assumptions.
 *   C  geometry search result (Node report), a visual candidate only; passed in when available.
 */
export function axisCandidates({ hoodTriangles, groupOriginCm, groupLateralCm, searched = null, hingeOffset = { forward: 0, below: 6 } }) {
  const b = boundsOf(hoodTriangles);
  const rear = edgeProfile(hoodTriangles).reduce((m, r) => (r.rearX < m.rearX ? r : m));
  const A = orientOpening({
    id: "A", label: "OpenX group origin (Grp_Door_Front_0)", point: groupOriginCm, direction: groupLateralCm,
    evidence: "UNVERIFIED", coordinateFrame: "CarScope cm (+X fwd, +Y left, +Z up)",
    source: "hyundai_ioniq_5_2022.glb node Grp_Door_Front_0 (OpenX Assets); translation + rotation as converted in P2-A6",
    assumptions: ["the group origin is a modelling pivot; OpenX does not document it as a mechanical hinge", "axis = the group's local Y, the only lateral local axis"],
  }, hoodTriangles);
  const B = orientOpening({
    id: "B", label: "Rear-corner hinge estimate (manual + parts list)",
    point: [rear.rearX + hingeOffset.forward, 0, rear.rearZ - hingeOffset.below], direction: [0, 1, 0],
    evidence: "ESTIMATED", coordinateFrame: "CarScope cm (+X fwd, +Y left, +Z up)",
    source: "Hyundai IONIQ 5 2022 owner's manual (UK) p.5-47 figure ONE1051042: front edge lifts; parts listing HINGE ASSY-HOOD LH/RH 66910-GI000 / 66920-GI000",
    assumptions: [
      "single fixed pivot per side, both on one lateral axis (the real hinge geometry - single pivot or link - is not published)",
      `pivot ${hingeOffset.forward} cm ahead of and ${hingeOffset.below} cm below the hood's rear-most point (x=${rear.rearX.toFixed(1)}, z=${rear.rearZ.toFixed(1)})`,
      "axis parallel to car Y (left and right hinges at the same X and Z)",
    ],
  }, hoodTriangles);
  const out = [A, B];
  if (searched) out.push(orientOpening({ id: "C", label: "Geometry search (least interference)", direction: [0, 1, 0], evidence: "ESTIMATED", coordinateFrame: "CarScope cm (+X fwd, +Y left, +Z up)",
    source: "tools/ioniq5-asset/hood-feasibility.mjs pivot grid search against the source meshes",
    assumptions: ["visual candidate only: chosen to minimise mesh interference, not a manufacturer hinge", "axis parallel to car Y"], ...searched }, hoodTriangles));
  return { candidates: out, hoodBounds: b, rearMost: rear };
}

/**
 * Position-based label for static triangles. The Body is one mesh (fenders, cowl, pillars and fascia
 * together), so these regions are ESTIMATED from where a triangle sits, not from source part names.
 */
export function bodyRegion(name, c) {
  if (name !== "Body") return name === "Body_Glass" ? "windshield-and-glazing" : name;
  const ay = Math.abs(c[1]);
  if (c[0] >= 195) return "body:front-fascia";
  if (ay >= 60 && c[0] < 104 && c[2] >= 100) return "body:a-pillar-base";
  if (ay >= 60) return "body:front-fender";
  if (c[0] < 130 && c[2] >= 95) return "body:cowl";
  return "body:other";
}

/** Undirected edges used by exactly one triangle after welding coincident vertices (the panel outline). */
export function boundaryEdges(T, weld = 1e-4) {
  const ids = new Map(), pts = [];
  const vid = (i) => { const k = `${Math.round(T[i] / weld)},${Math.round(T[i + 1] / weld)},${Math.round(T[i + 2] / weld)}`; if (!ids.has(k)) { ids.set(k, pts.length); pts.push([T[i], T[i + 1], T[i + 2]]); } return ids.get(k); };
  const count = new Map();
  for (let t = 0; t < T.length; t += 9) {
    const v = [vid(t), vid(t + 3), vid(t + 6)];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; if (a === b) continue; const k = a < b ? `${a},${b}` : `${b},${a}`; count.set(k, (count.get(k) ?? 0) + 1); }
  }
  const edges = [];
  for (const [k, c] of count) if (c === 1) { const [a, b] = k.split(",").map(Number); edges.push([pts[a], pts[b]]); }
  return edges;
}

/** Vertical ray (downward) against packed triangles: highest hit below zTop, or null. */
export function rayDown(x, y, zTop, T) {
  let best = null;
  for (let i = 0; i < T.length; i += 9) {
    const ax = T[i], ay = T[i + 1], bx = T[i + 3], by = T[i + 4], cx = T[i + 6], cy = T[i + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * T[i + 2] + l2 * T[i + 5] + l3 * T[i + 8];
    if (z < zTop - 1e-3 && (best === null || z > best)) best = z;
  }
  return best;
}

/**
 * What lies under the closed hood: a grid of downward rays from the hood's underside. For each sample
 * the first mesh hit and the vertical free space. Pure measurement of the source; nothing is inferred.
 */
export function underHoodProbe(hoodT, others, { step = 5 } = {}) {
  const b = boundsOf(hoodT);
  const samples = [];
  for (let x = Math.ceil(b.lo[0] / step) * step; x <= b.hi[0]; x += step)
    for (let y = Math.ceil(b.lo[1] / step) * step; y <= b.hi[1]; y += step) {
      // Underside = lowest hood surface at (x, y); skip points outside the panel.
      let under = null;
      for (let i = 0; i < hoodT.length; i += 9) {
        const z = rayDown(x, y, Infinity, hoodT.subarray(i, i + 9));
        if (z !== null && (under === null || z < under)) under = z;
      }
      if (under === null) continue;
      let hit = null;
      for (const o of others) { const z = rayDown(x, y, under, o.triangles); if (z !== null && (!hit || z > hit.z)) hit = { z, mesh: o.name }; }
      samples.push({ x, y, hoodUndersideZ: under, hit: hit?.mesh ?? null, hitZ: hit?.z ?? null, freeCm: hit ? under - hit.z : null });
    }
  return samples;
}

/**
 * A transparent box marking the free space under the hood centre, for the PoC only. It is labelled
 * SYNTHETIC_DEBUG_PLACEHOLDER and is not a part shape: the source has no front-compartment geometry.
 */
export function placeholderBox(samples, { centreHalfWidth = 40, clearance = 3 } = {}) {
  const inner = samples.filter((s) => Math.abs(s.y) <= centreHalfWidth && s.hitZ !== null);
  if (!inner.length) return null;
  const xs = inner.map((s) => s.x), ys = inner.map((s) => s.y);
  const top = Math.min(...inner.map((s) => s.hoodUndersideZ)) - clearance, bottom = Math.max(...inner.map((s) => s.hitZ)) + clearance;
  if (top <= bottom) return null;
  return { tag: PLACEHOLDER_TAG, note: "debug volume under the hood centre; not a front trunk, motor or any real part", min: [Math.min(...xs), Math.min(...ys), bottom], max: [Math.max(...xs), Math.max(...ys), top] };
}
