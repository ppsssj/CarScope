import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DATASET_GATE, DATASET_STATUS, validateDataset } from '../src/dataset.mjs';
import { EVALUATION_TYPE, EXPLORATORY_STATUS, buildExploratoryReport, validateExploratorySet, wilson } from '../src/exploratory.mjs';
import { CALL_STATUS, classifyHttpStatus, inferImage, stopsTheRun } from '../src/roboflow-client.mjs';

const script = name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const cap = [0.1, 0.1, 0.2, 0.2], far = [0.6, 0.6, 0.2, 0.2];
let serial = 0;
function image(overrides = {}) {
  const n = ++serial;
  return {
    id: `x-${n}`, file: `x-${n}.jpg`, sha256: createHash('sha256').update(`f${n}`).digest('hex'), dhash: createHash('sha256').update(`d${n}`).digest('hex').slice(0, 16), split: 'exploratory',
    license: { id: 'CC-BY-SA-4.0', source: 'https://commons.wikimedia.org/wiki/File:x', attribution: 'Author' },
    vehicle: { make: 'Toyota', model: 'Corolla', groupId: `v-${n}`, verifiedBy: 'SOURCE_PAGE' }, captureSessionId: `s-${n}`, privacyReviewed: true,
    conditions: { lighting: 'daylight', angle: 'top', distance: 'wide', occlusion: 'none', reflection: 'none' },
    labels: [{ class: 'washer-fluid-cap', box: cap, truth: 'SYMBOL_VISIBLE', capColor: 'blue' }], confusers: [], ...overrides,
  };
}

test('DATASET_GATE stays the formal bar: its numbers are unchanged', () => {
  assert.deepEqual({ ...DATASET_GATE }, { vehicles: 30, makes: 5, positiveImages: 300, nonBlueTargetImages: 30, hardNegativeImages: 150, testPositiveImages: 60, testVehicles: 6, testIoniq5PositiveImages: 10, testConfusersPerKind: 20, testPositivesPerHardCondition: 15 });
});

test('an exploratory set can never pass the formal gate, at any size', () => {
  const images = Array.from({ length: 600 }, () => image({ license: { id: 'CC0-1.0', source: 'x' } }));
  assert.equal(validateExploratorySet({ images }).status, EXPLORATORY_STATUS.READY);
  assert.equal(validateDataset({ images }).status, DATASET_STATUS.INVALID);
});

test('share-alike is accepted only on the exploratory path', () => {
  const sa = image();
  assert.equal(validateExploratorySet({ images: [sa] }).status, EXPLORATORY_STATUS.READY);
  assert.ok(validateDataset({ images: [{ ...sa, split: 'test' }] }).errors.some(e => /CC-BY-SA-4.0 is not allowed/.test(e)));
});

test('rights are still checked: unknown, non-commercial, and missing attribution or source are refused', () => {
  for (const license of [undefined, { id: 'UNKNOWN', source: 'x' }, { id: 'MIT', source: 'x' }, { id: 'CC-BY-NC-4.0', source: 'x', attribution: 'a' }, { id: 'CC-BY-3.0', source: 'x' }, { id: 'CC-BY-3.0', attribution: 'a' }]) {
    assert.equal(validateExploratorySet({ images: [image({ license })] }).status, EXPLORATORY_STATUS.INVALID, JSON.stringify(license));
  }
  assert.equal(validateExploratorySet({ images: [] }).status, EXPLORATORY_STATUS.EMPTY);
  assert.equal(validateExploratorySet({ images: [image({ split: 'test' })] }).status, EXPLORATORY_STATUS.INVALID);
  const twin = image();
  assert.ok(validateExploratorySet({ images: [twin, { ...twin, id: 'other' }] }).errors.includes('the same file appears twice'));
});

test('the Wilson interval matches a hand-worked case', () => {
  const [low, high] = wilson(54, 60);
  assert.ok(Math.abs(low - 0.7985) < 0.001 && Math.abs(high - 0.9534) < 0.001, `${low} ${high}`);
  assert.equal(wilson(0, 0), null);
});

