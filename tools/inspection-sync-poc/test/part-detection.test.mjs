// P12-E: support table, class mapping, the relay's refusals and its boundaries. Provider is a fake: nothing here reaches a model or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { candidatesFor, detectionForTask, DETECTION_CONSENT, DETECTION_MODEL_ID, DETECTION_STATUS, initialDetection, MAX_CANDIDATES, MIN_CANDIDATE_SCORE, offersDetection, PART_DETECTION, PHASE, reduceDetection } from '../../mobile-ar-poc/public/part-detection.mjs';
import { PART_DETECTION_FILES, markPartDetectionPage } from '../../mobile-ar-poc/part-detection-modules.mjs';
import { MOBILE_MODULES } from '../../mobile-ar-poc/public-modules.mjs';
import { PART_GUIDES } from '../../mobile-ar-poc/public/part-guides.mjs';
import { INSPECTION_PARTS, partById } from '../../three-poc/inspection-parts.mjs';
import { startMobileDevServer } from '../src/mobile-dev-server.mjs';
import { startSyncServer } from '../src/server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { createPartDetectionRoute, DETECTION_LIMITS, hostedDetectionProvider, jpegSize } from '../src/part-detection-route.mjs';
import { ReceiverClient } from '../bin/receiver.mjs';
import { SyncClient } from '../public/sync-client.mjs';
import { ALLOWED_ENV, environmentGate, importGraph, partDetectionGate, TOOL_ROOT } from '../preflight/static-gates.mjs';
import { serveMobilePage } from '../src/mobile-page.mjs';

const SIX = ['washer-fluid-cap', 'coolant-reservoir', 'lcw-coolant-reservoir', 'brake-fluid-reservoir', 'battery-12v', 'fuse-box'];
// Classes the model really has (P12-C, Roboflow metadata): 26 names and the numbers 0 to 25.
const MODEL_CLASSES = ['ATF Oil Reservoir', 'Cabin Air Filter Housing', 'Oil Filter', 'Intercooler Coolant Reservoir', 'Secondary Coolant Reservoir', 'Oil Filter Housing', 'Transmission Oil Dip Stick', 'Electric Motor', 'Inverter Coolant Reservoir', 'Air Filter Cover', 'ABS Unit', 'Engine Cover', 'Engine Oil Fill Cap', 'Alternator', 'Radiator Cap', 'Engine Oil Dip Stick', 'Fuse Box', 'Cold Air Intake', 'Clutch Fluid Reservoir', 'Engine Coolant Reservoir', 'Battery', 'Radiator', 'Windshield Wiper Fluid', 'Brake Fluid', 'Power Steering Reservoir', 'Air Filter'];
const NUMBERED = Array.from({ length: 26 }, (_, i) => String(i));
const prediction = (className, score = 0.8, x = 100, y = 100, width = 40, height = 40) => ({ className, score, x, y, width, height });
const parsed = (...predictions) => ({ imageWidth: 400, imageHeight: 300, predictions });
const jpeg = (width = 640, height = 480, pad = 64) => {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);
};

test('the six bonnet parts are the registry\'s, with its ids and tasks, and nothing else is offered', () => {
  assert.deepEqual(Object.keys(PART_DETECTION).sort(), [...SIX].sort());
  assert.deepEqual(INSPECTION_PARTS.filter(part => part.area === 'hood').map(part => part.id).sort(), [...SIX].sort());
  for (const id of SIX) {
    assert.equal(PART_DETECTION[id].partId, id);
    assert.equal(PART_DETECTION[id].taskId, partById(id).taskId, id);
    assert.equal(PART_GUIDES[id].taskId, PART_DETECTION[id].taskId, id);
  }
  for (const task of ['tire.front-left', 'wiper.front.left', 'light-low-beam-left-0', 'ev-charge.port', 'ev-battery.pack']) assert.equal(detectionForTask(task), null, task);
});

