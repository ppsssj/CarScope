// AR-01 browser regression with a synthetic camera (canvas captureStream). Writes captures and raw results outside Git.
// Synthetic media only: no real camera, no real vehicle, no recognition accuracy claim.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { createHandler } from '../server.mjs';
import { HANDOFF } from '../public/handoff.mjs';
import { validateResult } from '../public/inspection-result.mjs';

const output = process.env.POC_EVIDENCE_DIR;
if (!output || !path.resolve(output).toLowerCase().startsWith('c:\\carscope-external\\qr-ar-01\\')) {
  throw new Error('Set POC_EVIDENCE_DIR to a run directory under C:\\CarScope-External\\qr-ar-01\\');
}
await mkdir(output, { recursive: true });
const results = { kind: 'SYNTHETIC_BROWSER_ONLY', realDetectionAccuracy: 'NOT_RUN', realDevice: 'NOT_RUN', checks: [], errors: [] };
const pass = (m) => { results.checks.push(`PASS: ${m}`); };
const server = http.createServer(createHandler('https://poc.example/'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: false });
  await context.addInitScript(() => {
    // 640x480 synthetic rear camera: dark frame with one blue 100x80 block at (240,180).
    const fixture = document.createElement('canvas'); fixture.width = 640; fixture.height = 480;
    const ctx = fixture.getContext('2d');
    let blueFrame = true;
    window.paintFixture = (blue = blueFrame) => {
      blueFrame = blue;
      ctx.fillStyle = '#303030'; ctx.fillRect(0, 0, 640, 480);
      if (blue) { ctx.fillStyle = '#1446c8'; ctx.fillRect(240, 180, 100, 80); }
    };
    window.paintFixture();
    setInterval(() => window.paintFixture(), 100);
    window.fixtureCanvas = fixture;
    window.fixtureStreams = [];
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      if (location.search === '?fixture=denied') throw new DOMException('denied', 'NotAllowedError');
      window.paintFixture(true);
      const stream = fixture.captureStream(10); window.fixtureStreams.push(stream); return stream;
    } }, configurable: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => results.errors.push(error.message));
  const S = () => page.evaluate(() => ({ ...window.__selfInspection.state, mark: window.__selfInspection.mark }));
  const step = () => page.evaluate(() => document.body.dataset.step);
  const tracksEnded = () => page.evaluate(() => fixtureStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const overlayPainted = () => page.evaluate(() => { const c = document.getElementById('overlay'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); });
  /** Client point of a normalized video point (contain mapping inside #stage). */
  const videoPoint = (nx, ny) => page.evaluate(([nx, ny]) => {
    const b = document.getElementById('stage').getBoundingClientRect(), v = document.getElementById('video');
    const s = Math.min(b.width / v.videoWidth, b.height / v.videoHeight), w = v.videoWidth * s, h = v.videoHeight * s;
    return { x: b.left + (b.width - w) / 2 + nx * w, y: b.top + (b.height - h) / 2 + ny * h };
  }, [nx, ny]);
  const markerPixel = (pt) => page.evaluate(({ x, y }) => {
    const c = document.getElementById('overlay'), b = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(Math.round((x - b.left) * devicePixelRatio), Math.round((y - b.top) * devicePixelRatio), 1, 1).data;
    return [...d];
  }, pt);
  const primary = () => page.locator('#primary');

  // ---------- STEP 1: QR entry ----------
  await page.goto(root + '/' + HANDOFF);
  await page.waitForFunction(() => document.getElementById('handoff-status').textContent.includes('QR 작업 수신'));
  assert.equal(await step(), 'intro');
  assert.equal(await primary().textContent(), '카메라로 점검 시작');
  assert.equal(await page.locator('#guidance').isVisible(), true);
  assert.equal(await noOverflow(), true);
  await page.screenshot({ path: path.join(output, '01-intro.png'), fullPage: true });
  // QR shown for the PC side: decode the actual rendered server SVG.
  await page.locator('#pc-qr summary').click();
  await page.waitForFunction(() => document.querySelector('#qr img')?.naturalWidth > 0);
  // Centre the QR so the sticky action bar cannot cover part of the element screenshot.
  await page.locator('#qr img').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const qr = PNG.sync.read(await page.locator('#qr img').screenshot());
  assert.equal(jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height).data, `https://poc.example/${HANDOFF}`);
  await page.locator('#pc-qr summary').click();
  pass('QR entry: v1 task received, intro, manual guide visible; server QR decodes to the unchanged v1 contract');

  // ---------- STEP 2: camera guidance ----------
  await primary().focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보 1개'));
  assert.equal(await step(), 'locate');
  assert.equal(await overlayPainted(), true);
  assert.equal(await page.locator('#stage-chip').textContent(), '2/4 위치 찾기 · 주입구를 찾으면 화면을 탭하세요');
  assert.equal(await page.locator('#progress li.current').textContent(), '위치 찾기');
  assert.equal((await S()).record.aids.cameraUsed, true);
  assert.equal(await noOverflow(), true);
  await page.screenshot({ path: path.join(output, '02-locate-candidate.png'), fullPage: true });
  pass('keyboard start; rear-camera request; blue candidate overlay (unverified) and step chip on the camera view');

  // Tap to mark the spot (centre of the blue block), re-mark elsewhere, clear.
  const blue = await videoPoint(290 / 640, 220 / 480);
  await page.mouse.click(blue.x, blue.y);
  await page.waitForFunction(() => document.getElementById('stage').hasAttribute('data-marked'));
  let st = await S();
  assert.ok(Math.abs(st.mark.x - 290 / 640) < 0.01 && Math.abs(st.mark.y - 220 / 480) < 0.01, JSON.stringify(st.mark));
  assert.equal(st.record.aids.locationMarked, true);
  const px = await markerPixel(blue);
  assert.ok(px[2] > 200 && px[0] < 80, `marker dot drawn at the tap: ${px}`);
  assert.match(await page.locator('#status').textContent(), /위치 지정됨/);
  await page.screenshot({ path: path.join(output, '03-locate-marked.png'), fullPage: true });
  const other = await videoPoint(0.2, 0.3);
  await page.mouse.click(other.x, other.y);
  await page.waitForFunction(() => Math.abs(window.__selfInspection.mark.x - 0.2) < 0.01);
  assert.ok((await markerPixel(other))[2] > 200, 'marker moved to the new tap');
  await page.locator('#clear-mark').click();
  assert.equal((await S()).mark, null);
  assert.equal(await page.locator('#clear-mark').isDisabled(), true);
  pass('tap marks a 2D point with ring/arrow/label; re-tap moves it; clear removes it');

  // Rotation: same video frame, re-projected mark, no overflow; restart clears the mark.
  await page.mouse.click(blue.x, blue.y);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  const blueWide = await videoPoint(290 / 640, 220 / 480);
  assert.ok((await markerPixel(blueWide))[2] > 200, 'mark re-projected after resize');
  assert.equal(await noOverflow(), true);
  await page.screenshot({ path: path.join(output, '04-landscape-marked.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.locator('#stop').click();
  assert.equal((await S()).mark, null);
  assert.equal(await tracksEnded(), true);
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  assert.equal((await S()).mark, null, 'restarted video starts without a stale mark');
  pass('landscape resize keeps the mark on the same video point without overflow; stop ends tracks and clears the mark; restart works');

  // Candidate regression: no candidate -> stale overlay cleared.
  await page.evaluate(() => paintFixture(false));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('후보를 찾지 못했습니다'));
  assert.equal(await overlayPainted(), false);
  await page.evaluate(() => paintFixture(true));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  pass('no-candidate timeout clears stale overlay; candidates return');

  // ---------- STEP 3: self-check (camera still on, checklist gate) ----------
  await page.mouse.click(blue.x, blue.y);
  await primary().click();
  assert.equal(await step(), 'check');
  assert.equal(await page.locator('#stage').isVisible(), true);
  assert.equal(await page.locator('#stage-chip').textContent(), '3/4 셀프 점검 · 아래 항목을 직접 확인하세요');
  assert.equal(await primary().isDisabled(), true);
  const boxes = page.locator('#checklist input');
  assert.equal(await boxes.count(), 3);
  await boxes.nth(0).check(); await boxes.nth(1).check();
  assert.equal(await primary().isDisabled(), true, 'two of three is not enough');
  await boxes.nth(2).check();
  assert.equal(await primary().isDisabled(), false);
  assert.match(await page.locator('#step-check .warn').textContent(), /위치가 확실하지 않으면 캡을 열지 마세요/);
  await page.screenshot({ path: path.join(output, '05-check.png'), fullPage: true });
  pass('checklist gate: result step only after all three user checks; wrong-filler warning shown; camera view kept');

  // ---------- STEP 4: result, confirm, done ----------
  await primary().click();
  assert.equal(await step(), 'result');
  assert.equal(await tracksEnded(), true, 'camera stops when leaving the camera steps');
  assert.equal(await primary().isDisabled(), true);
  await page.locator('#choices [data-status="OK"]').click();
  await page.locator('#choices [data-status="NEEDS_REFILL"]').click();
  assert.equal(await page.locator('#choices [aria-checked="true"]').getAttribute('data-status'), 'NEEDS_REFILL');
  await page.locator('#back').click();
  assert.equal(await step(), 'check');
  await primary().click();
  assert.equal((await S()).choice, 'NEEDS_REFILL', 'back keeps the choice');
  await primary().click();
  assert.equal(await step(), 'confirm');
  assert.match(await page.locator('#confirm-summary').textContent(), /보충 필요/);
  await page.screenshot({ path: path.join(output, '06-confirm.png'), fullPage: true });
  await primary().dblclick(); // double tap on the final button: must neither duplicate nor skip the result
  assert.equal(await step(), 'done');
  assert.equal(await primary().isDisabled(), true, '"새 점검 시작" ignores the second tap');
  await page.waitForFunction(() => !document.getElementById('primary').disabled, null, { timeout: 3000 });
  const record = JSON.parse(await page.locator('#result-json').textContent());
  assert.deepEqual(validateResult(record), []);
  assert.equal(record.status, 'NEEDS_REFILL');
  assert.equal(record.confirmation, 'USER_REPORTED');
  assert.equal(record.method, 'SELF');
  assert.equal(record.sync, 'NOT_SENT');
  assert.deepEqual(record.aids, { cameraUsed: true, locationMarked: true });
  assert.ok(!/vin|image|video|photo/i.test(Object.keys(record).join(',')));
  assert.match(await page.locator('#done-summary').textContent(), /보충 필요.*SELF/);
  assert.match(await page.locator('#done-sync').textContent(), /전송되거나 점검 이력에 저장되지 않았습니다/);
  assert.equal(await page.locator('#cancel').isVisible(), false);
  assert.equal(await page.locator('#back').isVisible(), false);
  assert.equal(await noOverflow(), true);
  await page.screenshot({ path: path.join(output, '07-done-needs-refill.png'), fullPage: true });
  pass('result -> confirm -> done (double tap): one completed USER_REPORTED/SELF record, NOT_SENT, no VIN/media; follow-up and no-sync notice');
  const firstId = record.inspectionId;

  // Restart, then the manual path for the other two results (no camera at all).
  const streamsBefore = await page.evaluate(() => fixtureStreams.length);
  for (const status of ['OK', 'UNSURE']) {
    await primary().click(); // 새 점검 시작 / back at intro
    if (await step() === 'done') await primary().click();
    assert.equal(await step(), 'intro');
    await page.locator('#manual-start').click();
    assert.equal(await step(), 'check');
    assert.equal(await page.locator('#stage').isVisible(), false, 'manual mode hides the camera');
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await primary().click();
    await page.locator(`#choices [data-status="${status}"]`).click();
    await primary().click(); await primary().click();
    await page.waitForFunction(() => document.body.dataset.step === 'done' && !document.getElementById('primary').disabled, null, { timeout: 3000 });
    const r = JSON.parse(await page.locator('#result-json').textContent());
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.status, status);
    assert.notEqual(r.inspectionId, firstId);
    assert.deepEqual(r.aids, { cameraUsed: false, locationMarked: false });
    if (status === 'OK') assert.match(await page.locator('#done-follow').textContent(), /인증하지 않습니다/);
    await page.screenshot({ path: path.join(output, `08-done-${status.toLowerCase()}.png`), fullPage: true });
  }
  assert.equal(await page.evaluate(() => fixtureStreams.length), streamsBefore, 'manual path never opened the camera');
  pass('manual path produces OK and UNSURE records with new ids and no camera use; OK text disclaims certification');

  // ---------- "확인할 수 없음": UNSURE without ticking the checklist ----------
  await primary().click(); assert.equal(await step(), 'intro');
  await primary().click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.locator('#unsure-locate').click();
  assert.equal(await step(), 'confirm');
  assert.equal(await page.locator('#confirm-unsure').isVisible(), true);
  assert.match(await page.locator('#confirm-summary').textContent(), /확인 불가.*확인하지 못함/);
  assert.equal(await tracksEnded(), true, 'camera stops on the confirm step');
  await page.screenshot({ path: path.join(output, '11-unsure-confirm.png'), fullPage: true });
  await page.locator('#back').click();
  assert.equal(await step(), 'locate', 'back returns to the camera step');
  assert.equal((await S()).choice, null);
  await page.locator('#locate-manual').click();
  assert.equal(await step(), 'check');
  await boxes.nth(0).check();
  await page.locator('#unsure-check').click();
  assert.equal(await step(), 'confirm');
  await primary().dblclick();
  await page.waitForFunction(() => document.body.dataset.step === 'done' && !document.getElementById('primary').disabled, null, { timeout: 3000 });
  const unsure = JSON.parse(await page.locator('#result-json').textContent());
  assert.deepEqual(validateResult(unsure), []);
  assert.equal(unsure.status, 'UNSURE'); assert.equal(unsure.confirmation, 'USER_REPORTED');
  assert.deepEqual((await S()).checks, { parked: true, located: false, observed: false }, 'unchecked items stay unchecked');
  assert.match(await page.locator('#done-follow').textContent(), /캡을 열거나 액체를 넣지 마세요/);
  await page.screenshot({ path: path.join(output, '12-unsure-done.png'), fullPage: true });
  pass('"확인할 수 없음" from locate and check: UNSURE confirm with notice, back to origin, USER_REPORTED record, checklist untouched');

  // ---------- cancel mid-flow ----------
  await primary().click(); assert.equal(await step(), 'intro');
  await primary().click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.mouse.click(blue.x, blue.y);
  await page.locator('#cancel').click();
  assert.equal(await page.locator('#cancel-confirm').isVisible(), true);
  await page.locator('#cancel-no').click();
  assert.equal(await step(), 'locate', '"계속 점검" keeps the attempt');
  await page.locator('#cancel').click();
  await page.locator('#cancel-yes').click();
  st = await S();
  assert.equal(st.step, 'intro'); assert.equal(st.record, null); assert.equal(st.mark, null);
  assert.equal(await tracksEnded(), true);
  pass('cancel asks first; confirmed cancel returns to start with no record, no mark and camera tracks ended');

  // ---------- camera lifecycle regressions ----------
  await primary().click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.getByRole('button', { name: '수동 안내 보기' }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'guidance');
  assert.equal(await tracksEnded(), true);
  pass('manual guide: focus moves to the guide and camera tracks stop');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.evaluate(() => Object.defineProperty(document.getElementById('video'), 'currentTime', { value: 1, configurable: true }));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('영상 갱신이 멈췄습니다'));
  assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null);
  await page.evaluate(() => { delete document.getElementById('video').currentTime; });
  pass('frozen frame time stops camera and removes stale proposals');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.mouse.click(blue.x, blue.y);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null);
  assert.equal((await S()).mark, null);
  pass('simulated visibilitychange stops the stream and clears the mark (real device backgrounding NOT_RUN)');

  // Invalid handoff: no inspection can start.
  await page.goto('about:blank');
  await page.goto(root + '/#v=2&task=washer-fluid');
  assert.equal(await primary().isDisabled(), true);
  assert.equal(await page.locator('#manual-start').isDisabled(), true);
  assert.match(await page.locator('#handoff-status').textContent(), /지원하지 않는 QR/);
  pass('invalid handoff blocks camera and inspection start');

  // Permission denied: message, then continue without camera.
  await page.goto(root + '/?fixture=denied');
  await primary().click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('권한이 거부'));
  await page.screenshot({ path: path.join(output, '09-denied.png'), fullPage: true });
  await page.locator('#locate-manual').click();
  assert.equal(await step(), 'check');
  assert.equal((await S()).mode, 'manual');
  pass('synthetic permission denial: manual guidance and the inspection continues without the camera');

  // Unsupported camera; desktop render.
  await page.goto(root + '/');
  await page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));
  await primary().click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('카메라 미지원'));
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await noOverflow(), true);
  await page.screenshot({ path: path.join(output, '10-desktop-unsupported.png'), fullPage: true });
  pass('unsupported camera fallback; desktop render without overflow');

  assert.deepEqual(results.errors, []);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.errors.push(error.stack); process.exitCode = 1;
} finally {
  await browser?.close(); server.close();
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
