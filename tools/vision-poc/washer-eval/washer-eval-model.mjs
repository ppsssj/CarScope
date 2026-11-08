// P13-B: the washer cap vision evaluation. Pure rules shared by the truth page, the scripts and the tests. No file, no network.
// What a person answers about a photo, what that means the analysis should say, which calls may be planned, and how a run is scored.
// Criteria: docs/p13-b-washer-vision-eval-criteria.md. Nothing here turns a draft, an assisted candidate or a fixture into an answer.
import { ASSESSMENT, PART_MATCH, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';

export const TRUTH_SCHEMA = 'carscope-washer-truth-v1';
export const PART_ID = 'washer-fluid-cap';
/** Compared on the same photo and region. 0.4 is the P13-A default, 0.8 the washer profile. Neither is tuned. */
export const MARGINS = Object.freeze([0.4, 0.8]);
export const MARGIN_KEYS = Object.freeze({ 0.4: 'm40', 0.8: 'm80' });
/**
 * The P13-A washer profile's crop options without the margin. On the ~1280px evaluation photos its minimum size decides the crop, so 40% and
 * 80% give the same pixels for 11 of 12 candidate regions (prepare --candidates). Reported, not called: identical input measures nothing.
 */
export const PRODUCT_CROP = Object.freeze({ minSidePx: 320, minShortSideFraction: 0.35, maxOutputSide: 1024, jpegQuality: 0.9 });
/**
 * What the comparison sends: the same code and output limits, with the minimum lowered to the relay's smallest accepted side (64px),
 * so the margin alone changes the crop. An evaluation arm, not a product setting: P13-A is unchanged.
 */
export const CROP_BASE = Object.freeze({ minSidePx: 64, minShortSideFraction: 0, maxOutputSide: 1024, jpegQuality: 0.9 });
export const ROUTE_MIN_SIDE = 64;

export const IDENTIFICATION = Object.freeze({ WASHER_CAP: 'WASHER_CAP', NOT_WASHER_CAP: 'NOT_WASHER_CAP', UNKNOWN: 'UNKNOWN' });
export const YES_NO = Object.freeze({ YES: 'YES', NO: 'NO', UNKNOWN: 'UNKNOWN' });
export const JUDGEABLE = Object.freeze({ JUDGEABLE: 'JUDGEABLE', NOT_JUDGEABLE: 'NOT_JUDGEABLE', UNKNOWN: 'UNKNOWN' });
export const PERSONAL_DATA = Object.freeze({ NONE_VISIBLE: 'NONE_VISIBLE', VISIBLE: 'VISIBLE', UNKNOWN: 'UNKNOWN' });
/** Where a region comes from. A stored real detection, or a box a person drew or confirmed. A fixture is neither and is refused. */
export const REGION_SOURCE = Object.freeze({ DETECTION: 'DETECTION', HUMAN: 'HUMAN', NONE: 'NONE' });
export const DETECTION_REF = 'engine-bay-parts/1@p12-f/run1/answers.json';
// Each truth field answers one issue code of the P13-A washer profile.
export const ISSUE_FIELDS = Object.freeze({ capMissing: 'CAP_MISSING_SUSPECTED', capOpen: 'CAP_OPEN_SUSPECTED', capDamage: 'CAP_OR_NECK_DAMAGE_SUSPECTED' });
export const TRUTH_STATE = Object.freeze({ UNREVIEWED: 'UNREVIEWED', IN_PROGRESS: 'IN_PROGRESS', HUMAN_REVIEWED: 'HUMAN_REVIEWED', INVALIDATED: 'INVALIDATED' });

const finite = (...values) => values.every(Number.isFinite);
export const isBox = box => Array.isArray(box) && box.length === 4 && finite(...box) && box[0] >= 0 && box[1] >= 0 && box[2] >= 0.002 && box[3] >= 0.002 && box[0] + box[2] <= 1.0001 && box[1] + box[3] <= 1.0001;
const oneOf = (value, values) => Object.values(values).includes(value);
const TEXT_LIMIT = 500;

// ---- Regions -------------------------------------------------------------------------------------------------------
/**
 * Washer cap candidates from a stored real answer, as P13-A would show them (same class, score, overlap rules).
 * @param candidatesFor the P12-E function, passed in so this file stays free of the mobile module graph.
 */
export function detectionRegions(answer, candidatesFor, parse) {
  if (!answer) return [];
  return candidatesFor(PART_ID, parse(answer)).map((candidate, index) => Object.freeze({ index, score: Number(candidate.score.toFixed(4)), box: candidate.box.map(n => Number(n.toFixed(6))) }));
}

/** Problems with a region record. A DETECTION region must be one the stored answer really has. */
export function regionProblems(region, detections) {
  if (!region || !oneOf(region.source, REGION_SOURCE)) return ['region source'];
  if (region.source === REGION_SOURCE.NONE) return region.box == null ? [] : ['no box when no region'];
  if (!isBox(region.box)) return ['region box'];
  if (region.source === REGION_SOURCE.DETECTION) {
    const found = detections[region.detectionIndex];
    if (!found || found.box.some((n, i) => Math.abs(n - region.box[i]) > 1e-6)) return ['not a stored detection'];
  }
  return [];
}

// ---- Truth records -------------------------------------------------------------------------------------------------
export const emptyTruth = () => ({
  region: { source: REGION_SOURCE.NONE, box: null, detectionIndex: null },
  identification: null, capMissing: null, capOpen: null, capDamage: null, judgeable: null, personalData: null, note: '',
});

/** Problems with what the page sends. `complete` needs every answer; a draft save needs only a reviewer and a sane shape. */
export function truthProblems(body, { detections = [], cropRects = null } = {}) {
  const problems = [];
  if (!body || typeof body !== 'object') return ['body'];
  if (typeof body.reviewer !== 'string' || !body.reviewer.trim() || body.reviewer.length > 80) problems.push('reviewer');
  if (typeof body.complete !== 'boolean') problems.push('complete');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) problems.push('expectedRevision');
  const t = body.truth;
  if (!t || typeof t !== 'object') return [...problems, 'truth'];
  problems.push(...regionProblems(t.region, detections));
  const fields = [['identification', IDENTIFICATION], ['capMissing', YES_NO], ['capOpen', YES_NO], ['capDamage', YES_NO], ['judgeable', JUDGEABLE], ['personalData', PERSONAL_DATA]];
  for (const [key, values] of fields) if (t[key] !== null && !oneOf(t[key], values)) problems.push(key);
  if (typeof t.note !== 'string' || t.note.length > TEXT_LIMIT) problems.push('note');
  if (body.complete) {
    for (const [key] of fields) if (t[key] === null) problems.push(`${key} unanswered`);
    // Without a region nothing can be cropped or sent: only "the cap is not visible here" may go without one.
    if (t.region?.source === REGION_SOURCE.NONE && t.identification !== IDENTIFICATION.UNKNOWN) problems.push('a region, or identification UNKNOWN');
    if (t.region?.source !== REGION_SOURCE.NONE && !cropRects) problems.push('crop previews not seen');
    if (cropRects && !MARGINS.every(m => isRect(cropRects[MARGIN_KEYS[m]]))) problems.push('crop rects');
    if (t.identification === IDENTIFICATION.NOT_WASHER_CAP && Object.keys(ISSUE_FIELDS).some(k => t[k] === YES_NO.YES)) problems.push('a cap issue on what is not the cap');
  }
  return problems;
}
const isRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isInteger) && r.width > 0 && r.height > 0;

