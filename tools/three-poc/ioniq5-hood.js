// CarScope P3-A1 PoC: open the IONIQ 5 hood about a selectable hinge-axis candidate. The GLB comes from
// CARSCOPE_IONIQ5_GLB (never the repo). The hood node keeps its own local transform: a pivot node is
// inserted between it and its group, and the pivot is the identity at 0 degrees.
// Collision checks reuse tools/ioniq5-asset/collision.mjs, the same exact narrow phase as the report.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as H from "./ioniq5-asset/hood.mjs";
import { staticScene, meshClearance, baselineContacts } from "./ioniq5-asset/collision.mjs";
import { attachFrontCompartment } from "./front-compartment-view.js";

const params = new URLSearchParams(location.search);
window.__labLog = [];
const log = (tag, data) => { window.__labLog.push({ tag, ...data }); console.log(`CARSCOPE_HOOD ${tag} ${JSON.stringify(data)}`); };
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Number(params.get("dpr")) || Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0xf4f5f7);
$("view").appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(3, 6, -4);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const shiftView = () => camera.setViewOffset(innerWidth, innerHeight, innerWidth > 900 ? -170 : 0, 0, innerWidth, innerHeight);
shiftView();
const controls = new OrbitControls(camera, renderer.domElement);

// glTF (m, Y up) <-> CarScope (cm, +X forward, +Y left, +Z up); same map as profile.mjs gltfToCarCm.
const toCar = (v) => [v.x * 100, -v.z * 100, v.y * 100];
const toGltf = ([x, y, z]) => new THREE.Vector3(x / 100, z / 100, -y / 100);
const toGltfDir = ([x, y, z]) => new THREE.Vector3(x, z, -y).normalize();

const S = { angle: 0, axis: null, candidates: [], hood: null, group: null, pivot: null, closedCar: null, others: [], scene: null, baseline: null, outline: [], placeholder: null, meshes: [], hoodWorld0: null, markers: null, tween: null };

/** World-space triangles (CarScope cm) of every mesh under `root`, grouped by the named mesh node. */
function carTriangles(root, meshNodeNames) {
  const byName = new Map();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.synthetic) return;
    const name = o.parent && meshNodeNames.has(o.parent.name) && !meshNodeNames.has(o.name) ? o.parent.name : o.name;
    const g = o.geometry, pos = g.attributes.position, idx = g.index.array, v = new THREE.Vector3(), out = [];
    for (let i = 0; i < idx.length; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(o.matrixWorld); out.push(...toCar(v)); }
    byName.set(name, [...(byName.get(name) ?? []), ...out]);
  });
  return [...byName].map(([name, t]) => ({ name, triangles: Float64Array.from(t) }));
}

function pixels() {
  renderer.render(scene, camera);
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

/** Boundary outline of each hood primitive, in the primitive's own local frame (moves with it). */
function addOutline(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index.array, T = new Float64Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { T[3 * i] = pos.getX(idx[i]); T[3 * i + 1] = pos.getY(idx[i]); T[3 * i + 2] = pos.getZ(idx[i]); }
  const pts = H.boundaryEdges(T).flatMap(([a, b]) => [...a, ...b]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: 0.95 }));
  lines.renderOrder = 10;
  lines.userData.synthetic = true;
  mesh.add(lines);
  return lines;
}

