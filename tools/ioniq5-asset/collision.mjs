// P3-A1: exact triangle-mesh intersection and clearance between a moving part and static meshes.
// Browser-safe (no Node imports): the hood PoC runs the same narrow phase as the Node report.
//
// Narrow phase, per triangle pair:
//   intersection  any edge of one triangle crosses the other (exact for non-coplanar pairs), plus a 2D
//                 overlap test for coplanar pairs;
//   distance      0 when they intersect, otherwise the minimum of the 6 point-triangle and 9
//                 segment-segment distances (the exact Euclidean distance between two triangles).
// Broad phase: a uniform grid over the static triangles; it only limits which pairs reach the narrow
// phase and never decides a result on its own.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const addS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const len = (a) => Math.sqrt(dot(a, a));

export const tri = (T, i) => [[T[9 * i], T[9 * i + 1], T[9 * i + 2]], [T[9 * i + 3], T[9 * i + 4], T[9 * i + 5]], [T[9 * i + 6], T[9 * i + 7], T[9 * i + 8]]];

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return addS(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return addS(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return addS(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  return addS(addS(a, ab, vb * denom), ac, vc * denom);
}

/** Closest points between segments p1q1 and p2q2 (Ericson 5.1.9). */
export function segmentSegment(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-18) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-18 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return [addS(p1, d1, s), addS(p2, d2, t)];
}

/** Segment pq against triangle abc; returns the crossing point or null (Möller–Trumbore, both ends inclusive). */
function segmentTriangle(p, q, a, b, c, eps) {
  const d = sub(q, p), e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det, s = sub(p, a), u = f * dot(s, h);
  if (u < -eps || u > 1 + eps) return null;
  const qv = cross(s, e1), v = f * dot(d, qv);
  if (v < -eps || u + v > 1 + eps) return null;
  const t = f * dot(e2, qv);
  return t < -eps || t > 1 + eps ? null : addS(p, d, t);
}

function coplanarOverlap(A, B, n) {
  // Project on the dominant plane and test edge crossings and containment.
  const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const [i, j] = [[1, 2], [0, 2], [0, 1]][ax];
  const P = (v) => [v[i], v[j]];
  const a = A.map(P), b = B.map(P);
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const segX = (p1, p2, p3, p4) => { const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4); return d1 * d2 < 0 && d3 * d4 < 0; };
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (segX(a[x], a[(x + 1) % 3], b[y], b[(y + 1) % 3])) return true;
  const inside = (p, t) => { const s1 = orient(t[0], t[1], p), s2 = orient(t[1], t[2], p), s3 = orient(t[2], t[0], p); return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0); };
  return inside(a[0], b) || inside(b[0], a);
}

/** True when the two triangles share at least one point (within eps cm). */
export function trianglesIntersect(A, B, eps = 1e-6) {
  const nB = cross(sub(B[1], B[0]), sub(B[2], B[0])), nA = cross(sub(A[1], A[0]), sub(A[2], A[0]));
  const lB = len(nB), lA = len(nA);
  if (lA < 1e-12 || lB < 1e-12) return false; // degenerate sliver: no area to collide with
  const dA = A.map((v) => dot(nB, sub(v, B[0])) / lB);
  if ((dA[0] > eps && dA[1] > eps && dA[2] > eps) || (dA[0] < -eps && dA[1] < -eps && dA[2] < -eps)) return false;
  const dB = B.map((v) => dot(nA, sub(v, A[0])) / lA);
  if ((dB[0] > eps && dB[1] > eps && dB[2] > eps) || (dB[0] < -eps && dB[1] < -eps && dB[2] < -eps)) return false;
  if (dA.every((d) => Math.abs(d) <= eps)) return coplanarOverlap(A, B, nB);
  for (let k = 0; k < 3; k++) {
    if (segmentTriangle(A[k], A[(k + 1) % 3], B[0], B[1], B[2], 1e-9)) return true;
    if (segmentTriangle(B[k], B[(k + 1) % 3], A[0], A[1], A[2], 1e-9)) return true;
  }
  return false;
}

/** Exact distance between two triangles and the closest points ([0, p, p] when they intersect). */
export function triangleDistance(A, B) {
  if (trianglesIntersect(A, B)) return { d: 0, p: A[0], q: A[0], intersects: true };
  let best = { d: Infinity };
  const take = (p, q) => { const d = len(sub(p, q)); if (d < best.d) best = { d, p, q, intersects: false }; };
  for (const v of A) take(v, closestOnTriangle(v, B[0], B[1], B[2]));
  for (const v of B) take(closestOnTriangle(v, A[0], A[1], A[2]), v);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) { const [p, q] = segmentSegment(A[x], A[(x + 1) % 3], B[y], B[(y + 1) % 3]); take(p, q); }
  return best;
}

const boxOf = (T, i) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) { const x = T[9 * i + 3 * v + c]; if (x < lo[c]) lo[c] = x; if (x > hi[c]) hi[c] = x; }
  return [lo, hi];
};

/**
 * Static scene for repeated queries. `meshes`: [{ name, triangles }] in CarScope cm, `region(name,
 * centroid)` optionally labels each static triangle (e.g. fender / cowl), `cell` is the grid size in cm.
 */
