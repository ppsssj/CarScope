import test from "node:test";
import assert from "node:assert/strict";
import { prismMesh } from "../geometry-export/mesh.mjs";
import { collider, insidePrism, segmentTriangle, surfaceOverlap, angles } from "../geometry-export/collision.mjs";

const slab = (x, y, w, d, z, h) => {
  const geo = { kind: "prism", F: { o: [x, y, z], u: [1, 0, 0], v: [0, 1, 0], a: [0, 0, 1] }, poly: [[0, 0], [w, 0], [w, d], [0, d]], s0: 0, s1: h };
  return collider({ geo, mesh: prismMesh(geo) });
};
test("prism containment returns actual interior depth and zero on the boundary", () => {
  const c = slab(0, 0, 2, 2, 0, 2);
  assert.equal(insidePrism(c.part.geo, [1, 1, 1]), 1);
  assert.equal(c.depth([0, 1, 1]), 0);
  assert.equal(c.depth([3, 1, 1]), 0);
});
test("triangle intersection detects a segment crossing but rejects separated and coplanar contact", () => {
  const t = [[0, 0, 0], [2, 0, 0], [0, 2, 0]];
  assert.equal(segmentTriangle([0.5, 0.5, -1], [0.5, 0.5, 1], t), 0.5);
  assert.equal(segmentTriangle([3, 3, -1], [3, 3, 1], t), null);
  assert.equal(segmentTriangle([0, 0, 0], [1, 0, 0], t), null);
});
test("surface intervals detect crossed solids even when neither has an interior vertex", () => {
  const a = slab(-5, -1, 10, 2, -0.5, 1), b = slab(-1, -5, 2, 10, -1, 2);
  assert.ok(a.verts.every((p) => b.depth(p) === 0));
  assert.ok(b.verts.every((p) => a.depth(p) === 0));
  const s = surfaceOverlap(a, b);
  assert.ok(s.intersections > 0);
  assert.ok(Math.max(s.aIntoB.depth, s.bIntoA.depth) > 0.3);
});
test("flush face contact and separated solids have no penetration", () => {
  const a = slab(0, 0, 2, 2, 0, 2);
  for (const x of [2, 3]) {
    const s = surfaceOverlap(a, slab(x, 0, 2, 2, 0, 2));
    assert.equal(s.aIntoB.depth, 0); assert.equal(s.bIntoA.depth, 0);
  }
});
test("sweep includes endpoints, the whole degree range, and 0.1° samples through the defect", () => {
  const a = angles(58);
  for (let d = 0; d <= 58; d++) assert.ok(a.includes(d));
  for (let d = 40; d <= 70; d++) assert.ok(a.includes(d / 10));
});
