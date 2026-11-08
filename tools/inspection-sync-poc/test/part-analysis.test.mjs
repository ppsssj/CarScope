// P13-A: the analysis relay. Real sync HTTP on 127.0.0.1 with a local test session and the MOCK vision provider: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_CONSENT } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { PART_ANALYSIS_FILES, markPartAnalysisPage, markPartDetectionPage } from '../../mobile-ar-poc/part-detection-modules.mjs';
import { createMockVisionProvider, MOCK_SCENARIOS } from '../../vision-poc/src/mock-vision-provider.mjs';
import { startSyncServer, createSyncHandler } from '../src/server.mjs';
import { startMobileDevServer } from '../src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { ANALYSIS_LIMITS, assertVisionProvider, parseTargetBox } from '../src/part-analysis-route.mjs';
import { ReceiverClient } from '../bin/receiver.mjs';
import { SyncClient } from '../public/sync-client.mjs';
import { partAnalysisGate, runStaticGates } from '../preflight/static-gates.mjs';
import { DEFAULT_RATES } from '../src/rate-limit.mjs';
import { serveMobilePage } from '../src/mobile-page.mjs';

const jpeg = (width = 640, height = 480, pad = 64) => {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);
};
const W = 'washer-fluid-cap';
const wide = { limit: 1000, windowMs: 60_000 };
const detector = { detect: async () => ({ imageWidth: 640, imageHeight: 480, predictions: [] }) };

async function service(t, { provider = createMockVisionProvider(), rates = { ...DEFAULT_RATES, analyze: wide, 'analyze-session': wide }, limits, log = [] } = {}) {
  let now = Date.now();
  const s = await startSyncServer({ port: 0, authorizer: new LocalTestSessionCreationAuthorizer(), now: () => now, rates, log: line => log.push(line), partDetection: { provider: detector }, partAnalysis: { provider, limits } });
  t.after(() => s.stop());
  const session = async (task = 'washer-fluid') => {
    now += 61_000;
    const created = await new ReceiverClient({ baseUrl: s.url }).create(task);
    const invite = created.fragment.split('invite=')[1];
    const claim = await (await fetch(`${s.url}/v1/claim`, { method: 'POST', headers: { Authorization: `Bearer ${invite}` } })).json();
    return claim.submitToken;
  };
  const post = (partId, token, body = jpeg(), headers = {}) => fetch(`${s.url}/v1/part-analyses/${partId}`, { method: 'POST', body, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'image/jpeg', 'X-CarScope-External-Processing': ANALYSIS_CONSENT,
    'X-CarScope-Target-Box': '0.300000,0.300000,0.400000,0.400000', 'X-CarScope-Region-Source': 'AI_CANDIDATE', ...headers } });
  return { s, provider, session, post, log, advance: ms => { now += ms; } };
}
const code = async response => (await response.json()).error?.code;

test('off unless a host passes a provider; a detector is optional for manual regions', async (t) => {
  const off = await startSyncServer({ port: 0, authorizer: new LocalTestSessionCreationAuthorizer(), log: () => {}, partDetection: { provider: detector } });
  t.after(() => off.stop());
  assert.equal((await fetch(`${off.url}/v1/part-analyses/${W}`, { method: 'POST' })).status, 404, 'the path answers like any unknown one');
  assert.equal(typeof createSyncHandler({ service: {}, partAnalysis: { provider: createMockVisionProvider() } }), 'function');
  for (const bad of [null, {}, { analyzePart() {}, id: 'other', model: 'x' }, { analyzePart() {}, id: 'openai', model: '' }, { analyzePart() {}, id: 'openai', model: 'bad model id' }])
    assert.throws(() => assertVisionProvider(bad), /PROVIDER_REQUIRED/);
  assert.equal(partAnalysisGate().status, 'PASS', partAnalysisGate().detail);
  const gates = await runStaticGates();
  assert.equal(gates.find(g => g.id === 'PART_ANALYSIS_OFF').status, 'PASS');
  assert.equal(gates.find(g => g.id === 'PART_DETECTION_OFF').status, 'PASS');
});

