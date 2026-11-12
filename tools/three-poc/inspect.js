import {createAndroidNativeInspectionAdapter} from './android-native-inspection-adapter.mjs';
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
import { buildEvBatteryPack, EV_BATTERY_ID } from "./ioniq5-asset/ev-battery.mjs";
import { CAMERA_MOVE_MS, boxDistance, cameraPath, framingDistance, inflateBox } from "./inspection-camera.mjs";
import { createTireInspection, updateTireInspection } from "./tire-inspection.mjs";
import { inspectionStateMap } from './inspection-state-map.mjs';
import {targetForPart,targetForTask} from './mobile-result-contract.mjs';
import {partById,partLabel} from './inspection-parts.mjs';
import {createNativeInspectionResults} from './native-inspection-results.mjs';
import {projectInspectionResults} from './inspection-results.mjs';
import {partResultHtml,partActionHtml,refreshResultRegions,areaResultText,qrSlotReport,QR_SLOT_NONE} from './inspection-results-view.mjs';
import {createToast,createMobileRequestNotifier} from './inspection-toast.mjs';
import {createInspectionHistoryStore} from './inspection-history-store.mjs';
import {EMPTY_HISTORY_FILTERS} from './inspection-history-contract.mjs';
import {historyPanelHtml,historyListResultsHtml,historyDetailResultsHtml,historyFilterHtml,historyFilterSummaryText,historyEntryZoneHtml} from './inspection-history-view.mjs';
import { stateBadgeHtml, stateLegendHtml } from './inspection-state-view.mjs';
import { guideHtml, summaryHtml } from "./tire-inspection-view.mjs";
import { LIGHT_SCOPE_TEXT, productSummaryHtml, sessionActions, washerGuideHtml, hoodGuideHtml, actionsHtml, sessionDataScope, exitConfirmHtml } from './inspection-product.mjs';
import { TIRES, detachedTireInfo } from "./inspection-tires.mjs";
import { tireStatus, enableTireStatus, disposeTireStatus } from "./tire-status.mjs";
import { componentStatus, componentStatusHtml, enableComponentStatus, disposeComponentStatus } from "./component-status.mjs";
import { chargePortStatus, chargePortStatusHtml, enableChargePortStatus, disposeChargePortStatus } from './ev-charge-status.mjs';
import { visibilityStatus, visibilityStatusHtml, enableVisibilityStatus, disposeVisibilityStatus } from './visibility-status.mjs';
import { WIPER_PARTS, LIGHT_PARTS, sourcePartsByNode, resolveFrontLightTargets, visibilityFeaturesForPart, nearestInspectionHit, lightSightline } from './visibility-targets.mjs';
import { measureFrontWiperSupport, buildFrontWiperGeometry } from "./ioniq5-asset/front-wiper.mjs";
import { sourceWorldParts } from './charge-port-model.mjs';
import { measureEvChargePortSupport, buildEvChargePort, EV_CHARGE_IDS } from "./ioniq5-asset/ev-charge-port.mjs";
import { resolveTireTargets, tireCameraDirection } from "./tire-targets.mjs";
import { STATES, EVENTS, INSPECTION_AREAS, initialState, transition, hoodTarget, cameraGoal, areaOf, isHistoryState, historyHeld, HOOD_OPEN_DEG } from "./inspection-flow.mjs";
import { labelPlan, layoutLabels, areaEvent, touchProbes, chooseTouch, usesTouchSlop, receiverLocked, hintTargets, selectionIntensity, SELECTION_COLOR, HINT_COLOR } from './part-labels.mjs';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// Cyan is the selection role only (part-labels.mjs). Hints use a neutral color so they never read as a selection.
const ACCENT = SELECTION_COLOR;
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
  tires: [toGltf([0, 0, 52]), [0.22, 0.25, -1], 6.5],
};

// ---------- model state ----------
const M = { hood: null, group: null, pivot: null, axis: null, hoodMeshes: [], outline: [], bay: new THREE.Group(), cap: null, washerMeshes: [], components: new Map(), tires: new Map(), angle: 0 };
const targetMeshes = id => M.components.get(id) ?? M.tires.get(id)?.meshes;
M.charge = new THREE.Group(); M.charge.name = '__charge_port_static'; M.charge.visible = false; scene.add(M.charge);
M.chargeInfo = { status: 'UNAVAILABLE', sourceMeshCount: 0, sourceUnchanged: false };
M.wipers=new THREE.Group();M.wipers.visible=false;scene.add(M.wipers);
M.wiperInfo={status:'UNAVAILABLE'};M.lights=new Map();
function* targetGroups() { yield* M.components; for (const [id, t] of M.tires) yield [id, t.meshes]; }
// Selection and hint cover what a touch selects: a tire's rubber and its wheel. The result color stays on the rubber.
function* highlightGroups() { yield* M.components; for (const [id, t] of M.tires) yield [id, [...new Set([...t.meshes, ...t.pickMeshes])]]; }
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
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: HINT_COLOR, transparent: true, opacity: 0.9, depthTest: false }));
  lines.renderOrder = 10; lines.visible = false; lines.userData.synthetic = true; lines.raycast = () => {};
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

// P10 PR #2: leaving the session (점검 종료, or Back from the overview) asks first, but only when this session holds
// something that would be lost. Every entry (panel, top bar, Escape, Android Back, test hook) passes through here.
let exitScope = null;
const leavesSession = (prev, next) => prev.name !== STATES.IDLE && !(prev.name === STATES.HOOD_CLOSING && prev.afterClose === STATES.IDLE)
  && (next.name === STATES.IDLE || next.name === STATES.HOOD_CLOSING && next.afterClose === STATES.IDLE);
