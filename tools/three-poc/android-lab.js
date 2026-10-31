// P3-A5.1 debug lab: can the Pleos AVD WebView render the IONIQ 5 reference model with Three.js?
// Loads ./model.glb (served by the debug activity from app-private storage, never bundled), orbit +
// zoom, raycast part pick, and reports load / first-frame / frame-interval / draw-call figures as
// JSON console lines (`CARSCOPE_LAB {...}`), which the activity forwards to logcat.
// The model is shown as loaded: no change to its coordinates, meshes or materials.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const T0 = performance.now();
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const report = (event, data = {}) => console.log(`CARSCOPE_LAB ${JSON.stringify({ event, t: Math.round(performance.now() - T0), ...data })}`);
addEventListener("error", (e) => report("js-error", { message: String(e.message), source: e.filename, line: e.lineno }));
addEventListener("unhandledrejection", (e) => report("js-error", { message: String(e.reason?.message ?? e.reason) }));
const setStatus = (text, cls = "") => { $("status").textContent = text; $("status").className = cls; };

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (e) {
  setStatus("WebGL을 사용할 수 없습니다.", "error");
  report("webgl-unavailable", { message: String(e?.message ?? e) });
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, Number(params.get("dpr")) || 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x0e1013);
$("view").appendChild(renderer.domElement);
const gl = renderer.getContext(), dbg = gl.getExtension("WEBGL_debug_renderer_info");
report("webgl", { version: gl.getParameter(gl.VERSION), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown", vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "unknown", maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), dpr: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height], ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? "" });

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // metallic paint is black without an env map
scene.environment = envTexture;
scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x1a1c20, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(4, 6, -3);
scene.add(key);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
camera.position.set(4.6, 2.6, -5.2);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { target: new THREE.Vector3(0, 0.7, 0), enableDamping: true, enablePan: false, minDistance: 2, maxDistance: 14, maxPolarAngle: Math.PI * 0.48 });
controls.update();

// ---------- frame loop and frame-interval sampling ----------
let model = null, firstFrameAt = null, sampling = null, lastFrame = 0, frames = 0;
function frame(now) {
  if (sampling && lastFrame) sampling.push(now - lastFrame);
  lastFrame = now;
  frames++;
  controls.update();
  renderer.render(scene, camera);
  if (model && firstFrameAt === null) {
    firstFrameAt = performance.now();
    gl.finish(); // the first model frame is complete on the GPU, not just submitted
    report("first-frame", { msFromStart: Math.round(performance.now() - T0), msFromModelReady: Math.round(performance.now() - model.readyAt), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, targets: targets() });
    // Measurement only: keep the loop running with nothing drawn, to separate the platform's frame ceiling from model cost.
    if (params.get("hide") === "1") model.root.visible = false;
    setStatus("", "ok");
    if (params.get("sample") !== "0") sampleFrames(Number(params.get("sampleMs")) || 10000);
  }
}
renderer.setAnimationLoop(frame);

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
/** Frame intervals over `ms` while the car turns (autoRotate forces a fresh frame every vsync). */
function sampleFrames(ms) {
  sampling = [];
  controls.autoRotate = true;
  controls.autoRotateSpeed = 4;
  const t = performance.now();
  setTimeout(() => {
    const d = sampling; sampling = null; controls.autoRotate = false;
    const s = [...d].sort((a, b) => a - b), mean = d.reduce((a, b) => a + b, 0) / d.length;
    const r = { durationMs: Math.round(performance.now() - t), frames: d.length, meanFps: +(1000 / mean).toFixed(1), medianMs: +pct(s, 0.5).toFixed(2), p95Ms: +pct(s, 0.95).toFixed(2), p99Ms: +pct(s, 0.99).toFixed(2), maxMs: +s.at(-1).toFixed(2),
      low5Fps: +(1000 / pct(s, 0.95)).toFixed(1), low1Fps: +(1000 / pct(s, 0.99)).toFixed(1), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? null, canvas: [renderer.domElement.width, renderer.domElement.height] };
    report("frame-sample", r);
    $("stats").textContent = `${r.meanFps} fps (1% low ${r.low1Fps})\n${r.calls} calls · ${r.triangles} tri`;
  }, ms);
}

// ---------- model ----------
const tLoad = performance.now();
let fetchedAt = null;
new GLTFLoader().load("./model.glb", (gltf) => {
  const parsedAt = performance.now();
  const meshNodes = new Set(gltf.parser.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  let meshes = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) { meshes++; o.userData.part = meshNodes.has(o.name) ? o.name : o.parent?.name ?? o.name; } });
  scene.add(gltf.scene);
  model = { root: gltf.scene, readyAt: performance.now() };
  report("model-loaded", { loadMs: Math.round(parsedAt - tLoad), fetchMs: fetchedAt === null ? null : Math.round(fetchedAt - tLoad), parseMs: fetchedAt === null ? null : Math.round(parsedAt - fetchedAt), meshes, meshNodes: meshNodes.size });
}, (e) => { if (e.loaded === e.total && fetchedAt === null) fetchedAt = performance.now(); }, (err) => {
  const missing = /404/.test(String(err?.message ?? err)) || err?.target?.status === 404;
  setStatus(missing ? "모델 파일이 없습니다. 디버그 저장 공간에 IONIQ 5 GLB를 넣은 뒤 다시 여세요." : "차량 모델을 불러오지 못했습니다.", "error");
  report("model-error", { missing, message: String(err?.message ?? err) });
});

