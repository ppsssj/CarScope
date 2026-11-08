// P13-A: part search -> region -> crop -> consent -> analysis -> result, on the real inspection page. Mobile Chrome, real QR v2 sync HTTP
// on a local session, a generated picture, a fixture detector (no Roboflow call) and the MOCK vision provider (no OpenAI call).
// Nothing here measures how well a real model sees: the MOCK does not look at the picture.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';
import { DEFAULT_RATES } from '../../inspection-sync-poc/src/rate-limit.mjs';
import { createMockVisionProvider, fixtureDetectionProvider } from '../../vision-poc/src/mock-vision-provider.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p13-a');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_FIXTURE_DETECTOR_MOCK_VISION', realDetector: 'NOT_RUN', realVision: 'REAL_PROVIDER_NOT_RUN', realPhone: 'NOT_RUN', render: 'NOT_RUN', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };

// A generated picture: grey, with a blue square where candidate 1 is and a green one at candidate 2. Nobody's car.
const WIDTH = 1600, HEIGHT = 1200;
const C1 = [0.42, 0.4, 0.12, 0.1], C2 = [0.1, 0.7, 0.1, 0.1];
const png = new PNG({ width: WIDTH, height: HEIGHT });
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
  const i = (y * WIDTH + x) * 4, u = x / WIDTH, v = y / HEIGHT;
  const inBox = ([l, t, w, h]) => u >= l && u < l + w && v >= t && v < t + h;
  const [r, g, b] = inBox(C1) ? [20, 60, 230] : inBox(C2) ? [30, 200, 60] : [70, 74, 80];
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
const PICTURE = { name: 'synthetic.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };

const fixture = fixtureDetectionProvider([{ className: 'Windshield Wiper Fluid', score: 0.8, box: C1 }, { className: 'Windshield Wiper Fluid', score: 0.6, box: C2 }]);
const detector = { mode: 'found', calls: 0, async detect(input) { detector.calls++; if (detector.mode === 'fail') throw new Error('detector down'); if (detector.mode === 'none') return { imageWidth: 640, imageHeight: 480, predictions: [] }; const out = await fixture.detect(input); return out; } };
const vision = createMockVisionProvider();
const wide = { limit: 1000, windowMs: 60_000 };
const rates = { ...DEFAULT_RATES, detect: wide, 'detect-session': { limit: 1000, windowMs: 600_000 }, analyze: wide, 'analyze-session': { limit: 1000, windowMs: 600_000 } };
let now = Date.now(), browser;
const authorizer = new LocalTestSessionCreationAuthorizer();
const on = await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector }, partAnalysis: { provider: vision } });
const detectOnly = await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector } });
const contexts = [];
const closeAll = () => Promise.all(contexts.splice(0).map(context => context.close().catch(() => {})));