test('consent, credential, own part, profile and a valid region are required before anything is read or sent', async (t) => {
  const { provider, session, post } = await service(t);
  const token = await session();
  assert.equal((await post(W)).status, 401);
  assert.equal(await code(await post(W, token, jpeg(), { 'X-CarScope-External-Processing': 'external-ai-v1' })), 'CONSENT_REQUIRED', 'the detection consent does not cover the vision service');
  for (const id of ['nothing', 'tire.front-left']) {
    const r = await post(id, token); assert.equal(r.status, 404, id); assert.equal(await code(r), 'PART_ANALYSIS_UNSUPPORTED', id);
  }
  // P13-D: the other bonnet parts are offered, but a washer credential may analyse only the washer cap.
  for (const id of ['coolant-reservoir', 'brake-fluid-reservoir', 'fuse-box', 'battery-12v', 'lcw-coolant-reservoir']) assert.equal((await post(id, token, jpeg(), { 'X-CarScope-Region-Source': 'MANUAL' })).status, 403, id);
  for (const box of ['', '0,0,0,0.1', '0.9,0,0.2,0.1', '-0.1,0,0.1,0.1', '0,0,1', 'a,b,c,d', '0.1,0.1,0.1,0.1,0.1', '0.1234567,0,0.1,0.1'])
    assert.equal((await post(W, token, jpeg(), { 'X-CarScope-Target-Box': box })).status, 400, box);
  assert.equal((await post(W, token, jpeg(), { 'X-CarScope-Region-Source': 'GUESS' })).status, 400);
  const fuseToken = await session('fuse-box');
  assert.equal((await post(W, fuseToken)).status, 403, 'another inspection\'s part');
  assert.equal(provider.calls.length, 0, 'none reached the provider');
  assert.equal((await post(W, token)).status, 200);
  assert.equal(provider.calls.length, 1);
});

