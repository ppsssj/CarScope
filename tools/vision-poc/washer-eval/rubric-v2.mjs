// P13-C: a proposed, versioned washer result with item-level visibility (schemaVersion 2). Evaluation only: the P13-A route, page and
// validator keep schema v1 and are unchanged. A v2 answer is checked here, then projected to v1, which must pass validateAnalysisResult.
// The verdict is derived from the items, so "what was seen" and "what was concluded" cannot drift apart without being detected.
import { ASSESSMENT, buildAnalysisPrompt, PART_MATCH, RESULT_LIMITS, analysisJsonSchema, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { RUBRIC_V1 } from './consistency.mjs';

export const SCHEMA_VERSION = 2;
export const PROMPT_VERSION_V2 = 'p13-c-rubric-1';
export const ITEM_STATUS = Object.freeze({ OK: 'OBSERVED_OK', ISSUE: 'OBSERVED_ISSUE', PARTIAL: 'PARTIALLY_VISIBLE', HIDDEN: 'NOT_VISIBLE', NA: 'NOT_APPLICABLE' });
/** Washer items. `issue` is the P13-A code an OBSERVED_ISSUE stands for. */
export const ITEMS = Object.freeze({
  capPresence: { issue: 'CAP_MISSING_SUSPECTED', core: true, ask: 'Is a cap seated on the filler opening?' },
  capClosure: { issue: 'CAP_OPEN_SUSPECTED', core: true, ask: 'Is the cap closed (not flipped open or lifted)?' },
  capBody: { issue: 'CAP_OR_NECK_DAMAGE_SUSPECTED', core: true, ask: 'Is the visible cap body free of cracks or breaks?' },
  neck: { issue: 'CAP_OR_NECK_DAMAGE_SUSPECTED', core: false, ask: 'Is the visible filler neck free of cracks or breaks?' },
});
const ITEM_KEYS = Object.keys(ITEMS);
const isCore = (key, rubric) => ITEMS[key].core || (key === 'neck' && rubric.neckCore);

/**
 * The verdict the items imply. Pure; the written rubric in code.
 *   NOT_MATCH -> WRONG_PART. UNCERTAIN -> INDETERMINATE (no state judgement).
 *   Any OBSERVED_ISSUE -> SUSPECTED_ISSUE.
 *   Any core item PARTIALLY_VISIBLE or NOT_VISIBLE -> INDETERMINATE.
 *   Otherwise NO_VISIBLE_ISSUE_DETECTED; secondary items not fully seen must be named in limitations.
 */
export function deriveAssessment(partMatch, items, rubric = RUBRIC_V1) {
  if (partMatch === PART_MATCH.NOT_MATCH) return ASSESSMENT.WRONG_PART;
  if (partMatch === PART_MATCH.UNCERTAIN) return ASSESSMENT.INDETERMINATE;
  const status = key => items[key]?.status;
  if (ITEM_KEYS.some(key => status(key) === ITEM_STATUS.ISSUE)) return ASSESSMENT.SUSPECTED_ISSUE;
  if (ITEM_KEYS.some(key => isCore(key, rubric) && [ITEM_STATUS.PARTIAL, ITEM_STATUS.HIDDEN].includes(status(key)))) return ASSESSMENT.INDETERMINATE;
  return ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED;
}

const item = { type: 'object', additionalProperties: false, required: ['status', 'evidence'], properties: { status: { type: 'string', enum: Object.values(ITEM_STATUS) }, evidence: { type: 'string' } } };
/** v1 schema plus `schemaVersion` and `itemChecks`. Strict-mode shaped like v1. */
export function analysisJsonSchemaV2(partId = 'washer-fluid-cap') {
  const v1 = analysisJsonSchema(partId);
  return { ...v1, required: [...v1.required, 'schemaVersion', 'itemChecks'], properties: { ...v1.properties, schemaVersion: { type: 'integer', enum: [SCHEMA_VERSION] }, itemChecks: { type: 'object', additionalProperties: false, required: ITEM_KEYS, properties: Object.fromEntries(ITEM_KEYS.map(k => [k, item])) } } };
}

/** The v1 prompt with the rubric added. The P13-A prompt itself is not changed. */
export function buildAnalysisPromptV2(partId, context, rubric = RUBRIC_V1) {
  const v1 = buildAnalysisPrompt(partId, context);
  const lines = [
    `Rubric ${rubric.id}. Fill itemChecks first, then derive assessment from it exactly:`,
    ...ITEM_KEYS.map(k => `- ${k} (${isCore(k, rubric) ? 'core' : 'secondary'}): ${ITEMS[k].ask}`),
    'Statuses: OBSERVED_OK, OBSERVED_ISSUE (only with a concrete visible sign, written in evidence), PARTIALLY_VISIBLE, NOT_VISIBLE, NOT_APPLICABLE (closure and cap body only, when the cap is missing).',
    'If partMatch is NOT_MATCH: WRONG_PART. If UNCERTAIN: INDETERMINATE. Else any OBSERVED_ISSUE: SUSPECTED_ISSUE. Else any core item PARTIALLY_VISIBLE or NOT_VISIBLE: INDETERMINATE with a retake instruction. Else NO_VISIBLE_ISSUE_DETECTED.',
    'A secondary item that is not fully visible does not make the result INDETERMINATE; name it in limitations.',
    'Write evidence in Korean, at most 200 characters, describing only what is visible.',
  ];
  return { ...v1, instructions: `${v1.instructions}\n${lines.join('\n')}`, schema: analysisJsonSchemaV2(partId), promptVersion: PROMPT_VERSION_V2 };
}

/** Drops the v2 fields. What any v1 client would receive. */
export const toV1 = ({ schemaVersion, itemChecks, ...v1 }) => v1;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/**
 * { ok, result, v1, reasons } — v1 validation first (unchanged rules), then the item rules. Any failure refuses the whole answer.
 * Reasons are codes. `derived` is reported so a mismatch shows what the items implied.
 */
export function validateV2(partId, raw, rubric = RUBRIC_V1) {
  const reasons = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reasons: ['NOT_OBJECT'] };
  if (raw.schemaVersion !== SCHEMA_VERSION) reasons.push('SCHEMA_VERSION');
  const items = raw.itemChecks;
  if (!items || typeof items !== 'object' || Object.keys(items).sort().join() !== [...ITEM_KEYS].sort().join()) return { ok: false, reasons: [...reasons, 'ITEM_KEYS'] };
  for (const key of ITEM_KEYS) {
    const it = items[key];
    if (!it || Object.keys(it).sort().join() !== 'evidence,status' || !Object.values(ITEM_STATUS).includes(it.status)) { reasons.push(`ITEM_${key}`); continue; }
    if (typeof it.evidence !== 'string' || it.evidence.length > RESULT_LIMITS.textChars || CONTROL.test(it.evidence)) reasons.push(`ITEM_${key}_EVIDENCE`);
    if (it.status === ITEM_STATUS.ISSUE && !it.evidence.trim()) reasons.push(`ITEM_${key}_ISSUE_WITHOUT_EVIDENCE`);
  }
  const v1 = validateAnalysisResult(partId, toV1(raw));
  if (!v1.ok) reasons.push(`V1_${v1.reason}`);
  if (reasons.length) return { ok: false, reasons };
  const r = v1.result;
  if (r.partMatch === PART_MATCH.NOT_MATCH) {
    // Another part: no washer cap state may be stated at all.
    if (ITEM_KEYS.some(k => items[k].status !== ITEM_STATUS.NA)) reasons.push('WRONG_PART_WITH_ITEM_STATE');
  } else {
    const missing = items.capPresence.status === ITEM_STATUS.ISSUE;
    for (const key of ['capClosure', 'capBody']) if ((items[key].status === ITEM_STATUS.NA) !== missing) reasons.push(`NOT_APPLICABLE_${key}`);
    if (items.capPresence.status === ITEM_STATUS.NA || items.neck.status === ITEM_STATUS.NA) reasons.push('NOT_APPLICABLE_MISUSED');
  }
  const derived = deriveAssessment(r.partMatch, items, rubric);
  if (r.assessment !== derived) reasons.push('ASSESSMENT_NOT_DERIVED');
  const issueCodes = new Set(ITEM_KEYS.filter(k => items[k].status === ITEM_STATUS.ISSUE).map(k => ITEMS[k].issue));
  const reported = new Set(r.suspectedIssues.map(i => i.code));
  if (r.partMatch === PART_MATCH.LIKELY_MATCH && [...issueCodes].sort().join() !== [...reported].sort().join()) reasons.push('ISSUES_NOT_FROM_ITEMS');
  const notFull = ITEM_KEYS.filter(k => [ITEM_STATUS.PARTIAL, ITEM_STATUS.HIDDEN].includes(items[k].status));
  if (r.partMatch === PART_MATCH.LIKELY_MATCH && notFull.length && !r.limitations.length) reasons.push('LIMITS_NOT_STATED');
  if (r.assessment === ASSESSMENT.INDETERMINATE && r.partMatch === PART_MATCH.LIKELY_MATCH && !r.retakeRequired) reasons.push('INDETERMINATE_WITHOUT_RETAKE');
  return reasons.length ? { ok: false, reasons, derived } : { ok: true, result: Object.freeze({ ...r, schemaVersion: SCHEMA_VERSION, itemChecks: structuredClone(items) }), v1: r, derived };
}