test('the report says it is preliminary, gives intervals, and sorts each photo into detected, missed or confused', () => {
  const hit = image(), miss = image(), big = image(), confused = image({ labels: [], confusers: [{ kind: 'coolant-cap', box: cap }] }), clean = image({ labels: [] });
  const report = buildExploratoryReport({
    manifest: { images: [hit, miss, big, confused, clean] }, modelId: 'engine-bay-parts/1', scoreThreshold: 0.5,
    predictions: {
      [hit.id]: { candidates: [{ box: cap, score: 0.9 }, { box: far, score: 0.2 }] },
      [miss.id]: { candidates: [], others: [{ className: 'Coolant', score: 0.7, box: far }] },
      [big.id]: { candidates: [{ box: [0, 0, 1, 1], score: 0.6 }] },
      [confused.id]: { candidates: [{ box: cap, score: 0.8 }] },
      [clean.id]: { candidates: [] },
    },
  });
  assert.equal(report.evaluationType, EVALUATION_TYPE);
  assert.equal(report.preliminary, true);
  assert.equal(report.formalEvaluation, 'NOT_MEASURED');
  assert.ok(report.limits.includes('PRELIMINARY_NOT_A_FORMAL_METRIC') && report.limits.includes('TRAINING_SET_OVERLAP_UNKNOWN'));
  assert.deepEqual([report.metrics.tp, report.metrics.fp, report.metrics.fn], [1, 2, 2]);
  assert.deepEqual(report.metrics.confuserFalsePositives, { 'coolant-cap': [confused.id] });
  assert.ok(report.metrics.recall95[0] < 1 / 3 && report.metrics.recall95[1] > 1 / 3);
  const outcome = id => report.cases.find(c => c.id === id).outcome;
  assert.deepEqual(outcome(hit.id), ['DETECTED'], 'the 0.2 box is under the threshold');
  assert.deepEqual(outcome(miss.id), ['MISSED']);
  assert.deepEqual(outcome(big.id), ['MISSED', 'FALSE_POSITIVE']);
  assert.deepEqual(outcome(confused.id), ['CONFUSED_WITH_OTHER_PART']);
  assert.deepEqual(outcome(clean.id), ['NOTHING_REPORTED']);
  assert.deepEqual(report.cases.find(c => c.id === miss.id).otherClasses.map(o => o.className), ['Coolant']);
  assert.equal(report.cases.find(c => c.id === big.id).capInsideBox, true, 'a large box around the cap is told apart from a wrong place');
  assert.deepEqual([report.auxiliary.capInsideAnyPredictedBox, report.auxiliary.targetImages], [2, 3]);
});

test('a failed call is not an empty result: the report refuses to run', () => {
  const a = image();
  assert.throws(() => buildExploratoryReport({ manifest: { images: [a] }, modelId: 'm', predictions: {}, scoreThreshold: 0.5 }), /a failed call is not an empty result/);
});

test('HTTP answers: a refusal stops the run so no further calls are spent', () => {
  assert.equal(classifyHttpStatus(200), CALL_STATUS.OK);
  for (const code of [401, 403]) assert.equal(classifyHttpStatus(code), CALL_STATUS.BLOCKED_AUTH_REJECTED);
  for (const code of [402, 429]) assert.equal(classifyHttpStatus(code), CALL_STATUS.BLOCKED_RATE_OR_CREDIT);
  assert.equal(classifyHttpStatus(500), CALL_STATUS.FAILED);
  assert.ok(stopsTheRun(CALL_STATUS.BLOCKED_AUTH_REJECTED) && stopsTheRun(CALL_STATUS.BLOCKED_RATE_OR_CREDIT) && !stopsTheRun(CALL_STATUS.FAILED));
});

