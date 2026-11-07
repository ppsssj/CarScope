import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATUS, TARGET_CLASS } from '../src/detection-contract.mjs';
import { mergeDuplicates, withAliasCandidates } from '../src/exploratory-alias.mjs';
import { SOURCE_TO_TARGET, interpretRoboflow, otherClasses, parseRoboflowResponse } from '../src/roboflow-adapter.mjs';

const cap = [0.1, 0.1, 0.2, 0.2], elsewhere = [0.6, 0.6, 0.2, 0.2];

// The shape of a real engine-bay-parts/1 answer from run 2: extra fields, and the same cap under a named and a numbered class. Values rounded.
const realShape = {
  inference_id: 'id', time: 0.09, resolved_model: { model_id: 'engine-bay-parts/1', backend: 'onnx', quantization: 'fp32' }, image: { width: 1280, height: 960 },
  predictions: [
    { x: 248, y: 572, width: 90, height: 79, confidence: 0.583, class: '3', class_id: 3, detection_id: 'a' },
    { x: 369, y: 812, width: 90, height: 79, confidence: 0.524, class: 'Windshield Wiper Fluid', class_id: 35, detection_id: 'b' },
    { x: 700, y: 400, width: 200, height: 150, confidence: 0.78, class: 'Battery', class_id: 20, detection_id: 'c' },
  ],
};

test('a real answer parses, and only the named class becomes the target', () => {
  const parsed = parseRoboflowResponse(realShape);
  const { status, candidates } = interpretRoboflow(parsed, { scoreThreshold: 0.5 });
  assert.equal(status, STATUS.CANDIDATES);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].score, 0.524);
  assert.deepEqual(otherClasses(parsed).map(o => o.className), ['3', 'Battery']);
});

test('the reported mapping stays one class: the numbered class is not the target', () => {
  assert.deepEqual(Object.keys(SOURCE_TO_TARGET), ['Windshield Wiper Fluid']);
  assert.notEqual(SOURCE_TO_TARGET['3'], TARGET_CLASS);
});

test('two boxes on one cap merge into the stronger one; separate boxes stay', () => {
  assert.deepEqual(mergeDuplicates([{ box: cap, score: 0.5 }, { box: cap, score: 0.7 }, { box: elsewhere, score: 0.4 }]), [{ box: cap, score: 0.7 }, { box: elsewhere, score: 0.4 }]);
});

test('the alias view adds only that class and leaves the stored result alone', () => {
  const results = { a: { candidates: [], others: [{ className: '3', score: 0.7, box: cap }, { className: 'Battery', score: 0.9, box: elsewhere }] } };
  const view = withAliasCandidates(results, '3');
  assert.deepEqual(view.a.candidates, [{ box: cap, score: 0.7 }]);
  assert.deepEqual(view.a.others.map(o => o.className), ['Battery']);
  assert.equal(results.a.candidates.length, 0, 'the input is not changed');
});

test('the analysis script labels itself as not the reported result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-alias-'));
  try {
    const manifest = await readFile(new URL('../dataset/exploratory-commons.json', import.meta.url), 'utf8'), images = JSON.parse(manifest).images;
    const results = path.join(dir, 'r.json');
    await writeFile(results, JSON.stringify({ modelId: 'engine-bay-parts/1', results: Object.fromEntries(images.map(i => [i.id, { candidates: [], others: i.labels.map(l => ({ className: '3', score: 0.9, box: l.box })) }])) }));
    const script = fileURLToPath(new URL('../scripts/exploratory-alias-analysis.mjs', import.meta.url)), manifestPath = fileURLToPath(new URL('../dataset/exploratory-commons.json', import.meta.url));
    const r = spawnSync(process.execPath, [script, manifestPath, results, '--alias', '3'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const output = JSON.parse(r.stdout);
    assert.equal(output.analysis, 'ALIAS_SENSITIVITY_NOT_THE_REPORTED_RESULT');
    assert.equal(output.metrics.tp, images.filter(i => i.labels.length).length);
    assert.equal(spawnSync(process.execPath, [script, manifestPath, results], { encoding: 'utf8' }).status, 64, '--alias is required');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
