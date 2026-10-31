// Synthetic tests only: no third-party geometry is stored in the repository.
// Set IONIQ5_BLEND=<path to hyundai_ioniq_5_2022.blend> to also run the real-asset integration test.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { detectContainer, zstdDecompress, openBlend, parseBlend, blendAccess } from "../blend-reader.mjs";
import { eulerXyzToQuat } from "../blend-scene.mjs";
import { vecToGltf, quatToGltf, triangulate, newellNormal, buildPrimitives, sceneToGlb } from "../to-gltf.mjs";
import { glbGeometry, analyse, blendBounds, trs, apply } from "../analyze.mjs";
import { convertBlend } from "../convert.mjs";
import { classifyName } from "../parts.mjs";
import { VEHICLE_PROFILES, DEFAULT_VEHICLE_PROFILE, HYUNDAI_IONIQ5_2022, gltfToCarCm } from "../profile.mjs";
import { ENVELOPE_SUV } from "../../anatomy-car/profiles/vehicle-profile.mjs";
import { toGltf } from "../../anatomy-car/geometry-export/gltf.mjs";

const require = createRequire(import.meta.url);
const validator = require("../../anatomy-car/node_modules/gltf-validator");
const close = (a, b, eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));

// ---------- container ----------
test("container is classified from raw bytes", () => {
  assert.equal(detectContainer(Buffer.from("BLENDER17-01v0502")), "BLEND_UNCOMPRESSED");
  assert.equal(detectContainer(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0])), "ZSTD");
  assert.equal(detectContainer(zlib.gzipSync(Buffer.from("x"))), "GZIP");
  assert.equal(detectContainer(Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n")), "GIT_LFS_POINTER");
  assert.equal(detectContainer(Buffer.from("PK\x03\x04")), "UNKNOWN");
  assert.throws(() => openBlend(Buffer.from("version https://git-lfs.github.com/spec/v1\n")), /GIT_LFS_POINTER/);
  assert.throws(() => openBlend(zlib.gzipSync(Buffer.from("not blender"))), /not Blender data/);
});

function seekable(parts) {
  const frames = parts.map((p) => zlib.zstdCompressSync(p));
  const table = Buffer.alloc(8 + frames.length * 8 + 9);
  table.writeUInt32LE(0x184d2a5e, 0);
  table.writeUInt32LE(frames.length * 8 + 9, 4);
  frames.forEach((f, i) => { table.writeUInt32LE(f.length, 8 + i * 8); table.writeUInt32LE(parts[i].length, 12 + i * 8); });
  const foot = 8 + frames.length * 8;
  table.writeUInt32LE(frames.length, foot); table[foot + 4] = 0; table.writeUInt32LE(0x8f92eab1, foot + 5);
  return Buffer.concat([...frames, table]);
}

test("multi-frame seekable zstd decodes every frame, not just the first", () => {
  const parts = [Buffer.alloc(70000, 1), Buffer.from("second"), Buffer.alloc(5000, 7)];
  const { data, frames } = zstdDecompress(seekable(parts));
  assert.equal(frames, 3);
  assert.deepEqual(data, Buffer.concat(parts));
  // The bug this guards against: a single-shot decode returns only frame 0.
  assert.equal(zlib.zstdDecompressSync(seekable(parts)).length, parts[0].length);
});

// ---------- synthetic .blend with SDNA ----------
function syntheticBlend() {
  const names = ["*next", "*prev", "name[8]", "*data", "value", "pad"];
  const types = ["char", "int", "void", "Thing", "Holder"];
  const tlen = [1, 4, 0, 24, 16];
  const structs = [[3, [[2, 0], [2, 1], [0, 2]]], [4, [[2, 3], [1, 4], [1, 5]]]]; // Holder: data, value, pad
  const str = (a) => Buffer.from(a.map((s) => s + "\0").join(""), "latin1");
  const align = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
  const i16s = (a) => { const b = Buffer.alloc(a.length * 2); a.forEach((v, i) => b.writeInt16LE(v, 2 * i)); return b; };
  const dna = Buffer.concat([Buffer.from("SDNANAME"), i32(names.length), align(str(names)), Buffer.from("TYPE"), i32(types.length), align(str(types)),
    Buffer.from("TLEN"), align(i16s(tlen)), Buffer.from("STRC"), i32(structs.length), ...structs.map(([t, f]) => i16s([t, f.length, ...f.flat()]))]);
  const block = (code, sdna, old, payload) => {
    const h = Buffer.alloc(32); h.write(code, 0, "latin1"); h.writeInt32LE(sdna, 4); h.writeBigUInt64LE(old, 8);
    h.writeBigInt64LE(BigInt(payload.length), 16); h.writeBigInt64LE(1n, 24); return Buffer.concat([h, payload]);
  };
  const holder = (ptr, value) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(ptr, 0); b.writeInt32LE(value, 8); return b; };
  // Two IDs whose DATA blocks reuse the same pseudo-address 0x50, as Blender 5.x does.
  return Buffer.concat([Buffer.from("BLENDER17-01v0502"),
    block("OB", 1, 0x10n, holder(0x50n, 1)), block("DATA", 0, 0x50n, Buffer.from("first\0")),
    block("OB", 1, 0x20n, holder(0x50n, 2)), block("DATA", 0, 0x50n, Buffer.from("second\0")),
    block("DNA1", 0, 0n, dna), block("ENDB", 0, 0n, Buffer.alloc(0))]);
}