test('support is as the evidence allows: four experimental, two unsupported, none verified', () => {
  const status = Object.fromEntries(SIX.map(id => [id, PART_DETECTION[id].status]));
  assert.deepEqual(status, {
    'washer-fluid-cap': 'EXPERIMENTAL', 'coolant-reservoir': 'EXPERIMENTAL', 'lcw-coolant-reservoir': 'UNSUPPORTED',
    'brake-fluid-reservoir': 'EXPERIMENTAL', 'battery-12v': 'UNSUPPORTED', 'fuse-box': 'EXPERIMENTAL',
  });
  assert.ok(!Object.values(PART_DETECTION).some(entry => entry.status === DETECTION_STATUS.VERIFIED), 'preliminary results earn no VERIFIED');
  for (const entry of Object.values(PART_DETECTION)) {
    assert.ok(entry.reason.length > 30, entry.partId);
    assert.equal(offersDetection(entry), entry.status === 'EXPERIMENTAL');
    assert.equal(Boolean(entry.modelClass), entry.status === 'EXPERIMENTAL', entry.partId);
    if (entry.modelClass) { assert.ok(MODEL_CLASSES.includes(entry.modelClass), entry.modelClass); assert.ok(entry.caution, entry.partId); }
  }
});

test('a class of another part, a number or a near name never becomes a candidate', () => {
  const all = [...MODEL_CLASSES, ...NUMBERED];
  for (const id of SIX) {
    const entry = PART_DETECTION[id];
    for (const name of all) {
      const found = candidatesFor(id, parsed(prediction(name)));
      assert.equal(found.length, name === entry.modelClass ? 1 : 0, `${id} <- ${name}`);
    }
    for (const near of ['windshield wiper fluid', 'Windshield Wiper Fluid ', 'Battery 12V', 'Coolant', 'unmapped:Fuse Box']) assert.equal(candidatesFor(id, parsed(prediction(near))).length, 0, near);
  }
  assert.equal(candidatesFor('coolant-reservoir', parsed(prediction('Inverter Coolant Reservoir'), prediction('Secondary Coolant Reservoir'), prediction('Radiator Cap'), prediction('12'))).length, 0);
  assert.equal(candidatesFor('brake-fluid-reservoir', parsed(prediction('Clutch Fluid Reservoir'), prediction('Power Steering Reservoir'), prediction('6'))).length, 0);
  assert.equal(candidatesFor('battery-12v', parsed(prediction('Battery', 0.99))).length, 0, 'unsupported even at a high score');
  assert.equal(candidatesFor('lcw-coolant-reservoir', parsed(prediction('Inverter Coolant Reservoir', 0.99), prediction('Engine Coolant Reservoir', 0.99))).length, 0);
});

test('candidates are checked: score, box and shape; fractions of the picture, best first, overlaps merged, at most three', () => {
  const ID = 'fuse-box', F = 'Fuse Box';
  assert.deepEqual(candidatesFor(ID, parsed(prediction(F, 0.8, 100, 150, 40, 30))), [{ score: 0.8, box: [80 / 400, 135 / 300, 40 / 400, 30 / 300] }]);
  assert.equal(candidatesFor(ID, parsed(prediction(F, MIN_CANDIDATE_SCORE - 0.01))).length, 0);
  for (const bad of [{ score: NaN }, { score: 1.2 }, { x: NaN }, { width: 0 }, { height: -2 }, { x: 900 }]) assert.equal(candidatesFor(ID, parsed({ ...prediction(F), ...bad })).length, 0, JSON.stringify(bad));
  const [edge] = candidatesFor(ID, parsed(prediction(F, 0.8, 0, 0, 40, 40)));
  assert.deepEqual(edge.box, [0, 0, 20 / 400, 20 / 300], 'clamped to the picture');
  const many = candidatesFor(ID, parsed(prediction(F, 0.5, 40, 40), prediction(F, 0.9, 120, 40), prediction(F, 0.7, 200, 40), prediction(F, 0.6, 280, 40)));
  assert.equal(many.length, MAX_CANDIDATES);
  assert.deepEqual(many.map(c => c.score), [0.9, 0.7, 0.6]);
  assert.equal(candidatesFor(ID, parsed(prediction(F, 0.9, 100, 100), prediction(F, 0.8, 102, 100))).length, 1, 'the same thing twice');
  for (const body of [null, {}, { imageWidth: 0, imageHeight: 1, predictions: [] }, { imageWidth: 1, imageHeight: 1 }]) assert.throws(() => candidatesFor(ID, body), /INVALID/);
});

