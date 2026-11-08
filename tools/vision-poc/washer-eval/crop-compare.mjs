// P13-C: the P13-A product crop against the P13-B evaluation crops, on the same photo and region. Pure geometry; no image, no call.
//   A product:  the P13-A washer profile as shipped (read from ANALYSIS_PROFILES, so it cannot drift)
//   B eval-40:  P13-B evaluation arm, margin 0.4, minimum 64px
//   C eval-80:  P13-B evaluation arm, margin 0.8, minimum 64px
import { contextCropPlan } from '../../mobile-ar-poc/public/context-crop.mjs';
import { ANALYSIS_PROFILES } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { CROP_BASE, PART_ID } from './washer-eval-model.mjs';

export const ARMS = Object.freeze({
  A_PRODUCT: Object.freeze({ ...ANALYSIS_PROFILES[PART_ID].crop }),
  B_EVAL_40: Object.freeze({ ...CROP_BASE, margin: 0.4 }),
  C_EVAL_80: Object.freeze({ ...CROP_BASE, margin: 0.8 }),
});
/** Classes of the real detector that look like a cap or a fluid tank. Their boxes are detector output, not labels. */
export const CONFUSABLE = Object.freeze(['Engine Coolant Reservoir', 'Brake Fluid', 'Radiator Cap', 'Engine Oil Fill Cap', 'Power Steering Reservoir', 'Clutch Fluid Reservoir', 'Inverter Coolant Reservoir', 'Secondary Coolant Reservoir', 'Intercooler Coolant Reservoir', 'ATF Oil Reservoir']);
export const CONFUSABLE_MIN_SCORE = 0.25;

const round = (n, d = 4) => Number(n.toFixed(d));
const overlapShare = (inner, outer) => {
  const x = Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x));
  const y = Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y));
  return (x * y) / (inner.width * inner.height);
};

/** One crop's facts. `others` are other-class detections in pixels: { className, score, x, y, width, height } (top-left). */
export function cropFacts(source, box, options, others = []) {
  const plan = contextCropPlan(source, box, options);
  const W = source.width, H = source.height;
  const bx = box[0] * W, by = box[1] * H, bw = Math.max(box[2] * W, 1), bh = Math.max(box[3] * H, 1);
  const r = plan.rect;
  const minSide = Math.max(options.minSidePx, options.minShortSideFraction * Math.min(W, H));
  const wanted = { width: bw * (1 + 2 * options.margin), height: bh * (1 + 2 * options.margin) };
  const contains = r.x <= bx + 1e-6 && r.y <= by + 1e-6 && r.x + r.width >= bx + bw - 1e-6 && r.y + r.height >= by + bh - 1e-6;
  const inView = others.filter(o => overlapShare(o, r) >= 0.5);
  return {
    rect: r, output: plan.output, scaled: plan.scale < 1,
    targetShare: round((bw * bh) / (r.width * r.height)), // how much of the crop is the part
    contextFactor: round((r.width * r.height) / (bw * bh), 2), // crop area per part area
    contextPerSide: { left: round((bx - r.x) / bw, 2), right: round((r.x + r.width - bx - bw) / bw, 2), top: round((by - r.y) / bh, 2), bottom: round((r.y + r.height - by - bh) / bh, 2) },
    minimumDecided: { width: wanted.width < minSide && r.width > Math.ceil(wanted.width), height: wanted.height < minSide && r.height > Math.ceil(wanted.height) },
    shiftedAtEdge: plan.shifted, limitedByImage: plan.limitedByImage,
    containsPart: contains,
    confusableInView: inView.map(o => ({ className: o.className, score: round(o.score, 3) })),
  };
}

/** The three arms for one photo, and how they relate. */
export function compareArms(source, box, others = []) {
  const arms = Object.fromEntries(Object.entries(ARMS).map(([key, options]) => [key, cropFacts(source, box, options, others)]));
  const same = (a, b) => JSON.stringify(arms[a].rect) === JSON.stringify(arms[b].rect);
  return {
    arms,
    productEqualsEval80: same('A_PRODUCT', 'C_EVAL_80'),
    productEqualsEval40: same('A_PRODUCT', 'B_EVAL_40'),
    productAreaOverEval80: round((arms.A_PRODUCT.rect.width * arms.A_PRODUCT.rect.height) / (arms.C_EVAL_80.rect.width * arms.C_EVAL_80.rect.height), 2),
  };
}

/** Other-class detections of a stored real answer, in pixels of the oriented photo. */
export function confusablesOf(answer, source) {
  if (!answer) return [];
  const sx = source.width / answer.image.width, sy = source.height / answer.image.height;
  return answer.predictions.filter(p => CONFUSABLE.includes(p.class) && p.confidence >= CONFUSABLE_MIN_SCORE)
    .map(p => ({ className: p.class, score: p.confidence, x: (p.x - p.width / 2) * sx, y: (p.y - p.height / 2) * sy, width: p.width * sx, height: p.height * sy }));
}

const median = values => { const v = [...values].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
/** Totals over photos. */
export function summarize(rows) {
  const per = key => {
    const facts = rows.map(r => r.comparison.arms[key]);
    return {
      photos: facts.length,
      outputLongSide: { min: Math.min(...facts.map(f => Math.max(f.output.width, f.output.height))), median: median(facts.map(f => Math.max(f.output.width, f.output.height))), max: Math.max(...facts.map(f => Math.max(f.output.width, f.output.height))) },
      targetShareMedian: round(median(facts.map(f => f.targetShare))),
      contextFactorMedian: round(median(facts.map(f => f.contextFactor)), 2),
      minimumDecided: facts.filter(f => f.minimumDecided.width || f.minimumDecided.height).length,
      shiftedAtEdge: facts.filter(f => f.shiftedAtEdge).length,
      limitedByImage: facts.filter(f => f.limitedByImage).length,
      containsPart: facts.filter(f => f.containsPart).length,
      withConfusableInView: facts.filter(f => f.confusableInView.length).length,
      below64: facts.filter(f => Math.min(f.output.width, f.output.height) < 64).length,
    };
  };
  return {
    arms: Object.fromEntries(Object.keys(ARMS).map(key => [key, per(key)])),
    productEqualsEval80: rows.filter(r => r.comparison.productEqualsEval80).length,
    productEqualsEval40: rows.filter(r => r.comparison.productEqualsEval40).length,
    productAreaOverEval80Median: median(rows.map(r => r.comparison.productAreaOverEval80)),
  };
}