test("SDNA offsets are derived and pointers resolve inside their owning ID", () => {
  const B = parseBlend(syntheticBlend());
  assert.equal(B.version, "0502");
  assert.equal(B.byType.get("Holder").byName.get("value").off, 8);
  const A = blendAccess(B);
  const owners = B.blocks.filter((b) => b.code === "OB");
  assert.deepEqual(owners.map((b) => A.cstring(A.at(b, "Holder").deref("data"))), ["first", "second"]);
  assert.throws(() => parseBlend(Buffer.from("BLENDER-v405")), /Unsupported .blend header/);
  assert.throws(() => parseBlend(syntheticBlend().subarray(0, 60)), /ENDB|overruns/);
});

// ---------- transforms ----------
const rotX = (a) => trs(undefined, [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]);
const rotY = (a) => trs(undefined, [0, Math.sin(a / 2), 0, Math.cos(a / 2)]);
const rotZ = (a) => trs(undefined, [0, 0, Math.sin(a / 2), Math.cos(a / 2)]);

test("XYZ Euler matches Blender order (X first, then Y, then Z)", () => {
  const e = [0.3, -1.1, 2.4], p = [0.2, -0.7, 1.3];
  const expected = apply(rotZ(e[2]), apply(rotY(e[1]), apply(rotX(e[0]), p)));
  close(apply(trs(undefined, eulerXyzToQuat(e)), p), expected, 1e-12);
});

test("axis map is CarScope's toGltf without the cm division, and rotations commute with it", () => {
  for (const p of [[123, -45, 67], [-10, 20, 0]]) close(vecToGltf(...p.map((v) => v / 100)), toGltf(p), 1e-15);
  close(gltfToCarCm(toGltf([123, -45, 67])), [123, -45, 67], 1e-9);
  const q = eulerXyzToQuat([0.4, 0.9, -1.7]), p = [0.3, 0.5, -0.8];
  close(vecToGltf(...apply(trs(undefined, q), p)), apply(trs(undefined, quatToGltf(q)), vecToGltf(...p)), 1e-12);
});

// ---------- triangulation ----------
test("concave n-gons triangulate without changing area or orientation", () => {
  const L = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
  const tris = triangulate(L);
  assert.equal(tris.length, 4);
  let area = 0;
  for (const [a, b, c] of tris) {
    const n = newellNormal([L[a], L[b], L[c]]);
    assert.ok(n[2] > 0.99, "same winding as the polygon");
    area += ((L[b][0] - L[a][0]) * (L[c][1] - L[a][1]) - (L[c][0] - L[a][0]) * (L[b][1] - L[a][1])) / 2;
  }
  assert.ok(Math.abs(area - 3) < 1e-12);
});

// ---------- synthetic scene -> GLB ----------
function cubeMesh(name, sharp) {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [0, 2]) v.push(x * 0.5, y * 0.25, z * 0.25);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return { name, counts: { point: 8, edge: 12, face: 6, corner: 24 }, positions: new Float32Array(v), cornerVerts: new Uint32Array(faces.flat()),
    faceOffsets: new Uint32Array([0, 4, 8, 12, 16, 20, 24]), materialIndex: [0, 0, 0, 0, 1, 1], sharpFace: new Array(6).fill(sharp), materials: ["Paint", "Glass"],
    ignoredAttributes: [], uvMaps: [] };
}
function syntheticScene() {
  const mesh = cubeMesh("Box", true);
  const material = (name, alpha) => ({ name, baseColor: [0.5, 0.4, 0.3, 1], metallic: 0, roughness: 0.5, alpha, transmission: 0, ior: 1.5, emission: [0, 0, 0, 1], emissionStrength: 0, backfaceCulling: false, source: "TEST", linkedInputs: [], otherNodes: [] });
  const root = { name: "Grp_Root", type: "EMPTY", loc: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], issues: [], parent: null };
  const door = { name: "Grp_Door_Left_0", type: "EMPTY", loc: [1, 0.9, 0.5], rotation: eulerXyzToQuat([0, 0, Math.PI / 2]), scale: [1, 1, 1], issues: [], parent: root };
  const part = { name: "Door_Left_0", type: "MESH", mesh, loc: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], issues: [], parent: door };
  root.children = [door]; door.children = [part]; part.children = [];
  return { objects: [root, door, part], roots: [root], meshes: [mesh], materials: [material("Paint", 1), material("Glass", 0.2)] };
}