function askExit(scope) {
  exitScope = scope;
  const box = $('exitConfirm');
  box.querySelector('.dialog').innerHTML = exitConfirmHtml(scope);
  box.hidden = false;
  for (const id of ['panel', 'view', 'partLabels', 'home']) $(id).inert = true;
  document.querySelector('.topbar').inert = true;
  box.querySelector('[data-action="exit-cancel"]').focus();
}
function closeExit() {
  if (!exitScope) return;
  exitScope = null;
  $('exitConfirm').hidden = true;
  for (const id of ['view', 'partLabels']) $(id).inert = false;
  document.querySelector('.topbar').inert = false;
  $('panel').inert = state.name === STATES.IDLE; $('home').inert = state.name !== STATES.IDLE;
  $('panel').querySelector('[data-action="exit"]')?.focus({ preventScroll: true });
}
function dispatch(event) {
  if (exitScope && event.type === EVENTS.BACK) { closeExit(); log('exit-cancel', { by: 'BACK' }); return false; }
  const prev = state, next = transition(state, event, { handoffConfigured: handoff.configured, chargePortAvailable: M.chargeInfo.status === 'AVAILABLE', wipersAvailable:M.wiperInfo.status==='AVAILABLE', lightsAvailable:M.lights.size===4 });
  if (next === prev) { log("ignored", { state: prev.name, event: event.type }); return false; }
  if ([EVENTS.BACK, EVENTS.EXIT].includes(event.type) && !event.confirmed && leavesSession(prev, next)) {
    const scope = sessionDataScope(userInspection, mobileResults.snapshot);
    if (scope.any) { askExit(scope); log('exit-ask', { state: prev.name, event: event.type, ...scope }); return false; }
  }
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
// A bottom sheet's height follows its text, so framing reserves its full height: one part keeps one view on every screen.
function framingPanel() {
  const b = panelBox();
  return { side: b.side, bottom: b.bottom ? innerHeight * 0.46 : 0 };
}
const frameDistance = (size, direction, cameraClass) => framingDistance({ size, direction, cameraClass, fovDeg: camera.fov, width: innerWidth, height: innerHeight, panel: framingPanel() });
const partDirection = (name, target) => M.lights.has(name) ? M.lights.get(name).sightline.direction : Object.values(EV_CHARGE_IDS).includes(name) ? [-0.6, 0.38, 1] : name === EV_BATTERY_ID ? [0.7, -1, -0.5] : M.tires.has(name) ? tireCameraDirection(name) : [1.2, 2.8, Math.sign(target.z) * 0.55];
const groupBounds = (ids) => { scene.updateMatrixWorld(true); const b = new THREE.Box3(); for (const id of ids) b.union(componentBounds(id)); return b; };
const HOOD_MODELED = INSPECTION_AREAS.find(a => a.id === 'hood').components.filter(c => partById(c.id).cameraClass !== 'NONE').map(c => c.id);
function cameraGoalPose(name) {
  const part = partById(name);
  if (part && part.cameraClass !== 'NONE' && targetMeshes(name)?.length) {
    const bounds = componentBounds(name), target = bounds.getCenter(new THREE.Vector3()), dir = partDirection(name, target);
    return { target, dir, dist: frameDistance(bounds.getSize(new THREE.Vector3()).toArray(), dir, part.cameraClass) };
  }
  if (name === 'overview' && M.vehicleBounds) {
    const dir = VIEWS.overview[1];
    return { target: M.vehicleBounds.getCenter(new THREE.Vector3()), dir, dist: boxDistance(M.vehicleBounds.getSize(new THREE.Vector3()).toArray(), dir, camera.fov, innerWidth, innerHeight, panelBox()) };
  }
  if (name === 'tires' && M.tires.size) {
    const bounds = new THREE.Box3(), dir = VIEWS.tires[1];
    for (const t of M.tires.values()) bounds.union(t.bounds);
    return { target: bounds.getCenter(new THREE.Vector3()), dir, dist: frameDistance(bounds.getSize(new THREE.Vector3()).toArray(), dir, 'AREA') };
  }
  if (name === 'bay' && M.components.size) {
    const bounds = groupBounds(HOOD_MODELED), dir = VIEWS.bay[1];
    return { target: bounds.getCenter(new THREE.Vector3()), dir, dist: frameDistance(bounds.getSize(new THREE.Vector3()).toArray(), dir, 'AREA') };
  }
  const [target, dir, dist] = VIEWS[name] ?? VIEWS.overview;
  return { target, dir, dist: dist * fitScale() };
}
function moveCamera(name, toPos, toTarget, dur) {
  const obstacle = M.vehicleBounds ? inflateBox({ min: M.vehicleBounds.min.toArray(), max: M.vehicleBounds.max.toArray() }, 0.1) : undefined;
  camTween = { name, path: cameraPath(camera.position.toArray(), toPos.toArray(), { obstacle }), fromTarget: controls.target.clone(), toTarget: toTarget.clone(), t0: performance.now(), dur: ms(dur) };
  controls.enabled = false;
}
function driveCamera(name, dur = CAMERA_MOVE_MS) {
  log('camera-target', { name, state: state.name });
  const { target, dir, dist } = cameraGoalPose(name);
  controls.minDistance = Math.min(targetMeshes(name) ? 0.55 : 1.3, dist);
  controls.maxDistance = Math.max(11, dist);
  moveCamera(name, target.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(dist)), target, dur);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

let userInspection = createTireInspection(crypto.randomUUID());
// The reviewed Android asset adapter is the only composition; it returns null on any other origin.
// Never obtain an adapter from a window property, query, postMessage or JSON.
const mobileResults=createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()});
const mobileExpiryTimer=setInterval(()=>{if(state.name!==STATES.IDLE)mobileResults.tick();syncQrSlot();},1000);
// Tells Native where the part panel left room for the QR. Native draws it there, so the code never reaches this page.
// Coordinates are CSS px of this viewport plus its size; Native alone converts them to its pixels (see qrSlotReport).
let lastQrSlot='',qrSlotRevealed=false,qrSlotFrame=0;
function syncQrSlot(){
  const panel=$('panel'),slot=panel?.querySelector('#mobileQrSlot');let next=QR_SLOT_NONE;
  if(slot){
    if(!qrSlotRevealed){qrSlotRevealed=true;slot.scrollIntoView({block:'nearest'});}
    next=qrSlotReport(slot.getBoundingClientRect(),panel.getBoundingClientRect(),{width:innerWidth,height:innerHeight,scale:visualViewport?.scale??1,moving:getComputedStyle(panel).transform!=='none'});
  }else qrSlotRevealed=false;
  const key=JSON.stringify(next);if(key!==lastQrSlot){lastQrSlot=key;mobileResults.panelSlot(next);}
}
// Scroll, resize and the panel's slide-in move the slot between timer ticks: report the new place on the next frame.
const queueQrSlot=()=>{if(!qrSlotFrame)qrSlotFrame=requestAnimationFrame(()=>{qrSlotFrame=0;syncQrSlot();});};
$('panel').addEventListener('scroll',queueQrSlot,{passive:true});
$('panel').addEventListener('transitionend',queueQrSlot);
addEventListener('resize',queueQrSlot);
visualViewport?.addEventListener('resize',queueQrSlot);
if(typeof ResizeObserver==='function')new ResizeObserver(queueQrSlot).observe($('panel'));
// No verified History read provider exists yet (issuer BLOCKED), so this page shows UNAVAILABLE and sends
// nothing. Compose a reviewed Native provider here only; never from a window property, query, postMessage or JSON.
const inspectionHistory=createInspectionHistoryStore({provider:null});
let historyListScroll=0,historyResume=null;
// History stays open while a current-session result opened from it is shown (historyHeld): coming back keeps the
// filters, loaded pages and open record without a new request, and the reading position is restored in enter().
function syncHistory(prev){
  const was=historyHeld(prev),now=historyHeld(state);
  if(isHistoryState(prev)&&!isHistoryState(state)&&now)historyResume={name:prev.name,scroll:$('panel').scrollTop};
  if(!now)historyResume=null;
  if(now&&!was)inspectionHistory.openList(state.component?{taskId:targetForPart(state.component)?.taskId}:EMPTY_HISTORY_FILTERS);
  if(was&&!now)inspectionHistory.closeList();
  if(prev.name===STATES.HISTORY_DETAIL&&state.name===STATES.HISTORY_LIST)inspectionHistory.closeDetail();
  if(prev.name===STATES.HISTORY_LIST&&state.name===STATES.HISTORY_DETAIL){historyListScroll=$('panel').scrollTop;inspectionHistory.openDetail(state.recordId);}
}
function enter(prev) {
  syncHistory(prev);
  if (state.name === STATES.IDLE) {mobileResults.endSession();userInspection = createTireInspection(crypto.randomUUID());}
  else if(prev.name===STATES.IDLE)mobileResults.startSession(userInspection.sessionId);
  clearTimeout(refit);
  // Flush OrbitControls inertia without changing the current pose before a scripted move.
  const position = camera.position.clone(), target = controls.target.clone(), damping = controls.enableDamping;
  controls.enableDamping = false; controls.update();
  camera.position.copy(position); controls.target.copy(target); controls.update(); controls.enableDamping = damping;
  // Only a list view is worth returning to. A part reached from the overview goes back to the list's own framing.
  if ((prev.name === STATES.COMPONENT_SELECTION && [STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED].includes(state.name))
    || ([STATES.TIRE_SELECTION, STATES.TIRE_SUMMARY].includes(prev.name) && state.name === STATES.TIRE_PREVIEW)) {
    selectionView = { position: camera.position.clone(), target: controls.target.clone(), scroll: $('panel').scrollTop, component: state.component, width: innerWidth, height: innerHeight, maxDistance: controls.maxDistance, goal: state.area === 'tires' ? 'tires' : 'bay' };
  }
  if (selectionView && state.component) selectionView.component = state.component;
  document.body.dataset.state = state.name;
  M.charge.visible = M.chargeInfo.status === 'AVAILABLE' && [STATES.HISTORY_LIST,STATES.HISTORY_DETAIL,STATES.PART_RESULT,STATES.INSPECTION_OVERVIEW, STATES.INSPECTION_SUMMARY, STATES.CHARGE_PORT_PREVIEW].includes(state.name);
  M.wipers.visible=M.wiperInfo.status==='AVAILABLE'&&[STATES.HISTORY_LIST,STATES.HISTORY_DETAIL,STATES.PART_RESULT,STATES.INSPECTION_OVERVIEW,STATES.INSPECTION_SUMMARY,STATES.VISIBILITY_PREVIEW].includes(state.name);
  const underbody = state.name === STATES.EV_BATTERY_PREVIEW;
  floor.visible = ring.visible = !underbody;
  for (const mesh of M.components.get(EV_BATTERY_ID) ?? []) mesh.visible = underbody;
  controls.maxPolarAngle = Math.PI * (underbody ? 0.92 : state.area==='lights'&&state.component?0.7:0.48);
  hovered = null;
  driveHood(hoodTarget(state));
  render();
  if ([STATES.HISTORY_LIST,STATES.HISTORY_DETAIL,STATES.PART_RESULT,STATES.VISIBILITY_PREVIEW, STATES.CHARGE_PORT_PREVIEW, STATES.EV_BATTERY_PREVIEW, STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED, STATES.TIRE_PREVIEW, STATES.INSPECTION_SUMMARY, STATES.TIRE_SUMMARY].includes(state.name)) {
    $('panel').scrollTop = 0;
    const title = $('panel').querySelector('h2');
    title.tabIndex = -1; title.focus({ preventScroll: true });
  }
  // Back to the list resumes where the user was; back out of History returns to its entry control.
  if(prev.name===STATES.HISTORY_DETAIL&&state.name===STATES.HISTORY_LIST){
    $('panel').scrollTop=historyListScroll;
    $('panel').querySelector(`[data-record="${prev.recordId}"]`)?.focus({preventScroll:true});
  }else if(historyResume&&isHistoryState(state)&&!isHistoryState(prev)){
    // Back from a result opened in History: the same History screen, at the same place, focus on the control that left it.
    if(historyResume.name===state.name)$('panel').scrollTop=historyResume.scroll;
    $('panel').querySelector('[data-action="history-session-part"]')?.focus({preventScroll:true});
    historyResume=null;
  }else if(isHistoryState(prev)&&state.name===prev.historyReturn)$('panel').querySelector('[data-action="open-history"]')?.focus();
  syncInspectionMap();
  layout();
  if ([STATES.COMPONENT_SELECTION, STATES.TIRE_SELECTION, STATES.TIRE_SUMMARY].includes(state.name) && selectionView) {
    const saved = selectionView;
    controls.minDistance = Math.min(1.3, saved.position.distanceTo(saved.target));
    controls.maxDistance = saved.maxDistance;
    log('camera-restore', { position: saved.position.toArray(), width: innerWidth, height: innerHeight, savedWidth: saved.width, savedHeight: saved.height });
    if (saved.width === innerWidth && saved.height === innerHeight) {
      moveCamera(saved.goal, saved.position, saved.target, CAMERA_MOVE_MS);
    } else driveCamera(saved.goal);
    $('panel').scrollTop = saved.scroll;
    $('panel').querySelector(`[data-id="${saved.component}"]`)?.focus({ preventScroll: true });
  } else if (cameraGoal(state) !== cameraGoal(prev) || state.name === STATES.IDLE) driveCamera(cameraGoal(state));
  if ([STATES.HOOD_CLOSING, STATES.IDLE, STATES.INSPECTION_OVERVIEW, STATES.INSPECTION_SUMMARY].includes(state.name)) selectionView = null;
  if (state.name === STATES.IDLE) $('start').focus({ preventScroll: true });
}

