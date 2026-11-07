// P12-G: performance against labels a person finished, and nothing else. A pending review gives no figures at all, and a partial one says so on every line.
// The threshold and IoU rule stay as fixed before P12-F. Other thresholds are shown for reference and no "best" one is ever picked.
import { REVIEW_PARTS, STATUS, BOX_KIND, IMAGE_STATE, PART_KEYS, draftOf, iou, imageState, progressOf, predictionsOf } from './review-model.mjs';
import { wilson } from '../src/exploratory.mjs';

export const REVIEW_STATE = Object.freeze({ AWAITING: 'AWAITING_HUMAN_REVIEW', PARTIAL: 'PARTIALLY_REVIEWED', DONE: 'HUMAN_REVIEWED', SYNTHETIC: 'SYNTHETIC_NOT_A_REVIEW' });
export const METRIC_STATE = Object.freeze({ PENDING: 'HUMAN_REVIEW_PENDING', PARTIAL: 'PARTIALLY_REVIEWED', DONE: 'HUMAN_REVIEWED', SYNTHETIC: 'SYNTHETIC_NOT_A_REVIEW' });
export const PRIMARY_THRESHOLD = 0.4;
export const IOU_RULE = 0.5;
export const THRESHOLDS = Object.freeze([0.05, 0.25, 0.4, 0.5]);
const fixed = value => (value === null || value === undefined ? null : Number(value.toFixed(3)));
const overlap = (a, b) => { const x = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), y = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return x > 0 && y > 0 ? x * y : 0; };
const inside = (x, y, b) => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];

/** Each drawn part, with its cap when the cap sits on it. A cap with no part drawn around it stands alone: only the cap could be seen. */
export function instancesOf(part) {
  const instances = part.boxes.map(whole => ({ whole, caps: [] }));
  for (const cap of part.caps) {
    const cx = cap[0] + cap[2] / 2, cy = cap[1] + cap[3] / 2;
    const owner = instances.find(instance => inside(cx, cy, instance.whole));
    if (owner) owner.caps.push(cap); else instances.push({ whole: cap, caps: [] });
  }
  return instances;
}

/** Greedy by score. IoU 0.5 with the part or its cap makes a hit. One box takes one instance. A box mostly on an ignore region counts neither way. */
export function matchPhoto(predictions, part) {
  const open = instancesOf(part), hits = [], falses = [], ignored = [];
  for (const prediction of predictions) {
    let at = -1, best = 0;
    open.forEach((instance, index) => { const value = Math.max(iou(prediction.box, instance.whole), ...instance.caps.map(cap => iou(prediction.box, cap))); if (value >= IOU_RULE && value > best) { best = value; at = index; } });
    if (at >= 0) { open.splice(at, 1); hits.push({ ...prediction, iou: best }); continue; }
    if (part.ignore.some(region => overlap(prediction.box, region) >= 0.5 * Math.min(prediction.box[2] * prediction.box[3], region[2] * region[3]))) { ignored.push(prediction); continue; }
    falses.push(prediction);
  }
  return { hits, falses, ignored, missed: open.length };
}

/** What a false box landed on, from the same photo's finished labels. */
function falseKind(box, key, record) {
  const area = box[2] * box[3];
  for (const other of REVIEW_PARTS) {
    const part = record.parts[other.key];
    if (other.key !== key && part.status === STATUS.PRESENT && [...part.boxes, ...part.caps].some(target => overlap(box, target) >= 0.5 * area)) return `ON_${other.key.toUpperCase()}`;
  }
  if (record.parts.battery.hv.some(region => overlap(box, region) >= 0.5 * area)) return 'ON_HIGH_VOLTAGE';
  const own = record.parts[key];
  if (own.status === STATUS.PRESENT && [...own.boxes, ...own.caps].some(target => overlap(box, target) > 0)) return 'NEAR_THE_PART';
  return 'NO_LABELLED_PART';
}

const summary = (tp, fp, fn) => {
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision: fixed(precision), recall: fixed(recall), f1: fixed(f1), precision95: wilson(tp, tp + fp)?.map(fixed) ?? null, recall95: wilson(tp, tp + fn)?.map(fixed) ?? null };
};
const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

/** Compares a finished record with P12-F's draft. Moving an edge a little is still a change, so the IoU travels with it. */
export function changesFromDraft(image, record) {
  const changes = [];
  for (const { key } of REVIEW_PARTS) {
    const draft = draftOf(image, key), part = record.parts[key], what = [];
    if (draft.status !== part.status) what.push(`status ${draft.status} -> ${part.status}`);
    for (const kind of Object.values(BOX_KIND)) {
      const before = draft[kind] ?? [], after = part[kind];
      if (before.length !== after.length) { what.push(`${kind} ${before.length} -> ${after.length}`); continue; }
      const lowest = before.length ? Math.min(...before.map(box => Math.max(...after.map(other => iou(box, other))))) : 1;
      if (lowest < 0.999) what.push(`${kind} moved, lowest IoU ${fixed(lowest)}`);
    }
    if (what.length) changes.push({ imageId: image.id, part: key, partId: part.partId, what });
  }
  return changes;
}