test('the panel: consent first, one attempt at a time, a late answer dropped, and a part change clears every candidate', () => {
  let s = initialDetection('fuse-box');
  assert.equal(reduceDetection(s, { type: 'PHOTO' }), s, 'nothing before opening');
  s = reduceDetection(s, { type: 'OPEN' });
  assert.equal(s.phase, PHASE.CONSENT);
  assert.equal(reduceDetection(s, { type: 'PHOTO' }), s, 'no photo without consent');
  s = reduceDetection(s, { type: 'CONSENT', value: true });
  s = reduceDetection(s, { type: 'PHOTO' });
  assert.equal(s.phase, PHASE.ANALYZING);
  const attempt = s.attempt;
  assert.equal(reduceDetection(s, { type: 'ANSWER', attempt: attempt - 1, candidates: [{}] }), s, 'an older photo\'s answer');
  const shown = reduceDetection(s, { type: 'ANSWER', attempt, candidates: [{ score: 0.9, box: [0, 0, 1, 1] }] });
  assert.equal(shown.phase, PHASE.CANDIDATES);
  assert.equal(shown.candidates.length, 1);
  const switched = reduceDetection(shown, { type: 'SELECT_PART', partId: 'washer-fluid-cap' });
  assert.deepEqual([switched.phase, switched.partId, switched.candidates.length, switched.consented], [PHASE.CLOSED, 'washer-fluid-cap', 0, false]);
  assert.equal(reduceDetection(s, { type: 'SELECT_PART', partId: 'fuse-box' }), s, 'the same part changes nothing');
  const late = reduceDetection(switched, { type: 'ANSWER', attempt, candidates: [{}] });
  assert.equal(late.candidates.length, 0, 'an answer for the earlier part cannot land');
  const record = { modelId: DETECTION_MODEL_ID, modelClass: 'Fuse Box' };
  assert.equal(reduceDetection(s, { type: 'ANSWER', attempt, candidates: [{ score: 0.9, box: [0, 0, 1, 1] }], detection: record }).detection, record, 'kept with its boxes');
  assert.equal(reduceDetection(reduceDetection(s, { type: 'ANSWER', attempt, candidates: [{}], detection: record }), { type: 'AGAIN' }).detection, null);
  const again = reduceDetection(shown, { type: 'AGAIN' });
  assert.deepEqual([again.phase, again.consented, again.candidates.length], [PHASE.CONSENT, false, 0], 'each photo has its own consent');
  assert.equal(reduceDetection(s, { type: 'ANSWER', attempt, candidates: [] }).phase, PHASE.NONE_FOUND);
  assert.equal(reduceDetection(s, { type: 'FAIL', attempt, code: 'X' }).phase, PHASE.FAILED);
  assert.equal(reduceDetection(shown, { type: 'CLOSE' }).candidates.length, 0);
});

test('the words never ask anyone to open, top up, touch or trust', () => {
  const page = readFileSync(new URL('../../mobile-ar-poc/public/part-detection-ui.mjs', import.meta.url), 'utf8');
  const texts = [...Object.values(PART_DETECTION).map(entry => entry.caution ?? ''), ...[...page.matchAll(/'([^'\n]*[가-힣][^'\n]*)'/g)].map(m => m[1])];
  assert.ok(texts.length > 15);
  for (const text of texts) assert.doesNotMatch(text, /열어 (주세요|보세요|확인)|보충해 주세요|만져|분리해|찾았어요\.|정확|확정했|인식했/, text);
  assert.match(page, /확정된 위치가 아니에요/);
  assert.match(page, /외부 AI 서비스\(Roboflow\)/);
  assert.match(PART_DETECTION['coolant-reservoir'].caution, /저전도 냉각수/);
  assert.match(PART_GUIDES['lcw-coolant-reservoir'].role, /없는 차도 있어요/, 'the existing notice stands');
});

