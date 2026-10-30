import test from "node:test";
import assert from "node:assert/strict";
import { prismMesh, checkMesh } from "../geometry-export/mesh.mjs";
import { meshFailures, requireValid } from "../geometry-export/policy.mjs";

const cube = () => prismMesh({ F: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], a: [0, 0, 1] }, poly: [[0, 0], [2, 0], [2, 2], [0, 2]], s0: 0, s1: 2 });
const report = (m) => ({ checks: [{ partId: "fixture", cls: "prism", ...checkMesh(m, { closed: true }) }], doorRigidity: Object.fromEntries(["door-front-left", "door-rear-left"].map((id) => [id, { comparedParts: 1, maxDeviation: 0 }])) });

test("valid closed mesh is accepted without fixed vehicle part/triangle counts", () => requireValid(meshFailures(report(cube()))));
for (const [name, corrupt] of [
  ["degenerate", (m) => { m.positions[1] = m.positions[0]; }],
  ["flipped normals", (m) => { m.normals[0] = m.normals[0].map((v) => -v); }],
  ["winding", (m) => { [m.indices[0], m.indices[1]] = [m.indices[1], m.indices[0]]; }],
  ["non-manifold duplicate face", (m) => { m.indices.push(...m.indices.slice(0, 3)); }],
  ["open boundary", (m) => { m.indices.splice(0, 3); }],
  ["inward", (m) => { for (let i = 0; i < m.indices.length; i += 3) [m.indices[i], m.indices[i + 1]] = [m.indices[i + 1], m.indices[i]]; m.normals = m.normals.map((n) => n.map((v) => -v)); }],
]) test(`rejects actual ${name} geometry`, () => { const m = cube(); corrupt(m); assert.throws(() => requireValid(meshFailures(report(m))), /Geometry validation failed/); });

test("rejects non-finite and invalid indices before they can serialize as null", () => {
  const m = cube(); m.positions[0][0] = NaN;
  assert.throws(() => checkMesh(m, { closed: true }), /Invalid mesh/);
  const n = cube(); n.indices[0] = 100000;
  assert.throws(() => checkMesh(n, { closed: true }), /Invalid mesh/);
});
test("rejects missing, non-finite or excessive door rigidity", () => {
  for (const maxDeviation of [undefined, null, Infinity, 1e-5]) {
    const r = report(cube()); r.doorRigidity["door-rear-left"].maxDeviation = maxDeviation;
    assert.throws(() => requireValid(meshFailures(r)), /rigidity/);
  }
});
