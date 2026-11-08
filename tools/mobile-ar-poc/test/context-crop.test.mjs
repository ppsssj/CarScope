// P13-A: crop geometry. Pure, no browser: the decoding, EXIF orientation and JPEG output are checked in test/part-analysis-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxAroundPoint, contextCropPlan, CROP_DEFAULTS, cropPointToSource, validateBox } from '../public/context-crop.mjs';

const IMG = { width: 4000, height: 3000 };
const contains = (plan, box) => {
  const { x, y, width, height } = plan.rect, W = plan.source.width, H = plan.source.height;
  const [l, t, w, h] = box.map((n, i) => n * (i % 2 ? H : W));
  return l >= x - 1e-6 && t >= y - 1e-6 && l + w <= x + width + 1e-6 && t + h <= y + height + 1e-6;
};
const inside = plan => plan.rect.x >= 0 && plan.rect.y >= 0 && plan.rect.x + plan.rect.width <= plan.source.width && plan.rect.y + plan.rect.height <= plan.source.height && Number.isInteger(plan.rect.x) && Number.isInteger(plan.rect.width);

test('a normal box grows by the margin on every side, centred, in whole pixels', () => {
  const box = [0.4, 0.4, 0.2, 0.2]; // 800x600 px at (1600,1200)
  const plan = contextCropPlan(IMG, box, { minSidePx: 1, minShortSideFraction: 0 });
  assert.deepEqual(plan.rect, { x: 1280, y: 960, width: 1440, height: 1080 }); // 800*1.8, 600*1.8
  assert.ok(contains(plan, box) && inside(plan));
  assert.equal(plan.shifted, false); assert.equal(plan.limitedByImage, false);
  // The part sits in the middle of the crop with 40% of its size on each side.
  assert.deepEqual(plan.targetInCrop.map(n => Number(n.toFixed(4))), [0.2222, 0.2222, 0.5556, 0.5556]);
  assert.equal(plan.margin, CROP_DEFAULTS.margin);
});

test('pixel aspect is kept: output is scaled uniformly and never enlarged', () => {
  const big = contextCropPlan(IMG, [0.1, 0.1, 0.5, 0.3]);
  assert.ok(Math.max(big.output.width, big.output.height) <= CROP_DEFAULTS.maxOutputSide);
  assert.ok(Math.abs(big.output.width / big.output.height - big.rect.width / big.rect.height) < 0.01, 'same aspect');
  const small = contextCropPlan({ width: 640, height: 480 }, [0.4, 0.4, 0.1, 0.1]);
  assert.equal(small.scale, 1); assert.deepEqual(small.output, { width: small.rect.width, height: small.rect.height }, 'no upscaling');
});

test('a small object gets the minimum crop, so its surroundings stay', () => {
  const cap = [0.5, 0.5, 0.01, 0.01]; // 40x30 px
  const plan = contextCropPlan(IMG, cap);
  const min = Math.max(CROP_DEFAULTS.minSidePx, CROP_DEFAULTS.minShortSideFraction * 3000);
  assert.ok(plan.rect.width >= min && plan.rect.height >= min, JSON.stringify(plan.rect));
  assert.ok(contains(plan, cap));
  const [, , w] = plan.targetInCrop;
  assert.ok(w < 0.05, 'the cap is a small part of a crop with context');
  // A profile may ask for more margin; the minimum still holds.
  const more = contextCropPlan(IMG, [0.5, 0.5, 0.05, 0.05], { margin: 0.8, minShortSideFraction: 0.35 });
  assert.ok(more.rect.height >= 0.35 * 3000 - 1);
});

test('a box at an edge or corner slides the crop inside rather than cutting it, keeping the size', () => {
  for (const box of [[0, 0, 0.1, 0.1], [0.9, 0.9, 0.1, 0.1], [0, 0.45, 0.05, 0.1], [0.95, 0, 0.05, 0.05]]) {
    const plan = contextCropPlan(IMG, box, { minSidePx: 1, minShortSideFraction: 0 });
    const centred = contextCropPlan(IMG, [0.45, 0.45, box[2], box[3]], { minSidePx: 1, minShortSideFraction: 0 });
    assert.ok(inside(plan) && contains(plan, box), JSON.stringify(box));
    assert.equal(plan.shifted, true);
    assert.ok(Math.abs(plan.rect.width - centred.rect.width) <= 1 && Math.abs(plan.rect.height - centred.rect.height) <= 1, 'same size as in the middle');
  }
});

