// P3-A2.1: front compartment shell for the hyundai-ioniq5-2022 profile, built from the layout in
// front-compartment-layout.mjs. Browser-safe and deterministic: the same layout gives the same
// triangles. Output is CarScope cm; nothing here reads or changes the source GLB.
//
// FrontCompartment
// ├── RearBoundary       fc-rear-bulkhead, fc-cowl-cover            (ESTIMATED_BOUNDARY)
// ├── Aprons             fc-apron-left/right, fc-strut-tower-left/right
// ├── LowerLiner         fc-lower-liner
// ├── FrontUpperSupport  fc-front-upper-support, fc-front-shroud
// └── ReservedZones      zone-frunk, zone-service-left/right       (SYNTHETIC_DEBUG_PLACEHOLDER)
import { PARTS, HOOD_GAP, hoodUndersideAt, zoneBoxes, JOINTS } from "./front-compartment-layout.mjs";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => a + (b - a) * t;
const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => lerp(a, b, i / (n - 1)));
export const MIN_TRIANGLE_AREA = 1e-4; // cm²

/** Triangles of a quad sheet given as rows of points (same length); degenerate triangles are dropped. */
export function sheet(rows) {
  const out = [];
  const push = (a, b, c) => { if (Math.hypot(...cross(sub(b, a), sub(c, a))) / 2 > MIN_TRIANGLE_AREA) out.push(...a, ...b, ...c); };
  for (let r = 0; r + 1 < rows.length; r++)
    for (let c = 0; c + 1 < rows[r].length; c++) { const a = rows[r][c], b = rows[r][c + 1], d = rows[r + 1][c], e = rows[r + 1][c + 1]; push(a, b, e); push(a, e, d); }
  return out;
}

/** Wind every triangle so its normal points toward `target(centroid)`: the side seen from the compartment. */
export function orient(T, target) {
  const out = Float64Array.from(T);
  for (let i = 0; i < out.length; i += 9) {
    const a = [out[i], out[i + 1], out[i + 2]], b = [out[i + 3], out[i + 4], out[i + 5]], c = [out[i + 6], out[i + 7], out[i + 8]];
    const n = cross(sub(b, a), sub(c, a)), m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, sub(target(m), m)) < 0) for (let k = 0; k < 3; k++) { const t = out[i + 3 + k]; out[i + 3 + k] = out[i + 6 + k]; out[i + 6 + k] = t; }
  }
  return out;
}

const toward = (p) => () => p;

function bulkhead({ xBottom, xTop, zBottom, zTop, halfWidthLow, halfWidthHigh, widenFromZ, widenToZ, beads }) {
  // z samples: ends, widening band, bead edges (each bead is a shallow recess toward the cabin).
  const zs = [...new Set([zBottom, zTop, widenFromZ, widenToZ, ...beads.flatMap((b) => [b.z - b.height / 2 - 1, b.z - b.height / 2, b.z + b.height / 2, b.z + b.height / 2 + 1]), ...linspace(zBottom, zTop, 8)].map((z) => Math.round(z * 100) / 100))].sort((a, b) => a - b);
  const xAt = (z) => lerp(xBottom, xTop, (z - zBottom) / (zTop - zBottom)) - beads.reduce((d, b) => d + (Math.abs(z - b.z) <= b.height / 2 + 1e-9 ? b.depth : 0), 0);
  const wAt = (z) => (z <= widenFromZ ? halfWidthLow : z >= widenToZ ? halfWidthHigh : lerp(halfWidthLow, halfWidthHigh, (z - widenFromZ) / (widenToZ - widenFromZ)));
  const rows = zs.map((z) => linspace(-1, 1, 15).map((u) => [xAt(z), u * wAt(z), z]));
  return orient(sheet(rows), toward([200, 0, 60]));
}

