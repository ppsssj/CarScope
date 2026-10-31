// P3-A1 hood hinge feasibility tests: synthetic geometry only. Set IONIQ5_GLB to also run the
// real-asset test (the OpenX model never enters CI).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToGlb } from "../to-gltf.mjs";
import { gltfToCarCm } from "../profile.mjs";
import { glbParts, buildIoniqSvg } from "../anatomy-svg.mjs";
import * as H from "../hood.mjs";
import { trianglesIntersect, triangleDistance, staticScene, meshClearance, baselineContacts } from "../collision.mjs";
import { hoodHierarchy, frontLift, angleForLift, sweep } from "../hood-feasibility.mjs";
import { fitMeshProjection } from "../../anatomy-car/mesh-svg/mesh-svg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const close = (a, b, eps, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${msg ?? ""} [${i}] ${v} vs ${b[i]}`));
const S = Math.SQRT1_2;

// ---------- a synthetic OpenX-style car: Body box, hood under Grp_Door_Front_0, tailgate at the rear ----------
function quadMesh(name, pts, material = "Body") {
  return { name, counts: { point: 4, edge: 4, face: 1, corner: 4 }, positions: new Float32Array(pts.flat()), cornerVerts: new Uint32Array([0, 1, 2, 3]), faceOffsets: new Uint32Array([0, 4]),
    materialIndex: [0], sharpFace: [true], materials: [material], ignoredAttributes: [], uvMaps: [] };
}
function boxMesh(name, [x0, y0, z0], [x1, y1, z1]) {
  const v = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) v.push(x, y, z);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return { name, counts: { point: 8, edge: 12, face: 6, corner: 24 }, positions: new Float32Array(v), cornerVerts: new Uint32Array(faces.flat()), faceOffsets: new Uint32Array([0, 4, 8, 12, 16, 20, 24]),
    materialIndex: new Array(6).fill(0), sharpFace: new Array(6).fill(true), materials: ["Body"], ignoredAttributes: [], uvMaps: [] };
}
const mat = { name: "Body", baseColor: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.5, alpha: 1, transmission: 0, ior: 1.5, emission: [0, 0, 0, 1], emissionStrength: 0, backfaceCulling: false, source: "TEST", linkedInputs: [], otherNodes: [] };
const obj = (name, parent, extra = {}) => ({ name, type: extra.mesh ? "MESH" : "EMPTY", loc: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], issues: [], parent, children: [], ...extra });

/**
 * Blender frame (X forward, Y left, Z up, m). The hood group sits at the hood's rear-top edge and is
 * turned 90 deg about X like the OpenX source, so the hood's vertices are in a rotated local frame:
 * world = (lx, -lz, ly) + (1.0, 0, 1.08).
 */
function syntheticCar({ swap = false } = {}) {
  const root = obj("Grp_Root", null);
  const ext = obj("Grp_Exterior_Static", root);
  const dyn = obj("Grp_Exterior_Dynamic", root);
  const hoodGroup = obj("Grp_Door_Front_0", dyn, { loc: [1.0, 0, 1.08], rotation: [S, 0, 0, S] });
  // Plate from the rear edge (x 1.0, z 1.08) sloping down to the front (x 2.2, z 0.88), 1.6 m wide.
  const hoodLocal = [[0, 0, -0.8], [1.2, -0.2, -0.8], [1.2, -0.2, 0.8], [0, 0, 0.8]];
  const tailLocal = [[-2.2, -0.75, 0.7], [-2.2, 0.75, 0.7], [-2.2, 0.75, 1.5], [-2.2, -0.75, 1.5]];
  const body = obj("Body", ext, { mesh: boxMesh("Body", [-2.3, -0.9, 0.2], [2.3, 0.9, 0.7]) });
  const hood = obj(swap ? "Door_Rear_0" : "Door_Front_0", hoodGroup, { mesh: quadMesh("HoodMesh", hoodLocal) });
  const tailGroup = obj("Grp_Door_Rear_0", dyn);
  const tail = obj(swap ? "Door_Front_0" : "Door_Rear_0", tailGroup, { mesh: quadMesh("TailMesh", tailLocal) });
  root.children = [ext, dyn]; ext.children = [body]; dyn.children = [hoodGroup, tailGroup]; hoodGroup.children = [hood]; tailGroup.children = [tail];
  const objects = [root, ext, dyn, hoodGroup, hood, tailGroup, tail, body];
  return sceneToGlb({ objects, roots: [root], meshes: objects.filter((o) => o.mesh).map((o) => o.mesh), materials: [mat] }, { test: true }).glb;
}

