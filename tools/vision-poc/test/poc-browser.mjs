// P12-B: the real PoC page in real Chrome with a scripted detector in place of a model, because no trained model exists.
// These scenarios check the page's behaviour. A scripted box says nothing about whether a model can find a cap.
//   npm run test:browser   (CARSCOPE_EVIDENCE_DIR optionally keeps screenshots; needs `npm ci` in tools/mobile-ar-poc for Playwright)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const evidence = process.env.CARSCOPE_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });

const target = { role: 'TARGET_CANDIDATE', labels: ['washer-fluid-cap'] };
const detection = (categoryName, score, originX, originY, width, height) => ({ categories: [{ categoryName, score }], boundingBox: { originX, originY, width, height } });
// Replaces only the module that touches MediaPipe. The result of `detect` is whatever the scenario scripts.
const fakeRuntime = script => `window.__created=0;window.__detected=0;export async function createDetector(){window.__created++;return {detect(){window.__detected++;${script}},close(){}};}`;

const server = await startServer({ modelPath: '', manifestPath: '' });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
let failures = 0, checks = 0;

async function openPage({ manifest = null, runtime = null, viewport = { width: 1000, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  const log = { requests: [], errors: [] };
  page.on('request', r => log.requests.push({ method: r.method(), url: r.url(), body: r.postData() }));
  page.on('pageerror', e => log.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) log.errors.push(m.text()); });
  if (manifest) await page.route('**/model.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) }));
  if (runtime) await page.route('**/detector-runtime.mjs', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: runtime }));
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  return { context, page, log };
}

// Draws the test image in the page and returns encoded bytes.
const drawn = (page, { width = 800, height = 600, blue = true, type = 'image/png' } = {}) => page.evaluate(async ({ width, height, blue, type }) => {
  const c = new OffscreenCanvas(width, height), x = c.getContext('2d');
  x.fillStyle = '#505050'; x.fillRect(0, 0, width, height);
  if (blue) { x.fillStyle = '#1e3cc8'; x.fillRect(width / 4, height / 4, width / 10, height / 10); }
  const bytes = new Uint8Array(await (await c.convertToBlob({ type, quality: 0.9 })).arrayBuffer());
  return [...bytes];
}, { width, height, blue, type }).then(bytes => Buffer.from(bytes));

async function choose(page, buffer, name = 'photo.png', mimeType = 'image/png') {
  const before = await page.evaluate(() => Number(document.body.dataset.analyzed ?? 0));
  await page.setInputFiles('#photo', { name, mimeType, buffer });
  await page.waitForFunction(n => Number(document.body.dataset.analyzed ?? 0) > n, before);
}
const aiStatus = page => page.locator('#ai-status').getAttribute('data-status');
const noWrites = log => assert.deepEqual(log.requests.filter(r => r.method !== 'GET' || r.body), [], 'the page sends nothing but GET');
const onlyLocal = log => assert.deepEqual(log.requests.filter(r => !r.url.startsWith(server.url) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')), [], 'no other host');
const shot = async (page, name) => { if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }); };

