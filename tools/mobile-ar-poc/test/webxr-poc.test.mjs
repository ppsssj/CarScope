// P9-XR-B/C: Node tests with the fake XR runtime. They cover API lifecycle and host boundaries, not real tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as THREE from 'three';
import { createHandler } from '../server.mjs';
import { buildStaging, PUBLIC_FILES } from '../staging/build.mjs';
import { MOBILE_MODULES } from '../public-modules.mjs';
import { WEBXR_GUIDE_FILES, markWebXrGuidePage } from '../webxr-modules.mjs';
import { webxrGuideEnabled } from '../webxr-flag.mjs';
import { initialState as inspectionInitial, reduce as inspectionReduce } from '../public/self-inspection.mjs';
import { probeWebXr, sessionInit, startErrorReason } from '../public/webxr/webxr-capability.mjs';
import { canPlace, initialState, noticeText, PHASES, reasonText, reduce, statusCopy } from '../public/webxr/webxr-state.mjs';
import { createWebXrController } from '../public/webxr/webxr-controller.mjs';
import { buildMarkerGroup } from '../public/webxr/webxr-view.mjs';
import { createFakeXr, translation } from './fake-webxr.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeView(env, { attachError = false } = {}) {
  const view = {
    reticle: null, marker: null, dim: false, disposed: 0, renders: 0, loop: null,
    async attach() { if (attachError) throw Error('attach'); return env.localSpace; },
    startLoop(callback) {
      view.loop = callback;
      const schedule = () => env.currentSession.requestAnimationFrame((time, frame) => { schedule(); view.loop?.(time, frame); });
      schedule();
    },
    setReticle(matrix) { view.reticle = matrix; },
    setMarker(matrix, { dim = false } = {}) { view.marker = matrix; view.dim = dim; },
    render() { view.renders++; },
    dispose() { view.disposed++; view.loop = null; },
  };
  return view;
}

async function setup(options = {}, viewOptions = {}) {
  const env = createFakeXr(options);
  const views = [], states = [];
  const capability = await probeWebXr({ xr: env.xr, secureContext: true, XRSession: env.XRSession, XRFrame: env.XRFrame, XRHitTestResult: env.XRHitTestResult });
  const controller = createWebXrController({
    xr: env.xr, overlayRoot: { id: 'overlay' },
    createView: () => { const view = fakeView(env, viewOptions); views.push(view); return view; },
    onState: state => states.push(state),
  });
  controller.probed(capability);
  return { env, controller, views, states, get view() { return views.at(-1); } };
}

async function place(t) {
  t.env.step();
  assert.equal(t.controller.requestPlace(), true);
  t.env.step();
  await tick();
}

const started = async options => { const t = await setup(options); assert.equal(await t.controller.start(), true); return t; };
const live = env => env.anchors.filter(anchor => !anchor.deleted);

// ---- capability probe -----------------------------------------------------------------------------------
test('probe reports each missing requirement with its own reason and never allows a start', async () => {
  const env = createFakeXr();
  const base = { xr: env.xr, secureContext: true, XRSession: env.XRSession, XRFrame: env.XRFrame, XRHitTestResult: env.XRHitTestResult };
  assert.equal((await probeWebXr({ ...base, secureContext: false })).reason, 'INSECURE_CONTEXT');
  assert.equal((await probeWebXr({ ...base, xr: undefined })).reason, 'NO_WEBXR_API');
  env.supported = false;
  const noAr = await probeWebXr(base);
  assert.equal(noAr.reason, 'AR_NOT_SUPPORTED');
  assert.equal(noAr.canStart, false);
  env.supported = true;
  assert.equal((await probeWebXr({ ...base, XRSession: class {} })).reason, 'HIT_TEST_NOT_SUPPORTED');
  env.probeError = 'SecurityError';
  assert.equal((await probeWebXr(base)).reason, 'POLICY_BLOCKED');
  env.probeError = 'OperationError';
  assert.equal((await probeWebXr(base)).reason, 'PROBE_FAILED');
});