test('only a sane JPEG within limits goes out, and the provider gets the crop and the prompt, not the session', async (t) => {
  const { provider, session, post } = await service(t);
  const token = await session();
  assert.equal((await post(W, token, jpeg(), { 'Content-Type': 'image/png' })).status, 415);
  assert.equal((await post(W, token, Buffer.from('not a picture'))).status, 422);
  assert.equal((await post(W, token, jpeg(ANALYSIS_LIMITS.maxSide + 1, 100))).status, 422);
  assert.equal((await post(W, token, jpeg(32, 32))).status, 422);
  assert.equal((await post(W, token, jpeg(640, 480, ANALYSIS_LIMITS.maxBytes + 1))).status, 413);
  assert.equal(provider.calls.length, 0);
  const r = await post(W, token, jpeg(800, 600), { 'X-CarScope-Region-Source': 'MANUAL' });
  assert.equal(r.status, 200);
  const [call] = provider.calls;
  assert.deepEqual(call.imageSize, { width: 800, height: 600 });
  assert.deepEqual(call.targetInCrop, [0.3, 0.3, 0.4, 0.4]);
  assert.equal(call.regionSource, 'MANUAL');
  assert.equal(call.promptVersion, 'p13-a-1');
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['partId', 'profileStatus', 'result', 'analysis']);
  assert.equal(body.profileStatus, 'EXPERIMENTAL');
  assert.deepEqual(Object.keys(body.analysis), ['provider', 'model', 'promptVersion', 'regionSource', 'targetInCrop', 'image', 'analyzedAt']);
  assert.equal(body.analysis.provider, 'mock');
  assert.ok(!JSON.stringify(body).includes(token));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('an invalid answer is refused whole (502); a provider failure or timeout is a fixed 503 that quotes nothing', async (t) => {
  const log = [];
  const { provider, session, post } = await service(t, { limits: { ...ANALYSIS_LIMITS, timeoutMs: 150 }, log });
  const token = await session();
  for (const name of ['claims-safe', 'extra-key', 'not-json']) {
    provider.scenario = name;
    const r = await post(W, token);
    assert.equal(r.status, 502, name); assert.equal(await code(r), 'PART_ANALYSIS_INVALID_RESPONSE');
  }
  provider.scenario = () => ({ ...MOCK_SCENARIOS['no-visible-issue'], partMatch: 'UNCERTAIN' });
  assert.equal((await post(W, token)).status, 502, 'judged a part it was not sure of');
  provider.scenario = 'no-visible-issue'; provider.mode = 'error';
  const failed = await post(W, token), text = await failed.text();
  assert.equal(failed.status, 503); assert.match(text, /PART_ANALYSIS_UNAVAILABLE/); assert.doesNotMatch(text, /sk-should-never-leave|mock upstream/);
  provider.mode = 'hold';
  const slow = await post(W, token);
  assert.equal(slow.status, 503, 'timeout');
  provider.release(); provider.mode = 'answer';
  assert.ok(log.every(line => !line.includes(token) && !/sk-should|mock upstream/.test(line)), 'the log holds no token or upstream text');
  for (const name of ['suspected', 'indeterminate', 'wrong-part', 'no-visible-issue']) {
    provider.scenario = name;
    const r = await post(W, token);
    assert.equal(r.status, 200, name); assert.equal((await r.json()).result.assessment, MOCK_SCENARIOS[name].assessment);
  }
});

test('one analysis at a time per phone, and a per-session cap', async (t) => {
  const { provider, session, post } = await service(t, { rates: { ...DEFAULT_RATES, analyze: wide, 'analyze-session': { limit: 3, windowMs: 600_000 } } });
  const token = await session();
  provider.mode = 'hold';
  const first = post(W, token);
  while (provider.calls.length < 1) await new Promise(r => setTimeout(r, 10));
  const second = await post(W, token);
  assert.equal(second.status, 409); assert.equal(await code(second), 'PART_ANALYSIS_IN_PROGRESS');
  assert.equal(provider.calls.length, 1, 'the duplicate never reached the provider');
  provider.release(); provider.mode = 'answer';
  assert.equal((await first).status, 200);
  assert.equal((await post(W, token)).status, 200);
  assert.equal((await post(W, token)).status, 200);
  const limited = await post(W, token);
  assert.equal(limited.status, 429, 'the session cap of 3 is reached');
  assert.equal(provider.calls.length, 3);
});

test('a client that goes away aborts the provider call', async (t) => {
  const { provider, session, s } = await service(t);
  const token = await session();
  provider.mode = 'hold';
  const ctrl = new AbortController();
  const pending = fetch(`${s.url}/v1/part-analyses/${W}`, { method: 'POST', signal: ctrl.signal, body: jpeg(), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'X-CarScope-External-Processing': ANALYSIS_CONSENT, 'X-CarScope-Target-Box': '0,0,1,1', 'X-CarScope-Region-Source': 'MANUAL' } }).catch(error => error.name);
  while (provider.calls.length < 1) await new Promise(r => setTimeout(r, 10));
  ctrl.abort();
  assert.equal(await pending, 'AbortError');
  for (let i = 0; i < 50 && !provider.calls[0].aborted; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(provider.calls[0].aborted, true);
  provider.mode = 'answer';
});

test('the phone client maps answers to fixed codes and supports cancel', async (t) => {
  const { provider, session, s } = await service(t);
  const token = await session();
  const client = new SyncClient({ baseUrl: s.url, taskId: 'washer-fluid' });
  assert.deepEqual(await client.analyzePart(W, new Blob([jpeg()]), { consent: ANALYSIS_CONSENT, targetInCrop: [0, 0, 1, 1], regionSource: 'MANUAL' }), { ok: false, code: 'NOT_CONNECTED' });
  // A connected client, the same way the phone page gets its credential.
  const created = await new ReceiverClient({ baseUrl: s.url }).create('washer-fluid');
  const phone = new SyncClient({ baseUrl: s.url, taskId: 'washer-fluid' });
  assert.equal((await phone.claim(created.fragment.split('invite=')[1])).ok, true);
  const good = await phone.analyzePart(W, new Blob([jpeg()]), { consent: ANALYSIS_CONSENT, targetInCrop: [0.1, 0.1, 0.5, 0.5], regionSource: 'AI_CANDIDATE' });
  assert.equal(good.ok, true); assert.equal(good.result.partId, W);
  provider.scenario = 'claims-safe';
  assert.deepEqual(await phone.analyzePart(W, new Blob([jpeg()]), { consent: ANALYSIS_CONSENT, targetInCrop: [0, 0, 1, 1], regionSource: 'MANUAL' }), { ok: false, code: 'INVALID_RESPONSE' });
  provider.scenario = 'no-visible-issue'; provider.mode = 'hold';
  const ctrl = new AbortController();
  const pending = phone.analyzePart(W, new Blob([jpeg()]), { consent: ANALYSIS_CONSENT, targetInCrop: [0, 0, 1, 1], regionSource: 'MANUAL', signal: ctrl.signal });
  while (provider.calls.length < 3) await new Promise(r => setTimeout(r, 10));
  ctrl.abort();
  assert.deepEqual(await pending, { ok: false, code: 'CANCELLED' });
  provider.release(); provider.mode = 'answer';
  phone.dispose();
  assert.equal(token.length > 10, true);
});

test('analysis-only and detection-plus-analysis pages are explicit; the service name comes from a fixed list', async (t) => {
  const html = '<html><body data-step="intro" class="x"></body></html>';
  assert.match(markPartAnalysisPage(html, 'mock'), /data-part-analysis="enabled"/);
  assert.throws(() => markPartAnalysisPage('<body>', 'mock'), /DETECTION_PAGE_MARKER_MISSING/);
  assert.throws(() => markPartAnalysisPage(markPartDetectionPage(html), 'evil"><script>'), /PROVIDER_UNKNOWN/);
  assert.match(markPartAnalysisPage(markPartDetectionPage(html), 'openai'), /data-part-analysis="enabled" data-part-analysis-service="openai"/);
  const served = async options => {
    const out = {};
    for (const path of ['/', ...PART_ANALYSIS_FILES.map(name => `/mobile-ar-poc/public/${name}`)]) {
      const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body?.toString() ?? ''; } };
      await serveMobilePage({ method: 'GET', url: path, headers: {} }, res, options);
      out[path] = res;
    }
    return out;
  };
  const off = await served({ partDetection: true });
  assert.doesNotMatch(off['/'].body, /data-part-analysis/);
  for (const name of PART_ANALYSIS_FILES) assert.equal(off[`/mobile-ar-poc/public/${name}`].status, 404, name);
  const noDetection = await served({ partAnalysis: 'mock' });
  assert.doesNotMatch(noDetection['/'].body, /data-part-detection="enabled"/);
  for (const name of PART_ANALYSIS_FILES) assert.equal(noDetection[`/mobile-ar-poc/public/${name}`].status, 200, name);
  const on = await served({ partDetection: true, partAnalysis: 'mock' });
  assert.match(on['/'].body, /data-part-analysis-service="mock"/);
  for (const name of PART_ANALYSIS_FILES) assert.equal(on[`/mobile-ar-poc/public/${name}`].status, 200, name);
  const dev = await startMobileDevServer({ authorizer: new LocalTestSessionCreationAuthorizer(), partDetection: { provider: detector }, partAnalysis: { provider: createMockVisionProvider() } });
  t.after(() => dev.stop());
  assert.match(await (await fetch(`${dev.url}/`)).text(), /data-part-analysis-service="mock"/);
});

