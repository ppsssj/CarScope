import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildFrunk, frunkPose, frunkTransition, signedVolume } from '../frunk.mjs';
import { buildFrontCompartment, measureHoodSurface, panelStats } from '../front-compartment.mjs';
import { HOOD_SAMPLE_GRID } from '../front-compartment-layout.mjs';
import { glbParts } from '../anatomy-svg.mjs';
import { staticScene, meshClearance, crossingPoint, closestOnTriangle } from '../collision.mjs';
import { frunkGlb } from '../frunk-glb.mjs';

const shell = buildFrontCompartment({ hoodSurface: { ...HOOD_SAMPLE_GRID, z: HOOD_SAMPLE_GRID.y.map(() => HOOD_SAMPLE_GRID.x.map(() => 105)) } });
const f = buildFrunk(shell);
test('coplanar crossing point lies on BOTH triangles for containment and edge crossing', () => {
  for (const [a, b] of [
    [[[0,0,0],[10,0,0],[0,10,0]], [[1,1,0],[2,1,0],[1,2,0]]],
    [[[-3,-1,0],[3,-1,0],[0,3,0]], [[-3,1,0],[3,1,0],[0,-3,0]]],
  ]) {
    const p = crossingPoint(a, b);
    for (const t of [a, b]) assert.ok(Math.hypot(...p.map((v, k) => v - closestOnTriangle(p, ...t)[k])) < 1e-8);
  }
});
test('estimated tub: closed manifold, outward winding, nondegenerate; true cavity is 57 L', () => {
  assert.ok(Math.abs(f.cavityLitres - 57) < 1e-9);
  for (const p of [...f.parts, { id: 'cavity', triangles: f.cavity }]) {
    assert.equal(panelStats(p).degenerate, 0);
    assert.ok(signedVolume(p.triangles) > 0, p.id);
    const edges = new Map(), point = (i) => Array.from(p.triangles.slice(i, i + 3)).map((n) => n.toFixed(6)).join(',');
    for (let i = 0; i < p.triangles.length; i += 9) for (let k = 0; k < 3; k++) {
      const a = point(i + 3 * k), b = point(i + 3 * ((k + 1) % 3)), key = [a, b].sort().join('|');
      const v = edges.get(key) ?? { count: 0, orientation: 0 }; v.count++; v.orientation += a < b ? 1 : -1; edges.set(key, v);
    }
    for (const [key, v] of edges) assert.deepEqual(v, { count: 2, orientation: 0 }, `${p.id} ${key}`);
  }
  assert.deepEqual(buildFrunk(shell), f, 'deterministic builder');
  assert.throws(() => buildFrunk(), /measured front compartment/);
});
test('cover rotation is rigid and reversible; tub never moves; no NaN or extrapolation', () => {
  for (const deg of [0, 15, 30, 45, 60]) {
    const p = frunkPose(f, deg);
    assert.deepEqual(p[0].triangles, f.parts[0].triangles);
    for (let j = 1; j < p.length; j++) {
      assert.ok(Math.abs(signedVolume(p[j].triangles) - signedVolume(f.parts[j].triangles)) < 1e-8);
      const a = f.parts[j].triangles, b = p[j].triangles;
      for (let i = 3; i < a.length; i += 3) assert.ok(Math.abs(Math.hypot(a[i]-a[0], a[i+1]-a[1], a[i+2]-a[2]) - Math.hypot(b[i]-b[0], b[i+1]-b[1], b[i+2]-b[2])) < 1e-10);
    }
  }
  assert.deepEqual(frunkPose(f, 0).map((p) => p.triangles), f.parts.map((p) => p.triangles));
  for (const n of [NaN, Infinity, -1, 61]) assert.throws(() => frunkPose(f, n), RangeError);
});
test('GLB sidecar round trips the cm-to-m coordinate map and articulated rigid cover', () => {
  for (const deg of [0, 60]) {
    const actual = glbParts(frunkGlb(shell, f, deg)), expected = [...shell.panels, ...frunkPose(f, deg)];
    for (const p of expected) { const T = actual.find((n) => n.name === p.id).triangles;
      assert.equal(T.length, p.triangles.length);
      for (let i=0;i<T.length;i++) assert.ok(Math.abs(T[i]-p.triangles[i]) < 0.0001, p.id);
    }
  }
});
test('all interaction entrypoints share a rejecting sequence guard', () => {
  const closed = { hood: 0, cover: 0 };
  assert.equal(frunkTransition(closed, { cover: 1 }).accepted, false);
  const open = frunkTransition(closed, { hood: 45, cover: 60 });
  assert.equal(open.accepted, true);
  const blocked = frunkTransition(open.state, { hood: 44.9 });
  assert.equal(blocked.accepted, false); assert.deepEqual(blocked.state, open.state);
  assert.equal(frunkTransition(open.state, { cover: 0 }).accepted, true);
  assert.equal(frunkTransition(closed, { hood: NaN }).accepted, false);
});
test('report rejects repository output before opening input', () => {
  for (const out of ['tools/tmp-frunk', '..frunk-output']) {
    const r = spawnSync(process.execPath, ['tools/ioniq5-asset/frunk-report.mjs', '--glb=missing', '--axes=missing', '--out=' + out], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /Refusing model-derived output/);
    const browser = spawnSync(process.execPath, ['tools/three-poc/check-ioniq5-frunk.mjs', out], { encoding: 'utf8' });
    assert.equal(browser.status, 1); assert.match(browser.stderr, /Provide an output folder outside the repo/);
  }
});
test('real local GLB: estimated frunk inside reservation, clear of every original mesh and shell', { skip: !process.env.IONIQ5_GLB }, () => {
  const nodes = glbParts(readFileSync(process.env.IONIQ5_GLB)), hood = nodes.find((n) => n.name === 'Door_Front_0');
  const realShell = buildFrontCompartment({ hoodSurface: measureHoodSurface(hood.triangles) }), realFrunk = buildFrunk(realShell);
  const scene = staticScene([...nodes, ...realShell.panels]);
  for (const p of realFrunk.parts) assert.equal(meshClearance(p.triangles, scene, { cutoff: 2 }).intersectingPairs, 0, p.id);
});