test('probe allows a start without the anchor API and reports anchors as unavailable', async () => {
  const env = createFakeXr();
  const result = await probeWebXr({ xr: env.xr, secureContext: true, XRSession: env.XRSession, XRFrame: class {}, XRHitTestResult: class {} });
  assert.equal(result.canStart, true);
  assert.equal(result.anchors, false);
});

test('session requires only local and hit-test, so missing anchors or overlay do not block a start', () => {
  const root = {};
  assert.deepEqual(sessionInit(root), { requiredFeatures: ['local', 'hit-test'], optionalFeatures: ['anchors', 'dom-overlay'], domOverlay: { root } });
  assert.equal(sessionInit(null).domOverlay, undefined);
});

test('session start errors map to distinct user reasons', () => {
  assert.equal(startErrorReason({ name: 'NotAllowedError' }), 'PERMISSION_DENIED');
  assert.equal(startErrorReason({ name: 'SecurityError' }), 'PERMISSION_DENIED');
  assert.equal(startErrorReason({ name: 'NotSupportedError' }), 'SESSION_NOT_SUPPORTED');
  assert.equal(startErrorReason({ name: 'InvalidStateError' }), 'SESSION_BUSY');
  assert.equal(startErrorReason(new Error('x')), 'SESSION_ERROR');
});

// ---- state machine --------------------------------------------------------------------------------------
test('state machine ignores events that do not apply and returns the same object', () => {
  const state = initialState();
  for (const type of ['START', 'SESSION_STARTED', 'PLACE', 'MARKER_PLACED', 'REMOVE', 'REPOSITION', 'SESSION_ENDED']) {
    assert.equal(reduce(state, { type }), state, type);
  }
  assert.ok(PHASES.includes(state.phase));
});

test('placement requires tracking, a surface and a visible session', () => {
  const aiming = { ...initialState(), phase: 'AIMING', tracking: 'TRACKING', surface: true, visibility: 'visible' };
  assert.equal(canPlace(aiming), true);
  assert.equal(canPlace({ ...aiming, tracking: 'LOST' }), false);
  assert.equal(canPlace({ ...aiming, tracking: 'LIMITED' }), false);
  assert.equal(canPlace({ ...aiming, surface: false }), false);
  assert.equal(canPlace({ ...aiming, visibility: 'visible-blurred' }), false);
  assert.equal(canPlace({ ...aiming, phase: 'PLACED' }), false);
});

test('copy warns on tracking loss and never claims recognition or a measured accuracy', () => {
  const base = { ...initialState(), phase: 'PLACED', markerMode: 'ANCHOR', tracking: 'TRACKING', markerVisible: true, surface: true };
  assert.equal(statusCopy({ ...base, tracking: 'LOST' }).tone, 'warn');
  assert.equal(statusCopy({ ...base, tracking: 'LIMITED' }).tone, 'warn');
  assert.equal(statusCopy({ ...base, markerVisible: false }).tone, 'warn');
  assert.match(statusCopy(base).hint, /부품 인식 결과가 아닙니다/);
  const texts = [];
  for (const phase of PHASES) for (const tracking of ['TRACKING', 'LIMITED', 'LOST']) for (const surface of [true, false]) {
    const copy = statusCopy({ ...base, phase, tracking, surface });
    texts.push(copy.title, copy.hint);
  }
  for (const code of ['ANCHORS_UNAVAILABLE', 'NO_SURFACE', 'ANCHOR_FAILED', 'REFERENCE_RESET']) texts.push(noticeText(code));
  for (const code of ['INSECURE_CONTEXT', 'NO_WEBXR_API', 'AR_NOT_SUPPORTED', 'HIT_TEST_NOT_SUPPORTED', 'PERMISSION_DENIED', 'FRAME_ERROR']) texts.push(reasonText(code));
  for (const text of texts) {
    assert.doesNotMatch(text, /%|정확|정상|안전|인식했|인식됨|인식 성공|자동으로 찾/, text);
  }
});

