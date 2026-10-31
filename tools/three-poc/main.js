// CarScope P2-A2 Three.js PoC: loads car.glb written by tools/anatomy-car/geometry-export/export.mjs.
// Doors turn on their hinge nodes between the states recorded in the GLB (node extras).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VertexNormalsHelper } from "three/addons/helpers/VertexNormalsHelper.js";

const params = new URLSearchParams(location.search);
const doorControls = { "door-front-left": "fl", "door-rear-left": "rl", "door-front-right": "fr", "door-rear-right": "rr" };
window.__labLog = [];
const log = (tag, data) => { window.__labLog.push({ tag, ...data }); console.log(`CARSCOPE_LAB ${tag} ${JSON.stringify(data)}`); };
const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Number(params.get("dpr")) || Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0xf4f5f7);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(3, 6, -4); // same side as the kit's light: from above, front-left
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const persp = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
persp.position.set(4.5, 2.6, -5.2);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 100);
let camera = persp;
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;

const state = { doors: {}, fixed: {}, meshes: [], helpers: [], selected: null, frames: [], dirty: true, gltf: null };
const loader = new GLTFLoader();
const t0 = performance.now();
loader.load(params.get("model") ?? "./car.glb", (gltf) => {
  state.gltf = gltf;
  const root = gltf.scene;
  scene.add(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      state.meshes.push(o);
    }
    const ex = o.userData ?? {};
    if (ex.states) state.doors[o.name] = { node: o, closed: ex.states.closed, open: ex.states.open, t: 0, target: 0 };
    if (ex.visibleWhen === "open") (state.fixed[o.name.split(".fixed")[0]] ??= []).push(o);
  });
  const box = new THREE.Box3().setFromObject(root);
  state.box = box;
  state.svgDir = new THREE.Vector3(...(gltf.parser.json.extras?.svgViewDirection ?? [0.5, 0.5, -0.7])).normalize();
  applyDoors();
  const tris = state.meshes.reduce((a, m) => a + m.geometry.index.count / 3, 0);
  log("loaded", { ms: Math.round(performance.now() - t0), meshes: state.meshes.length, triangles: tris, doors: Object.keys(state.doors) });
  if (params.get("cam") === "svg") useSvgCamera();
  if (params.get("landmarks")) addLandmarks(gltf.parser.json.extras?.coordinateLandmarks ?? []);
  for (const [id,key] of Object.entries(doorControls)) {
    const d=state.doors[id];
    const extra=document.getElementById(`${key}-control`);
    if(extra) extra.hidden=!d;
    if(d && params.get(key)) d.t=d.target=Number(params.get(key));
  }
  const profile=gltf.parser.json.extras?.vehicleGeometryProfile;
  if(profile) document.querySelector("#panel h1").textContent=`Envelope SUV · ${profile.oemVisualMatch}`;
  if(params.get("view") && directions[params.get("view")]) useView(params.get("view"));
  applyDoors();
  if (params.get("wire")) { document.getElementById("wire").checked = true; for (const m of state.meshes) m.material.wireframe = true; }
  if (params.get("normals")) { document.getElementById("normals").checked = true; document.getElementById("normals").dispatchEvent(new Event("change")); }
  if (params.get("auto")) runAuto();
}, undefined, (err) => log("error", { message: String(err) }));

function applyDoors() {
  for (const [id, d] of Object.entries(state.doors)) {
    d.node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.closed + (d.open - d.closed) * d.t);
    for (const f of state.fixed[id] ?? []) f.visible = d.t > 0.01;
    const slider = document.getElementById(doorControls[id]);
    if (slider && document.activeElement !== slider) slider.value = d.t.toFixed(2);
  }
  state.dirty = true;
}
for (const [id, el] of Object.entries(doorControls)) {
  document.getElementById(el).addEventListener("input", (e) => { const d = state.doors[id]; if(d) { d.t = d.target = Number(e.target.value); applyDoors(); } });
}
document.querySelectorAll("[data-anim]").forEach((b) => b.addEventListener("click", () => { const d = state.doors[b.dataset.anim]; if(d) d.target = d.target > 0.5 ? 0 : 1; }));
document.getElementById("wire").addEventListener("change", (e) => { for (const m of state.meshes) m.material.wireframe = e.target.checked; state.dirty = true; });
document.getElementById("normals").addEventListener("change", (e) => {
  if (e.target.checked) for (const m of state.meshes) { const h = new VertexNormalsHelper(m, 0.02, 0x3e63dd); state.helpers.push(h); scene.add(h); }
  else { for (const h of state.helpers) { scene.remove(h); h.dispose(); } state.helpers = []; }
  state.dirty = true;
});

