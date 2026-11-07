// P12-D: preliminary comparison of text-prompt detectors, the public YOLOv8 model and the colour rule on one small photo set.
// Never a formal metric: DATASET_GATE stays the only formal bar, and these photos cannot pass it because their split is `exploratory`.
import { evaluate, iou } from './evaluate.mjs';

export const EVALUATION_TYPE = 'EXPLORATORY_EVALUATION';
export const NMS_IOU = 0.5;
export const SMALL_CAP_AREA = 0.0025; // Under 0.25% of the photo, about 55×55 px at 1280×960.

// Fixed before running, from each model's documented example, and not tuned on these photos.
export const OPERATING_POINTS = Object.freeze({ owlv2: 0.1, 'grounding-dino-tiny': 0.3, 'omdet-turbo': 0.3 });

// The bar to call a model worth a larger evaluation. Fixed before running. Passing it is still not success on 12 photos.
export const RELIABILITY_BAR = Object.freeze({ minRecall: 0.8, minPrecision: 0.8, blackCapDetected: true, confuserFalsePositives: 0 });
export const VERDICT = Object.freeze({ NOT_RELIABLE: 'NOT_RELIABLE', WORTH_LARGER_EVALUATION: 'WORTH_LARGER_EVALUATION' });

// A label counts as the target only when it names the washer. A partial phrase such as "fluid cap" is ambiguous and does not count.
export const isTargetLabel = label => /\b(washer|windshield)\b/i.test(label ?? '');

export function nonMaxSuppress(predictions, overlap = NMS_IOU) {
  const kept = [];
  for (const p of [...predictions].sort((a, b) => b.score - a.score)) if (!kept.some(k => iou(k.box, p.box) >= overlap)) kept.push(p);
  return kept;
}

export function wilson(hits, total, z = 1.96) {
  if (!total) return null;
  const p = hits / total, d = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / d, half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const inTheModel = image => ({ id: image.id, labels: image.labels, confusers: image.confusers, conditions: image.conditions });
const isBlack = image => image.labels.some(l => /black/i.test(l.capColor));
const isSmall = image => image.labels.some(({ box }) => box[2] * box[3] < SMALL_CAP_AREA);

// predictionsById: { [imageId]: [{ label?, box, score }] }, every image required. Target rows are selected by the caller.
export function scoreAt({ images, predictionsById, threshold }) {
  const lists = {};
  for (const image of images) {
    const list = predictionsById[image.id];
    if (!Array.isArray(list)) throw new Error(`No result for ${image.id}: a failed run is not an empty result`);
    lists[image.id] = threshold === null ? list : list.filter(p => p.score >= threshold);
  }
  const r = evaluate({ images: images.map(inTheModel), predictions: lists });
  return { threshold, tp: r.tp, fp: r.fp, fn: r.fn, precision: r.precision, recall: r.recall, precision95: wilson(r.tp, r.tp + r.fp), recall95: wilson(r.tp, r.positives), ap50: r.ap50, confuserFalsePositives: r.confuserFalsePositives, otherFalsePositives: r.otherFalsePositives, missedImages: r.missedImages };
}

export function casesAt({ images, predictionsById, threshold }) {
  return images.map(image => {
    const list = threshold === null ? predictionsById[image.id] : predictionsById[image.id].filter(p => p.score >= threshold);
    const r = evaluate({ images: [inTheModel(image)], predictions: { [image.id]: list } });
    const bestIou = image.labels.length && list.length ? Math.max(...image.labels.flatMap(l => list.map(p => iou(p.box, l.box)))) : null;
    return { id: image.id, vehicle: `${image.vehicle.make} ${image.vehicle.model}`, capColor: image.labels[0]?.capColor ?? null, small: isSmall(image), tp: r.tp, fp: r.fp, fn: r.fn, bestIou, confused: r.confuserFalsePositives };
  });
}

// Can the model find the object at all, whatever it calls it? Separates "did not see it" from "saw it and named it wrong".
export function localizationCheck({ images, allPredictionsById, threshold }) {
  return images.filter(i => i.labels.length).map(image => {
    const hits = allPredictionsById[image.id].filter(p => p.score >= threshold && iou(p.box, image.labels[0].box) >= 0.5).sort((a, b) => b.score - a.score);
    return { id: image.id, boxOnCap: hits.length > 0, topLabel: hits[0]?.label ?? null, topScore: hits[0]?.score ?? null, namedAsTarget: hits.some(h => isTargetLabel(h.label)) };
  });
}

export function confuserCheck({ images, allPredictionsById, threshold }) {
  return images.flatMap(image => image.confusers.map(c => {
    const hits = allPredictionsById[image.id].filter(p => p.score >= threshold && iou(p.box, c.box) >= 0.5).sort((a, b) => b.score - a.score);
    return { id: image.id, kind: c.kind, seen: hits.length > 0, topLabel: hits[0]?.label ?? null, calledTarget: hits.some(h => isTargetLabel(h.label)) };
  }));
}

export function verdictFor(metrics, images, predictionsById, threshold) {
  const black = images.filter(isBlack);
  const blackHit = black.length > 0 && black.every(image => casesAt({ images: [image], predictionsById, threshold })[0].tp > 0);
  const confuserCount = Object.values(metrics.confuserFalsePositives).reduce((sum, list) => sum + list.length, 0);
  const checks = {
    recall: (metrics.recall ?? 0) >= RELIABILITY_BAR.minRecall,
    precision: (metrics.precision ?? 0) >= RELIABILITY_BAR.minPrecision,
    blackCap: blackHit,
    confusers: confuserCount <= RELIABILITY_BAR.confuserFalsePositives,
  };
  return { verdict: Object.values(checks).every(Boolean) ? VERDICT.WORTH_LARGER_EVALUATION : VERDICT.NOT_RELIABLE, checks };
}

export const targetPredictions = rows => nonMaxSuppress(rows.filter(p => isTargetLabel(p.label)));
export const subsets = { black: images => images.filter(isBlack), small: images => images.filter(isSmall) };