// ---- controller lifecycle -------------------------------------------------------------------------------
test('a tap places on the next active frame through a real anchor, not inside the select event', async () => {
  const t = await started();
  t.env.step();
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.ok(t.view.reticle, 'reticle follows the hit test');
  t.env.select();
  assert.equal(t.controller.state.phase, 'PLACING');
  assert.equal(t.env.anchors.length, 0, 'no anchor is requested outside an active frame');
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(t.controller.state.markerMode, 'ANCHOR');
  assert.equal(live(t.env).length, 1);
  t.env.step();
  assert.equal(t.view.reticle, null);
  assert.ok(t.view.marker);
});

test('marker pose comes from the anchor every frame, so tracker corrections move it', async () => {
  const t = await started();
  await place(t);
  t.env.step();
  const before = t.view.marker[14];
  t.env.anchorOffset = [0, 0, 0.05];
  t.env.viewer = translation(0.3, 0, 0);
  t.env.step();
  assert.ok(Math.abs(t.view.marker[14] - before - 0.05) < 1e-6);
});

test('double tap creates one anchor and tap without surface or tracking does nothing', async () => {
  const t = await started();
  t.env.step();
  t.env.select();
  t.env.select();
  t.env.step();
  await tick();
  assert.equal(t.env.anchors.length, 1);

  const u = await started({ hit: null });
  u.env.step();
  assert.equal(u.controller.requestPlace(), false);
  assert.equal(u.env.anchors.length, 0);

  const v = await started();
  v.env.step();
  v.env.tracking = 'LOST';
  v.env.step();
  v.env.select();
  v.env.step();
  await tick();
  assert.equal(v.controller.state.phase, 'AIMING');
  assert.equal(v.env.anchors.length, 0);
});

test('surface lost between the tap and the next frame fails without creating an anchor', async () => {
  const t = await started();
  t.env.step();
  t.env.select();
  t.env.hit = null;
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.equal(t.controller.state.notice, 'NO_SURFACE');
  assert.equal(t.env.anchors.length, 0);
});

test('re-placing deletes the old anchor only after the new one exists', async () => {
  const t = await started();
  await place(t);
  const [first] = t.env.anchors;
  t.controller.reposition();
  t.env.step();
  assert.equal(t.controller.state.phase, 'REPOSITIONING');
  assert.equal(t.view.dim, true);
  assert.ok(t.view.reticle);
  t.env.anchorMode = 'hold';
  t.env.hit = translation(0.1, -0.2, -0.6);
  t.env.step();
  t.controller.requestPlace();
  t.env.step();
  assert.equal(first.deleted, false, 'old marker stays until replaced');
  t.env.heldAnchors[0].resolve();
  await tick();
  assert.equal(first.deleted, true);
  assert.equal(live(t.env).length, 1);
  t.env.step();
  assert.ok(Math.abs(t.view.marker[12] - 0.1) < 1e-6);
});

test('a failed re-placement keeps the existing marker', async () => {
  const t = await started();
  await place(t);
  t.controller.reposition();
  t.env.step();
  t.env.anchorMode = 'reject';
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'REPOSITIONING');
  assert.equal(t.controller.state.notice, 'ANCHOR_FAILED');
  assert.equal(t.controller.state.markerMode, 'ANCHOR');
  assert.equal(live(t.env).length, 1);
  t.controller.cancelReposition();
  assert.equal(t.controller.state.phase, 'PLACED');
});

test('removing deletes the anchor and clears the marker', async () => {
  const t = await started();
  await place(t);
  t.controller.remove();
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.equal(t.view.marker, null);
  assert.equal(live(t.env).length, 0);
  t.env.step();
  assert.equal(t.view.marker, null);
  assert.ok(t.view.reticle);
});

test('late anchor after session end is deleted and not adopted', async () => {
  const t = await started();
  await place(t);
  t.controller.reposition();
  t.env.step();
  t.env.anchorMode = 'hold';
  t.controller.requestPlace();
  t.env.step();
  await t.controller.stop();
  assert.equal(t.controller.state.phase, 'ENDED');
  t.env.heldAnchors[0].resolve();
  await tick();
  assert.equal(live(t.env).length, 0);
  assert.equal(t.controller.state.phase, 'ENDED');
});

