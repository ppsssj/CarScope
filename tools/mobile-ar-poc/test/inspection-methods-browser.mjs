// P11 (PR #121): the "점검 방법" card on the real inspection page of all 17 phone tasks, on three local hosts:
// AI off (the Render default), detection + MOCK analysis, detection only. Real QR v2 sessions, mobile Chrome, a fixture detector
// and the MOCK vision provider: no Roboflow or OpenAI call is made. Proves which method each page offers, not any AI accuracy.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';
import { DEFAULT_RATES } from '../../inspection-sync-poc/src/rate-limit.mjs';
import { createMockVisionProvider, fixtureDetectionProvider } from '../../vision-poc/src/mock-vision-provider.mjs';
import { taskLinks } from '../public/inspection-tasks.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p11-methods');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_FIXTURE_DETECTOR_MOCK_VISION', realDetector: 'NOT_RUN', realVision: 'NOT_RUN', realPhone: 'NOT_RUN', render: 'NOT_RUN', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };

const DETECT = ['washer-fluid', 'coolant-reservoir', 'brake-fluid', 'fuse-box'], MARK = ['battery-12v', 'lcw-coolant-reservoir'];
const TASKS = taskLinks().map(t => t.id);
// P13-G: the eleven exterior parts have a DRAFT analysis (marked region), offered only by a host that approved drafts.
const DRAFT = TASKS.filter(t => !DETECT.includes(t) && !MARK.includes(t));
const fixture = fixtureDetectionProvider([]);
const detector = { calls: 0, async detect(input) { detector.calls++; return fixture.detect(input); } };
const wide = { limit: 1000, windowMs: 60_000 };
const rates = { ...DEFAULT_RATES, detect: wide, 'detect-session': { limit: 1000, windowMs: 600_000 }, analyze: wide, 'analyze-session': { limit: 1000, windowMs: 600_000 } };
let now = Date.now(), browser;
const authorizer = new LocalTestSessionCreationAuthorizer();
const hosts = {
  off: await startMobileDevServer({ now: () => now, authorizer, rates }),
  on: await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector }, partAnalysis: { provider: createMockVisionProvider() } }),
  detectOnly: await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector } }),
  draft: await startMobileDevServer({ now: () => now, authorizer, rates, partDetection: { provider: detector }, partAnalysis: { provider: createMockVisionProvider(), allowDraft: true } }),
};
const contexts = [];
async function context() { await Promise.all(contexts.splice(0).map(c => c.close().catch(() => {}))); const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(c); return c; }
async function openQr(host, task) {
  now += 61_000;
  const page = await (await context()).newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [] };
  page.on('pageerror', e => log.problems.push(e.message));
  page.on('request', r => log.requests.push(r.url()));
  const session = await new ReceiverClient({ baseUrl: host.url }).create(task);
  await page.goto(`${host.url}/${session.fragment}`);
  await page.waitForFunction(() => document.querySelector('#sync-claim')?.disabled && document.body.textContent.includes('연결됐어요'));
  await page.waitForSelector('#inspection-methods');
  return { page, log };
}
async function openLocal(host, task) {
  const page = await (await context()).newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [] }; page.on('pageerror', e => log.problems.push(e.message));
  await page.goto(`${host.url}/#task=${task}`); await page.waitForSelector('#inspection-methods');
  return { page, log };
}
const card = page => page.evaluate(() => { const c = document.getElementById('inspection-methods'); return { ai: c.dataset.aiState, plan: c.dataset.plan, text: c.innerText,
  entryInCard: Boolean(c.querySelector('#part-detect-open')), entry: document.getElementById('part-detect-open')?.innerText ?? null,
  manualStart: Boolean(document.getElementById('manual-start')), heading: document.querySelector('#step-intro h1')?.innerText ?? '' }; });
