// Extract objects, meshes and materials from a parsed .blend (see blend-reader.mjs).
// Values stay in the source frame and unit (Blender: right-handed, Z up, metres). No modifier
// evaluation is attempted: objects with modifiers, constraints or unsupported data are reported.
import { blendAccess } from "./blend-reader.mjs";

const OBJECT_TYPES = { 0: "EMPTY", 1: "MESH", 2: "CURVE", 3: "SURF", 4: "FONT", 5: "MBALL", 10: "LAMP", 11: "CAMERA", 25: "ARMATURE" };
const DOMAIN = { 0: "point", 1: "edge", 2: "face", 3: "corner" };
const strip = (name, prefix) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);

/** XYZ Euler (Blender rotmode 1: X applied first) to quaternion [x, y, z, w]. */
export function eulerXyzToQuat([x, y, z]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
  // q = qz * qy * qx
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

function readAttributes(A, mesh, counts) {
  const store = mesh.sub("attribute_storage", "AttributeStorage");
  const n = store.i32("dna_attributes_num");
  const arr = store.deref("dna_attributes", n * 24);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const attr = A.at(arr, "Attribute", arr.off + i * 24);
    const nameBlock = attr.deref("name");
    const name = nameBlock ? A.cstring(nameBlock) : `#${i}`;
    const domain = DOMAIN[attr.i8("domain")] ?? `domain${attr.i8("domain")}`;
    const storage = attr.i8("storage_type");
    const count = counts[domain];
    const holder = attr.deref("data");
    const rec = { name, dataType: attr.i16("data_type"), domain, storage: storage === 0 ? "array" : storage === 1 ? "single" : `storage${storage}`, count, bytes: null };
    if (holder && storage === 0) {
      const data = A.at(holder, "AttributeArray").deref("data");
      if (data) { rec.bytes = A.d.subarray(data.off, data.off + data.len); rec.elementSize = data.len / count; }
    } else if (holder && storage === 1) {
      const data = A.at(holder, "AttributeSingle").deref("data");
      if (data) { rec.single = A.d.subarray(data.off, data.off + data.len); rec.elementSize = data.len; }
    }
    out.set(name, rec);
  }
  return out;
}

function need(attrs, name, elementSize, meshName) {
  const a = attrs.get(name);
  if (!a?.bytes || a.elementSize !== elementSize) throw new Error(`${meshName}: attribute ${name} missing or not ${elementSize}-byte elements`);
  return a;
}

