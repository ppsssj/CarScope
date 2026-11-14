import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAI, CAI_PLAN, BUSY, initialCameraAi as init, reduceCameraAi as reduce, canCapture,
  scaledSize, captureProblem, uploadProblem, containBox, elementToImagePoint, imageBoxToElement,
  dragToBox, regionProblem, nudgeBox, keyboardStartBox, acceptCandidates, REGION_MIN,
} from "../public/camera-ai-flow.mjs";
import { contextCropPlan } from "../public/context-crop.mjs";

const run = (s, ...events) => events.reduce(reduce, s);
const ready = (plan = CAI_PLAN.DETECT) => run(init(plan, true),
  { type: "CONSENT", kind: "detect", value: true }, { type: "CONSENT", kind: "analyze", value: true });
const cand = (box, score = 0.8) => ({ box, score });

test("capture needs the live camera and both consents for a detect plan, only the analysis one for a mark plan", () => {
  for (const [detect, analyze] of [[false, false], [true, false], [false, true]]) {
    const s = run(init(CAI_PLAN.DETECT, true), { type: "CONSENT", kind: "detect", value: detect }, { type: "CONSENT", kind: "analyze", value: analyze });
    assert.equal(reduce(s, { type: "CAPTURE" }), s, `${detect}/${analyze} must not capture`);
  }
  assert.equal(reduce(run(init(CAI_PLAN.DETECT, false), { type: "CONSENT", kind: "detect", value: true }, { type: "CONSENT", kind: "analyze", value: true }), { type: "CAPTURE" }).phase, CAI.IDLE);
  assert.equal(reduce(ready(), { type: "CAPTURE" }).phase, CAI.CAPTURING);
  const mark = run(init(CAI_PLAN.MARK, true), { type: "CONSENT", kind: "detect", value: true });
  assert.equal(mark.consent.detect, false, "a mark plan never collects a detector consent");
  assert.equal(canCapture(run(mark, { type: "CONSENT", kind: "analyze", value: true })), true);
  assert.equal(run(mark, { type: "CONSENT", kind: "analyze", value: true }, { type: "CAPTURE" }, { type: "CAPTURED", attempt: 1 }).phase, CAI.MANUAL_REGION);
});

test("detection uses its consent once; candidates are shown, never confirmed, and analysis waits for CONFIRM", () => {
  let s = run(ready(), { type: "CAPTURE" });
  s = reduce(s, { type: "CAPTURED", attempt: s.attempt });
  assert.equal(s.phase, CAI.DETECTING);
  assert.equal(s.consent.detect, false);
  assert.equal(s.consent.analyze, true);
  s = reduce(s, { type: "DETECTED", attempt: s.attempt, candidates: [cand([0.1, 0.1, 0.2, 0.2]), cand([0.5, 0.5, 0.3, 0.3], 0.6)] });
  assert.equal(s.phase, CAI.CANDIDATE_FOUND);
  assert.equal(s.selected, 0);
  s = reduce(s, { type: "SELECT", index: 1 });
  assert.equal(s.selected, 1);
  assert.equal(reduce(s, { type: "SELECT", index: 5 }), s);
  for (const e of [{ type: "CROP_START" }, { type: "CROPPED", attempt: s.attempt }, { type: "ANALYZED", attempt: s.attempt, result: {} }])
    assert.equal(reduce(s, e), s, e.type + " before confirmation");
  const c = reduce(s, { type: "CONFIRM" });
  assert.equal(c.phase, CAI.CONFIRMING_PART);
  assert.deepEqual(c.region, [0.5, 0.5, 0.3, 0.3]);
  assert.equal(c.regionSource, "AI_CANDIDATE");
  assert.equal(reduce(c, { type: "CONFIRM" }), c, "a second confirm is ignored: one request per confirmation");
});

test("the analysis consent is used once, late answers from an older attempt are dropped, cancel invalidates", () => {
  let s = run(ready(), { type: "CAPTURE" });
  s = run(s, { type: "CAPTURED", attempt: s.attempt }, { type: "DETECTED", attempt: s.attempt, candidates: [cand([0.2, 0.2, 0.3, 0.3])] }, { type: "CONFIRM" }, { type: "CROP_START" });
  const a = s.attempt;
  s = reduce(s, { type: "CROPPED", attempt: a });
  assert.equal(s.phase, CAI.ANALYZING);
  assert.deepEqual(s.consent, { detect: false, analyze: false });
  const cancelled = reduce(s, { type: "CANCEL" });
  assert.equal(cancelled.phase, CAI.CANCELLED);
  assert.equal(reduce(cancelled, { type: "ANALYZED", attempt: a, result: { x: 1 } }), cancelled, "late result after cancel");
  assert.equal(reduce(cancelled, { type: "RETRY_ANALYSIS" }), cancelled, "retry needs a new consent");
  const retry = run(cancelled, { type: "CONSENT", kind: "analyze", value: true }, { type: "RETRY_ANALYSIS" });
  assert.equal(retry.phase, CAI.CONFIRMING_PART);
  assert.ok(retry.attempt > cancelled.attempt);
  const done = reduce(s, { type: "ANALYZED", attempt: a, result: { ok: 1 }, provenance: "MOCK" });
  assert.equal(done.phase, CAI.RESULT);
  const old = reduce(reduce(done, { type: "RESET" }), { type: "ANALYZED", attempt: a, result: {} });
  assert.equal(old.phase, CAI.CAMERA_READY, "a new capture never shows the previous photo's result");
  assert.deepEqual(old.consent, { detect: false, analyze: false }, "a new capture asks again");
});