test("the hood hierarchy and frames are read from the GLB, glTF m -> CarScope cm", () => {
  const glb = syntheticCar();
  const h = hoodHierarchy(glb);
  assert.deepEqual(h.path, ["Grp_Root", "Grp_Exterior_Dynamic", "Grp_Door_Front_0", "Door_Front_0"]);
  assert.deepEqual(h.hoodNode.local, { translation: null, rotation: null, scale: null, matrix: null }, "the hood node has no transform of its own");
  close(h.group.originCm, [100, 0, 108], 1e-4);
  close(h.group.gltfLocalAxesInCarFrame.x, [1, 0, 0], 1e-6);
  close(h.lateralAxisCar, [0, -1, 0], 1e-6, "glTF-local Y of the group = car -Y");
  close(gltfToCarCm([1, 2, 3]), [100, -300, 200], 0);
  const hood = glbParts(glb).find((n) => n.name === "Door_Front_0").triangles;
  const xs = hood.filter((_, i) => i % 3 === 0), zs = hood.filter((_, i) => i % 3 === 2);
  close([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], [100, 220, 88, 108], 1e-4, "world bounds of the rotated local plate");
});

test("the hood is identified by name, position and orientation together, never by name alone", () => {
  const nodes = glbParts(syntheticCar()).map((n) => (n.name === "Door_Front_0" ? { ...n, parent: "Grp_Door_Front_0" } : n));
  assert.deepEqual(H.identifyHood(nodes).problems, []);
  const swapped = glbParts(syntheticCar({ swap: true }));
  const p = H.identifyHood(swapped).problems;
  assert.ok(p.some((x) => /not in the front half/.test(x)), p.join("; "));
  assert.ok(p.some((x) => /hood and tailgate may be swapped/.test(x)), p.join("; "));
  assert.ok(p.some((x) => /not an upward-facing panel/.test(x)), p.join("; "));
  assert.deepEqual(H.identifyHood(nodes.filter((n) => n.name !== "Door_Front_0")).problems, ["no Door_Front_0 mesh node"]);
  assert.ok(H.identifyHood(nodes.map((n) => (n.name === "Door_Front_0" ? { ...n, parent: "Grp_Door_Rear_0" } : n))).problems.some((x) => /parent is Grp_Door_Rear_0/.test(x)));
});

test("rotation: 0 degrees is an exact copy, motion is rigid and reversible, positive opens upward", () => {
  const hood = glbParts(syntheticCar()).find((n) => n.name === "Door_Front_0").triangles;
  const axis = H.orientOpening({ point: [100, 0, 108], direction: [0, 1, 0] }, hood);
  assert.equal(axis.flipped, true, "+Y about the rear edge would push the front down: the axis is flipped");
  const zero = H.rotatePoints(hood, axis, 0);
  assert.notEqual(zero, hood);
  assert.ok(zero.every((v, i) => Object.is(v, hood[i])), "bit-identical at 0 degrees");
  const open = H.rotatePoints(hood, axis, 30);
  const d = (P, i, j) => Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
  for (let i = 0; i < hood.length / 3; i++) for (let j = 0; j < hood.length / 3; j++) assert.ok(Math.abs(d(open, i, j) - d(hood, i, j)) < 1e-9);
  const back = H.rotatePoints(open, axis, -30);
  close(Array.from(back), Array.from(hood), 1e-9, "restore");
  // Front edge (x=220, z=88) rotates about (100, *, 108): r = |(120, -20)|, angle -9.46 deg + 30 deg.
  const r = Math.hypot(120, -20), a = Math.atan2(-20, 120) + Math.PI / 6;
  assert.ok(Math.abs(frontLift(hood, axis, 30) - (108 + r * Math.sin(a) - 88)) < 1e-4, "vertices are stored as float32");
  assert.ok(Math.abs(angleForLift(hood, axis, frontLift(hood, axis, 20)) - 20) < 0.11);
  // Points on the axis do not move.
  close(Array.from(H.rotatePoints(Float64Array.from([100, 55, 108]), axis, 45)), [100, 55, 108], 1e-12);
  assert.ok(open.every((v, i) => i % 3 !== 1 || v === hood[i]), "a lateral axis never moves points sideways");
});