async function scenario(name, body) {
  checks++;
  try { await body(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack ?? error}`); }
}

async function withPage(options, body) {
  const opened = await openPage(options);
  try { await body(opened); assert.deepEqual(opened.log.errors, [], 'page errors'); noWrites(opened.log); onlyLocal(opened.log); }
  finally { await opened.context.close(); }
}

await scenario('no model: AI says MODEL_REQUIRED, the colour baseline still runs and stays labelled as not AI', () => withPage({}, async ({ page }) => {
  assert.equal(await aiStatus(page), 'MODEL_REQUIRED');
  await choose(page, await drawn(page));
  assert.equal(await aiStatus(page), 'MODEL_REQUIRED');
  assert.equal(await page.locator('#ai-candidates li').count(), 0);
  assert.equal(await page.locator('#baseline-status').getAttribute('data-count'), '1');
  assert.match(await page.locator('main').innerText(), /AI가 아니고 부품을 알아보지 못하며/);
  await shot(page, 'model-required');
}));

await scenario('a COCO-style model is refused before it is even created', () => withPage({ manifest: { role: 'RUNTIME_SMOKE_ONLY', labels: ['car', 'bottle'] }, runtime: fakeRuntime('return [];') }, async ({ page }) => {
  assert.equal(await aiStatus(page), 'MODEL_NOT_TARGET');
  await choose(page, await drawn(page));
  assert.equal(await aiStatus(page), 'MODEL_NOT_TARGET');
  assert.equal(await page.evaluate(() => window.__created ?? 0), 0);
}));

await scenario('photo to candidate: box in the right place, score shown, the user answers, and no verdict appears', () => withPage({ manifest: target, runtime: fakeRuntime(`return ${JSON.stringify([detection('washer-fluid-cap', 0.82, 400, 150, 100, 100)])};`) }, async ({ page }) => {
  await choose(page, await drawn(page, { blue: false }));
  assert.equal(await aiStatus(page), 'CANDIDATES');
  const item = page.locator('#ai-candidates li');
  assert.equal(await item.count(), 1);
  assert.match(await item.innerText(), /후보 1 · 모델 점수 0\.82/);
  assert.match(await item.innerText(), /보정되지 않은 점수/);
  // The left edge of the 400,150 100×100 box, on an 800×600 photo: the drawn line is the AI colour and the photo is untouched elsewhere.
  const pixels = await page.evaluate(() => { const c = document.getElementById('stage'), x = c.getContext('2d'); const at = (a, b) => [...x.getImageData(a, b, 1, 1).data].slice(0, 3); return { width: c.width, line: at(400, 220), inside: at(450, 220), outside: at(300, 220), labelBackground: at(402, 130) }; });
  assert.equal(pixels.width, 800);
  assert.deepEqual(pixels.labelBackground, [23, 33, 43], 'the label is drawn above the box');
  assert.deepEqual(pixels.line, [57, 233, 145]);
  assert.deepEqual(pixels.inside, [80, 80, 80]);
  assert.deepEqual(pixels.outside, [80, 80, 80]);
  await item.locator('[data-answer=CONFIRMED]').click();
  const confirmed = await item.innerText();
  assert.match(confirmed, /내가 이 위치를 맞다고 표시함 · 점검 결과 아님/);
  assert.equal(await item.locator('[data-answer=CONFIRMED]').getAttribute('aria-pressed'), 'true');
  await item.locator('[data-answer=REJECTED]').click();
  assert.equal(await item.locator('[data-answer=CONFIRMED]').getAttribute('aria-pressed'), 'false');
  assert.match(await item.innerText(), /아니라고 표시함/);
  assert.match(await page.locator('#notice').innerText(), /점검 결과가 아닙니다.*캡·덮개를 열지 마세요.*직접 보충하지 마세요/s);
  await shot(page, 'candidates');
}));

await scenario('an empty result is NO_DETECTION, worded as not found rather than not there', () => withPage({ manifest: target, runtime: fakeRuntime('return [];') }, async ({ page }) => {
  await choose(page, await drawn(page, { blue: false }));
  assert.equal(await aiStatus(page), 'NO_DETECTION');
  assert.match(await page.locator('#ai-status').innerText(), /주입구가 없다는 뜻은 아니에요/);
  assert.equal(await page.locator('#ai-candidates li').count(), 0);
  await shot(page, 'no-detection');
}));

await scenario('a coolant cap with a high score does not become a washer candidate', () => withPage({ manifest: target, runtime: fakeRuntime(`return ${JSON.stringify([detection('coolant-cap', 0.99, 100, 100, 50, 50)])};`) }, async ({ page }) => {
  await choose(page, await drawn(page, { blue: false }));
  assert.equal(await aiStatus(page), 'NO_DETECTION');
}));

await scenario('a detector exception is INFERENCE_FAILED, never NO_DETECTION', () => withPage({ manifest: target, runtime: fakeRuntime("throw new Error('boom');") }, async ({ page }) => {
  await choose(page, await drawn(page, { blue: false }));
  assert.equal(await aiStatus(page), 'INFERENCE_FAILED');
  assert.match(await page.locator('#ai-status').innerText(), /후보가 없다는 뜻이 아니에요/);
}));

await scenario('a model that fails to load is MODEL_LOAD_FAILED and can be retried on the next photo', () => withPage({ manifest: target, runtime: "let n=0;export async function createDetector(){if(++n===1)throw new Error('no');return {detect(){return []},close(){}};}" }, async ({ page }) => {
  await choose(page, await drawn(page));
  assert.equal(await aiStatus(page), 'MODEL_LOAD_FAILED');
  await choose(page, await drawn(page));
  assert.equal(await aiStatus(page), 'NO_DETECTION');
}));

await scenario('a file that is not an image is IMAGE_UNREADABLE and clears the earlier photo and answers', () => withPage({ manifest: target, runtime: fakeRuntime(`return ${JSON.stringify([detection('washer-fluid-cap', 0.9, 10, 10, 50, 50)])};`) }, async ({ page }) => {
  await choose(page, await drawn(page));
  assert.equal(await page.locator('#ai-candidates li').count(), 1);
  await choose(page, Buffer.from('not an image'), 'broken.png');
  assert.equal(await aiStatus(page), 'IMAGE_UNREADABLE');
  assert.equal(await page.locator('#ai-candidates li').count(), 0);
  assert.equal(await page.locator('#figure').isVisible(), false);
}));

await scenario('a newer photo wins: a slow answer for the earlier photo is dropped', () => withPage({ manifest: target, runtime: `let n=0;export async function createDetector(){return {async detect(){const mine=++n;if(mine===1){await new Promise(r=>setTimeout(r,500));return ${JSON.stringify([detection('washer-fluid-cap', 0.9, 10, 10, 50, 50)])};}return [];},close(){}};}` }, async ({ page }) => {
  const photo = await drawn(page);
  await page.setInputFiles('#photo', { name: 'first.png', mimeType: 'image/png', buffer: photo });
  await page.waitForFunction(() => document.getElementById('baseline-status').dataset.count === '1');
  await choose(page, photo, 'second.png');
  await page.waitForTimeout(700);
  assert.equal(await aiStatus(page), 'NO_DETECTION');
  assert.equal(await page.locator('#ai-candidates li').count(), 0);
}));

await scenario('EXIF rotation is honoured, so a box lands on what the user sees', () => withPage({}, async ({ page }) => {
  const jpeg = await drawn(page, { width: 400, height: 200, type: 'image/jpeg' });
  await choose(page, jpeg, 'plain.jpg', 'image/jpeg');
  assert.deepEqual(await page.evaluate(() => { const c = document.getElementById('stage'); return [c.width, c.height]; }), [400, 200], 'control: the same photo without the tag');
  // APP1 EXIF, big-endian TIFF, one tag: Orientation (0x0112) = 6, inserted after the JPEG start marker.
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]), size = Buffer.alloc(2); size.writeUInt16BE(body.length + 2);
  await choose(page, Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), size, body, jpeg.subarray(2)]), 'rotated.jpg', 'image/jpeg');
  assert.deepEqual(await page.evaluate(() => { const c = document.getElementById('stage'); return [c.width, c.height]; }), [200, 400]);
}));

await scenario('at 420 wide the page fits, and the answer buttons are large enough to touch', () => withPage({ manifest: target, viewport: { width: 420, height: 860 }, runtime: fakeRuntime(`return ${JSON.stringify([detection('washer-fluid-cap', 0.82, 400, 150, 100, 100)])};`) }, async ({ page }) => {
  await choose(page, await drawn(page));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  const box = await page.locator('[data-answer=CONFIRMED]').boundingBox();
  assert.ok(box.height >= 44, `button height ${box.height}`);
  await shot(page, 'candidates-420');
}));

await browser.close();
await server.close();
console.log(JSON.stringify({ status: failures ? 'FAIL' : 'PASS', checks, failures, scope: 'DESKTOP_CHROME_SCRIPTED_DETECTOR', targetModel: 'NOT_RUN', phone: 'NOT_RUN' }, null, 2));
if (failures) process.exitCode = 1;
