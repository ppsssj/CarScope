// P12-F: the local experiment entrypoint with a fake fetch. No network, no real key, so this says nothing about the model. The real run is in docs/evidence/p12-f.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readKeyFile, startLocalDetection } from '../../vision-poc/scripts/part-detection-local.mjs';
import { DETECTION_CONSENT, DETECTION_MODEL_ID } from '../../mobile-ar-poc/public/part-detection.mjs';
import { ReceiverClient } from '../bin/receiver.mjs';
import { importGraph, partDetectionGate } from '../preflight/static-gates.mjs';

const KEY = 'rf_local_key_must_stay_on_the_server';
const jpeg = (width = 640, height = 480) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]);
const REAL_SHAPE = { inference_id: 'x', time: 0.03, image: { width: 640, height: 480 }, predictions: [
  { x: 100, y: 120, width: 40, height: 60, confidence: 0.8, class: 'Fuse Box', class_id: 16, detection_id: 'a' },
  { x: 300, y: 100, width: 40, height: 40, confidence: 0.95, class: 'Battery', class_id: 41, detection_id: 'c' },
] };

async function setup(t, { reply = () => new Response(JSON.stringify(REAL_SHAPE), { status: 200 }), limits, seed = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'p12f-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'key'), ledgerFile = join(dir, 'calls.json');
  writeFileSync(keyFile, `${KEY}\n`);
  if (seed) writeFileSync(ledgerFile, JSON.stringify({ limit: 20, calls: Array.from({ length: seed }, (_, i) => ({ n: i + 1 })) }));
  const calls = [];
  let now = Date.now();
  const s = await startLocalDetection({ keyFile, ledgerFile, purpose: 'test', limits, now: () => now, env: {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(); } });
  t.after(() => s.stop());
  const token = async () => {
    now += 61_000;
    const created = await new ReceiverClient({ baseUrl: s.url }).create('fuse-box');
    const claim = await (await fetch(`${s.url}/v1/claim`, { method: 'POST', headers: { Authorization: `Bearer ${created.fragment.split('invite=')[1]}` } })).json();
    return claim.submitToken;
  };
  const post = async (image = jpeg()) => fetch(`${s.url}/v1/part-detections/fuse-box`, { method: 'POST', body: image, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'image/jpeg', 'X-CarScope-External-Processing': DETECTION_CONSENT } });
  return { s, calls, post, ledgerFile };
}

test('one photo goes out once with the key in a header, and only this part comes back, with what later tracking needs', async (t) => {
  const { s, calls, post, ledgerFile } = await setup(t);
  const before = Date.now();
  const r = await post();
  const text = await r.text(), body = JSON.parse(text);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!calls[0].url.includes(KEY));
  assert.ok(calls[0].url.includes(DETECTION_MODEL_ID));
  assert.ok(!text.includes(KEY));
  assert.deepEqual(body.candidates, [{ score: 0.8, box: [80 / 640, 90 / 480, 40 / 640, 60 / 480] }]);
  assert.equal(body.detection.modelId, DETECTION_MODEL_ID);
  assert.equal(body.detection.modelClass, 'Fuse Box');
  assert.equal(body.detection.coordinates, 'normalized-top-left-xywh');
  assert.deepEqual(body.detection.image, { width: 640, height: 480 });
  assert.ok(Date.parse(body.detection.inferredAt) >= before - 1000 && Date.parse(body.detection.inferredAt) <= Date.now() + 1000);
  assert.equal(s.timings.length, 1);
  assert.deepEqual(Object.keys(s.timings[0]).sort(), ['base64Bytes', 'imageBytes', 'parseMs', 'predictions', 'roundTripMs', 'status']);
  const ledger = readFileSync(ledgerFile, 'utf8');
  assert.equal(JSON.parse(ledger).calls.length, 1);
  assert.ok(!ledger.includes(KEY));
  assert.ok(!JSON.stringify(s.timings).includes(KEY));
});

test('an upstream refusal, outage, bad answer or wrong shape is one fixed answer, with no key and no upstream text', async (t) => {
  for (const reply of [
    () => new Response(`refused ${KEY}`, { status: 401 }), () => new Response('no credit', { status: 402 }), () => new Response('slow down', { status: 429 }), () => new Response('down', { status: 500 }),
    () => new Response('not json', { status: 200 }), () => new Response(JSON.stringify({ predictions: 'x' }), { status: 200 }),
    () => { throw new Error(`socket ${KEY}`); },
    () => new Response(JSON.stringify({ ...REAL_SHAPE, image: { width: 480, height: 640 } }), { status: 200 }),
  ]) {
    const { post } = await setup(t, { reply });
    const r = await post();
    const text = await r.text();
    assert.equal(r.status, 503, text);
    assert.equal(JSON.parse(text).error.code, 'PART_DETECTION_UNAVAILABLE');
    assert.ok(!text.includes(KEY));
  }
});

test('a hanging upstream ends at the limit', async (t) => {
  const { post } = await setup(t, { reply: () => new Promise(() => {}), limits: { maxBytes: 1 << 20, maxSide: 2048, minSide: 64, timeoutMs: 50, maxInFlight: 2 } });
  assert.equal((await post()).status, 503);
});

test('at the call limit nothing goes out, and the page gets the same fixed answer', async (t) => {
  const { calls, post, ledgerFile } = await setup(t, { seed: 20 });
  assert.equal((await post()).status, 503);
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(readFileSync(ledgerFile, 'utf8')).calls.length, 20);
});

test('it refuses to start outside a local experiment', () => {
  assert.throws(() => readKeyFile('x', { RENDER: 'true' }), /LOCAL_EXPERIMENT_ONLY/);
  assert.throws(() => readKeyFile(undefined, {}), /KEY_FILE_REQUIRED/);
  assert.throws(() => readKeyFile(resolve(import.meta.dirname, 'roboflow.key'), {}), /KEY_FILE_INSIDE_REPOSITORY/);
});

test('the entrypoint stays out of what Render runs, and the off gate still holds', () => {
  assert.equal(partDetectionGate().status, 'PASS', partDetectionGate().detail);
  for (const file of importGraph()) assert.ok(!/vision-poc|part-detection-local|call-ledger/.test(file), file);
  for (const file of ['src/render-stateful.mjs', 'src/render-webxr-experiment.mjs', 'src/render-avd-history-demo.mjs']) assert.ok(!readFileSync(resolve(import.meta.dirname, '..', file), 'utf8').includes('part-detection-local'), file);
});