const settle = page => page.waitForTimeout(300); // the AI module loads asynchronously; nothing may appear later on a page without it
const noInternals = (text, label) => assert.doesNotMatch(text, /[A-Z]{2,}_[A-Z_]+|ROBOFLOW|OPENAI|GPT|data-part|EXPERIMENTAL|UNSUPPORTED|env/i, label);
const shot = async (page, name) => { await page.locator('#inspection-methods').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `${name}.png`) }); };

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true });
  result.browser = browser.version();
  assert.equal(TASKS.length, 17); assert.equal(DRAFT.length, 11);

  for (const task of TASKS) { // AI on: the six bonnet parts offer it; the eleven others say plainly that they do not
    console.log('on', task); const { page, log } = await openQr(hosts.on, task);
    if (!DRAFT.includes(task)) await page.waitForSelector('#part-detect-open'); else await settle(page);
    const c = await card(page);
    assert.equal(c.manualStart, true, `${task}: the manual check is always there`); assert.match(c.text, /직접 점검하기/);
    noInternals(c.text, task);
    if (DETECT.includes(task)) { assert.deepEqual([c.ai, c.plan, c.entry, c.entryInCard], ['AVAILABLE', 'DETECT_AND_ANALYZE', 'AI로 외관 살펴보기 · 실험', true], task); assert.match(c.text, /결과는 직접 확인해 주세요/); }
    else if (MARK.includes(task)) { assert.deepEqual([c.ai, c.plan, c.entry, c.entryInCard], ['AVAILABLE', 'MARK_AND_ANALYZE', '사진에서 부품 직접 지정하기', true], task); assert.match(c.text, /자동으로 위치를 찾지 않아요/); assert.doesNotMatch(c.text, /후보를 찾고/); }
    else { assert.deepEqual([c.ai, c.entry], ['SERVER_DISABLED', null], task); assert.match(c.text, /시험 단계라 승인된 실험 서비스에서만/); assert.match(c.text, /살펴볼 것: /, `${task}: the manual check names what it looks at`);
      assert.ok(!log.requests.some(u => /part-(detection|analysis)-ui\.mjs/.test(u)), `${task}: no AI module is loaded for a draft the host did not approve`); }
    assert.deepEqual(log.problems, [], task);
    if (['wiper.front.left', 'battery-12v', 'washer-fluid', 'light-high-beam-right-0'].includes(task)) await shot(page, `on-${task}`);
  }
  pass('AI on, drafts not approved: 4 parts detect + analyse, 2 mark + analyse, 11 exterior drafts say they need an approved experiment service, with no AI button');

  for (const task of DRAFT) { // P13-G: drafts approved: each exterior part offers the marking flow, labelled as a draft
    const { page, log } = await openQr(hosts.draft, task); await page.waitForSelector('#part-detect-open');
    const c = await card(page);
    assert.deepEqual([c.ai, c.plan, c.entry, c.entryInCard], ['AVAILABLE', 'MARK_AND_ANALYZE', '사진에서 부품 직접 지정하기', true], task);
    assert.match(c.text, /시험 단계예요\. 자동으로 위치를 찾지 않아요/); assert.match(c.text, /직접 점검하기/); assert.equal(c.manualStart, true, task);
    noInternals(c.text, task); assert.deepEqual(log.problems, [], task);
    if (['tire.front-left', 'ev-charge.port'].includes(task)) await shot(page, `draft-${task}`);
  }
  for (const task of [...DETECT, ...MARK]) { const { page } = await openQr(hosts.draft, task); await page.waitForSelector('#part-detect-open'); assert.equal((await card(page)).ai, 'AVAILABLE', `${task}: unchanged by draft approval`); }
  pass('drafts approved: the 11 exterior parts offer "사진에서 부품 직접 지정하기" as a draft; the 6 bonnet parts are unchanged');

  for (const task of TASKS) { // AI off (the Render default): never a button; supported parts say the service does not offer it
    console.log('off', task); const { page, log } = await openQr(hosts.off, task); await settle(page);
    const c = await card(page);
    assert.equal(c.entry, null, `${task}: no AI button on a host without AI`); assert.equal(c.manualStart, true, task);
    assert.equal(c.ai, 'SERVER_DISABLED', task);
    assert.match(c.text, /지금 연결된 서비스에서는 사용할 수 없어요/, task);
    if (DRAFT.includes(task)) assert.match(c.text, /시험 단계/, task);
    assert.ok(!log.requests.some(u => /part-(detection|analysis)(-ui)?\.mjs|context-crop/.test(u)), `${task}: the AI files are neither served nor asked for`);
    noInternals(c.text, task); assert.deepEqual(log.problems, [], task);
    if (['washer-fluid', 'tire.front-left'].includes(task)) await shot(page, `off-${task}`);
  }
  pass('AI off: no AI button on any of the 17; all read "not offered by this service", the 11 drafts naming their stage; no AI file requested');

  { // Detection only: a detecting part offers the location search, never an analysis it cannot run; a marking part offers nothing
    let { page } = await openQr(hosts.detectOnly, 'washer-fluid'); await page.waitForSelector('#part-detect-open');
    assert.deepEqual([(await card(page)).plan, (await card(page)).entry], ['DETECT_ONLY', 'AI로 부품 위치 찾기 · 실험']);
    ({ page } = await openQr(hosts.detectOnly, 'battery-12v')); await settle(page);
    assert.deepEqual([(await card(page)).ai, (await card(page)).entry], ['SERVER_DISABLED', null]);
  }
  pass('detection only: washer offers the location search alone; 12V battery (no detector class) offers no AI');

  for (const task of ['battery-12v', 'wiper.front.left']) { // no QR: a local link never offers AI, and says why only where the part has it
    const { page, log } = await openLocal(hosts.on, task); await settle(page);
    const c = await card(page);
    assert.equal(c.entry, null, task); assert.equal(c.ai, 'NOT_CONNECTED', task);
    assert.match(c.text, /QR로 연결한 점검에서만/);
    assert.deepEqual(log.problems, [], task);
  }
  pass('no QR: a bonnet part and an exterior part both say AI needs the vehicle QR');

  { // Lights keep side and beam apart, and the manual check of a part without AI completes and reaches review as before
    const { page } = await openQr(hosts.on, 'light-low-beam-left-0'); await settle(page);
    const c = await card(page);
    assert.equal(c.heading, '왼쪽 하향등 점검'); assert.match(c.text, /왼쪽 하향등 영역만 기록해요/); assert.match(c.text, /상향등·하향등/);
    const w = await openQr(hosts.on, 'wiper.front.right'); await settle(w.page);
    await w.page.locator('#safety').check(); await w.page.locator('#manual-start').click();
    for (let i = 0; i < 3; i++) { await w.page.waitForFunction(n => document.body.dataset.question === String(n), i); await w.page.locator('label[data-tone] input').nth(1).check(); await w.page.locator('#primary').click(); }
    await w.page.waitForFunction(() => document.body.dataset.step === 'review');
    pass('lights: the card names side and beam; wiper: the manual checklist runs to review while AI is not offered');
  }
  assert.equal(detector.calls, 0, 'no detection was requested by opening pages');
  result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.errors.push(String(error?.stack ?? error)); console.error(error); process.exitCode = 1; }
finally {
  await Promise.all(contexts.map(c => c.close().catch(() => {}))); await browser?.close();
  for (const h of Object.values(hosts)) await h.stop?.().catch(() => {});
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, errors: result.errors.map(e => e.split('\n')[0]) }, null, 2));
}
