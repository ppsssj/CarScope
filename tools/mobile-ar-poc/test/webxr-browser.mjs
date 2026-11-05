// P9-XR-B browser check: real Chrome, real WebGL (software), real Three.js and the real page under the server CSP.
// The XR runtime is the test double from fake-webxr.mjs, with one exception: the first scenario uses Chrome's own WebXR.
// This proves page logic and that the marker is rendered world-fixed from poses. It does not prove device tracking.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHandler } from '../server.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p9-xr-b');
await mkdir(output, { recursive: true });

const result = { kind: 'SYNTHETIC_XR_RUNTIME', realDevice: 'NOT_RUN', realTracking: 'NOT_RUN', checks: [], errors: [] };
const pass = message => { result.checks.push(`PASS ${message}`); console.log(`PASS ${message}`); };

const server = http.createServer(createHandler(undefined, { webxrPoc: true }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const plainServer = http.createServer(createHandler());
await new Promise(resolve => plainServer.listen(0, '127.0.0.1', resolve));
const root = `http://127.0.0.1:${server.address().port}`;
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

const FX = 1.5 * (844 / 390), FY = 1.5;
const toScreen = (x, y, z) => ({ x: (FX * x / -z + 1) * 195, y: (1 - FY * y / -z) * 422 });

let browser;
const openPage = async (viewport = { width: 390, height: 844 }, fakeOptions) => {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  if (fakeOptions !== undefined) {
    await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fakeOptions)}));`);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const problems = [], requests = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.goto(`${root}/webxr/`);
  return { page, context, problems, requests };
};
const phase = page => page.evaluate(() => window.__webXrPoc?.state.phase);
const waitPhase = (page, name) => page.waitForFunction(value => window.__webXrPoc?.state.phase === value, name);
const step = (page, count = 1) => page.evaluate(n => { for (let i = 0; i < n; i++) window.__env.step(); }, count);
const settle = (page, count = 2) => page.evaluate(async n => {
  for (let i = 0; i < n; i++) { window.__env.step(); await new Promise(resolve => setTimeout(resolve)); }
}, count);
const setViewer = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  window.__env.viewer = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, a, b, c, 1]);
}, [x, y, z]);
const marks = page => page.evaluate(() => window.__env.readMarks());
const start = async page => {
  await waitPhase(page, 'READY');
  await page.locator('#start-ar').click();
  await waitPhase(page, 'AIMING');
  await settle(page);
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  result.browser = browser.version();

  { // Chrome's own WebXR on a desktop: the genuine unsupported path, with no test double.
    const session = await openPage();
    const { page, requests } = session;
    await waitPhase(page, 'UNSUPPORTED');
    assert.equal(await page.locator('#start-ar').isVisible(), false);
    assert.equal(await page.locator('#fallback').isVisible(), true);
    const hasXr = await page.evaluate(() => Boolean(navigator.xr));
    assert.equal(await page.evaluate(() => window.__webXrPoc.state.reason), hasXr ? 'AR_NOT_SUPPORTED' : 'NO_WEBXR_API');
    assert.equal(requests.some(r => r.url.includes('three')), false, 'unsupported devices do not download Three.js');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, 'unsupported');
    await page.locator('#fallback a').click();
    await page.waitForFunction(() => !!window.__selfInspection);
    assert.equal(new URL(page.url()).hash, '#v=1&task=washer-fluid');
    assert.equal(await page.locator('#intro-title').isVisible(), true);
    await close(session, 'unsupported');
    pass(`real Chrome without AR shows the reason and returns to the existing 2D page (navigator.xr ${hasXr ? 'present' : 'absent'})`);
  }

  { // Full flow, including rendered pixels.
    const session = await openPage({ width: 390, height: 844 }, {});
    const { page, requests } = session;
    await waitPhase(page, 'READY');
    assert.equal(await page.locator('#support-ar').textContent(), '지원');
    await shot(page, 'ready');
    await page.locator('#start-ar').click();
    await waitPhase(page, 'AIMING');
    const request = await page.evaluate(() => window.__env.requests[0]);
    assert.deepEqual(request, { mode: 'immersive-ar', requiredFeatures: ['local', 'hit-test'], optionalFeatures: ['anchors', 'dom-overlay'], hasOverlayRoot: true });
    assert.equal(await page.locator('#page').isVisible(), false);
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
    assert.equal(await page.locator('#xr-status').textContent(), '내가 지정한 위치');
    assert.match(await page.locator('#xr-hint').textContent(), /부품 인식 결과가 아닙니다/);
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

    // End and restart: the marker is gone and a fresh session works.
    await page.evaluate(() => window.__env.select());
    await settle(page, 3);
    await waitPhase(page, 'PLACED');
    await page.locator('#xr-exit').click();
    await waitPhase(page, 'ENDED');
    assert.equal(await page.locator('#page').isVisible(), true);
    assert.equal(await page.locator('#xr-overlay').isVisible(), false);
    assert.equal(await page.locator('#ended').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__env.anchors.every(a => a.deleted)), true);
    assert.equal(await page.evaluate(() => window.__env.hitSources[0].cancelled), true);
    await shot(page, 'ended');
    await page.locator('#start-ar').click();
    await waitPhase(page, 'AIMING');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__webXrPoc.state.markerMode), null);
    assert.equal((await marks(page)).blue.count, 0);
    pass('session end releases every resource and a restart begins with no marker');

    // Return to the checklist from inside AR.
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !!window.__selfInspection);
    assert.equal(new URL(page.url()).hash, '#v=1&task=washer-fluid');
    assert.equal(await page.evaluate(() => window.__selfInspection.state.step), 'intro');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith(`${root}/`)), 'only same-origin GET requests');
    await close(session, 'full flow');
    pass('AR returns to the existing checklist page; no storage and only same-origin GET requests under the server CSP');
  }

  { // Each failure lands on a usable fallback.
    for (const [options, reason] of [[{ requestError: 'NotAllowedError' }, 'PERMISSION_DENIED'], [{ requestError: 'NotSupportedError' }, 'SESSION_NOT_SUPPORTED'], [{ hitSourceError: true }, 'SESSION_SETUP_FAILED']]) {
      const session = await openPage({ width: 390, height: 844 }, options);
      const { page } = session;
      await waitPhase(page, 'READY');
      await page.locator('#start-ar').click();
      await waitPhase(page, 'FAILED');
      assert.equal(await page.evaluate(() => window.__webXrPoc.state.reason), reason);
      assert.equal(await page.locator('#fallback').isVisible(), true);
      assert.equal(await page.locator('#start-ar').textContent(), 'AR 다시 시작');
      assert.equal(await page.locator('#xr-overlay').isVisible(), false);
      assert.equal(await page.evaluate(() => window.__env.currentSession?.ended ?? true), true);
      if (reason === 'PERMISSION_DENIED') await shot(page, 'permission-denied');
      await close(session, reason);
    }
    pass('permission denial, unsupported features and setup failure each show a reason, a fallback and a retry');
  }

  { // Device refuses anchors: still usable, clearly labelled.
    const session = await openPage({ width: 390, height: 844 }, { grant: { 'dom-overlay': true } });
    const { page } = session;
    await start(page);
    await page.locator('#xr-place').click();
    await settle(page, 3);
    await waitPhase(page, 'PLACED');
    assert.equal(await page.evaluate(() => window.__webXrPoc.state.markerMode), 'HIT_POSE');
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
      const session = await openPage(viewport, {});
      const { page } = session;
      await start(page);
      await page.evaluate(() => window.__env.select());
      await settle(page, 3);
      await waitPhase(page, 'PLACED');
      const fits = await page.evaluate(() => {
        const inside = element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.top >= 0; };
        return [...document.querySelectorAll('#xr-controls button')].filter(b => !b.hidden).every(b => inside(b) && b.getBoundingClientRect().height >= 44) && inside(document.getElementById('xr-status'));
      });
      assert.equal(fits, true, `controls fit ${viewport.width}x${viewport.height}`);
      await shot(page, `placed-${viewport.width}x${viewport.height}`);
      await close(session, 'layout');
    }
    pass('AR controls fit and stay at least 44px tall at 412x1007, 844x390 and 320x640');
  }

  { // The product host and page stay as they were.
    const plain = `http://127.0.0.1:${plainServer.address().port}`;
    assert.equal((await fetch(`${plain}/webxr/`)).status, 404);
    assert.equal((await fetch(`${plain}/webxr/three.module.min.js`)).status, 404);
    pass('default server does not expose the PoC');
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
