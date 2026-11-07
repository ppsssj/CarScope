import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { detectCandidates } from '../../mobile-ar-poc/public/detector.mjs';
import { STATUS, TARGET_CLASS, USER_ANSWER, answerCandidate, classifyModel, interpretDetections, toBaselinePredictions } from '../src/detection-contract.mjs';

const hit = (categoryName, score, box = { originX: 10, originY: 20, width: 30, height: 40 }) => ({ categories: [{ categoryName, score }], boundingBox: box });
const run = (detections, extra = {}) => interpretDetections({ detections, imageWidth: 100, imageHeight: 200, ...extra });

test('no model, or a model not trained for the class, can never be used', () => {
  assert.deepEqual(classifyModel(null), { usable: false, status: STATUS.MODEL_REQUIRED });
  assert.equal(classifyModel({ role: 'RUNTIME_SMOKE_ONLY', labels: ['car', 'bottle'] }).status, STATUS.MODEL_NOT_TARGET);
  assert.equal(classifyModel({ role: 'RUNTIME_SMOKE_ONLY', labels: [TARGET_CLASS] }).status, STATUS.MODEL_NOT_TARGET, 'a label alone does not make it a candidate model');
  assert.equal(classifyModel({ role: 'TARGET_CANDIDATE', labels: ['coolant-cap'] }).status, STATUS.MODEL_NOT_TARGET);
  assert.equal(classifyModel({ role: 'TARGET_CANDIDATE', labels: [TARGET_CLASS] }).usable, true);
});

test('a target detection becomes an unverified candidate with normalized box and score', () => {
  const { status, candidates: [candidate] } = run([hit(TARGET_CLASS, 0.8)]);
  assert.equal(status, STATUS.CANDIDATES);
  assert.deepEqual(candidate, { box: [0.1, 0.1, 0.3, 0.2], score: 0.8, id: 'ai-1', label: TARGET_CLASS, source: 'ai-object-detector', verified: false });
});

test('nothing found is NO_DETECTION; another class never becomes a candidate', () => {
  assert.deepEqual(run([]), { status: STATUS.NO_DETECTION, candidates: [] });
  for (const label of ['coolant-cap', 'brake-fluid-cap', 'bottle', 'Washer-Fluid-Cap', 'washer']) assert.equal(run([hit(label, 0.99)]).status, STATUS.NO_DETECTION, label);
});

test('a broken detector result is a failure, not NO_DETECTION', () => {
  assert.equal(run(undefined).status, STATUS.INFERENCE_FAILED);
  assert.equal(interpretDetections({ detections: [], imageWidth: 0, imageHeight: 10 }).status, STATUS.INFERENCE_FAILED);
});

test('scores below the threshold, invalid scores and invalid boxes are dropped', () => {
  assert.equal(run([hit(TARGET_CLASS, 0.49)]).status, STATUS.NO_DETECTION);
  assert.equal(run([hit(TARGET_CLASS, 0.5)]).status, STATUS.CANDIDATES);
  for (const score of [NaN, 1.2, undefined]) assert.equal(run([hit(TARGET_CLASS, score)]).status, STATUS.NO_DETECTION);
  assert.equal(run([hit(TARGET_CLASS, 0.9, { originX: NaN, originY: 0, width: 1, height: 1 })]).status, STATUS.NO_DETECTION);
  assert.equal(run([hit(TARGET_CLASS, 0.9, { originX: 200, originY: 0, width: 10, height: 10 })]).status, STATUS.NO_DETECTION);
});

test('a box over the edge is clipped, and candidates are ranked and limited', () => {
  assert.deepEqual(run([hit(TARGET_CLASS, 0.9, { originX: -10, originY: 190, width: 30, height: 40 })]).candidates[0].box, [0, 0.95, 0.2, 0.05]);
  const { candidates } = run([0.6, 0.9, 0.7, 0.8].map(score => hit(TARGET_CLASS, score)));
  assert.deepEqual(candidates.map(c => [c.id, c.score]), [['ai-1', 0.9], ['ai-2', 0.8], ['ai-3', 0.7]]);
});

test('a user answer stays a local mark and unknown answers are refused', () => {
  assert.deepEqual(answerCandidate({}, 'ai-1', USER_ANSWER.CONFIRMED), { 'ai-1': 'CONFIRMED' });
  assert.throws(() => answerCandidate({}, 'ai-1', 'PASS'));
});

// The existing heuristic, unmodified. These pin what its rule does on drawn frames; they are not field error rates.
function frame(paint, width = 320, height = 240) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...(paint(x, y) ?? [60, 60, 60]), 255], (y * width + x) * 4);
  return { data, width, height };
}
const square = (color, left = 100, top = 80, size = 40) => (x, y) => (x >= left && x < left + size && y >= top && y < top + size ? color : null);

test('baseline limit: any blue region is proposed, because the rule knows colour and not parts', () => {
  const [prediction, ...rest] = toBaselinePredictions(detectCandidates(frame(square([30, 60, 200]))));
  assert.equal(rest.length, 0);
  assert.deepEqual(prediction.box, [100 / 320, 80 / 240, 40 / 320, 40 / 240]);
  assert.equal(prediction.score, null, 'the heuristic has no probability');
  assert.equal(prediction.source, 'blue-component-heuristic');
  assert.equal(prediction.verified, false);
});

test('baseline limit: a cap that is not blue is missed', () => {
  for (const color of [[220, 200, 40], [235, 235, 235], [20, 20, 20], [200, 40, 40]]) assert.equal(detectCandidates(frame(square(color))).length, 0, color.join());
});

test('baseline limit: a small or very large blue region is outside the area rule', () => {
  assert.equal(detectCandidates(frame(square([30, 60, 200], 100, 80, 5))).length, 0, 'about 0.03% of the frame');
  assert.equal(detectCandidates(frame(square([30, 60, 200], 10, 10, 120))).length, 0, 'about 19% of the frame');
});

test('baseline limit: a shadow across the cap splits it, and dim blue fails the threshold', () => {
  const split = (x, y) => (x >= 100 && x < 140 && y >= 80 && y < 120 ? (Math.abs(x - 120) <= 1 ? [20, 20, 20] : [30, 60, 200]) : null);
  assert.equal(detectCandidates(frame(split)).length, 2, 'one cap, two components');
  assert.equal(detectCandidates(frame(square([20, 30, 70]))).length, 0, 'blue value under 75');
});

test('baseline limit: frames over 320 by 320 are refused', () => {
  assert.throws(() => detectCandidates({ data: new Uint8ClampedArray(321 * 320 * 4), width: 321, height: 320 }), /320/);
});

test('the PoC does not change the heuristic: same file, imported as is', async () => {
  const source = await readFile(new URL('../../mobile-ar-poc/public/detector.mjs', import.meta.url), 'utf8');
  assert.match(source, /No semantic recognition or probability/);
  assert.match(source, /source: 'blue-component-heuristic', verified: false/);
});