test("no candidates or a wrong part lead to a dragged region on the same photo; failures never retry by themselves", () => {
  let s = run(ready(), { type: "CAPTURE" });
  s = run(s, { type: "CAPTURED", attempt: s.attempt }, { type: "DETECTED", attempt: s.attempt, candidates: [] });
  assert.equal(s.phase, CAI.NONE_FOUND);
  assert.equal(reduce(s, { type: "CONFIRM" }), s);
  s = reduce(s, { type: "MANUAL" });
  assert.equal(s.phase, CAI.MANUAL_REGION);
  assert.equal(reduce(s, { type: "CONFIRM" }), s, "no region yet");
  s = reduce(s, { type: "REGION", box: [0.05, 0.4, 0.9, 0.5] });
  const c = reduce(s, { type: "CONFIRM" });
  assert.equal(c.regionSource, "MANUAL");
  const failed = reduce(reduce(c, { type: "CROP_START" }), { type: "FAIL", attempt: c.attempt, code: "BUDGET_EXHAUSTED" });
  assert.equal(failed.phase, CAI.ERROR);
  assert.equal(failed.code, "BUDGET_EXHAUSTED");
  assert.deepEqual(failed.consent, { detect: false, analyze: false });
  assert.ok(!BUSY.includes(failed.phase));
});

test("frames are scaled within bounds, keep their aspect for the server check, and bad uploads are refused", () => {
  for (const [w, h] of [[1280, 720], [720, 1280], [1920, 1080], [4032, 3024], [641, 479], [3000, 31]]) {
    const d = scaledSize(w, h, 1280);
    assert.ok(Math.max(d.width, d.height) <= 1280);
    if (Math.min(d.width, d.height) >= 64) assert.ok(Math.abs(d.width / d.height - w / h) <= 0.02, `${w}x${h}`);
  }
  assert.deepEqual(scaledSize(640, 480, 1280), { width: 640, height: 480, scale: 1 });
  assert.equal(captureProblem(0, 0), "NO_VIDEO_FRAME");
  assert.equal(captureProblem(3000, 40), "FRAME_TOO_SMALL");
  assert.equal(captureProblem(1280, 720), null);
  assert.equal(uploadProblem(new Blob(["x"], { type: "image/png" })), "UNREADABLE");
  assert.equal(uploadProblem(new Blob([], { type: "image/jpeg" })), "UNREADABLE");
  assert.equal(uploadProblem(new Blob([new Uint8Array(10)], { type: "image/jpeg" }), 5), "TOO_LARGE");
  assert.equal(uploadProblem(new Blob([new Uint8Array(10)], { type: "image/jpeg" })), null);
});

test("screen → image mapping honours object-fit contain letterboxing, any aspect, and clamps outside the picture", () => {
  // 4:3 picture in a 300x400 portrait element: 300x225, centred, 87.5px bars above and below.
  assert.deepEqual(containBox(640, 480, 300, 400), { x: 0, y: 87.5, width: 300, height: 225 });
  assert.deepEqual(elementToImagePoint(150, 200, 300, 400, 640, 480), [0.5, 0.5]);
  assert.deepEqual(elementToImagePoint(0, 87.5, 300, 400, 640, 480), [0, 0]);
  assert.deepEqual(elementToImagePoint(-50, 10, 300, 400, 640, 480), [0, 0], "outside clamps to the edge");
  assert.deepEqual(elementToImagePoint(999, 999, 300, 400, 640, 480), [1, 1]);
  // Rotated phone: same picture, landscape element (pillarbox).
  const p = elementToImagePoint(400, 150, 800, 300, 640, 480);
  assert.ok(Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9);
  const box = [0.25, 0.1, 0.5, 0.6];
  const r = imageBoxToElement(box, 800, 300, 640, 480);
  const back = [elementToImagePoint(r.left, r.top, 800, 300, 640, 480), elementToImagePoint(r.left + r.width, r.top + r.height, 800, 300, 640, 480)];
  assert.deepEqual(back.flat().map((n) => +n.toFixed(9)), [0.25, 0.1, 0.75, 0.7]);
  assert.equal(elementToImagePoint(1, 1, 0, 10, 640, 480), null);
});

