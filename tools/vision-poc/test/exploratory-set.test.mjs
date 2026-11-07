// The committed exploratory manifest: real rights records and labels, no image bytes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DATASET_STATUS, validateDataset } from '../src/dataset.mjs';
import { EXPLORATORY_STATUS, buildExploratoryReport, validateExploratorySet } from '../src/exploratory.mjs';

const manifest = JSON.parse(await readFile(new URL('../dataset/exploratory-commons.json', import.meta.url), 'utf8'));

test('the set is valid for exploration and says what it is', () => {
  const result = validateExploratorySet(manifest);
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, EXPLORATORY_STATUS.READY);
  assert.equal(manifest.evaluationType, 'EXPLORATORY_EVALUATION');
  assert.match(manifest.note, /not been reviewed by a person/);
});

test('it can never stand in for the formal dataset, even if its images were relabelled as a test split', () => {
  assert.equal(validateDataset(manifest).status, DATASET_STATUS.INVALID);
  assert.notEqual(validateDataset({ images: manifest.images.map(i => ({ ...i, split: 'test' })) }).status, DATASET_STATUS.READY);
});

test('every photo has a source page on Commons, a labelled cap rests on the visible symbol, and nothing depends on colour', () => {
  for (const image of manifest.images) {
    assert.match(image.license.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, image.id);
    assert.match(image.downloadUrl, /^https:\/\/(upload|thumb)\.wikimedia\.org\//, image.id);
    for (const label of image.labels) assert.equal(label.truth, 'SYMBOL_VISIBLE', image.id);
  }
  assert.ok(manifest.images.some(i => i.labels.some(l => l.capColor === 'black')), 'at least one cap that is not blue');
  assert.ok(manifest.images.some(i => !i.labels.length && i.confusers.some(c => c.kind === 'brake-fluid-cap')), 'a brake fluid photo without the target');
  assert.ok(manifest.images.some(i => i.confusers.some(c => c.kind === 'coolant-cap')), 'a coolant cap next to the target');
});

test('a heuristic result without scores is reported without any threshold', () => {
  const predictions = Object.fromEntries(manifest.images.map(i => [i.id, { candidates: i.labels.map(l => ({ box: l.box, score: null })) }]));
  const report = buildExploratoryReport({ manifest, modelId: 'blue-component-heuristic', predictions, scoreThreshold: 0.5 });
  assert.equal(report.metrics.tp, manifest.images.filter(i => i.labels.length).length);
  assert.equal(report.metrics.ap50, 'NOT_APPLICABLE');
  assert.equal(report.preliminary, true);
});

test('no image is tracked under this tool', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tracked = execFileSync('git', ['ls-files', '.'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  assert.deepEqual(tracked.filter(f => /\.(jpe?g|png|webp|heic|tflite|task|onnx|pt|key)$/i.test(f)), []);
});