export function truthState(image, record) {
  if (!record) return TRUTH_STATE.UNREVIEWED;
  if (record.imageSha256 !== image.sha256) return TRUTH_STATE.INVALIDATED;
  return record.complete ? TRUTH_STATE.HUMAN_REVIEWED : TRUTH_STATE.IN_PROGRESS;
}

export function truthFileProblems(file, images) {
  const problems = [];
  if (!file || file.schema !== TRUTH_SCHEMA || typeof file.synthetic !== 'boolean' || !file.images || typeof file.images !== 'object') return ['schema'];
  const ids = new Set(images.map(image => image.id));
  for (const [id, record] of Object.entries(file.images)) {
    if (!ids.has(id)) { problems.push(`${id}: not in the set`); continue; }
    if (typeof record.imageSha256 !== 'string' || typeof record.reviewer !== 'string' || !Number.isInteger(record.revision)) problems.push(`${id}: record fields`);
    const body = { reviewer: record.reviewer, complete: record.complete, expectedRevision: 0, truth: record.truth };
    const found = truthProblems(body, { detections: record.detections ?? [], cropRects: record.cropRects ?? null });
    if (found.length) problems.push(`${id}: ${found.join(', ')}`);
  }
  return problems;
}

// ---- What the analysis should say ----------------------------------------------------------------------------------
/**
 * The answer a careful analysis would give, from a person's truth. `null` parts are not scored.
 *   match: expected partMatch family; state: expected assessment or null when the truth leaves it open.
 */