test('removing during a pending first-marker re-aim cancels a late anchor', async () => {
  const t = await started();
  await place(t);
  t.controller.reposition();
  t.env.step();
  t.env.select();
  t.controller.remove(); // Ignored while PLACING, so the request still completes against one owner.
  assert.equal(t.controller.state.phase, 'PLACING');
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(live(t.env).length, 1);
  t.controller.reposition();
  t.env.step();
  t.env.anchorMode = 'hold';
  t.env.select();
  t.controller.cancelReposition(); // Ignored while PLACING as well.
  t.env.step();
  t.env.heldAnchors[0].resolve();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(live(t.env).length, 1);
});

test('rejected first placement returns to aiming with a retryable notice', async () => {
  const t = await started({ anchorMode: 'reject' });
  t.env.step();
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.equal(t.controller.state.notice, 'ANCHOR_FAILED');
  assert.equal(t.controller.state.markerMode, null);
  t.env.anchorMode = 'resolve';
  t.env.step();
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
});

test('a createAnchor that throws synchronously does not stop the frame loop', async () => {
  const t = await started({ anchorMode: 'throw' });
  t.env.step();
  t.controller.requestPlace();
  t.env.step();
  assert.equal(t.controller.state.notice, 'ANCHOR_FAILED');
  assert.equal(t.env.step(), true);
});

test('without the anchors feature the marker uses the hit pose and says so', async () => {
  const t = await started({ grant: { 'dom-overlay': true } });
  t.env.step();
  assert.equal(t.controller.state.notice, 'ANCHORS_UNAVAILABLE');
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.markerMode, 'HIT_POSE');
  assert.equal(t.controller.state.notice, 'ANCHORS_UNAVAILABLE');
  assert.equal(t.env.anchors.length, 0);
  t.env.step();
  assert.ok(t.view.marker);
  const held = t.view.marker[13];
  t.env.hit = translation(1, 1, 1);
  t.env.step();
  assert.equal(t.view.marker[13], held, 'a placed marker no longer follows the hit test');
});

test('a reference space reset drops a hit-pose marker but keeps an anchored one', async () => {
  const t = await started({ grant: { 'dom-overlay': true } });
  await place(t);
  t.env.resetSpace();
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.equal(t.controller.state.notice, 'REFERENCE_RESET');
  t.env.step();
  assert.equal(t.view.marker, null);

  const u = await started();
  await place(u);
  u.env.resetSpace();
  assert.equal(u.controller.state.phase, 'PLACED');
  assert.equal(live(u.env).length, 1);
});

test('NotSupportedError from createAnchor downgrades later placements to a labelled hit pose', async () => {
  const t = await started({ enabledFeaturesVisible: false, grant: { 'dom-overlay': true } });
  t.env.step();
  assert.equal(t.controller.state.anchors, true, 'unknown grant is tried first');
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.anchors, false);
  t.env.step();
  t.controller.requestPlace();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.markerMode, 'HIT_POSE');
});

test('tracking loss hides the marker and warns; recovery restores it from the same anchor', async () => {
  const t = await started();
  await place(t);
  for (const tracking of ['LOST', 'LIMITED']) {
    t.env.tracking = tracking;
    t.env.step();
    assert.equal(t.controller.state.tracking, tracking);
    assert.equal(t.view.marker, null, 'no marker without a trustworthy viewer pose');
    assert.equal(statusCopy(t.controller.state).tone, 'warn');
  }
  t.env.tracking = 'TRACKING';
  t.env.step();
  assert.ok(t.view.marker);
  assert.equal(t.env.anchors.length, 1);
});

test('an anchor the device stopped tracking is hidden with a warning instead of drawn stale', async () => {
  const t = await started();
  await place(t);
  t.env.anchorTracked = false;
  t.env.step();
  assert.equal(t.view.marker, null);
  assert.equal(t.controller.state.markerVisible, false);
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(statusCopy(t.controller.state).title, '표시 추적 중단');
});

test('blurred session blocks placement and reports a pause', async () => {
  const t = await started();
  t.env.step();
  t.env.setVisibility('visible-blurred');
  assert.equal(t.controller.requestPlace(), false);
  assert.equal(statusCopy(t.controller.state).title, 'AR 일시 중지');
  t.env.setVisibility('visible');
  assert.equal(t.controller.requestPlace(), true);
});