export function staticScene(meshes, { cell = 6, region = (name) => name } = {}) {
  const items = [];
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const m of meshes) {
    const n = m.triangles.length / 9;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = boxOf(m.triangles, i);
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const id = items.length;
      items.push({ mesh: m.name, region: region(m.name, c), tri: tri(m.triangles, i), lo, hi, index: i });
      for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
        for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
          for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
            const k = key(x, y, z);
            (grid.get(k) ?? grid.set(k, []).get(k)).push(id);
          }
    }
  }
  return { items, grid, cell, key };
}

/**
 * Moving triangles (CarScope cm) against a static scene. Pairs within `cutoff` cm get the exact
 * narrow phase; anything farther is reported as ">= cutoff". Deterministic: fixed iteration order.
 *
 * `baseline`: static triangle ids the part already touches when closed (modelled seams). They are
 * tallied separately (baseline*) and excluded from `minDistanceCm` / `intersectingPairs`, so those
 * fields describe interference that the motion creates. Raw totals stay in `all*`.
 */
export function meshClearance(moving, scene, { cutoff = 10, contact = 0.05, baseline = null } = {}) {
  const { items, grid, cell, key } = scene;
  const n = moving.length / 9;
  const seen = new Int32Array(items.length).fill(-1);
  let min = { d: Infinity }, minAll = Infinity;
  const intersecting = [], byRegion = {};
  let pairs = 0, baselineIntersecting = 0, allIntersecting = 0;
  for (let i = 0; i < n; i++) {
    const [lo, hi] = boxOf(moving, i);
    const A = tri(moving, i);
    for (let x = Math.floor((lo[0] - cutoff) / cell); x <= Math.floor((hi[0] + cutoff) / cell); x++)
      for (let y = Math.floor((lo[1] - cutoff) / cell); y <= Math.floor((hi[1] + cutoff) / cell); y++)
        for (let z = Math.floor((lo[2] - cutoff) / cell); z <= Math.floor((hi[2] + cutoff) / cell); z++) {
          const ids = grid.get(key(x, y, z));
          if (!ids) continue;
          for (const id of ids) {
            if (seen[id] === i) continue;
            seen[id] = i;
            const s = items[id];
            if (s.lo[0] > hi[0] + cutoff || s.hi[0] < lo[0] - cutoff || s.lo[1] > hi[1] + cutoff || s.hi[1] < lo[1] - cutoff || s.lo[2] > hi[2] + cutoff || s.hi[2] < lo[2] - cutoff) continue;
            pairs++;
            const r = triangleDistance(A, s.tri);
            if (r.d < minAll) minAll = r.d;
            if (r.intersects) allIntersecting++;
            if (baseline?.has(id)) { if (r.intersects) baselineIntersecting++; continue; }
            const reg = (byRegion[s.region] ??= { minCm: Infinity, intersectingPairs: 0, contactPairs: 0 });
            if (r.d < reg.minCm) reg.minCm = r.d;
            if (r.intersects) { reg.intersectingPairs++; intersecting.push({ moving: i, static: id, mesh: s.mesh, region: s.region, at: A[0] }); }
            else if (r.d <= contact) reg.contactPairs++;
            if (r.d < min.d) min = { ...r, mesh: s.mesh, region: s.region, movingTri: i, staticTri: id };
          }
        }
  }
  return {
    method: "MESH_TRIANGLE_EXACT",
    cutoffCm: cutoff,
    narrowPhasePairs: pairs,
    baselineTriangles: baseline ? baseline.size : 0,
    baselineIntersectingPairs: baselineIntersecting,
    allIntersectingPairs: allIntersecting,
    minDistanceAllCm: Number.isFinite(minAll) ? minAll : null,
    minDistanceCm: Number.isFinite(min.d) ? min.d : null, // null: nothing within cutoff
    closest: Number.isFinite(min.d) ? { mesh: min.mesh, region: min.region, onMoving: min.p, onStatic: min.q } : null,
    intersectingPairs: intersecting.length,
    intersectingStaticTriangles: [...new Set(intersecting.map((x) => x.static))].sort((a, b) => a - b),
    intersections: intersecting,
    byRegion,
  };
}

/** Static triangles the closed part intersects or touches (within `contact` cm): its modelled seams. */
export function baselineContacts(closed, scene, { contact = 0.05 } = {}) {
  const ids = new Set();
  const { items, grid, cell, key } = scene;
  for (let i = 0; i < closed.length / 9; i++) {
    const [lo, hi] = boxOf(closed, i), A = tri(closed, i);
    for (let x = Math.floor((lo[0] - contact) / cell); x <= Math.floor((hi[0] + contact) / cell); x++)
      for (let y = Math.floor((lo[1] - contact) / cell); y <= Math.floor((hi[1] + contact) / cell); y++)
        for (let z = Math.floor((lo[2] - contact) / cell); z <= Math.floor((hi[2] + contact) / cell); z++)
          for (const id of grid.get(key(x, y, z)) ?? []) if (!ids.has(id) && triangleDistance(A, items[id].tri).d <= contact) ids.add(id);
  }
  return ids;
}
