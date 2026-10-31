// P3-A2.1 front compartment shell tests. Synthetic only, except the tests gated on IONIQ5_GLB (the
// OpenX model never enters CI; without it those tests are reported as SKIP).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrontCompartment, panelStats, sheet, orient, boxTriangles, MIN_TRIANGLE_AREA } from "../front-compartment.mjs";
import { PARTS, ZONES, JOINTS, CONFIDENCE, MODEL_REFERENCES, HOOD_GAP, hoodUndersideAt, hoodClearanceOver, zoneBoxes } from "../front-compartment-layout.mjs";
import { classifyCrossings, jointFor } from "../front-compartment-report.mjs";
import { staticScene, meshClearance } from "../collision.mjs";
import { buildIoniqSvg, glbParts } from "../anatomy-svg.mjs";
import * as H from "../hood.mjs";
import { hoodHierarchy } from "../hood-feasibility.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const sha = (x) => createHash("sha256").update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest("hex");
const normalOf = (T, i) => { const u = [T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]], v = [T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
const shell = buildFrontCompartment();
const panel = (id) => shell.panels.find((p) => p.id === id);

test("shell components: ids, groups and provenance on every part", () => {
  assert.deepEqual(shell.panels.map((p) => p.id), ["fc-rear-bulkhead", "fc-cowl-cover", "fc-apron-left", "fc-apron-right", "fc-strut-tower-left", "fc-strut-tower-right", "fc-lower-liner", "fc-front-upper-support", "fc-front-shroud"]);
  assert.deepEqual(shell.zones.map((z) => z.id), ["zone-frunk", "zone-service-left", "zone-service-right"]);
  assert.deepEqual([...new Set(shell.panels.map((p) => p.group))], ["RearBoundary", "Aprons", "LowerLiner", "FrontUpperSupport"]);
  const required = ["id", "name", "geometryConfidence", "positionConfidence", "source", "vehicleVariant", "coordinateFrame", "isSynthetic", "visibility", "futureInteraction"];
  for (const x of [...shell.panels, ...shell.zones]) {
    for (const k of required) assert.ok(x.meta[k] !== undefined && x.meta[k] !== "", `${x.id}.${k}`);
    assert.ok(Object.values(CONFIDENCE).includes(x.meta.geometryConfidence) && Object.values(CONFIDENCE).includes(x.meta.positionConfidence));
    assert.equal(x.meta.isSynthetic, true);
    assert.match(x.meta.coordinateFrame, /CarScope cm/);
  }
  // New panels are never VERIFIED for the vehicle; zones are debug placeholders.
  for (const p of shell.panels) assert.equal(p.meta.geometryConfidence, CONFIDENCE.ESTIMATED);
  for (const z of shell.zones) { assert.equal(z.meta.geometryConfidence, CONFIDENCE.PLACEHOLDER); assert.equal(z.meta.visibility, "debug-only"); }
  for (const id of ["fc-rear-bulkhead", "fc-cowl-cover"]) assert.equal(panel(id).meta.boundary, "ESTIMATED_BOUNDARY");
  assert.match(shell.zones[0].meta.note, /not the tub shape/);
});

test("coordinate frame: left at +Y, front at +X, liner below the support, all inside the bay", () => {
  const st = Object.fromEntries(shell.panels.map((p) => [p.id, panelStats(p)]));
  assert.ok(st["fc-apron-left"].min[1] > 0 && st["fc-apron-right"].max[1] < 0);
  assert.ok(st["fc-strut-tower-left"].min[1] > 0 && st["fc-strut-tower-right"].max[1] < 0);
  assert.ok(st["fc-front-upper-support"].min[0] > st["fc-rear-bulkhead"].max[0] + 80);
  assert.ok(st["fc-lower-liner"].max[2] < st["fc-front-upper-support"].min[2]);
  // Left/right are exact mirrors (the symmetry is an assumption, recorded in the apron note).
  const verts = (T, s) => { const out = []; for (let i = 0; i < T.length; i += 3) out.push(`${T[i]},${s * T[i + 1]},${T[i + 2]}`); return out.sort(); };
  assert.deepEqual(verts(panel("fc-apron-left").triangles, 1), verts(panel("fc-apron-right").triangles, -1));
  for (const s of Object.values(st)) {
    assert.ok(s.min[0] > MODEL_REFERENCES.interiorFrontX.value + 1, `${s.id} in front of the dashboard`);
    assert.ok(s.max[0] < 216 && Math.max(Math.abs(s.min[1]), Math.abs(s.max[1])) <= 75 && s.min[2] > MODEL_REFERENCES.floorZ.value && s.max[2] < 100, `${s.id} inside the bay`);
  }
});

test("geometry is deterministic and has no degenerate or non-finite triangles", () => {
  const again = buildFrontCompartment();
  for (const p of shell.panels) {
    assert.equal(sha(p.triangles), sha(again.panels.find((x) => x.id === p.id).triangles), p.id);
    const s = panelStats(p);
    assert.equal(s.degenerate, 0, p.id);
    assert.ok(s.triangles > 0 && s.areaCm2 > 0);
  }
  // sheet() drops zero-area triangles from collapsed rows.
  assert.equal(sheet([[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0]]]).length, 0);
  assert.equal(sheet([[[0, 0, 0], [1, 0, 0]], [[0, 1, 0], [1, 1, 0]]]).length, 18);
  assert.ok(MIN_TRIANGLE_AREA > 0);
});