test("sharp faces get flat normals and per-material primitives", () => {
  const { primitives, triangles } = buildPrimitives(cubeMesh("Box", true));
  assert.equal(triangles, 12);
  assert.equal(primitives.length, 2);
  assert.equal(primitives[0].positions.length / 3, 16, "4 faces x 4 corners, no sharing across sharp faces");
  const smooth = buildPrimitives(cubeMesh("Box", false));
  assert.equal(smooth.primitives[0].positions.length / 3, 8, "smooth faces share vertices");
});

test("synthetic GLB is Khronos-valid, keeps the hierarchy and maps world bounds to CarScope cm", async () => {
  const { glb } = sceneToGlb(syntheticScene(), { test: true });
  const report = await validator.validateBytes(new Uint8Array(glb), { uri: "t.glb" });
  assert.equal(report.issues.numErrors, 0);
  assert.equal(report.issues.numWarnings, 0);
  const { json, nodes } = glbGeometry(glb);
  assert.deepEqual(nodes.find((n) => n.name === "Door_Left_0").path, ["Grp_Root", "Grp_Door_Left_0"]);
  assert.equal(json.materials.find((m) => m.name === "Glass").alphaMode, "BLEND");
  assert.ok(json.materials.every((m) => m.doubleSided), "Blender materials without backface culling stay double-sided");
  // Source cube x in [-0.5,0.5], y in [-0.25,0.25], z in [0,0.5]; rotated 90 deg about Z then moved to (1,0.9,0.5).
  const box = nodes.find((n) => n.name === "Door_Left_0").box;
  close(box.min, [75, 40, 50], 1e-4);
  close(box.max, [125, 140, 100], 1e-4);
});

// ---------- profiles ----------
test("the Pleos AVD reference profile stays the default and unchanged", () => {
  assert.equal(DEFAULT_VEHICLE_PROFILE, "pleos-avd-reference");
  assert.equal(VEHICLE_PROFILES["pleos-avd-reference"], ENVELOPE_SUV);
  assert.equal(ENVELOPE_SUV.profileId, "manual-pleos-avd-envelope-v1");
  assert.equal(ENVELOPE_SUV.metadata.actualVehicleIdentity, null);
  assert.equal(HYUNDAI_IONIQ5_2022.calibration.applied, false);
  assert.equal(HYUNDAI_IONIQ5_2022.asset.redistribution, "NOT_IN_REPOSITORY");
  assert.ok(Object.isFrozen(HYUNDAI_IONIQ5_2022.reference));
});

test("part names are classified, unknown names are not guessed", () => {
  assert.equal(classifyName("Door_Left_1"), "closure-side-door");
  assert.equal(classifyName("Door_Front_0"), "closure-hood");
  assert.equal(classifyName("Wheel_1_0"), "wheel-assembly");
  assert.equal(classifyName("HV_Battery"), "unclassified");
});

// ---------- optional real-asset integration ----------
const real = process.env.IONIQ5_BLEND;
test("real OpenX IONIQ 5: convert, validate and cross-check", { skip: !real || !existsSync(real) ? "IONIQ5_BLEND not set" : false }, async () => {
  const bytes = readFileSync(real);
  const xomaPath = real.replace(/\.blend$/, ".xoma");
  const xoma = existsSync(xomaPath) ? JSON.parse(readFileSync(xomaPath, "utf8")) : null;
  const { glb, report } = convertBlend(bytes, { xoma });
  assert.equal(report.provenance.container, "ZSTD");
  assert.equal(report.provenance.sourceSha256, HYUNDAI_IONIQ5_2022.asset.sourceSha256);
  assert.equal(report.issues.length, 0);
  const v = await validator.validateBytes(new Uint8Array(glb), { uri: "ioniq5.glb", maxIssues: 100 });
  assert.equal(v.issues.numErrors + v.issues.numWarnings, 0);
  const analysis = analyse({ glbBytes: glb, xoma, blendBox: await blendBounds(bytes) });
  assert.deepEqual(analysis.checks.filter((c) => c.status !== "PASS"), []);
  assert.equal(analysis.summary.triangles, 37350);
  assert.equal(analysis.serviceParts.find((p) => p.id === "hv-battery").status, "NOT_AVAILABLE");
});
