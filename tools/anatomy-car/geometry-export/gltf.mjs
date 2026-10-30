// Minimal glTF 2.0 binary (GLB) writer, no dependencies.
// Car space: x forward, y to the car's left, z up, centimetres. glTF: Y up, right-handed, metres.
// The map (x, y, z) -> (x, z, -y) is a proper rotation (determinant +1), so winding is preserved.

export const toGltf = ([x, y, z]) => [x / 100, z / 100, -y / 100];
export const dirToGltf = ([x, y, z]) => [x, z, -y];

/** Quaternion (x, y, z, w) for a rotation about the car's z axis (glTF +Y) by `angle` radians. */
export const quatAboutCarZ = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

const hexToRgba = (hex, alpha = 1) => {
  const n = parseInt(hex.slice(1), 16);
  // sRGB to linear for baseColorFactor
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), alpha];
};

/**
 * scene: { nodes: [{ name, translation?, rotation?, children?: [index], mesh?: { primitives: [{ positions, normals, indices, material }] }, extras? }], roots: [index] }
 * materials: { id: { color, metallic, roughness, doubleSided, alpha } }
 */
export function writeGlb({ nodes, roots, materials, extras }) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const push = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(pad));
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  const materialIds = Object.keys(materials);
  const gltfMaterials = materialIds.map((id) => {
    const m = materials[id];
    return {
      name: id,
      pbrMetallicRoughness: { baseColorFactor: hexToRgba(m.color, m.alpha ?? 1), metallicFactor: m.metallic ?? 0, roughnessFactor: m.roughness ?? 0.6 },
      doubleSided: Boolean(m.doubleSided),
      ...(m.alpha !== undefined && m.alpha < 1 ? { alphaMode: "BLEND" } : {}),
    };
  });
  const meshes = [];
  const gltfNodes = nodes.map((node) => {
    const out = { name: node.name };
    if (node.translation) out.translation = node.translation;
    if (node.rotation) out.rotation = node.rotation;
    if (node.children?.length) out.children = node.children;
    if (node.extras) out.extras = node.extras;
    if (node.mesh) {
      const primitives = node.mesh.primitives.map((p) => {
        const pos = new Float32Array(p.positions.flat());
        const nor = new Float32Array(p.normals.flat());
        const idx = new Uint32Array(p.indices);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const v of p.positions) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
        accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: p.positions.length, type: "VEC3", min, max });
        const posAcc = accessors.length - 1;
        accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: p.normals.length, type: "VEC3" });
        const norAcc = accessors.length - 1;
        accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: p.indices.length, type: "SCALAR" });
        return { attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: accessors.length - 1, material: materialIds.indexOf(p.material), mode: 4 };
      });
      meshes.push({ name: node.name, primitives });
      out.mesh = meshes.length - 1;
    }
    return out;
  });
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: "2.0", generator: "CarScope anatomy-car geometry exporter" },
    scene: 0,
    scenes: [{ name: "car", nodes: roots }],
    nodes: gltfNodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    ...(extras ? { extras } : {}),
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return Buffer.concat([header, jsonHead, jsonBuf, binHead, bin]);
}
