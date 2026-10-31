#!/usr/bin/env node
// Analyse a converted IONIQ 5 GLB and write a mesh/geometry report (JSON).
//   node tools/ioniq5-asset/analyze.mjs --glb=<file.glb> [--blend=<source .blend>] [--xoma=<.xoma>] [--out=<analysis.json>]
// With --blend, world bounds are recomputed from the Blender data in the source frame (no glTF code
// path) and compared with the GLB, which checks hierarchy, axes and scale independently.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyName, SERVICE_PARTS } from "./parts.mjs";
import { HYUNDAI_IONIQ5_2022, gltfToCarCm } from "./profile.mjs";

// ---------- GLB reading (independent of to-gltf.mjs) ----------
export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error("Invalid GLB header");
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8"));
  const binOff = 20 + jsonLen;
  const bin = bytes.subarray(binOff + 8, binOff + 8 + bytes.readUInt32LE(binOff));
  const accessor = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC3: 3 }[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2 }[a.componentType];
    if (!comps || !size || v.byteStride) throw new Error(`Unsupported accessor ${i}`);
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float64Array(a.count * comps);
    for (let k = 0; k < out.length; k++) out[k] = a.componentType === 5126 ? bin.readFloatLE(start + 4 * k) : a.componentType === 5125 ? bin.readUInt32LE(start + 4 * k) : bin.readUInt16LE(start + 2 * k);
    return out;
  };
  return { json, accessor };
}

// Column-major 4x4 helpers.
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
export const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
export const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const grow = (b, p) => { for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], p[i]); b.max[i] = Math.max(b.max[i], p[i]); } };
const merge = (boxes) => { const b = emptyBox(); for (const x of boxes) { grow(b, x.min); grow(b, x.max); } return b; };
const size = (b) => b.max.map((v, i) => v - b.min[i]);
const center = (b) => b.max.map((v, i) => (v + b.min[i]) / 2);
const r = (v, d = 2) => (Array.isArray(v) ? v.map((x) => r(x, d)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x, d)])) : typeof v === "number" ? Math.round(v * 10 ** d) / 10 ** d + 0 : v);
const boxOut = (b) => ({ min: r(b.min), max: r(b.max), size: r(size(b)), center: r(center(b)) });

/** World-space (CarScope cm) bounds per mesh node, plus hierarchy, from the GLB alone. */
export function glbGeometry(bytes) {
  const { json, accessor } = readGlb(bytes);
  const parent = new Map();
  json.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const world = new Map();
  const walk = (i, m) => { const n = json.nodes[i]; const w = mul(m, trs(n.translation, n.rotation, n.scale)); world.set(i, w); n.children?.forEach((c) => walk(c, w)); };
  json.scenes[json.scene ?? 0].nodes.forEach((i) => walk(i, ident()));
  const pathOf = (i) => { const p = []; let k = parent.get(i); while (k !== undefined) { p.unshift(json.nodes[k].name); k = parent.get(k); } return p; };
  const nodes = json.nodes.map((n, i) => {
    const out = { name: n.name, category: classifyName(n.name), parent: parent.has(i) ? json.nodes[parent.get(i)].name : null, path: pathOf(i), children: (n.children ?? []).map((c) => json.nodes[c].name),
      worldOriginCm: r(gltfToCarCm(apply(world.get(i), [0, 0, 0]))) };
    if (n.mesh === undefined) return out;
    const box = emptyBox();
    let vertices = 0, triangles = 0;
    const mats = new Set();
    for (const p of json.meshes[n.mesh].primitives) {
      const pos = accessor(p.attributes.POSITION);
      vertices += pos.length / 3;
      triangles += json.accessors[p.indices].count / 3;
      if (p.material !== undefined) mats.add(json.materials[p.material].name);
      for (let k = 0; k < pos.length; k += 3) grow(box, gltfToCarCm(apply(world.get(i), [pos[k], pos[k + 1], pos[k + 2]])));
    }
    return { ...out, mesh: json.meshes[n.mesh].name, primitives: json.meshes[n.mesh].primitives.length, gltfVertices: vertices, triangles, materials: [...mats], box };
  });
  return { json, nodes };
}

