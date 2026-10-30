// Sampled solid containment plus triangle-surface/edge intersection. No audit proxy geometry.
import { rotateZ, vec } from "./mesh.mjs";
import { POLICY } from "./policy.mjs";

const { add, sub, mul, dot, cross, len, unit } = vec;
const EPS = POLICY.surfaceEpsilonCm;
const key = (p) => p.map((x) => Math.round(x * 1e8)).join(",");
const unique = (pts) => [...new Map(pts.map((p) => [key(p), p])).values()];
export const bounds = (pts) => pts.reduce((b, p) => [b[0].map((x, i) => Math.min(x, p[i])), b[1].map((x, i) => Math.max(x, p[i]))], [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
const overlaps = (a, b) => [0, 1, 2].every((i) => a[0][i] <= b[1][i] + EPS && b[0][i] <= a[1][i] + EPS);
const inBox = (b, p) => p.every((x, i) => x >= b[0][i] - EPS && x <= b[1][i] + EPS);

export function insidePrism(g, p) {
  const d = sub(p, g.F.o), s = dot(d, g.F.a), u = dot(d, g.F.u), w = dot(d, g.F.v);
  if (s <= g.s0 || s >= g.s1) return 0;
  let inside = false, edge = Infinity;
  for (let i = 0, j = g.poly.length - 1; i < g.poly.length; j = i++) {
    const [xi, yi] = g.poly[i], [xj, yj] = g.poly[j];
    if ((yi > w) !== (yj > w) && u < (xj - xi) * (w - yi) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi, ey = yj - yi;
    const t = Math.max(0, Math.min(1, ((u - xi) * ex + (w - yi) * ey) / (ex * ex + ey * ey || 1)));
    edge = Math.min(edge, Math.hypot(u - xi - t * ex, w - yi - t * ey));
  }
  return inside ? Math.max(0, Math.min(edge, s - g.s0, g.s1 - s)) : 0;
}

function convexDepth(g, p) {
  const centre = mul(g.vertices.reduce(add, [0, 0, 0]), 1 / g.vertices.length);
  let depth = Infinity;
  for (const face of g.faces) {
    const [a, b, c] = face.map((i) => g.vertices[i]);
    let n = unit(cross(sub(b, a), sub(c, a)));
    if (dot(n, sub(a, centre)) < 0) n = mul(n, -1);
    const d = -dot(n, sub(p, a));
    if (d <= 0) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}

// Möller–Trumbore, finite segment; coplanar/tangent surfaces are handled by containment/contact.
export function segmentTriangle(a, b, tri) {
  const direction = sub(b, a), e1 = sub(tri[1], tri[0]), e2 = sub(tri[2], tri[0]);
  const h = cross(direction, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(a, tri[0]), u = dot(s, h) / det;
  if (u < -EPS || u > 1 + EPS) return null;
  const q = cross(s, e1), v = dot(direction, q) / det;
  if (v < -EPS || u + v > 1 + EPS) return null;
  const t = dot(e2, q) / det;
  return t >= -EPS && t <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null;
}

const triangles = (m) => Array.from({ length: m.indices.length / 3 }, (_, i) => {
  const points = m.indices.slice(3 * i, 3 * i + 3).map((j) => m.positions[j]);
  return { points, box: bounds(points) };
});
function tree(tris) {
  const box = bounds(tris.flatMap((t) => t.box));
  if (tris.length <= 12) return { box, tris };
  const axis = [0, 1, 2].sort((a, b) => (box[1][b] - box[0][b]) - (box[1][a] - box[0][a]))[0];
  tris.sort((a, b) => a.box[0][axis] + a.box[1][axis] - b.box[0][axis] - b.box[1][axis]);
  const mid = Math.floor(tris.length / 2);
  return { box, left: tree(tris.slice(0, mid)), right: tree(tris.slice(mid)) };
}
function query(node, box, visit) {
  if (!overlaps(node.box, box)) return;
  if (node.tris) { for (const t of node.tris) if (overlaps(t.box, box)) visit(t); }
  else { query(node.left, box, visit); query(node.right, box, visit); }
}

// Distance to triangle via vertex/edge/face Voronoi regions.
function triangleDistance(p, [a, b, c]) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return len(sub(ap, mul(ab, d1 / (d1 - d3))));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return len(sub(ap, mul(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return len(sub(bp, mul(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6))));
  return Math.abs(dot(ap, unit(cross(ab, ac))));
}

export function collider(part) {
  const tris = triangles(part.mesh), box = bounds(part.mesh.positions), bvh = tree([...tris]);
  const verts = unique(part.mesh.positions);
  const depth = (p) => {
    if (!inBox(box, p)) return 0;
    if (part.geo?.kind === "prism") return insidePrism(part.geo, p);
    if (part.geo?.kind === "convex") return convexDepth(part.geo, p);
    // Faceted lathe surfaces: test the actual triangles, not a smooth cylinder approximation.
    const end = add(p, mul(unit([1, 0.371390676, 0.618033989]), 10000));
    const hits = [];
    query(bvh, bounds([p, end]), (t) => { const s = segmentTriangle(p, end, t.points); if (s !== null && s > EPS) hits.push(s); });
    const distinct = hits.sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > 1e-9);
    if (distinct.length % 2 === 0) return 0;
    return Math.min(...tris.map((t) => triangleDistance(p, t.points)));
  };
  return { part, tris, box, bvh, verts, depth };
}

export function surfaceOverlap(a, b) {
  let trianglePairs = 0, intersections = 0;
  const edgesA = new Map(), edgesB = new Map();
  const collect = (triangle, other, store) => {
    for (let i = 0; i < 3; i++) {
      const p = triangle[i], q = triangle[(i + 1) % 3];
      const t = segmentTriangle(p, q, other);
      if (t === null) continue;
      intersections++;
      const k = `${key(p)}>${key(q)}`;
      const edge = store.get(k) ?? { p, q, ts: [0, 1] };
      edge.ts.push(t); store.set(k, edge);
    }
  };
  for (const t of a.tris) query(b.bvh, t.box, (u) => {
    trianglePairs++;
    collect(t.points, u.points, edgesA); collect(u.points, t.points, edgesB);
  });
  const deepest = (edges, into) => {
    let worst = { depth: 0 };
    for (const { p, q, ts } of edges.values()) {
      const ordered = ts.sort((x, y) => x - y).filter((v, i, all) => i === 0 || v - all[i - 1] > EPS);
      for (let i = 1; i < ordered.length; i++) for (const fraction of [0.25, 0.5, 0.75]) {
        const point = add(p, mul(sub(q, p), ordered[i - 1] + (ordered[i] - ordered[i - 1]) * fraction));
        const depth = into.depth(point);
        if (depth > worst.depth) worst = { depth, point };
      }
    }
    return worst;
  };
  return { trianglePairs, intersections, aIntoB: deepest(edgesA, b), bIntoA: deepest(edgesB, a) };
}

function samplePoints(c) {
  const pts = [...c.verts];
  for (const { points: tri } of c.tris) {
    pts.push(mul(tri.reduce(add, [0, 0, 0]), 1 / 3));
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3], n = Math.ceil(len(sub(q, p)) / 2);
      for (let i = 1; i < n; i++) pts.push(add(p, mul(sub(q, p), i / n)));
    }
  }
  return unique(pts);
}
export function angles(max) {
  const set = new Set([max]);
  for (let i = 0; i * POLICY.sweepStepDegrees <= max; i++) set.add(i * POLICY.sweepStepDegrees);
  const from = Math.round(POLICY.fineFromDegrees / POLICY.fineStepDegrees);
  const to = Math.round(Math.min(POLICY.fineToDegrees, max) / POLICY.fineStepDegrees);
  for (let i = from; i <= to; i++) set.add(Number((i * POLICY.fineStepDegrees).toFixed(10)));
  return [...set].sort((a, b) => a - b);
}
export function posePart(p, deg) {
  const angle = -deg * Math.PI / 180;
  const point = (q) => rotateZ(q, p.pivot, angle);
  const dir = (q) => rotateZ(q, [0, 0, 0], angle);
  const g = p.geo;
  return { ...p, mesh: { positions: p.mesh.positions.map(point), normals: p.mesh.normals.map(dir), indices: p.mesh.indices },
    geo: g?.F ? { ...g, F: { o: point(g.F.o), u: dir(g.F.u), v: dir(g.F.v), a: dir(g.F.a) } } : g };
}

export function sweepDoors({ parts, doorDefs }) {
  // All fixed closed meshes, including wheels and fixed hinges. Open decals have no solid interior.
  const body = parts.filter((p) => p.parent === "body" && p.closed).map(collider);
  const report = { policy: POLICY, doors: {}, bothDoors: { poses: 0, testedPairs: 0, violations: [] } };
  const doorPoses = {};
  for (const def of Object.values(doorDefs)) {
    const rest = parts.filter((p) => p.parent === def.id && p.closed).map((p) => ({ p, samples: samplePoints(collider(p)) }));
    const results = [], poses = [];
    for (const deg of angles(def.open)) {
      const moving = rest.map(({ p }) => collider(posePart(p, deg)));
      poses.push({ deg, box: bounds(moving.flatMap((c) => c.box)), moving });
      let pointWorst = { depth: 0 }, surfaceWorst = { depth: 0 }, surfaceIntersections = 0, trianglePairs = 0;
      const record = (w, depth, a, b, point) => depth > w.depth ? { depth, movingPart: a.part.partId, bodyPart: b.part.partId, point } : w;
      moving.forEach((a, index) => {
        for (const b of body) {
          if (!overlaps(a.box, b.box)) continue;
          for (const p of rest[index].samples) {
            const q = rotateZ(p, rest[index].p.pivot, -deg * Math.PI / 180);
            pointWorst = record(pointWorst, b.depth(q), a, b, q);
          }
          for (const p of b.verts) pointWorst = record(pointWorst, a.depth(p), a, b, p);
          const s = surfaceOverlap(a, b);
          trianglePairs += s.trianglePairs; surfaceIntersections += s.intersections;
          for (const v of [s.aIntoB, s.bIntoA]) surfaceWorst = record(surfaceWorst, v.depth, a, b, v.point);
        }
      });
      results.push({ deg, pointWorst, surfaceWorst, surfaceIntersections, trianglePairs });
    }
    doorPoses[def.id] = poses;
    report.doors[def.id] = { angles: results.length, fixedClosedParts: body.length, results,
      violations: results.filter((r) => Math.max(r.pointWorst.depth, r.surfaceWorst.depth) > POLICY.penetrationCm) };
  }
  const [front, rear] = Object.values(doorPoses);
  // Independent opening angles, not just equal fractions. AABB rejects only provably disjoint pairs.
  for (const a of front) for (const b of rear) {
    report.bothDoors.poses++;
    if (!overlaps(a.box, b.box)) continue;
    for (const x of a.moving) for (const y of b.moving) {
      if (!overlaps(x.box, y.box)) continue;
      report.bothDoors.testedPairs++;
      const s = surfaceOverlap(x, y);
      const depth = Math.max(s.aIntoB.depth, s.bIntoA.depth, ...x.verts.map(y.depth), ...y.verts.map(x.depth));
      if (depth > POLICY.penetrationCm) report.bothDoors.violations.push({ front: a.deg, rear: b.deg, depth, a: x.part.partId, b: y.part.partId });
    }
  }
  return report;
}

export function collisionFailures(report) {
  return [...Object.entries(report.doors).flatMap(([id, d]) => d.violations.map((v) => `${id} at ${v.deg}°: point ${v.pointWorst.depth} / surface ${v.surfaceWorst.depth} cm`)),
    ...report.bothDoors.violations.map((v) => `door/door ${v.front}°/${v.rear}°: ${v.depth} cm`)];
}