test('a hidden session ends and releases everything; visible-blurred only pauses', async () => {
  const t = await started();
  await place(t);
  const [anchor] = t.env.anchors;
  t.env.setVisibility('visible-blurred');
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(t.env.currentSession.ended, false);
  t.env.setVisibility('hidden');
  await tick();
  assert.equal(t.controller.state.phase, 'ENDED');
  assert.equal(t.env.currentSession.ended, true);
  assert.equal(anchor.deleted, true);
  assert.equal(t.env.hitSources[0].cancelled, true);
  assert.equal(t.view.disposed, 1);
});

test('system session end releases hit source, anchor and view exactly once, and allows a restart', async () => {
  const t = await started();
  await place(t);
  const firstView = t.view, [anchor] = t.env.anchors;
  await t.env.currentSession.end();
  assert.equal(t.controller.state.phase, 'ENDED');
  assert.equal(t.controller.state.markerMode, null);
  assert.equal(anchor.deleted, true);
  assert.equal(t.env.hitSources[0].cancelled, true);
  assert.equal(firstView.disposed, 1);
  await t.controller.stop();
  assert.equal(firstView.disposed, 1);
  assert.equal(await t.controller.start(), true);
  assert.equal(t.controller.state.phase, 'AIMING');
  assert.equal(t.controller.state.markerMode, null, 'markers never survive into a new session');
  assert.equal(t.env.sessions.length, 2);
});

test('session request failures land in FAILED with the mapped reason and can retry', async () => {
  const t = await setup({ requestError: 'NotAllowedError' });
  assert.equal(await t.controller.start(), false);
  assert.equal(t.controller.state.phase, 'FAILED');
  assert.equal(t.controller.state.reason, 'PERMISSION_DENIED');
  assert.equal(t.views.length, 0);
  t.env.requestError = null;
  assert.equal(await t.controller.start(), true);
});

test('double start issues one request', async () => {
  const t = await setup({ holdRequest: true });
  const first = t.controller.start();
  assert.equal(await t.controller.start(), false);
  assert.equal(t.env.requests.length, 1);
  t.env.heldRequest.resolve();
  assert.equal(await first, true);
});

test('leaving the page during a pending request ends the late session', async () => {
  const t = await setup({ holdRequest: true });
  const pending = t.controller.start();
  await t.controller.dispose();
  t.env.heldRequest.resolve();
  assert.equal(await pending, false);
  assert.equal(t.env.sessions[0].ended, true);
  assert.equal(t.views.length, 0);
});

test('setup failures end the session, dispose the view and report a reason', async () => {
  const noHit = await setup({ hitSourceError: true });
  assert.equal(await noHit.controller.start(), false);
  await tick();
  assert.equal(noHit.controller.state.phase, 'FAILED');
  assert.equal(noHit.controller.state.reason, 'SESSION_SETUP_FAILED');
  assert.equal(noHit.env.sessions[0].ended, true);
  assert.equal(noHit.view.disposed, 1);

  const noAttach = await setup({}, { attachError: true });
  assert.equal(await noAttach.controller.start(), false);
  assert.equal(noAttach.env.sessions[0].ended, true);
  assert.equal(noAttach.controller.state.reason, 'SESSION_SETUP_FAILED');
});

test('hit-test source asks for plane and point, and falls back to the spec default', async () => {
  const t = await started();
  assert.deepEqual(t.env.hitSources[0].init.entityTypes, ['plane', 'point']);
  const u = await started({ pointHitError: true });
  assert.equal(u.env.hitSources[0].init.entityTypes, undefined);
  assert.equal(u.controller.state.phase, 'AIMING');
});

test('session ended while setup is in progress does not reach AIMING', async () => {
  const t = await setup();
  const pending = t.controller.start();
  await tick();
  await t.env.currentSession?.end().catch(() => {});
  await pending;
  assert.notEqual(t.controller.state.phase, 'AIMING');
});