export function expectedOf(truth) {
  if (!truth || truth.region?.source === REGION_SOURCE.NONE) return { scored: false, match: null, state: null, issues: null, reason: 'NO_REGION' };
  const issues = Object.fromEntries(Object.entries(ISSUE_FIELDS).map(([field, code]) => [code, truth[field]]));
  if (truth.identification === IDENTIFICATION.UNKNOWN) return { scored: true, match: null, state: null, issues, reason: 'IDENTIFICATION_UNKNOWN' };
  if (truth.identification === IDENTIFICATION.NOT_WASHER_CAP) return { scored: true, match: PART_MATCH.NOT_MATCH, state: ASSESSMENT.WRONG_PART, issues, reason: 'NOT_THE_CAP' };
  if (truth.judgeable === JUDGEABLE.NOT_JUDGEABLE) return { scored: true, match: PART_MATCH.LIKELY_MATCH, state: ASSESSMENT.INDETERMINATE, issues, reason: 'NOT_JUDGEABLE' };
  const values = Object.values(issues);
  const state = truth.judgeable !== JUDGEABLE.JUDGEABLE ? null
    : values.includes(YES_NO.YES) ? ASSESSMENT.SUSPECTED_ISSUE
      : values.every(v => v === YES_NO.NO) ? ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED : null;
  return { scored: true, match: PART_MATCH.LIKELY_MATCH, state, issues, reason: state ? 'DECIDED' : 'STATE_UNKNOWN' };
}

// ---- Which calls may be planned ------------------------------------------------------------------------------------
/** An image may be sent only with a completed truth, a region, a person's "no plate or person in the crops", and prepared crops whose rects match. */
export function eligibility(image, record, prepared) {
  const reasons = [];
  if (truthState(image, record) !== TRUTH_STATE.HUMAN_REVIEWED) reasons.push('TRUTH_NOT_COMPLETE');
  else {
    if (record.truth.region.source === REGION_SOURCE.NONE) reasons.push('NO_REGION');
    if (record.truth.personalData !== PERSONAL_DATA.NONE_VISIBLE) reasons.push('PERSONAL_DATA_NOT_CLEARED');
    for (const margin of MARGINS) {
      const key = MARGIN_KEYS[margin], crop = prepared?.[key];
      if (!crop) reasons.push(`CROP_${key}_NOT_PREPARED`);
      else if (JSON.stringify(crop.rect) !== JSON.stringify(record.cropRects?.[key])) reasons.push(`CROP_${key}_DIFFERS_FROM_REVIEWED`);
      else if (Math.min(crop.output.width, crop.output.height) < ROUTE_MIN_SIDE) reasons.push(`CROP_${key}_BELOW_ROUTE_MINIMUM`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Calls in pairs (both margins of one photo), so a comparison is never half done. Stops at the budget.
 * Photos whose two crops are byte-identical (the picture limits both) get one call, used for both margins, and come after real pairs.
 * @returns {{ calls: {imageId, margin, sameCrop}[], skipped: {imageId, reasons}[], pairsDropped: number }}
 */
export function planCalls(images, truthFile, prepared, budget) {
  if (!Number.isInteger(budget) || budget < 0) throw new Error('BUDGET_INVALID');
  const calls = [], skipped = [], ready = [];
  let pairsDropped = 0;
  for (const image of images) {
    const check = eligibility(image, truthFile.images[image.id], prepared[image.id]);
    if (!check.eligible) { skipped.push({ imageId: image.id, reasons: check.reasons }); continue; }
    const p = prepared[image.id];
    ready.push({ imageId: image.id, same: p[MARGIN_KEYS[MARGINS[0]]].sha256 === p[MARGIN_KEYS[MARGINS[1]]].sha256 });
  }
  ready.sort((a, b) => Number(a.same) - Number(b.same)); // stable: manifest order within each group
  for (const { imageId, same } of ready) {
    const needed = same ? 1 : MARGINS.length;
    if (calls.length + needed > budget) { pairsDropped++; continue; }
    if (same) calls.push({ imageId, margin: MARGINS[0], sameCrop: true });
    else for (const margin of MARGINS) calls.push({ imageId, margin, sameCrop: false });
  }
  return { calls, skipped, pairsDropped };
}

// ---- Scoring a run -------------------------------------------------------------------------------------------------
const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]; };
const ratio = (n, d) => (d ? Number((n / d).toFixed(4)) : null);
/** Wilson 95% interval: with a handful of calls it is wide on purpose. */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Number(((c - m) / d).toFixed(4)), Number(((c + m) / d).toFixed(4))];
}

