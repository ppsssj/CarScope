// Source scene (Blender frame) -> glTF 2.0 binary. Geometry is reused vertex for vertex; only
// faces are triangulated and shading normals derived (Blender stores none for these meshes).
//
// Axis layer: the OpenX IONIQ 5 source already uses the CarScope vehicle axes (+X forward,
// +Y left, +Z up) in metres, so the glTF map is CarScope's own (x, y, z) -> (x, z, -y) without the
// cm -> m division. It is a proper rotation (det +1): winding and handedness are preserved.
// Dimension calibration is deliberately NOT done here (see profile.mjs).

export const SOURCE_TO_GLTF = Object.freeze({ position: "(x, y, z) -> (x, z, -y)", unit: "metres", scale: 1 });
export const vecToGltf = (x, y, z) => [x, z, -y];
export const quatToGltf = ([x, y, z, w]) => [x, z, -y, w];
export const scaleToGltf = ([x, y, z]) => [x, z, y];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

/** Newell normal of a polygon given as an array of [x,y,z]. */
export function newellNormal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm(n);
}

/** Triangulate one polygon (local corner indices). Quads split on the shorter diagonal, n-gons by ear clipping. */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) {
    const d02 = Math.hypot(...sub(pts[0], pts[2])), d13 = Math.hypot(...sub(pts[1], pts[3]));
    return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
  }
  const normal = newellNormal(pts);
  const idx = [...Array(n).keys()];
  const tris = [];
  const inside = (p, a, b, c) => dot(cross(sub(b, a), sub(p, a)), normal) >= 0 && dot(cross(sub(c, b), sub(p, b)), normal) >= 0 && dot(cross(sub(a, c), sub(p, c)), normal) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const [ia, ib, ic] = [idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (dot(cross(sub(b, a), sub(c, b)), normal) <= 0) continue; // reflex
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate: fall back to a fan for the remainder
  }
  for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

/**
 * Build one glTF primitive per material slot. Normals: sharp faces get the face normal; smooth faces
 * share an angle-weighted vertex normal over adjacent smooth faces (approximates Blender's split normals
 * for meshes without custom normals or sharp edges).
 */
export function buildPrimitives(mesh) {
  const P = mesh.positions;
  const v = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const faces = [];
  const smooth = new Float64Array(mesh.counts.point * 3);
  for (let f = 0; f < mesh.counts.face; f++) {
    const verts = Array.from(mesh.cornerVerts.subarray(mesh.faceOffsets[f], mesh.faceOffsets[f + 1]));
    const pts = verts.map(v);
    const normal = newellNormal(pts);
    faces.push({ verts, pts, normal, tris: triangulate(pts) });
    if (mesh.sharpFace[f]) continue;
    for (let k = 0; k < verts.length; k++) {
      const p = pts[k], a = pts[(k + verts.length - 1) % verts.length], b = pts[(k + 1) % verts.length];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(a, p)), norm(sub(b, p))))));
      for (let c = 0; c < 3; c++) smooth[3 * verts[k] + c] += normal[c] * angle;
    }
  }
  const slots = new Map();
  let triangles = 0;
  let degenerate = 0;
  faces.forEach((face, f) => {
    const slot = Math.max(0, Math.min(mesh.materialIndex[f], Math.max(0, mesh.materials.length - 1)));
    const prim = slots.get(slot) ?? slots.set(slot, { material: mesh.materials[slot] ?? null, positions: [], normals: [], indices: [], remap: new Map() }).get(slot);
    const local = face.verts.map((vi) => {
      const key = mesh.sharpFace[f] ? `${vi}f${f}` : `${vi}s`;
      let out = prim.remap.get(key);
      if (out === undefined) {
        out = prim.positions.length / 3;
        prim.remap.set(key, out);
        prim.positions.push(...vecToGltf(...v(vi)));
        let n = mesh.sharpFace[f] ? face.normal : norm([smooth[3 * vi], smooth[3 * vi + 1], smooth[3 * vi + 2]]);
        if (!n.some((c) => c)) n = face.normal.some((c) => c) ? face.normal : [0, 0, 1];
        prim.normals.push(...vecToGltf(...n));
      }
      return out;
    });
    if (!face.normal.some((c) => c)) degenerate++;
    for (const t of face.tris) { prim.indices.push(local[t[0]], local[t[1]], local[t[2]]); triangles++; }
  });
  return { primitives: [...slots.values()].map(({ remap, ...p }) => p), triangles, degenerateFaces: degenerate };
}