test('the client sends the key only as a header, and a network error does not leak it', async () => {
  const SECRET = 'SECRET-KEY-VALUE';
  let seen;
  const ok = await inferImage({ modelId: 'engine-bay-parts/1', apiKey: SECRET, image: Buffer.from('img'), fetchImpl: async (url, init) => { seen = { url, init }; return new Response('{"a":1}', { status: 200 }); } });
  assert.equal(ok.status, CALL_STATUS.OK);
  assert.equal(seen.url, 'https://serverless.roboflow.com/engine-bay-parts/1?confidence=0.05');
  assert.ok(!seen.url.includes(SECRET));
  assert.equal(seen.init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(seen.init.body, Buffer.from('img').toString('base64'));
  const failed = await inferImage({ modelId: 'm/1', apiKey: SECRET, image: Buffer.from('x'), fetchImpl: async () => { throw new TypeError(`failed for ${SECRET}`); } });
  assert.deepEqual(failed, { status: CALL_STATUS.FAILED, error: 'TypeError' });
});

test('without a key the script makes no call and says BLOCKED_API_KEY_REQUIRED', () => {
  const env = { ...process.env }; delete env.ROBOFLOW_API_KEY; delete env.ROBOFLOW_API_KEY_FILE;
  const r = spawnSync(process.execPath, [script('roboflow-infer.mjs'), 'none.json', 'none', 'out.json'], { encoding: 'utf8', env });
  assert.equal(r.status, 3);
  const output = JSON.parse(r.stdout);
  assert.equal(output.status, CALL_STATUS.BLOCKED_API_KEY_REQUIRED);
  assert.equal(output.calls, 0);
});

test('a key file inside the repository is refused', async () => {
  const env = { ...process.env, ROBOFLOW_API_KEY_FILE: script('roboflow-infer.mjs') }; delete env.ROBOFLOW_API_KEY;
  const r = spawnSync(process.execPath, [script('roboflow-infer.mjs'), 'none.json', 'none', 'out.json'], { encoding: 'utf8', env });
  assert.equal(r.status, 64);
  assert.equal(JSON.parse(r.stdout).status, 'KEY_FILE_INSIDE_REPOSITORY');
});

async function withDataset(images, body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-rf-'));
  try {
    for (const item of images) { await writeFile(path.join(dir, item.file), item.file); item.sha256 = createHash('sha256').update(item.file).digest('hex'); }
    const manifest = path.join(dir, 'manifest.json'); await writeFile(manifest, JSON.stringify({ images }));
    await body(dir, manifest);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function fakeEndpoint(answer) {
  const seen = [], server = createServer((request, response) => {
    let data = ''; request.on('data', c => { data += c; }); request.on('end', () => {
      seen.push({ url: request.url, auth: request.headers.authorization, data });
      const { status, json } = answer(seen.length);
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(json));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
const runScript = (args, env) => new Promise(resolve => {
  const child = spawn(process.execPath, [script('roboflow-infer.mjs'), ...args], { env }); let stdout = '', stderr = '';
  child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
  child.on('close', status => resolve({ status, stdout, stderr }));
});

test('end to end against a local endpoint: results are mapped, the key appears nowhere, and the report reads them', async () => {
  const KEY = 'TOPSECRETKEY12345', images = [image(), image({ labels: [] })];
  const endpoint = await fakeEndpoint(n => ({ status: 200, json: { image: { width: 100, height: 100 }, predictions: n === 1 ? [{ x: 20, y: 20, width: 20, height: 20, confidence: 0.9, class: 'Windshield Wiper Fluid' }, { x: 70, y: 70, width: 10, height: 10, confidence: 0.95, class: 'Coolant' }] : [] } }));
  try {
    await withDataset(images, async (dir, manifest) => {
      const out = path.join(dir, 'results.json');
      const r = await runScript([manifest, dir, out, '--api-url', endpoint.url], { ...process.env, ROBOFLOW_API_KEY: KEY });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(endpoint.seen.length, 2);
      assert.equal(endpoint.seen[0].auth, `Bearer ${KEY}`);
      const saved = await readFile(out, 'utf8');
      for (const text of [saved, r.stdout, r.stderr, endpoint.seen[0].url]) assert.ok(!text.includes(KEY));
      const results = JSON.parse(saved);
      assert.equal(results.endpoint, 'SELF_HOSTED');
      assert.deepEqual(results.results[images[0].id].candidates, [{ box: [0.1, 0.1, 0.2, 0.2], score: 0.9 }]);
      assert.equal(results.results[images[0].id].others[0].className, 'Coolant');
      const evaluation = spawnSync(process.execPath, [script('exploratory-evaluate.mjs'), manifest, out], { encoding: 'utf8' });
      assert.equal(evaluation.status, 0, evaluation.stdout);
      const report = JSON.parse(evaluation.stdout);
      assert.equal(report.evaluationType, EVALUATION_TYPE);
      assert.deepEqual([report.metrics.tp, report.metrics.fp, report.metrics.fn], [1, 0, 0]);
    });
  } finally { await endpoint.close(); }
});

test('a rejected key stops after the first call, and results stay incomplete', async () => {
  const endpoint = await fakeEndpoint(() => ({ status: 401, json: { message: 'Unauthorized api_key' } }));
  try {
    await withDataset([image(), image(), image()], async (dir, manifest) => {
      const r = await runScript([manifest, dir, path.join(dir, 'r.json'), '--api-url', endpoint.url], { ...process.env, ROBOFLOW_API_KEY: 'k' });
      assert.equal(r.status, 3);
      assert.equal(JSON.parse(r.stdout).status, CALL_STATUS.BLOCKED_AUTH_REJECTED);
      assert.equal(endpoint.seen.length, 1);
      const evaluation = spawnSync(process.execPath, [script('exploratory-evaluate.mjs'), manifest, path.join(dir, 'r.json')], { encoding: 'utf8' });
      assert.equal(evaluation.status, 2);
      assert.equal(JSON.parse(evaluation.stdout).metrics, 'NOT_MEASURED');
    });
  } finally { await endpoint.close(); }
});

test('an owner photo goes to the hosted API only with consent, and a call limit is enforced', async () => {
  const owner = image({ license: { id: 'OWNER_CONSENT', consentRecord: 'c-1' } });
  await withDataset([owner], async (dir, manifest) => {
    const r = await runScript([manifest, dir, path.join(dir, 'r.json')], { ...process.env, ROBOFLOW_API_KEY: 'k' });
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).status, 'HOSTED_UPLOAD_NOT_CONSENTED');
  });
  await withDataset([image(), image()], async (dir, manifest) => {
    const r = await runScript([manifest, dir, path.join(dir, 'r.json'), '--max-calls', '1'], { ...process.env, ROBOFLOW_API_KEY: 'k' });
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).status, 'TOO_MANY_CALLS');
  });
});

test('no results file means NOT_MEASURED', async () => {
  await withDataset([image()], async (dir, manifest) => {
    const r = spawnSync(process.execPath, [script('exploratory-evaluate.mjs'), manifest, path.join(dir, 'absent.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    const output = JSON.parse(r.stdout);
    assert.deepEqual([output.status, output.metrics], [EXPLORATORY_STATUS.NOT_RUN, 'NOT_MEASURED']);
  });
});

test('the API key has no place in tracked configuration', async () => {
  const ignored = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignored, /\*\.key/);
  assert.match(ignored, /\.env/);
});
