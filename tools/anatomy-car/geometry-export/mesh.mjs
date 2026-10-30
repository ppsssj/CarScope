// Triangle meshes built from the kit's own 3D inputs (prism frames, convex vertices, lathe meridians,
// planar polygons). Nothing here reads SVG paths. Every mesh can be checked for degenerate
// triangles, open boundaries, non-manifold edges, inconsistent winding and outward orientation.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vec = { add, sub, mul, dot, cross, len, unit };

const signed2 = (ring) => ring.reduce((s, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x * y2 - x2 * y; }, 0) / 2;

/** Ear clipping for a simple polygon (2D, either winding). Returns index triples, counter-clockwise. */
export function earClip(ring) {
  const ccw = signed2(ring) > 0;
  const idx = ring.map((_, i) => i);
  if (!ccw) idx.reverse();
  const tris = [];
  const isConvex = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-12;
  const inside = (p, a, b, c) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const [a, b, c] = [ring[ia], ring[ib], ring[ic]];
      if (!isConvex(a, b, c)) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(ring[j], a, b, c))) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // numerically awkward remainder: fan it and let the checks report it
  }
  for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

/** A growable mesh: flat-shaded faces get their own vertices; smooth ones share normals. */
export function meshBuilder() {
  const positions = [];
  const normals = [];
  const indices = [];
  const tri = (a, b, c, na, nb, nc, want) => {
    // orient the triangle so its geometric normal agrees with the wanted direction
    const g = cross(sub(b, a), sub(c, a));
    if (want && dot(g, want) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    const base = positions.length;
    positions.push(a, b, c);
    normals.push(na, nb, nc);
    indices.push(base, base + 1, base + 2);
  };
  const face = (points, n) => { // planar convex-or-concave face with one normal
    const [e1, e2] = basis(n);
    const ring = points.map((p) => [dot(p, e1), dot(p, e2)]);
    for (const [i, j, k] of earClip(ring)) tri(points[i], points[j], points[k], n, n, n, n);
  };
  return { positions, normals, indices, tri, face };
}
function basis(n) {
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(n, t));
  return [e1, cross(n, e1)];
}

const W3 = (F, s, [x, y]) => add(add(add(F.o, mul(F.a, s)), mul(F.u, x)), mul(F.v, y));

/** A prism: polygon (u, v) in frame F, extruded along F.a from s0 to s1. Closed and outward. */
export function prismMesh({ F, poly, s0, s1 }) {
  const m = meshBuilder();
  const ring = signed2(poly) > 0 ? poly : [...poly].reverse();
  const n = ring.length;
  const capN = unit(F.a);
  const capTris = earClip(ring);
  for (const [i, j, k] of capTris) {
    m.tri(W3(F, s1, ring[i]), W3(F, s1, ring[j]), W3(F, s1, ring[k]), capN, capN, capN, capN);
    m.tri(W3(F, s0, ring[i]), W3(F, s0, ring[k]), W3(F, s0, ring[j]), mul(capN, -1), mul(capN, -1), mul(capN, -1), mul(capN, -1));
  }
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9) continue;
    const out = unit(add(mul(F.u, q[1] - p[1]), mul(F.v, -(q[0] - p[0])))); // outward for a CCW ring
    const a = W3(F, s0, p);
    const b = W3(F, s0, q);
    const c = W3(F, s1, q);
    const d = W3(F, s1, p);
    m.tri(a, b, c, out, out, out, out);
    m.tri(a, c, d, out, out, out, out);
  }
  return m;
}

