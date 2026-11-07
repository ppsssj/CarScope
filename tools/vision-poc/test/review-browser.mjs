// P12-G: the review page in real Chrome on a made-up set: generated pictures, invented answers. Every "review" here is a test action in a file marked synthetic and thrown away.
//   npm run test:browser:review   (CARSCOPE_EVIDENCE_DIR optionally keeps screenshots)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { startReviewServer } from '../review/review-server.mjs';
import { dataOf, makeFixture, HEIGHT, WIDTH, WASHER } from './review-fixture.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const evidence = process.env.CARSCOPE_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const fixture = makeFixture();
const labelsBefore = await readFile(fixture.labels, 'utf8');
let server = await startReviewServer({ reviewFile: fixture.review, data: dataOf(fixture), synthetic: true, env: {} });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
let failures = 0, checks = 0;
const check = async (name, work) => { checks++; try { await work(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); } };

async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  const log = { outside: [], errors: [], puts: 0 };
  page.on('request', request => { const url = new URL(request.url()); if (url.hostname !== '127.0.0.1') log.outside.push(request.url()); if (request.method() === 'PUT') log.puts++; });
  page.on('pageerror', error => log.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) log.errors.push(message.text()); });
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.waitForFunction(() => document.querySelector('#photo').complete && document.querySelector('#photo').naturalWidth > 0);
  return { context, page, log };
}
const rectOf = (page, selector) => page.locator(selector).first().evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const near = (a, b, tolerance = 1.5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
/** Where a box should be on screen, worked out only from the picture element's own rectangle. */
const expected = (photo, box) => ({ x: photo.x + box[0] * photo.width, y: photo.y + box[1] * photo.height, width: box[2] * photo.width, height: box[3] * photo.height });
const assertOn = async (page, selector, box, inset = 0) => {
  const photo = await rectOf(page, '#photo'), node = await rectOf(page, selector), want = expected(photo, box);
  near(node.x, want.x - inset); near(node.y, want.y - inset); near(node.width, want.width + inset * 2); near(node.height, want.height + inset * 2);
};
async function dragOnPhoto(page, from, to) {
  const photo = await rectOf(page, '#photo');
  await page.mouse.move(photo.x + from[0] * photo.width, photo.y + from[1] * photo.height);
  await page.mouse.down();
  await page.mouse.move(photo.x + ((from[0] + to[0]) / 2) * photo.width, photo.y + ((from[1] + to[1]) / 2) * photo.height);
  await page.mouse.move(photo.x + to[0] * photo.width, photo.y + to[1] * photo.height);
  await page.mouse.up();
}
const status = (page, value) => page.locator(`input[name="part-status"][value="${value}"]`).check();
const tab = (page, key) => page.locator(`.part-tab[data-part="${key}"]`).click();
const working = (page, key) => page.evaluate(k => window.__review.working.parts[k], key);
const shot = async (page, name) => { if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`) }); };

await check('opens with nothing decided: progress from the data, no reviewer, no adopted draft, marked as synthetic', async () => {
  const { context, page, log } = await open();
  assert.match(await page.locator('#progress').innerText(), /전체 3장[\s\S]*사람 검수 완료 0장[\s\S]*검수 필요 3장/);
  assert.equal(await page.locator('#reviewer').inputValue(), '');
  assert.equal(await page.locator('#synthetic').isVisible(), true);
  assert.equal(await page.locator('#review-state').innerText(), 'SYNTHETIC_NOT_A_REVIEW');
  assert.equal((await page.locator('.box.label').count()), 0, 'nothing is pre-filled as an answer');
  assert.equal(await page.locator('input[name="part-status"]:checked').getAttribute('value'), 'UNREVIEWED');
  assert.equal(await page.evaluate(() => window.__review.dirty), false);
  assert.deepEqual(log.errors, []);
  await context.close();
});

await check('draft, AI and label layers are separate, can be turned off, and stay on the picture through zoom and pan', async () => {
  const { context, page } = await open();
  assert.equal(await page.locator('.box.ai').count(), 2, 'washer class at 0.4 or more');
  await assertOn(page, '.box.ai >> nth=0', WASHER);
  await assertOn(page, '.box.draft', WASHER);
  await page.locator('#show-ai').uncheck(); assert.equal(await page.locator('.box.ai').count(), 0);
  await page.locator('#show-ai').check();
  await page.locator('#show-draft').uncheck(); assert.equal(await page.locator('.box.draft').count(), 0);
  await page.locator('#show-draft').check();
  await page.locator('#ai-threshold').selectOption('0.05'); await tab(page, 'coolant');
  assert.equal(await page.locator('.box.ai').count(), 1, 'below 0.4 only when asked');
  await tab(page, 'washer'); await page.locator('#ai-threshold').selectOption('0.4');
  assert.equal(await page.locator('.box.ai.other').count(), 0);
  await page.locator('#show-other').check(); assert.equal(await page.locator('.box.ai.other').count(), 1, 'Radiator Cap, shown on request');
  await page.locator('#show-other').uncheck();
  const before = await rectOf(page, '#photo');
  await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
  const after = await rectOf(page, '#photo');
  assert.ok(after.width > before.width * 1.5);
  await assertOn(page, '.box.ai >> nth=0', WASHER);
  const frame = await rectOf(page, '#frame');
  await page.mouse.move(frame.x + 300, frame.y + 200); await page.mouse.wheel(0, -300);
  await assertOn(page, '.box.draft', WASHER);
  await page.mouse.move(frame.x + 20, frame.y + frame.height - 20); await page.mouse.down(); await page.mouse.move(frame.x + 90, frame.y + frame.height - 70); await page.mouse.up();
  await assertOn(page, '.box.draft', WASHER);
  assert.equal(await page.evaluate(() => window.__review.dirty), false, 'looking is not editing');
  await page.locator('#zoom-fit').click(); near((await rectOf(page, '#photo')).width, before.width);
  assert.equal(await page.locator('#photo').evaluate(img => img.naturalWidth), WIDTH); assert.equal(await page.locator('#photo').evaluate(img => img.naturalHeight), HEIGHT);
  await context.close();
});

await check('a person draws, moves, resizes and deletes; the numbers stay fractions at any zoom', async () => {
  const { context, page } = await open();
  await page.locator('#zoom-in').click();
  await page.locator('[data-tool="boxes"]').click();
  await dragOnPhoto(page, [0.3, 0.3], [0.5, 0.6]);
  let part = await working(page, 'washer');
  assert.equal(part.boxes.length, 1);
  part.boxes[0].forEach((value, i) => near(value, [0.3, 0.3, 0.2, 0.3][i], 0.004));
  assert.equal(await page.evaluate(() => window.__review.dirty), true);
  assert.equal(await page.locator('#dirty').isVisible(), true);
  await assertOn(page, '.box.label', part.boxes[0], 0);
  assert.equal(await page.locator('button[data-tool="select"]').getAttribute('aria-pressed'), 'true', 'back to the selection tool');
  await dragOnPhoto(page, [0.4, 0.45], [0.45, 0.5]);
  part = await working(page, 'washer');
  part.boxes[0].forEach((value, i) => near(value, [0.35, 0.35, 0.2, 0.3][i], 0.004));
  const moved = part.boxes[0], handle = await rectOf(page, '.box.label .handle.se');
  await page.mouse.move(handle.x + 5, handle.y + 5); await page.mouse.down(); await page.mouse.move(handle.x + 45, handle.y + 45); await page.mouse.up();
  part = await working(page, 'washer');
  assert.ok(part.boxes[0][2] > moved[2] && part.boxes[0][3] > moved[3], 'the far corner moved');
  near(part.boxes[0][0], moved[0], 0.0002); near(part.boxes[0][1], moved[1], 0.0002);
  await page.locator('[data-tool="caps"]').click();
  await dragOnPhoto(page, [0.36, 0.36], [0.42, 0.42]);
  assert.equal((await working(page, 'washer')).caps.length, 1, 'a cap is its own kind of box');
  assert.equal(await page.locator('.box.label.caps').count(), 1);
  await page.locator('[data-tool="boxes"]').click();
  await dragOnPhoto(page, [0.7, 0.7], [0.8, 0.8]);
  assert.equal((await working(page, 'washer')).boxes.length, 2, 'several of one part');
  await page.keyboard.press('Delete');
  assert.equal((await working(page, 'washer')).boxes.length, 1);
  assert.equal(await page.locator('#tool-hv').isVisible(), false);
  await tab(page, 'battery');
  assert.equal(await page.locator('#tool-hv').isVisible(), true, 'high voltage regions belong to the battery review');
  await context.close();
});

await check('the draft is only copied by a click, and copying decides nothing', async () => {
  const { context, page } = await open();
  await page.locator('#use-draft').click();
  const part = await working(page, 'washer');
  assert.deepEqual(part.boxes, [WASHER]);
  assert.equal(part.status, 'UNREVIEWED', 'the decision stays with the person');
  await tab(page, 'fuse');
  assert.equal(await page.locator('#use-draft').isDisabled(), true);
  assert.match(await page.locator('#draft-info').innerText(), /초안 없음/);
  await context.close();
});

await check('finishing is refused without a reviewer or with an undecided part, and nothing is sent', async () => {
  const { context, page, log } = await open();
  await page.locator('#save-complete').click();
  assert.match(await page.locator('#save-problem').innerText(), /검수자를 직접 입력/);
  await page.locator('#reviewer').fill('synthetic-tester');
  await page.locator('#save-complete').click();
  assert.match(await page.locator('#save-problem').innerText(), /아직 판정하지 않았어요/);
  assert.equal(log.puts, 0);
  await status(page, 'PRESENT');
  assert.match(await page.locator('#part-problem').innerText(), /박스가 필요해요/);
  assert.equal(await page.locator('.part-tab[data-part="washer"] .tab-status').innerText(), '있음');
  assert.equal(log.puts, 0);
  await context.close();
});

await check('a saved review comes back, the list marks it, progress moves, and figures change with the label', async () => {
  const { context, page, log } = await open();
  await page.locator('#reviewer').fill('synthetic-tester');
  await page.locator('#use-draft').click();
  await status(page, 'PRESENT');
  await page.locator('#part-note').fill('합성 메모');
  await page.locator('#part-reference').fill('합성 근거');
  await page.locator('#save-draft').click();
  await page.waitForFunction(() => document.querySelector('#photo-state').textContent.includes('진행 중'));
  assert.match(await page.locator('#progress').innerText(), /진행 중 1장/);
  await tab(page, 'coolant'); await status(page, 'UNKNOWN');
  await tab(page, 'brake'); await status(page, 'ABSENT');
  await tab(page, 'fuse'); await status(page, 'NEEDS_REFERENCE');
  await page.locator('#save-complete').click();
  assert.match(await page.locator('#save-problem').innerText(), /무엇을 확인할지 메모/);
  await page.locator('#part-reference').fill('정비 문서 확인 필요');
  await tab(page, 'battery'); await status(page, 'UNKNOWN');
  await tab(page, 'lcw'); await status(page, 'UNKNOWN');
  await page.locator('#save-complete').click();
  await page.waitForFunction(() => document.querySelector('#photo-state').textContent.includes('검수 완료'));
  assert.match(await page.locator('#progress').innerText(), /사람 검수 완료 1장[\s\S]*검수 필요 2장/);
  assert.equal(await page.locator('#dirty').isVisible(), false);
  assert.equal(await page.locator('.image-row[data-id="syn-a"]').locator('.mark').innerText(), '●');
  await page.locator('#evaluation-box').evaluate(node => { node.open = true; });
  const washer = await page.locator('tr[data-part="washer"]').innerText();
  assert.match(washer, /1\s+1\s+0\s+0\.5\s+1\s+0\.667/, 'TP 1, FP 1, FN 0 with the box at the other corner false');
  assert.equal(await page.locator('tr[data-part="brake"]').count(), 1);
  assert.equal(await page.locator('tr[data-part="coolant"]').count(), 0, 'UNKNOWN gives no figure');
  await shot(page, 'synthetic-after-save');
  // Now correct the label: the same model answers, new figures.
  await tab(page, 'washer');
  await page.locator('[data-tool="boxes"]').click();
  await dragOnPhoto(page, [0.75, 0.05], [0.85, 0.15]);
  await page.locator('#save-complete').click();
  await page.waitForFunction(() => !document.querySelector('#dirty').checkVisibility());
  assert.match(await page.locator('tr[data-part="washer"]').innerText(), /2\s+0\s+0\s+1\s+1\s+1/);
  await page.locator('#evaluation-box').evaluate(node => { node.open = false; });
  const file = JSON.parse(await readFile(fixture.review, 'utf8'));
  assert.equal(file.synthetic, true);
  assert.equal(file.images['syn-a'].reviewer, 'synthetic-tester');
  assert.equal(file.images['syn-a'].parts.coolant.status, 'UNKNOWN');
  assert.equal(file.images['syn-a'].parts.brake.status, 'ABSENT');
  assert.equal(file.images['syn-a'].parts.washer.note, '합성 메모');
  assert.deepEqual(log.outside, []);
  assert.deepEqual(log.errors, []);
  await context.close();
  // A new browser, and the same server restarted: the review is still there.
  await server.close();
  server = await startReviewServer({ reviewFile: fixture.review, data: dataOf(fixture), synthetic: true, env: {} });
  const again = await open();
  assert.match(await again.page.locator('#progress').innerText(), /사람 검수 완료 1장/);
  assert.equal(await again.page.evaluate(() => window.__review.id), 'syn-b', 'opens at the next photo to do');
  await again.page.locator('.image-row[data-id="syn-a"]').click();
  await again.page.waitForFunction(() => window.__review.id === 'syn-a');
  assert.equal((await working(again.page, 'washer')).boxes.length, 2);
  assert.equal(await again.page.locator('.box.label').count(), 2);
  assert.equal(await again.page.locator('#reviewer').inputValue(), '', 'a new session names its own reviewer');
  await again.context.close();
});

await check('unsaved work is warned about, on leaving the photo and the page', async () => {
  const { context, page } = await open();
  await page.locator('[data-tool="boxes"]').click();
  await dragOnPhoto(page, [0.1, 0.1], [0.2, 0.2]);
  const before = await page.evaluate(() => window.__review.id);
  page.once('dialog', dialog => { assert.match(dialog.message(), /사라져요/); dialog.dismiss(); });
  await page.locator('#next').click();
  assert.equal(await page.evaluate(() => window.__review.id), before, 'stays when declined');
  assert.equal((await working(page, 'washer')).boxes.length, 1);
  assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; }), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#next').click();
  assert.notEqual(await page.evaluate(() => window.__review.id), before);
  await context.close();
});

await check('the filters narrow the list by state', async () => {
  const { context, page } = await open();
  await page.locator('#filter-state').selectOption('HUMAN_REVIEWED');
  assert.deepEqual(await page.locator('.image-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['syn-a']);
  await page.locator('#filter-state').selectOption('UNREVIEWED');
  assert.deepEqual(await page.locator('.image-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['syn-b', 'syn-c']);
  await page.locator('#filter-state').selectOption('ALL');
  assert.equal(await page.locator('#filter-case option').count(), 9);
  await context.close();
});

await check('the label file is exactly as it was, and no page ever asked outside 127.0.0.1', async () => {
  assert.equal(await readFile(fixture.labels, 'utf8'), labelsBefore);
  assert.equal(JSON.parse(labelsBefore).labelsReviewedByPerson, false);
});

await browser.close();
await server.close();
fixture.cleanup();
console.log(JSON.stringify({ kind: 'SYNTHETIC_PICTURES_AND_REVIEWS', realPhotos: 'NOT_USED', humanReview: 'NOT_A_REVIEW', checks, failures }));
process.exit(failures ? 1 : 0);
