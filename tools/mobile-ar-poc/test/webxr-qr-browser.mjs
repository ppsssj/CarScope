// P9-XR-C: the WebXR guide on the real QR v2 path. Real inspection DOM, real sync HTTP, real session service (memory
// store) and real mobile-dev-entry.mjs, with the fake XR runtime. One-machine synthetic check: not phone, not Native, not Render.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p9-xr-c', 'qr-v2');
await mkdir(output, { recursive: true });

const result = { kind: 'SYNTHETIC_XR_RUNTIME_REAL_SYNC_HTTP', realDevice: 'NOT_RUN_DEFERRED_TO_E2E', realNativeQr: 'NOT_RUN_DEFERRED_TO_E2E', render: 'NOT_RUN', checks: [], errors: [] };
const pass = message => { result.checks.push(`PASS ${message}`); console.log(`PASS ${message}`); };
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

let now = Date.now();
const authorizer = new LocalTestSessionCreationAuthorizer();
const on = await startMobileDevServer({ now: () => now, authorizer, webxrGuide: true });
const off = await startMobileDevServer({ now: () => now, authorizer });

let browser;
async function pair(host, { taskId = 'washer-fluid', fake = {} } = {}) {
  now += 61_000; // Each independent scenario uses a fresh rate window; limits themselves are not raised.
  const receiver = new ReceiverClient({ baseUrl: host.url });
  const session = await receiver.create(taskId);
  const invite = session.fragment.split('invite=')[1];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [invite] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/net::ERR_NO_BUFFER_SPACE/.test(message.text())) log.problems.push(message.text()); }); // The page retries that code itself: page-start-guard.js.
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
  page.on('response', async response => {
    if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); }
  });
  // What was still loading, or failed, when a page never started. The invite stays out: paths only.
  const pending = new Set(), bad = [], failed = [];
  const where = value => new URL(value).pathname;
  page.on('request', request => pending.add(where(request.url())));
  page.on('requestfinished', request => pending.delete(where(request.url())));
  page.on('requestfailed', request => { pending.delete(where(request.url())); failed.push(`${where(request.url())} ${request.failure()?.errorText}`); });
  page.on('response', response => { if (response.status() >= 400) bad.push(`${where(response.url())} ${response.status()}`); });
  const started = Date.now();
  await page.goto(host.url + '/' + session.fragment);
  try {
    await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  } catch (error) {
    const seen = await page.evaluate(() => ({ ready: document.readyState, step: document.body?.dataset.step, checklist: document.body?.dataset.checklist, flow: document.body?.dataset.flow, resources: performance.getEntriesByType('resource').length })).catch(failure => failure.name);
    throw new Error(`${error.message}\nstart diagnostics after ${Date.now() - started}ms: ${JSON.stringify({ taskId, seen, pending: [...pending], failed, bad, requested: log.requests.length, problems: log.problems })}`);
  }
  return { receiver, session, invite, context, page, log };
}
const count = (log, suffix, method = 'POST') => log.requests.filter(r => r.method === method && r.url.endsWith(suffix)).length;
const claim = async ({ page }) => {
  
  await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
};
const waitPhase = (page, name) => page.waitForFunction(value => window.__webXrGuide?.state?.phase === value, name);
const settle = (page, n = 3) => page.evaluate(async steps => {
  for (let i = 0; i < steps; i++) { window.__env.step(); await new Promise(resolve => setTimeout(resolve)); }
}, n);
const runAr = async page => {
  await page.waitForFunction(() => window.__webXrGuide?.capability);
  await page.locator('#xr-entry-open').click();
  await waitPhase(page, 'READY');
  await page.locator('#xr-start').click();
  await waitPhase(page, 'AIMING');
  await settle(page);
  await page.evaluate(() => window.__env.select());
  await settle(page);
  await waitPhase(page, 'PLACED');
};
const leaveToChecklist = async page => {
  await page.locator('#xr-return').click();
  await page.waitForFunction(() => !window.__webXrGuide.open);
};
const complete = async page => {
  await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(box => box.click()));
  await page.click('#primary'); await page.click('[data-status="NEEDS_REFILL"]'); await page.click('#primary'); await page.click('#primary');
  await page.waitForSelector('body[data-step="done"]');
};
const waitSync = (page, state) => page.waitForFunction(s => document.getElementById('done-sync').dataset.syncState === s, state);
async function noLeak({ page, log }) {
  const html = await page.content();
  const historyState = await page.evaluate(() => JSON.stringify(history.state));
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  assert.equal(stored, '[{},{},""]');
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(new URL(page.url()).search, '');
  for (const secret of log.secrets) {
    assert.ok(!html.includes(secret), 'token in DOM');
    assert.ok(!historyState.includes(secret), 'token in history state');
    assert.ok(!page.url().includes(secret), 'token in address');
    assert.ok(log.requests.every(r => !r.url.includes(secret) && !r.body.includes(secret)), 'token in a request URL or body');
  }
}
const finish = async ({ context, log }, label) => {
  assert.deepEqual(log.problems, [], `${label}: page errors and CSP violations`);
  await context.close();
};

