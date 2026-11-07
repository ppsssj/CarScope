import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DATASET_GATE, DATASET_STATUS, validateDataset } from '../src/dataset.mjs';
import { EVALUATION_TYPE, OPERATING_POINTS, RELIABILITY_BAR, VERDICT, casesAt, confuserCheck, isTargetLabel, localizationCheck, nonMaxSuppress, scoreAt, subsets, targetPredictions, verdictFor, wilson } from '../src/zero-shot-evaluate.mjs';

const cap = [0.1, 0.1, 0.2, 0.2], far = [0.6, 0.6, 0.2, 0.2], tiny = [0.1, 0.1, 0.04, 0.04];
const image = (id, overrides = {}) => ({ id, split: 'exploratory', vehicle: { make: 'M', model: 'X' }, conditions: {}, confusers: [], labels: [{ box: cap, capColor: 'blue' }], ...overrides });

test('only a label naming the washer counts; a partial phrase does not', () => {
  for (const label of ['windshield washer fluid cap', 'Washer fluid cap', 'windshield']) assert.ok(isTargetLabel(label), label);
  for (const label of ['fluid cap', 'cap', 'radiator coolant cap', 'brake fluid cap', 'engine oil cap', '', null, undefined, 'dishwashers']) assert.ok(!isTargetLabel(label), String(label));
  assert.ok(!isTargetLabel('windshield washer fluid cap radiator coolant cap brake fluid cap engine oil cap'), 'a phrase that merged every prompt names no single part');
});

test('duplicate boxes merge to the strongest; boxes apart stay', () => {
  assert.deepEqual(nonMaxSuppress([{ box: cap, score: 0.2 }, { box: cap, score: 0.6 }, { box: far, score: 0.3 }]).map(p => p.score), [0.6, 0.3]);
});

test('a coolant label on a box is dropped before scoring', () => {
  assert.deepEqual(targetPredictions([{ label: 'radiator coolant cap', box: cap, score: 0.9 }, { label: 'windshield washer fluid cap', box: far, score: 0.2 }]).map(p => p.score), [0.2]);
});

test('thresholds filter and a missing result stops the evaluation', () => {
  const images = [image('a')], rows = { a: [{ box: cap, score: 0.4 }] };
  assert.deepEqual((({ tp, fn }) => [tp, fn])(scoreAt({ images, predictionsById: rows, threshold: 0.3 })), [1, 0]);
  assert.deepEqual((({ tp, fn }) => [tp, fn])(scoreAt({ images, predictionsById: rows, threshold: 0.5 })), [0, 1]);
  assert.throws(() => scoreAt({ images, predictionsById: {}, threshold: 0.3 }), /a failed run is not an empty result/);
});

test('the colour rule has no score, so threshold null keeps every box and AP is not applicable', () => {
  const r = scoreAt({ images: [image('a')], predictionsById: { a: [{ box: cap, score: null }] }, threshold: null });
  assert.equal(r.tp, 1);
  assert.equal(r.ap50, 'NOT_APPLICABLE');
});

test('localization separates "did not see it" from "saw it and named it wrong"', () => {
  const images = [image('named'), image('wrong'), image('blind')];
  const all = { named: [{ label: 'windshield washer fluid cap', box: cap, score: 0.5 }], wrong: [{ label: 'radiator coolant cap', box: cap, score: 0.7 }], blind: [{ label: 'windshield washer fluid cap', box: far, score: 0.9 }] };
  assert.deepEqual(localizationCheck({ images, allPredictionsById: all, threshold: 0.3 }).map(r => [r.id, r.boxOnCap, r.namedAsTarget]), [['named', true, true], ['wrong', true, false], ['blind', false, false]]);
});

test('a confuser reports what the model called it', () => {
  const images = [image('a', { labels: [], confusers: [{ kind: 'brake-fluid-cap', box: cap }] })];
  assert.deepEqual(confuserCheck({ images, allPredictionsById: { a: [{ label: 'windshield washer fluid cap', box: cap, score: 0.8 }] }, threshold: 0.3 })[0], { id: 'a', kind: 'brake-fluid-cap', seen: true, topLabel: 'windshield washer fluid cap', calledTarget: true });
});

test('black and small caps are picked by the label, not the result', () => {
  const images = [image('black', { labels: [{ box: cap, capColor: 'black' }] }), image('small', { labels: [{ box: tiny, capColor: 'blue' }] }), image('plain')];
  assert.deepEqual(subsets.black(images).map(i => i.id), ['black']);
  assert.deepEqual(subsets.small(images).map(i => i.id), ['small']);
  assert.equal(casesAt({ images: [images[1]], predictionsById: { small: [] }, threshold: 0.1 })[0].small, true);
});

