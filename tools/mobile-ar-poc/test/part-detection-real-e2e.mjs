// P12-F: the whole flow against the REAL hosted model: real QR v2 HTTP on a local session, the real page in mobile Chrome, public rights-checked photos.
// Spends real calls from the shared ledger, so it is never part of CI or test:browser. Not a real phone and not Render.
//   ROBOFLOW_API_KEY_FILE=... CARSCOPE_CALL_LEDGER=... POC_EVIDENCE_DIR=... node test/part-detection-real-e2e.mjs <P12C images> <P12F images>
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startLocalDetection } from '../../vision-poc/scripts/part-detection-local.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

const [p12c, p12f] = process.argv.slice(2);
const base = process.env.POC_EVIDENCE_DIR;
if (!p12c || !p12f) throw Error('Usage: part-detection-real-e2e.mjs <P12C images> <P12F images>');
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'real-e2e');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(new URL('../../vision-poc/dataset/p12-f-bonnet-parts.json', import.meta.url), 'utf8'));
const KEY = (await readFile(process.env.ROBOFLOW_API_KEY_FILE, 'utf8')).trim();
const result = { kind: 'REAL_HOSTED_MODEL_DESKTOP_CHROME', realPhone: 'NOT_RUN', render: 'NOT_RUN', checks: [], runs: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };
const iou = (a, b) => { const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return x * y / (a[2] * a[3] + b[2] * b[3] - x * y); };

let now = Date.now(), browser;
const server = await startLocalDetection({ keyFile: process.env.ROBOFLOW_API_KEY_FILE, ledgerFile: process.env.CARSCOPE_CALL_LEDGER, purpose: 'e2e', now: () => now });
const TIMING = `(() => { window.__t = {}; const c = window.createImageBitmap; window.createImageBitmap = (...a) => { window.__t.start = performance.now(); return c(...a); };
  const f = window.fetch; window.fetch = async (u, i) => { if (String(u).includes('/part-detections/')) { window.__t.sent = performance.now(); window.__t.bytes = i.body.size; const r = await f(u, i); window.__t.answered = performance.now(); return r; } return f(u, i); }; })();`;

