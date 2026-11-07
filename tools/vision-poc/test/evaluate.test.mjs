// Every expected value here was worked out by hand from the boxes and scores in the test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOT_APPLICABLE, NOT_MEASURED, averagePrecision, evaluate, iou, notMeasuredReport } from '../src/evaluate.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const box = [0.1, 0.1, 0.2, 0.2], far = [0.6, 0.6, 0.2, 0.2];
const img = (id, labels = [box], extra = {}) => ({ id, labels: labels.map(b => ({ box: b })), confusers: [], conditions: {}, ...extra });

test('IoU: identical, separate, touching and half-overlapping boxes', () => {
  near(iou(box, box), 1);
  near(iou(box, far), 0);
  near(iou([0, 0, 1, 1], [1, 0, 1, 1]), 0);
  near(iou([0, 0, 2, 2], [1, 0, 2, 2]), 2 / 6); // shared 2, union 6
});

test('the 0.5 boundary counts as a match and just below does not', () => {
  const half = [0.1, 0.1, 0.1, 0.2]; // Inside the label with half its area: IoU exactly 0.5.
  near(iou(box, half), 0.5);
  assert.equal(evaluate({ images: [img('a')], predictions: { a: [{ box: half, score: 0.9 }] } }).tp, 1);
  assert.equal(evaluate({ images: [img('a')], predictions: { a: [{ box: [0.1, 0.1, 0.099, 0.2], score: 0.9 }] } }).tp, 0);
});

test('precision, recall and AP on a hand-computed ranking', () => {
  // Ranked: 0.9 TP, 0.8 FP, 0.7 TP; 3 labels, 1 missed.
  const full = evaluate({ images: [img('a'), img('b'), img('c')], predictions: { a: [{ box, score: 0.9 }, { box: far, score: 0.8 }], b: [{ box, score: 0.7 }], c: [] } });
  assert.deepEqual([full.tp, full.fp, full.fn], [2, 1, 1]);
  near(full.precision, 2 / 3);
  near(full.recall, 2 / 3);
  near(full.ap50, (1 / 3) * 1 + (1 / 3) * (2 / 3)); // Interpolated precision 1 up to recall 1/3, then 2/3 up to recall 2/3.
  near(full.map50, full.ap50);
});

test('interpolation takes the best precision at or beyond each recall', () => {
  // FP, TP, TP with 2 labels: precisions 0, 1/2, 2/3, interpolated to 2/3 for the whole curve.
  near(averagePrecision([{ matched: false }, { matched: true }, { matched: true }], 2), 2 / 3);
  assert.equal(averagePrecision([], 0), null);
  near(averagePrecision([], 2), 0);
});

test('matching is one to one: a second box on the same cap is a false positive', () => {
  const r = evaluate({ images: [img('a')], predictions: { a: [{ box, score: 0.6 }, { box, score: 0.9 }] } });
  assert.deepEqual([r.tp, r.fp, r.fn], [1, 1, 0]);
});

test('a detection on another fluid cap is reported by kind, apart from other false positives', () => {
  const coolant = [0.5, 0.1, 0.2, 0.2], brake = [0.5, 0.5, 0.2, 0.2];
  const image = img('a', [box], { confusers: [{ kind: 'coolant-cap', box: coolant }, { kind: 'brake-fluid-cap', box: brake }] });
  const negative = img('n', [], { confusers: [{ kind: 'coolant-cap', box: coolant }] });
  const r = evaluate({ images: [image, negative], predictions: { a: [{ box: coolant, score: 0.9 }, { box: [0.1, 0.7, 0.1, 0.1], score: 0.8 }], n: [{ box: coolant, score: 0.7 }] } });
  assert.deepEqual(r.confuserFalsePositives, { 'coolant-cap': ['a', 'n'] });
  assert.deepEqual(r.otherFalsePositives, ['a']);
  assert.deepEqual(r.missedImages, ['a']);
});

test('results are split by lighting, angle and occlusion without mixing them', () => {
  const images = [img('day', [box], { conditions: { lighting: 'daylight', occlusion: 'none' } }), img('dark', [box], { conditions: { lighting: 'low-light', occlusion: 'partial' } })];
  const r = evaluate({ images, predictions: { day: [{ box, score: 0.9 }], dark: [] } });
  assert.deepEqual([r.strata.lighting.daylight.recall, r.strata.lighting['low-light'].recall], [1, 0]);
  assert.deepEqual([r.strata.occlusion.none.tp, r.strata.occlusion.partial.fn], [1, 1]);
});

test('no predictions: precision is undefined rather than zero or one, and recall is zero', () => {
  const r = evaluate({ images: [img('a')], predictions: { a: [] } });
  assert.equal(r.precision, null);
  assert.equal(r.recall, 0);
  near(r.ap50, 0);
});

test('the heuristic has no score: precision and recall yes, AP not applicable', () => {
  const r = evaluate({ images: [img('a')], predictions: { a: [{ box, score: null, source: 'blue-component-heuristic' }] } });
  assert.deepEqual([r.tp, r.ap50, r.map50], [1, NOT_APPLICABLE, NOT_APPLICABLE]);
});

test('a missing list or an image outside the split stops the evaluation', () => {
  assert.throws(() => evaluate({ images: [img('a')], predictions: {} }), /No prediction list/);
  assert.throws(() => evaluate({ images: [img('a')], predictions: { a: [], train1: [] } }), /outside this split/);
});

test('the report without a dataset carries no number at all', () => {
  const report = notMeasuredReport('DATASET_REQUIRED');
  assert.equal(report.status, 'DATASET_REQUIRED');
  for (const [key, value] of Object.entries(report)) if (key !== 'status') assert.equal(value, NOT_MEASURED, key);
});