test('P13-D: every bonnet part is analysed under its own inspection; parts without a detector accept only a marked region', async (t) => {
  const { provider, session, post } = await service(t);
  const tasks = { 'washer-fluid-cap': 'washer-fluid', 'coolant-reservoir': 'coolant-reservoir', 'brake-fluid-reservoir': 'brake-fluid', 'fuse-box': 'fuse-box', 'battery-12v': 'battery-12v', 'lcw-coolant-reservoir': 'lcw-coolant-reservoir' };
  for (const [partId, task] of Object.entries(tasks)) {
    const token = await session(task);
    const manualOnly = partId === 'battery-12v' || partId === 'lcw-coolant-reservoir';
    const viaDetector = await post(partId, token, jpeg(), { 'X-CarScope-Region-Source': 'AI_CANDIDATE' });
    assert.equal(viaDetector.status, manualOnly ? 400 : 200, `${partId} AI_CANDIDATE`);
    const marked = await post(partId, token, jpeg(), { 'X-CarScope-Region-Source': 'MANUAL' });
    assert.equal(marked.status, 200, `${partId} MANUAL`);
    const body = await marked.json();
    assert.equal(body.partId, partId); assert.equal(body.result.partId, partId); assert.equal(body.profileStatus, 'EXPERIMENTAL');
    assert.equal(body.analysis.regionSource, 'MANUAL');
    // The credential of this inspection reaches no other part.
    const other = Object.keys(tasks).find(id => id !== partId);
    assert.equal((await post(other, token, jpeg(), { 'X-CarScope-Region-Source': 'MANUAL' })).status, 403, `${partId} -> ${other}`);
  }
  assert.deepEqual([...new Set(provider.calls.map(c => c.partId))].sort(), Object.keys(tasks).sort());
  assert.ok(provider.calls.filter(c => ['battery-12v', 'lcw-coolant-reservoir'].includes(c.partId)).every(c => c.regionSource === 'MANUAL'), 'no AI_CANDIDATE reached the provider for a manual-only part');
  // A claim this part may not make is refused whole, for any part.
  provider.scenario = input => ({ partId: input.partId, partMatch: 'LIKELY_MATCH', assessment: 'NO_VISIBLE_ISSUE_DETECTED', observations: ['전압이 12.6V입니다.'], suspectedIssues: [], limitations: [], retakeRequired: false, retakeInstructions: [], requiresUserConfirmation: true });
  const claim = await post('battery-12v', await session('battery-12v'), jpeg(), { 'X-CarScope-Region-Source': 'MANUAL' });
  assert.equal(claim.status, 502); assert.equal(await code(claim), 'PART_ANALYSIS_INVALID_RESPONSE');
});