// ---------- interaction: raycast pick, zoom buttons ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let picked = null, downAt = null;
function pick(x, y) {
  if (!model) return null;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(model.root, true).find((h) => h.object.isMesh);
  if (picked) picked.material.emissive?.setHex(0);
  picked = hit?.object ?? null;
  if (picked) {
    if (!picked.userData.ownMaterial) { picked.material = picked.material.clone(); picked.userData.ownMaterial = true; } // highlight one part, not every mesh sharing the material
    picked.material.emissive?.setHex(0x1f6f80);
  }
  $("pick").hidden = !picked;
  $("pick").textContent = picked ? picked.userData.part : "";
  report("pick", { x: Math.round(x), y: Math.round(y), part: picked?.userData.part ?? null, distance: hit ? +hit.distance.toFixed(3) : null });
  return picked?.userData.part ?? null;
}
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY, performance.now()]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  if (moved < 8) pick(e.clientX, e.clientY);
  else report("orbit", { azimuthDeg: +THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()).toFixed(1), polarDeg: +THREE.MathUtils.radToDeg(controls.getPolarAngle()).toFixed(1), movedPx: Math.round(moved) });
  downAt = null;
});
function zoom(factor) {
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(offset);
  controls.update();
  report("zoom", { factor, distance: +offset.length().toFixed(3) });
}
/** CSS-pixel centres of the controls and of a part, so test automation taps real positions (× devicePixelRatio on screen). */
function targets() {
  const c = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
  const part = (name) => {
    const o = model?.root.getObjectByName(name);
    if (!o) return null;
    const p = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camera);
    return { x: Math.round((p.x + 1) / 2 * innerWidth), y: Math.round((1 - p.y) / 2 * innerHeight) };
  };
  // The wheel nearest the camera: a far-side wheel's centre is hidden behind the body.
  const wheels = [];
  model?.root.traverse((o) => { if (/^Wheel_\d+_\d+$/.test(o.name) && !wheels.some((w) => w.name === o.name)) wheels.push(o); });
  const near = wheels.map((o) => [o, new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).distanceTo(camera.position)]).sort((a, b) => a[1] - b[1])[0]?.[0];
  return { devicePixelRatio, close: c($("close")), zoomIn: c($("zoomIn")), zoomOut: c($("zoomOut")), hood: part("Door_Front_0"), wheel: near ? part(near.name) : null, wheelName: near?.name ?? null };
}
// Closing navigates to ./close, which the debug activity intercepts and turns into finish(): no JS bridge.
// GPU resources are released first, synchronously: on the Pleos home the task can be torn down within a few
// hundred ms, and a dispose posted from onPause is not guaranteed to run before WebView.destroy().
$("close").addEventListener("click", () => { report("close-requested"); dispose("close"); location.href = "./close"; });
$("zoomIn").addEventListener("click", () => zoom(0.8));
$("zoomOut").addEventListener("click", () => zoom(1.25));
controls.addEventListener("end", () => report("controls-end", { distance: +camera.position.distanceTo(controls.target).toFixed(3) }));
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- context loss and teardown ----------
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  if (disposed) { report("context-released"); return; } // our own forceContextLoss() during teardown
  e.preventDefault(); report("context-lost"); setStatus("WebGL 컨텍스트가 해제됐습니다.", "error");
});
renderer.domElement.addEventListener("webglcontextrestored", () => { report("context-restored"); location.reload(); });
document.addEventListener("visibilitychange", () => report("visibility", { hidden: document.hidden, frames }));

let disposed = false;
/** Free GPU resources: called by the activity when it finishes, and on pagehide. */
function dispose(reason) {
  if (disposed) return null;
  disposed = true;
  renderer.setAnimationLoop(null);
  controls.dispose();
  const before = { ...renderer.info.memory }; // before anything is released
  const freed = { geometries: 0, materials: 0 };
  const seen = new Set();
  scene.traverse((o) => {
    if (o.geometry) { o.geometry.dispose(); freed.geometries++; }
    for (const m of [].concat(o.material ?? [])) if (!seen.has(m)) { seen.add(m); m.dispose(); freed.materials++; }
  });
  envTexture.dispose();
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  const out = { reason, frames, before, after: { ...renderer.info.memory }, ...freed };
  report("disposed", out);
  return out;
}
addEventListener("pagehide", () => dispose("pagehide"));
window.__lab = { pick, zoom, dispose, info: () => ({ frames, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, memory: { ...renderer.info.memory }, distance: camera.position.distanceTo(controls.target) }) };
report("page-ready");