test("panel normals face the compartment; orient() turns reversed triangles", () => {
  const facing = { "fc-rear-bulkhead": (n) => n[0] > 0, "fc-cowl-cover": (n) => n[2] > 0 || n[0] > 0, "fc-apron-left": (n) => n[1] < 0, "fc-apron-right": (n) => n[1] > 0, "fc-lower-liner": (n) => n[2] > 0 || Math.abs(n[0]) > Math.abs(n[2]), "fc-front-shroud": (n) => n[0] < 0 };
  for (const [id, ok] of Object.entries(facing)) {
    const T = panel(id).triangles;
    let good = 0;
    for (let i = 0; i < T.length; i += 9) if (ok(normalOf(T, i))) good++;
    assert.equal(good, T.length / 9, `${id}: ${T.length / 9 - good} triangles face away`);
  }
  // Liner lips face the compartment too: rear lip toward +X, front lip toward -X.
  const flipped = orient([0, 0, 0, 0, 1, 0, 1, 0, 0], () => [0.3, 0.3, 5]);
  assert.ok(normalOf(flipped, 0)[2] > 0, "a downward-facing triangle is re-wound to face up");
});

test("panels stay under the closed hood with the design gap and inside the measured clearances", () => {
  for (const p of shell.panels) {
    const T = p.triangles;
    for (let i = 0; i < T.length; i += 3) {
      const h = hoodUndersideAt(T[i], T[i + 1]);
      if (h !== null) assert.ok(T[i + 2] <= h - HOOD_GAP + 0.75, `${p.id} vertex (${T[i]}, ${T[i + 1]}, ${T[i + 2]}) under hood ${h}`);
      if (T[i] < 123 && Math.abs(T[i + 1]) <= 69.4) assert.ok(T[i + 2] < MODEL_REFERENCES.cowlBodyMinZ.value, `${p.id} below the Body cowl strip`);
    }
  }
  assert.equal(hoodUndersideAt(140, 0), 106.6);
  assert.equal(hoodUndersideAt(300, 0), null);
  assert.ok(hoodClearanceOver(126, 196, -27, 27) < hoodUndersideAt(140, 0));
});