async function open(task) {
  now += 61_000;
  const created = await new ReceiverClient({ baseUrl: server.url }).create(task);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(TIMING);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const log = { problems: [], posts: 0, bodies: [] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('request', request => { if (request.url().includes('/part-detections/')) log.posts++; });
  page.on('response', async response => { if (response.url().startsWith(server.url)) log.bodies.push(await response.text().catch(() => '')); });
  await page.goto(`${server.url}/${created.fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  return { context, page, log };
}
const noKey = async (page, log) => {
  assert.ok(!(await page.content()).includes(KEY), 'page');
  assert.ok(!log.bodies.some(body => body.includes(KEY)), 'responses');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
};
const photo = id => { const image = manifest.images.find(i => i.id === id); return { image, file: path.join(image.root === 'P12C' ? p12c : p12f, image.file) }; };

async function run({ task, id, part, partId, wantCandidates }) {
  const { image, file } = photo(id);
  const { context, page, log } = await open(task);
  const stepBefore = await page.evaluate(() => document.body.dataset.step);
  await page.locator('#part-detect-open').click();
  await page.locator('#part-detect-consent').waitFor();
  assert.equal(await page.locator('#part-detect-gallery').isDisabled(), true, 'no photo before consent');
  await page.locator('#part-detect-library-input').setInputFiles(file);
  await page.waitForTimeout(200);
  assert.equal(log.posts, 0, 'a chosen file without consent sends nothing');
  await page.locator('#part-detect-agree').check();
  const started = await page.evaluate(() => performance.now());
  await page.locator('#part-detect-library-input').setInputFiles(file);
  await page.locator('#part-detect-result').waitFor();
  const done = await page.evaluate(() => performance.now());
  const state = await page.evaluate(() => { const s = window.__partDetection.state; return { phase: s.phase, candidates: s.candidates, detection: s.detection, code: s.code }; });
  const t = await page.evaluate(() => window.__t);
  const message = await page.locator('#part-detect-message').innerText();
  assert.equal(log.posts, 1, `${task}: one request`);
  await page.screenshot({ path: path.join(output, `${task}-${id}.png`) });
  const label = image.parts[part];
  const best = label?.boxes.length && state.candidates.length ? Math.max(...state.candidates.flatMap(c => label.boxes.map(b => iou(c.box, b)))) : null;
  const timing = server.timings.at(-1);
  result.runs.push({ task, id, phase: state.phase, candidates: state.candidates.map(c => ({ score: Number(c.score.toFixed(3)), box: c.box.map(v => Number(v.toFixed(4))) })), detection: state.detection, bestIouWithLabel: best === null ? null : Number(best.toFixed(2)),
    preprocessMs: Math.round(t.sent - t.start), serverAndNetworkMs: Math.round(t.answered - t.sent), totalMs: Math.round(done - started), uploadBytes: t.bytes, server: timing });
  if (wantCandidates) {
    assert.equal(state.phase, 'CANDIDATES', `${task} ${id}: ${state.phase} ${state.code}`);
    assert.equal(state.detection.modelId, 'engine-bay-parts/1');
    assert.equal(state.detection.coordinates, 'normalized-top-left-xywh');
    assert.ok(state.detection.image.width >= 64 && Date.parse(state.detection.inferredAt) > 0);
    for (const c of state.candidates) assert.ok(c.box.every(v => v >= 0 && v <= 1) && c.box[0] + c.box[2] <= 1.0001 && c.box[1] + c.box[3] <= 1.0001);
    assert.match(message, /확정된 위치가 아니에요/);
    assert.equal(await page.locator('#part-detect-caution').isVisible(), true);
    const drawn = await page.evaluate(() => { const canvas = document.querySelector('#part-detect-picture'); return { w: canvas.width, h: canvas.height }; });
    assert.ok(drawn.w > 64 && drawn.h > 64);
  } else {
    assert.equal(state.phase, 'NONE_FOUND', `${task} ${id}: ${state.phase} ${state.code}`);
    assert.match(message, /그림 안내와 차량 설명서/);
  }
  await noKey(page, log);
  await page.locator('#part-detect-close').click();
  await page.locator('#part-detect').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.body.dataset.step), stepBefore, 'the inspection is where it was');
  assert.equal(await page.locator('details.part-guide').first().isVisible(), true, 'the drawing guide is there to use');
  assert.deepEqual(log.problems, []);
  await context.close();
  return state;
}

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true });
  result.browser = browser.version();
  for (const task of ['battery-12v', 'lcw-coolant-reservoir']) {
    const { context, page, log } = await open(task);
    assert.equal(await page.locator('#part-detect-open').count(), 0, task);
    assert.equal(log.posts, 0);
    await context.close();
  }
  pass('the two unsupported parts offer no button, so they spend no call');
  const before = server.ledger.count;
  await run({ task: 'washer-fluid', id: 'commons-032', part: 'washer', wantCandidates: true });
  await run({ task: 'coolant-reservoir', id: 'commons-040', part: 'coolant', wantCandidates: true });
  await run({ task: 'brake-fluid', id: 'new-03', part: 'brake', wantCandidates: true });
  await run({ task: 'fuse-box', id: 'commons-024', part: 'fuse', wantCandidates: true });
  pass('four parts: QR, consent, real model, boxes for that part only, back to the same inspection step, with no key anywhere the page can read');
  await run({ task: 'fuse-box', id: 'commons-066', part: 'fuse', wantCandidates: false });
  pass('nothing found says so, keeps the drawing guide, and the inspection goes on');
  result.calls = server.ledger.count - before;
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push((error.stack ?? error.message).split(KEY).join('[key]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.stop();
  result.ledgerTotal = server.ledger.count;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2).split(KEY).join('[key]'));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, calls: result.calls, ledgerTotal: result.ledgerTotal, runs: result.runs, errors: result.errors }, null, 1).split(KEY).join('[key]'));
}