test("axis candidates carry their evidence class; the group origin is never labelled a verified hinge", () => {
  const glb = syntheticCar();
  const hood = glbParts(glb).find((n) => n.name === "Door_Front_0").triangles;
  const h = hoodHierarchy(glb);
  const { candidates } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: h.group.originCm, groupLateralCm: h.lateralAxisCar, searched: { point: [97, 0, 106] } });
  assert.deepEqual(candidates.map((c) => [c.id, c.evidence]), [["A", "UNVERIFIED"], ["B", "ESTIMATED"], ["C", "ESTIMATED"]]);
  for (const c of candidates) { assert.ok(c.source && c.assumptions.length && c.coordinateFrame.includes("CarScope cm")); assert.ok(H.rotatePoints(hood, c, 10)[2 + 3 * 1] > hood[2 + 3 * 1], `${c.id} lifts the front`); }
  assert.ok(!candidates.some((c) => c.evidence === "VERIFIED"));
  close(candidates[0].point, [100, 0, 108], 1e-4);
  assert.match(candidates[2].assumptions[0], /visual candidate only/);
});

test("triangle narrow phase: crossing, touching, separated and coplanar pairs", () => {
  const A = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  assert.equal(trianglesIntersect(A, [[2, 2, -1], [2, 2, 1], [8, 8, 1]]), true, "edge pierces the face");
  assert.equal(trianglesIntersect(A, [[2, 2, 0.5], [3, 2, 0.5], [2, 3, 0.5]]), false, "parallel, 0.5 above");
  assert.equal(triangleDistance(A, [[2, 2, 0.5], [3, 2, 0.5], [2, 3, 0.5]]).d, 0.5);
  assert.equal(trianglesIntersect(A, [[1, 1, 0], [4, 1, 0], [1, 4, 0]]), true, "coplanar, contained");
  assert.equal(trianglesIntersect(A, [[20, 20, 0], [24, 20, 0], [20, 24, 0]]), false, "coplanar, apart");
  // Edge-edge closest pair: two skew segments 3 apart.
  const d = triangleDistance([[-5, 0, 0], [5, 0, 0], [0, -5, -5]], [[0, -5, 3], [0, 5, 3], [5, 0, 8]]);
  assert.ok(Math.abs(d.d - 3) < 1e-12 && !d.intersects);
  // AABBs overlap, triangles do not touch: the broad phase must not decide this.
  const diag = [[0, 0, 0], [10, 10, 0], [10, 10, 10]], other = [[10, 0, 10], [10, 0, 0], [6, 0, 10]];
  assert.equal(trianglesIntersect(diag, other), false);
  assert.ok(triangleDistance(diag, other).d > 2);
});