function readMesh(A, block) {
  const M = A.at(block, "Mesh");
  const name = strip(A.idName(block), "ME");
  const counts = { point: M.i32("totvert"), edge: M.i32("totedge"), face: M.i32("totpoly"), corner: M.i32("totloop") };
  const attrs = readAttributes(A, M, counts);
  const pos = need(attrs, "position", 12, name).bytes;
  const corner = need(attrs, ".corner_vert", 4, name).bytes;
  const offBlock = M.deref("poly_offset_indices", (counts.face + 1) * 4);
  if (!offBlock) throw new Error(`${name}: poly_offset_indices missing`);
  const positions = new Float32Array(counts.point * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = pos.readFloatLE(4 * i);
  const cornerVerts = new Uint32Array(counts.corner);
  for (let i = 0; i < counts.corner; i++) {
    cornerVerts[i] = corner.readInt32LE(4 * i);
    if (cornerVerts[i] >= counts.point) throw new Error(`${name}: corner ${i} references vertex ${cornerVerts[i]}`);
  }
  const faceOffsets = new Uint32Array(counts.face + 1);
  for (let i = 0; i <= counts.face; i++) faceOffsets[i] = A.d.readInt32LE(offBlock.off + 4 * i);
  if (faceOffsets[0] !== 0 || faceOffsets[counts.face] !== counts.corner) throw new Error(`${name}: face offsets do not cover all corners`);
  const perFace = (attrName, size, read, fallback) => {
    const a = attrs.get(attrName);
    const values = new Array(counts.face).fill(fallback);
    if (a?.bytes && a.elementSize === size && a.domain === "face") for (let i = 0; i < counts.face; i++) values[i] = read(a.bytes, i * size);
    else if (a?.single && a.domain === "face") values.fill(read(a.single, 0));
    return values;
  };
  const materialIndex = perFace("material_index", 4, (b, o) => b.readInt32LE(o), 0);
  // Blender >= 4.1: a missing sharp_face attribute means every face is smooth shaded.
  const sharpFace = perFace("sharp_face", 1, (b, o) => b[o] !== 0, false);
  const totcol = M.i16("totcol");
  const matArray = M.deref("mat", totcol * 8);
  const materials = [];
  for (let i = 0; i < totcol; i++) {
    const ptr = matArray ? A.d.readBigUInt64LE(matArray.off + 8 * i) : 0n;
    const mb = ptr ? A.resolve(ptr) : null;
    materials.push(mb && mb.code === "MA" ? strip(A.idName(mb), "MA") : null);
  }
  const ignored = [...attrs.values()].filter((a) => !["position", ".corner_vert", ".corner_edge", ".edge_verts", "material_index", "sharp_face"].includes(a.name))
    .map((a) => ({ name: a.name, domain: a.domain, dataType: a.dataType, storage: a.storage }));
  return { name, counts, positions, cornerVerts, faceOffsets, materialIndex, sharpFace, materials, ignoredAttributes: ignored,
    shapeKeys: Boolean(M.ptr("key")), customNormals: attrs.has("custom_normal"), sharpEdges: attrs.has("sharp_edge"), uvMaps: [...attrs.values()].filter((a) => a.domain === "corner" && a.elementSize === 8 && !a.name.startsWith(".")).map((a) => a.name) };
}

function principled(A, M) {
  const tree = M.deref("nodetree");
  if (!tree) return null;
  const T = A.at(tree, "bNodeTree");
  const nodes = A.listBase(T, "nodes", "bNode");
  const bsdf = nodes.find((n) => n.str("idname") === "ShaderNodeBsdfPrincipled");
  const others = nodes.map((n) => n.str("idname")).filter((id) => !["ShaderNodeBsdfPrincipled", "ShaderNodeOutputMaterial"].includes(id));
  if (!bsdf) return { nodes: nodes.map((n) => n.str("idname")), others };
  const inputs = {};
  const linked = [];
  for (const s of A.listBase(bsdf, "inputs", "bNodeSocket")) {
    const id = s.str("identifier");
    if (s.ptr("link")) linked.push(id);
    const dv = s.deref("default_value");
    if (!dv) continue;
    const st = A.structName(dv);
    if (st === "bNodeSocketValueRGBA") inputs[id] = A.at(dv, st).f32s("value");
    else if (st === "bNodeSocketValueFloat") inputs[id] = A.at(dv, st).f32("value");
  }
  // A link into the BSDF means the constant below is not what renders (e.g. a texture). Report, never guess.
  return { inputs, linked, others };
}

function readMaterial(A, block) {
  const M = A.at(block, "Material");
  const name = strip(A.idName(block), "MA");
  const viewport = { color: [M.f32("r"), M.f32("g"), M.f32("b"), M.f32("a")], metallic: M.f32("metallic"), roughness: M.f32("roughness") };
  const bsdf = principled(A, M);
  const blendFlag = M.i8("blend_flag");
  const i = bsdf?.inputs ?? {};
  return {
    name, viewport, blendFlag,
    // MA_BL_CULL_BACKFACE (1 << 2). Blender renders both sides unless it is set; the glTF exporter maps it to doubleSided.
    backfaceCulling: Boolean(blendFlag & 4),
    source: bsdf?.inputs ? "PRINCIPLED_BSDF_CONSTANTS" : "VIEWPORT_DISPLAY",
    baseColor: i["Base Color"] ?? viewport.color,
    metallic: i.Metallic ?? viewport.metallic,
    roughness: i.Roughness ?? viewport.roughness,
    alpha: i.Alpha ?? 1,
    transmission: i["Transmission Weight"] ?? 0,
    ior: i.IOR ?? 1.5,
    emission: i["Emission Color"] ?? [0, 0, 0, 1],
    emissionStrength: i["Emission Strength"] ?? 0,
    linkedInputs: bsdf?.linked ?? [], otherNodes: bsdf?.others ?? [],
  };
}

function readObject(A, block) {
  const O = A.at(block, "Object");
  const type = OBJECT_TYPES[O.i16("type")] ?? `TYPE${O.i16("type")}`;
  const rotmode = O.i16("rotmode");
  const loc = O.f32s("loc");
  const scale = O.f32s("size");
  let rotation;
  if (rotmode === 1) rotation = eulerXyzToQuat(O.f32s("rot"));
  else if (rotmode === 0) { const [w, x, y, z] = O.f32s("quat"); rotation = [x, y, z, w]; }
  else throw new Error(`${A.idName(block)}: rotation mode ${rotmode} not implemented`);
  const parentinv = O.f32s("parentinv");
  const identity = (m) => m.every((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)) < 1e-6);
  const deltas = { dloc: O.f32s("dloc"), drot: O.f32s("drot"), dscale: O.f32s("dscale") };
  const issues = [];
  if (!identity(parentinv)) issues.push("parentinv is not identity");
  if (deltas.dloc.some((v) => v) || deltas.drot.some((v) => v) || deltas.dscale.some((v) => v !== 1)) issues.push("delta transforms present");
  const modifiers = A.listBase(O, "modifiers", "ModifierData").map((m) => ({ type: m.i32("type"), name: m.str("name") }));
  const constraints = A.listBase(O, "constraints", "bConstraint").length;
  if (modifiers.length) issues.push(`modifiers not evaluated: ${modifiers.map((m) => m.name).join(", ")}`);
  if (constraints) issues.push(`${constraints} constraints not evaluated`);
  const parent = O.ptr("parent");
  const data = O.deref("data");
  return { name: strip(A.idName(block), "OB"), type, old: block.old, parentOld: parent, dataBlock: data, loc, rotation, scale, partype: O.i16("partype"), issues };
}