function fitOrthographic() {
  const size = state.box.getSize(new THREE.Vector3());
  const half = Math.max(size.x, size.z) * 0.62;
  const aspect = innerWidth / innerHeight;
  Object.assign(ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
  ortho.updateProjectionMatrix();
}
function useSvgCamera() {
  fitOrthographic();
  const centre = state.box.getCenter(new THREE.Vector3());
  const dir = state.svgDir.clone();
  ortho.position.copy(centre).addScaledVector(dir, 20);
  ortho.up.set(0, 1, 0);
  ortho.lookAt(centre);
  ortho.updateProjectionMatrix();
  camera = ortho;
  controls.object = ortho;
  controls.enabled = params.get("orthographic") !== "1";
  controls.target.copy(centre);
  state.dirty = true;
}
document.getElementById("svgcam").addEventListener("click", useSvgCamera);

const pitch=params.get("orthographic")==="1"?0:0.22;
const directions = { front: [1, pitch, 0], rear: [-1, pitch, 0], left: [0, pitch, -1], right: [0, pitch, 1], top:[0,1,0] };
function useView(name) {
  useSvgCamera();
  const centre = state.box.getCenter(new THREE.Vector3());
  ortho.position.copy(centre).addScaledVector(new THREE.Vector3(...directions[name]).normalize(), 20);
  if(name==="top") { ortho.up.set(1,0,0); controls.enabled=false; } // physical front (+car X) points up in plan view
  ortho.lookAt(centre);
  if(controls.enabled) controls.update(); state.dirty = true;
}
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => useView(b.dataset.view)));

function addLandmarks(landmarks) {
  for (const l of landmarks) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color: l.color }));
    dot.position.fromArray(l.gltfMetres); scene.add(dot);
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = l.color; ctx.font = "bold 32px sans-serif"; ctx.fillText(l.id, 8, 44);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    label.position.copy(dot.position).add(new THREE.Vector3(0, 0.12, 0)); label.scale.set(0.6, 0.15, 1); scene.add(label);
  }
}
document.getElementById("freecam").addEventListener("click", () => { camera = persp; controls.object = persp; controls.enabled=true; state.dirty = true; });

const ray = new THREE.Raycaster();
renderer.domElement.addEventListener("pointerdown", (e) => {
  const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(p, camera);
  const hit = ray.intersectObjects(state.meshes.filter((m) => m.visible), false)[0];
  if (state.selected) state.selected.material.emissive.setHex(0x000000);
  state.selected = hit?.object ?? null;
  if (state.selected) {
    state.selected.material.emissive.setHex(0x3e63dd);
    const ex = state.selected.userData;
    document.getElementById("info").textContent = `${ex.partId}\nclass: ${ex.cls}\nmaterial: ${ex.materialId}\ntriangles: ${state.selected.geometry.index.count / 3}${ex.visibleWhen ? `\nvisible when: ${ex.visibleWhen}` : ""}`;
  } else document.getElementById("info").textContent = "no part selected";
  state.dirty = true;
});
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); persp.aspect = innerWidth / innerHeight; persp.updateProjectionMatrix(); if (camera === ortho) fitOrthographic(); state.dirty = true; });
controls.addEventListener("change", () => { state.dirty = true; });

// render on demand: only while something moves (calm when idle)
let last = performance.now();
let lost = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if(controls.enabled) controls.update();
  for (const d of Object.values(state.doors)) {
    if (Math.abs(d.t - d.target) > 1e-3) { d.t += Math.sign(d.target - d.t) * Math.min(Math.abs(d.target - d.t), dt * 0.9); applyDoors(); }
  }
  if (state.spin) { controls.object.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.8); state.dirty = true; }
  if (!state.dirty || lost) return;
  state.dirty = false;
  renderer.render(scene, camera);
  state.frames.push(now);
  const info = renderer.info.render;
  document.getElementById("stats").textContent = `draw calls ${info.calls}\ntriangles ${info.triangles}`;
}
requestAnimationFrame(frame);

renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; log("contextlost", {}); });
// a restored context starts from default GL state: re-apply what the renderer does not rebuild itself
renderer.domElement.addEventListener("webglcontextrestored", () => { renderer.setClearColor(0xf4f5f7); lost = false; state.dirty = true; log("contextrestored", {}); });

// ---------------------------------------------------------------- automated measurement (?auto=1)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function frameStats(from) {
  const ts = state.frames.filter((t) => t >= from);
  const dts = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const q = (p) => Number((dts[Math.min(dts.length - 1, Math.floor(p * dts.length))] ?? 0).toFixed(1));
  return { frames: ts.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(0.999) };
}
async function runAuto() {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  log("gpu", {
    webgl2: renderer.capabilities.isWebGL2,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    pixelRatio: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height],
  });
  await wait(500);
  let from = performance.now();
  state.spin = true;
  await wait(4000);
  state.spin = false;
  log("orbit", frameStats(from));
  from = performance.now();
  for (const d of Object.values(state.doors)) d.target = 1;
  await wait(1800);
  for (const d of Object.values(state.doors)) d.target = 0;
  await wait(1800);
  log("doors", frameStats(from));
  // context loss and restore
  const lose = gl.getExtension("WEBGL_lose_context");
  if (lose) {
    lose.loseContext();
    await wait(500);
    lose.restoreContext();
    await wait(1200);
    state.dirty = true;
    await wait(300);
    const px = new Uint8Array(4);
    const ctx = renderer.getContext();
    renderer.render(scene, camera);
    ctx.readPixels(Math.floor(ctx.drawingBufferWidth / 2), Math.floor(ctx.drawingBufferHeight / 2), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    log("afterRestore", { centrePixel: Array.from(px), drawCalls: renderer.info.render.calls });
  } else log("afterRestore", { skipped: "WEBGL_lose_context unavailable" });
  log("done", { memory: performance.memory ? { usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) } : null });
}
window.__lab = { state, useSvgCamera, useView, cam: () => { controls.enabled = false; return camera; }, setDoor: (id, t) => { const d = state.doors[id]; d.t = d.target = t; applyDoors(); }, render: () => { state.dirty = true; } };