test("mesh clearance: exact pairs, seam baseline kept apart, deterministic", () => {
  const plate = (z) => Float64Array.from([0, 0, z, 10, 0, z, 0, 10, z]);
  const scene = staticScene([{ name: "floor", triangles: Float64Array.from([-5, -5, 0, 20, -5, 0, -5, 20, 0]) }, { name: "post", triangles: Float64Array.from([2, 2, -5, 2, 2, 5, 3, 3, 5]) }], { cell: 2 });
  const lifted = meshClearance(plate(0.4), scene, { cutoff: 1 });
  assert.equal(lifted.method, "MESH_TRIANGLE_EXACT");
  assert.equal(lifted.intersectingPairs, 1, "only the post crosses the plate");
  const base = baselineContacts(plate(0.4), scene);
  const withBase = meshClearance(plate(0.4), scene, { cutoff: 1, baseline: base });
  assert.equal(withBase.intersectingPairs, 0);
  assert.equal(withBase.baselineIntersectingPairs, 1);
  assert.equal(withBase.allIntersectingPairs, 1);
  const far = meshClearance(plate(0.4).map((v, i) => (i % 3 === 0 ? v + 50 : v)), scene, { cutoff: 1 });
  assert.equal(far.minDistanceCm, null, "nothing within the cutoff is reported as such, not as zero");
  assert.deepEqual(meshClearance(plate(0.7), scene, { cutoff: 2 }), meshClearance(plate(0.7), scene, { cutoff: 2 }));
});

test("hood sweeps on the synthetic car: closed baseline, then the measured clearance", () => {
  const glb = syntheticCar();
  const nodes = glbParts(glb);
  const hood = nodes.find((n) => n.name === "Door_Front_0").triangles;
  const scene = staticScene(nodes.filter((n) => n.name !== "Door_Front_0"), { region: H.bodyRegion });
  const baseline = baselineContacts(hood, scene);
  const axis = H.orientOpening({ point: [100, 0, 108], direction: [0, 1, 0] }, hood);
  const rows = sweep(hood, axis, scene, baseline, [0, 15, 30]);
  assert.deepEqual(rows.map((r) => r.check), ["CLOSED_BASELINE", "NO_NEW_INTERSECTION", "NO_NEW_INTERSECTION"]);
  // Body top is z=70; the hood's lowest point (front edge, z=88) is 18 cm above it when closed.
  assert.equal(rows[0].minNewClearanceCm, ">=10");
  // A mid-panel axis drives the rear edge down: (-60, +10) cm from the axis reaches z = 98 - 35.4 at 45 degrees.
  const mid = H.orientOpening({ point: [160, 0, 98], direction: [0, 1, 0] }, hood);
  const [r15, r45] = sweep(hood, mid, scene, baseline, [15, 45]);
  assert.equal(r15.check, "NO_NEW_INTERSECTION");
  assert.equal(r45.check, "NEW_MESH_INTERSECTION");
  assert.equal(r45.minNewClearanceCm, 0);
  assert.equal(H.bodyRegion("Body", [210, 0, 80]), "body:front-fascia");
  assert.equal(H.bodyRegion("Body", [100, 70, 105]), "body:a-pillar-base");
  assert.equal(H.bodyRegion("Body_Glass", [80, 0, 120]), "windshield-and-glazing");
});

test("panel outline, under-hood probe and the synthetic placeholder", () => {
  const glb = syntheticCar();
  const nodes = glbParts(glb);
  const hood = nodes.find((n) => n.name === "Door_Front_0").triangles;
  assert.equal(H.boundaryEdges(hood).length, 4, "two triangles of one quad: four outline edges, the diagonal is shared");
  const samples = H.underHoodProbe(hood, nodes.filter((n) => n.name !== "Door_Front_0"), { step: 10 });
  assert.ok(samples.length > 50 && samples.every((s) => s.hit === "Body" && Math.abs(s.hitZ - 70) < 1e-4));
  const box = H.placeholderBox(samples);
  assert.equal(box.tag, H.PLACEHOLDER_TAG);
  assert.equal(H.PLACEHOLDER_TAG, "SYNTHETIC_DEBUG_PLACEHOLDER");
  assert.ok(box.min[2] >= 70 - 1e-4 && box.max[2] <= 108 && box.max[2] > box.min[2]);
  assert.deepEqual(H.SAMPLE_ANGLES, [0, 5, 15, 30, 45, 60]);
});

