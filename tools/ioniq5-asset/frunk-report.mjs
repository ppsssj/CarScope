#!/usr/bin/env node
// node tools/ioniq5-asset/frunk-report.mjs --glb=<local GLB> --axes=<P3-A1 hood-feasibility.json> --out=<external dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { glbParts, buildIoniqSvg } from './anatomy-svg.mjs';
import { fitMeshProjection } from '../anatomy-car/mesh-svg/mesh-svg.mjs';
import { buildFrontCompartment, measureHoodSurface, panelStats } from './front-compartment.mjs';
import { buildFrunk, frunkPose, FRUNK_MIN_HOOD, FRUNK_MAX_ANGLE } from './frunk.mjs';
import { staticScene, meshClearance } from './collision.mjs';
import { classifyCrossings } from './front-compartment-report.mjs';
import { HOOD_NODE, rotatePoints } from './hood.mjs';
import { axisCandidates } from './hood.mjs';
import { hoodHierarchy } from './hood-feasibility.mjs';
import { frunkGlb } from './frunk-glb.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
export async function main(argv) {
  const args = Object.fromEntries(argv.map((s) => s.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
  if (!args.out || !args.glb || !args.axes) throw Error('usage: frunk-report.mjs --glb=<GLB> --axes=<P3-A1 report JSON> --out=<external dir>');
  const out = resolve(args.out), rel = relative(repo, out);
  if (!rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Refusing model-derived output inside the CarScope repo');
  const bytes = readFileSync(args.glb), nodes = glbParts(bytes), hood = nodes.find((n) => n.name === HOOD_NODE).triangles;
  const axesReport = JSON.parse(readFileSync(args.axes, 'utf8'));
  assert.equal(axesReport.glbSha256, sha(bytes), 'axis report must refer to the same input GLB');
  const axes = ['A', 'C'].map((id) => { const a = axesReport.candidates.find((a) => a.id === id); assert.ok(a, `axis ${id}`); return a; });
  const hierarchy = hoodHierarchy(bytes);
  axes[0] = axisCandidates({ hoodTriangles: hood, groupOriginCm: hierarchy.group.originCm, groupLateralCm: hierarchy.lateralAxisCar }).candidates.find((a) => a.id === 'A');
  const shell = buildFrontCompartment({ hoodSurface: measureHoodSurface(hood) }), frunk = buildFrunk(shell);
  const fixed = [...nodes.filter((n) => n.name !== HOOD_NODE), ...shell.panels];
  const fixedScene = staticScene(fixed), tub = frunk.parts.filter((p) => !p.moving), moving = frunk.parts.filter((p) => p.moving);
  const tubScene = staticScene([...fixed, ...tub]);
  const checks = [];
  for (const p of frunk.parts) checks.push({ part: p.id, against: 'all source meshes except hood + shell', ...classifyCrossings(p.id, p.triangles, fixedScene, [], { cutoff: 10 }) });
  for (let i = 0; i < frunk.parts.length; i++) for (let j = i + 1; j < frunk.parts.length; j++) checks.push({ part: frunk.parts[i].id, against: frunk.parts[j].id, ...classifyCrossings(frunk.parts[i].id, frunk.parts[i].triangles, staticScene([frunk.parts[j]]), frunk.joints) });
  const rows = [];
  const check = (label, axis, hoodDeg, coverDeg, T, scene) => {
    const c = meshClearance(T, scene, { cutoff: 5 });
    const within = c.minDistanceCm !== null && c.minDistanceCm <= 5;
    rows.push({ label, axis: axis.id, hoodDeg, coverDeg, method: c.method, crossings: c.intersectingPairs, minCm: within ? c.minDistanceCm : null, distanceBoundCm: 5, closest: within ? c.closest?.mesh ?? null : null });
  };
  const closedFrunk = staticScene(frunk.parts);
  for (const axis of axes) {
    // All hood positions with closed cover; complete original hood mesh, no seam exemptions needed.
    for (let h = 0; h <= 60; h++) check('hood vs closed frunk', axis, h, 0, rotatePoints(hood, axis, h), closedFrunk);
    // All integer allowed poses, not just boundary angles: 16 hood angles x 61 cover angles x 2 axes.
    for (let h = FRUNK_MIN_HOOD; h <= 60; h++) {
      const hoodScene = staticScene([{ name: HOOD_NODE, triangles: rotatePoints(hood, axis, h) }]);
      for (let c = 0; c <= FRUNK_MAX_ANGLE; c++) for (const p of frunkPose(frunk, c).filter((p) => p.moving)) check(p.id + ' vs hood', axis, h, c, p.triangles, hoodScene);
    }
  }
  for (let c = 0; c <= FRUNK_MAX_ANGLE; c++) for (const p of frunkPose(frunk, c).filter((p) => p.moving)) check(p.id + ' vs tub/source/shell', { id: '-' }, null, c, p.triangles, tubScene);
  const stats = frunk.parts.map(panelStats);
  const failures = checks.filter((c) => c.defects).length + rows.filter((r) => r.crossings).length + stats.filter((s) => s.degenerate).length;
  console.log(JSON.stringify({ phase: 'triangles', checks, failures, firstCrossings: rows.filter((r) => r.crossings).slice(0, 8), cavityLitres: frunk.cavityLitres }));
  mkdirSync(join(out, 'svg'), { recursive: true });
  const validator = createRequire(import.meta.url)('../anatomy-car/node_modules/gltf-validator');
  const glbChecks = [];
  for (const deg of [0, 60]) {
    const glb = frunkGlb(shell, frunk, deg), validation = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 100 });
    assert.equal(validation.issues.numErrors, 0); assert.equal(validation.issues.numWarnings, 0);
    const actual = glbParts(glb), expected = [...shell.panels, ...frunkPose(frunk, deg)]; let maxDelta = 0;
    for (const p of expected) { const T = actual.find((n) => n.name === p.id).triangles; assert.equal(T.length, p.triangles.length); for (let i=0;i<T.length;i++) maxDelta=Math.max(maxDelta,Math.abs(T[i]-p.triangles[i])); }
    assert.ok(maxDelta < 0.0001, 'GLB coordinates/rigid hierarchy round trip');
    const file = `shell-frunk-${deg}.glb`; writeFileSync(join(out, file), glb);
    glbChecks.push({ file, sha256:sha(glb), bytes:glb.length, errors:validation.issues.numErrors, warnings:validation.issues.numWarnings, maxVertexDeltaCm:maxDelta });
  }
  const reference = await buildIoniqSvg(bytes);
  const axis = axes[0], fitted = fitMeshProjection([...nodes, { triangles: rotatePoints(hood, axis, 60) }, ...frunkPose(frunk, 60)], reference.anatomy.k);
  const frames = [], texts = {};
  for (const [label, h, c, include, projection] of [
    ['closed-baseline', 0, 0, false, null], ['closed-frunk', 0, 0, true, null],
    ['hood45-cover0', 45, 0, true, fitted], ['hood45-cover30', 45, 30, true, fitted], ['hood45-cover60', 45, 60, true, fitted], ['hood60-cover60', 60, 60, true, fitted],
  ]) {
    const posed = nodes.map((n) => n.name === HOOD_NODE ? { ...n, triangles: rotatePoints(n.triangles, axis, h) } : n);
    const b = await buildIoniqSvg(bytes, { nodes: [...posed, ...(include ? [...shell.panels, ...frunkPose(frunk, c)] : [])], ...(projection ? { projection } : {}) });
    texts[label] = b.svg;
    writeFileSync(join(out, 'svg', label + '.svg'), b.svg);
    frames.push({ label, sha256: sha(b.svg), bytes: Buffer.byteLength(b.svg), visibleFrunkIds: [...new Set(b.result.fills.map((f) => f.id))].filter((id) => id.startsWith('frunk-')) });
    if (label === 'hood45-cover60') {
      const again = await buildIoniqSvg(bytes, { nodes: [...posed, ...shell.panels, ...frunkPose(frunk, c)], projection });
      assert.equal(again.svg, b.svg, 'deterministic SVG');
    }
  }
  const svg = { frames, closedIdentical: texts['closed-baseline'] === texts['closed-frunk'], deterministic: true };
  const report = { glbSha256: sha(bytes), axesFileSha256: sha(readFileSync(args.axes)), axes, stats, meta: frunk.parts.map((p) => p.meta),
    cavityLitres: frunk.cavityLitres, bottomZ: frunk.bottomZ, depth: frunk.depth, checks, rows, failures, svg, glbChecks,
    note: 'Exact triangle tests at 1 degree integer poses only; not continuous collision proof. rows.minCm=null means >=distanceBoundCm, not an exact minimum. Estimated cavity volume, not OEM/VDA verification. Mounting hardware unmodelled.' };
  writeFileSync(join(out, 'frunk-report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(failures, 0, 'triangle checks');
  assert.ok(svg.closedIdentical, 'closed SVG byte regression');
  assert.ok(frames.find((f) => f.label === 'hood45-cover0').visibleFrunkIds.includes('frunk-cover'));
  assert.ok(frames.find((f) => f.label === 'hood45-cover60').visibleFrunkIds.includes('frunk-tub'));
  console.log(`PASS ${rows.length} sampled triangle checks; ${frunk.cavityLitres.toFixed(3)} L cavity; SVG closed identical/deterministic`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exitCode = 1; });