function verdict(found, extra = {}) {
  const images = [image('black', { labels: [{ box: cap, capColor: 'black' }] }), ...['a', 'b', 'c', 'd'].map(id => image(id)), ...(extra.images ?? [])];
  const rows = Object.fromEntries(images.map(i => [i.id, found.includes(i.id) ? [{ box: cap, score: 0.9 }] : []]));
  Object.assign(rows, extra.rows);
  const metrics = scoreAt({ images, predictionsById: rows, threshold: 0.3 });
  return verdictFor(metrics, images, rows, 0.3);
}

test('finding everything earns only "worth a larger evaluation", never success', () => {
  assert.equal(verdict(['black', 'a', 'b', 'c', 'd']).verdict, VERDICT.WORTH_LARGER_EVALUATION);
  assert.deepEqual(Object.values(VERDICT).filter(v => /SUCCESS|PASS/.test(v)), []);
});

test('a miss below the recall bar is not reliable', () => {
  const r = verdict(['black', 'a', 'b']);
  assert.equal(r.verdict, VERDICT.NOT_RELIABLE);
  assert.equal(r.checks.recall, false);
});

test('missing the black cap alone is not reliable, even at recall 0.8', () => {
  const r = verdict(['a', 'b', 'c', 'd']);
  assert.equal(r.checks.recall, true);
  assert.equal(r.checks.blackCap, false);
  assert.equal(r.verdict, VERDICT.NOT_RELIABLE);
});

test('one washer label on a coolant cap is not reliable', () => {
  const coolant = image('coolant', { labels: [], confusers: [{ kind: 'coolant-cap', box: far }] });
  const r = verdict(['black', 'a', 'b', 'c', 'd'], { images: [coolant], rows: { coolant: [{ box: far, score: 0.9 }] } });
  assert.equal(r.checks.confusers, false);
  assert.equal(r.verdict, VERDICT.NOT_RELIABLE);
});

test('low precision alone is not reliable', () => {
  const rows = { black: [{ box: cap, score: 0.9 }, { box: far, score: 0.9 }], a: [{ box: cap, score: 0.9 }, { box: far, score: 0.9 }], b: [{ box: cap, score: 0.9 }], c: [{ box: cap, score: 0.9 }], d: [{ box: cap, score: 0.9 }] };
  const r = verdict([], { rows });
  assert.equal(r.checks.precision, false, 'precision 5/7');
  assert.equal(r.verdict, VERDICT.NOT_RELIABLE);
});

test('the bar and the operating points are the ones fixed before the run', () => {
  assert.deepEqual({ ...RELIABILITY_BAR }, { minRecall: 0.8, minPrecision: 0.8, blackCapDetected: true, confuserFalsePositives: 0 });
  assert.deepEqual({ ...OPERATING_POINTS }, { owlv2: 0.1, 'grounding-dino-tiny': 0.3, 'omdet-turbo': 0.3 });
});

test('the prompts are the ones fixed before the run', async () => {
  const { modes } = JSON.parse(await readFile(new URL('../zero-shot/zero_shot_prompts.json', import.meta.url), 'utf8'));
  assert.deepEqual(modes, { contrast: ['windshield washer fluid cap', 'radiator coolant cap', 'brake fluid cap', 'engine oil cap'], single: ['windshield washer fluid cap'], generic: ['cap'] });
});

test('the formal gate is separate and unchanged: exploratory photos cannot pass it', () => {
  assert.equal(EVALUATION_TYPE, 'EXPLORATORY_EVALUATION');
  assert.equal(DATASET_GATE.positiveImages, 300);
  assert.equal(DATASET_GATE.testPositiveImages, 60);
  const rows = Array.from({ length: 500 }, (_, n) => image(`x${n}`));
  assert.equal(validateDataset({ images: rows }).status, DATASET_STATUS.INVALID);
});

test('the Wilson interval matches a hand-worked case', () => {
  const [low, high] = wilson(54, 60);
  assert.ok(Math.abs(low - 0.7985) < 0.001 && Math.abs(high - 0.9534) < 0.001);
  assert.equal(wilson(0, 0), null);
});

test('no weight, image or runtime file is tracked by this PoC', async () => {
  const ignored = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  for (const pattern of ['*.jpg', '*.png', '*.tflite']) assert.ok(ignored.includes(pattern), pattern);
  const script = await readFile(new URL('../zero-shot/run_zero_shot.py', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /\.train\(|optimizer|backward\(/, 'no training');
});