async function open({ host = on, task = 'washer-fluid', viewport = { width: 390, height: 844 } } = {}) {
  now += 61_000;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) log.problems.push(message.text()); });
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), headers: request.headers(), bodyBytes: request.postDataBuffer()?.length ?? 0, body: /part-(detections|analyses)/.test(request.url()) ? '' : request.postData() ?? '' }));
  page.on('response', async response => { if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); } });
  const receiver = new ReceiverClient({ baseUrl: host.url });
  const session = await receiver.create(task);
  log.secrets.push(session.fragment.split('invite=')[1]);
  await page.goto(`${host.url}/${session.fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  return { page, log, receiver, context };
}
const analyses = log => log.requests.filter(r => r.method === 'POST' && r.url.includes('/v1/part-analyses/'));
const posted = (log, suffix) => log.requests.filter(r => r.method === 'POST' && r.url.endsWith(suffix)).length;
const waitPhase = (page, name) => page.waitForFunction(value => window.__partDetection?.state.phase === value, name);
const aphase = page => page.evaluate(() => window.__partAnalysis?.state.phase ?? null);
const waitA = (page, name) => page.waitForFunction(value => window.__partAnalysis?.state.phase === value, name);
const waitCrop = page => page.waitForFunction(() => window.__partAnalysis?.state.cropReady === true);
async function search(page, { location = false } = {}) {
  await page.waitForFunction(() => window.__partDetection);
  await page.locator(location ? '#part-detect-open-location' : '#part-detect-open').click();
  await waitPhase(page, 'CONSENT');
  await page.locator('#part-detect-agree').check();
  await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
}
async function analyse(page, candidate = 1) {
  await page.locator(`#part-analysis-candidate-${candidate}`).click();
  await waitCrop(page);
  await page.locator('#part-analysis-agree').check();
  await page.locator('#part-analysis-start').click();
}
const shot = async (page, name, fullPage = false, at = null) => { if (at) await page.locator(at).evaluate(node => node.scrollIntoView({ block: 'start' })); return page.screenshot({ path: path.join(output, `${name}.png`), fullPage }); };
const pixel = (page, id, [u, v]) => page.evaluate(([id, u, v]) => { const c = document.getElementById(id); const d = c.getContext('2d').getImageData(Math.min(c.width - 1, Math.round(u * c.width)), Math.min(c.height - 1, Math.round(v * c.height)), 1, 1).data; return [d[0], d[1], d[2]]; }, [id, u, v]);
async function noLeak({ page, log }) {
  const html = await page.content(), historyState = await page.evaluate(() => JSON.stringify(history.state));
  assert.equal(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])), '[{},{},""]');
  for (const secret of log.secrets) {
    assert.ok(!html.includes(secret) && !historyState.includes(secret) && !page.url().includes(secret), 'token in the page, history or address');
    assert.ok(log.requests.every(r => !r.url.includes(secret) && !r.body.includes(secret)), 'token in a URL or body');
  }
  assert.ok(!/sk-should-never-leave|mock upstream/.test(html), 'upstream text in the page');
  assert.ok(log.requests.every(r => new URL(r.url).hostname === '127.0.0.1'), 'the page calls only its own origin');
}

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();

  { // Off, and only where a profile is offered.
    const plain = await open({ host: detectOnly });
    await search(plain.page);
    await waitPhase(plain.page, 'CANDIDATES');
    await plain.page.waitForTimeout(200);
    assert.equal(await plain.page.locator('#part-analysis').count(), 0);
    assert.equal(await plain.page.evaluate(() => document.body.dataset.partAnalysis), undefined);
    assert.ok(!plain.log.requests.some(r => /part-analys|context-crop/.test(r.url)), 'no file and no request of the analysis');
    await closeAll();
    for (const task of ['fuse-box', 'coolant-reservoir', 'brake-fluid']) {
      const other = await open({ task });
      await search(other.page);
      await other.page.waitForFunction(() => ['CANDIDATES', 'NONE_FOUND'].includes(window.__partDetection.state.phase));
      await other.page.waitForTimeout(200);
      assert.equal(await other.page.locator('#part-analysis').count(), 0, `${task}: draft profile, not offered`);
      assert.equal(analyses(other.log).length, 0);
      await closeAll();
    }
    pass('with the analysis off, and for the draft parts (coolant, brake, fuse box), no analysis section, file or request exists; the part search is as before');
  }

  { // The main flow, inside a connected inspection that is already under way.
    vision.scenario = 'no-visible-issue'; vision.mode = 'answer'; vision.calls.length = 0;
    const session = await open(), { page, log, receiver } = session;
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const held = () => page.evaluate(() => { const { step, mode, checks, record } = window.__selfInspection.state; return { step, mode, checks, id: record.inspectionId, aids: record.aids, state: record.state }; });
    const before = await held();
    await search(page, { location: true });
    await waitPhase(page, 'CANDIDATES');
    await waitA(page, 'REGION');
    assert.equal(await page.locator('#part-analysis').isVisible(), true);
    assert.equal(await page.locator('#part-analysis-candidate-1').isVisible(), true);
    assert.equal(await page.locator('#part-analysis-candidate-2').isVisible(), true);
    assert.equal(await page.locator('#part-analysis-preview').isVisible(), false);
    assert.equal(analyses(log).length, 0, 'locating sends nothing to the vision service');
    await shot(page, 'region-choice', true);

    // Change of candidate: the preview follows, nothing is sent.
    await page.locator('#part-analysis-candidate-2').click();
    await waitCrop(page);
    assert.ok((await pixel(page, 'part-analysis-crop', [0.5, 0.5]))[1] > 150, 'candidate 2 (green) is in the middle of its crop');
    await page.locator('#part-analysis-candidate-1').click();
    await waitCrop(page);
    assert.equal(await page.locator('#part-analysis-candidate-1').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#part-analysis-candidate-2').getAttribute('aria-pressed'), 'false');
    const plan = await page.evaluate(() => window.__partAnalysis.plan);
    assert.deepEqual(plan.source, { width: WIDTH, height: HEIGHT }, 'cut from the original photo, not the reduced search copy');
    const [x, y, w, h] = C1.map((n, i) => n * (i % 2 ? HEIGHT : WIDTH));
    assert.ok(plan.rect.x <= x && plan.rect.y <= y && plan.rect.x + plan.rect.width >= x + w && plan.rect.y + plan.rect.height >= y + h, 'the part is whole inside the crop');
    assert.ok(plan.rect.width > w * 2 && plan.rect.height > h * 2, 'with surroundings on every side');
    assert.ok(Math.max(plan.output.width, plan.output.height) <= 1024);
    const middle = await pixel(page, 'part-analysis-crop', [plan.targetInCrop[0] + plan.targetInCrop[2] / 2, plan.targetInCrop[1] + plan.targetInCrop[3] / 2]);
    assert.ok(middle[2] > 180 && middle[0] < 80, `candidate 1 (blue) sits where targetInCrop says: ${middle}`);
    assert.ok((await pixel(page, 'part-analysis-crop', [0.02, 0.02]))[0] > 50, 'the corner is surroundings, not the part');
    const consent = await page.locator('#part-analysis-consent-text').innerText();
    for (const words of [/로컬 시험용 MOCK/, /Roboflow\)와 다른 곳/, /전체는 보내지 않아요/, /저장하지 않아요/, /확인하지 못했어요/]) assert.match(consent, words);
    assert.match(await page.locator('#part-analysis-region-note').innerText(), /AI가 찾은 후보 1/);
    assert.equal(await page.locator('#part-analysis-start').isDisabled(), true, 'no send without consent');
    await shot(page, 'crop-preview', false, '#part-analysis-preview');

    await page.locator('#part-analysis-agree').check();
    await page.locator('#part-analysis-start').dblclick(); // a real double tap: the second lands on what replaced the button
    await page.locator('#part-analysis-start').evaluate(button => button.click()); // and a press on the button itself while busy
    await waitA(page, 'RESULT');
    assert.equal(vision.calls.length, 1, 'a double tap sends once');
    assert.equal(analyses(log).length, 1);
    const [request] = analyses(log);
    assert.ok(request.url.endsWith('/v1/part-analyses/washer-fluid-cap'));
    assert.match(request.headers.authorization, /^Bearer /);
    assert.equal(request.headers['x-carscope-external-processing'], 'external-vision-v1');
    assert.equal(request.headers['x-carscope-region-source'], 'AI_CANDIDATE');
    assert.equal(request.headers['content-type'], 'image/jpeg');
    assert.deepEqual(vision.calls[0].imageSize, plan.output, 'the provider got the crop, at the crop\'s size');
    assert.ok(vision.calls[0].targetInCrop.every((n, i) => Math.abs(n - plan.targetInCrop[i]) < 1e-5));
    assert.ok(request.bodyBytes < PICTURE.buffer.length);
    assert.equal(await page.locator('#part-analysis-headline').innerText(), '사진에서 보이는 이상 징후를 찾지 못했어요');
    assert.match(await page.locator('#part-analysis-note').innerText(), /정상이라는 뜻은 아니에요/);
    assert.match(await page.locator('#part-analysis-observations').innerText(), /앞유리 분사 모양/);
    assert.equal(await page.locator('#part-analysis-issues').isVisible(), false, 'empty groups are hidden');
    assert.match(await page.locator('#part-analysis-result').innerText(), /자동 입력되거나 차량으로 보내지지 않아요/);
    assert.doesNotMatch(await page.locator('#part-detect').innerText(), /%|신뢰도|정확|확정했|안전합니다/);
    assert.equal(await page.locator('#part-analysis-continue').isDisabled(), true, 'the person confirms first');
    await shot(page, 'result-no-visible-issue', false, '#part-analysis-result');
    await page.locator('#part-analysis-ack').check();
    await page.locator('#part-analysis-continue').click();
    await page.waitForFunction(() => !document.getElementById('part-detect').open);
    await waitA(page, 'IDLE'); // the dialog's close event comes a task after open turns false
    assert.deepEqual(await held(), before, 'answers, attempt and record are as they were');
    assert.equal(posted(log, '/v1/submissions'), 0, 'the AI result sent nothing');
    // The person still answers and sends the inspection by hand.
    await page.locator('#checklist input:not(:checked)').evaluateAll(boxes => boxes.forEach(box => box.click()));
    await page.click('#primary'); await page.click('[data-status="OK"]'); await page.click('#primary'); await page.click('#primary');
    await page.waitForSelector('body[data-step="done"]');
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.getElementById('done-sync').dataset.syncState === 'SENT');
    const view = await receiver.view();
    assert.equal(view.result.inspectionId, before.id);
    assert.deepEqual(view.result.aids, { cameraUsed: false, locationMarked: false }, 'the result contract is untouched');
    assert.ok(!JSON.stringify(view.result).includes('이상 징후'), 'no AI text in the result');
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('candidate -> change -> context crop from the original (part whole, surroundings kept) -> consent naming the service -> one send of the crop -> structured result; continue needs a confirmation; the inspection answers, record and sent result are unchanged');
  }

  { // Every answer type, invalid answers and failures.
    const session = await open(), { page, log } = session;
    await search(page);
    await waitPhase(page, 'CANDIDATES');
    vision.mode = 'answer';
    vision.scenario = 'suspected';
    await analyse(page); await waitA(page, 'RESULT');
    assert.equal(await page.locator('#part-analysis-headline').innerText(), '사진에서 이상이 의심되는 부분이 있어요');
    assert.match(await page.locator('#part-analysis-issues').innerText(), /캡이 없어 보임[\s\S]*근거: 주입구 입구가 그대로 드러나/);
    await shot(page, 'result-suspected', false, '#part-analysis-result');
    await page.locator('#part-analysis-other').click(); await waitA(page, 'REGION');
    vision.scenario = 'indeterminate';
    await analyse(page); await waitA(page, 'RESULT');
    assert.equal(await page.locator('#part-analysis-headline').innerText(), '이 사진으로는 판단할 수 없어요');
    assert.match(await page.locator('#part-analysis-match').innerText(), /분명하지 않아요/);
    assert.match(await page.locator('#part-analysis-limitations').innerText(), /빛 반사/);
    assert.match(await page.locator('#part-analysis-retake-tips').innerText(), /가까이에서/);
    await shot(page, 'result-indeterminate', false, '#part-analysis-result');
    await page.locator('#part-analysis-other').click(); await waitA(page, 'REGION');
    vision.scenario = 'wrong-part';
    await analyse(page); await waitA(page, 'RESULT');
    assert.equal(await page.locator('#part-analysis-headline').innerText(), '선택한 부품이 아닌 것 같아요');
    await page.locator('#part-analysis-other').click(); await waitA(page, 'REGION');
    for (const name of ['claims-safe', 'extra-key', 'not-json']) {
      vision.scenario = name;
      await analyse(page); await waitA(page, 'FAILED');
      assert.match(await page.locator('#part-analysis-error').innerText(), /AI 응답을 확인할 수 없어 결과를 표시하지 않았어요/, name);
      assert.doesNotMatch(await page.locator('#part-detect').innerText(), /안전합니다|0\.97/, `${name}: nothing of the refused answer is shown`);
      assert.equal(await page.locator('#part-analysis-candidate-1').isVisible(), true, 'the candidates stay to pick from');
    }
    await shot(page, 'failed-invalid', false, '#part-analysis-choose');
    vision.scenario = 'no-visible-issue'; vision.mode = 'error';
    await analyse(page); await waitA(page, 'FAILED');
    assert.match(await page.locator('#part-analysis-error').innerText(), /연결하지 못했어요[\s\S]*기존 점검은 그대로/);
    await page.locator('#part-analysis-retry').click();
    assert.equal(await aphase(page), 'PREVIEW');
    assert.equal(await page.locator('#part-analysis-agree').isChecked(), false, 'a retry asks for consent again');
    vision.mode = 'answer';
    await page.route('**/v1/part-analyses/**', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"code":"RATE_LIMITED"}}' }));
    await page.locator('#part-analysis-agree').check(); await page.locator('#part-analysis-start').click(); await waitA(page, 'FAILED');
    assert.match(await page.locator('#part-analysis-error').innerText(), /잠시 후/);
    await page.unroute('**/v1/part-analyses/**');
    // Retake from the result goes back to a new photo with its own consent.
    await analyse(page); await waitA(page, 'RESULT');
    await page.locator('#part-analysis-retake').click();
    assert.equal(await page.evaluate(() => window.__partDetection.state.phase), 'CONSENT');
    assert.equal(await page.locator('#part-detect-agree').isChecked(), false);
    assert.equal(await aphase(page), 'IDLE');
    assert.equal(await page.locator('#part-analysis').isVisible(), false);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('suspected, indeterminate and wrong-part read as such with evidence, limits and retake tips; a safety claim, an extra key and non-JSON are refused and not shown; failure, retry and 429 end in words; retake asks for a new photo and consent');
  }

  { // Nothing found or the search failed: the person marks the region; it stays marked as theirs.
    detector.mode = 'none';
    const none = await open();
    await search(none.page);
    await waitPhase(none.page, 'NONE_FOUND');
    await waitA(none.page, 'REGION');
    assert.match(await none.page.locator('#part-detect-message').innerText(), /부품이 없다는 뜻은 아니에요/, 'the P12-E words stay');
    assert.equal(await none.page.locator('#part-analysis-picker').isVisible(), true);
    assert.equal(await none.page.locator('#part-analysis-choices').isVisible(), false);
    const box = await none.page.locator('#part-analysis-picker').boundingBox();
    await none.page.locator('#part-analysis-picker').scrollIntoViewIfNeeded();
    const pickerBox = await none.page.locator('#part-analysis-picker').boundingBox();
    assert.ok(box && pickerBox);
    await none.page.mouse.click(pickerBox.x + pickerBox.width * (C1[0] + C1[2] / 2), pickerBox.y + pickerBox.height * (C1[1] + C1[3] / 2));
    await waitCrop(none.page);
    assert.match(await none.page.locator('#part-analysis-region-note').innerText(), /직접 지정한 영역이에요\. AI 위치 찾기 결과가 아니에요/);
    const middle = await pixel(none.page, 'part-analysis-crop', [0.5, 0.5]);
    assert.ok(middle[2] > 180, `the tapped place is in the middle of the crop: ${middle}`);
    await shot(none.page, 'manual-region', false, '#part-analysis-preview');
    const before = vision.calls.length;
    await none.page.locator('#part-analysis-agree').check(); await none.page.locator('#part-analysis-start').click();
    await waitA(none.page, 'RESULT');
    assert.equal(vision.calls.at(-1).regionSource, 'MANUAL');
    assert.equal(vision.calls.length, before + 1);
    await closeAll();
    detector.mode = 'fail';
    const failed = await open();
    await search(failed.page);
    await waitPhase(failed.page, 'FAILED');
    await waitA(failed.page, 'REGION');
    assert.equal(await failed.page.locator('#part-analysis-picker').isVisible(), true, 'a failed search still lets the person mark the place');
    await closeAll();
    detector.mode = 'found';
    pass('no candidate or a failed search offers marking the place by hand; the crop centres on the tap and the request says MANUAL');
  }

  { // Cancel, late answers and leaving the screen.
    const session = await open(), { page } = session;
    await search(page);
    await waitPhase(page, 'CANDIDATES');
    vision.scenario = 'suspected'; vision.mode = 'hold';
    const count = vision.calls.length;
    await analyse(page); await waitA(page, 'ANALYZING');
    assert.equal(await page.locator('#part-analysis-busy').isVisible(), true);
    await shot(page, 'analyzing', false, '#part-analysis-busy');
    while (vision.calls.length === count) await new Promise(r => setTimeout(r, 10));
    await page.waitForTimeout(650);
    await page.locator('#part-analysis-cancel').click();
    assert.equal(await aphase(page), 'PREVIEW');
    assert.equal(await page.locator('#part-analysis-agree').isChecked(), false);
    // The provider hears of it while it is still working (checked before anything is released).
    for (let i = 0; i < 400 && !vision.calls.at(-1).aborted; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(vision.calls.at(-1).aborted, true, 'the server told the provider');
    vision.release();
    await page.waitForTimeout(300);
    assert.equal(await aphase(page), 'PREVIEW', 'nothing arrives after a cancel');
    assert.equal(await page.locator('#part-analysis-result').isVisible(), false);
    // A late answer to a cancelled send: the server answers, the page has moved on and drops it.
    await page.route('**/v1/part-analyses/**', async route => { await new Promise(r => setTimeout(r, 800)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { partId: 'washer-fluid-cap' } }) }).catch(() => {}); });
    await page.locator('#part-analysis-agree').check(); await page.locator('#part-analysis-start').click(); await waitA(page, 'ANALYZING');
    await page.waitForTimeout(650);
    await page.locator('#part-analysis-cancel').click();
    await page.waitForTimeout(1200);
    assert.equal(await aphase(page), 'PREVIEW', 'the late answer is dropped');
    await page.unroute('**/v1/part-analyses/**');
    // Leaving the screen during the wait.
    const sent = vision.calls.length;
    await page.locator('#part-analysis-agree').check(); await page.locator('#part-analysis-start').click(); await waitA(page, 'ANALYZING');
    while (vision.calls.length === sent) await new Promise(r => setTimeout(r, 10));
    await page.locator('#part-detect-close').click();
    await page.waitForFunction(() => !document.getElementById('part-detect').open);
    await waitA(page, 'IDLE');
    for (let i = 0; i < 400 && !vision.calls.at(-1).aborted; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(vision.calls.at(-1).aborted, true, 'leaving the screen also tells the provider');
    vision.release();
    await page.waitForTimeout(300);
    assert.equal(await aphase(page), 'IDLE', 'nothing came back');
    assert.equal(await page.evaluate(() => window.__partDetection.state.phase), 'CLOSED');
    vision.mode = 'answer';
    await noLeak(session);
    await closeAll();
    pass('cancel returns to the preview and asks consent again; a late answer after cancel or after leaving shows nothing; both abort the provider call');
  }

  { // EXIF orientation: the crop is cut from the picture as it is displayed, the same way the search read it.
    const { page } = await open();
    const found = await page.evaluate(async () => {
      const { cropWithContext } = await import('/mobile-ar-poc/public/context-crop.mjs');
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
      const c = canvas.getContext('2d'); c.fillStyle = '#505050'; c.fillRect(0, 0, 400, 300); c.fillStyle = '#ff0000'; c.fillRect(0, 0, 100, 75);
      const jpeg = new Uint8Array(await (await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer());
      // APP1 Exif, little endian, one IFD entry: Orientation (0x0112) = 6, "rotate 90 clockwise to display".
      const exif = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
      const blob = new Blob([jpeg.slice(0, 2), new Uint8Array(exif), jpeg.slice(2)], { type: 'image/jpeg' });
      const plain = await createImageBitmap(blob); // as the part search decodes it
      const seen = { width: plain.width, height: plain.height }; plain.close();
      const red = async box => { const { plan, canvas: out } = await cropWithContext(blob, box, { margin: 0, minSidePx: 1, minShortSideFraction: 0, encode: false }); const d = out.getContext('2d').getImageData(out.width >> 1, out.height >> 1, 1, 1).data; return { source: plan.source, rgb: [d[0], d[1], d[2]] }; };
      return { seen, displayed: await red([0.75, 0, 0.25, 0.25]), stored: await red([0, 0, 0.25, 0.25]) };
    });
    assert.deepEqual(found.seen, { width: 300, height: 400 }, 'the search sees the rotated picture');
    assert.deepEqual(found.displayed.source, { width: 300, height: 400 }, 'the crop uses the same orientation');
    assert.ok(found.displayed.rgb[0] > 200 && found.displayed.rgb[1] < 60, `the red corner is where it is displayed: ${found.displayed.rgb}`);
    assert.ok(found.stored.rgb[0] < 120, `not where it is stored: ${found.stored.rgb}`);
    await closeAll();
    pass('with EXIF orientation 6 the search and the crop both read a 300x400 picture, and a box means the displayed place');
  }

  { // Sizes. A viewport is not the device.
    vision.scenario = 'indeterminate'; vision.mode = 'answer';
    for (const [name, viewport] of [['320', { width: 320, height: 568 }], ['flip-cover-344', { width: 344, height: 882 }], ['landscape-844', { width: 844, height: 390 }]]) {
      const { page } = await open({ viewport });
      await search(page); await waitPhase(page, 'CANDIDATES');
      await analyse(page); await waitA(page, 'RESULT');
      const fit = await page.evaluate(() => { const ok = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 44; }; return { cont: ok('part-analysis-continue'), retake: ok('part-analysis-retake'), wide: document.getElementById('part-detect').scrollWidth <= innerWidth }; });
      assert.deepEqual(fit, { cont: true, retake: true, wide: true }, name);
      await shot(page, `size-${name}`, false, '#part-analysis-result');
      await closeAll();
    }
    pass('the analysis result fits at 320x568, 344x882 and 844x390 with buttons at least 44px tall');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await on.stop(); await detectOnly.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, checks: result.checks.length, errors: result.errors }, null, 2));
}