test('an error inside a frame ends the session rather than freezing a stale marker', async () => {
  const t = await started();
  await place(t);
  t.view.render = () => { throw Error('render'); };
  t.env.step();
  assert.equal(t.controller.state.phase, 'FAILED');
  assert.equal(t.controller.state.reason, 'FRAME_ERROR');
  assert.equal(t.env.sessions[0].ended, true);
  assert.equal(live(t.env).length, 0);
});

test('without a DOM overlay tapping alternates re-aim and place so the marker is not stuck', async () => {
  const t = await started({ grant: { anchors: true } });
  t.env.step();
  assert.equal(t.controller.state.overlay, false);
  t.env.select();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
  t.env.select();
  assert.equal(t.controller.state.phase, 'REPOSITIONING');
  t.env.step();
  t.env.select();
  t.env.step();
  await tick();
  assert.equal(t.controller.state.phase, 'PLACED');
  assert.equal(live(t.env).length, 1);
});

// ---- marker geometry ------------------------------------------------------------------------------------
test('3D arrow points at the chosen point along the surface normal', () => {
  const group = buildMarkerGroup(THREE);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  assert.ok(Math.abs(box.min.y) < 0.001, 'base rests on the chosen surface');
  assert.ok(box.max.y > 0.12, 'arrow rises off the surface');
  const cone = group.children.find(mesh => mesh.geometry.type === 'ConeGeometry');
  cone.geometry.computeBoundingBox();
  const tip = new THREE.Vector3(0, cone.geometry.boundingBox.max.y, 0).applyMatrix4(cone.matrixWorld);
  assert.ok(tip.y < cone.position.y, 'cone tip is the end nearest the surface');
  assert.ok(Math.hypot(tip.x, tip.z) < 1e-6, 'tip is centered on the point');
});

