// CarScope P3-A4: product-style inspection flow on the IONIQ 5 reference model.
// Home -> inspection overview (hood highlighted) -> hood opens about axis A -> washer cap -> detail -> QR.
// Flow state lives in inspection-flow.mjs; this file only renders the state it is in. Geometry comes
// from the same builders as the debug page (ioniq5-hood.html), which stays the engineering view.
// The GLB is served from CARSCOPE_IONIQ5_GLB (never the repo); the QR origin from CARSCOPE_QR_AR_BASE_URL.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as H from "./ioniq5-asset/hood.mjs";
import { buildFrontCompartment, measureHoodSurface } from "./ioniq5-asset/front-compartment.mjs";
import { buildFrunk } from "./ioniq5-asset/frunk.mjs";
import { buildServiceComponents, SERVICE_MANUAL } from "./ioniq5-asset/service-components.mjs";
import { buildInspectionComponents } from "./ioniq5-asset/inspection-components.mjs";
import { componentDistance, boxDistance } from "./inspection-camera.mjs";
import { TIRES, detachedTireInfo } from "./inspection-tires.mjs";
import { resolveTireTargets, tireCameraDirection } from "./tire-targets.mjs";
import { STATES, EVENTS, INSPECTION_AREAS, initialState, transition, hoodTarget, cameraGoal, areaOf, HOOD_OPEN_DEG } from "./inspection-flow.mjs";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const ACCENT = 0x3ec6e0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ms = (v) => (reducedMotion ? 1 : v);
window.__inspectLog = [];
const log = (tag, data = {}) => { window.__inspectLog.push({ tag, t: Math.round(performance.now()), ...data }); };

// ---------- renderer and stage ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has("capture") });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x0e1013);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$("view").appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x1a1c20, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(4, 6, -3);
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 96), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(3.15, 3.18, 128), new THREE.MeshBasicMaterial({ color: 0x2a2f37 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
scene.add(ring);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 1.3, maxDistance: 11, maxPolarAngle: Math.PI * 0.48 });

// glTF (m, Y up) <-> CarScope (cm, +X forward, +Y left, +Z up); same map as profile.mjs gltfToCarCm.
const toCar = (v) => [v.x * 100, -v.z * 100, v.y * 100];
const toGltf = ([x, y, z]) => new THREE.Vector3(x / 100, z / 100, -y / 100);
const toGltfDir = ([x, y, z]) => new THREE.Vector3(x, z, -y).normalize();
const toGltfPositions = (T) => { const a = new Float32Array(T.length); for (let i = 0; i < T.length; i += 3) { a[i] = T[i] / 100; a[i + 1] = T[i + 2] / 100; a[i + 2] = -T[i + 1] / 100; } return a; };

const VIEWS = {
  home: [new THREE.Vector3(0, 0.7, 0), [0.75, 0.42, -0.85], 7.4],
  overview: [new THREE.Vector3(0.7, 0.75, 0), [1, 0.62, -0.5], 6.0],
  bay: [toGltf([150, 0, 62]), [1.0, 1.35, -0.3], 3.4],
  washer: [toGltf([135, -40, 84]), [0.9, 1.9, 0.75], 2.5],
  tires: [toGltf([0, 0, 52]), [0.22, 0.25, -1], 6.5],
};

// ---------- model state ----------
const M = { hood: null, group: null, pivot: null, axis: null, hoodMeshes: [], outline: [], bay: new THREE.Group(), cap: null, washerMeshes: [], components: new Map(), tires: new Map(), angle: 0 };
const targetMeshes = id => M.components.get(id) ?? M.tires.get(id)?.meshes;
function* targetGroups() { yield* M.components; for (const [id, t] of M.tires) yield [id, t.meshes]; }
M.bay.name = "__p3a4_bay"; M.bay.visible = false; scene.add(M.bay);

function hoodTriangles(root) {
  const out = [], v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.synthetic) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index.array;
    for (let i = 0; i < idx.length; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(o.matrixWorld); out.push(...toCar(v)); }
  });
  return Float64Array.from(out);
}

function outlineOf(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index.array, T = new Float64Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { T[3 * i] = pos.getX(idx[i]); T[3 * i + 1] = pos.getY(idx[i]); T[3 * i + 2] = pos.getZ(idx[i]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(H.boundaryEdges(T).flatMap(([a, b]) => [...a, ...b]), 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthTest: false }));
  lines.renderOrder = 10; lines.visible = false; lines.userData.synthetic = true;
  mesh.add(lines);
  return lines;
}

