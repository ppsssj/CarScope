// Real Render-shaped HTTP, real PostgreSQL/QR grants, Chrome mobile viewport and the real OpenAI adapter.
// Only its outbound fetch is synthetic. No Render, phone, OpenAI or Roboflow is contacted.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { startRenderVisionExperiment } from '../../inspection-sync-poc/src/render-vision-experiment.mjs';
import { startRenderStateful } from '../../inspection-sync-poc/src/render-stateful.mjs';
import { PostgreSQLVisionBudget } from '../../inspection-sync-poc/src/vision-budget.mjs';
import { experimentVisionProvider, experimentDetectionProvider } from '../../inspection-sync-poc/src/vision-providers.mjs';
import { AvdSimulatorCredentialStore } from '../../inspection-sync-poc/src/avd-simulator-credentials.mjs';
import { buildInviteFragment } from '../../inspection-sync-poc/src/protocol.mjs';
import { visionDatabase, openAiFixture } from '../../inspection-sync-poc/test/vision-fixture.mjs';

if (!process.env.PG_TEST_URL) throw new Error('PG_TEST_URL required; real PostgreSQL gate cannot skip');
const ORIGIN = 'https://vision-experiment-test.onrender.com';
const output = path.resolve(process.env.POC_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'carscope-p13-e'));
if (output.toLowerCase().startsWith(path.resolve('.').toLowerCase() + path.sep)) throw new Error('Evidence must be outside the repository');
await mkdir(output, { recursive: true });
const result = { kind: 'REAL_POSTGRES_QR_MOBILE_CHROME_MOCK_OUTBOUND_ROBOFLOW_OPENAI', paidCalls: 0, render: 'NOT_RUN', realPhone: 'NOT_RUN', checks: [] };
const pass = text => { result.checks.push(text); console.log('PASS ' + text); };
const png = new PNG({ width: 1000, height: 800 }); png.data.fill(150);
for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
const picture = { name: 'synthetic.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };
const PARTS = [['washer-fluid-cap','washer-fluid'], ['coolant-reservoir','coolant-reservoir'], ['brake-fluid-reservoir','brake-fluid'], ['fuse-box','fuse-box'], ['battery-12v','battery-12v'], ['lcw-coolant-reservoir','lcw-coolant-reservoir']];
let browser;
const fixtures = [];

async function service({ daily = 20, baseline = false, partDetection = null, hostedDetection = false, allowDraftProfiles = false } = {}) {
  const db = await visionDatabase(), pool = db.pool(), mock = openAiFixture();
  const budget = new PostgreSQLVisionBudget({ pool, daily, monthly: daily, expectedSchema: db.schema });
  const provider = experimentVisionProvider({ env: { CARSCOPE_VISION_APPROVAL:'OPERATOR_APPROVED', OPENAI_API_KEY:'synthetic-server-key', OPENAI_VISION_MODEL:'synthetic-model' }, budget, fetchImpl: mock.fetch });
  const detection = { calls:0, mode:'answer', aborted:false };
  if (hostedDetection) {
    const detector = experimentDetectionProvider({ env:{ CARSCOPE_ROBOFLOW_APPROVAL:'OPERATOR_APPROVED', ROBOFLOW_API_KEY:'synthetic-detection-key' },budget,
      fetchImpl:async (url, options) => {
        assert.equal(url,'https://serverless.roboflow.com/engine-bay-parts/1?confidence=0.05');
        assert.equal(options.headers.Authorization,'Bearer synthetic-detection-key'); detection.calls++;
        options.signal.addEventListener('abort', () => { detection.aborted = true; }, { once:true });
        if (detection.mode === 'hold') await new Promise(resolve => options.signal.addEventListener('abort',resolve,{ once:true }));
        if (detection.mode === 'error') return new Response('synthetic unavailable',{ status:503 });
        const classes = detection.mode === 'none' ? [] : detection.mode === 'wrong' ? ['Battery'] : ['Windshield Wiper Fluid','Engine Coolant Reservoir','Brake Fluid','Fuse Box'];
        return Response.json({ image:{ width:1000,height:800 },predictions:classes.map(name => ({ class:name,confidence:0.9,x:500,y:400,width:300,height:240 })) });
      } });
    partDetection = { provider:detector,admission:budget };
  }
  const app = await (baseline ? startRenderStateful : startRenderVisionExperiment)({ pool, publicOrigin: ORIGIN, expectedSchema: db.schema, enableAvdSimulation: true, provider, budget, partDetection, ...(baseline ? {} : { allowDraftProfiles }) });
  const edge = http.createServer((req, res) => {
    const up = http.request({ host:'127.0.0.1', port:app.server.address().port, method:req.method, path:req.url,
      headers:{ ...req.headers, host:new URL(ORIGIN).host, 'x-forwarded-proto':'https', ...(req.headers.origin ? { origin: ORIGIN } : {}) } }, answer => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.pipe(up);
  });
  await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + edge.address().port;
  const registry = new AvdSimulatorCredentialStore({ pool });
  const registration = await registry.register({ label:'synthetic-vision-browser', ttlMs:3_600_000 });
  const { credential } = await registry.provision({ enrollmentProof:registration.enrollmentProof, apiOrigin:ORIGIN });
  const api = async (route, { method = 'GET', token, body } = {}) => {
    const response = await fetch(url + route, { method, headers:{ ...(token ? { Authorization:'Bearer ' + token } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    return { status:response.status, data:await response.json().catch(() => null) };
  };
  const owned = { db, pool, mock, detection, app, url, api, credential, async stop() { await new Promise(resolve => edge.close(resolve)); await app.stop(); await db.close(); } };
  fixtures.push(owned); return owned;
}

async function phone(host, task) {
  const created = await host.api('/v1/sessions', { method:'POST', token:host.credential, body:{ taskId:task } }); assert.equal(created.status, 201);
  const session = created.data, context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  const log = { requests:[], errors:[], failedResponses:[] };
  page.on('pageerror', e => log.errors.push(e.message));
  page.on('request', r => log.requests.push({ url:r.url(), method:r.method(), headers:r.headers() }));
  page.on('response', r => { if (r.status() >= 400) log.failedResponses.push({ status:r.status(), path:new URL(r.url()).pathname }); });
  await page.goto(host.url + '/' + buildInviteFragment(task, session.inviteToken));
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  await page.waitForFunction(() => document.getElementById('sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  await page.waitForFunction(() => window.__partDetection);
  return { page, context, log, session };
}
const state = page => page.evaluate(() => JSON.stringify((window.__checklistInspection ?? window.__selfInspection).state));
const waitAnalysis = (page, phase) => page.waitForFunction(p => window.__partAnalysis.state.phase === p, phase);
async function crop(page, skipDetection = false) {
  await page.locator('#part-detect-open').click();
  if (skipDetection) {
    await page.locator('#part-detect-manual').click();
    assert.equal(await page.locator('#part-detect-agree').isVisible(), false);
  } else assert.equal(await page.locator('#part-detect-agree').count(), 0, 'no Roboflow consent in manual-only service');
  await page.locator('#part-detect-library-input').setInputFiles(picture);
  await waitAnalysis(page, 'REGION');
  const picker = page.locator('#part-analysis-picker'); await picker.scrollIntoViewIfNeeded();
  const rect = await picker.boundingBox(); await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForFunction(() => window.__partAnalysis.state.cropReady);
  assert.equal(await page.locator('#part-analysis-start').isEnabled(), false);
  assert.match(await page.locator('#part-analysis-consent-text').innerText(), /OpenAI/);
  assert.doesNotMatch(await page.locator('#part-analysis-consent-text').innerText(), /Roboflow/);
}
async function send(page) { await page.locator('#part-analysis-agree').check(); await page.locator('#part-analysis-start').click(); }

async function detect(page) {
  await page.locator('#part-detect-open').click();
  assert.equal(await page.locator('#part-detect-take').isEnabled(),false);
  await page.locator('#part-detect-agree').check();
  await page.locator('#part-detect-camera-input').setInputFiles(picture);
  await page.waitForFunction(() => ['CANDIDATES','NONE_FOUND','FAILED'].includes(window.__partDetection.state.phase));
  await waitAnalysis(page,'REGION');
}

async function submitAccept(host, page, session) {
  await page.click('#manual-start');
  await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(box => box.click()));
  await page.click('#primary'); await page.click('[data-status="NEEDS_REFILL"]'); await page.click('#primary'); await page.click('#primary');
  await page.waitForSelector('body[data-step="done"]'); await page.click('#sync-send');
  await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT');
  const received = await host.api('/v1/sessions/' + session.sessionId,{ token:session.receiverToken });
  assert.equal(received.data.sessionState,'RESULT_SUBMITTED');
  assert.equal((await host.api('/v1/sessions/' + session.sessionId + '/accept',{ method:'POST',token:session.receiverToken,body:{ resultDigest:received.data.resultDigest } })).status,200);
  assert.equal(Number((await host.pool.query('SELECT count(*) AS n FROM cs_inspection_records')).rows[0].n),1);
}

try {
  browser = await chromium.launch({ channel:process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless:true });
  const host = await service();
  assert.equal((await host.api('/v1/sessions', { method:'POST', body:{ taskId:'washer-fluid' } })).status, 403);
  assert.equal((await host.api('/v1/inspection-records', { token:host.credential })).status, 403);
  for (const [part, task] of PARTS) {
    const { page, context, log, session } = await phone(host, task), before = await state(page), calls = host.mock.calls.length;
    await crop(page); assert.equal(host.mock.calls.length, calls, 'crop stays local before consent');
    if (part === 'washer-fluid-cap') await page.screenshot({ path:path.join(output, 'washer-crop.png') });
    await send(page); await waitAnalysis(page, 'RESULT');
    assert.equal(host.mock.calls.at(-1).partId, part);
    assert.equal(await page.locator('#part-analysis-continue').isEnabled(), false);
    if (part === 'battery-12v') await page.screenshot({ path:path.join(output, 'battery-result.png') });
    assert.equal(log.requests.filter(r => r.url.includes('/v1/part-detections/')).length, 0);
    const posts = log.requests.filter(r => r.url.includes('/v1/part-analyses/'));
    assert.equal(posts.length, 1); assert.equal(posts[0].headers['x-carscope-region-source'], 'MANUAL');
    assert.ok(log.requests.every(r => r.url.startsWith(host.url)), 'phone contacts its own origin only');
    assert.equal((await page.content()).includes('synthetic-server-key'), false);
    await page.locator('#part-analysis-ack').check(); await page.locator('#part-analysis-continue').click();
    assert.equal(await state(page), before, 'AI does not fill inspection answers');
    assert.equal((await host.api('/v1/sessions/' + session.sessionId, { token:session.receiverToken })).data.sessionState, 'CLAIMED');
    if (part === 'washer-fluid-cap') {
      await page.click('#manual-start');
      await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(box => box.click()));
      await page.click('#primary'); await page.click('[data-status="NEEDS_REFILL"]'); await page.click('#primary'); await page.click('#primary');
      await page.waitForSelector('body[data-step="done"]'); await page.click('#sync-send');
      try { await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT'); }
      catch (error) {
        const ui = await page.locator('#done-sync').evaluate(n => ({ state:n.dataset.syncState,text:n.textContent }));
        const server = await host.api('/v1/sessions/' + session.sessionId, { token:session.receiverToken });
        throw new Error('Submission did not complete: ' + JSON.stringify({ ui, serverState:server.data?.sessionState, failures:log.failedResponses }), { cause:error });
      }
      const received = await host.api('/v1/sessions/' + session.sessionId, { token:session.receiverToken });
      assert.equal(received.data.sessionState, 'RESULT_SUBMITTED');
      assert.equal((await host.api('/v1/sessions/' + session.sessionId + '/accept', { method:'POST', token:session.receiverToken, body:{ resultDigest:received.data.resultDigest } })).status, 200);
      assert.equal(Number((await host.pool.query('SELECT count(*) AS n FROM cs_inspection_records')).rows[0].n), 1, 'existing accepted record is archived');
    }
    assert.deepEqual(log.errors, []); await context.close();
  }
  pass('six QR tasks: capture/manual region, local crop, explicit OpenAI consent, result acknowledgement; no Roboflow; existing submit/Accept/history preserved');

  { // P13-G: the eleven exterior parts. Without the operator's draft approval the experiment refuses them; with it, the same QR flow.
    // A fresh host: the six analyses above used this client's real per-minute analysis rate (6), which is kept as it is.
    const plain = await service();
    assert.equal((await fetch(plain.url + '/healthz').then(r => r.json())).draftProfiles, 'OFF');
    const tire = await plain.api('/v1/sessions', { method:'POST', token:plain.credential, body:{ taskId:'tire.front-left' } }); assert.equal(tire.status, 201);
    const claim = await fetch(plain.url + '/v1/claim', { method:'POST', headers:{ Authorization:'Bearer ' + tire.data.inviteToken } }).then(r => r.json());
    const refused = await fetch(plain.url + '/v1/part-analyses/tire.front-left', { method:'POST', body:Buffer.from([0xff, 0xd8, 0xff, 0xd9]), headers:{ Authorization:'Bearer ' + claim.submitToken, 'Content-Type':'image/jpeg',
      'X-CarScope-External-Processing':'external-vision-v1', 'X-CarScope-Target-Box':'0.300000,0.300000,0.400000,0.400000', 'X-CarScope-Region-Source':'MANUAL' } });
    assert.equal(refused.status, 404, 'a draft is refused without the operator approval, whatever the phone sends');
    assert.equal(plain.mock.calls.length, 0);
    const EXTERIOR = ['tire.front-left', 'tire.front-right', 'tire.rear-left', 'tire.rear-right', 'wiper.front.left', 'wiper.front.right',
      'light-low-beam-left-0', 'light-low-beam-right-0', 'light-high-beam-left-0', 'light-high-beam-right-0', 'ev-charge.port'];
    // Six analyses per client per minute is the deployed rate: each approved host takes at most six parts.
    for (const group of [EXTERIOR.slice(0, 6), EXTERIOR.slice(6)]) {
    const draftHost = await service({ allowDraftProfiles: true });
    assert.equal((await fetch(draftHost.url + '/healthz').then(r => r.json())).draftProfiles, 'OPERATOR_APPROVED');
    for (const part of group) {
      const { page, context, log, session } = await phone(draftHost, part), before = await state(page), calls = draftHost.mock.calls.length;
      await crop(page); assert.equal(draftHost.mock.calls.length, calls, `${part}: the crop stays on the phone before consent`);
      await send(page); await waitAnalysis(page, 'RESULT');
      assert.deepEqual([draftHost.mock.calls.at(-1).partId, draftHost.mock.calls.at(-1).exterior, draftHost.mock.calls.at(-1).store], [part, true, false], part);
      const posts = log.requests.filter(r => r.url.includes('/v1/part-analyses/'));
      assert.equal(posts.length, 1); assert.ok(posts[0].url.endsWith('/v1/part-analyses/' + part)); assert.equal(posts[0].headers['x-carscope-region-source'], 'MANUAL');
      assert.equal(log.requests.filter(r => r.url.includes('/v1/part-detections/')).length, 0, `${part}: no detection request`);
      assert.match(await page.locator('#part-analysis-evidence').innerText(), /시험 단계/);
      if (part === 'light-low-beam-left-0') await page.screenshot({ path:path.join(output, 'p13-g-lamp-result.png') });
      await page.locator('#part-analysis-ack').check(); await page.locator('#part-analysis-continue').click();
      assert.equal(await state(page), before, `${part}: AI does not fill inspection answers`);
      assert.equal((await draftHost.api('/v1/sessions/' + session.sessionId, { token:session.receiverToken })).data.sessionState, 'CLAIMED', `${part}: nothing submitted`);
      assert.deepEqual(log.errors, []); await context.close();
    }
    assert.equal(Number((await draftHost.pool.query("SELECT coalesce(max(calls),0) AS n FROM cs_vision_calls WHERE provider = 'openai'")).rows[0].n), group.length, 'each analysis counted once in the durable budget');
    }
    pass('P13-G: the experiment refuses the 11 exterior drafts without the operator approval; with it, each runs QR claim, local crop, consent, the real adapter (MOCK outbound, exterior prompt, store:false), MANUAL region only, budget counted, nothing submitted');
  }

  let detections = 0;
  // A test-only injected detector proves the optional path without granting real Roboflow rights or enabling the CLI.
  const optional = await service({ partDetection:{ provider:{ detect:async () => { detections++; throw new Error('must not call detector in manual flow'); } } } });
  for (const [part, task] of PARTS.slice(0,4)) {
    const { page, context, log } = await phone(optional, task); await crop(page,true); await send(page); await waitAnalysis(page,'RESULT');
    assert.equal(optional.mock.calls.at(-1).partId,part);
    assert.equal(log.requests.filter(r => r.url.includes('/v1/part-detections/')).length,0);
    await context.close();
  }
  assert.equal(detections,0);
  pass('four detection-capable parts can bypass an injected detector and its consent, and use only a manually marked crop');

  const integrated = await service({ hostedDetection:true });
  for (const [part,task] of PARTS.slice(0,4)) {
    const { page,context,session,log } = await phone(integrated,task), before = await state(page);
    await detect(page); assert.equal(await page.locator('#part-analysis-candidate-1').count(),1);
    assert.equal(integrated.mock.calls.length,PARTS.findIndex(p => p[0] === part));
    await page.locator('#part-analysis-candidate-1').click();
    await page.waitForFunction(() => window.__partAnalysis.state.cropReady);
    assert.equal(await page.locator('#part-analysis-start').isEnabled(),false);
    if (part === 'washer-fluid-cap') await page.screenshot({ path:path.join(output,'p13-f-candidate-crop.png') });
    await send(page); await waitAnalysis(page,'RESULT');
    assert.equal(log.requests.filter(r => r.url.includes('/v1/part-detections/')).length,1);
    const requests = log.requests.filter(r => r.url.includes('/v1/part-analyses/'));
    assert.equal(requests.length,1); assert.equal(requests[0].headers['x-carscope-region-source'],'AI_CANDIDATE');
    assert.ok(log.requests.every(r => r.url.startsWith(integrated.url)));
    if (part === 'washer-fluid-cap') await page.screenshot({ path:path.join(output,'p13-f-analysis-result.png') });
    await page.locator('#part-analysis-ack').check(); await page.locator('#part-analysis-continue').click();
    assert.equal(await state(page),before);
    if (part === 'washer-fluid-cap') await submitAccept(integrated,page,session);
    assert.deepEqual(log.errors,[]); await context.close();
  }
  assert.equal(integrated.detection.calls,4); assert.equal(integrated.mock.calls.length,4);
  const counts = (await integrated.pool.query("SELECT provider,calls FROM cs_vision_calls WHERE period LIKE 'day:%' ORDER BY provider")).rows;
  assert.deepEqual(counts,[{ provider:'openai',calls:4 },{ provider:'roboflow',calls:4 }]);
  pass('four supported classes: real hosted adapters with MOCK outbound, QR/camera input/candidate/crop/separate consent/GPT/ack; washer submit/vehicle Accept/archive; provider budgets counted separately');

  const fallback = await service({ hostedDetection:true });
  for (const mode of ['none','wrong','error']) {
    fallback.detection.mode = mode;
    const { page,context } = await phone(fallback,'washer-fluid'); await detect(page);
    assert.equal(await page.locator('#part-analysis-candidate-1').count(),0);
    const picker = page.locator('#part-analysis-picker'); await picker.scrollIntoViewIfNeeded();
    const rect = await picker.boundingBox(); await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
    await page.waitForFunction(() => window.__partAnalysis.state.cropReady); await send(page); await waitAnalysis(page,'RESULT');
    await context.close();
  }
  pass('no detections, another part and Roboflow HTTP failure offer direct region selection and GPT without retrying detection');

  const cancelDetection = await service({ hostedDetection:true }); cancelDetection.detection.mode = 'hold';
  const cancelledPhone = await phone(cancelDetection,'washer-fluid');
  await cancelledPhone.page.locator('#part-detect-open').click(); await cancelledPhone.page.locator('#part-detect-agree').check();
  await cancelledPhone.page.locator('#part-detect-camera-input').setInputFiles(picture);
  for (let i=0; i<100 && !cancelDetection.detection.calls; i++) await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(cancelDetection.detection.calls,1);
  await cancelledPhone.page.setViewportSize({ width:844,height:390 });
  await cancelledPhone.page.goBack();
  await cancelledPhone.page.waitForFunction(() => !document.querySelector('#part-detect').open);
  for (let i=0; i<100 && !cancelDetection.detection.aborted; i++) await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(cancelDetection.detection.aborted,true); assert.equal(cancelDetection.mock.calls.length,0);
  await cancelledPhone.context.close();
  pass('rotation and Back close the detection dialog, abort the actual adapter request and dispatch no GPT call');

  const failures = await service({ daily:3 });
  for (const mode of ['error','invalid','hold','budget']) {
    failures.mock.mode = mode;
    const { page, context } = await phone(failures, 'washer-fluid'); await crop(page); await send(page);
    if (mode === 'hold') {
      await page.waitForFunction(() => window.__partAnalysis.state.phase === 'ANALYZING');
      await page.waitForTimeout(700); await page.locator('#part-analysis-cancel').click();
      await waitAnalysis(page, 'PREVIEW');
      for (let i = 0; i < 30 && !failures.mock.calls.at(-1)?.aborted; i++) await new Promise(r => setTimeout(r, 20));
      assert.equal(failures.mock.calls.at(-1).aborted, true);
    } else {
      await waitAnalysis(page, 'FAILED');
      if (mode === 'budget') assert.match(await page.locator('#part-analysis-error').innerText(), /사용 한도/);
      else assert.match(await page.locator('#part-analysis-error').innerText(), /기존 점검은 그대로/);
    }
    await page.locator('#part-detect-close').click(); assert.equal((await state(page)).includes('intro'), true); await context.close();
  }
  assert.equal(failures.mock.calls.length, 3, 'budget exhaustion dispatches no fourth request; failures/cancel remain counted');
  pass('OpenAI HTTP failure, invalid answer, cancellation and durable budget exhaustion leave the checklist usable');

  const baseline = await service({ baseline:true });
  const home = await (await fetch(baseline.url + '/')).text(); assert.doesNotMatch(home, /data-part-analysis/);
  assert.equal((await fetch(baseline.url + '/v1/part-analyses/washer-fluid-cap', { method:'POST' })).status, 404);
  assert.equal((await fetch(baseline.url + '/mobile-ar-poc/public/part-analysis-ui.mjs')).status, 404);
  pass('existing Render entry remains OFF and serves neither the analysis route nor its modules');
  result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); for (const f of fixtures.reverse()) await f.stop();
  await writeFile(path.join(output, 'vision-mobile-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