const pad4 = (n) => (4 - (n % 4)) % 4;

function gltfMaterial(m) {
  const out = {
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: [...m.baseColor.slice(0, 3), m.alpha], metallicFactor: m.metallic, roughnessFactor: m.roughness },
    doubleSided: !m.backfaceCulling,
    extras: { blenderSource: m.source, linkedInputs: m.linkedInputs, otherNodes: m.otherNodes },
  };
  const extensions = {};
  if (m.alpha < 1) out.alphaMode = "BLEND";
  if (m.transmission > 0) { extensions.KHR_materials_transmission = { transmissionFactor: m.transmission }; extensions.KHR_materials_ior = { ior: m.ior }; }
  if (m.emissionStrength > 0) {
    out.emissiveFactor = m.emission.slice(0, 3);
    if (m.emissionStrength !== 1) extensions.KHR_materials_emissive_strength = { emissiveStrength: m.emissionStrength };
  }
  if (Object.keys(extensions).length) out.extensions = extensions;
  return out;
}

/** Write the scene as GLB bytes. Node names are the Blender object names (prefix stripped). */
export function sceneToGlb(scene, assetExtras) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const push = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(pad4(bytes.length)));
    byteLength += bytes.length + pad4(bytes.length);
    return bufferViews.length - 1;
  };
  const materialIndex = new Map(scene.materials.map((m, i) => [m.name, i]));
  const extensionsUsed = new Set();
  const materials = scene.materials.map((m) => { const g = gltfMaterial(m); Object.keys(g.extensions ?? {}).forEach((e) => extensionsUsed.add(e)); return g; });
  const meshIndex = new Map();
  const meshes = [];
  const meshStats = {};
  for (const mesh of scene.meshes) {
    const built = buildPrimitives(mesh);
    meshStats[mesh.name] = { triangles: built.triangles, degenerateFaces: built.degenerateFaces };
    const primitives = built.primitives.map((p) => {
      const pos = new Float32Array(p.positions);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
      accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
      const position = accessors.length - 1;
      accessors.push({ bufferView: push(new Float32Array(p.normals), 34962), componentType: 5126, count: p.normals.length / 3, type: "VEC3" });
      const normal = accessors.length - 1;
      const wide = pos.length / 3 > 65535;
      const idx = wide ? new Uint32Array(p.indices) : new Uint16Array(p.indices);
      accessors.push({ bufferView: push(idx, 34963), componentType: wide ? 5125 : 5123, count: idx.length, type: "SCALAR" });
      const prim = { attributes: { POSITION: position, NORMAL: normal }, indices: accessors.length - 1, mode: 4 };
      if (p.material && materialIndex.has(p.material)) prim.material = materialIndex.get(p.material);
      return prim;
    });
    meshIndex.set(mesh, meshes.length);
    meshes.push({ name: mesh.name, primitives });
  }
  const nodeIndex = new Map(scene.objects.map((o, i) => [o, i]));
  const nodes = scene.objects.map((o) => {
    const n = { name: o.name };
    const t = vecToGltf(...o.loc);
    if (t.some((c) => c !== 0)) n.translation = t;
    const r = quatToGltf(o.rotation);
    if (Math.abs(r[3] - 1) > 1e-12 || r.slice(0, 3).some((c) => c !== 0)) n.rotation = r;
    if (o.scale.some((c) => c !== 1)) n.scale = scaleToGltf(o.scale);
    if (o.mesh) n.mesh = meshIndex.get(o.mesh);
    if (o.children.length) n.children = o.children.map((c) => nodeIndex.get(c));
    n.extras = { blenderType: o.type, ...(o.issues.length ? { conversionIssues: o.issues } : {}) };
    return n;
  });
  const json = {
    asset: { version: "2.0", generator: "CarScope tools/ioniq5-asset (direct .blend reader, no Blender)", extras: assetExtras },
    scene: 0,
    scenes: [{ name: "Scene", nodes: scene.roots.map((o) => nodeIndex.get(o)) }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
    ...(extensionsUsed.size ? { extensionsUsed: [...extensionsUsed].sort() } : {}),
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const chunkHeader = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return { glb: Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(bin.length, 0x004e4942), bin]), meshStats };
}