// ---- The relay
async function service(t, { detect = async () => parsed(), log = [], rates, limits } = {}) {
  let now = Date.now();
  const calls = [];
  const provider = { detect: async input => { calls.push(input); return detect(input); } };
  const s = await startSyncServer({ port: 0, authorizer: new LocalTestSessionCreationAuthorizer(), now: () => now, rates, log: line => log.push(line), partDetection: { provider, limits } });
  t.after(() => s.stop());
  const session = async (task = 'fuse-box') => {
    now += 61_000;
    const receiver = new ReceiverClient({ baseUrl: s.url });
    const created = await receiver.create(task);
    const invite = created.fragment.split('invite=')[1];
    const claim = await (await fetch(`${s.url}/v1/claim`, { method: 'POST', headers: { Authorization: `Bearer ${invite}` } })).json();
    return { receiver, token: claim.submitToken };
  };
  const post = (partId, token, body = jpeg(), headers = {}) => fetch(`${s.url}/v1/part-detections/${partId}`, { method: 'POST', body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'image/jpeg', 'X-CarScope-External-Processing': DETECTION_CONSENT, ...headers } });
  return { s, calls, session, post, log, advance: ms => { now += ms; } };
}
const code = async response => (await response.json()).error?.code;

test('a credential, its own part and consent are all required before anything is read or sent', async (t) => {
  const { calls, session, post, s } = await service(t);
  const { token } = await session('fuse-box');
  assert.equal((await post('fuse-box')).status, 401, 'no credential');
  const madeUp = 'a'.repeat(43);
  const existing = await fetch(`${s.url}/v1/submissions/status`, { headers: { Authorization: `Bearer ${madeUp}` } });
  assert.ok(existing.status >= 400);
  assert.equal((await post('fuse-box', madeUp)).status, existing.status, 'a made-up credential fails exactly as on the phone\'s other requests');
  assert.equal(await code(await post('fuse-box', token, jpeg(), { 'X-CarScope-External-Processing': '' })), 'CONSENT_REQUIRED');
  const other = await post('washer-fluid-cap', token);
  assert.equal(other.status, 403, 'another part than this inspection\'s');
  for (const id of ['battery-12v', 'lcw-coolant-reservoir', 'tire.front-left', 'nothing']) {
    const r = await post(id, token);
    assert.equal(r.status, 404, id);
    assert.equal(await code(r), 'PART_DETECTION_UNSUPPORTED', id);
  }
  assert.equal(calls.length, 0, 'none of these reached the provider');
  assert.equal((await post('fuse-box', token)).status, 200);
  assert.equal(calls.length, 1);
});

test('only this one photo goes out, only as a sane JPEG', async (t) => {
  const { calls, session, post } = await service(t);
  const { token } = await session();
  assert.equal((await post('fuse-box', token, jpeg(), { 'Content-Type': 'image/png' })).status, 415);
  assert.equal((await post('fuse-box', token, Buffer.from('not a picture at all, sorry'))).status, 422);
  assert.equal((await post('fuse-box', token, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]))).status, 422);
  assert.equal((await post('fuse-box', token, jpeg(DETECTION_LIMITS.maxSide + 1, 100))).status, 422, 'too wide');
  assert.equal((await post('fuse-box', token, jpeg(10, 10))).status, 422, 'too small');
  assert.equal((await post('fuse-box', token, jpeg(640, 480, DETECTION_LIMITS.maxBytes + 1))).status, 413);
  assert.equal(calls.length, 0);
  const image = jpeg();
  assert.equal((await post('fuse-box', token, image)).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(Buffer.compare(calls[0].image, image), 0);
  assert.deepEqual(Object.keys(calls[0]), ['image'], 'the provider gets the photo and nothing about the session');
  assert.deepEqual(jpegSize(image), { width: 640, height: 480 });
});