/** Same bounds computed straight from the .blend in the source frame (Z up, metres -> cm). */
export async function blendBounds(blendBytes) {
  const { openBlend, parseBlend } = await import("./blend-reader.mjs");
  const { extractScene } = await import("./blend-scene.mjs");
  const scene = extractScene(parseBlend(openBlend(blendBytes).data));
  const world = new Map();
  const local = (o) => trs(o.loc, o.rotation, o.scale); // Blender frame, no axis map
  const w = (o) => world.get(o) ?? world.set(o, o.parent ? mul(w(o.parent), local(o)) : local(o)).get(o);
  const out = {};
  for (const o of scene.objects.filter((o) => o.mesh)) {
    const box = emptyBox();
    const P = o.mesh.positions;
    for (let k = 0; k < P.length; k += 3) grow(box, apply(w(o), [P[k], P[k + 1], P[k + 2]]).map((v) => v * 100));
    out[o.name] = box;
  }
  return out;
}

function fidelity(n) {
  // Purely geometric evidence; thresholds are descriptive, not quality judgements of the source.
  const s = size(n.box);
  if (n.triangles <= 4) return { level: "MARKER_ONLY", reason: `${n.triangles} triangles: a flat placeholder for the emitter position` };
  if (n.triangles < 100) return { level: "PROXY", reason: `${n.triangles} triangles across ${r(s, 1).join(" x ")} cm: simplified stand-in shape` };
  const m = s.map((v) => v / 100);
  const density = n.triangles / (2 * (m[0] * m[1] + m[1] * m[2] + m[0] * m[2]) || 1);
  if (density < 50) return { level: "COARSE_PLACEHOLDER", reason: `${n.triangles} triangles, ${r(density, 1)} per m² of bounding-box surface (< 50): coarse or largely planar shapes` };
  return { level: "DETAILED_MESH", reason: `${n.triangles} triangles, ${r(density, 1)} per m² of bounding-box surface` };
}