function componentBounds(id) {
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3();
  for (const mesh of targetMeshes(id) ?? []) b.expandByObject(mesh, true);
  return b;
}

// ---------- panel ----------
const crumbs = { IDLE: "", INSPECTION_OVERVIEW: "차량 점검", HOOD_OPENING: "차량 점검 › 보닛", HOOD_CLOSING: "차량 점검", COMPONENT_SELECTION: "차량 점검 › 보닛", WASHER_SELECTED: `차량 점검 › 보닛 › ${partLabel('washer-fluid-cap')}`, MOBILE_HANDOFF_READY: `차량 점검 › 보닛 › ${partLabel('washer-fluid-cap')}` };
const hints = { INSPECTION_OVERVIEW: "모델의 부위나 목록을 선택하세요", COMPONENT_SELECTION: "모델의 부품이나 목록을 선택하세요" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sessionRows = () => projectInspectionResults(userInspection, mobileResults.snapshot);
// P10 PR #2: one row rule for every part list. A part with a result shows its result badge; a part without one says it
// only shows the shape. Cyan stays the selection role (aria-pressed), never a status.
const item = (x, action) => ['available', 'preview'].includes(x.status)||targetForPart(x.id)
  ? `<li><button type="button" class="item available ${x.status === 'preview' ? 'preview' : ''}" aria-pressed="${state.component === x.id}" data-action="${x.status==='planned'?'result-detail':action}" data-id="${x.id}">${esc(x.label)}${targetForPart(x.id)?stateBadgeHtml(sessionRows().find(r=>r.partId===x.id)):'<span class="tag">형상 보기</span>'}${x.status==='planned'?'<small>3D 형상 없음 · 결과만 확인</small>':''}</button></li>`
  : `<li><div class="item" aria-disabled="true">${esc(x.label)}<span class="tag">준비 중</span></div></li>`;
const areaAvailable = (id) => id === 'ev-charge' ? M.chargeInfo.status === 'AVAILABLE' : id === 'wipers' ? M.wiperInfo.status === 'AVAILABLE' : id === 'lights' ? M.lights.size === 4 : true;
/** Overview card of one area: the same size and border for all, results counted from the 17-part projection. */
function areaCard(a) {
  const ok = areaAvailable(a.id), results = areaResultText(sessionRows(), a.id);
  const tag = !ok ? '사용할 수 없음' : results ? `<span data-area-results="${a.id}">${results}</span>` : '형상 보기';
  return `<li><button type="button" class="item area-card" data-action="area" data-id="${a.id}"${ok ? '' : ' disabled'}><span class="row-name">${esc(a.label)}</span><span class="tag">${tag}</span>${ok ? '' : '<small>참조 모델에서 위치를 확인할 수 없습니다</small>'}<span class="row-go" aria-hidden="true">›</span></button></li>`;
}
const MODEL_BADGE = { GLB_ORIGINAL: '참조 모델', GLB_MARKER: '위치 표식', ESTIMATED: '추정 모델' };
const modelNote = (id, text) => `<p class="model-note"><span class="badge">${MODEL_BADGE[partById(id)?.geometrySource] ?? '추정 모델'}</span> ${text}</p>`;
const listHtml = (title, rows) => `<h3>${title}</h3><ul class="items">${rows}</ul>`;
const sdkHtml = (id, body) => `<details class="sdk-details dev-info"><summary>차량 연동 상태 · 개발자 정보</summary><div id="${id}">${body}</div></details>`;
const devHtml = (body) => `<details class="dev-info"><summary>개발자 정보</summary>${body}</details>`;
/**
 * Every part screen in one order: name, current result, model notice and location, how to check and safety,
 * the main action, then other parts, vehicle data and developer details, and Back.
 */
function detailScreen({ eyebrow, title, part = null, note = '', intro = '', guide = '', action = '', list = '', sdk = '', dev = '', nav = '' }) {
  const target = part && targetForPart(part);
  return `<div class="eyebrow">${eyebrow}</div><h2>${title}</h2>
    ${target ? `<div id="mobilePartResults">${partResultHtml(userInspection, mobileResults.snapshot, part)}</div>` : ''}
    ${note}${intro}${guide}
    ${target ? `<div id="mobilePartAction">${partActionHtml(userInspection, mobileResults.snapshot, part)}</div>` : ''}${action}
    ${list}${sdk}${dev}${actionsHtml(nav)}`;
}

const connectionLabels = { DETACHED: '미연동', ATTACHED: '앱 소유권 확보 · SDK 연결 완료를 뜻하지 않음', STOPPED: '화면 중지 · 이전 관측 무효화', SUPERSEDED: '다른 점검 화면이 세션을 소유함', UNAVAILABLE: '상태 전달 실패 · 이전 관측 무효화' };
function tireStatusHtml(id) {
  const t = tireStatus.forTire(id);
  const source = t.source === 'MOCK' ? 'MOCK · 모의 데이터' : t.source === 'PLEOS' ? 'PLEOS · 앱 캐시' : '없음 · 미연동';
  return `<dl class="tire-status"><dt>데이터 출처</dt><dd>${source}</dd></dl>${t.features.map(r =>
    `<section data-feature="${r.featureId}"><h3>${r.featureId}</h3><dl class="tire-status"><dt>Capability</dt><dd><span class="tire-state">${r.capabilityStatus}</span></dd><dt>Availability</dt><dd><span class="tire-state">${r.availabilityStatus}</span></dd><dt>최근 관측 시각</dt><dd>${r.observedAt === null ? '없음' : esc(new Date(r.observedAt).toISOString())}</dd></dl></section>`).join('')}
    <dl class="tire-status"><dt>연결</dt><dd>${connectionLabels[t.connectionStatus]}</dd><dt>세션 진단</dt><dd>${t.sessionPhase}${t.sessionPhase === 'UNRESOLVED' ? ' · SDK 요청/정리 미완료, 재시작 차단' : ' · 원격 연결/정리 완료 미검증'}</dd></dl>
    <p class="note">SUPPORTED는 API 기능 지원 여부입니다. STALE은 오래된 관측이며 정상·비정상 판정이 아닙니다.</p>`;
}

function panelContents() {
  const S = STATES, hoodList = () => listHtml('보닛의 다른 부품', areaOf(state).components.map(c => item(c, 'component')).join(''));
  switch (state.name) {
    case S.PART_RESULT:{
      const target=targetForPart(state.component),available=!!targetMeshes(state.component)?.length;
      return `<div class="eyebrow">점검 결과</div><h2>${esc(target.label)}</h2>
        <section class="source-zone" data-source-zone="SESSION"><span class="zone-tag">이번 점검 · 이 화면</span><div id="mobilePartResults">${partResultHtml(userInspection,mobileResults.snapshot,state.component)}</div></section>
        ${available?modelNote(state.component,'3D 위치와 형상은 참조 모델 기준이며 실제 차량과 일치하는지 검증하지 않았습니다.'):'<p class="model-note"><span class="badge">3D 형상 없음</span> 이 부품은 3D 형상이 없거나 위치를 검증하지 못해 결과만 확인합니다. 대신할 형상을 만들지 않습니다.</p>'}
        ${target.area==='lights'?`<p>${LIGHT_SCOPE_TEXT}</p>`:''}
        <div id="mobilePartAction">${partActionHtml(userInspection,mobileResults.snapshot,state.component)}</div>
        ${target.area==='tires'?`<button type="button" class="secondary wide" data-action="tire" data-id="${target.partId}">이 타이어 직접 점검하기</button>`:''}
        ${historyEntryZoneHtml(target.label)}
        <details class="sdk-details dev-info source-zone" data-source-zone="SDK"><summary>차량 연동 상태 · 개발자 정보</summary><div id="resultSdkContent">${resultSdkBody()}</div></details>${actionsHtml()}`;
    }
    case S.VISIBILITY_PREVIEW:{
      const part=areaOf(state).components.find(c=>c.id===state.component),wiper=state.area==='wipers';
      return detailScreen({eyebrow:wiper?'전면 와이퍼':'전조등',title:esc(part.label),part:state.component,
        note:modelNote(state.component,wiper?'멈춰 있는 와이퍼를 추정한 형상입니다. 작동 각도·속도·마모·교체 시기는 측정하지 않습니다.':'참조 모델의 위치 표식입니다. 실제 전구·밝기·광축이나 고장 여부를 나타내지 않습니다.'),
        intro:`<p>${wiper?'두 와이퍼는 전면 유리 하나의 작동 상태를 함께 씁니다.':'하향등은 가까운 앞쪽, 상향등은 먼 앞쪽을 비춥니다. 청록 강조는 선택 표시이며 실제 불빛이 아닙니다.'} 좌우는 운전자가 앞을 보는 기준입니다.</p>
          ${!wiper&&M.lights.get(state.component).sightline.status==='SOURCE_OCCLUDED'?'<p role="status">이 표식은 참조 모델의 차체에 가려 보이지 않을 수 있습니다. 목록에서 고를 수 있습니다.</p>':''}`,
        guide:wiper?'':`<h3>점검 범위</h3><p>${LIGHT_SCOPE_TEXT}</p>`,
        list:listHtml(wiper?'다른 와이퍼':'다른 전조등',areaOf(state).components.map(c=>item(c,'visibility-part')).join('')),
        sdk:sdkHtml('visibilityStatusContent',visibilityStatusHtml(visibilityFeaturesForPart(state.component)))+`<p class="note">${wiper?'차량이 보고한 작동 상태로 와이퍼를 움직이거나 자세를 바꾸지 않습니다.':'차량이 보고하는 전조등 상태는 좌우 구분 없이 하나이며, 어느 쪽을 골라도 같습니다.'}</p>`});
    }
    case S.CHARGE_PORT_PREVIEW:
      return detailScreen({eyebrow:'EV 충전구',title:esc(partLabel(state.component)),part:state.component,
        note:modelNote(state.component,'차량 오른쪽 뒤의 충전구를 추정한 형상입니다. 실제 위치·치수와 일치하는지 검증하지 않았고, 열림 상태를 나타내지 않습니다.'),
        intro:state.component==='ev-charge.flap'?`<p>충전구 덮개는 따로 기록하지 않고 ${esc(partLabel('ev-charge.port'))} 점검의 덮개 손상 항목에 포함됩니다.</p>`:'',
        list:listHtml('충전구 부품',areaOf(state).components.map(c=>item(c,'charge-part')).join('')),
        sdk:sdkHtml('chargePortStatusContent',chargePortStatusHtml()+'<p class="note">SDK true/false는 보고값이며 형상을 열거나 회전시키지 않습니다.</p>')});
    case S.EV_BATTERY_PREVIEW:
      return detailScreen({eyebrow:'EV 배터리',title:esc(partLabel(EV_BATTERY_ID)),
        note:modelNote(EV_BATTERY_ID,'두 차축 사이 차체 아래의 외함을 나타낸 개략 형상입니다. 치수와 배치는 검증하지 않았습니다.'),
        intro:'<p>12V 보조 배터리와 다른 부품입니다. 이 부위는 점검 결과를 기록하지 않고 형상만 보여 줍니다.</p><p class="note">아래쪽이 보이도록 바닥 표시를 숨겼습니다. 차량 아래로 들어가거나 배터리를 열지 마세요.</p>',
        sdk:sdkHtml('componentStatusContent',componentStatusHtml(state.component))+'<p class="note">충전 상태 값은 단위·범위를 검증하지 않은 원시 값이며 충전 진행이나 안전 판정이 아닙니다.</p>'});
    case S.INSPECTION_SUMMARY: return productSummaryHtml(userInspection,mobileResults.snapshot);
    case S.TIRE_SUMMARY:
      return `<div class="eyebrow">타이어</div><h2>네 타이어 요약</h2><div id="tireSummary">${summaryHtml(userInspection,mobileResults.snapshot)}</div>${actionsHtml()}`;
    case S.TIRE_SELECTION:
      return `<div class="eyebrow">타이어</div><h2>타이어 선택</h2><p>점검할 타이어를 고르세요. 좌우는 차량 진행 방향 기준입니다.</p>
        <ul class="items">${TIRES.map(t => item(t, 'tire')).join('')}</ul>
        ${actionsHtml('<button type="button" class="secondary" data-action="tire-summary">네 타이어 요약</button>')}`;
    case S.TIRE_PREVIEW: {
      const t = detachedTireInfo(state.component);
      return detailScreen({eyebrow:'타이어',title:esc(t.label),part:state.component,
        note:modelNote(state.component,'참조 3D 모델의 타이어입니다. 공기압·마모 정도나 정상 여부는 판단하지 않습니다.'),
        guide:`<section id="tireGuide">${guideHtml(userInspection, state.component)}</section>`,
        list:listHtml('다른 타이어',TIRES.map(t => item(t, 'tire')).join('')),
        sdk:sdkHtml('tireStatusContent',tireStatusHtml(state.component)),
        dev:devHtml(`<dl class="tire-status"><dt>타이어 위치</dt><dd>${esc(t.label)} · 차량 진행 방향 기준</dd><dt>차량 부품 ID</dt><dd>${esc(t.vehiclePartId)}</dd></dl>`),
        nav:'<button type="button" class="secondary" data-action="tire-summary">네 타이어 요약</button>'});
    }
    case S.HOOD_CLOSING:
      return '<div class="eyebrow">차량 점검</div><h2>모델의 보닛을 닫는 중</h2><p>완료되면 요청한 화면으로 이동합니다.</p>';
    case S.INSPECTION_OVERVIEW:
      return `<div class="eyebrow">차량 점검</div><h2>점검할 부위를 선택하세요</h2>
        <div id="sessionProgress">${stateLegendHtml(userInspection,mobileResults.snapshot,{compact:true})}</div>
        <ul class="items area-list">${INSPECTION_AREAS.map(areaCard).join('')}</ul>`;
    case S.HOOD_OPENING:
      return `<div class="eyebrow">보닛</div><h2>보닛을 여는 중</h2><p>차량 앞쪽으로 이동합니다.</p><div class="progress"><i id="hoodProgress"></i></div>${actionsHtml()}`;
    case S.COMPONENT_SELECTION:
      return `<div class="eyebrow">보닛 · 전방 수납부</div><h2>점검할 부품을 고르세요</h2>
        <ul class="items">${areaOf(state).components.map((c) => item(c, "component")).join("")}</ul>
        <p class="note">부품의 위치와 형상은 추정 모델입니다. 저전도 냉각수는 3D 형상이 없어 결과만 확인합니다.</p>${actionsHtml()}`;
    case S.COMPONENT_PREVIEW: {
      const c = areaOf(state).components.find(c => c.id === state.component);
      return detailScreen({eyebrow:'보닛 · 전방 수납부',title:esc(c.label),part:c.id,
        note:modelNote(c.id,'위치·형상·치수는 추정이며 실제 차량의 배치와 일치하는지 검증하지 않았습니다.'),
        intro:`<p>${esc(c.location)}에 있는 것으로 추정한 형상입니다. 좌우는 운전자가 앞을 보는 기준입니다.</p>`,
        guide:hoodGuideHtml(),list:hoodList(),
        sdk:c.id==='brake-fluid-reservoir'?sdkHtml('componentStatusContent',componentStatusHtml(c.id)):''});
    }
    case S.WASHER_SELECTED:
      return detailScreen({eyebrow:'보닛 · 전방 수납부',title:esc(partLabel('washer-fluid-cap')),part:'washer-fluid-cap',
        note:modelNote('washer-fluid-cap','위치와 형상은 추정입니다. 실제 차량의 캡 표기를 우선하세요.'),
        guide:washerGuideHtml(esc(SERVICE_MANUAL)),
        action:handoff.configured?'<button type="button" class="secondary wide" data-action="handoff">QR로 워셔액 안내 열기</button>':'',
        list:hoodList(),sdk:sdkHtml('componentStatusContent',componentStatusHtml('washer-fluid-cap'))});
    case S.MOBILE_HANDOFF_READY:
      return `<div class="eyebrow">보닛 · 워셔액</div><h2>QR로 워셔액 안내 열기</h2><p>스마트폰 카메라로 QR을 스캔하면 워셔액 점검 안내 화면이 열립니다.</p>
        <div class="qr"><img src="./inspection-qr.svg" alt="워셔액 점검 안내 화면으로 연결되는 QR 코드"></div>
        <p><a class="link" id="handoffLink" href="${esc(handoff.url)}" target="_blank" rel="noopener noreferrer">직접 열기</a></p>
        <p class="note">QR에는 작업 종류만 담기며 차량·계정 정보는 포함되지 않습니다. 스마트폰 화면의 후보 표시는 색상 기반이며 실제 주입구 인식 정확도는 검증되지 않았습니다.</p>
        ${actionsHtml()}`;
    default:
      return "";
  }
}

function resultSdkBody(){
  const task=targetForPart(state.component);if(state.name!==STATES.PART_RESULT||!task)return '';
  if(task.area==='tires')return tireStatusHtml(task.partId);
  if(task.area==='ev-charge')return chargePortStatusHtml();
  if(['wipers','lights'].includes(task.area))return visibilityStatusHtml(visibilityFeaturesForPart(task.partId));
  if(['washer-fluid-cap','brake-fluid-reservoir'].includes(task.partId))return componentStatusHtml(task.partId);
  return '<p class="note">이 부품의 SDK 관측 전달은 미지원입니다. 모바일 보고로 대체하지 않습니다.</p>';
}
function refreshResultSdk(){const region=$('resultSdkContent');if(region)region.innerHTML=resultSdkBody();}
const historySessionRow=record=>{const partId=record?.partId??targetForTask(inspectionHistory.snapshot.filters.taskId)?.partId;return partId?projectInspectionResults(userInspection,mobileResults.snapshot).find(r=>r.partId===partId):null;};
function refreshHistory(){
  const region=$('historyResults');if(!region||!isHistoryState(state))return;
  const snapshot=inspectionHistory.snapshot,focused=document.activeElement,scroll=$('panel').scrollTop,moreFocused=focused?.dataset?.action==='history-more',before=region.querySelectorAll('[data-record]').length,inside=region.contains(focused)&&focused!==region;
  region.innerHTML=state.name===STATES.HISTORY_DETAIL?historyDetailResultsHtml(snapshot,historySessionRow(snapshot.detail.record)):historyListResultsHtml(snapshot,historySessionRow());
  if(inside&&!document.contains(focused)){
    // After "more", focus moves to the first new row; otherwise to the same control, or the region itself.
    const newRow=region.querySelectorAll('[data-record]')[before];
    const next=moreFocused?newRow??region.querySelector('[data-action="history-more"]'):focused.dataset.record?region.querySelector(`[data-record="${focused.dataset.record}"]`):null;
    (next??region).focus({preventScroll:true});
  }
  const filterSummary=$('historyFilterSummary');if(filterSummary)filterSummary.textContent=historyFilterSummaryText(snapshot.filters);
  $('panel').scrollTop=scroll;
}
function panelHtml() {
  if(isHistoryState(state)){const snapshot=inspectionHistory.snapshot;return historyPanelHtml(state,snapshot,state.name===STATES.HISTORY_DETAIL?historySessionRow(snapshot.detail.record):historySessionRow())+sessionActions(state);}
  return panelContents() + sessionActions(state);
}

const showToast = createToast($('toast'));
const requestMobile = createMobileRequestNotifier({ request: (taskId) => mobileResults.request(taskId), show: showToast, screen: () => state });
function render() {
  $("panel").innerHTML = panelHtml();
  syncQrSlot();
  $('home').inert = state.name !== STATES.IDLE || !!exitScope;
  $('panel').inert = state.name === STATES.IDLE || !!exitScope;
  $("crumb").textContent = state.name === STATES.INSPECTION_SUMMARY ? '차량 점검 › 전체 요약' : state.area === 'tires' ? `차량 점검 › 타이어${state.component ? ' › ' + detachedTireInfo(state.component).label : ''}` : state.name === STATES.COMPONENT_PREVIEW ? `차량 점검 › 보닛 › ${areaOf(state).components.find(c => c.id === state.component).label}` : crumbs[state.name];
  if(state.name===STATES.PART_RESULT)$('crumb').textContent='차량 점검 › '+targetForPart(state.component).label;
  if(isHistoryState(state))$('crumb').textContent=state.name===STATES.HISTORY_DETAIL?'차량 점검 › 과거 점검 기록 › 상세':'차량 점검 › 과거 점검 기록';
  if (state.name === STATES.EV_BATTERY_PREVIEW) $('crumb').textContent = '차량 점검 › EV 배터리';
  if (state.name === STATES.CHARGE_PORT_PREVIEW) $('crumb').textContent = '차량 점검 › EV 충전구';
  if(state.name===STATES.VISIBILITY_PREVIEW)$('crumb').textContent='차량 점검 › '+(state.area==='wipers'?'전면 와이퍼':'전조등');
  showToast(hints[state.name]);
  syncLabels();
}
tireStatus.subscribe(() => {
  refreshResultSdk();
  const region = $('tireStatusContent');
  if (region && state.name === STATES.TIRE_PREVIEW) region.innerHTML = tireStatusHtml(state.component);
});
// Explicit browser fixture mode; the Android shell enables the same read-only client by default.
if (params.get('tireStatus') === 'fixture') enableTireStatus();
componentStatus.subscribe(() => {
  refreshResultSdk();
  const region = $('componentStatusContent');
  if (region) region.innerHTML = componentStatusHtml(state.component);
});
if (params.get('componentStatus') === 'fixture') enableComponentStatus();
chargePortStatus.subscribe(() => { refreshResultSdk();const region = $('chargePortStatusContent'); if (region) region.innerHTML = chargePortStatusHtml(); });
if (params.get('chargeStatus') === 'fixture') enableChargePortStatus();
visibilityStatus.subscribe(()=>{refreshResultSdk();const region=$('visibilityStatusContent');if(region)region.innerHTML=visibilityStatusHtml(visibilityFeaturesForPart(state.component));});
if(params.get('visibilityStatus')==='fixture')enableVisibilityStatus();

$("panel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  if(a==='result-detail')dispatch({type:EVENTS.OPEN_RESULT,id:b.dataset.id});
  else if(a==='open-history')dispatch({type:EVENTS.OPEN_HISTORY});
  else if(a==='history-detail')dispatch({type:EVENTS.OPEN_HISTORY_DETAIL,recordId:b.dataset.record});
  else if(a==='history-session-part')dispatch({type:EVENTS.OPEN_RESULT,id:b.dataset.id});
  else if(a==='history-more')inspectionHistory.loadMore();
  else if(a==='history-retry')inspectionHistory.retry();
  else if(a==='history-reset-filters'){
    inspectionHistory.setFilters(EMPTY_HISTORY_FILTERS);
    const filters=$('panel').querySelector('.history-filters');
    if(filters){filters.outerHTML=historyFilterHtml(inspectionHistory.snapshot);$('panel').querySelector('.history-filters summary').focus({preventScroll:true});}
  }
  else if(a==='select-result'&&b.dataset.session===userInspection.sessionId)mobileResults.select(b.dataset.task,b.dataset.record);
  else if(a==='request-mobile')void requestMobile(b.dataset.task);
  else if(a==='mobile-refresh')mobileResults.control('refresh');
  else if(a==='mobile-cancel')mobileResults.control('cancel');
  else if(a==='mobile-admin')mobileResults.control('admin');
  else if (a === 'confirm-tire' && state.name === STATES.TIRE_PREVIEW && b.dataset.id === state.component) {
    const next = updateTireInspection(userInspection, { type: 'CONFIRM', tireId: state.component, sessionId: b.dataset.session, at: Date.now() });
    if (next !== userInspection) { userInspection = next; renderGuide('confirm'); }
  }
  else if (a === 'tire-summary') dispatch({ type: EVENTS.SHOW_TIRE_SUMMARY });
  else if (a === 'product-summary') dispatch({ type: EVENTS.SHOW_SUMMARY });
  else if (a === "area") dispatch({ type: EVENTS.SELECT_AREA, id: b.dataset.id });
  else if (a === "component") dispatch({ type: EVENTS.SELECT_COMPONENT, id: b.dataset.id });
  else if (a === "tire") dispatch({ type: EVENTS.SELECT_TIRE, id: b.dataset.id });
  else if (a === "handoff") dispatch({ type: EVENTS.REQUEST_HANDOFF });
  else if (a === 'charge-part') dispatch({ type: EVENTS.SELECT_CHARGE_PART, id: b.dataset.id });
  else if(a==='visibility-part')dispatch({type:EVENTS.SELECT_VISIBILITY_PART,id:b.dataset.id});
  else if (a === "back") dispatch({ type: EVENTS.BACK });
  else if (a === "exit") dispatch({ type: EVENTS.EXIT });
});
function renderGuide(focus) {
  const region = $('tireGuide');
  if (!region) return;
  const scroll = $('panel').scrollTop;
  region.innerHTML = guideHtml(userInspection, state.component);
  syncResultSurfaces();
  if (focus !== 'confirm') region.querySelector(`[data-check="${focus}"]:checked`)?.focus({ preventScroll: true });
  else { const message = region.querySelector('[role="status"]'); message.tabIndex = -1; message.focus({ preventScroll: true }); }
  $('panel').scrollTop = scroll;
}
$('panel').addEventListener('change', e => {
  const input = e.target;
  if (state.name !== STATES.TIRE_PREVIEW || input.dataset.tire !== state.component || !input.matches('input[data-check]')) return;
  const next = updateTireInspection(userInspection, { type: 'ANSWER', tireId: state.component, sessionId: input.dataset.session, checkId: input.dataset.check, answer: input.value });
  if (next !== userInspection) { userInspection = next; renderGuide(input.dataset.check); }
});
$('panel').addEventListener('change',e=>{
  const form=e.target.closest?.('#historyFilterForm');
  if(!form||state.name!==STATES.HISTORY_LIST)return;
  inspectionHistory.setFilters(Object.fromEntries(new FormData(form)));
});
$('panel').addEventListener('submit',e=>{if(e.target.id==='historyFilterForm')e.preventDefault();});
$("start").addEventListener("click", () => dispatch({ type: EVENTS.START }));
$("back").addEventListener("click", () => dispatch({ type: EVENTS.BACK }));
// A label sends the same event a touch on its part sends on this screen; a selected or locked label sends nothing.
$('partLabels').addEventListener('click', (e) => {
  const el = e.target.closest('.part-label[data-shown="true"]');
  const entry = el && labels.items.find(x => x.id === el.dataset.partLabel);
  const event = entry && areaEvent(entry, labels.anchorPart.get(entry.id));
  if (event) { log('label-select', { id: entry.id, event: event.type }); dispatch(event); }
});
$('exitConfirm').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'exit-cancel') { closeExit(); log('exit-cancel', { by: 'button' }); }
  else if (a === 'exit-confirm') { closeExit(); dispatch({ type: EVENTS.EXIT, confirmed: true }); }
});
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
  const hit = nearestInspectionHit(ray.intersectObjects(scene.children, true));
  if (!hit) return null;
  if(hit.object.userData.visibilityPartId)return {kind:'visibility',id:hit.object.userData.visibilityPartId};
  if (Object.values(EV_CHARGE_IDS).includes(hit.object.userData.partId)) return { kind: 'charge', id: hit.object.userData.partId };
  if (hit.object.userData.inspectionTire) return { kind: 'tire', id: hit.object.userData.inspectionTire };
  if (hit.object.userData.isHood) return { kind: "hood" };
  if (hit.object.userData.washer) return { kind: "washer" };
  if (hit.object.userData.inspectionTarget) return { kind: 'component', id: hit.object.userData.inspectionTarget };
  return { kind: "other" };
}
/** The inspection part (or 'hood') a ray hit belongs to, or null for the body, floor and everything else. */
function hitPartId(object) {
  const u = object?.userData ?? {};
  if (u.visibilityPartId) return u.visibilityPartId;
  if (Object.values(EV_CHARGE_IDS).includes(u.partId)) return u.partId;
  if (u.inspectionTire) return u.inspectionTire;
  if (u.isHood) return 'hood';
  if (u.washer) return 'washer-fluid-cap';
  return u.inspectionTarget ?? null;
}
// Touch slop (finger input only): when the exact point selects nothing, points up to TOUCH_SLOP_PX away are probed with
// real rays and chooseTouch decides: exact first, one specific part only, never an area-wide surface, nothing when
// ambiguous. Mouse, pen and hover keep the exact point.
let lastTouch = null;
function touchDecision(x, y) {
  const exact = pickExact(x, y);
  if (exact) return chooseTouch(exact);
  const found = [];
  for (const p of touchProbes(x, y).slice(1)) { const event = pickExact(p.x, p.y); if (event) found.push({ r: p.r, event }); }
  return chooseTouch(null, found);
}
function pickTarget(x, y, { slop = false } = {}) {
  if (!slop) return pickExact(x, y);
  const d = touchDecision(x, y); lastTouch = { x, y, reason: d.reason, event: d.event };
  return d.event;
}
function pickExact(x, y) {
  const h = hitAt(x, y);
  if(state.name===STATES.PART_RESULT){const id=h?.kind==='washer'?'washer-fluid-cap':h?.id;if(targetForPart(id))return {type:EVENTS.OPEN_RESULT,id};}
  if([STATES.INSPECTION_OVERVIEW,STATES.INSPECTION_SUMMARY].includes(state.name)&&h?.kind==='visibility')return {type:EVENTS.SELECT_AREA,id:WIPER_PARTS.includes(h.id)?'wipers':'lights',partId:h.id};
  if(state.name===STATES.VISIBILITY_PREVIEW&&h?.kind==='visibility')return {type:EVENTS.SELECT_VISIBILITY_PART,id:h.id};
  if ([STATES.INSPECTION_OVERVIEW, STATES.INSPECTION_SUMMARY].includes(state.name) && h?.kind === 'charge') return { type: EVENTS.SELECT_AREA, id: 'ev-charge', partId: h.id };
  if (state.name === STATES.CHARGE_PORT_PREVIEW && h?.kind === 'charge') return { type: EVENTS.SELECT_CHARGE_PART, id: h.id };
  if ([STATES.INSPECTION_OVERVIEW, STATES.INSPECTION_SUMMARY, STATES.TIRE_SELECTION, STATES.TIRE_PREVIEW, STATES.TIRE_SUMMARY].includes(state.name) && h?.kind === 'tire') return { type: EVENTS.SELECT_TIRE, id: h.id };
  if ([STATES.INSPECTION_OVERVIEW, STATES.INSPECTION_SUMMARY].includes(state.name) && h?.kind === "hood") return { type: EVENTS.SELECT_AREA, id: "hood" };
  if ([STATES.COMPONENT_SELECTION, STATES.COMPONENT_PREVIEW, STATES.WASHER_SELECTED].includes(state.name)) {
    if (h?.kind === 'washer') return { type: EVENTS.SELECT_COMPONENT, id: 'washer-fluid-cap' };
    if (h?.kind === 'component') return { type: EVENTS.SELECT_COMPONENT, id: h.id };
  }
  return null;
}
let downAt = null, hovered = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
    const slop = usesTouchSlop(e.pointerType), ev = pickTarget(e.clientX, e.clientY, { slop });
    log('pick', { pointerType: e.pointerType, slop, reason: slop ? lastTouch?.reason : ev ? 'EXACT' : 'NONE' });
    if (ev) dispatch(ev);
  }
  downAt = null;
});
renderer.domElement.addEventListener('pointercancel', () => { downAt = null; });
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.buttons || !M.pivot) return;
  const ev = pickTarget(e.clientX, e.clientY);
  hovered = ev ? (ev.type === EVENTS.SELECT_AREA ? ev.partId ?? ev.id : ev.id) : null;
  renderer.domElement.style.cursor = ev ? "pointer" : "";
});