test('the answer holds only this part\'s candidates, and no provider field', async (t) => {
  const { session, post } = await service(t, { detect: async () => ({ ...parsed(prediction('Fuse Box', 0.9), prediction('Battery', 0.99), prediction('4', 0.95), prediction('ABS Unit', 0.8)), raw: 'secret-looking', inference_id: 'x' }) });
  const { token } = await session();
  const r = await post('fuse-box', token);
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['partId', 'status', 'candidates', 'detection']);
  assert.deepEqual(Object.keys(body.detection), ['modelId', 'modelClass', 'coordinates', 'image', 'inferredAt']);
  assert.equal(body.detection.modelClass, 'Fuse Box');
  assert.equal(body.status, 'EXPERIMENTAL');
  assert.equal(body.candidates.length, 1);
  assert.deepEqual(Object.keys(body.candidates[0]), ['score', 'box']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('a key or a photo in a provider failure goes nowhere, and an outage is a fixed answer', async (t) => {
  const KEY = 'rf_totally_secret_key_123';
  const log = [];
  const { session, post } = await service(t, { log, detect: async () => { throw new Error(`upstream said ${KEY} is bad`); } });
  const { token } = await session();
  const r = await post('fuse-box', token), text = await r.text();
  assert.equal(r.status, 503);
  assert.equal(text, '{"error":{"code":"PART_DETECTION_UNAVAILABLE"}}');
  assert.ok(!log.join('\n').includes(KEY));
  assert.ok(log.every(line => !line.includes(token)), 'no token in the log');
  assert.ok(log.some(line => line.includes('POST /v1/part-detections/:partId 503')), 'the route template, not the part or the body');

  const bad = await service(t, { detect: async () => ({ nonsense: true }) });
  const second = await bad.session();
  assert.equal((await bad.post('fuse-box', second.token)).status, 503);
  const slow = await service(t, { detect: () => new Promise(() => {}), limits: { ...DETECTION_LIMITS, timeoutMs: 50 } });
  const third = await slow.session();
  assert.equal((await slow.post('fuse-box', third.token)).status, 503, 'a hung provider times out');
});

test('a closed inspection cannot use it, and existing calls are unchanged by it', async (t) => {
  const { session, post, calls, s } = await service(t);
  const a = await session();
  await a.receiver.cancel();
  assert.ok([409, 410].includes((await post('fuse-box', a.token)).status), 'cancelled');
  assert.equal(calls.length, 0);
  const b = await session();
  const status = await (await fetch(`${s.url}/v1/submissions/status`, { headers: { Authorization: `Bearer ${b.token}` } })).json();
  assert.deepEqual(Object.keys(status).sort(), ['expiresAt', 'receipt', 'sessionState']);
  assert.equal(status.sessionState, 'CLAIMED', 'a detection does not move the session');
  await post('fuse-box', b.token);
  assert.equal((await (await fetch(`${s.url}/v1/submissions/status`, { headers: { Authorization: `Bearer ${b.token}` } })).json()).sessionState, 'CLAIMED');
});

test('calls are limited per client and per inspection, and only two run at once', async (t) => {
  const rates = { client: { limit: 300, windowMs: 60_000 }, token: { limit: 120, windowMs: 60_000 }, create: { limit: 100, windowMs: 60_000 }, claim: { limit: 100, windowMs: 60_000 }, detect: { limit: 3, windowMs: 60_000 }, 'detect-session': { limit: 100, windowMs: 600_000 } };
  const byClient = await service(t, { rates });
  const a = await byClient.session();
  for (let i = 0; i < 3; i++) assert.equal((await byClient.post('fuse-box', a.token)).status, 200);
  assert.equal((await byClient.post('fuse-box', a.token)).status, 429);
  assert.equal(byClient.calls.length, 3);

  const bySession = await service(t, { rates: { ...rates, detect: { limit: 100, windowMs: 60_000 }, 'detect-session': { limit: 2, windowMs: 600_000 } } });
  const b = await bySession.session();
  for (let i = 0; i < 2; i++) assert.equal((await bySession.post('fuse-box', b.token)).status, 200);
  assert.equal((await bySession.post('fuse-box', b.token)).status, 429);

  let release; const held = new Promise(resolve => { release = resolve; });
  const atOnce = await service(t, { detect: async () => { await held; return parsed(); } });
  const c = await atOnce.session();
  const first = [atOnce.post('fuse-box', c.token), atOnce.post('fuse-box', c.token)];
  while (atOnce.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await atOnce.post('fuse-box', c.token)).status, 429, 'a third one waits for no memory or bandwidth');
  release();
  assert.deepEqual((await Promise.all(first)).map(r => r.status), [200, 200]);
  assert.equal((await atOnce.post('fuse-box', c.token)).status, 200, 'the slot comes back');
});

test('off by default: no route, no mark, no file, whichever host', async (t) => {
  const off = await startMobileDevServer(); t.after(() => off.stop());
  assert.equal((await fetch(`${off.url}/v1/part-detections/fuse-box`, { method: 'POST' })).status, 404);
  assert.ok(!(await (await fetch(off.url)).text()).includes('data-part-detection'));
  for (const name of PART_DETECTION_FILES) assert.equal((await fetch(`${off.url}/mobile-ar-poc/public/${name}`)).status, 404, name);
  assert.ok(!MOBILE_MODULES.some(name => PART_DETECTION_FILES.includes(name)), 'not in the always-served list');

  const on = await startMobileDevServer({ partDetection: { provider: { detect: async () => parsed() } } }); t.after(() => on.stop());
  const csp = (await fetch(off.url)).headers.get('content-security-policy');
  const page = await fetch(on.url);
  assert.equal(page.headers.get('content-security-policy'), csp, 'the CSP is the same');
  assert.match(await page.text(), /<body data-step="intro" data-part-detection="enabled">/);
  for (const name of PART_DETECTION_FILES) assert.equal((await fetch(`${on.url}/mobile-ar-poc/public/${name}`)).status, 200, name);
  assert.throws(() => markPartDetectionPage('<body>'), /MARKER_MISSING/);
  assert.throws(() => createPartDetectionRoute({ provider: {} }), /PROVIDER_REQUIRED/);
});

test('both flags on the same page keep their own marks', async () => {
  const served = options => new Promise(done => {
    const res = { writeHead: (status, headers) => { res.status = status; res.headers = headers; }, end: body => done({ ...res, body: String(body ?? '') }) };
    void serveMobilePage({ method: 'GET', url: '/' }, res, options);
  });
  const { body } = await served({ tls: true, webxrGuide: true, partDetection: true });
  assert.match(body, /data-webxr-guide="enabled"/);
  assert.match(body, /data-part-detection="enabled"/);
});

test('the hosted wiring keeps the key inside and turns every refusal into a failure', async () => {
  const KEY = 'rf_key_never_out', seen = [];
  const provider = hostedDetectionProvider({ apiKey: KEY, inferImage: async args => { seen.push(args); return { status: 'OK', body: { image: { width: 1, height: 1 }, predictions: [] } }; }, parseResponse: body => ({ imageWidth: body.image.width, imageHeight: body.image.height, predictions: body.predictions }) });
  assert.deepEqual(Object.keys(provider), ['detect']);
  assert.ok(!JSON.stringify(provider).includes(KEY));
  assert.equal((await provider.detect({ image: jpeg() })).imageWidth, 1);
  assert.equal(seen[0].modelId, DETECTION_MODEL_ID);
  assert.equal(seen[0].apiKey, KEY);
  for (const status of ['FAILED', 'BLOCKED_AUTH_REJECTED', 'BLOCKED_RATE_OR_CREDIT']) {
    const refused = hostedDetectionProvider({ apiKey: KEY, inferImage: async () => ({ status }), parseResponse: x => x });
    await assert.rejects(refused.detect({ image: jpeg() }), error => !error.message.includes(KEY));
  }
  assert.throws(() => hostedDetectionProvider({ inferImage: async () => {}, parseResponse: x => x }), /CONFIG/);
});

test('the phone client sends once, with the token in a header and nothing in the address, and maps answers to plain codes', async () => {
  const calls = [];
  let reply = { status: 200, body: { candidates: [{ score: 0.9, box: [0, 0, 1, 1] }] } };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/claim')) return new Response(JSON.stringify({ submitToken: 'a'.repeat(43), taskId: 'fuse-box', expiresAt: 1 }), { status: 200 });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  const client = new SyncClient({ baseUrl: 'http://x.test', taskId: 'fuse-box', fetchImpl });
  assert.deepEqual(await client.detectPart('fuse-box', new Blob(['x'])), { ok: false, code: 'NOT_CONNECTED' });
  await client.claim('b'.repeat(43));
  calls.length = 0;
  assert.equal((await client.detectPart('fuse-box', new Blob(['x']), { consent: DETECTION_CONSENT })).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x.test/v1/part-detections/fuse-box');
  assert.equal(calls[0].init.headers['X-CarScope-External-Processing'], DETECTION_CONSENT);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${'a'.repeat(43)}`);
  for (const [status, wanted] of [[429, 'RATE_LIMITED'], [413, 'TOO_LARGE'], [422, 'UNREADABLE'], [403, 'NOT_CONNECTED'], [503, 'UNAVAILABLE'], [500, 'UNAVAILABLE']]) {
    reply = { status, body: { error: { code: 'x' } } };
    calls.length = 0;
    assert.deepEqual(await client.detectPart('fuse-box', new Blob(['x']), { consent: DETECTION_CONSENT }), { ok: false, code: wanted }, String(status));
    assert.equal(calls.length, 1, `${status}: no retry`);
  }
  reply = { status: 200, body: { nothing: true } };
  assert.equal((await client.detectPart('fuse-box', new Blob(['x']), { consent: DETECTION_CONSENT })).code, 'UNAVAILABLE');
  client.dispose();
  assert.equal((await client.detectPart('fuse-box', new Blob(['x']))).code, 'NOT_CONNECTED');
});

test('no model, key or client is in the service: the gate holds and no variable was added', () => {
  assert.equal(partDetectionGate().status, 'PASS', partDetectionGate().detail);
  assert.equal(environmentGate().status, 'PASS');
  assert.ok(!ALLOWED_ENV.some(name => /ROBOFLOW|DETECT|AI_/.test(name)));
  const closure = importGraph();
  assert.ok(closure.includes('src/part-detection-route.mjs'));
  const route = readFileSync(new URL('../src/part-detection-route.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /writeFile|createWriteStream|appendFile|process\.env|console\.|fetch\(|\.query\(/, 'no file, variable, log, network or database of its own');
  const ui = readFileSync(new URL('../../mobile-ar-poc/public/part-detection-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|getUserMedia|setInterval|requestAnimationFrame|requestVideoFrame|roboflow\.com|api_key|apiKey|detector\.mjs/i, 'no storage, stream, repeated capture, outside address or key');
  assert.deepEqual(readdirSync(new URL('../../mobile-ar-poc/public/', import.meta.url)).filter(name => /\.(onnx|tflite|task|pt|bin)$/.test(name)), [], 'no model file');
});

test('the gate catches every shortcut around staying off', (t) => {
  const copy = () => {
    const root = mkdtempSync(join(tmpdir(), 'carscope-detect-gate-')), tool = join(root, 'tools/inspection-sync-poc');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(tool, { recursive: true });
    for (const dir of ['src', 'bin', 'preflight']) cpSync(join(TOOL_ROOT, dir), join(tool, dir), { recursive: true });
    cpSync(resolve(TOOL_ROOT, '../vision-poc/src'), join(root, 'tools/vision-poc/src'), { recursive: true });
    cpSync(join(TOOL_ROOT, 'package.json'), join(tool, 'package.json'));
    cpSync(resolve(TOOL_ROOT, '../mobile-ar-poc'), join(root, 'tools/mobile-ar-poc'), { recursive: true, filter: from => !/[\\/]node_modules([\\/]|$)/.test(from) });
    return tool;
  };
  const edit = (tool, file, from, to) => { const path = join(tool, file), source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n'); assert.ok(source.includes(from), from); writeFileSync(path, source.replace(from, to)); };
  const CLI = '      enableAvdSimulation,\n    });\n    console.log(enableAvdSimulation';
  const failing = (mutate, pattern) => { const tool = copy(); mutate(tool); const gate = partDetectionGate(tool); assert.equal(gate.status, 'FAIL'); assert.match(gate.detail, pattern); };
  failing(x => edit(x, 'src/render-stateful.mjs', CLI, CLI.replace('enableAvdSimulation,\n', 'enableAvdSimulation, partDetection: {},\n')), /default CLI passes/);
  failing(x => edit(x, 'src/render-stateful.mjs', 'partDetection = null', 'partDetection = {}'), /not off by default/);
  failing(x => appendFileSync(join(x, 'src/render-webxr-experiment.mjs'), '\nexport const on = { partDetection: {} };\n'), /render-webxr-experiment\.mjs passes/);
  failing(x => appendFileSync(join(x, 'src/part-detection-route.mjs'), "\nexport const k = process.env.ROBOFLOW_API_KEY;\n"), /names a model runtime or a key/);
  failing(x => appendFileSync(join(x, 'src/part-detection-route.mjs'), "\nexport const r = 'onnxruntime-node';\n"), /names a model runtime or a key/);
  failing(x => edit(x, 'package.json', '"pg": "8.23.1"', '"pg": "8.23.1", "onnxruntime-node": "1.0.0"'), /runtime dependency/);
  // A variable read in the Render path also fails the existing gate, by name.
  const tool = copy();
  appendFileSync(join(tool, 'src/part-detection-route.mjs'), '\nexport const k = process.env.ROBOFLOW_API_KEY;\n');
  assert.equal(environmentGate(tool).status, 'FAIL');
  assert.match(environmentGate(tool).detail, /ROBOFLOW_API_KEY/);
});

test('the provider fits the real hosted client and parser of tools/vision-poc, with no network', async () => {
  const { inferImage, HOSTED_API_URL } = await import('../../vision-poc/src/roboflow-client.mjs');
  const { parseRoboflowResponse, ROBOFLOW_MODEL_ID } = await import('../../vision-poc/src/roboflow-adapter.mjs');
  assert.equal(DETECTION_MODEL_ID, ROBOFLOW_MODEL_ID);
  const KEY = 'rf_key_only_in_the_header', calls = [];
  let reply = { status: 200, body: { image: { width: 640, height: 480 }, predictions: [
    { x: 100, y: 100, width: 40, height: 40, confidence: 0.8, class: 'Fuse Box', class_id: 16, detection_id: 'a' },
    { x: 200, y: 100, width: 40, height: 40, confidence: 0.9, class: '4', class_id: 40, detection_id: 'b' },
    { x: 300, y: 100, width: 40, height: 40, confidence: 0.95, class: 'Battery', class_id: 41, detection_id: 'c' },
  ] } };
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(reply.body), { status: reply.status }); };
  const provider = hostedDetectionProvider({ apiKey: KEY, parseResponse: parseRoboflowResponse, inferImage: args => inferImage({ ...args, fetchImpl }) });
  const image = jpeg();
  const parsed = await provider.detect({ image });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`${HOSTED_API_URL}/${DETECTION_MODEL_ID}`));
  assert.ok(!calls[0].url.includes(KEY), 'the key is not in the address');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.body, image.toString('base64'));
  assert.deepEqual(candidatesFor('fuse-box', parsed).map(c => c.score), [0.8], 'through the real parser, only this part\'s class');
  for (const status of [401, 403, 402, 429, 500]) {
    reply = { status, body: { message: `refused ${KEY}` } };
    await assert.rejects(provider.detect({ image }), error => !error.message.includes(KEY), String(status));
  }
  reply = { status: 200, body: { predictions: 'nonsense' } };
  await assert.rejects(provider.detect({ image }), /INVALID/);
  // The client stays out of what Render runs today: tests may import it, the service does not.
  assert.ok(!importGraph().some(file => file.includes('vision-poc')));
});