function cowl({ xRear, xFront, zRear, zFront, lipZ, halfWidth }) {
  const ys = linspace(-halfWidth, halfWidth, 15);
  const rows = [xRear, lerp(xRear, xFront, 0.5), xFront].map((x, i) => ys.map((y) => [x, y, [zRear, (zRear + zFront) / 2, zFront][i]]));
  rows.push(ys.map((y) => [xFront + 0.6, y, lipZ]));
  return orient(sheet(rows), toward([114, 0, 200]));
}

function apron(side, { x, wallY, zBottom, zKnee, bendY, bendZ, flangeY, topCap }) {
  const s = side;
  const rows = x.map((xi) => {
    // Lowest hood surface across the flange (the hood's side edge curls down near the fender).
    const hood = [bendY, (bendY + flangeY) / 2, flangeY, flangeY + 3, flangeY + 6].map((y) => hoodUndersideAt(xi, y)).filter((z) => z !== null).reduce((m, z) => Math.min(m, z), Infinity);
    const top = Math.max(bendZ + 1, Math.min(topCap, hood - HOOD_GAP));
    return [[xi, s * wallY, zBottom], [xi, s * wallY, zKnee], [xi, s * bendY, bendZ], [xi, s * (bendY + flangeY) / 2, (bendZ + top) / 2 + 0.6], [xi, s * flangeY, top]];
  });
  return orient(sheet(rows), toward([145, 0, 80]));
}

function strutTower(side, { x, y, radius, zBottom, zTop, segments }) {
  const cy = side * y;
  const ring = (z, r) => linspace(0, 2 * Math.PI, segments + 1).map((a) => [x + r * Math.cos(a), cy + r * Math.sin(a), z]);
  const wall = sheet([ring(zBottom, radius), ring(zTop - 1, radius), ring(zTop, radius - 1)]);
  const cap = sheet([ring(zTop, radius - 1), ring(zTop, 0.001)]);
  return orient([...wall, ...cap], (m) => (m[2] >= zTop - 1e-6 ? [m[0], m[1], m[2] + 10] : [m[0] + (m[0] - x), m[1] + (m[1] - cy), m[2] + 1]));
}

function liner({ xRear, xFront, halfWidth, zCentre, wellHalfWidth, rampTo, zShelf, zEdge, lip, lipZ }) {
  // Centre well, ramps, side shelves rising slightly to the apron.
  const half = [0, wellHalfWidth / 2, wellHalfWidth, (wellHalfWidth + rampTo) / 2, rampTo, (rampTo + halfWidth) / 2, halfWidth];
  const ys = [...half.slice(1).reverse().map((y) => -y), ...half];
  const zAt = (y) => { const a = Math.abs(y); return a <= wellHalfWidth ? zCentre + (a / wellHalfWidth) ** 2 : a <= rampTo ? lerp(zCentre + 1, zShelf, (a - wellHalfWidth) / (rampTo - wellHalfWidth)) : lerp(zShelf, zEdge, (a - rampTo) / (halfWidth - rampTo)); };
  const xs = [xRear, xRear + lip, ...linspace(xRear + lip + 6, xFront - lip - 6, 8), xFront - lip, xFront];
  const rows = xs.map((x, i) => ys.map((y) => [x, y, i === 0 || i === xs.length - 1 ? lipZ : zAt(y)]));
  return orient(sheet(rows), toward([160, 0, 200]));
}

function upperSupport({ xRear, xFront, topRear, topFront, zTop, zRearFoot, zFrontFoot, halfWidth, boss }) {
  const ys = linspace(-halfWidth, halfWidth, 11);
  const section = [[xRear, zRearFoot], [topRear, zTop], [lerp(topRear, topFront, 0.5), zTop], [topFront, zTop], [xFront, zFrontFoot]];
  const body = sheet(section.map(([x, z]) => ys.map((y) => [x, y, z])));
  // Latch boss: a raised pad on the top flange (open box, five faces).
  const [x0, x1] = boss.x, y0 = -boss.y, y1 = boss.y, z0 = zTop, z1 = zTop + boss.h;
  const q = (a, b, c, d) => sheet([[a, b], [d, c]]);
  const pad = [...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), ...q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]),
    ...q([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]), ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])];
  const c = [(x0 + x1) / 2, 0, z0];
  return [...orient(body, toward([205, 0, 200])), ...orient(pad, (m) => (m[2] > z1 - 1e-6 ? [m[0], m[1], m[2] + 10] : [m[0] + (m[0] - c[0]), m[1] + (m[1] - c[1]) * 3, m[2]]))];
}

