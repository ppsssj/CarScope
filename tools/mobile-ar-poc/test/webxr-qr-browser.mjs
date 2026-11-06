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
  page.on('console', message => { if (message.type() === 'error') log.problems.push(message.text()); });
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
  page.on('response', async response => {
    if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); }
  });
  await page.goto(host.url + '/' + session.fragment);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  return { receiver, session, invite, context, page, log };
}
const count = (log, suffix, method = 'POST') => log.requests.filter(r => r.method === method && r.url.endsWith(suffix)).length;
const claim = async ({ page }) => {
  
  await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됨'));
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
    assert.match(await page.locator('body > main').textContent(), /연결됨/);
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

  { // AR before connecting: the single-use invite is still intact in memory.
    const flow = await pair(on), { page, log } = flow;
    assert.equal(count(log, '/v1/claim'), 0);
    await runAr(page);
    assert.equal(count(log, '/v1/claim'), 0, 'AR does not claim');
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended), true);
    assert.equal(new URL(page.url()).hash, '', 'Back does not bring the invite fragment back');
    await noLeak(flow);
    await claim(flow);
    assert.equal(count(log, '/v1/claim'), 1);
    assert.equal(await page.evaluate(() => window.__selfInspection.state.step), 'intro', 'Back returned to where the user was');
    await page.locator('#manual-start').click();
    await complete(page);
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    await noLeak(flow);
    await finish(flow, 'before claim');
    pass('unclaimed invite survives AR and Back, then claims once and submits');
  }

  { // The vehicle's decision still reaches the phone across AR.
    const flow = await pair(on), { page, receiver } = flow;
    await claim(flow);
    await runAr(page);
    await receiver.cancel();
    await page.evaluate(() => document.querySelector('#xr-return').click());
    await page.waitForFunction(() => !window.__webXrGuide.open);
    await page.waitForFunction(() => document.body.textContent.includes('차량 측에서 취소했습니다'));
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
