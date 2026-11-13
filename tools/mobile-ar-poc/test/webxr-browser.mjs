// P9-XR-C browser check: real Chrome, real WebGL (software), real Three.js and the real inspection page under the server CSP.
// The XR runtime is the test double from fake-webxr.mjs, with one exception: the first scenario uses Chrome's own WebXR.
// The 2D camera is real getUserMedia over Chrome's fake capture device.
// This proves page logic and that the marker is rendered world-fixed from poses. It does not prove device tracking.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHandler } from '../server.mjs';
import { taskLinks } from '../public/inspection-tasks.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p9-xr-c');
await mkdir(output, { recursive: true });

const result = { kind: 'SYNTHETIC_XR_RUNTIME', realDevice: 'NOT_RUN_DEFERRED_TO_E2E', realTracking: 'NOT_RUN_DEFERRED_TO_E2E', checks: [], errors: [] };
const pass = message => { result.checks.push(`PASS ${message}`); console.log(`PASS ${message}`); };

const listen = async options => {
  const server = http.createServer(createHandler(undefined, options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
};
const server = await listen({ webxrGuide: true }), plainServer = await listen();
const root = `http://127.0.0.1:${server.address().port}`;
const plainRoot = `http://127.0.0.1:${plainServer.address().port}`;
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

const FX = 1.5 * (844 / 390), FY = 1.5;
const toScreen = (x, y, z) => ({ x: (FX * x / -z + 1) * 195, y: (1 - FY * y / -z) * 422 });

// Records who holds the camera at the moment either side asks for it. Runs before the page's own code.
const CAMERA_PROBE = `
  window.__media = { streams: [], liveAtXrRequest: [], xrLiveAtCameraRequest: [], holdCamera: false, release: null };
  const media = window.__media, realGum = navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
  const liveTracks = () => media.streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length;
  media.liveTracks = liveTracks;
  if (realGum) navigator.mediaDevices.getUserMedia = async constraints => {
    media.xrLiveAtCameraRequest.push((window.__env?.sessions ?? []).filter(s => !s.ended).length);
    if (media.holdCamera) await new Promise(resolve => { media.release = resolve; });
    const stream = await realGum(constraints);
    media.streams.push(stream);
    return stream;
  };
  if (window.__env) {
    const realRequest = window.__env.xr.requestSession;
    window.__env.xr.requestSession = (...args) => { media.liveAtXrRequest.push(liveTracks()); return realRequest(...args); };
  }
`;

let browser;
const openPage = async ({ viewport = { width: 390, height: 844 }, fake, url = '/', host = root, prepare } = {}) => {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2, permissions: ['camera'] });
  if (fake !== undefined) await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  await context.addInitScript(CAMERA_PROBE);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const problems = [], requests = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/net::ERR_NO_BUFFER_SPACE/.test(message.text())) problems.push(message.text()); }); // The page retries that code itself: page-start-guard.js.
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  if (prepare) await prepare(page);
  // What was still loading when a page never started: the timeout alone says nothing about why.
  const pending = new Set(), bad = [], failed = [];
  page.on('request', request => pending.add(request.url()));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => { pending.delete(request.url()); failed.push(`${request.url()} ${request.failure()?.errorText}`); });
  page.on('response', response => { if (response.status() >= 400) bad.push(`${response.url()} ${response.status()}`); });
  const started = Date.now();
  await page.goto(host + (host===root?url.replace(/^\//,'/webxr-guide.html'):url));
  try {
    if(host===root)await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);else await page.locator('h1').waitFor();
  } catch (error) {
    const seen = await page.evaluate(() => ({ ready: document.readyState, step: document.body?.dataset.step, resources: performance.getEntriesByType('resource').length })).catch(failure => failure.name);
    throw new Error(`${error.message}\nstart diagnostics after ${Date.now() - started}ms: ${JSON.stringify({ url, seen, pending: [...pending], failed, bad, requested: requests.length, problems })}`);
  }
  return { page, context, problems, requests };
};
const guideReady = page => page.waitForFunction(() => window.__webXrGuide?.capability);
const phase = page => page.evaluate(() => window.__webXrGuide.state?.phase ?? null);
const waitPhase = (page, name) => page.waitForFunction(value => window.__webXrGuide?.state?.phase === value, name);
const inspection = page => page.evaluate(() => {
  const { step, mode, checks, choice, record } = window.__selfInspection.state;
  return { step, mode, checks, choice, inspectionId: record?.inspectionId ?? null, aids: record?.aids ?? null };
});
const liveTracks = page => page.evaluate(() => window.__media.liveTracks());
const step = (page, count = 1) => page.evaluate(n => { for (let i = 0; i < n; i++) window.__env.step(); }, count);
const settle = (page, count = 2) => page.evaluate(async n => {
  for (let i = 0; i < n; i++) { window.__env.step(); await new Promise(resolve => setTimeout(resolve)); }
}, count);
const setViewer = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  window.__env.viewer = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, a, b, c, 1]);
}, [x, y, z]);
const marks = page => page.evaluate(() => window.__env.readMarks());
const openGuide = async page => {
  await guideReady(page);
  await page.locator('#xr-entry-open').click();
  await waitPhase(page, 'READY');
};
const startAr = async page => {
  await page.locator('#xr-start').click();
  await waitPhase(page, 'AIMING');
  await settle(page);
};
const placeMarker = async page => {
  await page.evaluate(() => window.__env.select());
  await settle(page, 3);
  await waitPhase(page, 'PLACED');
};
const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });
const saveFrame = async (page, name) => {
  const data = await page.evaluate(() => window.__env.framePng());
  await writeFile(path.join(output, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
};
const close = async ({ context, problems }, label) => {
  assert.deepEqual(problems, [], `${label}: page errors and CSP violations`);
  await context.close();
};

try {
  browser = await chromium.launch({
    channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  result.browser = browser.version();

  { // Chrome's own WebXR on a desktop: the genuine unsupported path, with no test double.
    const session = await openPage({ url: '/#v=1&task=washer-fluid' });
    const { page, requests } = session;
    await guideReady(page);
    const hasXr = await page.evaluate(() => Boolean(navigator.xr));
    const reason = await page.evaluate(() => window.__webXrGuide.capability.reason);
    assert.equal(reason, hasXr ? 'AR_NOT_SUPPORTED' : 'NO_WEBXR_API');
    assert.equal(await page.locator('#xr-entry-open').isVisible(), false, 'no entry on an unsupported device');
    assert.match(await page.locator('#xr-entry-unavailable').textContent(), /쓸 수 없어요.*일반 카메라나 카메라 없는 점검/);
    assert.equal(await page.locator('#xr-method-camera').isVisible(), false, 'nothing to choose between without AR');
    assert.equal(await page.locator('#xr-methods-title').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.dataset.xrMethods), undefined);
    assert.equal(await page.locator('#primary').isVisible(), true, "the page's own button stays");
    assert.equal(await page.locator('#primary').textContent(), '카메라로 점검 시작');
    assert.equal(requests.some(r => r.url.includes('three')), false, 'unsupported devices do not download Three.js');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, 'unsupported');
    await page.locator('#manual-start').click();
    assert.equal((await inspection(page)).step, 'check');
    assert.equal(await page.locator('#xr-entry').isVisible(), false, 'the reason is shown once, on the first step');
    await close(session, 'unsupported');
    pass(`real Chrome without AR hides the entry, shows the reason and keeps the 2D and manual methods (navigator.xr ${hasXr ? 'present' : 'absent'})`);
  }

  { // Flow: washer -> guide -> AR -> place -> checklist -> user's own result.
    const session = await openPage({ fake: {} });
    const { page, requests } = session;
    await guideReady(page);
    // The method choice: three rows, in this order, all on one screen of a phone, with no bottom button competing.
    assert.equal(await page.locator('#xr-methods-title').textContent(), '점검 방법을 골라 주세요');
    assert.equal(await page.locator('#xr-entry-open strong').textContent(), '3D AR로 위치 찾기 · 실험');
    assert.equal(await page.locator('#xr-method-camera strong').textContent(), '일반 카메라로 찾기');
    assert.equal(await page.locator('#manual-start').textContent(), '카메라 없이 점검하기');
    assert.equal(await page.locator('#primary').isVisible(), false, 'the camera row replaces the bottom button on this step');
    const rows = await page.evaluate(() => ['xr-entry-open', 'xr-method-camera', 'manual-start'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; }));
    assert.ok(rows[0].bottom <= rows[1].top && rows[1].bottom <= rows[2].top, 'rows are in order');
    assert.ok(rows.every(row => row.height >= 48 && row.bottom <= 844), `every method fits the first screen at 390x844: ${JSON.stringify(rows)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(requests.some(r => r.url.includes('three')), false, 'Three.js waits until the user opens the guide');
    await shot(page, 'entry-intro');
    const before = await inspection(page);
    await page.locator('#xr-entry-open').click();
    await waitPhase(page, 'READY');
    assert.equal(await page.locator('main >> nth=0').isVisible(), false, 'inspection page is hidden, not removed');
    assert.match(await page.locator('#xr-guide-page .notice').textContent(), /부품을 인식하지 않아요.*AI가 위치를 찾아 주는 기능이 아니고/);
    assert.equal(await page.locator('#xr-start').isVisible(), true);
    const startBox = await page.locator('#xr-start').boundingBox();
    assert.ok(startBox.y + startBox.height <= 844 && startBox.height >= 48, 'AR start is under the thumb without scrolling');
    assert.equal(await page.locator('#xr-support-ar').textContent(), '지원');
    assert.deepEqual(await inspection(page), before, 'opening the guide does not start an attempt');
    await shot(page, 'ready');
    await page.locator('#xr-start').click();
    await waitPhase(page, 'AIMING');
    const request = await page.evaluate(() => window.__env.requests[0]);
    assert.deepEqual(request, { mode: 'immersive-ar', requiredFeatures: ['local', 'hit-test'], optionalFeatures: ['anchors', 'dom-overlay'], hasOverlayRoot: true });
    assert.equal(await page.locator('#xr-guide-page').isVisible(), false);
    await settle(page);
    await page.waitForFunction(() => document.getElementById('xr-status').textContent === '표면 찾음');
    await shot(page, 'aiming');

    // Aiming: the white reticle sits on the projected hit point.
    const hitPoint = toScreen(0, -0.2, -0.6), aim = await marks(page);
    assert.ok(aim.white.count > 20, 'reticle is drawn');
    assert.equal(aim.blue.count, 0);
    assert.ok(Math.hypot(aim.white.x - hitPoint.x, aim.white.y - hitPoint.y) < 8, `reticle at hit point: ${JSON.stringify(aim.white)} vs ${JSON.stringify(hitPoint)}`);
    await saveFrame(page, 'frame-aiming');

    // Tapping a control must not also place a marker through the scene.
    const box = await page.locator('#xr-hint').boundingBox();
    assert.equal(await page.evaluate(([x, y]) => window.__env.tap(x, y), [box.x + 5, box.y + 5]), false);
    assert.equal(await phase(page), 'AIMING');
    assert.equal(await page.evaluate(() => window.__env.tap(195, 200)), true);
    await settle(page, 3);
    await waitPhase(page, 'PLACED');
    assert.equal(await page.locator('#xr-status').textContent(), '공간에 고정됨 · 내가 지정한 위치');
    assert.match(await page.locator('#xr-hint').textContent(), /부품을 인식한 결과가 아니에요/);
    await shot(page, 'placed');

    // World-fixed proof: phone motion must shift the marker on screen by the projected amount.
    await settle(page);
    const first = await marks(page);
    assert.ok(first.blue.count > 100, 'arrow is drawn');
    await saveFrame(page, 'frame-placed');
    await setViewer(page, 0.08, 0, 0);
    await settle(page);
    const moved = await marks(page);
    const expected = toScreen(-0.08, -0.2, -0.6).x - hitPoint.x;
    assert.ok(Math.abs(moved.blue.x - first.blue.x - expected) < 6, `sideways shift ${moved.blue.x - first.blue.x} vs expected ${expected}`);
    assert.ok(Math.abs(moved.blue.y - first.blue.y) < 6, 'sideways motion does not change height');
    assert.ok(Math.abs(expected) > 60, 'the expected motion is large enough to mean something');
    await saveFrame(page, 'frame-moved-sideways');
    await setViewer(page, 0, 0, -0.25);
    await settle(page);
    const closer = await marks(page);
    assert.ok(closer.blue.count > first.blue.count * 1.5, `arrow grows when the phone approaches: ${first.blue.count} -> ${closer.blue.count}`);
    await saveFrame(page, 'frame-moved-closer');
    await setViewer(page, 0, 0, 0);
    await settle(page);
    const back = await marks(page);
    assert.ok(Math.hypot(back.blue.x - first.blue.x, back.blue.y - first.blue.y) < 1, 'returning to the start pose restores the marker');
    pass('marker shifts on screen by the projected camera motion, so it is world-fixed rather than screen-fixed');

    // Tracking loss: no marker, warning, then recovery from the same anchor.
    await page.evaluate(() => { window.__env.tracking = 'LOST'; });
    await settle(page);
    assert.equal((await marks(page)).blue.count, 0);
    assert.equal(await page.locator('#xr-status').textContent(), '추적 끊김');
    assert.equal(await page.locator('#xr-status').getAttribute('data-tone'), 'warn');
    await shot(page, 'tracking-lost');
    await page.evaluate(() => { window.__env.tracking = 'LIMITED'; });
    await settle(page);
    assert.equal((await marks(page)).blue.count, 0);
    assert.equal(await page.locator('#xr-status').textContent(), '추적 불안정');
    await page.evaluate(() => { window.__env.tracking = 'TRACKING'; });
    await settle(page);
    assert.ok((await marks(page)).blue.count > 100);
    assert.equal(await page.evaluate(() => window.__env.anchors.length), 1);
    pass('tracking loss hides the marker and warns, recovery restores the same anchor');

    // Re-place and remove.
    await page.locator('#xr-reposition').click();
    await settle(page);
    assert.equal(await phase(page), 'REPOSITIONING');
    assert.equal(await page.locator('#xr-remove').isVisible(), true);
    await shot(page, 'repositioning');
    await page.evaluate(() => { window.__env.hit = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, -0.2, -0.6, 1]); });
    await settle(page);
    await page.locator('#xr-place').click();
    await settle(page, 3);
    await waitPhase(page, 'PLACED');
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.__env.anchors.map(a => a.deleted)), [true, false]);
    const replaced = await marks(page);
    assert.ok(replaced.blue.x - first.blue.x > 40, 'marker moved to the new point');
    await page.locator('#xr-remove').click();
    await settle(page);
    assert.equal(await phase(page), 'AIMING');
    assert.equal((await marks(page)).blue.count, 0);
    assert.deepEqual(await page.evaluate(() => window.__env.anchors.map(a => a.deleted)), [true, true]);
    pass('re-placing replaces the anchor and removing deletes it');

    // End and restart: the marker is gone and a fresh session works. No method is chosen for the user.
    await placeMarker(page);
    await page.locator('#xr-exit').click();
    await waitPhase(page, 'ENDED');
    assert.equal(await page.locator('#xr-guide-page').isVisible(), true);
    assert.equal(await page.locator('#xr-overlay').isVisible(), false);
    assert.equal(await page.locator('#xr-ended').isVisible(), true);
    assert.equal(await page.locator('#xr-to-checklist').isVisible(), true);
    assert.equal(await page.locator('#xr-to-camera').isVisible(), true);
    assert.equal(await liveTracks(page), 0, 'no camera starts by itself after AR');
    assert.equal(await page.evaluate(() => window.__env.anchors.every(a => a.deleted)), true);
    assert.equal(await page.evaluate(() => window.__env.hitSources[0].cancelled), true);
    await shot(page, 'ended');
    await page.locator('#xr-start').click();
    await waitPhase(page, 'AIMING');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__webXrGuide.state.markerMode), null);
    assert.equal((await marks(page)).blue.count, 0);
    pass('session end releases every resource and a restart begins with no marker');

    // Guide end -> the existing checklist in this same document -> the user's own result.
    await placeMarker(page);
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true);
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    const checklist = await inspection(page);
    assert.equal(checklist.step, 'check');
    assert.equal(checklist.mode, 'manual');
    assert.deepEqual(checklist.checks, { parked: false, located: false, observed: false }, 'a marker does not tick anything');
    assert.deepEqual(checklist.aids, { cameraUsed: false, locationMarked: false }, 'the guide does not touch the record');
    assert.equal(await page.locator('#checklist').isVisible(), true, 'checklist is one tap from AR, with no extra intro step');
    assert.equal(await page.locator('main >> nth=0').isVisible(), true);
    await shot(page, 'checklist-after-ar');
    await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(box => box.click()));
    await page.click('#primary');
    await page.click('[data-status="OK"]');
    await page.click('#primary');
    await page.click('#primary');
    await page.waitForSelector('body[data-step="done"]');
    assert.equal(await page.evaluate(() => window.__selfInspection.state.record.status), 'OK');
    assert.equal(await page.locator('#xr-entry').evaluate(entry => entry.hidden), true, 'not offered after the result');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith(`${root}/`)), 'only same-origin GET requests');
    await close(session, 'full flow');
    pass('guide end lands on the checklist in the same document; the user confirms the result; no storage and only same-origin GET under the server CSP');
  }

  { // Checklist answers survive a guide opened in the middle of them.
    const session = await openPage({ fake: {} });
    const { page } = session;
    await guideReady(page);
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const before = await inspection(page);
    assert.equal(before.checks.parked, true);
    await openGuide(page);
    await startAr(page);
    await placeMarker(page);
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.deepEqual(await inspection(page), before, 'same attempt, same answers, same mode');
    assert.equal(await page.locator('#checklist input[value="parked"]').isChecked(), true);

    // History traversal must not undo the page's own scrolling: the entry button sits low on this step.
    await page.locator('#xr-entry-open').scrollIntoViewIfNeeded();
    await openGuide(page);
    await startAr(page);
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => scrollY), 0, 'the checklist starts at its top after AR');
    // The checklist now fits a tall phone, so a short window is what makes this page scroll.
    const fullSize = page.viewportSize();
    await page.setViewportSize({ width: fullSize.width, height: 420 });
    await page.locator('#xr-entry-open').scrollIntoViewIfNeeded();
    const beforeLeave = await page.evaluate(() => scrollY);
    assert.ok(beforeLeave > 0, 'the page is long enough for this check to mean something');
    await openGuide(page);
    await page.locator('#xr-leave').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => scrollY), beforeLeave, 'leaving returns to where the user was');
    await page.setViewportSize(fullSize);

    // Manual checklist -> guide -> user picks the 2D camera: answers stay, and only then does a camera run.
    await openGuide(page);
    await startAr(page);
    await page.locator('#xr-exit').click();
    await waitPhase(page, 'ENDED');
    await page.locator('#xr-to-camera').click();
    await page.waitForFunction(() => window.__media.liveTracks() > 0);
    const camera = await inspection(page);
    assert.equal(camera.step, 'check');
    assert.equal(camera.mode, 'camera');
    assert.equal(camera.inspectionId, before.inspectionId);
    assert.deepEqual(camera.checks, before.checks);
    assert.equal(await page.locator('#stage').isVisible(), true);
    await close(session, 'state kept');
    pass('checklist answers and the attempt id survive AR, including a switch to the 2D camera');
  }

  { // Camera and XR never overlap, in either direction.
    const session = await openPage({ fake: {} });
    const { page } = session;
    await guideReady(page);
    await page.locator('#xr-method-camera').click();
    await page.waitForFunction(() => window.__media.liveTracks() > 0 && !document.getElementById('stop').disabled);
    assert.equal(await page.evaluate(() => document.body.dataset.xrMethods), undefined, 'the choice ends with the first step');
    assert.equal(await page.locator('#primary').isVisible(), true, 'the bottom button is back on the next step');
    assert.equal(await page.locator('#xr-method-camera').isVisible(), false);
    await page.waitForFunction(() => document.getElementById('video').videoWidth > 0);
    const attempt = (await inspection(page)).inspectionId;
    await shot(page, 'entry-locate');
    await page.locator('#xr-entry-open').click();
    assert.equal(await liveTracks(page), 0, 'opening the guide stops the 2D camera at once');
    assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null);
    await waitPhase(page, 'READY');
    await page.evaluate(() => document.getElementById('start').click()); // A stray start while the guide is open.
    await page.waitForTimeout(100);
    assert.equal(await liveTracks(page), 0, 'the 2D camera cannot start under the guide');
    await startAr(page);
    assert.deepEqual(await page.evaluate(() => window.__media.liveAtXrRequest), [0], 'no live camera when the XR session is requested');

    await page.locator('#xr-exit').click();
    await waitPhase(page, 'ENDED');
    assert.equal(await liveTracks(page), 0);
    await page.locator('#xr-to-camera').click();
    await page.waitForFunction(() => window.__media.liveTracks() > 0);
    assert.deepEqual(await page.evaluate(() => window.__media.xrLiveAtCameraRequest), [0, 0], 'no live XR session when the camera is requested');
    assert.equal((await inspection(page)).step, 'locate');
    assert.equal((await inspection(page)).inspectionId, attempt);

    // Leaving the guide on a camera step: the camera stays off until the user starts it, and can then be started.
    await page.locator('#xr-entry-open').click();
    await waitPhase(page, 'READY');
    await page.locator('#xr-leave').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForTimeout(150);
    assert.equal(await liveTracks(page), 0, 'leaving the guide starts no camera');
    assert.equal(await page.locator('#start').isEnabled(), true);
    await page.locator('#start').click();
    await page.waitForFunction(() => window.__media.liveTracks() > 0);

    // Checklist from the locate step ends the camera path without losing the attempt.
    await page.locator('#xr-entry-open').click();
    await waitPhase(page, 'READY');
    await startAr(page);
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await liveTracks(page), 0);
    const checklist = await inspection(page);
    assert.equal(checklist.step, 'check');
    assert.equal(checklist.mode, 'manual');
    assert.equal(checklist.inspectionId, attempt);

    // A camera request still in flight when the guide opens must not come alive afterwards.
    const late = await openPage({ fake: {} });
    await guideReady(late.page);
    await late.page.evaluate(() => { window.__media.holdCamera = true; });
    await late.page.locator('#xr-method-camera').click();
    await late.page.waitForFunction(() => window.__media.release);
    await late.page.locator('#xr-entry-open').click();
    await waitPhase(late.page, 'READY');
    await late.page.evaluate(() => window.__media.release());
    await late.page.waitForFunction(() => window.__media.streams.length === 1);
    await late.page.waitForFunction(() => window.__media.liveTracks() === 0);
    assert.equal(await late.page.evaluate(() => document.getElementById('video').srcObject), null);
    await close(late, 'late camera');
    await close(session, 'camera exclusion');
    pass('the 2D camera is released before XR, cannot start under it, and a late camera grant is discarded');
  }

  { // Every way out releases the session and leaves the page usable.
    const session = await openPage({ fake: {} });
    const { page } = session;
    await guideReady(page);
    await page.locator('#manual-start').click();
    const before = await inspection(page);

    // Back during AR: closes the guide, does not leave the page.
    await page.evaluate(() => { window.__sameDocument = true; });
    await openGuide(page);
    await startAr(page);
    await placeMarker(page);
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'Back stays in the document');
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    assert.equal(await page.evaluate(() => window.__env.anchors.every(a => a.deleted)), true);
    assert.deepEqual(await inspection(page), before);

    // Leave button before any AR, and its history entry is cleaned up.
    const entries = await page.evaluate(() => history.length);
    await openGuide(page);
    await page.locator('#xr-leave').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForTimeout(50);
    assert.ok(await page.evaluate(() => !history.state?.carscopeWebXrGuide), 'its history entry is gone');
    assert.ok(await page.evaluate(n => history.length <= n + 1, entries));
    assert.deepEqual(await inspection(page), before);

    // Session hidden: released, and the panel offers the methods again.
    await openGuide(page);
    await startAr(page);
    await placeMarker(page);
    await page.evaluate(() => window.__env.setVisibility('hidden'));
    await waitPhase(page, 'ENDED');
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    assert.equal(await page.locator('#xr-to-checklist').isVisible(), true);
    await page.locator('#xr-to-checklist').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.deepEqual(await inspection(page), before);

    // The system ends the session.
    await openGuide(page);
    await startAr(page);
    await page.evaluate(() => window.__env.currentSession.end());
    await waitPhase(page, 'ENDED');
    await page.locator('#xr-leave').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);

    // Page hide during AR.
    await openGuide(page);
    await startAr(page);
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); });
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);

    // Reopening at once, before the history step of closing has landed: Back still only closes the guide.
    await guideReady(page);
    await openGuide(page);
    await page.evaluate(() => { document.getElementById('xr-leave').click(); document.getElementById('xr-entry-open').click(); });
    await waitPhase(page, 'READY');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__webXrGuide.open), true, 'closing did not close the reopened guide');
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'Back stayed in the document');
    assert.deepEqual(await inspection(page), before);

    // Repeated cycles keep working and leak nothing.
    const startCount = await page.evaluate(() => window.__env.sessions.length);
    for (let i = 0; i < 3; i++) {
      await openGuide(page);
      await startAr(page);
      await placeMarker(page);
      await page.locator('#xr-return').click();
      await page.waitForFunction(() => !window.__webXrGuide.open);
    }
    assert.equal(await page.evaluate(() => window.__env.sessions.length), startCount + 3);
    assert.equal(await page.evaluate(() => window.__env.sessions.every(s => s.ended)), true);
    assert.equal(await page.evaluate(() => window.__env.anchors.every(a => a.deleted)), true);
    assert.equal(await page.evaluate(() => window.__env.hitSources.every(h => h.cancelled)), true);
    assert.deepEqual(await inspection(page), before);
    await close(session, 'exits');

    // Cancelling while the session request is pending ends the late session.
    const pending = await openPage({ fake: { holdRequest: true } });
    await openGuide(pending.page);
    await pending.page.locator('#xr-start').click();
    await waitPhase(pending.page, 'STARTING');
    await pending.page.locator('#xr-exit').click();
    await pending.page.waitForFunction(() => !window.__webXrGuide.open);
    await pending.page.evaluate(() => window.__env.heldRequest.resolve());
    await pending.page.waitForFunction(() => window.__env.sessions.length === 1 && window.__env.sessions[0].ended);
    assert.equal((await inspection(pending.page)).step, 'intro');
    await close(pending, 'pending cancel');
    pass('Back, leave, hidden session, system end, page hide and cancel-while-starting all release the session; repeated cycles leak nothing');
  }

  { // Each failure lands on a usable fallback in the same document.
    for (const [options, reason, shotName] of [[{ requestError: 'NotAllowedError' }, 'PERMISSION_DENIED', 'permission-denied'], [{ requestError: 'NotSupportedError' }, 'SESSION_NOT_SUPPORTED'], [{ hitSourceError: true }, 'SESSION_SETUP_FAILED']]) {
      const session = await openPage({ fake: options });
      const { page } = session;
      await openGuide(page);
      await page.locator('#xr-start').click();
      await waitPhase(page, 'FAILED');
      assert.equal(await page.evaluate(() => window.__webXrGuide.state.reason), reason);
      assert.equal(await page.locator('#xr-fallback').isVisible(), true);
      assert.ok((await page.locator('#xr-fallback-reason').textContent()).length > 0);
      assert.equal(await page.locator('#xr-start').textContent(), 'AR 다시 시작');
      assert.equal(await page.locator('#xr-overlay').isVisible(), false);
      assert.equal(await page.evaluate(() => window.__env.currentSession?.ended ?? true), true);
      if (shotName) await shot(page, shotName);
      await page.locator('#xr-to-camera').click();
      await page.waitForFunction(() => window.__media.liveTracks() > 0);
      assert.equal((await inspection(page)).step, 'locate');
      await close(session, reason);
    }

    const manual = await openPage({ fake: { requestError: 'NotAllowedError' } });
    await openGuide(manual.page);
    await manual.page.locator('#xr-start').click();
    await waitPhase(manual.page, 'FAILED');
    await manual.page.locator('#xr-to-checklist').click();
    await manual.page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal((await inspection(manual.page)).step, 'check');
    await close(manual, 'manual fallback');

    const asset = await openPage({ fake: {}, prepare: page => page.route('**/three.module.min.js', route => route.abort()) });
    asset.problems.length = 0;
    await guideReady(asset.page);
    await asset.page.locator('#xr-entry-open').click();
    await waitPhase(asset.page, 'UNSUPPORTED');
    assert.equal(await asset.page.evaluate(() => window.__webXrGuide.state.reason), 'ASSET_LOAD_FAILED');
    assert.equal(await asset.page.locator('#xr-start').isVisible(), false);
    await asset.page.locator('#xr-to-checklist').click();
    await asset.page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal((await inspection(asset.page)).step, 'check');
    await asset.context.close(); // The aborted request logs a console error by design.

    const guideDown = await openPage({ fake: {}, prepare: page => page.route('**/webxr-guide.mjs', route => route.abort()) });
    await guideDown.page.waitForTimeout(200);
    assert.equal(await guideDown.page.locator('#xr-entry').count(), 0);
    await guideDown.page.locator('#manual-start').click();
    assert.equal((await inspection(guideDown.page)).step, 'check');
    await guideDown.context.close();
    pass('permission denial, unsupported features, setup failure and missing assets each show a reason and return to 2D or the checklist');
  }

  { // Device refuses anchors: still usable, clearly labelled.
    const session = await openPage({ fake: { grant: { 'dom-overlay': true } } });
    const { page } = session;
    await openGuide(page);
    await startAr(page);
    await page.locator('#xr-place').click();
    await settle(page, 3);
    await waitPhase(page, 'PLACED');
    assert.equal(await page.evaluate(() => window.__webXrGuide.state.markerMode), 'HIT_POSE');
    assert.match(await page.locator('#xr-notice').textContent(), /공간 앵커를 쓸 수 없어/);
    await shot(page, 'no-anchor');
    await page.evaluate(() => window.__env.resetSpace());
    assert.equal(await phase(page), 'AIMING');
    assert.match(await page.locator('#xr-notice').textContent(), /다시 지정/);
    await close(session, 'no anchors');
    pass('without anchors the marker is labelled and a reference reset clears it');
  }

  { // Layout: fold-out portrait, landscape and a narrow width.
    for (const viewport of [{ width: 412, height: 1007 }, { width: 844, height: 390 }, { width: 320, height: 640 }]) {
      const session = await openPage({ viewport, fake: {} });
      const { page } = session;
      await guideReady(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'entry fits');
      assert.ok((await page.locator('#xr-entry-open').boundingBox()).height >= 44);
      await openGuide(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'guide page fits');
      await startAr(page);
      await placeMarker(page);
      const fits = await page.evaluate(() => {
        const inside = element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.top >= 0; };
        return [...document.querySelectorAll('#xr-controls button')].filter(b => !b.hidden).every(b => inside(b) && b.getBoundingClientRect().height >= 44) && inside(document.getElementById('xr-status'));
      });
      assert.equal(fits, true, `controls fit ${viewport.width}x${viewport.height}`);
      await shot(page, `placed-${viewport.width}x${viewport.height}`);
      await close(session, 'layout');
    }
    pass('entry, guide page and AR controls fit and stay at least 44px tall at 412x1007, 844x390 and 320x640');
  }

  { // Experiment on: the other 16 parts stay exactly as they were.
    const others = taskLinks().filter(task => task.id !== 'washer-fluid');
    assert.equal(others.length, 16);
    for (const task of others) {
      const session = await openPage({ fake: {}, url: `/${task.href}` });
      const { page, requests } = session;
      assert.equal(await page.locator('#xr-entry-open').count(), 0, task.id);
      assert.equal(await page.evaluate(() => Boolean(window.__webXrGuide)), false, task.id);
      assert.equal(requests.some(r => r.url.includes('webxr/') || r.url.includes('three')), false, task.id);
      assert.equal(await page.locator('#manual-start').count(), 1, task.id);
      await close(session, task.id);
    }
    pass('with the experiment on, none of the other 16 tasks offers WebXR or loads its files');
  }

  { // Experiment off: the page never hears about it, whatever the device supports or the URL says.
    for (const url of ['/', '/#v=1&task=washer-fluid', '/?webxr=1', '/#v=1&task=washer-fluid&webxr=1']) {
      const session = await openPage({ fake: {}, host: plainRoot, url });
      const { page, requests } = session;
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#xr-entry').count(), 0, url);
      assert.equal(await page.evaluate(() => document.body.dataset.webxrGuide), undefined, url);
      assert.equal(requests.some(r => /webxr\/|three/.test(r.url)), false, url);
      await close(session, url);
    }
    for (const route of ['/webxr/webxr-guide.mjs', '/webxr/three.module.min.js', '/webxr/']) assert.equal((await fetch(plainRoot + route)).status, 404, route);
    pass('default server: no entry, no mark and no guide request on a capable device, and URL parameters cannot enable it');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => plainServer.close(resolve));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