function meshFrom(T, material, name, userData) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(toGltfPositions(T), 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name; mesh.userData = { synthetic: true, ...userData };
  M.bay.add(mesh);
  return mesh;
}

/** Hood pose: rotation about axis A (P3-A1). Identity at 0° so the closed car is the source pose. */
function setHoodAngle(deg) {
  M.angle = Math.max(0, Math.min(HOOD_OPEN_DEG, deg));
  if (M.angle === 0) M.pivot.matrix.identity();
  else {
    const G = M.group.matrixWorld, p = toGltf(M.axis.point), d = toGltfDir(M.axis.direction);
    const R = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(d, (M.angle * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    M.pivot.matrix.copy(G.clone().invert().multiply(R).multiply(G));
  }
  M.pivot.matrixWorldNeedsUpdate = true;
  M.bay.visible = M.angle > 0.5;
}

function buildBay(bodyMaterial, closedHood) {
  const shell = buildFrontCompartment({ hoodSurface: measureHoodSurface(closedHood) });
  const plastic = { trim: 0x2b2e33, doorInner: 0x4b5058 };
  for (const p of shell.panels) {
    const mat = p.palettes[0] === "paint" && bodyMaterial ? bodyMaterial.clone() : new THREE.MeshStandardMaterial({ color: plastic[p.palettes[0]] ?? 0x3a3e44, roughness: 0.85 });
    mat.side = THREE.DoubleSide;
    meshFrom(p.triangles, mat, p.id, { shellPart: true });
  }
  // Frunk shown closed: the cover is not part of this flow.
  for (const p of buildFrunk(shell).parts) meshFrom(p.triangles, new THREE.MeshStandardMaterial({ color: p.id === "frunk-lever" ? 0x65717c : p.moving ? 0x292e34 : 0x48515a, roughness: 0.88 }), p.id, { frunkPart: true });
  for (const p of buildServiceComponents(shell).parts) {
    const mesh = meshFrom(p.triangles, new THREE.MeshStandardMaterial({ color: p.id === "washer-fluid-cap" ? 0x247dbc : 0xc8d3d7, roughness: 0.6 }), p.id, { washer: true, meta: p.meta });
    M.washerMeshes.push(mesh);
    mesh.userData.inspectionTarget = 'washer-fluid-cap';
    if (p.id === "washer-fluid-cap") M.cap = mesh;
  }
  M.components.set('washer-fluid-cap', M.washerMeshes);
  for (const p of buildInspectionComponents(shell).parts) {
    const target = p.meta.inspectionTarget;
    const mesh = meshFrom(p.triangles, new THREE.MeshStandardMaterial({ color: p.palettes[0] === 'paint' ? 0xc4bca9 : p.palettes[0] === 'trim' ? 0x30353c : 0x59616b, roughness: 0.78 }), p.id, { inspectionTarget: target, meta: p.meta });
    if (!M.components.has(target)) M.components.set(target, []);
    M.components.get(target).push(mesh);
  }
}

// ---------- flow ----------
let state = initialState();
let handoff = { configured: false, url: null, reason: "loading" };
fetch("./inspection-handoff.json").then((r) => (r.ok ? r.json() : null)).then((h) => { if (h) handoff = h; render(); }).catch(() => {});

function dispatch(event) {
  const prev = state, next = transition(state, event, { handoffConfigured: handoff.configured });
  if (next === prev) { log("ignored", { state: prev.name, event: event.type }); return false; }
  state = next;
  log("transition", { from: prev.name, to: next.name, event: event.type });
  enter(prev);
  return true;
}

// Hood and camera are target-driven tweens: a new target restarts from the current pose, so a
// cancel or a repeated click never jumps, and completion is reported back as a flow event.
let hoodTween = null, camTween = null, selectionView = null;
function driveHood(target) {
  if (hoodTween?.to === target) return;
  // Already there: settled states need nothing; the opening/closing states still finish through the
  // loop so the flow always receives HOOD_OPENED/HOOD_CLOSED.
  if (!hoodTween && M.angle === target && state.name !== STATES.HOOD_OPENING && state.name !== STATES.HOOD_CLOSING) return;
  const dist = Math.abs(target - M.angle);
  hoodTween = { from: M.angle, to: target, t0: performance.now(), dur: ms(Math.max(300, 1500 * dist / HOOD_OPEN_DEG)) };
}
// The views are framed for a landscape area; step back when the space beside or above the panel is narrow.
// Space the panel takes: a side column (wide or landscape) or a bottom sheet (narrow portrait).
function panelBox() {
  if (state.name === STATES.IDLE) return { side: 0, bottom: 0 };
  const p = $("panel"), w = p.offsetWidth + 18;
  return w < innerWidth * 0.7 ? { side: w, bottom: 0 } : { side: 0, bottom: Math.min(innerHeight * 0.46, p.offsetHeight) };
}
function fitScale() {
  const b = panelBox();
  return Math.max(1, 1.25 / ((innerWidth - b.side) / Math.max(1, innerHeight - b.bottom)));
}
function driveCamera(name, dur = 1100) {
  log('camera-target', { name, state: state.name });
  const meshes = targetMeshes(name);
  let target, dir, dist;
  if (name === 'tires') {
    const bounds = new THREE.Box3();
    for (const t of M.tires.values()) bounds.union(t.bounds);
    target = bounds.getCenter(new THREE.Vector3()); dir = VIEWS.tires[1];
    dist = boxDistance(bounds.getSize(new THREE.Vector3()).toArray(), dir, camera.fov, innerWidth, innerHeight, panelBox());
  } else if (meshes && name !== 'washer-fluid-cap') {
    const bounds = componentBounds(name), size = bounds.getSize(new THREE.Vector3());
    target = bounds.getCenter(new THREE.Vector3());
    dir = M.tires.has(name) ? tireCameraDirection(name) : [1.2, 2.8, Math.sign(target.z) * 0.55];
    dist = componentDistance(size.toArray(), camera.fov, innerWidth, innerHeight, panelBox());
  } else [target, dir, dist] = VIEWS[name];
  controls.minDistance = meshes ? 0.55 : 1.3;
  controls.maxDistance = name === 'tires' ? Math.max(11, dist) : 11;
  camTween = { name, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toTarget: target.clone(), toPos: target.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(dist * (meshes || name === 'tires' ? 1 : fitScale()))), t0: performance.now(), dur: ms(dur) };
  controls.enabled = false;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function enter(prev) {
  clearTimeout(refit);
  // Flush OrbitControls inertia without changing the current pose before a scripted move.
  const position = camera.position.clone(), target = controls.target.clone(), damping = controls.enableDamping;
  controls.enableDamping = false; controls.update();
  camera.position.copy(position); controls.target.copy(target); controls.update(); controls.enableDamping = damping;
  if ((prev.name === STATES.COMPONENT_SELECTION && [STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED].includes(state.name))
    || ([STATES.TIRE_SELECTION, STATES.INSPECTION_OVERVIEW].includes(prev.name) && state.name === STATES.TIRE_PREVIEW)) {
    selectionView = { position: camera.position.clone(), target: controls.target.clone(), scroll: $('panel').scrollTop, component: state.component, width: innerWidth, height: innerHeight, maxDistance: controls.maxDistance, goal: state.area === 'tires' ? 'tires' : 'bay' };
  }
  if (selectionView && state.component) selectionView.component = state.component;
  document.body.dataset.state = state.name;
  hovered = false;
  driveHood(hoodTarget(state));
  render();
  if ([STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED, STATES.TIRE_PREVIEW].includes(state.name)) {
    $('panel').scrollTop = 0;
    const title = $('panel').querySelector('h2');
    title.tabIndex = -1; title.focus({ preventScroll: true });
  }
  layout();
  if ([STATES.COMPONENT_SELECTION, STATES.TIRE_SELECTION].includes(state.name) && selectionView) {
    controls.minDistance = 1.3;
    const saved = selectionView;
    controls.maxDistance = saved.maxDistance;
    log('camera-restore', { position: saved.position.toArray(), width: innerWidth, height: innerHeight, savedWidth: saved.width, savedHeight: saved.height });
    if (saved.width === innerWidth && saved.height === innerHeight) {
      camTween = { name: saved.goal, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: saved.position.clone(), toTarget: saved.target.clone(), t0: performance.now(), dur: ms(700) }; controls.enabled = false;
    } else driveCamera(saved.goal);
    $('panel').scrollTop = saved.scroll;
    $('panel').querySelector(`[data-id="${saved.component}"]`)?.focus({ preventScroll: true });
  } else if (cameraGoal(state) !== cameraGoal(prev) || state.name === STATES.IDLE) driveCamera(cameraGoal(state));
  if ([STATES.HOOD_CLOSING, STATES.IDLE, STATES.INSPECTION_OVERVIEW].includes(state.name)) selectionView = null;
}

function componentBounds(id) {
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3();
  for (const mesh of targetMeshes(id) ?? []) b.expandByObject(mesh, true);
  return b;
}

// ---------- panel ----------
const crumbs = { IDLE: "", INSPECTION_OVERVIEW: "차량 점검", HOOD_OPENING: "차량 점검 › 보닛", HOOD_CLOSING: "차량 점검", COMPONENT_SELECTION: "차량 점검 › 보닛", WASHER_SELECTED: "차량 점검 › 보닛 › 워셔액", MOBILE_HANDOFF_READY: "차량 점검 › 보닛 › 워셔액" };
const hints = { INSPECTION_OVERVIEW: "강조된 보닛을 선택하세요", COMPONENT_SELECTION: "모델의 부품이나 목록을 선택하세요" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const item = (x, action) => ['available', 'preview'].includes(x.status)
  ? `<li><button type="button" class="item available ${x.status === 'preview' ? 'preview' : ''}" aria-pressed="${state.component === x.id}" data-action="${action}" data-id="${x.id}">${esc(x.label)}<span class="tag">${x.status === 'preview' || x.id === 'tires' ? '형상 보기' : '점검 가능'}</span></button></li>`
  : `<li><div class="item" aria-disabled="true">${esc(x.label)}<span class="tag">준비 중</span></div></li>`;

function panelHtml() {
  const S = STATES;
  switch (state.name) {
    case S.TIRE_SELECTION:
      return `<div class="eyebrow">타이어 · 형상 탐색</div><h2>타이어 선택</h2><p>모델의 타이어·휠 또는 아래 목록을 선택하세요. 좌우는 차량 진행 방향 기준입니다.</p>
        <ul class="items">${TIRES.map(t => item(t, 'tire')).join('')}</ul>
        <p class="note">API 데이터 미연동 · 공기압 및 차량 상태를 표시하지 않습니다.</p>
        <div class="actions"><button type="button" class="secondary" data-action="back">점검 부위로</button><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    case S.TIRE_PREVIEW: {
      const t = detachedTireInfo(state.component);
      return `<div class="eyebrow">타이어 · 형상 탐색</div><h2>${esc(t.label)}</h2><span class="badge detached">데이터 미연동</span>
        <dl class="tire-status"><dt>타이어 위치</dt><dd>${esc(t.label)} · 차량 진행 방향 기준</dd><dt>차량 부품 ID</dt><dd>${esc(t.vehiclePartId)}</dd>
        <dt>데이터 출처</dt><dd>없음 · 미연동</dd><dt>API 지원 상태</dt><dd>${t.capabilityStatus} · 실제 지원 미검증</dd>
        <dt>데이터 가용 상태</dt><dd>${t.availabilityStatus} · 미수신</dd><dt>최종 관측 시각</dt><dd>없음</dd></dl>
        <p class="note">커뮤니티 GLB의 기존 타이어 형상입니다. 실차 형상 정확도와 API 값·단위는 미검증이며 공기압 및 정상·비정상을 판단하지 않습니다.</p>
        <h3>다른 타이어 보기</h3><ul class="items">${TIRES.map(t => item(t, 'tire')).join('')}</ul>
        <div class="actions"><button type="button" class="secondary" data-action="back">선택 해제 · 이전 시점으로</button><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    }
    case S.INSPECTION_OVERVIEW: case S.HOOD_CLOSING:
      return `<div class="eyebrow">차량 점검</div><h2>점검할 부위를 선택하세요</h2><p>3D 모델의 강조된 부위나 아래 목록에서 선택합니다.</p>
        <ul class="items">${INSPECTION_AREAS.map((a) => item(a, "area")).join("")}</ul>
        <div class="actions"><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    case S.HOOD_OPENING:
      return `<div class="eyebrow">보닛</div><h2>보닛을 여는 중</h2><p>차량 전방으로 이동합니다.</p><div class="progress"><i id="hoodProgress"></i></div>
        <div class="actions"><button type="button" class="secondary" data-action="back">취소</button></div>`;
    case S.COMPONENT_SELECTION:
      return `<div class="eyebrow">보닛 · 전방 수납부</div><h2>점검 항목</h2><p>모델의 부품이나 목록에서 고르세요. 워셔액 외 항목은 추정 형상만 탐색할 수 있습니다.</p>
        <ul class="items">${areaOf(state).components.map((c) => item(c, "component")).join("")}</ul>
        <p class="note">밝은 베이지색 리저버와 무광 케이스는 추정 부품 모델입니다. 저전도 냉각수는 형상과 안내가 준비 중입니다.</p>
        <div class="actions"><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    case S.COMPONENT_PREVIEW: {
      const c = areaOf(state).components.find(c => c.id === state.component);
      return `<div class="eyebrow">보닛 · 형상 탐색</div><h2>${esc(c.label)}</h2><span class="badge">추정 모델 · 점검 절차 미제공</span>
        <ul class="accuracy"><li>모델 위치: 추정</li><li>형상 및 치수: 추정</li><li>실제 차량별 배치: 미검증</li><li>점검 및 정비 절차: 아직 제공하지 않음</li></ul>
        <h3>모델에서의 위치 안내</h3><p>${esc(c.location)}에 배치한 추정 형상입니다. 좌우는 운전자가 전방을 보는 기준입니다.</p>
        <p>형상과 배치를 살펴보는 화면입니다. 실제 차량의 정확한 위치나 상태를 나타내지 않습니다.</p>
        <h3>다른 항목 보기</h3><ul class="items">${areaOf(state).components.map(c => item(c, 'component')).join('')}</ul>
        <div class="actions"><button type="button" class="secondary" data-action="back">점검 목록과 이전 시점으로</button><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    }
    case S.WASHER_SELECTED:
      return `<div class="eyebrow">보닛 · 워셔액</div><h2>워셔액 점검</h2><span class="badge">위치·형상 추정</span>
        <h3>점검 방법</h3><ol><li>평탄한 곳에 정차하고 차량 전원을 끕니다.</li><li>보닛을 열고 워셔 기호가 표시된 캡을 찾습니다.</li><li>캡을 열어 워셔액 양을 확인합니다.</li><li>부족하면 차량·기후에 맞는 워셔액을 보충하고 캡을 닫습니다.</li></ol>
        <h3>주의</h3><ul><li>냉각계용 냉각수나 부동액을 넣지 마세요.</li><li>캡 표기를 확인해 다른 리저버와 혼동하지 마세요.</li><li>이 화면의 위치와 형상은 추정입니다. 실제 차량의 표기와 사용설명서를 우선하세요.</li></ul>
        <h3>출처</h3><p><a class="link" href="${esc(SERVICE_MANUAL)}" target="_blank" rel="noopener noreferrer">Hyundai IONIQ 5 (2022, UK) 정비 설명서 9-14 워셔액</a></p>
        <div class="actions">${handoff.configured
          ? `<button type="button" class="primary" data-action="handoff">스마트폰으로 이어서 보기</button>`
          : `<p class="note">스마트폰 연결 주소가 설정되지 않았습니다 (CARSCOPE_QR_AR_BASE_URL).</p>`}
          <button type="button" class="secondary" data-action="back">점검 항목으로</button></div>`;
    case S.MOBILE_HANDOFF_READY:
      return `<div class="eyebrow">보닛 · 워셔액</div><h2>스마트폰으로 이어서 보기</h2><p>스마트폰 카메라로 QR을 스캔하면 워셔액 점검 보조 화면이 열립니다.</p>
        <div class="qr"><img src="./inspection-qr.svg" alt="워셔액 점검 보조 화면으로 연결되는 QR 코드"></div>
        <p><a class="link" id="handoffLink" href="${esc(handoff.url)}" target="_blank" rel="noopener noreferrer">직접 열기</a></p>
        <p class="note">QR에는 작업 종류만 담기며 차량·계정 정보는 포함되지 않습니다. 스마트폰 화면의 후보 표시는 색상 기반이며 실제 주입구 인식 정확도는 검증되지 않았습니다.</p>
        <div class="actions"><button type="button" class="secondary" data-action="back">점검 방법으로</button><button type="button" class="secondary" data-action="exit">점검 종료</button></div>`;
    default:
      return "";
  }
}

let toastTimer = null;
function render() {
  $("panel").innerHTML = panelHtml();
  $("crumb").textContent = state.area === 'tires' ? `차량 점검 › 타이어${state.component ? ' › ' + detachedTireInfo(state.component).label : ''}` : state.name === STATES.COMPONENT_PREVIEW ? `차량 점검 › 보닛 › ${areaOf(state).components.find(c => c.id === state.component).label}` : crumbs[state.name];
  const hint = hints[state.name];
  clearTimeout(toastTimer);
  $("toast").textContent = hint ?? "";
  $("toast").classList.toggle("on", Boolean(hint));
  if (hint) toastTimer = setTimeout(() => $("toast").classList.remove("on"), 4000);
}

$("panel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  if (a === "area") dispatch({ type: EVENTS.SELECT_AREA, id: b.dataset.id });
  else if (a === "component") dispatch({ type: EVENTS.SELECT_COMPONENT, id: b.dataset.id });
  else if (a === "tire") dispatch({ type: EVENTS.SELECT_TIRE, id: b.dataset.id });
  else if (a === "handoff") dispatch({ type: EVENTS.REQUEST_HANDOFF });
  else if (a === "back") dispatch({ type: EVENTS.BACK });
  else if (a === "exit") dispatch({ type: EVENTS.EXIT });
});
$("start").addEventListener("click", () => dispatch({ type: EVENTS.START }));
$("back").addEventListener("click", () => dispatch({ type: EVENTS.BACK }));
$("capButton").addEventListener("click", () => dispatch({ type: EVENTS.SELECT_COMPONENT, id: "washer-fluid-cap" }));
addEventListener("keydown", (e) => {
  if (e.key === "Escape") dispatch({ type: EVENTS.BACK });
  if (e.key === "`") $("dev").hidden = !$("dev").hidden;
});

// ---------- picking ----------
const ray = new THREE.Raycaster();
function hitAt(x, y) {
  const r = renderer.domElement.getBoundingClientRect();
  camera.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  // Everything visible occludes: a closed hood hides the cap, the body hides the far side.
  const hit = ray.intersectObjects(scene.children, true).find((h) => { if (!h.object.isMesh) return false; for (let n = h.object; n; n = n.parent) if (!n.visible) return false; return true; });
  if (!hit) return null;
  if (hit.object.userData.inspectionTire) return { kind: 'tire', id: hit.object.userData.inspectionTire };
  if (hit.object.userData.isHood) return { kind: "hood" };
  if (hit.object.userData.washer) return { kind: "washer" };
  if (hit.object.userData.inspectionTarget) return { kind: 'component', id: hit.object.userData.inspectionTarget };
  return { kind: "other" };
}
function pickTarget(x, y) {
  const h = hitAt(x, y);
  if ([STATES.INSPECTION_OVERVIEW, STATES.TIRE_SELECTION, STATES.TIRE_PREVIEW].includes(state.name) && h?.kind === 'tire') return { type: EVENTS.SELECT_TIRE, id: h.id };
  if (state.name === STATES.INSPECTION_OVERVIEW && h?.kind === "hood") return { type: EVENTS.SELECT_AREA, id: "hood" };
  if ([STATES.COMPONENT_SELECTION, STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED].includes(state.name)) {
    if (h?.kind === 'washer') return { type: EVENTS.SELECT_COMPONENT, id: 'washer-fluid-cap' };
    if (h?.kind === 'component') return { type: EVENTS.SELECT_COMPONENT, id: h.id };
  }
  return null;
}
let downAt = null, hovered = false;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) { const ev = pickTarget(e.clientX, e.clientY); if (ev) dispatch(ev); }
  downAt = null;
});
renderer.domElement.addEventListener('pointercancel', () => { downAt = null; });
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.buttons || !M.pivot) return;
  hovered = Boolean(pickTarget(e.clientX, e.clientY));
  renderer.domElement.style.cursor = hovered ? "pointer" : "";
});