// ---------- layout: keep the car centred in the space the panel leaves ----------
function layout() {
  const w = innerWidth, h = innerHeight, b = panelBox();
  // The toast centers on the free space beside a side panel (P2-5), measured from the panel's resting place, not mid-slide.
  const p = $('panel'), right = parseFloat(getComputedStyle(p).right) || 0;
  document.documentElement.style.setProperty('--free-center', b.side ? `${Math.round((w - right - p.offsetWidth) / 2)}px` : '50%');
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

// Result role: a reported result sets the material's base color; NOT_INSPECTED keeps the original material on every
// part, tires included. Selection (cyan emissive + outline) and hint (neutral emissive) are separate roles on top.
let inspectionMap=projectInspectionResults(userInspection,mobileResults.snapshot);
const resultBaseColors=new WeakMap();
function syncInspectionMap() {
  inspectionMap=projectInspectionResults(userInspection,mobileResults.snapshot);
  for(const row of inspectionMap)for(const mesh of targetMeshes(row.partId)??[]){
    if(!resultBaseColors.has(mesh.material))resultBaseColors.set(mesh.material,mesh.userData.inspectionBaseColor??mesh.material.color.getHex());
    mesh.material.color.setHex(state.name===STATES.IDLE||row.status==='NOT_INSPECTED'?resultBaseColors.get(mesh.material):row.color);
  }
}
// Local and mobile changes end here, so the 3D colors, card, summary and badges come from the same records at the same moment.
function syncResultSurfaces(){syncInspectionMap();if(window.__inspectReady)refreshResultRegions($('panel'),{local:userInspection,mobile:mobileResults.snapshot,partId:state.component});syncQrSlot();syncLabels();}
mobileResults.subscribe(()=>{syncResultSurfaces();if(window.__inspectReady&&isHistoryState(state))refreshHistory();});
inspectionHistory.subscribe(refreshHistory);
// Access can change while the screen is away, so paused or hidden pages keep no records (same fixed signals as SDK status).
addEventListener('carscope-tire-inactive',()=>inspectionHistory.suspend());
addEventListener('carscope-tire-active',()=>{if(!document.hidden)inspectionHistory.resume();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)inspectionHistory.suspend();else inspectionHistory.resume();});
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
// Selection outline: the cyan edges of the selected part, built once per mesh on first selection. Never picked.
const selectionOutlines = new Map();
function selectionOutline(mesh) {
  let lines = selectionOutlines.get(mesh);
  if (!lines) {
    lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 35), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 }));
    lines.raycast = () => {}; lines.renderOrder = 5; lines.userData.synthetic = true; lines.userData.selectionOutline = true;
    mesh.add(lines); selectionOutlines.set(mesh, lines);
  }
  return lines;
}
const resultRow = (id) => inspectionMap.find(r => r.partId === id);
const hasMeshes = (id) => id === 'hood' ? M.hoodMeshes.length > 0 : !!targetMeshes(id)?.length;
/** Which role paints a part now: SELECTED, HINT or NONE. One rule for every part and material. */
function highlightRole(id, hints) {
  if (state.component === id && state.name !== STATES.IDLE) return 'SELECTED';
  return hints.has(id) ? 'HINT' : 'NONE';
}
function paintHighlight(now) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 380);
  const hints = new Set(hintTargets(state, { modeled: hasMeshes }));
  const hintLevel = (id) => (reducedMotion ? 0.16 : 0.1 + 0.1 * pulse) + (hovered === id ? 0.12 : 0);
  const hoodHint = hints.has('hood');
  for (const m of M.hoodMeshes) { m.material.emissive.setHex(hoodHint ? HINT_COLOR : 0); m.material.emissiveIntensity = hoodHint ? hintLevel('hood') : 0; }
  for (const l of M.outline) l.visible = hoodHint;
  for (const [id, meshes] of highlightGroups()) {
    const role = highlightRole(id, hints), row = resultRow(id), hasResult = !!row && row.status !== 'NOT_INSPECTED';
    for (const m of meshes) {
      const mat = m.material;
      if (role === 'SELECTED') {
        mat.emissive.setHex(ACCENT);
        mat.emissiveIntensity = selectionIntensity([mat.color.r, mat.color.g, mat.color.b], { hasResult });
        selectionOutline(m).visible = true;
      } else {
        const outline = selectionOutlines.get(m); if (outline) outline.visible = false;
        if (role === 'HINT') { mat.emissive.setHex(HINT_COLOR); mat.emissiveIntensity = hintLevel(id); }
        else if (m.userData.originalLight) { mat.emissive.copy(m.userData.originalLight.emissive); mat.emissiveIntensity = m.userData.originalLight.intensity; }
        else { mat.emissive.setHex(0); mat.emissiveIntensity = 0; }
      }
    }
  }
  paintLabels(now);
}