test("a drag in any direction makes the same box, is clamped to the image, and small or invalid boxes are refused", () => {
  const forward = dragToBox([0.2, 0.3], [0.7, 0.8], 640, 480);
  for (const [a, b] of [[[0.7, 0.8], [0.2, 0.3]], [[0.2, 0.8], [0.7, 0.3]], [[0.7, 0.3], [0.2, 0.8]]])
    assert.deepEqual(dragToBox(a, b, 640, 480), forward);
  assert.deepEqual(forward.box.map((n) => +n.toFixed(9)), [0.2, 0.3, 0.5, 0.5]);
  assert.deepEqual(dragToBox([-0.4, -1], [1.7, 2], 640, 480).box, [0, 0, 1, 1], "beyond the edges clamps; a whole-frame part is allowed");
  assert.deepEqual(dragToBox([0.02, 0.05], [0.98, 0.95], 640, 480).box.map((n) => +n.toFixed(9)), [0.02, 0.05, 0.96, 0.9], "large part (battery, fuse box)");
  assert.equal(dragToBox([0.5, 0.5], [0.5, 0.5], 640, 480).error, "REGION_TOO_SMALL", "a tap is not a region");
  assert.equal(dragToBox([0.5, 0.5], [0.51, 0.9], 640, 480).error, "REGION_TOO_SMALL", "too thin");
  assert.equal(dragToBox([0.1, 0.1], [0.14, 0.14], 400, 300).error, "REGION_TOO_SMALL", "under 24 source px (16x12)");
  assert.equal(dragToBox([NaN, 0], [1, 1], 640, 480).error, "REGION_INVALID");
  assert.equal(regionProblem([0.5, 0.5, 0.6, 0.2], 640, 480), "REGION_INVALID", "beyond the right edge");
  assert.equal(regionProblem([0.1, 0.1, REGION_MIN.fraction, 0.5], 4000, 3000), null);
});

test("keyboard alternative: a centred start, moves and resizes stay inside the image and above the minimum", () => {
  let b = keyboardStartBox();
  assert.equal(regionProblem(b, 640, 480), null);
  for (let i = 0; i < 50; i++) b = nudgeBox(b, { dx: 0.05 });
  assert.ok(Math.abs(b[0] + b[2] - 1) < 1e-9, "stops at the right edge");
  for (let i = 0; i < 50; i++) b = nudgeBox(b, { dw: -0.05, dh: -0.05 });
  assert.equal(b[2], REGION_MIN.fraction);
  for (let i = 0; i < 50; i++) b = nudgeBox(b, { dw: 0.05, dh: 0.05 });
  assert.deepEqual([b[2], b[3]], [1, 1]);
  assert.ok(b[0] >= 0 && b[1] >= 0);
});

test("a confirmed region maps to the same place in the full-resolution crop source", () => {
  // The detector saw a 1280x720 copy; the crop source is the 1920x1080 frame. Fractions are shared, so the crop is centred on the box.
  const box = [0.4, 0.3, 0.2, 0.25];
  const plan = contextCropPlan({ width: 1920, height: 1080 }, box);
  const [cx, cy] = [plan.rect.x + plan.rect.width / 2, plan.rect.y + plan.rect.height / 2];
  assert.ok(Math.abs(cx - 0.5 * 1920) <= 1 && Math.abs(cy - 0.425 * 1080) <= 1);
  const t = plan.targetInCrop;
  assert.ok(Math.abs((plan.rect.x + t[0] * plan.rect.width) / 1920 - 0.4) < 1e-3);
  assert.ok(Math.abs((plan.rect.y + t[1] * plan.rect.height) / 1080 - 0.3) < 1e-3);
  // A whole-frame manual region keeps the whole frame.
  const all = contextCropPlan({ width: 1920, height: 1080 }, [0, 0, 1, 1]);
  assert.deepEqual([all.rect.x, all.rect.y, all.rect.width, all.rect.height], [0, 0, 1920, 1080]);
});

test("candidates are accepted only as the detection contract allows", () => {
  assert.deepEqual(acceptCandidates([{ box: [0.1, 0.1, 0.2, 0.2], score: 0.9 }]), [{ box: [0.1, 0.1, 0.2, 0.2], score: 0.9 }]);
  for (const bad of [null, [1, 2, 3, 4].map(() => ({ box: [0, 0, 0.1, 0.1], score: 0.9 })), [{ box: [0, 0, 2, 0.1], score: 0.9 }], [{ box: [0, 0, 0.1, 0.1], score: 0.2 }], [{ box: [0, 0, 0.1, 0.1] }]])
    assert.throws(() => acceptCandidates(bad), /INVALID_RESPONSE/);
});