export function analyse({ glbBytes, xoma = null, blendBox = null }) {
  const { json, nodes } = glbGeometry(glbBytes);
  const meshNodes = nodes.filter((n) => n.box);
  const by = (name) => meshNodes.find((n) => n.name === name);
  const all = merge(meshNodes.map((n) => n.box));
  // Everything mounted under a mirror group (mirror shell and its indicator repeater) counts as mirror.
  const onMirror = (n) => n.category === "side-mirror" || n.path.some((p) => p.startsWith("Grp_Mirror_Side_"));
  const exMirrors = merge(meshNodes.filter((n) => !onMirror(n)).map((n) => n.box));
  const bodyShell = by("Body")?.box;
  const wheels = meshNodes.filter((n) => n.category === "wheel-assembly").map((n) => ({ name: n.name, center: center(n.box), size: size(n.box) }));
  const pick = (front, left) => wheels.find((w) => (w.center[0] > 0) === front && (w.center[1] > 0) === left);
  const [FL, FR, RL, RR] = [pick(true, true), pick(true, false), pick(false, true), pick(false, false)];
  const measured = {
    lengthCm: size(all)[0], widthWithMirrorsCm: size(all)[1], widthExMirrorsCm: size(exMirrors)[1], heightCm: size(all)[2],
    wheelbaseCm: (FL.center[0] + FR.center[0]) / 2 - (RL.center[0] + RR.center[0]) / 2,
    frontTrackCm: FL.center[1] - FR.center[1], rearTrackCm: RL.center[1] - RR.center[1],
    wheelDiameterCm: Math.max(...wheels.map((w) => w.size[2])), tyreWidthCm: Math.max(...wheels.map((w) => w.size[1])),
    groundToLowestBodyShellCm: bodyShell ? bodyShell.min[2] : null, lowestPointCm: all.min[2],
  };
  const refs = HYUNDAI_IONIQ5_2022.reference;
  const cmp = (key, cm) => {
    const ref = refs[key];
    if (!ref || ref.value === null) return { measuredMm: r(cm * 10, 1), referenceMm: null, deltaMm: null, status: "NO_RELIABLE_REFERENCE", note: ref?.note };
    const delta = cm * 10 - ref.value;
    return { measuredMm: r(cm * 10, 1), referenceMm: ref.value, deltaMm: r(delta, 1), deltaPct: r((100 * delta) / ref.value, 2), referenceSource: ref.source, note: ref.note };
  };
  const spec = {
    length: cmp("length", measured.lengthCm), widthExMirrors: cmp("widthExMirrors", measured.widthExMirrorsCm), height: cmp("height", measured.heightCm),
    wheelbase: cmp("wheelbase", measured.wheelbaseCm), groundClearance: { ...cmp("groundClearance", measured.groundToLowestBodyShellCm), note: "model value = lowest vertex of the Body mesh; not a homologated clearance measurement" },
    frontTrack: cmp("frontTrack", measured.frontTrackCm), rearTrack: cmp("rearTrack", measured.rearTrackCm),
  };
  // Door identities come from where the mesh sits, cross-checked against the OpenX name.
  const sideDoors = meshNodes.filter((n) => n.category === "closure-side-door").map((n) => {
    const c = center(n.box);
    const byPos = `${c[0] > (FL.center[0] + RL.center[0]) / 2 ? "FRONT" : "REAR"}_${c[1] > 0 ? "LEFT" : "RIGHT"}`;
    const [, side, idx] = /^Door_(Left|Right)_(\d+)$/.exec(n.name);
    const byName = `${idx === "0" ? "FRONT" : "REAR"}_${side.toUpperCase()}`;
    const pivot = nodes.find((g) => g.name === n.parent);
    return { node: n.name, carscopeDoorId: byPos, nameAgrees: byPos === byName, pivotGroup: n.parent, pivotCm: pivot?.worldOriginCm, hingeAxis: "UNVERIFIED (OpenX defines a local door frame, axis not documented)" };
  });
  const wheelIds = wheels.map((w) => ({ node: w.name, position: `${w.center[0] > 0 ? "FRONT" : "REAR"}_${w.center[1] > 0 ? "LEFT" : "RIGHT"}`, centerCm: r(w.center), diameterCm: r(w.size[2]), widthCm: r(w.size[1]) }));
  const serviceParts = SERVICE_PARTS.map((p) => {
    const named = nodes.filter((n) => p.pattern.test(n.name)).map((n) => n.name);
    const viaMaterial = meshNodes.filter((n) => n.materials.some((m) => p.pattern.test(m))).map((n) => n.name);
    const meshes = meshNodes.filter((n) => named.includes(n.name));
    const status = meshes.length ? (meshes.every((m) => fidelity(m).level !== "DETAILED_MESH") ? "PROXY_ONLY" : "MESH_PRESENT")
      : viaMaterial.length ? "MATERIAL_REGION_ONLY" : "NOT_AVAILABLE";
    return { id: p.id, label: p.label, status, namedNodes: named, materialRegionIn: viaMaterial };
  });
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, status: ok ? "PASS" : "FAIL", detail });
  check("x-forward", by("Light_Low_Beam_Left_0").box.min[0] > 150 && by("Light_Tail_Left_0").box.max[0] < -150, "headlamps at +X, tail lamps at -X");
  check("y-left", by("Mirror_Side_Left_0").box.min[1] > 0 && by("Mirror_Side_Right_0").box.max[1] < 0, "left mirror at +Y");
  check("z-up-on-ground", Math.abs(all.min[2]) < 1 && all.max[2] > 150, `lowest ${r(all.min[2], 3)} cm, highest ${r(all.max[2])} cm`);
  const scaled = json.nodes.filter((n) => n.scale);
  check("no-mirror-or-real-scale", json.nodes.every((n) => !n.matrix && (n.scale ?? [1, 1, 1]).every((s) => s > 0 && Math.abs(s - 1) < 1e-6)),
    `no matrix nodes; ${scaled.length} source scales kept as authored, all within 1e-6 of 1 (${scaled.map((n) => n.name).join(", ")})`);
  check("door-names-match-positions", sideDoors.every((d) => d.nameAgrees), sideDoors.map((d) => `${d.node}->${d.carscopeDoorId}`).join(", "));
  check("unique-mesh-node-names", new Set(meshNodes.map((n) => n.name)).size === meshNodes.length, `${meshNodes.length} selectable mesh nodes`);
  if (xoma) {
    const m = xoma.metadata, bb = m.boundingBox;
    const dev = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(all.min[i] / 100 - bb["xyz"[i]][0]), Math.abs(all.max[i] / 100 - bb["xyz"[i]][1])]));
    check("xoma-bounding-box", dev < 5e-4, `max deviation ${r(dev * 1000, 2)} mm vs .xoma boundingBox`);
    check("xoma-mesh-count", meshNodes.length === m.meshCount, `${meshNodes.length} vs ${m.meshCount}`);
    const tris = meshNodes.reduce((a, n) => a + n.triangles, 0);
    check("xoma-triangle-count", tris === m.triangleCount, `${tris} vs ${m.triangleCount}`);
    const ax = m.vehicleClassData.axles;
    const axDev = Math.max(Math.abs((FL.center[0] + FR.center[0]) / 200 - ax.frontAxle.positionX), Math.abs((RL.center[0] + RR.center[0]) / 200 - ax.rearAxle.positionX));
    check("xoma-axle-positions", axDev < 5e-3, `max ${r(axDev * 1000, 1)} mm (wheel mesh bbox centres vs .xoma)`);
    check("xoma-wheel-diameter", Math.abs(measured.wheelDiameterCm / 100 - ax.frontAxle.wheelDiameter) < 5e-3, `${r(measured.wheelDiameterCm * 10, 1)} mm vs ${ax.frontAxle.wheelDiameter * 1000} mm`);
  }
  if (blendBox) {
    let dev = 0;
    const missing = [];
    for (const n of meshNodes) {
      const b = blendBox[n.name];
      if (!b) { missing.push(n.name); continue; }
      for (let i = 0; i < 3; i++) dev = Math.max(dev, Math.abs(b.min[i] - n.box.min[i]), Math.abs(b.max[i] - n.box.max[i]));
    }
    check("blend-vs-glb-world-bounds", !missing.length && Object.keys(blendBox).length === meshNodes.length && dev < 1e-3, `max ${dev.toExponential(2)} cm over ${meshNodes.length} meshes${missing.length ? `, missing ${missing}` : ""}`);
  }
  return {
    profileId: HYUNDAI_IONIQ5_2022.profileId,
    frame: HYUNDAI_IONIQ5_2022.frames.carscopeWorld,
    attribution: HYUNDAI_IONIQ5_2022.asset.attribution, license: HYUNDAI_IONIQ5_2022.asset.license,
    summary: {
      nodes: json.nodes.length, meshNodes: meshNodes.length, groups: nodes.filter((n) => n.category === "group").length, materials: json.materials.length,
      gltfVertices: meshNodes.reduce((a, n) => a + n.gltfVertices, 0), triangles: meshNodes.reduce((a, n) => a + n.triangles, 0), textures: (json.textures ?? []).length,
      overallBoxCm: boxOut(all), exMirrorsBoxCm: boxOut(exMirrors),
    },
    measuredCm: r(measured, 2),
    specComparison: spec,
    doors: sideDoors,
    closures: meshNodes.filter((n) => /closure-(hood|tailgate)/.test(n.category)).map((n) => ({ node: n.name, category: n.category, pivotGroup: n.parent, pivotCm: nodes.find((g) => g.name === n.parent)?.worldOriginCm })),
    wheels: wheelIds,
    serviceParts,
    checks,
    meshes: meshNodes.map((n) => ({ name: n.name, category: n.category, parent: n.parent, path: n.path, gltfVertices: n.gltfVertices, triangles: n.triangles, primitives: n.primitives, materials: n.materials, fidelity: fidelity(n), boxCm: boxOut(n.box) })),
    groups: nodes.filter((n) => !n.box).map((n) => ({ name: n.name, parent: n.parent, children: n.children, worldOriginCm: n.worldOriginCm })),
    materials: json.materials.map((m) => ({ name: m.name, baseColorLinear: r(m.pbrMetallicRoughness.baseColorFactor, 3), metallic: m.pbrMetallicRoughness.metallicFactor, roughness: r(m.pbrMetallicRoughness.roughnessFactor, 3), alphaMode: m.alphaMode ?? "OPAQUE", textures: 0 })),
  };
}

async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  if (!args.glb) { console.error("usage: node tools/ioniq5-asset/analyze.mjs --glb=<file.glb> [--blend=<.blend>] [--xoma=<.xoma>] [--out=<json>]"); return 2; }
  const xomaPath = args.xoma ?? (args.blend ? args.blend.replace(/\.blend$/, ".xoma") : null);
  const xoma = xomaPath && existsSync(xomaPath) ? JSON.parse(readFileSync(xomaPath, "utf8")) : null;
  const blendBox = args.blend ? await blendBounds(readFileSync(args.blend)) : null;
  const report = analyse({ glbBytes: readFileSync(args.glb), xoma, blendBox });
  const out = resolve(args.out ?? args.glb.replace(/\.glb$/, ".analysis.json"));
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  for (const c of report.checks) console.log(`${c.status} ${c.id}: ${c.detail}`);
  console.log(`ANALYSIS ${out}`);
  return report.checks.some((c) => c.status === "FAIL") ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`FAILED: ${e.message}`); process.exitCode = 1; });
}