// ---------- PartLabel: one label system for every modeled part (rules in part-labels.mjs) ----------
const labels = { items: [], key: '', els: new Map(), sizes: new Map(), anchorPart: new Map(), anchors: new Map(), info: [], checkedAt: -1e9, pose: '', lines: '', samples: new WeakMap() };
const meshShown = (m) => { for (let n = m; n; n = n.parent) if (!n.visible) return false; return true; };
const labelMeshes = (id) => id === 'hood' ? M.hoodMeshes : id === 'washer-fluid-cap' ? [M.cap, ...M.washerMeshes.filter(m => m !== M.cap)].filter(Boolean) : (M.tires.get(id)?.pickMeshes ?? targetMeshes(id) ?? []);
const labelLocked = () => receiverLocked(mobileResults.snapshot.receiver);
function syncLabels() {
  const locked = labelLocked();
  const items = labelPlan(state, { modeled: hasMeshes, locked });
  const rows = items.map(x => { const r = x.kind === 'PART' ? resultRow(x.id) : null; return [x.id, x.selected, !!x.event, r?.status ?? null]; });
  const key = JSON.stringify([state.name, locked, rows]);
  labels.items = items;
  if (key === labels.key) return;
  labels.key = key; labels.checkedAt = -1e9;
  const layer = $('partLabels');
  layer.innerHTML = items.map(x => {
    const r = x.kind === 'PART' ? resultRow(x.id) : null;
    const status = r ? `<span class="label-state" data-inspection-state="${r.status}">${r.symbol}${x.selected ? ' ' + esc(r.label) : ''}</span>` : '';
    const name = r ? `${x.text}, ${r.label}` : x.text;
    return `<div class="part-label" data-part-label="${esc(x.id)}" data-kind="${x.kind}" data-selected="${x.selected}" data-actionable="${!!x.event || x.kind === 'AREA'}" data-shown="false" data-occluded="false"><button type="button" aria-pressed="${x.selected}" aria-label="${esc(name)}"${x.event || x.kind === 'AREA' ? '' : ' aria-disabled="true"'}>${esc(x.text)}${status}<span class="label-note" hidden>· 가려짐</span></button></div>`;
  }).join('');
  labels.els = new Map([...layer.querySelectorAll('.part-label')].map(el => [el.dataset.partLabel, el]));
  // Measure each box once while invisible; the layout keeps at least the 44px touch size.
  for (const [id, el] of labels.els) { el.style.visibility = 'hidden'; el.dataset.shown = 'true'; labels.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight }); el.dataset.shown = 'false'; el.style.visibility = ''; }
}
// World points to try on a part, in order: the part's center, then spread vertices. Cached per mesh in local space.
function localSamples(mesh) {
  let s = labels.samples.get(mesh);
  if (!s) {
    const g = mesh.geometry, pos = g.attributes.position; g.computeBoundingBox();
    s = [g.boundingBox.getCenter(new THREE.Vector3())];
    const step = Math.max(1, Math.floor(pos.count / 7));
    for (let i = Math.floor(step / 2); i < pos.count && s.length < 8; i += step) s.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    labels.samples.set(mesh, s);
  }
  return s;
}
const occlusionRay = new THREE.Raycaster();
/** The point a touch at this sample's pixel reaches if that is the part itself, or null if another mesh comes first.
 *  The same screen ray as a touch, so a label marked visible sits where a touch selects its part. */
