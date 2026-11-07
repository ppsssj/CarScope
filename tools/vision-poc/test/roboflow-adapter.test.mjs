import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATUS, TARGET_CLASS } from '../src/detection-contract.mjs';
import { ROBOFLOW_MODEL_ID, SOURCE_TO_TARGET, interpretRoboflow, mapSourceClass, otherClasses, parseRoboflowResponse, toDetections } from '../src/roboflow-adapter.mjs';

const WIPER = 'Windshield Wiper Fluid';
const prediction = (overrides = {}) => ({ x: 200, y: 100, width: 40, height: 20, confidence: 0.8, class: WIPER, class_id: 3, ...overrides });
const body = (...predictions) => ({ image: { width: 400, height: 200 }, predictions });
const run = (b, threshold = 0.5) => interpretRoboflow(parseRoboflowResponse(b), { scoreThreshold: threshold });

test('exactly one source class maps to the target, spelled exactly', () => {
  assert.deepEqual(SOURCE_TO_TARGET, { [WIPER]: TARGET_CLASS });
  assert.equal(mapSourceClass(WIPER), TARGET_CLASS);
  for (const other of ['windshield wiper fluid', 'Windshield Wiper Fluid ', 'Coolant', 'Coolant Reservoir', 'Brake Fluid', 'Oil Cap', 'Windshield Wiper', 'constructor', '__proto__']) assert.notEqual(mapSourceClass(other), TARGET_CLASS, other);
});

test('a source class spelled like the CarScope target still does not count', () => {
  assert.equal(mapSourceClass(TARGET_CLASS), `unmapped:${TARGET_CLASS}`);
  assert.equal(run(body(prediction({ class: TARGET_CLASS }))).status, STATUS.NO_DETECTION);
});

test('Roboflow centre coordinates become a top-left box, normalized to the reported image', () => {
  const { status, candidates: [candidate] } = run(body(prediction()));
  assert.equal(status, STATUS.CANDIDATES);
  assert.deepEqual(candidate.box, [180 / 400, 90 / 200, 40 / 400, 20 / 200]);
  assert.equal(candidate.score, 0.8);
  assert.equal(candidate.label, TARGET_CLASS);
  assert.equal(candidate.verified, false);
  assert.equal(candidate.source, `roboflow:${ROBOFLOW_MODEL_ID}`);
});

test('a box over the edge is clipped by the shared contract', () => {
  assert.deepEqual(run(body(prediction({ x: 390, y: 5, width: 40, height: 20 }))).candidates[0].box, [370 / 400, 0, 30 / 400, 15 / 200]);
});

test('other parts never become candidates, however confident, and stay available for analysis', () => {
  const b = body(prediction({ class: 'Coolant', confidence: 0.99 }), prediction({ class: 'Brake Fluid', confidence: 0.98 }));
  assert.deepEqual(run(b), { status: STATUS.NO_DETECTION, candidates: [] });
  assert.deepEqual(otherClasses(parseRoboflowResponse(b)).map(o => [o.className, o.score]), [['Coolant', 0.99], ['Brake Fluid', 0.98]]);
});

test('an image with no predictions is NO_DETECTION, and the threshold applies', () => {
  assert.equal(run(body()).status, STATUS.NO_DETECTION);
  assert.equal(run(body(prediction({ confidence: 0.49 }))).status, STATUS.NO_DETECTION);
  assert.equal(run(body(prediction({ confidence: 0.49 })), 0.4).status, STATUS.CANDIDATES);
});

test('every candidate is kept for evaluation, unlike the three shown on screen', () => {
  assert.equal(run(body(...[0.9, 0.8, 0.7, 0.6].map(confidence => prediction({ confidence })))).candidates.length, 4);
});

test('a malformed answer is an error, never an empty result', () => {
  const bad = [null, {}, { image: { width: 1, height: 1 } }, { image: { width: 0, height: 1 }, predictions: [] }, body(prediction({ x: 'a' })), body(prediction({ width: 0 })), body(prediction({ confidence: 1.2 })), body(prediction({ class: '' })), body(prediction({ class: undefined }))];
  for (const b of bad) assert.throws(() => parseRoboflowResponse(b), /ROBOFLOW_RESPONSE_INVALID/, JSON.stringify(b));
});

test('detections carry the MediaPipe shape the contract reads', () => {
  const [detection] = toDetections(parseRoboflowResponse(body(prediction())));
  assert.deepEqual(detection, { categories: [{ categoryName: TARGET_CLASS, score: 0.8 }], boundingBox: { originX: 180, originY: 90, width: 40, height: 20 } });
});
