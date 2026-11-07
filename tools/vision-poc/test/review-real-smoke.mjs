// P12-G: opens the review page on the real photos and stored answers, looks, and saves NOTHING. Local only, because the photos are not in Git. Not part of CI.
//   CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p12-g/smoke node test/review-real-smoke.mjs
// Takes the path of a review file that must not exist, and fails if one appears. The model is not called and no key is read.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PATHS } from '../review/review-data.mjs';
import { startReviewServer } from '../review/review-server.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const evidence = process.env.CARSCOPE_EVIDENCE_DIR;
if (!evidence) throw Error('Set CARSCOPE_EVIDENCE_DIR outside the repository');
await mkdir(evidence, { recursive: true });
const LEDGER = 'C:/CarScope-External/p12-f/calls.json';
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const ledgerBefore = digest(LEDGER), labelsBefore = readFileSync(DEFAULT_PATHS.labels);
const reviewFile = path.join(await mkdtemp(path.join(tmpdir(), 'carscope-smoke-')), 'not-a-review.json');
let fetches = 0; const realFetch = globalThis.fetch; globalThis.fetch = (...args) => { fetches++; return realFetch(...args); };
const server = await startReviewServer({ reviewFile, data: { p12cResults: DEFAULT_PATHS.p12cResults } });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage();
const outside = [], errors = [], puts = [];
page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') outside.push(request.url()); if (request.method() !== 'GET') puts.push(request.url()); });
page.on('pageerror', error => errors.push(String(error)));
const out = { kind: 'REAL_PHOTOS_READ_ONLY', humanReview: 'NOT_DONE', images: [] };
try {
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.match(await page.locator('#progress').innerText(), /전체 26장[\s\S]*사람 검수 완료 0장[\s\S]*검수 필요 26장/);
  assert.equal(await page.locator('#review-state').innerText(), 'AWAITING_HUMAN_REVIEW');
  assert.equal(await page.locator('#metric-state').innerText(), 'HUMAN_REVIEW_PENDING');
  assert.equal(await page.locator('#synthetic').isVisible(), false);
  const rows = await page.locator('.image-row').evaluateAll(list => list.map(row => row.dataset.id));
  assert.equal(rows.length, 26);
  for (const id of rows) {
    await page.locator(`.image-row[data-id="${id}"]`).click();
    await page.waitForFunction(value => window.__review.id === value, id);
    await page.waitForFunction(() => document.querySelector('#photo').complete && document.querySelector('#photo').naturalWidth > 0);
    out.images.push({ id, width: await page.locator('#photo').evaluate(img => img.naturalWidth), labels: await page.locator('.box.label').count() });
  }
  assert.ok(out.images.every(image => image.labels === 0), 'no answer is pre-filled on any real photo');
  assert.equal(await page.evaluate(() => window.__review.dirty), false);
  const view = async (imageId, part, name) => { await page.locator(`.image-row[data-id="${imageId}"]`).click(); await page.waitForFunction(value => window.__review.id === value, imageId); await page.locator(`.part-tab[data-part="${part}"]`).click(); await page.waitForFunction(() => document.querySelector('#photo').complete); await page.screenshot({ path: path.join(evidence, name) }); };
  await view('new-08', 'washer', 'real-new-08-washer.png');
  await page.locator('#show-all-parts').check();
  await view('commons-036', 'brake', 'real-commons-036-all-parts.png');
  await page.locator('#filter-case').selectOption('leaf');
  assert.deepEqual(await page.locator('.image-row').evaluateAll(list => list.map(row => row.dataset.id)), ['new-00', 'new-04']);
  await page.locator('#evaluation-box').evaluate(node => { node.open = true; });
  await page.locator('#evaluation-box').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'real-leaf-case-evaluation.png') });
  const evaluation = await (await realFetch(`${server.url}/api/state`)).json();
  // The draft figures must be P12-F's own, proving the stored answers and the rule are the same ones.
  const P12F = { washer: [6, 0, 8], coolant: [4, 2, 9], brake: [7, 1, 10], battery: [6, 0, 8], fuse: [1, 0, 2] };
  for (const [key, want] of Object.entries(P12F)) { const m = evaluation.evaluation.parts[key].p12fDraftAllPhotos; assert.deepEqual([m.tp, m.fp, m.fn], want, key); assert.equal(evaluation.evaluation.parts[key].reviewed, 'HUMAN_REVIEW_PENDING', key); }
  out.predictions = evaluation.images.reduce((sum, image) => sum + image.predictions.length, 0);
  assert.deepEqual(outside, [], 'no request left this machine');
  assert.deepEqual(puts, [], 'nothing was saved');
  assert.deepEqual(errors, []);
  assert.equal(existsSync(reviewFile), false, 'no review file was made');
  assert.equal(digest(LEDGER), ledgerBefore, 'the call ledger did not change');
  assert.ok(readFileSync(DEFAULT_PATHS.labels).equals(labelsBefore));
  assert.equal(fetches, 0, 'the server itself made no request');
  out.status = 'PASS'; out.ledger = JSON.parse(readFileSync(LEDGER, 'utf8')).calls.length;
} catch (error) { out.status = 'FAIL'; out.error = error.stack; process.exitCode = 1; }
await browser.close();
await server.close();
console.log(JSON.stringify({ status: out.status, ledger: out.ledger, predictions: out.predictions, images: out.images.length, error: out.error }, null, 1));