test('a large object is limited by the picture, never past it', () => {
  const plan = contextCropPlan(IMG, [0.05, 0.05, 0.9, 0.9]);
  assert.deepEqual(plan.rect, { x: 0, y: 0, width: 4000, height: 3000 });
  assert.equal(plan.limitedByImage, true);
  const whole = contextCropPlan(IMG, [0, 0, 1, 1]);
  assert.deepEqual(whole.targetInCrop, [0, 0, 1, 1]);
});

test('a picture smaller than the minimum is used whole', () => {
  const plan = contextCropPlan({ width: 200, height: 100 }, [0.4, 0.4, 0.1, 0.1]);
  assert.deepEqual(plan.rect, { x: 0, y: 0, width: 200, height: 100 });
  assert.ok(inside(plan));
});

test('invalid boxes, pictures and options are refused with a code, not clamped into something else', () => {
  for (const bad of [null, [], [0, 0, 1], [0, 0, 0, 0.1], [0, 0, 0.1, 0], [0, 0, -0.1, 0.1], [-0.1, 0, 0.1, 0.1], [0.95, 0, 0.1, 0.1], [0, 0.95, 0.1, 0.1], [NaN, 0, 0.1, 0.1], [0, 0, Infinity, 0.1], ['0', 0, 0.1, 0.1], [0, 0, 1.2, 0.5]]) {
    assert.throws(() => contextCropPlan(IMG, bad), { code: 'CROP_BOX_INVALID' }, JSON.stringify(bad));
  }
  for (const image of [null, { width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: -5, height: 10 }, { width: 40000, height: 10 }, { width: NaN, height: 1 }]) {
    assert.throws(() => contextCropPlan(image, [0, 0, 0.5, 0.5]), { code: 'CROP_IMAGE_INVALID' }, JSON.stringify(image));
  }
  for (const options of [{ margin: -1 }, { margin: NaN }, { minSidePx: 0 }, { maxOutputSide: 10 }, { minShortSideFraction: 2 }]) {
    assert.throws(() => contextCropPlan(IMG, [0, 0, 0.5, 0.5], options), { code: 'CROP_OPTIONS_INVALID' }, JSON.stringify(options));
  }
  // Floating point noise at the border is trimmed, not refused.
  const trimmed = validateBox([0.9, 0.9, 0.1000000001, 0.1]);
  assert.ok(trimmed[0] + trimmed[2] <= 1 && trimmed[2] > 0.0999);
});

test('the crop and the original stay related: crop fractions map back to the original box', () => {
  const box = [0.3, 0.6, 0.08, 0.05];
  const plan = contextCropPlan(IMG, box);
  const [u, v, w, h] = plan.targetInCrop;
  const [l, t] = cropPointToSource(plan, [u, v]), [r, b] = cropPointToSource(plan, [u + w, v + h]);
  for (const [got, want] of [[l, box[0]], [t, box[1]], [r, box[0] + box[2]], [b, box[1] + box[3]]]) assert.ok(Math.abs(got - want) < 1e-4, `${got} vs ${want}`);
  const [x, y, cw, ch] = plan.sourceRect;
  assert.ok(Math.abs(x * 4000 - plan.rect.x) < 0.01 && Math.abs(cw * 4000 - plan.rect.width) < 0.01 && Math.abs(y * 3000 - plan.rect.y) < 0.01 && Math.abs(ch * 3000 - plan.rect.height) < 0.01);
});

test('a tapped point becomes a square box inside the picture', () => {
  const box = boxAroundPoint({ width: 1000, height: 500 }, [0.5, 0.5]);
  assert.deepEqual(box.map(n => Number(n.toFixed(4))), [0.455, 0.41, 0.09, 0.18]); // 90x90 px
  const corner = boxAroundPoint({ width: 1000, height: 500 }, [0, 1]);
  assert.ok(corner[0] === 0 && Math.abs(corner[1] + corner[3] - 1) < 1e-9);
  assert.doesNotThrow(() => validateBox(corner));
  assert.throws(() => boxAroundPoint({ width: 10, height: 10 }, [1.2, 0]), { code: 'CROP_POINT_INVALID' });
});