// ---------- layout: keep the car centred in the space the panel leaves ----------
function layout() {
  const w = innerWidth, h = innerHeight, b = panelBox();
  camera.aspect = w / h;
  if (!b.side && !b.bottom) camera.clearViewOffset();
  else camera.setViewOffset(w, h, b.side / 2, b.bottom / 2, w, h);
  camera.updateProjectionMatrix();
}
let refit = null, framedViewport = [innerWidth, innerHeight];
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  layout();
  // Retarget from the current pose after a resize, including a move already in progress.
  clearTimeout(refit);
  refit = setTimeout(() => {
    // Mobile Chrome can emit transient resize events while capturing beyond the viewport.
    // Only a persistent size change warrants replacing a saved view or an active camera goal.
    if (framedViewport[0] === innerWidth && framedViewport[1] === innerHeight) return;
    framedViewport = [innerWidth, innerHeight];
    driveCamera(cameraGoal(state), 450);
  }, 180);
});

// ---------- highlight and label ----------
const _v = new THREE.Vector3();
function screenPoint(obj, top = true) {
  obj.geometry.computeBoundingBox();
  const b = obj.geometry.boundingBox;
  b.getCenter(_v); if (top) _v.y = b.max.y;
  _v.applyMatrix4(obj.matrixWorld).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((_v.x + 1) * r.width) / 2, y: r.top + ((1 - _v.y) * r.height) / 2, inFront: _v.z < 1 };
}
function paintHighlight(now) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 380);
  const hoodOn = state.name === STATES.INSPECTION_OVERVIEW;
  for (const m of M.hoodMeshes) { m.material.emissive.setHex(hoodOn ? ACCENT : 0); m.material.emissiveIntensity = hoodOn ? 0.12 + 0.18 * pulse + (hovered ? 0.2 : 0) : 0; }
  for (const l of M.outline) l.visible = hoodOn;
  const capOn = [STATES.COMPONENT_SELECTION, STATES.WASHER_SELECTED, STATES.MOBILE_HANDOFF_READY].includes(state.name);
  for (const [id, meshes] of targetGroups()) for (const m of meshes) {
    const selected = state.component === id;
    const washerHint = id === 'washer-fluid-cap' && capOn && m === M.cap;
    m.material.emissive.setHex(selected || washerHint ? ACCENT : 0);
    m.material.emissiveIntensity = selected ? 0.6 : washerHint ? 0.25 + 0.45 * pulse : 0;
  }
  const label = $("capLabel");
  if (capOn && M.cap && M.bay.visible) {
    const p = screenPoint(M.cap);
    const off = !p.inFront || p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight;
    if (off) label.dataset.hidden = ""; else { delete label.dataset.hidden; label.style.left = `${p.x}px`; label.style.top = `${p.y}px`; }
  } else label.dataset.hidden = "";
}