function setAngle(deg) {
  S.angle = Math.max(0, Math.min(60, deg));
  if (S.angle === 0) S.pivot.matrix.identity(); // exactly the source pose, no round-off
  else {
    // pivot = G^-1 * R_world(axis, angle) * G, so hood_world = R_world * (original hood_world).
    const G = S.group.matrixWorld, p = toGltf(S.axis.point), d = toGltfDir(S.axis.direction);
    const R = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(d, (S.angle * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    S.pivot.matrix.copy(G.clone().invert().multiply(R).multiply(G));
  }
  S.pivot.matrixWorldNeedsUpdate = true;
  $("angle").value = String(S.angle);
  $("angleOut").textContent = `${S.angle.toFixed(1)}°`;
  scheduleCheck();
}

let checkTimer = null;
function scheduleCheck() { clearTimeout(checkTimer); if ($("live").checked && !S.tween) checkTimer = setTimeout(runCheck, 120); }
function runCheck() {
  if (!S.scene) return null;
  const t0 = performance.now();
  const moved = H.rotatePoints(S.closedCar, S.axis, S.angle);
  // With the P3-A2.1 shell shown, the hood is also checked against it (shell items come after the source meshes).
  const c = meshClearance(moved, S.fc?.group.visible ? S.fc.sceneWithShell() : S.scene, { cutoff: 10, baseline: S.baseline });
  const ms = performance.now() - t0;
  const verdict = S.angle === 0 ? "CLOSED_BASELINE" : c.intersectingPairs ? "NEW_MESH_INTERSECTION" : "NO_NEW_INTERSECTION";
  const regions = Object.entries(c.byRegion).filter(([, v]) => v.minCm < 10).sort((a, b) => a[1].minCm - b[1].minCm).slice(0, 5).map(([k, v]) => `  ${k}: ${v.minCm.toFixed(2)} cm${v.intersectingPairs ? `, ${v.intersectingPairs} crossing pairs` : ""}`).join("\n");
  $("check").innerHTML = `<b>Axis ${S.axis.id}</b> · ${S.angle.toFixed(1)}° <span class="muted">SIMULATION_ONLY · hinge UNVERIFIED</span>\n<span class="${verdict === "NEW_MESH_INTERSECTION" ? "bad" : "ok"}">${verdict}</span> (exact triangle-triangle, ${c.narrowPhasePairs} pairs, ${ms.toFixed(0)} ms)\nnew crossing pairs: ${c.intersectingPairs}\nclosest non-seam geometry: ${c.minDistanceCm === null ? "≥ 10 cm" : c.minDistanceCm.toFixed(2) + " cm"}${c.closest ? ` (${c.closest.region})` : ""}\nclosed-pose seam pairs still crossing: ${c.baselineIntersectingPairs}\n${regions}\n<span class="muted">Sampled pose only: not a proof for the continuous sweep.</span>`;
  // Red markers at new crossings (world space).
  S.markers.clear();
  for (const x of c.intersections.slice(0, 200)) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false })); m.position.copy(toGltf(x.at)); m.renderOrder = 11; S.markers.add(m); }
  const out = { deg: S.angle, axis: S.axis.id, verdict, newPairs: c.intersectingPairs, seamPairs: c.baselineIntersectingPairs, minNewCm: c.minDistanceCm, closest: c.closest?.region ?? null, ms: Math.round(ms) };
  log("check", out);
  return out;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function animateTo(target, ms = 1400) {
  return new Promise((done) => {
    const from = S.angle, t0 = performance.now();
    S.tween = (now) => { const t = Math.min(1, (now - t0) / ms); setAngle(from + (target - from) * ease(t)); if (t >= 1) { S.tween = null; setAngle(target); done(); } };
  });
}

function useAxis(id) {
  S.axis = S.candidates.find((c) => c.id === id) ?? S.candidates[0];
  $("axis").value = S.axis.id;
  $("axisInfo").textContent = `${S.axis.evidence} · pivot (${S.axis.point.map((v) => v.toFixed(1)).join(", ")}) cm\ndir (${S.axis.direction.map((v) => v.toFixed(3)).join(", ")})\nsource: ${S.axis.source}\n${S.axis.assumptions.map((a) => "· " + a).join("\n")}`;
  setAngle(S.angle);
}

function useView(v) {
  const c = new THREE.Vector3(0, 0.75, 0), hoodC = toGltf([160, 0, 100]);
  const views = { front: [c, [1, 0.25, 0], 6.5], side: [c, [0, 0.12, -1], 6.8], iso: [c, [0.75, 0.45, -0.85], 7.2], top: [c, [0.001, 1, 0], 9.0], bay: [toGltf([155, 0, 62]), [1.0, 1.35, -0.3], 3.3],
    // P3-A2.1 compartment close-ups
    bayiso: [toGltf([160, 0, 70]), [0.75, 0.9, -0.85], 3.2], baytop: [toGltf([160, 0, 70]), [0.55, 1, 0.001], 3.2], bayside: [toGltf([150, 0, 85]), [0, 0.2, -1], 3.4] };
  const [target, dir, dist] = views[v] ?? views.iso;
  camera.position.copy(target).add(new THREE.Vector3(...dir).normalize().multiplyScalar(dist));
  controls.target.copy(target);
  controls.update();
  camera.updateMatrixWorld();
  return v;
}

function setXray(on) {
  for (const m of S.meshes) {
    if (m.userData.isHood) continue;
    const body = /^(Body|Body_Glass|Lamp_Housings)$/.test(m.userData.part);
    m.material.transparent = on && body;
    m.material.opacity = on && body ? 0.25 : 1;
    m.material.depthWrite = !(on && body);
  }
}

