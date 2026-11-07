// P12-B: detection metrics, one class, IoU 0.5, one-to-one matching. Pure, so the arithmetic is tested on hand-computed cases.
export const IOU_THRESHOLD = 0.5;
export const NOT_MEASURED = 'NOT_MEASURED';
export const NOT_APPLICABLE = 'NOT_APPLICABLE';

export function iou(a, b) {
  const width = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / (a[2] * a[3] + b[2] * b[3] - shared);
}

// All-point interpolated average precision over predictions sorted by score.
export function averagePrecision(ranked, positives) {
  if (!positives) return null;
  let tp = 0, fp = 0;
  const curve = ranked.map(r => { if (r.matched) tp++; else fp++; return { recall: tp / positives, precision: tp / (tp + fp) }; });
  for (let i = curve.length - 2; i >= 0; i--) curve[i].precision = Math.max(curve[i].precision, curve[i + 1].precision);
  let area = 0, previous = 0;
  for (const point of curve) { area += (point.recall - previous) * point.precision; previous = point.recall; }
  return area;
}

function matchImage(image, predictions, threshold) {
  const scored = predictions.every(p => Number.isFinite(p.score));
  const ordered = scored ? [...predictions].sort((a, b) => b.score - a.score) : predictions;
  const taken = new Set(), rows = [];
  for (const prediction of ordered) {
    let best = -1, bestIou = threshold;
    image.labels.forEach((label, index) => {
      if (taken.has(index)) return;
      const value = iou(prediction.box, label.box);
      if (value >= bestIou) { best = index; bestIou = value; }
    });
    if (best >= 0) { taken.add(best); rows.push({ imageId: image.id, score: prediction.score, matched: true }); continue; }
    const confuser = (image.confusers ?? []).find(c => iou(prediction.box, c.box) >= threshold);
    rows.push({ imageId: image.id, score: prediction.score, matched: false, confuser: confuser?.kind ?? null });
  }
  return { rows, missed: image.labels.length - taken.size };
}

const rate = (top, bottom) => (bottom ? top / bottom : null);

export function evaluate({ images, predictions, threshold = IOU_THRESHOLD }) {
  const known = new Set(images.map(i => i.id));
  for (const id of Object.keys(predictions)) if (!known.has(id)) throw new Error(`Prediction for an image outside this split: ${id}`);
  const perImage = images.map(image => {
    const list = predictions[image.id];
    if (!Array.isArray(list)) throw new Error(`No prediction list for ${image.id}; an image without detections needs []`);
    return { image, ...matchImage(image, list, threshold) };
  });
  const summarize = entries => {
    const rows = entries.flatMap(e => e.rows), positives = entries.reduce((sum, e) => sum + e.image.labels.length, 0);
    const tp = rows.filter(r => r.matched).length, fp = rows.length - tp, fn = entries.reduce((sum, e) => sum + e.missed, 0);
    return { images: entries.length, positives, tp, fp, fn, precision: rate(tp, tp + fp), recall: rate(tp, positives) };
  };
  const rows = perImage.flatMap(e => e.rows), scored = rows.every(r => Number.isFinite(r.score));
  const ranked = scored ? [...rows].sort((a, b) => b.score - a.score) : null;
  const positives = images.reduce((sum, i) => sum + i.labels.length, 0);
  const strata = {};
  for (const key of new Set(images.flatMap(i => Object.keys(i.conditions ?? {})))) {
    strata[key] = {};
    for (const value of new Set(images.map(i => i.conditions?.[key]).filter(v => v !== undefined))) strata[key][value] = summarize(perImage.filter(e => e.image.conditions?.[key] === value));
  }
  const confuserFalsePositives = {};
  for (const row of rows) if (!row.matched && row.confuser) (confuserFalsePositives[row.confuser] ??= []).push(row.imageId);
  return {
    ...summarize(perImage),
    // A heuristic without scores has no ranking, so it has precision and recall at one operating point but no AP.
    ap50: ranked ? averagePrecision(ranked, positives) : NOT_APPLICABLE,
    map50: ranked ? averagePrecision(ranked, positives) : NOT_APPLICABLE, // One class: mAP@0.5 equals AP@0.5.
    confuserFalsePositives,
    otherFalsePositives: rows.filter(r => !r.matched && !r.confuser).map(r => r.imageId),
    missedImages: perImage.filter(e => e.missed).map(e => e.image.id),
    strata,
  };
}

// What a report says while no usable dataset exists: no number can appear.
export const notMeasuredReport = datasetStatus => ({
  status: datasetStatus,
  precision: NOT_MEASURED, recall: NOT_MEASURED, map50: NOT_MEASURED,
  confuserFalsePositives: NOT_MEASURED, strata: NOT_MEASURED,
  targetModelInferenceMs: NOT_MEASURED, targetModelMemory: NOT_MEASURED, targetModelFileBytes: NOT_MEASURED,
  zFlip8: NOT_MEASURED,
});