function scorePart({ meta, images, records, answers, threshold }) {
  let tp = 0, fp = 0, fn = 0, ignored = 0, photos = 0, positives = 0;
  const ious = [], falses = {}, cases = [];
  for (const image of images) {
    const record = records[image.id], part = record?.parts[meta.key];
    // Only a finished review, and only a yes or a no. UNKNOWN and NEEDS_REFERENCE are not an absence and stay out.
    if (!part || (part.status !== STATUS.PRESENT && part.status !== STATUS.ABSENT)) continue;
    const predictions = predictionsOf(answers[image.id]).filter(p => p.className === meta.modelClass && p.score >= threshold);
    const r = matchPhoto(predictions, part);
    photos++;
    if (part.status === STATUS.PRESENT) positives++;
    tp += r.hits.length; fp += r.falses.length; fn += r.missed; ignored += r.ignored.length;
    ious.push(...r.hits.map(hit => hit.iou));
    for (const item of r.falses) { const kind = falseKind(item.box, meta.key, record); (falses[kind] ??= []).push({ imageId: image.id, score: fixed(item.score) }); }
    cases.push({ imageId: image.id, tp: r.hits.length, fp: r.falses.length, fn: r.missed, ignored: r.ignored.length });
  }
  return { threshold, photos, positives, ignored, ...summary(tp, fp, fn), iouMean: ious.length ? fixed(ious.reduce((a, b) => a + b, 0) / ious.length) : null, iouMedian: fixed(median(ious)), falseKinds: falses, cases };
}

/** The same rule over P12-F's draft labels, on all its photos or only on the pairs a person has finished, so before and after compare like with like. */
function draftRecord(image) {
  const parts = {};
  for (const { key } of REVIEW_PARTS) { const draft = draftOf(image, key); parts[key] = { status: draft.labelled ? draft.status : STATUS.UNKNOWN, boxes: draft.boxes, caps: draft.caps, ignore: draft.ignore, hv: draft.hv }; }
  return { parts };
}

/**
 * @param images  evaluation set with draft labels @param answers stored model answers @param review the review file, or null
 * Never calls a model. An image whose stored answer is missing is refused rather than scored as nothing found.
 */
export function evaluateReview({ images, answers, review }) {
  const missing = images.filter(image => !answers[image.id]).map(image => image.id);
  if (missing.length) throw new Error(`STORED_ANSWER_MISSING: ${missing.join(', ')}`);
  const progress = progressOf(images, review);
  const synthetic = review?.synthetic === true;
  const finished = {};
  for (const image of images) if (imageState(image, review?.images?.[image.id]) === IMAGE_STATE.HUMAN_REVIEWED) finished[image.id] = review.images[image.id];
  const reviewState = synthetic ? REVIEW_STATE.SYNTHETIC : !progress.reviewed ? REVIEW_STATE.AWAITING : progress.reviewed < progress.total ? REVIEW_STATE.PARTIAL : REVIEW_STATE.DONE;
  const metricState = synthetic ? METRIC_STATE.SYNTHETIC : !progress.reviewed ? METRIC_STATE.PENDING : progress.reviewed < progress.total ? METRIC_STATE.PARTIAL : METRIC_STATE.DONE;
  const drafts = Object.fromEntries(images.map(image => [image.id, draftRecord(image)]));
  const out = { reviewState, metricState, labelsAre: synthetic ? 'SYNTHETIC_TEST_DATA' : 'AS_REVIEWED', rule: { primaryThreshold: PRIMARY_THRESHOLD, iou: IOU_RULE, thresholds: THRESHOLDS, thresholdsAreForReferenceOnly: true }, progress, partStatus: {}, reviewers: [...new Set(Object.values(finished).map(record => record.reviewer))], parts: {}, changes: [] };
  for (const meta of REVIEW_PARTS) {
    const decided = {}; for (const status of Object.values(STATUS)) decided[status] = 0;
    for (const image of images) { const status = finished[image.id]?.parts[meta.key]?.status; if (status) decided[status]++; }
    out.partStatus[meta.key] = decided;
  }
  for (const meta of REVIEW_PARTS) {
    const draftAll = meta.modelClass ? scorePart({ meta, images, records: drafts, answers, threshold: PRIMARY_THRESHOLD }) : null;
    const entry = { partId: meta.partId, modelClass: meta.modelClass, measuredOnly: Boolean(meta.measuredOnly), p12fDraftAllPhotos: draftAll && { ...draftAll, labels: 'UNREVIEWED_DRAFT', cases: undefined } };
    if (!meta.modelClass) { entry.reviewed = 'NO_MODEL_CLASS'; out.parts[meta.key] = entry; continue; }
    if (!progress.reviewed) { entry.reviewed = METRIC_STATE.PENDING; out.parts[meta.key] = entry; continue; }
    const samePairs = {};
    for (const id of Object.keys(finished)) {
      const status = finished[id].parts[meta.key].status;
      if (status === STATUS.PRESENT || status === STATUS.ABSENT) samePairs[id] = drafts[id];
    }
    entry.p12fDraftSamePairs = { ...scorePart({ meta, images, records: samePairs, answers, threshold: PRIMARY_THRESHOLD }), labels: 'UNREVIEWED_DRAFT', cases: undefined };
    entry.reviewed = { scope: metricState, ...scorePart({ meta, images, records: finished, answers, threshold: PRIMARY_THRESHOLD }) };
    entry.byThreshold = THRESHOLDS.map(threshold => { const { tp, fp, fn, precision, recall, f1 } = scorePart({ meta, images, records: finished, answers, threshold }); return { threshold, tp, fp, fn, precision, recall, f1, primary: threshold === PRIMARY_THRESHOLD }; });
    out.parts[meta.key] = entry;
  }
  for (const image of images) if (finished[image.id]) out.changes.push(...changesFromDraft(image, finished[image.id]));
  out.changedParts = out.changes.length;
  return out;
}
export { PART_KEYS };