/** Build a source scene description: { objects, meshes, materials, roots }. */
export function extractScene(B) {
  const A = blendAccess(B);
  const materials = new Map();
  for (const b of B.blocks.filter((b) => b.code === "MA")) materials.set(b, readMaterial(A, b));
  const meshes = new Map();
  for (const b of B.blocks.filter((b) => b.code === "ME")) meshes.set(b, readMesh(A, b));
  const objBlocks = B.blocks.filter((b) => b.code === "OB");
  const objects = objBlocks.map((b) => readObject(A, b));
  const byOld = new Map(objects.map((o) => [o.old, o]));
  for (const o of objects) {
    o.parent = o.parentOld ? byOld.get(o.parentOld) ?? null : null;
    if (o.parentOld && !o.parent) throw new Error(`${o.name}: parent not found`);
    if (o.parent && o.partype !== 0) o.issues.push(`parent type ${o.partype} (only OBJECT parenting is reproduced)`);
    o.mesh = o.type === "MESH" ? meshes.get(o.dataBlock) ?? null : null;
    if (o.type === "MESH" && !o.mesh) throw new Error(`${o.name}: mesh data not found`);
    if (!["MESH", "EMPTY"].includes(o.type)) o.issues.push(`${o.type} objects are not exported`);
  }
  for (const o of objects) o.children = objects.filter((c) => c.parent === o);
  return { objects, roots: objects.filter((o) => !o.parent), meshes: [...meshes.values()], materials: [...materials.values()] };
}
