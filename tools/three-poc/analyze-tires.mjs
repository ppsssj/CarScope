// Read-only actual GLB mapping audit. Derived reports stay outside the repository.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveTireTargets } from './tire-targets.mjs';
import { glbGeometry } from '../ioniq5-asset/analyze.mjs';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: analyze-tires.mjs <source.glb> <external report directory>');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(output), rel = relative(repo, out);
if (!rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw new Error('Output must be external');
const bytes = readFileSync(source), raw = glbGeometry(bytes);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const carBox = b => ({ min: [b.min.x * 100, -b.max.z * 100, b.min.y * 100], max: [b.max.x * 100, -b.min.z * 100, b.max.y * 100] });
const tires = [...resolveTireTargets(gltf.scene)].map(([id, t]) => ({ id, node: t.node,
  parent: raw.nodes.find(n => n.name === t.node).parent, path: raw.nodes.find(n => n.name === t.node).path,
  rubber: t.meshes.map(m => ({ name: m.name, material: m.material.name, triangles: m.geometry.index.count / 3 })),
  wheelMaterials: t.pickMeshes.map(m => m.material.name), rubberBoundsCarCm: carBox(t.bounds),
  assemblyBoundsCarCm: raw.nodes.find(n => n.name === t.node).box,
}));
const report = { sha256: createHash('sha256').update(bytes).digest('hex'), frame: '+X forward / +Y left / +Z up, cm',
  geometry: 'REUSED_COMMUNITY_MESH_NOT_OEM_CAD', tires, frontAnchor: raw.nodes.find(n => n.name === 'Door_Front_0').box,
  rearAnchor: raw.nodes.find(n => n.name === 'Light_Brake_Center_0').box };
mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'tire-mapping.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
