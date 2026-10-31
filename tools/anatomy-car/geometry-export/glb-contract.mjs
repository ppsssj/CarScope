import { POLICY } from "./policy.mjs";
import { HALF } from "../automotive/dims.mjs";
import { LANDMARKS } from "../automotive/coordinates.mjs";

export function readGlb(bytes) {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error("Invalid GLB header");
  const n = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + n + 8 > bytes.length) throw new Error("Invalid GLB JSON chunk");
  const json = JSON.parse(bytes.subarray(20, 20 + n).toString("utf8"));
  const offset = 20 + n;
  if (bytes.readUInt32LE(offset + 4) !== 0x004e4942 || offset + 8 + bytes.readUInt32LE(offset) !== bytes.length) throw new Error("Invalid GLB BIN chunk");
  const bin = bytes.subarray(offset + 8);
  const accessor = (id) => {
    const a = json.accessors[id];
    const b = json.bufferViews[a.bufferView];
    const count = a.type === "VEC3" ? 3 : a.type === "SCALAR" ? 1 : 0;
    if (!count || ![5126, 5125].includes(a.componentType) || b.byteStride) throw new Error("Unsupported generated GLB accessor");
    const values = [];
    const start = (b.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count * count; i++) values.push(a.componentType === 5126 ? bin.readFloatLE(start + 4 * i) : bin.readUInt32LE(start + 4 * i));
    return values;
  };
  return { json, bin, accessor };
}

// Independent oracle: deliberately do not call the writer's toGltf/dirToGltf helpers.
export function glbContractFailures(bytes, parts, doorDefs, view) {
  const { json, accessor } = readGlb(bytes);
  const failures = [];
  const close = (actual, expected, tolerance, label) => {
    if (!actual || actual.length !== expected.length || actual.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > tolerance)) failures.push(label);
  };
  if (json.extras?.units !== "metres") failures.push("GLB units must be metres");
  for (const l of LANDMARKS) {
    const actual = json.extras?.coordinateLandmarks?.find((p) => p.id === l.id);
    const [x, y, z] = l.world;
    close(actual?.gltfMetres, [x / 100, z / 100, -y / 100], 1e-12, `${l.id}: physical landmark`);
  }
  for (const key of ["azimuth", "elevation", "width", "height", "pad"]) if (json.extras?.svgCamera?.[key] !== view[key]) failures.push(`GLB camera ${key} differs from VIEW`);
  if (json.nodes.some((n) => n.scale || n.matrix)) failures.push("unexpected GLB scale/matrix (including mirror)");
  for (const name of ["car", "body"]) {
    const n = json.nodes.find((n) => n.name === name);
    if (!n || n.translation || n.rotation) failures.push(`${name}: unexpected world transform`);
  }
  for (const def of Object.values(doorDefs)) {
    const node = json.nodes.find((n) => n.name === def.id);
    const [x, y, z] = def.pivot ?? [def.hinge, HALF + 0.05, 0];
    close(node?.translation, [x / 100, z / 100, -y / 100], 1e-12, `${def.id}: pivot or cm/m conversion`);
    close(node?.extras?.axis, [0, 1, 0], 0, `${def.id}: hinge axis`);
    close(node?.rotation, [0, 0, 0, 1], 0, `${def.id}: closed rest rotation`);
    if (node?.extras?.states?.open !== (def.openSign ?? -1) * def.open * Math.PI / 180) failures.push(`${def.id}: open angle`);
  }
  for (const p of parts) {
    const node = json.nodes.find((n) => n.name === p.partId);
    const prim = json.meshes[node?.mesh]?.primitives[0];
    if (!prim) { failures.push(`${p.partId}: missing GLB mesh`); continue; }
    if (node.translation || node.rotation) failures.push(`${p.partId}: unexpected child transform`);
    const parent = json.nodes.find((n) => n.children?.includes(json.nodes.indexOf(node)));
    if (parent?.name !== p.parent) failures.push(`${p.partId}: wrong parent`);
    const pivot = p.pivot ?? [0, 0, 0];
    const expected = p.mesh.positions.flatMap(([x, y, z]) => [(x - pivot[0]) / 100, (z - pivot[2]) / 100, -(y - pivot[1]) / 100]);
    close(accessor(prim.attributes.POSITION), expected, POLICY.glbPositionMetres, `${p.partId}: GLB position/units`);
    close(accessor(prim.attributes.NORMAL), p.mesh.normals.flatMap(([x, y, z]) => [x, z, -y]), POLICY.glbNormal, `${p.partId}: GLB normals`);
    close(accessor(prim.indices), p.mesh.indices, 0, `${p.partId}: GLB winding/indices`);
  }
  return failures;
}