function shroud({ x, zBottom, zTopCentre, halfWidthCentre, halfWidth, zTopSide }) {
  const ys = [-halfWidth, -halfWidthCentre - 0.5, ...linspace(-halfWidthCentre, halfWidthCentre, 9), halfWidthCentre + 0.5, halfWidth];
  const top = (y) => (Math.abs(y) <= halfWidthCentre + 1e-9 ? zTopCentre : zTopSide);
  return orient(sheet([ys.map((y) => [x, y, zBottom]), ys.map((y) => [x, y, (zBottom + top(y)) / 2]), ys.map((y) => [x, y, top(y)])]), toward([150, 0, 60]));
}

const BUILDERS = {
  "fc-rear-bulkhead": (p) => bulkhead(p.params),
  "fc-cowl-cover": (p) => cowl(p.params),
  "fc-apron-left": (p) => apron(p.side, p.params),
  "fc-apron-right": (p) => apron(p.side, p.params),
  "fc-strut-tower-left": (p) => strutTower(p.side, p.params),
  "fc-strut-tower-right": (p) => strutTower(p.side, p.params),
  "fc-lower-liner": (p) => liner(p.params),
  "fc-front-upper-support": (p) => upperSupport(p.params),
  "fc-front-shroud": (p) => shroud(p.params),
};

/** Closed box as triangles (outward normals), for reserved-zone debug display. */
export function boxTriangles(min, max) {
  const v = (i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return Float64Array.from(quads.flatMap(([a, b, c, d]) => [...v(a), ...v(b), ...v(c), ...v(a), ...v(c), ...v(d)]));
}

/** Panel meta without the build parameters (what a viewer or report needs to show). */
export const metaOf = ({ params, side, ...meta }) => meta;

/**
 * The shell: one node per panel (`{ id, name, triangles, meta }`, CarScope cm) plus the reserved zones.
 * Panel nodes carry `palettes` so they can go straight into buildIoniqSvg as extra nodes.
 */
export function buildFrontCompartment(parts = PARTS) {
  const panels = parts.map((p) => {
    const triangles = Float64Array.from(BUILDERS[p.id](p));
    return { id: p.id, name: p.id, label: p.name, group: p.group, triangles, materials: Array(triangles.length / 9).fill(p.id), palettes: Array(triangles.length / 9).fill(p.palette), meta: metaOf(p) };
  });
  const zones = zoneBoxes().map((z) => ({ id: z.id, name: z.id, label: z.name, group: z.group, triangles: boxTriangles(z.min, z.max), box: { min: z.min, max: z.max }, meta: metaOf(z) }));
  return { panels, zones, joints: JOINTS };
}

/** Per-panel statistics: triangle count, bounds, degenerate triangles and normal orientation. */
export function panelStats(panel) {
  const T = panel.triangles, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let degenerate = 0, area = 0;
  for (let i = 0; i < T.length; i += 9) {
    const a = [T[i], T[i + 1], T[i + 2]], b = [T[i + 3], T[i + 4], T[i + 5]], c = [T[i + 6], T[i + 7], T[i + 8]];
    const ar = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    if (!(ar > MIN_TRIANGLE_AREA) || !T.slice(i, i + 9).every(Number.isFinite)) degenerate++;
    area += ar;
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  return { id: panel.id, triangles: T.length / 9, degenerate, areaCm2: area, min: lo, max: hi };
}
