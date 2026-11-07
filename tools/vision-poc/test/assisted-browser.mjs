// Synthetic import exercises editing without ever writing a real review.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startReviewServer } from '../review/review-server.mjs';
import { ASSISTED_SCHEMA } from '../review/assisted-model.mjs';
import { PART_KEYS } from '../review/review-model.mjs';
import { makeFixture, dataOf, WASHER } from './review-fixture.mjs';
const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const f = makeFixture(), sidecar = path.join(f.dir, 'assisted.json');
const rows = f.images.map(i => ({ id: i.id, dataset: 'P12F', sha256: i.sha256, vehicleYear: null, vehicleIdentityBasis: 'Synthetic only', analysis: 'PIXELS_INSPECTED', parts: Object.fromEntries(PART_KEYS.map(k => [k, { status: 'UNKNOWN', boxes: [], caps: [], evidence: 'Synthetic observation', uncertainty: 'Unknown configuration', references: [], additionalReferenceNeeded: true }])) }));
rows[0].parts.washer.status = 'VISUAL_CANDIDATE'; rows[0].parts.washer.caps = [WASHER];
Object.assign(rows[1].parts.washer, { status: 'EVIDENCE_SUPPORTED', caps: [WASHER], additionalReferenceNeeded: false, references: [{ url: 'https://example.org/synthetic', title: 'Synthetic source', locator: '1', official: false, applicability: 'Synthetic only' }] });
writeFileSync(sidecar, JSON.stringify({ schema: ASSISTED_SCHEMA, evaluationType: 'PROVISIONAL_AI_ASSISTED', humanReviewed: false, images: rows }));
const server = await startReviewServer({ reviewFile: f.review, data: dataOf(f), synthetic: true, assistedFile: sidecar, env: {} });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], outside = [], puts = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()); if (r.method() === 'PUT') puts.push(r.url()); });
  await page.goto(server.url); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await page.locator('.box.assisted').count(), 1);
  await page.locator('#show-assisted').uncheck(); assert.equal(await page.locator('.box.assisted').count(), 0);
  await page.locator('#show-assisted').check(); await page.locator('#use-assisted').click();
  const draft = await page.evaluate(() => window.__review.working.parts.washer);
  assert.equal(draft.status, 'UNREVIEWED'); assert.deepEqual(draft.caps, [WASHER]);
  assert.equal(await page.locator('#reviewer').inputValue(), ''); assert.equal(await page.locator('.box.label').count(), 1);
  assert.equal(await page.evaluate(() => window.__review.dirty), true);
  assert.equal(existsSync(f.review), false); assert.deepEqual(puts, []);
  await page.locator('#filter-evidence').check(); assert.equal(await page.locator('.image-row').count(), 2);
  if (process.env.CARSCOPE_EVIDENCE_DIR) { mkdirSync(process.env.CARSCOPE_EVIDENCE_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.CARSCOPE_EVIDENCE_DIR, 'assisted-synthetic.png') }); }
  assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  console.log('PASS synthetic candidate toggle, import, undecided status, editable boxes, dirty guard, weak-evidence filter, no writes/uploads');
} finally { await browser.close(); await server.close(); f.cleanup(); }

// Real photos: read-only browser navigation + separate IONIQ set. No imports/saves.
if (process.env.CARSCOPE_REAL_ASSISTED === '1') {
  const reviewFile = 'C:/CarScope-External/p12-g/label-review.json', before = readFileSync(reviewFile);
  const real = await startReviewServer({ reviewFile });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1760, height: 1100 } });
    const outside = [], puts = [], errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()); if (r.method() === 'PUT') puts.push(r.url()); });
    await page.goto(real.url); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.locator('.image-row').count(), 26);
    for (const id of await page.locator('.image-row').evaluateAll(rows => rows.map(r => r.dataset.id))) {
      await page.locator(`.image-row[data-id="${id}"]`).click();
      await page.waitForFunction(() => document.querySelector('#photo').complete && document.querySelector('#photo').naturalWidth > 0);
    }
    await page.locator('.image-row[data-id="commons-036"]').click(); await page.locator('#show-all-parts').check();
    await page.waitForFunction(() => document.querySelector('#photo').complete);
    if (process.env.CARSCOPE_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.CARSCOPE_EVIDENCE_DIR, 'assisted-bolt.png') });
    await page.locator('#filter-dataset').selectOption('IONIQ5_REFERENCE');
    assert.equal(await page.locator('.image-row').count(), 1); assert.equal(await page.locator('#save-complete').isDisabled(), true);
    assert.equal(await page.locator('.box.assisted').count(), 5); assert.equal(await page.locator('.box.ai').count(), 0);
    await page.waitForFunction(() => document.querySelector('#photo').complete);
    if (process.env.CARSCOPE_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.CARSCOPE_EVIDENCE_DIR, 'assisted-ioniq5.png') });
    await page.locator('.part-tab[data-part="battery"]').click();
    assert.match(await page.locator('#assisted-info').innerText(), /UNKNOWN/); assert.equal(await page.locator('#use-assisted').isDisabled(), true);
    await page.locator('#filter-dataset').selectOption('P12F'); assert.equal(await page.locator('.image-row').count(), 26);
    assert.deepEqual(readFileSync(reviewFile), before); assert.deepEqual(outside, []); assert.deepEqual(puts, []); assert.deepEqual(errors, []);
    console.log('PASS real 26+1 photos, 5 IONIQ candidates, occluded battery UNKNOWN, separate set, unchanged human file, no outbound browser requests/PUTs');
  } finally { await browser.close(); await real.close(); }
}