const loader = new GLTFLoader();
const t0 = performance.now();
loader.load(params.get("model") ?? "./external/ioniq5.glb", async (gltf) => {
  scene.add(gltf.scene);
  const json = gltf.parser.json;
  const meshNodeNames = new Set(json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  gltf.scene.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.part = meshNodeNames.has(o.name) ? o.name : o.parent.name; S.meshes.push(o); } });
  S.hood = gltf.scene.getObjectByName(H.HOOD_NODE);
  S.group = gltf.scene.getObjectByName(H.HOOD_GROUP);
  useView(params.get("view") ?? "iso");
  gltf.scene.updateMatrixWorld(true);
  const before = pixels(), control = pixels(); // two renders of the same scene: GPU frame-to-frame noise floor
  S.hoodWorld0 = S.hood.matrixWorld.clone();
  const hoodLocal0 = S.hood.matrix.clone();

  // Insert the pivot between the group and the untouched hood node.
  S.pivot = new THREE.Object3D();
  S.pivot.name = "__p3a1_hood_pivot";
  S.pivot.matrixAutoUpdate = false;
  S.group.add(S.pivot);
  S.pivot.add(S.hood);
  S.hood.traverse((o) => { if (o.isMesh) o.userData.isHood = true; });
  gltf.scene.updateMatrixWorld(true);
  const after = pixels();
  let diff = 0, noise = 0;
  for (let i = 0; i < before.length; i += 4) { if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) diff++; if (before[i] !== control[i] || before[i + 1] !== control[i + 1] || before[i + 2] !== control[i + 2]) noise++; }
  const worldDelta = Math.max(...S.hood.matrixWorld.elements.map((v, i) => Math.abs(v - S.hoodWorld0.elements[i])));
  const localSame = S.hood.matrix.equals(hoodLocal0);

  const parts = carTriangles(gltf.scene, meshNodeNames);
  const id = H.identifyHood(parts.map((p) => (p.name === H.HOOD_NODE ? { ...p, parent: H.HOOD_GROUP } : p)));
  S.closedCar = id.hood.triangles;
  S.others = parts.filter((p) => p.name !== H.HOOD_NODE);
  S.scene = staticScene(S.others, { region: H.bodyRegion });
  S.baseline = baselineContacts(S.closedCar, S.scene);
  const G = S.group.matrixWorld, o = new THREE.Vector3().setFromMatrixPosition(G);
  const lateral = toCar(new THREE.Vector3(0, 1, 0).transformDirection(G)).map((v) => v / 100);
  let searched = null;
  try { const rep = await (await fetch("./external/p3-a1/hood-feasibility.json")).json(); const c = rep.candidates.find((x) => x.id === "C"); if (c) searched = { point: c.point }; } catch { /* C needs the Node report */ }
  S.candidates = H.axisCandidates({ hoodTriangles: S.closedCar, groupOriginCm: toCar(o), groupLateralCm: lateral, searched }).candidates;
  $("axis").innerHTML = S.candidates.map((c) => `<option value="${c.id}">${c.id} · ${c.label} (${c.evidence})</option>`).join("");
  for (const deg of H.SAMPLE_ANGLES) { const b = document.createElement("button"); b.textContent = `${deg}°`; b.onclick = () => animateTo(deg, 700); $("samples").appendChild(b); }
  S.hood.traverse((m) => { if (m.isMesh && !m.userData.synthetic) S.outline.push(addOutline(m)); });
  S.markers = new THREE.Group(); S.markers.userData.synthetic = true; scene.add(S.markers);
  const probe = H.underHoodProbe(S.closedCar, S.others, { step: 5 });
  const box = H.placeholderBox(probe);
  if (box) {
    const size = box.max.map((v, i) => v - box.min[i]), centre = box.min.map((v, i) => v + size[i] / 2);
    S.placeholder = new THREE.Mesh(new THREE.BoxGeometry(size[0] / 100, size[2] / 100, size[1] / 100), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35, depthWrite: false }));
    S.placeholder.add(new THREE.LineSegments(new THREE.EdgesGeometry(S.placeholder.geometry), new THREE.LineBasicMaterial({ color: 0xb45309 })));
    S.placeholder.position.copy(toGltf(centre));
    S.placeholder.name = H.PLACEHOLDER_TAG; S.placeholder.userData = { synthetic: true, tag: H.PLACEHOLDER_TAG, box };
    S.placeholder.visible = false;
    scene.add(S.placeholder);
  }
  // P3-A2.1 front compartment shell: separate group, never under the hood pivot.
  const bodyMaterial = S.meshes.find((m) => m.userData.part === "Body" && m.material.name === "Body")?.material;
  S.fc = attachFrontCompartment({ scene, bodyMaterial, hood: S.closedCar, others: S.others, camera, dom: document, log });
  if (params.get("shell") === "1") setShell({ shell: true });
  useAxis(params.get("axis") ?? "A");
  const gl = renderer.getContext(), dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const info = { ms: Math.round(performance.now() - t0), parts: parts.length, hoodTriangles: S.closedCar.length / 9, staticTriangles: S.scene.items.length, seamTriangles: S.baseline.size, identification: id.problems,
    zeroDegree: { changedPixels: diff, sameSceneRerenderChangedPixels: noise, totalPixels: before.length / 4, hoodWorldMatrixMaxDelta: worldDelta, hoodLocalMatrixUnchanged: localSame },
    candidates: S.candidates.map((c) => ({ id: c.id, point: c.point, direction: c.direction, evidence: c.evidence })), placeholder: box, webgl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
    shell: { panels: S.fc.shell.panels.length, triangles: S.fc.shell.panels.reduce((a, p) => a + p.triangles.length / 9, 0), buildMs: +S.fc.buildMs.toFixed(2) } };
  log("loaded", info);
  $("status").textContent = `${parts.length} parts · hood ${info.hoodTriangles} tri · 0° pixel diff ${diff}`;
  runCheck();
}, undefined, (err) => { $("status").textContent = "GLB not available: set CARSCOPE_IONIQ5_GLB and restart serve.mjs"; log("load-error", { message: String(err?.message ?? err) }); });