test("mesh-svg hood poses: 0 degrees equals the default build, frames are deterministic, the hood moves", async () => {
  const glb = syntheticCar();
  const nodes = glbParts(glb);
  const hood = nodes.find((n) => n.name === "Door_Front_0").triangles;
  const axis = H.orientOpening({ point: [100, 0, 108], direction: [0, 1, 0] }, hood);
  const posed = (deg) => nodes.map((n) => (n.name === "Door_Front_0" ? { ...n, triangles: H.rotatePoints(n.triangles, axis, deg) } : n));
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const opts = { samples: 2, tolerance: 1, minRegion: 4 };
  const reference = await buildIoniqSvg(glb, opts);
  assert.equal(sha((await buildIoniqSvg(glb, { ...opts, nodes: posed(0) })).svg), sha(reference.svg));
  const projection = fitMeshProjection([...nodes, { triangles: H.rotatePoints(hood, axis, 45) }], reference.anatomy.k);
  const a = await buildIoniqSvg(glb, { ...opts, nodes: posed(45), projection });
  const b = await buildIoniqSvg(glb, { ...opts, nodes: posed(45), projection });
  assert.equal(sha(a.svg), sha(b.svg));
  const closed = await buildIoniqSvg(glb, { ...opts, nodes: posed(0), projection });
  const hoodD = (x) => x.result.fills.filter((f) => f.id === "hood").map((f) => f.d).join();
  assert.ok(hoodD(closed) && hoodD(a) && hoodD(closed) !== hoodD(a), "the hood region changes with the pose");
  // An extra synthetic part (explicit id and palette) is drawn and depth-sorted like any other.
  const extra = { name: H.PLACEHOLDER_TAG, id: "synthetic-debug-placeholder", triangles: Float64Array.from([150, -20, 75, 190, -20, 75, 150, 20, 75, 190, -20, 75, 190, 20, 75, 150, 20, 75]), materials: ["x", "x"], palettes: ["amber", "amber"] };
  const withBox = await buildIoniqSvg(glb, { ...opts, nodes: [...posed(45), extra], projection });
  assert.ok(withBox.result.fills.some((f) => f.id === "synthetic-debug-placeholder"));
});

test("the CLI refuses to write model-derived output into the repository", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "hood-feasibility.mjs"), "--glb=missing.glb", `--out=${join(REPO, "tools", "tmp-p3a1")}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to write model-derived output inside the CarScope repo/);
  assert.ok(!existsSync(join(REPO, "tools", "tmp-p3a1")));
});

const real = process.env.IONIQ5_GLB;
test("real IONIQ 5 GLB: hood found, axis A opens without new interference, B does not", { skip: !real || !existsSync(real) ? "IONIQ5_GLB not set" : false }, () => {
  const glb = readFileSync(real);
  const h = hoodHierarchy(glb);
  close(h.group.originCm, [99.51, 0, 108.157], 0.01);
  const nodes = glbParts(glb);
  const id = H.identifyHood(nodes.map((n) => (n.name === "Door_Front_0" ? { ...n, parent: h.path.at(-2) } : n)));
  assert.deepEqual(id.problems, []);
  assert.equal(id.hood.triangles.length / 9, 1592);
  const hood = id.hood.triangles, scene = staticScene(nodes.filter((n) => n.name !== "Door_Front_0"), { region: H.bodyRegion });
  const baseline = baselineContacts(hood, scene);
  const { candidates } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: h.group.originCm, groupLateralCm: h.lateralAxisCar });
  const [A, B] = candidates;
  assert.deepEqual(sweep(hood, A, scene, baseline, [15, 30]).map((r) => r.newIntersectingPairs), [0, 0]);
  assert.ok(sweep(hood, B, scene, baseline, [30])[0].newIntersectingPairs > 0);
});