// ---- host boundary --------------------------------------------------------------------------------------
const serve = async options => {
  const server = http.createServer(createHandler(undefined, options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { root: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
};
const MARK = 'data-webxr-guide';

test('default server has no guide route, no page mark and unchanged policy headers', async () => {
  const s = await serve();
  try {
    for (const [served] of WEBXR_GUIDE_FILES) assert.equal((await fetch(`${s.root}/webxr/${served}`)).status, 404, served);
    const home = await fetch(`${s.root}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=()');
    assert.ok(!(await home.text()).includes(MARK));
  } finally { await s.close(); }
});

test('flagged server marks the page and serves exactly the guide files with the same CSP', async () => {
  const s = await serve({ webxrGuide: true }), plain = await serve();
  try {
    const home = await fetch(`${s.root}/`);
    assert.match(home.headers.get('permissions-policy'), /^camera=\(self\), microphone=\(\), geolocation=\(\), xr-spatial-tracking=\(self\)$/);
    assert.equal(home.headers.get('content-security-policy'), (await fetch(`${plain.root}/`)).headers.get('content-security-policy'));
    assert.match(await home.text(), /<body data-step="intro" data-webxr-guide="enabled">/);
    for (const [served] of WEBXR_GUIDE_FILES) assert.equal((await fetch(`${s.root}/webxr/${served}`)).status, 200, served);
    assert.match((await fetch(`${s.root}/webxr/webxr.css`)).headers.get('content-type'), /text\/css/);
    // The standalone page, which lost the checklist on return, must stay gone.
    for (const route of ['/webxr/', '/webxr/index.html', '/webxr/webxr-entry.mjs']) assert.equal((await fetch(s.root + route)).status, 404, route);
    assert.equal((await fetch(`${s.root}/webxr/../package.json`)).status, 404);
    assert.equal((await fetch(`${s.root}/webxr/%2e%2e/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${s.root}/node_modules/three/build/three.module.min.js`)).status, 404);
  } finally { await s.close(); await plain.close(); }
});

test('the experiment flag takes one exact value and refuses anything else', () => {
  assert.equal(webxrGuideEnabled({}), false);
  assert.equal(webxrGuideEnabled({ CARSCOPE_WEBXR_GUIDE: '' }), false);
  assert.equal(webxrGuideEnabled({ CARSCOPE_WEBXR_GUIDE: 'EXPERIMENT' }), true);
  assert.equal(webxrGuideEnabled({}, ['--webxr-guide']), true);
  for (const value of ['0', '1', 'true', 'experiment', 'ON']) assert.throws(() => webxrGuideEnabled({ CARSCOPE_WEBXR_GUIDE: value }), /INVALID_CARSCOPE_WEBXR_GUIDE/, value);
  assert.throws(() => markWebXrGuidePage('<body>'), /MARKER_MISSING/, 'a changed page cannot silently lose the experiment');
});

test('staging omits the guide by default and includes it only when requested', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'carscope-webxr-'));
  try {
    const plain = path.join(dir, 'plain'), flagged = path.join(dir, 'flagged');
    await buildStaging({ origin: 'https://carscope-test.vercel.app/', outputDirectory: plain });
    assert.deepEqual((await readdir(plain)).sort(), [...PUBLIC_FILES, 'handoff.json', 'qr.svg', 'build-info.json'].sort());
    assert.equal(await readFile(path.join(plain, 'index.html'), 'utf8'), await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), 'default page is copied byte for byte');
    await buildStaging({ origin: 'https://carscope-test.vercel.app/', outputDirectory: flagged, webxrGuide: true });
    assert.deepEqual((await readdir(path.join(flagged, 'webxr'))).sort(), WEBXR_GUIDE_FILES.map(([served]) => served).sort());
    assert.ok((await readFile(path.join(flagged, 'index.html'), 'utf8')).includes(MARK));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the only link from product code to the guide is one dynamic import behind the host mark, in the washer flow', async () => {
  assert.ok(!MOBILE_MODULES.some(name => /webxr|three/.test(name)));
  const hits = [];
  for (const name of ['index.html', 'app-entry.mjs', ...MOBILE_MODULES]) {
    if (/webxr|three\.module/i.test(await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'))) hits.push(name);
  }
  assert.deepEqual(hits, ['app.mjs']);
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  assert.equal([...app.matchAll(/import\('[^']*webxr[^']*'\)/g)].length, 1);
  assert.doesNotMatch(app, /^import .*webxr/m, 'never a static import, which would break hosts that do not serve it');
  const gate = app.indexOf("document.body.dataset.webxrGuide === 'enabled'"), load = app.indexOf("import('./webxr/webxr-guide.mjs')");
  assert.ok(gate > 0 && gate < load, 'the import sits behind the host mark');
  assert.ok(app.indexOf('async function startWasherInspectionPage') < gate, 'washer flow only');
});

test('guide source has no storage, network, sync, result-record or location-rewrite path', async () => {
  for (const [, source] of WEBXR_GUIDE_FILES.filter(([served]) => !served.includes('three'))) {
    const text = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|cookie|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|sync-client|SyncClient|MobileSync|completeInspection|startInspection|noteAids|getUserMedia|location\.(assign|replace|href|hash|search)|replaceState/, source);
  }
  const guide = await readFile(new URL('../public/webxr/webxr-guide.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...guide.matchAll(/from '([^']+)'/g)].map(match => match[1]).sort(), ['./webxr-capability.mjs', './webxr-controller.mjs', './webxr-state.mjs', './webxr-view.mjs']);
  assert.match(guide, /history\.pushState\(\{ carscopeWebXrGuide: true \}, ''\)/, 'pushState takes no URL, so nothing can reach the address bar');
});

test('USE_CAMERA keeps the answers and the attempt, and only applies to a manual checklist', () => {
  let state = inspectionReduce(inspectionInitial(), { type: 'START', camera: false });
  state = inspectionReduce(state, { type: 'TOGGLE', id: 'parked', value: true });
  const next = inspectionReduce(state, { type: 'USE_CAMERA' });
  assert.equal(next.mode, 'camera');
  assert.equal(next.step, 'check');
  assert.equal(next.checks.parked, true);
  assert.equal(next.record.inspectionId, state.record.inspectionId);
  assert.equal(inspectionReduce(next, { type: 'USE_CAMERA' }), next);
  const fresh = inspectionInitial();
  assert.equal(inspectionReduce(fresh, { type: 'USE_CAMERA' }), fresh);
});
