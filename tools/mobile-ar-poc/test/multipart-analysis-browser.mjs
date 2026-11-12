// P13-D: AI analysis on the real inspection pages of all six bonnet parts. Mobile Chrome, real QR v2 sync on local sessions, a generated
// picture, a fixture detector (no Roboflow call) and the per-part MOCK vision provider (no OpenAI call). Proves the flows, not any accuracy.
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
const output = path.join(base, 'p13-d');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_FIXTURE_DETECTOR_MOCK_VISION', realDetector: 'NOT_RUN', realVision: 'REAL_PROVIDER_NOT_RUN', realPhone: 'NOT_RUN', render: 'NOT_RUN', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };

// Each part, its task, its detector class (if any) and where it sits in the generated picture.
const PARTS = [
  { partId: 'washer-fluid-cap', task: 'washer-fluid', className: 'Windshield Wiper Fluid', box: [0.08, 0.1, 0.1, 0.1], rgb: [20, 60, 230] },
  { partId: 'coolant-reservoir', task: 'coolant-reservoir', className: 'Engine Coolant Reservoir', box: [0.3, 0.1, 0.12, 0.14], rgb: [230, 120, 160] },
  { partId: 'brake-fluid-reservoir', task: 'brake-fluid', className: 'Brake Fluid', box: [0.55, 0.1, 0.1, 0.12], rgb: [220, 200, 120] },
  { partId: 'fuse-box', task: 'fuse-box', className: 'Fuse Box', box: [0.75, 0.1, 0.15, 0.14], rgb: [30, 30, 30] },
  { partId: 'battery-12v', task: 'battery-12v', className: null, box: [0.1, 0.55, 0.2, 0.2], rgb: [40, 160, 70] },
  { partId: 'lcw-coolant-reservoir', task: 'lcw-coolant-reservoir', className: null, box: [0.6, 0.55, 0.12, 0.16], rgb: [120, 200, 230] },
];
const WIDTH = 1600, HEIGHT = 1200;
const png = new PNG({ width: WIDTH, height: HEIGHT });
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
  const i = (y * WIDTH + x) * 4, u = x / WIDTH, v = y / HEIGHT;
  const hit = PARTS.find(({ box: [l, t, w, h] }) => u >= l && u < l + w && v >= t && v < t + h);
  const [r, g, b] = hit?.rgb ?? [70, 74, 80];
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
const PICTURE = { name: 'synthetic.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };

// The fixture detector knows the four classes the real model has. It has nothing for the two manual-only parts, as the real one.
const fixture = fixtureDetectionProvider(PARTS.filter(p => p.className).map(p => ({ className: p.className, score: 0.8, box: p.box })));
const detector = { calls: 0, async detect(input) { detector.calls++; return fixture.detect(input); } };
const vision = createMockVisionProvider();
const wide = { limit: 1000, windowMs: 60_000 };
const rates = { ...DEFAULT_RATES, detect: wide, 'detect-session': { limit: 1000, windowMs: 600_000 }, analyze: wide, 'analyze-session': { limit: 1000, windowMs: 600_000 } };
let now = Date.now(), browser;
const authorizer = new LocalTestSessionCreationAuthorizer();
const on = await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector }, partAnalysis: { provider: vision } });
const detectOnly = await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector } });
const contexts = [];
const closeAll = () => Promise.all(contexts.splice(0).map(c => c.close().catch(() => {})));