/** Cost from the provider's own token counts and a price a person wrote down with its source. No price, no cost. */
export function costOf(usage, price) {
  if (!usage || !finite(usage.input_tokens, usage.output_tokens)) return null;
  if (!price || !finite(price.inputPerMillionUsd, price.outputPerMillionUsd)) return null;
  return (usage.input_tokens * price.inputPerMillionUsd + usage.output_tokens * price.outputPerMillionUsd) / 1e6;
}

/**
 * @param records one per call: { imageId, margin, raw | null, errorCode | null, latencyMs, usage | null }
 * @param truth   imageId -> truth (completed records only)
 */
export function scoreRun(input, truth, { price = null } = {}) {
  // One call on a byte-identical crop answers for both margins. Latency, tokens and cost count it once.
  const records = input.flatMap(r => (r.sameCrop ? MARGINS.map(margin => ({ ...r, margin, mirrored: margin !== r.margin })) : [r]));
  const byMargin = {};
  for (const margin of MARGINS) {
    const rows = records.filter(r => r.margin === margin);
    const checked = rows.map(r => ({ ...r, check: r.raw === null || r.raw === undefined ? { ok: false, reason: r.errorCode ?? 'NO_ANSWER' } : validateAnalysisResult(PART_ID, r.raw), expected: expectedOf(truth[r.imageId]) }));
    const valid = checked.filter(r => r.check.ok);
    const matchRows = valid.filter(r => r.expected.match);
    const matched = matchRows.filter(r => r.check.result.partMatch === r.expected.match).length;
    const uncertain = matchRows.filter(r => r.check.result.partMatch === PART_MATCH.UNCERTAIN).length;
    const stateRows = valid.filter(r => r.expected.state);
    const stateAgree = stateRows.filter(r => r.check.result.assessment === r.expected.state).length;
    // A suspicion is unsupported when the person answered NO for that issue, or said it is not the cap, or not judgeable.
    const unsupported = [];
    for (const r of valid) for (const issue of r.check.result.suspectedIssues) {
      const t = truth[r.imageId], answer = r.expected.issues?.[issue.code];
      if (answer === YES_NO.NO || t?.identification === IDENTIFICATION.NOT_WASHER_CAP || t?.judgeable === JUDGEABLE.NOT_JUDGEABLE) unsupported.push({ imageId: r.imageId, code: issue.code, truth: answer ?? null });
    }
    const own = rows.filter(r => !r.mirrored);
    const latencies = own.map(r => r.latencyMs).filter(Number.isFinite);
    const costs = own.map(r => costOf(r.usage, price));
    const known = costs.filter(c => c !== null);
    byMargin[MARGIN_KEYS[margin]] = {
      margin, calls: rows.length,
      schema: { valid: valid.length, rate: ratio(valid.length, rows.length), failures: Object.entries(checked.filter(r => !r.check.ok).reduce((m, r) => ({ ...m, [r.check.reason]: (m[r.check.reason] ?? 0) + 1 }), {})).map(([reason, count]) => ({ reason, count })) },
      partMatch: { scored: matchRows.length, agree: matched, rate: ratio(matched, matchRows.length), interval: wilson(matched, matchRows.length), uncertain },
      state: { scored: stateRows.length, agree: stateAgree, rate: ratio(stateAgree, stateRows.length), interval: wilson(stateAgree, stateRows.length) },
      unsupportedSuspicions: { count: unsupported.length, items: unsupported },
      indeterminate: { count: valid.filter(r => r.check.result.assessment === ASSESSMENT.INDETERMINATE).length, rate: ratio(valid.filter(r => r.check.result.assessment === ASSESSMENT.INDETERMINATE).length, valid.length) },
      latencyMs: { median: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: latencies.length ? Math.max(...latencies) : null },
      sameCropRows: rows.filter(r => r.sameCrop).length,
      tokens: { input: sum(own, r => r.usage?.input_tokens), output: sum(own, r => r.usage?.output_tokens) },
      costUsd: { total: known.length === own.length && own.length ? Number(known.reduce((a, b) => a + b, 0).toFixed(6)) : null, status: !price ? 'PRICE_NOT_CONFIGURED' : known.length === own.length ? 'COMPUTED' : 'USAGE_MISSING' },
    };
  }
  // Same photo, both margins: where they disagree is what the comparison is for.
  const pairs = [...new Set(records.map(r => r.imageId))].map(imageId => {
    const [a, b] = MARGINS.map(m => records.find(r => r.imageId === imageId && r.margin === m));
    const result = r => { const c = r && r.raw != null ? validateAnalysisResult(PART_ID, r.raw) : null; return c?.ok ? `${c.result.partMatch}/${c.result.assessment}` : 'INVALID'; };
    return { imageId, sameCrop: Boolean(a?.sameCrop), m40: result(a), m80: result(b), differ: result(a) !== result(b) };
  });
  const costs = input.map(r => costOf(r.usage, price));
  return {
    byMargin,
    calls: { total: input.length, sameCrop: input.filter(r => r.sameCrop).length, inputTokens: sum(input, r => r.usage?.input_tokens), outputTokens: sum(input, r => r.usage?.output_tokens), costUsd: input.length && costs.every(c => c !== null) ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null },
    // Only pairs with two different crops say anything about the margin.
    pairs: { total: pairs.length, compared: pairs.filter(p => !p.sameCrop).length, differ: pairs.filter(p => p.differ && !p.sameCrop).length, items: pairs },
  };
}
const sum = (rows, pick) => { const values = rows.map(pick).filter(Number.isFinite); return values.length === rows.length && rows.length ? values.reduce((a, b) => a + b, 0) : null; };

/** The pre-registered gates. Thresholds are in the criteria document and repeated here so code and text cannot drift apart unnoticed. */
export const GATES = Object.freeze({ schemaRate: 1, unsupportedSuspicions: 0, minScoredForAccuracy: 30 });
export function gateResults(score) {
  return Object.fromEntries(Object.entries(score.byMargin).map(([key, m]) => [key, {
    SCHEMA_ALL_VALID: m.calls === 0 ? 'NOT_RUN' : m.schema.rate === GATES.schemaRate ? 'PASS' : 'FAIL',
    NO_UNSUPPORTED_SUSPICION: m.calls === 0 ? 'NOT_RUN' : m.unsupportedSuspicions.count === GATES.unsupportedSuspicions ? 'PASS' : 'FAIL',
    // Accuracy is reported, never passed, until enough reviewed photos exist.
    ACCURACY: m.partMatch.scored < GATES.minScoredForAccuracy ? 'INSUFFICIENT_SAMPLE' : 'REPORTED',
  }]));
}