/** A convex polyhedron from vertices and index loops; faces are oriented away from the centroid. */
export function convexMesh({ vertices, faces }) {
  const m = meshBuilder();
  const centre = mul(vertices.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / vertices.length);
  for (const face of faces) {
    const pts = face.map((i) => vertices[i]);
    let n = unit(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    if (dot(n, sub(pts[0], centre)) < 0) n = mul(n, -1);
    for (let i = 1; i + 1 < pts.length; i++) m.tri(pts[0], pts[i], pts[i + 1], n, n, n, n);
  }
  return m;
}

/**
 * A solid of revolution: a closed meridian loop [s, r, smooth?] turned round F.a in `steps`.
 * The loop is straight between knots (the kit's SVG smooths runs of smooth knots with a monotone
 * Hermite curve; here smooth knots only share normals, so the outline can differ slightly).
 */
export function latheMesh({ F, meridian, steps }) {
  const m = meshBuilder();
  let loop = meridian.map(([s, r, smooth]) => ({ s, r: Math.max(0, r), smooth: Boolean(smooth) }));
  if (signed2(loop.map(({ s, r }) => [s, r])) < 0) loop = loop.reverse();
  const n = loop.length;
  const segN = loop.map((p, i) => { // (s, r) outward normal of segment i -> i+1
    const q = loop[(i + 1) % n];
    const ds = q.s - p.s;
    const dr = q.r - p.r;
    const l = Math.hypot(ds, dr) || 1;
    return [dr / l, -ds / l];
  });
  const at = (s, r, t) => add(add(F.o, mul(F.a, s)), mul(add(mul(F.u, Math.cos(t)), mul(F.v, Math.sin(t))), r));
  const dirOf = ([ns, nr], t) => unit(add(mul(F.a, ns), mul(add(mul(F.u, Math.cos(t)), mul(F.v, Math.sin(t))), nr)));
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    if (p.r === 0 && q.r === 0) continue; // a segment on the axis encloses nothing
    if (Math.hypot(q.s - p.s, q.r - p.r) < 1e-9) continue;
    const nOwn = segN[i];
    const avg = (k, other) => (loop[k].smooth ? [(nOwn[0] + other[0]) / 2, (nOwn[1] + other[1]) / 2] : nOwn);
    const np = avg(i, segN[(i + n - 1) % n]);
    const nq = avg((i + 1) % n, segN[(i + 1) % n]);
    for (let j = 0; j < steps; j++) {
      const t0 = (2 * Math.PI * j) / steps;
      const t1 = (2 * Math.PI * (j + 1)) / steps;
      const tm = (t0 + t1) / 2;
      const want = dirOf(nOwn, tm);
      const a = at(p.s, p.r, t0);
      const b = at(p.s, p.r, t1);
      const c = at(q.s, q.r, t1);
      const d = at(q.s, q.r, t0);
      if (p.r > 0) m.tri(a, b, c, dirOf(np, t0), dirOf(np, t1), dirOf(nq, t1), want);
      if (q.r > 0) m.tri(a, c, d, dirOf(np, t0), dirOf(nq, t1), dirOf(nq, t0), want);
    }
  }
  return m;
}

/** A planar polygon (a decal: glass, frit, liner, lamp lens). Open by nature; shown double-sided. */
export function planeMesh({ points, toward }) {
  const m = meshBuilder();
  let n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) { // Newell's normal
    const p = points[i];
    const q = points[(i + 1) % points.length];
    n = add(n, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
  }
  n = unit(n);
  if (toward && dot(n, toward) < 0) n = mul(n, -1);
  m.face(points, n);
  return m;
}

/** Rigid transform helpers for door poses: rotate about a vertical axis through `pivot`. */
export function rotateZ(p, pivot, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p[0] - pivot[0];
  const y = p[1] - pivot[1];
  return [pivot[0] + c * x - s * y, pivot[1] + s * x + c * y, p[2]];
}

/** Geometry checks. Topology uses positions welded at 1e-4 units. */
export function checkMesh(m, { closed }) {
  if (!m.positions.length || m.positions.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
      m.normals.length !== m.positions.length || m.normals.some((n) => n.length !== 3 || !n.every(Number.isFinite)) ||
      m.indices.length === 0 || m.indices.length % 3 !== 0 ||
      m.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= m.positions.length)) {
    throw new Error("Invalid mesh: finite positions/normals and complete, in-range triangle indices required");
  }
  const key = (p) => p.map((v) => Math.round(v * 1e4)).join(",");
  const ids = new Map();
  const weld = m.positions.map((p) => { const k = key(p); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); });
  let degenerate = 0;
  let flippedNormals = 0;
  const directed = new Map();
  let volume = 0;
  let area = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const [a, b, c] = [m.positions[i], m.positions[j], m.positions[k]];
    const g = cross(sub(b, a), sub(c, a));
    const ar = len(g) / 2;
    area += ar;
    if (ar < 1e-8 || weld[i] === weld[j] || weld[j] === weld[k] || weld[i] === weld[k]) { degenerate++; continue; }
    for (const n of [m.normals[i], m.normals[j], m.normals[k]]) if (dot(n, g) <= 0) flippedNormals++;
    volume += dot(a, cross(b, c)) / 6;
    for (const [u, v] of [[weld[i], weld[j]], [weld[j], weld[k]], [weld[k], weld[i]]]) {
      const kk = `${u}>${v}`;
      directed.set(kk, (directed.get(kk) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let windingConflicts = 0;
  const seen = new Set();
  for (const [kk, count] of directed) {
    const [u, v] = kk.split(">");
    const pair = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const back = directed.get(`${v}>${u}`) ?? 0;
    if (count > 1 || back > 1) nonManifold++;
    if (count >= 1 && back === 0) boundary++;
    if (count > 1 && back === 0) windingConflicts++;
  }
  // T-junctions (a vertex on another triangle's edge) also leave "boundary" edges; for closed kinds
  // they are reported as such, so a watertight claim is never made on a mesh that has them.
  return {
    triangles: m.indices.length / 3,
    vertices: m.positions.length,
    weldedVertices: ids.size,
    degenerate,
    flippedNormals,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    windingConflicts,
    signedVolume: volume,
    area: Number(area.toFixed(3)),
    closed,
    watertight: closed ? boundary === 0 && nonManifold === 0 : null,
    outward: closed ? volume > 0 : null,
  };
}
