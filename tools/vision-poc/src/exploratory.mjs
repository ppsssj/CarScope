// P12-C: a small comparison of a public model on rights-checked photos. Separate from DATASET_GATE by construction:
// this file never reports a formal metric, and its images cannot satisfy the gate because their split is not train, val or test.
import { ALLOWED_LICENSES, imageErrors } from './dataset.mjs';
import { evaluate, iou, IOU_THRESHOLD } from './evaluate.mjs';

export const EVALUATION_TYPE = 'EXPLORATORY_EVALUATION';
export const EXPLORATORY_SPLIT = 'exploratory';
export const EXPLORATORY_STATUS = Object.freeze({ EMPTY: 'EXPLORATORY_EMPTY', INVALID: 'EXPLORATORY_INVALID', READY: 'EXPLORATORY_READY', NOT_RUN: 'EXPLORATORY_NOT_RUN' });
// A public model may have been trained on public photos. Nothing here can rule that out.
export const LIMITS = Object.freeze(['PRELIMINARY_NOT_A_FORMAL_METRIC', 'NOT_FOR_RELEASE_DECISIONS', 'SAMPLE_NOT_REPRESENTATIVE', 'TRAINING_SET_OVERLAP_UNKNOWN', 'LABELS_NOT_INDEPENDENTLY_REVIEWED']);

// Wider than the gate's list because these photos are only looked at: no training and no copy in Git. The gate's own list does not change.
export const EXPLORATORY_LICENSES = Object.freeze([...ALLOWED_LICENSES, 'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-SA-2.0', 'CC-BY-SA-2.5', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0']);

export function validateExploratorySet(manifest) {
  const images = Array.isArray(manifest?.images) ? manifest.images : [];
  const errors = images.flatMap(image => imageErrors(image, { splits: [EXPLORATORY_SPLIT], licenses: EXPLORATORY_LICENSES }));
  const ids = images.map(i => i?.id);
  if (new Set(ids).size !== ids.length) errors.push('image ids must be unique');
  const sha = images.map(i => i?.sha256);
  if (new Set(sha).size !== sha.length) errors.push('the same file appears twice');
  const status = errors.length ? EXPLORATORY_STATUS.INVALID : images.length ? EXPLORATORY_STATUS.READY : EXPLORATORY_STATUS.EMPTY;
  return { status, errors, counts: { images: images.length, withTarget: images.filter(i => i.labels?.length).length, withoutTarget: images.filter(i => !i.labels?.length).length, vehicles: new Set(images.map(i => i.vehicle?.groupId)).size } };
}

// A 95% interval, because a percentage from a few photos reads as more certain than it is.
export function wilson(hits, total, z = 1.96) {
  if (!total) return null;
  const p = hits / total, d = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / d, half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function caseOf(image, list, others) {
  const r = evaluate({ images: [image], predictions: { [image.id]: list } });
  const outcome = [r.tp ? 'DETECTED' : null, r.fn ? 'MISSED' : null, Object.keys(r.confuserFalsePositives).length ? 'CONFUSED_WITH_OTHER_PART' : null, r.otherFalsePositives.length ? 'FALSE_POSITIVE' : null].filter(Boolean);
  // Does a predicted box hold the cap at all? A box around the whole reservoir fails IoU 0.5 yet may still guide the eye. Never counted as a detection.
  const capInsideBox = image.labels.some(({ box: [x, y, w, h] }) => list.some(({ box: b }) => { const cx = x + w / 2, cy = y + h / 2; return cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3]; }));
  const bestIou = image.labels.length && list.length ? Math.max(...image.labels.flatMap(l => list.map(p => iou(p.box, l.box)))) : null;
  return { id: image.id, vehicle: `${image.vehicle.make} ${image.vehicle.model}`, conditions: image.conditions, hasTarget: image.labels.length > 0, outcome: outcome.length ? outcome : ['NOTHING_REPORTED'], scores: list.map(p => p.score), bestIou, capInsideBox, confused: r.confuserFalsePositives, otherClasses: others };
}

// predictions: { [imageId]: { candidates: [{ box, score }], others: [...] } }
export function buildExploratoryReport({ manifest, modelId, predictions, scoreThreshold }) {
  const set = validateExploratorySet(manifest);
  if (set.status !== EXPLORATORY_STATUS.READY) return { evaluationType: EVALUATION_TYPE, status: set.status, errors: set.errors, metrics: null };
  const lists = {};
  for (const image of manifest.images) {
    const entry = predictions[image.id];
    if (!Array.isArray(entry?.candidates)) throw new Error(`No model result for ${image.id}: a failed call is not an empty result`);
    lists[image.id] = entry.candidates.filter(c => c.score === null || c.score >= scoreThreshold); // The heuristic has no score, so no threshold applies.
  }
  const r = evaluate({ images: manifest.images, predictions: lists });
  const cases = manifest.images.map(image => caseOf(image, lists[image.id], predictions[image.id].others ?? []));
  const withTarget = cases.filter(c => c.hasTarget);
  return {
    evaluationType: EVALUATION_TYPE, status: EXPLORATORY_STATUS.READY, preliminary: true, limits: LIMITS, formalEvaluation: 'NOT_MEASURED',
    modelId, scoreThreshold, iouThreshold: IOU_THRESHOLD, counts: set.counts,
    metrics: {
      tp: r.tp, fp: r.fp, fn: r.fn, precision: r.precision, recall: r.recall, ap50: r.ap50,
      precision95: wilson(r.tp, r.tp + r.fp), recall95: wilson(r.tp, r.positives),
      confuserFalsePositives: r.confuserFalsePositives, otherFalsePositives: r.otherFalsePositives, missedImages: r.missedImages, strata: r.strata,
    },
    auxiliary: { capInsideAnyPredictedBox: withTarget.filter(c => c.capInsideBox).length, targetImages: withTarget.length, note: 'Not a detection metric. Separates a wrong place from a larger box.' },
    cases,
  };
}
