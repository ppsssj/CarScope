// P13-C: product crop vs evaluation crops, pure geometry. Image decoding, EXIF orientation and byte reproduction are checked in Chrome
// (test/washer-truth-browser.mjs here, and the P13-A EXIF case in mobile-ar-poc/test/part-analysis-browser.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_PROFILES } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { ARMS, compareArms, confusablesOf, cropFacts, summarize } from '../washer-eval/crop-compare.mjs';
import { CROP_BASE } from '../washer-eval/washer-eval-model.mjs';

const PHOTO = { width: 1280, height: 960 };
const CAP = [0.4, 0.5, 0.05, 0.05]; // 64x48 px, a typical washer cap at this size

test('arms: A is the P13-A washer profile as shipped; B and C are the P13-B evaluation arm', () => {
  assert.deepEqual(ARMS.A_PRODUCT, { ...ANALYSIS_PROFILES['washer-fluid-cap'].crop });
  assert.deepEqual(ARMS.A_PRODUCT, { margin: 0.8, minSidePx: 320, minShortSideFraction: 0.35, maxOutputSide: 1024, jpegQuality: 0.9 });
  assert.deepEqual(ARMS.B_EVAL_40, { ...CROP_BASE, margin: 0.4 });
  assert.deepEqual(ARMS.C_EVAL_80, { ...CROP_BASE, margin: 0.8 });
});

test('the product minimum (320px, 35% of the short side) decides a small cap crop; the evaluation minimum (64px) does not', () => {
  const c = compareArms(PHOTO, CAP);
  const A = c.arms.A_PRODUCT, B = c.arms.B_EVAL_40, C = c.arms.C_EVAL_80;
  assert.deepEqual([A.rect.width, A.rect.height], [336, 336], '35% of 960 = 336 > 320');
  assert.deepEqual(A.minimumDecided, { width: true, height: true });
  assert.deepEqual([B.minimumDecided.width, C.minimumDecided.width], [false, false]);
  assert.ok(B.rect.width < C.rect.width && C.rect.width < A.rect.width);
  assert.ok(A.targetShare < 0.05 && B.targetShare > 0.25, `${A.targetShare} vs ${B.targetShare}`);
  assert.equal(c.productEqualsEval80, false);
  assert.ok(c.productAreaOverEval80 > 2);
  for (const f of [A, B, C]) assert.equal(f.containsPart, true);
});

test('a very small cap reaches the 64px evaluation floor; a large part is limited by the photo', () => {
  const tiny = compareArms(PHOTO, [0.5, 0.5, 0.01, 0.01]);
  assert.equal(tiny.arms.B_EVAL_40.minimumDecided.width, true, '12.8px * 1.8 < 64');
  // 64px, plus one when the origin falls between pixels: P13-A rounds outwards so the part is never cut.
  for (const side of [tiny.arms.B_EVAL_40.rect.width, tiny.arms.B_EVAL_40.rect.height]) assert.ok(side >= 64 && side <= 65, String(side));
  assert.equal(tiny.arms.B_EVAL_40.containsPart, true);
  const big = compareArms(PHOTO, [0.1, 0.1, 0.8, 0.8]);
  for (const key of Object.keys(ARMS)) { assert.equal(big.arms[key].limitedByImage, true, key); assert.deepEqual(big.arms[key].rect, { x: 0, y: 0, width: 1280, height: 960 }); }
});

test('at the photo edge the crop slides inside, keeps its size and still contains the part', () => {
  const corner = compareArms(PHOTO, [0, 0.95, 0.04, 0.05]);
  for (const key of Object.keys(ARMS)) {
    const f = corner.arms[key];
    assert.equal(f.shiftedAtEdge, true, key);
    assert.equal(f.containsPart, true, key);
    assert.ok(f.rect.x === 0 && f.rect.y + f.rect.height === 960, key);
    assert.ok(f.contextPerSide.left === 0 && f.contextPerSide.right > 0, 'no context on the side of the edge, more on the other');
  }
});

test('confusable parts in view come from the stored detector answer, scaled to the oriented photo', () => {
  // The detector saw a 640x480 copy; the photo is 1280x960.
  const answer = { image: { width: 640, height: 480 }, predictions: [
    { class: 'Engine Coolant Reservoir', confidence: 0.7, x: 330, y: 240, width: 20, height: 20 }, // beside the cap: 660,480 in the photo
    { class: 'Brake Fluid', confidence: 0.2, x: 280, y: 245, width: 10, height: 10 }, // below 0.25: ignored
    { class: 'Windshield Wiper Fluid', confidence: 0.9, x: 268, y: 252, width: 32, height: 24 }, // the part itself: not a confusable class
    { class: 'Radiator Cap', confidence: 0.6, x: 600, y: 40, width: 20, height: 20 }, // far away
  ] };
  const others = confusablesOf(answer, PHOTO);
  assert.deepEqual(others.map(o => o.className), ['Engine Coolant Reservoir', 'Radiator Cap']);
  assert.deepEqual([others[0].x, others[0].y, others[0].width], [640, 460, 40]);
  const c = compareArms(PHOTO, CAP, others);
  assert.deepEqual(c.arms.A_PRODUCT.confusableInView.map(o => o.className), ['Engine Coolant Reservoir']);
  assert.deepEqual(c.arms.B_EVAL_40.confusableInView, [], 'the tight crop leaves it out');
  assert.deepEqual(confusablesOf(null, PHOTO), []);
});

test('the oriented size is what counts: the same box on a rotated photo is a different crop', () => {
  const landscape = cropFacts({ width: 1280, height: 960 }, CAP, ARMS.A_PRODUCT), portrait = cropFacts({ width: 960, height: 1280 }, CAP, ARMS.A_PRODUCT);
  assert.notDeepEqual(landscape.rect, portrait.rect);
});

test('totals', () => {
  const rows = [CAP, [0.1, 0.1, 0.06, 0.06], [0, 0.95, 0.04, 0.05]].map((box, i) => ({ id: `p${i}`, comparison: compareArms(PHOTO, box) }));
  const s = summarize(rows);
  assert.equal(s.arms.A_PRODUCT.photos, 3);
  assert.equal(s.arms.A_PRODUCT.minimumDecided, 3);
  assert.equal(s.arms.B_EVAL_40.minimumDecided, 0);
  assert.equal(s.arms.A_PRODUCT.containsPart, 3);
  assert.equal(s.productEqualsEval80, 0);
  assert.ok(s.arms.A_PRODUCT.targetShareMedian < s.arms.C_EVAL_80.targetShareMedian);
});