try {
  browser = await chromium.launch({
    channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  result.browser = browser.version();

  { // Connected QR v2 -> AR -> checklist -> result -> send -> vehicle accepts. The same credentials must carry it through.
    const flow = await pair(on), { page, log, receiver } = flow;
    assert.equal(new URL(page.url()).hash, '', 'entry strips the fragment before any guide code runs');
    await claim(flow);
    assert.equal(count(log, '/v1/claim'), 1);
    const viewBefore = await receiver.view();
    await page.evaluate(() => { window.__sameDocument = true; });
    await runAr(page);
    await page.screenshot({ path: path.join(output, 'qr-v2-placed.png') });
    await noLeak(flow);
    await leaveToChecklist(page);
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'no navigation: credentials stay in this page');
    assert.equal((await page.evaluate(() => window.__selfInspection.state.step)), 'check');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    assert.equal(await page.locator('#sync-send').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'qr-v2-checklist.png') });

    // Entering and leaving AR changed and sent nothing, and did not create or claim anything.
    assert.equal(count(log, '/v1/sessions'), 0);
    assert.equal(count(log, '/v1/claim'), 1);
    assert.equal(count(log, '/v1/submissions'), 0);
    const viewAfter = await receiver.view();
    assert.equal(viewAfter.sessionState, viewBefore.sessionState);
    assert.equal(viewAfter.resultDigest ?? null, null);
    assert.equal(await page.evaluate(() => window.__selfInspection.state.record.state), 'IN_PROGRESS');
    assert.deepEqual(await page.evaluate(() => window.__selfInspection.state.record.aids), { cameraUsed: false, locationMarked: false });
    assert.ok(log.requests.every(r => r.url.startsWith(on.url)), 'same origin only');
    const apiCalls = new Set(log.requests.filter(r => r.url.includes('/v1/')).map(r => `${r.method} ${new URL(r.url).pathname}`));
    assert.deepEqual([...apiCalls].filter(call => call !== 'POST /v1/claim' && call !== 'GET /v1/submissions/status'), []);

    await complete(page);
    assert.equal(count(log, '/v1/submissions'), 0, 'finishing does not send either: the user sends');
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    assert.equal(count(log, '/v1/submissions'), 1);
    const submitted = await receiver.view();
    assert.equal(submitted.sessionState, 'RESULT_SUBMITTED');
    assert.equal(submitted.result.status, 'NEEDS_REFILL');
    assert.equal(submitted.result.taskId, 'washer-fluid');
    assert.deepEqual(Object.keys(submitted.result.aids).sort(), ['cameraUsed', 'locationMarked'], 'result contract unchanged');
    await receiver.accept(submitted.resultDigest);
    await page.locator('#sync-refresh').click();
    await waitSync(page, 'ACCEPTED');
    await noLeak(flow);
    await finish(flow, 'connected');
    pass('claimed QR v2 survives AR: no new session or claim, nothing sent by AR, and the same credentials submit and receive acceptance');
  }

  { // AR before starting the inspection: the page has connected once, and AR and Back do not connect again.
    const flow = await pair(on), { page, log } = flow;
    await claim(flow);
    assert.equal(count(log, '/v1/claim'), 1);
    await runAr(page);
    assert.equal(count(log, '/v1/claim'), 1, 'AR does not claim');
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    assert.equal(new URL(page.url()).hash, '', 'Back does not bring the invite fragment back');
    await noLeak(flow);
    assert.equal(count(log, '/v1/claim'), 1);
    assert.equal(await page.evaluate(() => window.__selfInspection.state.step), 'intro', 'Back returned to where the user was');
    await page.locator('#manual-start').click();
    await complete(page);
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    await noLeak(flow);
    await finish(flow, 'before start');
    pass('a connection made on opening survives AR and Back, claims once and submits');
  }

  { // App switch, re-entry and Back during a connected attempt with answers already made.
    const flow = await pair(on), { page, log, receiver } = flow;
    await claim(flow);
    await page.evaluate(() => { window.__sameDocument = true; window.__hidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden }); });
    await page.waitForFunction(() => window.__webXrGuide?.capability);
    assert.equal(await page.locator('#xr-methods-title').isVisible(), true);
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const held = () => page.evaluate(() => { const { step, mode, checks, record } = window.__selfInspection.state; return { step, mode, checks, inspectionId: record.inspectionId, recordState: record.state, aids: record.aids }; });
    const before = await held();
    const setHidden = value => page.evaluate(hidden => { window.__hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); }, value);
    const polls = () => count(log, '/v1/submissions/status', 'GET');

    // Leaving for another app in AR: the session ends and releases everything, and polling sleeps.
    await runAr(page);
    await setHidden(true);
    await page.evaluate(() => window.__env.setVisibility('hidden'));
    await waitPhase(page, 'ENDED');
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    assert.equal(await page.evaluate(() => window.__env.anchors.every(a => a.deleted) && window.__env.hitSources.every(h => h.cancelled)), true);
    await page.waitForTimeout(300);
    const asleep = polls();
    await page.waitForTimeout(2600);
    assert.equal(polls(), asleep, 'no polling while nobody is looking');

    // Coming back: polling wakes, the guide says what happened, and nothing connected again.
    await setHidden(false);
    await page.waitForFunction(() => document.getElementById('xr-ended') && !document.getElementById('xr-ended').hidden);
    for (let i = 0; polls() === asleep && i < 60; i++) await page.waitForTimeout(100);
    assert.ok(polls() > asleep, 'polling resumed with the same credentials');
    assert.deepEqual(await held(), before, 'answers and attempt survive an app switch');

    // Re-entry from the ended panel, then Back from AR.
    await page.locator('#xr-start').click();
    await waitPhase(page, 'AIMING');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__webXrGuide.state.markerMode), null, 'the old marker does not come back');
    await page.evaluate(() => window.__env.select());
    await settle(page);
    await waitPhase(page, 'PLACED');
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__env.sessions.every(s => s.ended)), true);
    assert.deepEqual(await held(), before, 'answers and attempt survive Back');

    // AR again, ended by its own button, back to the checklist.
    await runAr(page);
    await page.locator('#xr-exit').click();
    await waitPhase(page, 'ENDED');
    await page.locator('#xr-to-checklist').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.deepEqual(await held(), before, 'answers and attempt survive the end of AR');
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'never left the document');
    assert.equal(await page.evaluate(() => window.__env.sessions.length), 3);
    assert.equal(await page.evaluate(() => window.__env.sessions.every(s => s.ended) && window.__env.anchors.every(a => a.deleted) && window.__env.hitSources.every(h => h.cancelled)), true, 'three sessions, nothing left');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    assert.equal(count(log, '/v1/claim'), 1, 'one claim across all of it');
    assert.equal(count(log, '/v1/submissions'), 0, 'AR sent nothing');
    await noLeak(flow);

    // The answer already ticked stays ticked, and the same credentials finish the job.
    await page.locator('#checklist input:not(:checked)').evaluateAll(boxes => boxes.forEach(box => box.click()));
    await page.click('#primary'); await page.click('[data-status="OK"]'); await page.click('#primary'); await page.click('#primary');
    await page.waitForSelector('body[data-step="done"]');
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    const submitted = await receiver.view();
    assert.equal(submitted.result.inspectionId, before.inspectionId, 'the result is the attempt that started before AR');
    await receiver.accept(submitted.resultDigest);
    await page.locator('#sync-refresh').click();
    await waitSync(page, 'ACCEPTED');
    await noLeak(flow);
    await finish(flow, 'app switch');
    pass('app switch, re-entry, Back and AR end keep the claim, the answers and the attempt, release each session, and the same credentials send');
  }

  { // Denied permission and an unsupported phone on the QR path: 2D and manual, still connected, still sending.
    const denied = await pair(on, { fake: { requestError: 'NotAllowedError' } });
    await claim(denied);
    await denied.page.waitForFunction(() => window.__webXrGuide?.capability);
    await denied.page.locator('#xr-entry-open').click();
    await waitPhase(denied.page, 'READY');
    await denied.page.locator('#xr-start').click();
    await waitPhase(denied.page, 'FAILED');
    assert.match(await denied.page.locator('#xr-fallback-reason').textContent(), /권한이 허용되지 않았어요/);
    assert.equal(await denied.page.locator('#xr-to-camera').isVisible(), true);
    await denied.page.locator('#xr-to-checklist').click();
    await denied.page.waitForFunction(() => !window.__webXrGuide.open);
    assert.match(await denied.page.locator('body > main').textContent(), /연결됐어요/);
    await complete(denied.page);
    await denied.page.locator('#sync-send').click();
    await waitSync(denied.page, 'SENT');
    assert.equal(count(denied.log, '/v1/claim'), 1);
    await finish(denied, 'denied');

    const flat = await pair(on, { fake: { supported: false } });
    await claim(flat);
    await flat.page.waitForFunction(() => window.__webXrGuide?.capability);
    assert.equal(await flat.page.locator('#xr-entry-open').isVisible(), false);
    assert.equal(await flat.page.locator('#xr-methods-title').isVisible(), false);
    assert.equal(await flat.page.locator('#primary').isVisible(), true);
    assert.match(await flat.page.locator('#xr-entry-unavailable').textContent(), /지원하지 않아요/);
    assert.equal(flat.log.requests.some(r => r.url.includes('three')), false, 'no three.js on a phone that cannot use it');
    await flat.page.locator('#manual-start').click();
    await complete(flat.page);
    await flat.page.locator('#sync-send').click();
    await waitSync(flat.page, 'SENT');
    await finish(flat, 'unsupported');
    pass('permission denial and an unsupported phone fall back to the 2D and manual paths with the connection intact, and the result still sends');
  }

  { // The vehicle's decision still reaches the phone across AR.
    const flow = await pair(on), { page, receiver } = flow;
    await claim(flow);
    await runAr(page);
    await receiver.cancel();
    await page.evaluate(() => document.querySelector('#xr-return').click());
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForFunction(() => document.body.textContent.includes('차량에서 점검을 취소'));
    await finish(flow, 'cancelled');
    pass('a vehicle cancel during AR is shown after returning; AR cannot hide it');
  }

  { // The experiment covers washer only, on the QR path as well.
    for (const taskId of ['brake-fluid', 'tire.front-left', 'ev-charge.port']) {
      const flow = await pair(on, { taskId }), { page, log } = flow;
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#xr-entry-open').count(), 0, taskId);
      assert.equal(log.requests.some(r => /webxr|three/.test(r.url)), false, taskId);
      await claim(flow);
      assert.equal(await page.locator('#manual-start').isVisible(), true, taskId);
      await finish(flow, taskId);
    }
    const bad = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await bad.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr({}));`);
    const page = await bad.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(on.url + '/#v=2&task=washer-fluid&invite=bad');
    await page.waitForFunction(() => window.__selfInspection);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#xr-entry').count(), 0);
    assert.equal(requests.some(url => /webxr|three/.test(url)), false);
    await bad.close();
    pass('with the experiment on, QR v2 for other parts and an invalid QR get no WebXR');
  }

  { // Experiment off on the QR host: exactly today's flow on a capable device.
    const flow = await pair(off), { page, log, receiver } = flow;
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#xr-entry').count(), 0);
    assert.equal(await page.evaluate(() => document.body.dataset.webxrGuide), undefined);
    assert.equal(log.requests.some(r => /webxr|three/.test(r.url)), false);
    await claim(flow);
    await page.locator('#manual-start').click();
    await complete(page);
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    assert.equal((await receiver.view()).sessionState, 'RESULT_SUBMITTED');
    await finish(flow, 'off');
    pass('with the experiment off, the QR v2 host offers no WebXR and the flow still completes');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await on.stop();
  await off.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
