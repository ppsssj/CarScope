// P13-B: the truth page and the prepare -> plan -> MOCK run -> report chain in real Chrome, on generated pictures with invented answers.
// Not a human review, not a real photo, no model call. Proves the page and the pipeline, not any accuracy. Runs in CI.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTruthServer } from '../washer-eval/washer-truth-server.mjs';
import { buildManifest, report, runEvaluation, status } from '../scripts/washer-eval.mjs';
import { prepare } from '../scripts/washer-prepare.mjs';
import { compareCrops } from '../scripts/washer-crop-compare.mjs';
import { dataOf, makeFixture } from './review-fixture.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const evidence = process.env.CARSCOPE_EVIDENCE_DIR ?? null;
if (evidence) mkdirSync(evidence, { recursive: true });
const fixture = makeFixture();
const manifest = join(fixture.dir, 'washer-set.json'), none = join(fixture.dir, 'none.json');
writeFileSync(manifest, JSON.stringify(buildManifest({ data: dataOf(fixture), p12gReview: none })));
const truthFile = join(fixture.dir, 'p13-b', 'truth.json'), preparedDir = join(fixture.dir, 'p13-b', 'prepared'), runsDir = join(fixture.dir, 'p13-b', 'runs');
const common = { synthetic: true, data: dataOf(fixture), manifest, p12gReview: none, env: {} };
const checks = [];
const pass = text => { checks.push(text); console.log(`PASS ${text}`); };
let server, browser;
try {
  server = await startTruthServer({ truthFile, ...common });
  browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  const outside = [];
  page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()); });
  await page.goto(server.url);
  await page.waitForSelector('#list button');
  assert.equal(await page.locator('#synthetic').isVisible(), true);
  await page.locator('#list button[data-id="syn-a"]').click();
  await page.waitForSelector('#work:not([hidden])');
  assert.equal(await page.locator('#answers input:checked').count(), 0, 'no answer preselected');
  assert.equal(await page.locator('#region-buttons button[aria-pressed="true"]').count(), 0, 'no region preselected');
  assert.equal(await page.locator('#region-buttons button').count(), 3, 'two stored washer detections and "none"');
  assert.doesNotMatch(await page.locator('#work').innerText(), /P12-F|초안|draft/i, 'no draft label on the page');
  // Completion is refused without a reviewer, and without a chosen region.
  await page.locator('#save-complete').click();
  assert.match(await page.locator('#message').innerText(), /검수자/);
  await page.locator('#reviewer').fill('synthetic-tester');
  await page.locator('#save-complete').click();
  assert.match(await page.locator('#message').innerText(), /영역/);
  await page.getByRole('button', { name: 'AI 탐지 1 사용' }).click();
  await page.waitForFunction(() => window.__washerTruth?.cropRects?.m40 && window.__washerTruth?.cropRects?.m80);
  const sizes = await page.evaluate(() => ['m40', 'm80'].map(k => { const c = document.getElementById(`crop-${k}`); return [c.width, c.height]; }));
  assert.ok(sizes[1][0] > sizes[0][0] && sizes[1][1] > sizes[0][1], `80% shows more than 40%: ${JSON.stringify(sizes)}`);
  assert.match(await page.locator('#expected').innerText(), /모든 질문에 답하면/, 'no expectation from unanswered questions');
  for (const [key, value] of [['identification', 'WASHER_CAP'], ['capMissing', 'NO'], ['capOpen', 'NO'], ['capDamage', 'UNKNOWN'], ['judgeable', 'JUDGEABLE'], ['personalData', 'NONE_VISIBLE']]) await page.locator(`input[name="${key}"][value="${value}"]`).check();
  assert.match(await page.locator('#expected').innerText(), /채점하지 않아요/, 'an UNKNOWN damage answer leaves the state unscored');
  if (evidence) await page.screenshot({ path: join(evidence, 'washer-truth-synthetic.png'), fullPage: true });
  await page.locator('#save-complete').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('검수 완료'));
  pass('a fresh photo has no region and no answer chosen; completion needs a typed reviewer and a chosen region; a stored detection gives two crops, 80% wider; UNKNOWN is accepted');

  // syn-c has no detection: the person draws the region.
  await page.locator('#list button[data-id="syn-c"]').click();
  await page.waitForFunction(() => window.__washerTruth?.id === 'syn-c');
  assert.equal(await page.locator('#region-buttons button').count(), 1, 'only "none" when nothing was detected');
  const box = await page.locator('#photo').boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.__washerTruth.truth.region.source === 'HUMAN' && window.__washerTruth.cropRects?.m80);
  for (const [key, value] of [['identification', 'NOT_WASHER_CAP'], ['capMissing', 'NO'], ['capOpen', 'NO'], ['capDamage', 'NO'], ['judgeable', 'JUDGEABLE'], ['personalData', 'NONE_VISIBLE']]) await page.locator(`input[name="${key}"][value="${value}"]`).check();
  await page.locator('#save-complete').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('검수 완료'));
  assert.match(await page.locator('#progress').innerText(), /검수 완료 2 \/ 3/);
  // A photo saved as a draft only.
  await page.locator('#list button[data-id="syn-b"]').click();
  await page.waitForFunction(() => window.__washerTruth?.id === 'syn-b');
  await page.locator('#save-draft').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('임시'));
  assert.deepEqual(problems, []); assert.deepEqual(outside, [], 'the page called nothing outside 127.0.0.1');
  pass('a drawn region is HUMAN; a draft save needs no answers; the page loaded only from 127.0.0.1');
  await page.close();
  await server.close(); server = null;

  // Chrome cuts the crops again and they must equal what the person saw.
  const index = await prepare({ truthFile, preparedDir, ...common });
  assert.deepEqual(index.problems, []);
  assert.deepEqual(Object.keys(index.images).sort(), ['syn-a', 'syn-c']);
  const saved = JSON.parse(readFileSync(truthFile, 'utf8'));
  for (const id of ['syn-a', 'syn-c']) for (const key of ['m40', 'm80']) assert.deepEqual(index.images[id][key].rect, saved.images[id].cropRects[key], `${id} ${key}`);
  assert.ok(index.images['syn-a'].m40.sha256 !== index.images['syn-a'].m80.sha256);
  pass('prepared crops equal the ones the reviewer saw, and the two margins differ');

  const s = status({ truthFile, preparedDir, ...common, budget: 5, approvalFile: join(fixture.dir, 'none.json') });
  assert.deepEqual(s.plan.calls.map(c => `${c.imageId}:${c.margin}`), ['syn-a:0.4', 'syn-a:0.8', 'syn-c:0.4', 'syn-c:0.8']);
  assert.ok(s.checklist.some(c => c.id === 'OWNER_APPROVAL_FILE' && c.status === 'BLOCKED'));
  await runEvaluation({ runId: 'mock-browser', mock: true, runsDir, truthFile, preparedDir, ...common });
  const r = report({ runId: 'mock-browser', runsDir, truthFile, preparedDir, ...common, approvalFile: join(fixture.dir, 'none.json') });
  assert.equal(r.kind, 'MOCK_NOT_A_MEASUREMENT');
  assert.equal(r.calls.total, 4);
  assert.equal(r.byMargin.m40.partMatch.scored, 2);
  assert.equal(r.byMargin.m40.partMatch.agree, 1, 'the MOCK is wrong on the drawn region, as expected of a MOCK');
  assert.equal(r.byMargin.m40.state.scored, 1, 'syn-a has an UNKNOWN damage answer, syn-c expects WRONG_PART');
  pass('status plans both pairs and keeps the approval BLOCKED; a MOCK run and its report are marked MOCK_NOT_A_MEASUREMENT');

  // P13-C: a report is written once; the crop comparison reproduces the prepared crops and agrees with the pure plan.
  assert.throws(() => report({ runId: 'mock-browser', runsDir, truthFile, preparedDir, ...common }), /REPORT_EXISTS/);
  const preparedBefore = readFileSync(join(preparedDir, 'prepared.json'), 'utf8');
  const cmp = await compareCrops({ out: join(fixture.dir, 'p13-c', 'crop-compare'), truthFile, preparedDir, ...common });
  assert.deepEqual(cmp.reproduced, { checked: 2, equal: 2 }, 'B and C are byte-identical to the prepared crops');
  assert.equal(cmp.calls, 0);
  for (const p of cmp.photos) {
    assert.equal(p.comparison.arms.A_PRODUCT.minimumDecided.width || p.comparison.arms.A_PRODUCT.minimumDecided.height, true, `${p.id}: the product minimum decides a small region`);
    for (const key of ['A_PRODUCT', 'B_EVAL_40', 'C_EVAL_80']) assert.equal(p.comparison.arms[key].containsPart, true);
  }
  assert.equal(readFileSync(join(preparedDir, 'prepared.json'), 'utf8'), preparedBefore, 'prepared index untouched');
  assert.match(readFileSync(join(fixture.dir, 'p13-c', 'crop-compare', 'index.html'), 'utf8'), /default-src 'none'/);
  pass('reports are not overwritten; the three-arm comparison reproduces B and C byte for byte and leaves the prepared crops as they were');
  console.log(JSON.stringify({ status: 'PASS', kind: 'SYNTHETIC_NOT_A_REVIEW', checks: checks.length }));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  fixture.cleanup();
}