$("axis").addEventListener("change", (e) => useAxis(e.target.value));
$("angle").addEventListener("input", (e) => setAngle(Number(e.target.value)));
$("close").addEventListener("click", () => animateTo(0));
$("open").addEventListener("click", () => animateTo(Number($("target").value)));
$("reset").addEventListener("click", () => { S.tween = null; useAxis("A"); setAngle(0); useView("iso"); });
$("outline").addEventListener("change", (e) => S.outline.forEach((l) => (l.visible = e.target.checked)));
$("xray").addEventListener("change", (e) => setXray(e.target.checked));
$("placeholder").addEventListener("change", (e) => { if (S.placeholder) S.placeholder.visible = e.target.checked; $("placeholderTag").style.display = e.target.checked ? "block" : "none"; });
$("live").addEventListener("change", scheduleCheck);

/** P3-A2.1 shell controls: visibility, opacity, reserved zones, part selection. */
function setShell(opts) {
  if (!S.fc) return opts;
  if (opts.shell !== undefined) { $("shell").checked = opts.shell; S.fc.setVisible(opts.shell); scheduleCheck(); }
  if (opts.shellOpacity !== undefined) { $("shellOpacity").value = String(opts.shellOpacity); S.fc.setOpacity(opts.shellOpacity); }
  if (opts.zones !== undefined) { $("zones").checked = opts.zones; S.fc.zonesGroup.visible = opts.zones; $("placeholderTag").style.display = opts.zones || $("placeholder").checked ? "block" : "none"; }
  if (opts.part !== undefined) S.fc.select(opts.part);
  return opts;
}
$("shell").addEventListener("change", (e) => setShell({ shell: e.target.checked }));
$("shellOpacity").addEventListener("input", (e) => setShell({ shellOpacity: Number(e.target.value) }));
$("zones").addEventListener("change", (e) => setShell({ zones: e.target.checked }));
$("shellPart").addEventListener("change", (e) => setShell({ part: e.target.value || null }));
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) S.fc?.pick(e.clientX, e.clientY, renderer.domElement); });
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => useView(b.dataset.view)));
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; shiftView(); renderer.setSize(innerWidth, innerHeight); });

const frameTimes = [], renderCpu = [], gpuTimes = [];
// GPU time per frame where the driver exposes EXT_disjoint_timer_query_webgl2; otherwise not measured.
const glx = renderer.getContext(), timer = glx.getExtension("EXT_disjoint_timer_query_webgl2");
const pending = [];
let last = 0;
renderer.setAnimationLoop((now) => {
  if (last) frameTimes.push(now - last);
  if (frameTimes.length > 600) frameTimes.shift();
  last = now;
  S.tween?.(now);
  controls.update();
  const query = timer && pending.length < 4 ? glx.createQuery() : null;
  if (query) glx.beginQuery(timer.TIME_ELAPSED_EXT, query);
  const c0 = performance.now();
  renderer.render(scene, camera);
  renderCpu.push(performance.now() - c0);
  if (renderCpu.length > 600) renderCpu.shift();
  if (query) { glx.endQuery(timer.TIME_ELAPSED_EXT); pending.push(query); }
  while (pending.length && glx.getQueryParameter(pending[0], glx.QUERY_RESULT_AVAILABLE)) {
    const q0 = pending.shift();
    if (!glx.getParameter(timer.GPU_DISJOINT_EXT)) gpuTimes.push(glx.getQueryParameter(q0, glx.QUERY_RESULT) / 1e6);
    glx.deleteQuery(q0);
    if (gpuTimes.length > 600) gpuTimes.shift();
  }
});