// ---------- frame loop ----------
renderer.setAnimationLoop((now) => {
  if (hoodTween && M.pivot) {
    const t = Math.min(1, (now - hoodTween.t0) / hoodTween.dur);
    setHoodAngle(hoodTween.from + (hoodTween.to - hoodTween.from) * ease(t));
    const bar = $("hoodProgress"); if (bar) bar.style.width = `${(100 * M.angle) / HOOD_OPEN_DEG}%`;
    if (t >= 1) { const to = hoodTween.to; hoodTween = null; setHoodAngle(to); dispatch({ type: to > 0 ? EVENTS.HOOD_OPENED : EVENTS.HOOD_CLOSED }); }
  }
  if (camTween) {
    const t = Math.min(1, (now - camTween.t0) / camTween.dur), e = ease(t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    if (t >= 1) { camTween = null; controls.enabled = true; }
  }
  // Damping keeps easing after a drag; skip it during a scripted move so it cannot fight the tween.
  if (!camTween) controls.update(); else camera.lookAt(controls.target);
  if (M.pivot) paintHighlight(now);
  renderer.render(scene, camera);
  if (!$("dev").hidden && now - devAt > 250) devRender(now);
});

// ---------- developer panel (hidden; ?dev=1 or the ` key) ----------
let devAt = 0;
function devRender(now) {
  devAt = now;
  const c = camera.position;
  $("dev").innerHTML = `<b>DEV</b> · <a href="./ioniq5-hood.html">engineering view</a>\nstate   ${state.name}${state.afterClose ? ` → ${state.afterClose}` : ""}\nhood    ${M.angle.toFixed(1)}° / target ${hoodTarget(state)}°\naxis    ${M.axis?.id ?? "-"} (${M.axis?.evidence ?? "-"}) SIMULATION_ONLY\ncamera  ${cameraGoal(state)}${camTween ? " (moving)" : ""} [${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}]\nhandoff ${handoff.configured ? "configured" : `off: ${handoff.reason}`}\nlast    ${window.__inspectLog.slice(-3).map((l) => `${l.tag}:${l.event ?? ""}`).join(" ")}`;
}
if (params.get("dev") === "1") $("dev").hidden = false;

// ---------- load ----------
camera.position.copy(VIEWS.home[0]).add(new THREE.Vector3(...VIEWS.home[1]).normalize().multiplyScalar(VIEWS.home[2] * fitScale()));
controls.target.copy(VIEWS.home[0]);
controls.update();
new GLTFLoader().load(params.get("model") ?? "./external/ioniq5.glb", (gltf) => {
  scene.add(gltf.scene);
  const meshNodes = new Set(gltf.parser.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  let bodyMaterial = null;
  gltf.scene.traverse((o) => { if (!o.isMesh) return; o.material = o.material.clone(); const part = meshNodes.has(o.name) ? o.name : o.parent.name; if (part === "Body" && o.material.name === "Body") bodyMaterial = o.material; });
  try { M.tires = resolveTireTargets(gltf.scene); }
  catch (error) {
    $('status').textContent = '타이어의 좌표·형상 매핑을 검증할 수 없습니다. 참조 GLB를 확인하세요.';
    log('load-error', { message: String(error) });
    return;
  }
  for (const [id, t] of M.tires) for (const mesh of t.pickMeshes) mesh.userData.inspectionTire = id;
  M.hood = gltf.scene.getObjectByName(H.HOOD_NODE);
  M.group = gltf.scene.getObjectByName(H.HOOD_GROUP);
  gltf.scene.updateMatrixWorld(true);
  const closed = hoodTriangles(M.hood);
  const G = M.group.matrixWorld, origin = new THREE.Vector3().setFromMatrixPosition(G);
  const lateral = toCar(new THREE.Vector3(0, 1, 0).transformDirection(G)).map((v) => v / 100);
  M.axis = H.axisCandidates({ hoodTriangles: closed, groupOriginCm: toCar(origin), groupLateralCm: lateral }).candidates.find((c) => c.id === "A");
  // Pivot between the group and the untouched hood node; identity at 0°, as in the P3-A1 page.
  M.pivot = new THREE.Object3D();
  M.pivot.name = "__p3a4_hood_pivot";
  M.pivot.matrixAutoUpdate = false;
  M.group.add(M.pivot);
  M.pivot.add(M.hood);
  M.hood.traverse((o) => { if (o.isMesh && !o.userData.synthetic) { o.userData.isHood = true; M.hoodMeshes.push(o); M.outline.push(outlineOf(o)); } });
  buildBay(bodyMaterial, closed);
  setHoodAngle(0);
  $("status").remove();
  $("start").disabled = false;
  window.__inspectReady = true;
  log("loaded", { axis: M.axis.id, hoodMeshes: M.hoodMeshes.length, bayMeshes: M.bay.children.length });
}, undefined, (err) => {
  $("status").textContent = "차량 모델을 불러올 수 없습니다. CARSCOPE_IONIQ5_GLB를 설정하고 서버를 다시 시작하세요.";
  log("load-error", { message: String(err?.message ?? err) });
});

/** Dolly toward/away from the orbit target (for hosts without wheel or pinch input, e.g. the Android AVD). */
function zoom(factor) {
  if (camTween) return null;
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(offset);
  controls.update();
  log("zoom", { factor, distance: +offset.length().toFixed(3) });
  return offset.length();
}

let disposed = false;
/** Release GPU resources. Hosts that tear the page down quickly (the Pleos home) call this before closing. */
function dispose(reason) {
  if (disposed) return null;
  disposed = true;
  renderer.setAnimationLoop(null);
  controls.dispose();
  const before = { ...renderer.info.memory }, seen = new Set();
  let geometries = 0, materials = 0;
  scene.traverse((o) => {
    if (o.geometry) { o.geometry.dispose(); geometries++; }
    for (const m of [].concat(o.material ?? [])) if (!seen.has(m)) { seen.add(m); m.dispose(); materials++; }
  });
  scene.environment?.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  const out = { reason, geometries, materials, before, after: { ...renderer.info.memory } };
  log("disposed", out);
  return out;
}

// Test and developer hooks (no vehicle control here: a visual flow only).
window.__inspect = {
  get state() { return state; },
  dispatch,
  get hoodAngle() { return M.angle; },
  get busy() { return Boolean(hoodTween || camTween); },
  get handoff() { return handoff; },
  hoodPoint: () => screenPoint(M.hoodMeshes[0], false),
  capPoint: () => screenPoint(M.cap),
  hitAt,
  componentPoint: (id) => { const v = componentBounds(id).getCenter(new THREE.Vector3()).project(camera); return { x: (v.x+1)*innerWidth/2, y: (1-v.y)*innerHeight/2, inFront: v.z<1 }; },
  componentInfo: () => [...M.components].map(([id, meshes]) => ({ id, meshes: meshes.map(m => ({ id: m.name, target: m.userData.inspectionTarget, highlighted: m.material.emissiveIntensity > 0, meta: m.userData.meta })), bounds: { min: componentBounds(id).min.toArray(), max: componentBounds(id).max.toArray() } })),
  tireInfo: () => [...M.tires].map(([id, t]) => ({ id, node: t.node, panel: detachedTireInfo(id), meshes: t.meshes.map(m => ({ name: m.name, material: m.material.name, highlighted: m.material.emissiveIntensity > 0 && m.material.emissive.getHex() !== 0 })), wheelMeshes: t.pickMeshes.map(m => ({ name: m.name, material: m.material.name, highlighted: m.material.emissiveIntensity > 0 && m.material.emissive.getHex() !== 0 })), bounds: { min: t.bounds.min.toArray(), max: t.bounds.max.toArray() } })),
  cameraPose: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
  zoom,
  view: () => ({ azimuthDeg: +THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()).toFixed(1), polarDeg: +THREE.MathUtils.radToDeg(controls.getPolarAngle()).toFixed(1), distance: +camera.position.distanceTo(controls.target).toFixed(3) }),
  dispose,
  get renderInfo() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }; },
};