async function open({ host = on, task, viewport = { width: 390, height: 844 } }) {
  now += 61_000;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [] };
  page.on('pageerror', e => log.problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.problems.push(m.text()); });
  page.on('request', r => log.requests.push({ url: r.url(), method: r.method(), headers: r.headers() }));
  const receiver = new ReceiverClient({ baseUrl: host.url });
  const session = await receiver.create(task);
  await page.goto(`${host.url}/${session.fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  return { page, log, receiver };
}
const posts = (log, part) => log.requests.filter(r => r.method === 'POST' && r.url.includes(part));
const waitA = (page, phase) => page.waitForFunction(p => window.__partAnalysis?.state.phase === p, phase);
const waitD = (page, phase) => page.waitForFunction(p => window.__partDetection?.state.phase === p, phase);
const inspectionState = page => page.evaluate(() => JSON.stringify((window.__checklistInspection ?? window.__selfInspection).state));
const shot = async (page, name, at) => { if (at) await page.locator(at).evaluate(n => n.scrollIntoView({ block: 'start' })); await page.screenshot({ path: path.join(output, `${name}.png`) }); };
async function finish(page, label) {
  await page.locator('#part-analysis-agree').check();
  await page.locator('#part-analysis-start').click();
  await waitA(page, 'RESULT');
  assert.match(await page.locator('#part-analysis-result').innerText(), /자동 입력되거나 차량으로 보내지지 않아요/, label);
  assert.match(await page.locator('#part-analysis-evidence').innerText(), /실험 기능이에요/, label);
}

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();

  { // The four detected parts: detector candidate -> crop -> consent -> analysis.
    for (const part of PARTS.filter(p => p.className)) {
      vision.scenario = 'no-visible-issue'; vision.mode = 'answer';
      const { page, log } = await open({ task: part.task });
      const before = await inspectionState(page);
      await page.waitForFunction(() => window.__partDetection);
      assert.equal(await page.evaluate(() => window.__partDetection.manualOnly), false, part.partId);
      assert.equal(await page.locator('#part-detect-open').innerText(), 'AI로 외관 살펴보기 · 실험');
      assert.deepEqual(await page.evaluate(() => [document.getElementById('inspection-methods').dataset.aiState, document.getElementById('inspection-methods').dataset.plan]), ['AVAILABLE', 'DETECT_AND_ANALYZE'], part.partId);
      assert.ok(await page.evaluate(() => document.getElementById('inspection-methods').contains(document.getElementById('part-detect-open'))), 'the AI entry sits in the methods card');
      await page.locator('#part-detect-open').click(); await waitD(page, 'CONSENT');
      await page.locator('#part-detect-agree').check();
      await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
      await waitD(page, 'CANDIDATES');
      assert.equal(await page.evaluate(() => window.__partDetection.state.candidates.length), 1, `${part.partId}: only its own class`);
      await waitA(page, 'REGION');
      assert.doesNotMatch(await page.locator('#part-analysis-title').innerText(), /제한적/);
      await page.locator('#part-analysis-candidate-1').click();
      await page.waitForFunction(() => window.__partAnalysis.state.cropReady);
      const middle = await page.evaluate(([u, v]) => { const c = document.getElementById('part-analysis-crop'); const d = c.getContext('2d').getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data; return [d[0], d[1], d[2]]; }, (await page.evaluate(() => { const t = window.__partAnalysis.plan.targetInCrop; return [t[0] + t[2] / 2, t[1] + t[3] / 2]; })));
      assert.ok(middle.every((c, i) => Math.abs(c - part.rgb[i]) < 40), `${part.partId}: the crop centres on its own part ${middle} vs ${part.rgb}`);
      await finish(page, part.partId);
      const [request] = posts(log, '/v1/part-analyses/');
      assert.ok(request.url.endsWith(`/v1/part-analyses/${part.partId}`));
      assert.equal(request.headers['x-carscope-region-source'], 'AI_CANDIDATE');
      assert.equal(vision.calls.at(-1).partId, part.partId);
      if (part.partId === 'coolant-reservoir') await shot(page, 'coolant-result', '#part-analysis-result');
      await page.locator('#part-analysis-ack').check(); await page.locator('#part-analysis-continue').click();
      await waitA(page, 'IDLE');
      assert.equal(await inspectionState(page), before, `${part.partId}: the inspection is as it was`);
      assert.equal(posts(log, '/v1/submissions').length, 0, 'nothing was sent to the vehicle');
      assert.deepEqual(log.problems, []);
      await closeAll();
    }
    pass('washer, coolant, brake fluid and fuse box: the detector proposes only the part\'s own class, the crop centres on it, the analysis names the part, and the inspection is unchanged');
  }

  { // The two manual-only parts: no detector consent, no detection request, the person marks the region.
    for (const part of PARTS.filter(p => !p.className)) {
      vision.scenario = 'indeterminate';
      const detectBefore = detector.calls;
      const { page, log } = await open({ task: part.task });
      const before = await inspectionState(page);
      await page.waitForFunction(() => window.__partDetection);
      assert.equal(await page.evaluate(() => window.__partDetection.manualOnly), true, part.partId);
      assert.equal(await page.locator('#part-detect-open').innerText(), '사진에서 부품 직접 지정하기');
      assert.deepEqual(await page.evaluate(() => [document.getElementById('inspection-methods').dataset.aiState, document.getElementById('inspection-methods').dataset.plan]), ['AVAILABLE', 'MARK_AND_ANALYZE'], part.partId);
      assert.match(await page.locator('#inspection-methods-ai-note').innerText(), /자동으로 위치를 찾지 않아요/);
      await page.locator('#part-detect-open').click(); await waitD(page, 'CONSENT');
      assert.equal(await page.locator('#part-detect-consent #part-detect-agree').count(), 0, 'no detector consent is asked: the checkbox is not even shown');
      assert.match(await page.locator('#part-detect-consent').innerText(), /어디에도 보내지 않아요/);
      assert.doesNotMatch(await page.locator('#part-detect-consent').innerText(), /Roboflow/);
      assert.equal(await page.locator('#part-detect-gallery').isEnabled(), true);
      await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
      await waitD(page, 'LOCAL_ONLY');
      await waitA(page, 'REGION');
      assert.equal(posts(log, '/v1/part-detections/').length, 0, `${part.partId}: no detection request`);
      assert.equal(detector.calls, detectBefore);
      assert.match(await page.locator('#part-analysis-title').innerText(), /직접 지정, 제한적 분석/);
      assert.equal(await page.locator('#part-analysis-choices').isVisible(), false);
      if (part.partId === 'battery-12v') await shot(page, 'battery-manual-picker', '#part-analysis');
      const picker = page.locator('#part-analysis-picker');
      await picker.scrollIntoViewIfNeeded();
      const box = await picker.boundingBox();
      await page.mouse.click(box.x + box.width * (part.box[0] + part.box[2] / 2), box.y + box.height * (part.box[1] + part.box[3] / 2));
      await page.waitForFunction(() => window.__partAnalysis.state.cropReady);
      assert.match(await page.locator('#part-analysis-region-note').innerText(), /직접 지정한 영역이에요/);
      assert.match(await page.locator('#part-analysis-consent-text').innerText(), /로컬 시험용 MOCK/);
      await finish(page, part.partId);
      assert.equal(await page.locator('#part-analysis-headline').innerText(), '이 사진으로는 판단할 수 없어요');
      assert.match(await page.locator('#part-analysis-retake-tips').innerText(), /부품의 표기가 보이도록/);
      const [request] = posts(log, '/v1/part-analyses/');
      assert.ok(request.url.endsWith(`/v1/part-analyses/${part.partId}`));
      assert.equal(request.headers['x-carscope-region-source'], 'MANUAL');
      if (part.partId === 'battery-12v') await shot(page, 'battery-result', '#part-analysis-result');
      await page.locator('#part-analysis-ack').check(); await page.locator('#part-analysis-continue').click();
      await waitA(page, 'IDLE');
      assert.equal(await inspectionState(page), before);
      assert.equal(posts(log, '/v1/submissions').length, 0);
      assert.deepEqual(log.problems, []);
      await closeAll();
    }
    pass('12V battery and low-conductivity coolant: no detector consent or request; the person marks the region; the request says MANUAL; labelled limited; the inspection is unchanged');
  }

  { // Failures leave the inspection usable; analysis off keeps the manual parts without any AI entry.
    vision.mode = 'error';
    const { page, log } = await open({ task: 'lcw-coolant-reservoir' });
    await page.waitForFunction(() => window.__partDetection);
    await page.locator('#part-detect-open').click(); await waitD(page, 'CONSENT');
    await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
    await waitA(page, 'REGION');
    const box = await page.locator('#part-analysis-picker').boundingBox();
    await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.63);
    await page.waitForFunction(() => window.__partAnalysis.state.cropReady);
    await page.locator('#part-analysis-agree').check(); await page.locator('#part-analysis-start').click();
    await waitA(page, 'FAILED');
    assert.match(await page.locator('#part-analysis-error').innerText(), /연결하지 못했어요[\s\S]*기존 점검은 그대로/);
    assert.doesNotMatch(await page.content(), /sk-should-never-leave|mock upstream/);
    await page.locator('#part-detect-close').click();
    await page.waitForFunction(() => !document.getElementById('part-detect').open);
    assert.equal(await page.evaluate(() => window.__checklistInspection.state.step), 'intro', 'the inspection carries on');
    assert.equal(posts(log, '/v1/part-detections/').length, 0);
    await closeAll();
    vision.mode = 'answer';
    for (const task of ['battery-12v', 'lcw-coolant-reservoir']) {
      const off = await open({ host: detectOnly, task });
      await off.page.waitForTimeout(300);
      assert.equal(await off.page.locator('#part-detect-open').count(), 0, `${task}: no AI entry without the analysis`);
      assert.ok(!off.log.requests.some(r => /part-analys/.test(r.url)), 'no analysis file or request');
      await closeAll();
    }
    const tire = await open({ task: 'tire.front-left' });
    await tire.page.waitForTimeout(300);
    assert.equal(await tire.page.locator('#part-detect-open').count(), 0, 'parts outside the bonnet get no AI entry');
    await closeAll();
    pass('a provider failure ends in words and the checklist carries on; with the analysis off the manual parts and the tyres have no AI entry');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.errors.push(error.stack ?? error.message); process.exitCode = 1;
} finally {
  await browser?.close(); await on.stop(); await detectOnly.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, errors: result.errors }, null, 2));
}
