// CarScope P2-A6 PoC: load the locally converted OpenX IONIQ 5 GLB (served from CARSCOPE_IONIQ5_GLB,
// never from the repository) and select parts by ray casting. Read-only: no geometry is modified.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { classifyName } from "./ioniq5-asset/parts.mjs";

const params = new URLSearchParams(location.search);
window.__labLog = [];
const log = (tag, data) => { window.__labLog.push({ tag, ...data }); console.log(`CARSCOPE_IONIQ5 ${tag} ${JSON.stringify(data)}`); };
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Number(params.get("dpr")) || Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0xf4f5f7);
$("view").appendChild(renderer.domElement);
const scene = new THREE.Scene();
// The source paint is metallic: without an environment it renders black away from the sun.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(3, 6, -4);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.name = "__ground";
scene.add(ground);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
camera.position.set(4.5, 2.6, -5.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.7, 0);

// glTF (metres, Y up) -> CarScope world (cm, +X forward, +Y left, +Z up); mirrors profile.mjs.
const toCarCm = (v) => [v.x * 100, -v.z * 100, v.y * 100];
const fmt = (a) => a.map((x) => x.toFixed(1)).join(", ");
const state = { gltf: null, meshes: [], selected: null, box: null };
const HIDE = new Set(["body-shell", "glazing", "closure-hood", "closure-tailgate", "closure-side-door", "side-mirror", "lamp-housing"]);

const loader = new GLTFLoader();
const t0 = performance.now();
loader.load(params.get("model") ?? "./external/ioniq5.glb", (gltf) => {
  state.gltf = gltf;
  scene.add(gltf.scene);
  const meshNodeNames = new Set(gltf.parser.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    // A glTF mesh with several primitives loads as a Group of Meshes: the part is the named parent node.
    const parentIsMeshNode = o.parent && !o.parent.isScene && meshNodeNames.has(o.parent.name);
    o.userData.part = parentIsMeshNode ? o.parent : o;
    state.meshes.push(o);
  });
  state.box = new THREE.Box3().setFromObject(gltf.scene);
  const parts = new Set(state.meshes.map((m) => m.userData.part.name));
  const tris = state.meshes.reduce((a, m) => a + m.geometry.index.count / 3, 0);
  const json = gltf.parser.json;
  log("loaded", { ms: Math.round(performance.now() - t0), parts: parts.size, drawMeshes: state.meshes.length, triangles: tris, nodes: json.nodes.length,
    boxCm: { min: toCarCm(state.box.min), max: toCarCm(state.box.max) }, license: json.asset?.extras?.carscope?.provenance?.license ?? null });
  $("status").textContent = `${parts.size} parts · ${tris} triangles · ${json.nodes.length} nodes`;
  useView(params.get("view") ?? "iso");
}, undefined, (err) => {
  $("status").textContent = "GLB not available: set CARSCOPE_IONIQ5_GLB and restart serve.mjs";
  log("load-error", { message: String(err?.message ?? err) });
});

function select(part) {
  if (state.selected) for (const m of state.meshes) if (m.userData.part === state.selected) m.material.emissive?.setHex(0x000000);
  state.selected = part;
  if (!part) { $("info").textContent = "no part selected"; return null; }
  for (const m of state.meshes) if (m.userData.part === part) m.material.emissive?.setHex(0x3a6df0);
  const box = new THREE.Box3().setFromObject(part);
  const path = [];
  for (let p = part.parent; p && !p.isScene; p = p.parent) path.unshift(p.name);
  const info = { name: part.name, category: classifyName(part.name), minCm: toCarCm(box.min), maxCm: toCarCm(box.max), path };
  // Box3 corners swap under the axis map, so report a proper min/max in car space.
  const lo = info.minCm.map((v, i) => Math.min(v, info.maxCm[i])), hi = info.minCm.map((v, i) => Math.max(v, info.maxCm[i]));
  $("info").textContent = `${info.name}\ncategory: ${info.category} (name-based)\nCarScope cm min: ${fmt(lo)}\nCarScope cm max: ${fmt(hi)}\npath: ${path.join(" › ")}`;
  log("selected", { name: info.name, category: info.category, minCm: lo, maxCm: hi });
  return { ...info, minCm: lo, maxCm: hi };
}

const ray = new THREE.Raycaster();
function pickAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(state.meshes.filter((m) => m.visible), false)[0];
  return select(hit ? hit.object.userData.part : null);
}
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) pickAt(e.clientX, e.clientY); });

/** Screen position of a part's bounding-box centre (for automated pick checks). */
function screenOf(name) {
  const part = state.meshes.map((m) => m.userData.part).find((p) => p.name === name);
  if (!part) return null;
  const c = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3()).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return [rect.left + ((c.x + 1) / 2) * rect.width, rect.top + ((1 - c.y) / 2) * rect.height];
}

function useView(v) {
  const c = state.box ? state.box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.8, 0);
  // Car forward = +X, car left = -Z in glTF.
  const dir = { front: [1, 0.22, 0], rear: [-1, 0.22, 0], left: [0, 0.22, -1], right: [0, 0.22, 1], top: [0.001, 1, 0], iso: [0.75, 0.45, -0.85] }[v] ?? [0.75, 0.45, -0.85];
  camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(7.2));
  controls.target.copy(c);
  controls.update();
  camera.updateMatrixWorld(); // keep project() and ray casting on the same camera before the next frame
  return v;
}

$("hideShell").addEventListener("change", (e) => { for (const m of state.meshes) m.visible = !(e.target.checked && HIDE.has(classifyName(m.userData.part.name))); });
$("wire").addEventListener("change", (e) => { for (const m of state.meshes) m.material.wireframe = e.target.checked; });
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => useView(b.dataset.view)));
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

window.__ioniq = { state, select: (name) => select(state.meshes.map((m) => m.userData.part).find((p) => p.name === name) ?? null), pickAt, screenOf, useView,
  hideShell: (on) => { $("hideShell").checked = on; $("hideShell").dispatchEvent(new Event("change")); } };
