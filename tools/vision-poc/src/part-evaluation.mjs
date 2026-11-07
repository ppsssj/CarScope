// P12-F: scores one model class against the labels of dataset/p12-f-bonnet-parts.json. Pure, so it is tested without the model.
// A photo counts for a part only if the part was judged on that photo. Unknown stays out: not a miss and not a false box.
import { iou } from './evaluate.mjs';
import { wilson } from './exploratory.mjs';

export { wilson };
const isInside = (x, y, [bx, by, bw, bh]) => x >= bx && x <= bx + bw && y >= by && y <= by + bh;
const area = ([, , w, h]) => w * h;
const overlap = (a, b) => { const x = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), y = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return x > 0 && y > 0 ? x * y : 0; };

/** Normalised boxes [left, top, width, height] of one class, from a stored Roboflow answer. */
export function boxesOf(raw, className) {
  const { width: W, height: H } = raw.image;
  return raw.predictions.filter(p => p.class === className).map(p => ({ score: p.confidence, box: [(p.x - p.width / 2) / W, (p.y - p.height / 2) / H, p.width / W, p.height / H] })).sort((a, b) => b.score - a.score);
}

export const MATCH = Object.freeze({
  /** IoU of at least 0.5 with the whole part, or with its cap when one is labelled. */
  strict: (box, whole, caps = []) => [whole, ...caps].some(target => iou(box, target) >= 0.5),
  /** Points at the right place: centre inside the part or its cap, and not hugely larger than the part. Never reported as if it were the strict figure. */
  location: (box, whole, caps = []) => {
    const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
    return [whole, ...caps].some(target => isInside(cx, cy, target)) && area(box) <= 4 * area(whole);
  },
});

/** Greedy by score, as a person would read the list. One prediction takes one part; extras on a found part count as false. */
export function scorePhoto(predictions, label, matches) {
  const open = label.boxes.map((whole, i) => ({ whole, caps: i === 0 ? label.caps ?? [] : [] }));
  let tp = 0, fp = 0, ignored = 0;
  for (const { box } of predictions) {
    const at = open.findIndex(({ whole, caps }) => matches(box, whole, caps));
    if (at >= 0) { open.splice(at, 1); tp++; continue; }
    if ((label.ignore ?? []).some(region => overlap(box, region) >= 0.5 * Math.min(area(box), area(region)))) { ignored++; continue; }
    fp++;
  }
  return { tp, fp, fn: open.length, ignored };
}

export function scoreClass({ images, answers, part, className, threshold, match = 'strict' }) {
  let tp = 0, fp = 0, fn = 0, ignored = 0, photos = 0, positives = 0;
  const cases = [];
  for (const image of images) {
    const label = image.parts?.[part], raw = answers[image.id];
    if (!label || !raw) continue;
    const predictions = boxesOf(raw, className).filter(p => p.score >= threshold);
    const r = scorePhoto(predictions, label, MATCH[match]);
    tp += r.tp; fp += r.fp; fn += r.fn; ignored += r.ignored; photos++;
    if (label.boxes.length) positives++;
    cases.push({ id: image.id, vehicle: image.vehicle, top: predictions[0]?.score ?? null, ...r });
  }
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  return { part, className, match, threshold, photos, positives, tp, fp, fn, ignored, precision, recall, precision95: wilson(tp, tp + fp), recall95: wilson(tp, tp + fn), cases };
}

/** Where boxes of a class really land: on which labelled part of the same photo. Answers "does it mistake one part for another". */
export function confusions({ images, answers, classes, threshold }) {
  const table = {};
  for (const image of images) {
    const raw = answers[image.id];
    if (!raw) continue;
    for (const [part, className] of Object.entries(classes)) {
      for (const { box, score } of boxesOf(raw, className).filter(p => p.score >= threshold)) {
        const hits = [];
        for (const [other, label] of Object.entries(image.parts ?? {})) {
          if (other === 'hv') { if (label.some(region => overlap(box, region) >= 0.5 * area(box))) hits.push('hv'); continue; }
          if (label.boxes.some(whole => overlap(box, whole) >= 0.5 * area(box))) hits.push(other);
        }
        const row = (table[part] ??= {});
        for (const hit of hits.length ? hits : ['elsewhere']) (row[hit] ??= []).push({ id: image.id, score: Number(score.toFixed(3)) });
      }
    }
  }
  return table;
}

/** Cap or whole part: how large the boxes are against the labelled part, for boxes that point at it. */
export function sizeAgainstPart({ images, answers, part, className, threshold }) {
  const ratios = [];
  for (const image of images) {
    const label = image.parts?.[part], raw = answers[image.id];
    if (!label?.boxes.length || !raw) continue;
    for (const { box } of boxesOf(raw, className).filter(p => p.score >= threshold)) {
      const whole = label.boxes.find(target => MATCH.location(box, target, label.caps));
      if (whole) ratios.push(Number((area(box) / area(whole)).toFixed(2)));
    }
  }
  ratios.sort((a, b) => a - b);
  return { count: ratios.length, median: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null, min: ratios[0] ?? null, max: ratios.at(-1) ?? null };
}