test("reserved zones: placeholders on the well and shelves, clear of each other and of the shell", () => {
  const zones = zoneBoxes();
  const frunk = zones.find((z) => z.id === "zone-frunk"), left = zones.find((z) => z.id === "zone-service-left"), right = zones.find((z) => z.id === "zone-service-right");
  assert.ok(frunk.min[1] < 0 && frunk.max[1] > 0, "frunk zone on the centre line");
  assert.ok(left.min[1] > frunk.max[1] && right.max[1] < frunk.min[1], "service zones beside it, separate");
  const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
  assert.ok(!overlap(frunk, left) && !overlap(frunk, right) && !overlap(left, right));
  for (const z of zones) assert.ok(z.max[2] > z.min[2] + 20, `${z.id} has height`);
  const litres = (z) => ((z.max[0] - z.min[0]) * (z.max[1] - z.min[1]) * (z.max[2] - z.min[2])) / 1000;
  assert.ok(litres(frunk) > 57, "the envelope is larger than the 57 L target on purpose");
  assert.match(ZONES[0].note, /57 L/);
  const shellScene = staticScene(shell.panels.map((p) => ({ name: p.id, triangles: p.triangles })));
  for (const z of shell.zones) assert.equal(meshClearance(z.triangles, shellScene, { cutoff: 1 }).intersectingPairs, 0, `${z.id} crosses the shell`);
  assert.equal(boxTriangles([0, 0, 0], [1, 1, 1]).length, 108);
});

test("shell-to-shell contacts are only the declared joints", () => {
  let defects = 0;
  for (let i = 0; i < shell.panels.length; i++) for (let j = i + 1; j < shell.panels.length; j++) {
    const c = classifyCrossings(shell.panels[i].id, shell.panels[i].triangles, staticScene([{ name: shell.panels[j].id, triangles: shell.panels[j].triangles }]), JOINTS);
    defects += c.defects;
  }
  assert.equal(defects, 0);
});

test("crossings are classified: inside a declared joint box vs a defect", () => {
  const joints = [{ part: "panel", with: "wall", min: [-1, -1, -1], max: [1, 1, 1], why: "test joint" }];
  const wall = staticScene([{ name: "wall", triangles: Float64Array.from([0, -5, -5, 0, 5, -5, 0, 0, 5]) }], { cell: 2 });
  const crossing = (x0) => Float64Array.from([x0 - 1, -0.5, 0, x0 + 1, -0.5, 0, x0, 0.8, 0]);
  const inJoint = classifyCrossings("panel", crossing(0), wall, joints);
  assert.equal(inJoint.crossings, 1);
  assert.equal(inJoint.defects, 0);
  assert.deepEqual(inJoint.jointCrossings, { "wall: test joint": 1 });
  const outside = classifyCrossings("panel", Float64Array.from([-1, -0.5, 3.5, 1, -0.5, 3.5, 0, 0.8, 3.5]), wall, joints); // crosses at z = 3.5, outside the box
  assert.equal(outside.defects, 1, "same kind of crossing outside the box is a defect");
  assert.ok(jointFor(JOINTS, "fc-apron-left", "fc-strut-tower-left", [146, 62, 88]), "joints are symmetric in part/with");
  assert.equal(jointFor(JOINTS, "fc-apron-left", "Body", [146, 0, 60]), null);
});

test("SVG: shell nodes get their own regions; output deterministic; without shell the build is unchanged", async () => {
  // A synthetic body box around the compartment, viewed with the CarScope camera.
  const box = (min, max) => ({ name: "Body", triangles: boxTriangles(min, max), materials: Array(12).fill("Body") });
  const body = [box([-230, -90, 20], [-110, 90, 110])];
  const nodes = [...body, ...shell.panels.map((p) => ({ name: p.id, id: p.id, triangles: p.triangles, materials: p.materials, palettes: p.palettes }))];
  const opts = { samples: 2, tolerance: 1, minRegion: 4 };
  const a = await buildIoniqSvg(null, { ...opts, nodes }), b = await buildIoniqSvg(null, { ...opts, nodes });
  assert.equal(a.svg, b.svg);
  const ids = new Set(a.result.fills.map((f) => f.id));
  for (const id of ["fc-lower-liner", "fc-front-upper-support", "fc-cowl-cover"]) assert.ok(ids.has(id), `${id} drawn`);
  const plain = await buildIoniqSvg(null, { ...opts, nodes: body }), plain2 = await buildIoniqSvg(null, { ...opts, nodes: body });
  assert.equal(plain.svg, plain2.svg);
  assert.ok(!plain.result.fills.some((f) => f.id.startsWith("fc-")));
});