const q = (a) => { const s = [...a].sort((x, y) => x - y); const at = (p) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; return s.length ? { n: s.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +s.at(-1).toFixed(2) } : null; };

window.__hood = {
  state: S, useView, useAxis, setAngle, animateTo, runCheck, setShell,
  /** Cost of showing or hiding the shell: setVisible + the next rendered frame (CPU side). */
  async shellToggleCost(on) {
    const t = performance.now();
    setShell({ shell: on });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { on, msToSecondFrame: +(performance.now() - t).toFixed(1), lastRenderCpuMs: +renderCpu.at(-1).toFixed(2), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
  set: (opts) => { if (opts.outline !== undefined) { $("outline").checked = opts.outline; $("outline").dispatchEvent(new Event("change")); } if (opts.xray !== undefined) { $("xray").checked = opts.xray; $("xray").dispatchEvent(new Event("change")); } if (opts.placeholder !== undefined) { $("placeholder").checked = opts.placeholder; $("placeholder").dispatchEvent(new Event("change")); } return opts; },
  /** Browser pivot against the Node rotation (hood.mjs rotatePoints): max vertex difference in cm. */
  compareWithNode(deg) {
    setAngle(deg);
    S.group.parent.updateMatrixWorld(true);
    const now = carTriangles(S.hood, new Set([H.HOOD_NODE]))[0].triangles, ref = H.rotatePoints(S.closedCar, S.axis, deg);
    let d = 0;
    for (let i = 0; i < ref.length; i++) d = Math.max(d, Math.abs(ref[i] - now[i]));
    return { deg, axis: S.axis.id, maxVertexDeltaCm: d };
  },
  /** Frame intervals while the hood opens and closes continuously (requestAnimationFrame). */
  async perf(cycles = 2) {
    frameTimes.length = 0; renderCpu.length = 0; gpuTimes.length = 0;
    const t = performance.now(), info0 = { ...renderer.info.render };
    for (let i = 0; i < cycles; i++) { await animateTo(45, 1400); await animateTo(0, 1400); }
    const r = { cycles, wallMs: Math.round(performance.now() - t), frameMs: q(frameTimes), renderCpuMs: q(renderCpu), gpuMs: timer ? q(gpuTimes) : "NOT_AVAILABLE (no EXT_disjoint_timer_query_webgl2)",
      drawCalls: renderer.info.render.calls, trianglesPerFrame: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height], shell: Boolean(S.fc?.group.visible), info0 };
    log("perf", r);
    return r;
  },
  /** Load model-derived SVG frames from the external folder: fetch, parse and first paint as <img>. */
  async svgTiming(names, base = "./external/p3-a1/svg/") {
    const rows = [];
    for (const name of names) {
      const t0 = performance.now();
      const text = await (await fetch(`${base}${name}`)).text();
      const t1 = performance.now();
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      await img.decode();
      const t2 = performance.now();
      const c = document.createElement("canvas"); c.width = 1280; c.height = 660;
      c.getContext("2d").drawImage(img, 0, 0, 1280, 660);
      const t3 = performance.now();
      rows.push({ name, bytes: text.length, fetchMs: +(t1 - t0).toFixed(1), decodeMs: +(t2 - t1).toFixed(1), drawMs: +(t3 - t2).toFixed(1) });
    }
    log("svg-timing", { rows });
    return rows;
  },
  /** WebM of the canvas while the hood opens and closes (MediaRecorder), as base64. */
  async record(target = 45, ms = 1600) {
    const stream = renderer.domElement.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 4e6 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(100);
    await new Promise((r) => setTimeout(r, 400));
    await animateTo(target, ms); await new Promise((r) => setTimeout(r, 600)); await animateTo(0, ms); await new Promise((r) => setTimeout(r, 400));
    rec.stop(); await stopped;
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { bytes: buf.length, base64: btoa(s) };
  },
};