function visiblePoint(id, world) {
  const v = world.clone().project(camera);
  if (v.z <= -1 || v.z >= 1) return null;
  occlusionRay.setFromCamera(new THREE.Vector2(v.x, v.y), camera);
  const hit = nearestInspectionHit(occlusionRay.intersectObjects(scene.children, true));
  return hit && hitPartId(hit.object) === id ? hit.point.clone() : null;
}
/** Anchor of one part: a visible point if one exists (occluded:false), else its center marked occluded. */
function partAnchor(id) {
  const meshes = labelMeshes(id).filter(meshShown);
  if (!meshes.length) return null;
  const points = [];
  for (const m of meshes) for (const p of localSamples(m)) { points.push(p.clone().applyMatrix4(m.matrixWorld)); if (points.length >= 14) break; }
  const box = new THREE.Box3(); for (const m of meshes) box.union(new THREE.Box3().setFromObject(m));
  const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  for (const p of [center, ...points]) { const seen = visiblePoint(id, p); if (seen) return { world: seen, box, occluded: false }; }
  return { world: center, box, occluded: true };
}
function refreshAnchors() {
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  labels.anchors = new Map(); labels.anchorPart = new Map(); labels.partBoxes = new Map();
  for (const item of labels.items) {
    let chosen = null, part = item.anchors[0];
    for (const id of item.anchors) { const a = partAnchor(id); if (!a) continue; labels.partBoxes.set(id, a.box); if (!chosen) { chosen = a; part = id; } if (!a.occluded) { chosen = a; part = id; break; } }
    labels.anchors.set(item.id, chosen); labels.anchorPart.set(item.id, part);
  }
}
function labelObstacles() {
  const out = [], pad = 6;
  for (const el of [state.name !== STATES.IDLE ? $('panel') : null, document.querySelector('.topbar'), $('androidZoom'), $('dev')?.hidden ? null : $('dev')]) {
    if (!el) continue; const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push({ x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad });
  }
  return out;
}
/** Screen rectangle of a world box; undefined when part of it is behind the camera (no meaningful rectangle). */
function screenBox(box3, r) {
  const xs = [], ys = [];
  for (const x of [box3.min.x, box3.max.x]) for (const y of [box3.min.y, box3.max.y]) for (const z of [box3.min.z, box3.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera); if (p.z >= 1 || p.z <= -1) return undefined;
    xs.push(r.left + (p.x + 1) * r.width / 2); ys.push(r.top + (1 - p.y) * r.height / 2);
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
function paintLabels(now) {
  if (!labels.items.length) { if (labels.info.length || labels.lines) { labels.info = []; labels.lines = ''; $('partLabelLines').innerHTML = ''; } return; }
  const c = camera.position, t = controls.target;
  const pose = [c.x, c.y, c.z, t.x, t.y, t.z, M.angle, innerWidth, innerHeight].map(v => v.toFixed(3)).join();
  // Occlusion is re-checked when the view changes, at most every 150ms, and at once after a screen change.
  if (pose !== labels.pose && now - labels.checkedAt > 150 || labels.checkedAt < 0) { refreshAnchors(); labels.pose = pose; labels.checkedAt = now; }
  camera.updateMatrixWorld();
  const r = renderer.domElement.getBoundingClientRect();
  const input = labels.items.map(item => {
    const a = labels.anchors.get(item.id), size = labels.sizes.get(item.id) ?? { w: 0, h: 0 };
    if (!a) return { id: item.id, anchor: null, selected: item.selected, ...size };
    const v = a.world.clone().project(camera);
    return { id: item.id, parts: item.anchors, anchor: { x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2, inFront: v.z < 1 && v.z > -1 }, box: screenBox(a.box, r), occluded: a.occluded, selected: item.selected, ...size };
  });
  const targets = [];
  for (const [id, box3] of labels.partBoxes ?? []) { const b = screenBox(box3, r); if (b) targets.push({ id, box: b }); }
  labels.info = layoutLabels(input, { width: innerWidth, height: innerHeight, obstacles: labelObstacles(), targets });
  let lines = '';
  for (const entry of labels.info) {
    const el = labels.els.get(entry.id); if (!el) continue;
    el.dataset.shown = String(entry.shown); el.dataset.occluded = String(entry.occluded);
    el.querySelector('.label-note').hidden = !entry.occluded;
    if (!entry.shown) continue;
    el.style.transform = `translate(${Math.round(entry.rect.x)}px,${Math.round(entry.rect.y)}px)`;
    const { x, y, w, h } = entry.rect, ex = Math.min(Math.max(entry.anchor.x, x), x + w), ey = Math.min(Math.max(entry.anchor.y, y), y + h);
    lines += `<line data-selected="${entry.selected}" data-occluded="${entry.occluded}" x1="${entry.anchor.x.toFixed(1)}" y1="${entry.anchor.y.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/><circle data-selected="${entry.selected}" cx="${entry.anchor.x.toFixed(1)}" cy="${entry.anchor.y.toFixed(1)}" r="3"/>`;
  }
  if (lines !== labels.lines) { labels.lines = lines; $('partLabelLines').innerHTML = lines; }
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
    camera.position.fromArray(camTween.path(e));
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
  M.vehicleBounds = new THREE.Box3().setFromObject(gltf.scene, true);
  // Measure every ORIGINAL world mesh before hood reparenting or synthetic geometry.
  try {
    const source = sourceWorldParts(gltf.scene), support = measureEvChargePortSupport(source);
    const model = buildEvChargePort({ support });
    const after = sourceWorldParts(gltf.scene);
    const unchanged = source.length === after.length && source.every((p, i) => p.triangles.length === after[i].triangles.length && p.triangles.every((v, k) => v === after[i].triangles[k]));
    if (!unchanged) throw Error('SOURCE_CHANGED');
    for (const p of model.parts) {
      const mesh = meshFrom(p.triangles, new THREE.MeshStandardMaterial({ color: p.id === EV_CHARGE_IDS.flap ? 0x59616b : 0x24282d, roughness: 0.7 }), p.id, { partId: p.meta.partId, inspectionTarget: p.meta.inspectionTarget, meta: p.meta });
      M.charge.add(mesh); M.components.set(p.meta.partId, [mesh]);
    }
    M.chargeInfo = { status: 'AVAILABLE', sourceMeshCount: source.length, support, sourceUnchanged: unchanged };
  } catch { M.chargeInfo = { status: 'UNAVAILABLE', sourceMeshCount: 0, sourceUnchanged: false }; log('charge-model-unavailable'); }
  const meshNodes = new Set(gltf.parser.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  try{
    const source=sourcePartsByNode(gltf.scene,meshNodes),model=buildFrontWiperGeometry({support:measureFrontWiperSupport(source)});
    for(const p of model.parts){const mesh=meshFrom(p.triangles,new THREE.MeshStandardMaterial({color:0x262b31,roughness:0.85}),p.id,{partId:p.meta.partId,inspectionTarget:p.meta.inspectionTarget,visibilityPartId:p.meta.partId,meta:p.meta});M.wipers.add(mesh);M.components.set(p.id,[mesh]);}
    M.wiperInfo={status:'AVAILABLE',sourceNodeCount:source.length};
  }catch{M.wiperInfo={status:'UNAVAILABLE'};log('wiper-model-unavailable');}
  let bodyMaterial = null;
  gltf.scene.traverse((o) => { if (!o.isMesh) return; o.material = o.material.clone(); const part = meshNodes.has(o.name) ? o.name : o.parent.name; if (part === "Body" && o.material.name === "Body") bodyMaterial = o.material; });
  try{M.lights=resolveFrontLightTargets(gltf.scene);for(const [id,t]of M.lights){t.sightline=lightSightline(gltf.scene,t);for(const mesh of t.meshes){mesh.userData.visibilityPartId=id;mesh.userData.originalLight={emissive:mesh.material.emissive.clone(),intensity:mesh.material.emissiveIntensity};M.components.set(id,t.meshes);}}}catch{M.lights=new Map();log('light-model-unavailable');}
  try { M.tires = resolveTireTargets(gltf.scene); }
  catch (error) {
    $('status').textContent = '타이어의 좌표·형상 매핑을 검증할 수 없습니다. 참조 GLB를 확인하세요.';
    log('load-error', { message: String(error) });
    return;
  }
  for (const [id, t] of M.tires) {
    for (const mesh of t.pickMeshes) mesh.userData.inspectionTire = id;
    for (const mesh of t.meshes) mesh.userData.inspectionBaseColor=mesh.material.color.getHex();
  }
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
  // Reuse A's merged model verbatim; this group is outside the hood-only bay.
  for (const p of buildEvBatteryPack().parts) {
    const mesh = meshFrom(p.triangles, new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.78 }), p.id, { inspectionTarget: EV_BATTERY_ID, meta: p.meta });
    scene.add(mesh); mesh.visible = false;
    M.components.set(EV_BATTERY_ID, [mesh]);
  }
  setHoodAngle(0);
  // Build every selection outline once now, so selecting or reporting never allocates GPU geometry later.
  const outlineStart = performance.now();
  for (const [, meshes] of highlightGroups()) for (const m of meshes) selectionOutline(m).visible = false;
  log('selection-outlines', { count: selectionOutlines.size, ms: Math.round(performance.now() - outlineStart) });
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
  disposeTireStatus();
  disposeComponentStatus();
  disposeChargePortStatus();
  disposeVisibilityStatus();
  mobileResults.dispose();
  inspectionHistory.dispose();
  clearInterval(mobileExpiryTimer);
  userInspection=createTireInspection(crypto.randomUUID());syncInspectionMap();
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
addEventListener('pagehide',()=>dispose('pagehide'),{once:true});
addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

// Test and developer hooks (no vehicle control here: a visual flow only).
window.__inspect = {
  get state() { return state; },
  dispatch,
  get hoodAngle() { return M.angle; },
  get busy() { return Boolean(hoodTween || camTween); },
  get handoff() { return handoff; },
  tireStatus: () => tireStatus.state,
  componentStatus: () => componentStatus.state,
  chargePortStatus: () => chargePortStatus.state,
  visibilityStatus:()=>visibilityStatus.state,
  visibilityInfo:()=>({wipers:M.wiperInfo,lights:[...M.lights].map(([id,t])=>({id,node:t.node,feature:t.feature,sightline:t.sightline,bounds:{min:t.bounds.min.toArray(),max:t.bounds.max.toArray()},parts:t.meshes.map(m=>({positions:Array.from(m.geometry.attributes.position.array),matrix:m.matrixWorld.toArray()}))})),wiperParts:M.wipers.children.map(m=>({partId:m.userData.partId,positions:Array.from(m.geometry.attributes.position.array),matrix:m.matrixWorld.toArray(),meta:m.userData.meta}))}),
  visibilityRay:id=>{const p=window.__inspect.componentPoint(id);hitAt(p.x,p.y);return {point:p,hits:ray.intersectObjects(scene.children,true).filter(h=>h.object.isMesh).slice(0,8).map(h=>({name:h.object.name,material:h.object.material.name,transparent:h.object.material.transparent,opacity:h.object.material.opacity,distance:h.distance,part:h.object.userData.visibilityPartId}))};},
  chargeGeometry: () => ({ ...M.chargeInfo, visible: M.charge.visible, parts: M.charge.children.map(m => ({ partId: m.userData.partId, matrix: m.matrixWorld.toArray(), positions: Array.from(m.geometry.attributes.position.array), meta: m.userData.meta })) }),
  chargePoint: (id) => {
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(); const p = new THREE.Vector3();
    for (const mesh of M.components.get(id) ?? []) { const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        p.set(0, 0, 0); for (let k = 0; k < 3; k++) p.add(new THREE.Vector3().fromBufferAttribute(pos, i + k)); p.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld).project(camera);
        const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2, b = panelBox();
        if (p.z < 1 && x > 80 && x < innerWidth - b.side && y > 80 && y < innerHeight - b.bottom && hitAt(x, y)?.id === id) return { x, y };
      }
    } return null;
  },
  batteryView: () => ({ visible: M.components.get(EV_BATTERY_ID)?.[0].visible, meta: M.components.get(EV_BATTERY_ID)?.[0].userData.meta, floorVisible: floor.visible, ringVisible: ring.visible, maxPolarAngle: controls.maxPolarAngle }),
  userInspection: () => userInspection,
  inspectionMap: () => inspectionStateMap(userInspection),
  resultMap:()=>inspectionMap,
  resultPaint:()=>[...targetGroups()].filter(([id])=>targetForPart(id)).map(([id,meshes])=>({partId:id,colors:meshes.map(m=>m.material.color.getHex()),baseColors:meshes.map(m=>resultBaseColors.get(m.material))})),
  nativeResults:()=>mobileResults.snapshot,
  history:()=>inspectionHistory.snapshot,
  inspectionPaint: () => [...M.tires].map(([id,t])=>({id,colors:t.meshes.map(m=>m.material.color.getHex()),baseColors:t.meshes.map(m=>m.userData.inspectionBaseColor)})),
  hoodPoint: () => screenPoint(M.hoodMeshes[0], false),
  capPoint: () => screenPoint(M.cap),
  hitAt,
  // What a real touch at (x,y) selects, with the 16px slop. null: nothing (an empty touch).
  pickAt: (x, y) => pickTarget(x, y, { slop: true }),
  // The touch decision with its reason (EXACT, SLOP, AMBIGUOUS, AREA_ONLY, NONE), and what a mouse click selects.
  touchAt: (x, y) => touchDecision(x, y),
  clickAt: (x, y) => pickExact(x, y),
  // Shown and hidden labels with the reason, anchor, box and the part the anchor sits on (P1-3, P1-13, P2-6).
  labelInfo: () => labels.info.map(e => { const item = labels.items.find(x => x.id === e.id), el = labels.els.get(e.id), b = el?.querySelector('button')?.getBoundingClientRect();
    return { ...e, kind: item?.kind, anchorPart: labels.anchorPart.get(e.id) ?? null, text: item?.text, actionable: !!(item && (item.event || item.kind === 'AREA')), event: item ? areaEvent(item, labels.anchorPart.get(e.id)) : null,
      button: e.shown && b ? { x: b.left, y: b.top, w: b.width, h: b.height } : null }; }),
  // The three roles of one part: result color, selection and hint (P1-4, P1-5, P1-6).
  highlightInfo: (id) => { const row = resultRow(id), hints = new Set(hintTargets(state, { modeled: hasMeshes }));
    return { id, role: highlightRole(id, hints), result: row ? { status: row.status, color: row.color, symbol: row.symbol } : null,
      meshes: (targetMeshes(id) ?? []).map(m => ({ color: m.material.color.getHex(), base: resultBaseColors.get(m.material) ?? m.userData.inspectionBaseColor ?? null, colorLinear: [m.material.color.r, m.material.color.g, m.material.color.b],
        emissive: m.material.emissive.getHex(), intensity: m.material.emissiveIntensity, outline: !!selectionOutlines.get(m)?.visible })) }; },
  componentPoint: (id) => { const v = componentBounds(id).getCenter(new THREE.Vector3()).project(camera); return { x: (v.x+1)*innerWidth/2, y: (1-v.y)*innerHeight/2, inFront: v.z<1 }; },
  componentInfo: () => [...M.components].map(([id, meshes]) => ({ id, meshes: meshes.map(m => ({ id: m.name, target: m.userData.inspectionTarget, highlighted: m.material.emissiveIntensity > 0, meta: m.userData.meta })), bounds: { min: componentBounds(id).min.toArray(), max: componentBounds(id).max.toArray() } })),
  tireInfo: () => [...M.tires].map(([id, t]) => ({ id, node: t.node, panel: tireStatus.forTire(id), meshes: t.meshes.map(m => ({ name: m.name, material: m.material.name, selectionIntensity:m.material.emissiveIntensity, highlighted: m.material.emissiveIntensity > 0 && m.material.emissive.getHex() !== 0 })), wheelMeshes: t.pickMeshes.map(m => ({ name: m.name, material: m.material.name, highlighted: m.material.emissiveIntensity > 0 && m.material.emissive.getHex() !== 0 })), bounds: { min: t.bounds.min.toArray(), max: t.bounds.max.toArray() } })),
  cameraPose: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
  zoom,
  view: () => ({ azimuthDeg: +THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()).toFixed(1), polarDeg: +THREE.MathUtils.radToDeg(controls.getPolarAngle()).toFixed(1), distance: +camera.position.distanceTo(controls.target).toFixed(3) }),
  dispose,
  get renderInfo() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }; },
};