test("the report CLI refuses to write model-derived output into the repository", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "front-compartment-report.mjs"), "--glb=missing.glb", `--out=${join(REPO, "tools", "tmp-p3a21")}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to write model-derived output inside the CarScope repo/);
  assert.ok(!existsSync(join(REPO, "tools", "tmp-p3a21")));
});

const real = process.env.IONIQ5_GLB;
const skip = !real || !existsSync(real) ? "IONIQ5_GLB not set" : false;

test("real GLB: recorded model references still match the converted model", { skip }, () => {
  const nodes = glbParts(readFileSync(real));
  const box = (name, f) => { const T = nodes.find((n) => n.name === name).triangles, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < T.length; i += 9) { const c = [0, 1, 2].map((k) => (T[i + k] + T[i + 3 + k] + T[i + 6 + k]) / 3); if (!f(c)) continue; for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], T[i + 3 * v + k]); hi[k] = Math.max(hi[k], T[i + 3 * v + k]); } } return { lo, hi }; };
  assert.ok(Math.abs(box("Interior_Static", (c) => c[0] > 95).hi[0] - MODEL_REFERENCES.interiorFrontX.value) < 0.1);
  assert.ok(Math.abs(box("Body", (c) => c[0] > 100 && c[0] < 125 && Math.abs(c[1]) < 60 && c[2] > 95).lo[2] - MODEL_REFERENCES.cowlBodyMinZ.value) < 0.1);
  assert.ok(Math.abs(box("Wheel_0_1", () => true).hi[2] - MODEL_REFERENCES.wheelTopZ.value) < 0.1);
  const hood = nodes.find((n) => n.name === H.HOOD_NODE).triangles;
  const t = MODEL_REFERENCES.hoodUnderside;
  for (const [r, y] of t.y.entries()) for (const [c, x] of t.x.entries()) {
    let lo = null;
    for (let i = 0; i < hood.length; i += 9) { const z = H.rayDown(x, y, Infinity, hood.subarray(i, i + 9)); if (z !== null && (lo === null || z < lo)) lo = z; }
    if (t.z[r][c] === null) assert.equal(lo, null, `(${x}, ${y})`); else assert.ok(Math.abs(lo - t.z[r][c]) < 0.06, `(${x}, ${y}): ${lo} vs ${t.z[r][c]}`);
  }
});

test("real GLB: no shell defects against the model, closed hood clear, opening hood (A) clear at sample angles", { skip }, () => {
  const glb = readFileSync(real), nodes = glbParts(glb);
  const hood = nodes.find((n) => n.name === H.HOOD_NODE).triangles;
  const model = staticScene(nodes.filter((n) => n.name !== H.HOOD_NODE));
  for (const p of shell.panels) assert.equal(classifyCrossings(p.id, p.triangles, model, JOINTS).defects, 0, p.id);
  const shellScene = staticScene(shell.panels.map((p) => ({ name: p.id, triangles: p.triangles })));
  const h = hoodHierarchy(glb);
  const [A] = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: h.group.originCm, groupLateralCm: h.lateralAxisCar }).candidates;
  for (const deg of H.SAMPLE_ANGLES) assert.equal(meshClearance(H.rotatePoints(hood, A, deg), shellScene, { cutoff: 5 }).intersectingPairs, 0, `${deg} deg`);
  // The shell leaves the source meshes untouched.
  assert.equal(glbParts(glb).reduce((a, n) => a + n.triangles.length, 0), nodes.reduce((a, n) => a + n.triangles.length, 0));
});
