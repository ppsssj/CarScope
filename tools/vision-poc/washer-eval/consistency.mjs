// P13-C: a diagnostic layer over the P13-A washer result. It never replaces validateAnalysisResult and is not a gate: it labels results for review.
// Levels, worst first:
//   STRUCTURAL_INVALID           the P13-A validator refuses it (shape, enums, rules, forbidden text)
//   DETERMINISTIC_CONTRADICTION  structured fields contradict each other under the written rubric (no text reading)
//   SEMANTIC_REVIEW_REQUIRED     the Korean text suggests a contradiction; found by phrase patterns, so it can miss and can misfire
//   CONSISTENT                   none of the above was found. Not proof of consistency
// The rubric decides which washer items are core. It is a parameter so its effect is visible, not a hidden choice.
import { ASSESSMENT, PART_MATCH, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';

export const LEVEL = Object.freeze({ STRUCTURAL_INVALID: 'STRUCTURAL_INVALID', DETERMINISTIC_CONTRADICTION: 'DETERMINISTIC_CONTRADICTION', SEMANTIC_REVIEW_REQUIRED: 'SEMANTIC_REVIEW_REQUIRED', CONSISTENT: 'CONSISTENT' });
const RANK = [LEVEL.CONSISTENT, LEVEL.SEMANTIC_REVIEW_REQUIRED, LEVEL.DETERMINISTIC_CONTRADICTION, LEVEL.STRUCTURAL_INVALID];
const worst = levels => levels.reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), LEVEL.CONSISTENT);

/**
 * Rubric v1 (P13-C). Core items decide NO_VISIBLE_ISSUE_DETECTED vs INDETERMINATE; a secondary item that cannot be seen is a limitation only.
 * Cap presence, closure and the cap body are core: they are what the P13-A washer profile and the P13-B truth question ("can the cap state be
 * judged") ask about. The filler neck is secondary by default: it sits under a closed cap and is rarely visible from above.
 * `neckCore: true` is the stricter reading of the P13-A profile ("cracks on the cap or the filler neck") and is reported beside it.
 */
export const RUBRIC_V1 = Object.freeze({ id: 'washer-rubric-v1', neckCore: false });
export const RUBRIC_STRICT = Object.freeze({ id: 'washer-rubric-v1-neck-core', neckCore: true });

// ---- Phrase patterns (Korean, as the P13-A prompt asks). Each finds a subject and a state; a sentence may match several. ----
// Subjects
const NECK = /주입구\s*목|주입구의\s*목|목\s*부분|필러\s*넥|넥/;
const CAP = /캡|뚜껑/;
const WHOLE = /전체|부품\s*전체|사진\s*전체/;
// States
const HIDDEN = /가려|가림|보이지\s*않|안\s*보|확인(할|하기)?\s*(수\s*없|어렵)|판단(할|하기)?\s*(수\s*없|어렵)|알\s*수\s*없|불분명|흐릿|흐려|반사|어두|잘려|잘린/;
const PARTIAL = /일부|부분적|조금|약간|일부분/;
const CLOSED = /닫혀|닫힌|덮고\s*있|덮여|덮인|잠겨|체결|장착되어/;
const OPEN = /열려|열린|개방/;
const MISSING = /없어\s*보|없는\s*것|누락|빠져/;
const DAMAGE = /균열|금이|깨|파손|손상|부서/;
const NEGATED_DAMAGE = /(균열|금|깨짐|파손|손상|부서짐)[^.]{0,12}(없|보이지\s*않|안\s*보)/;
const sentences = items => items.flatMap(text => String(text).split(/(?<=[.!?。])\s+|\n/).map(s => s.trim()).filter(Boolean));

/** Which items a limitation sentence says could not be seen. Text only: approximate. */
export function limitationSubjects(text) {
  if (!HIDDEN.test(text)) return [];
  const subjects = [];
  if (NECK.test(text)) subjects.push(PARTIAL.test(text) ? 'NECK_PARTIAL' : 'NECK');
  // "캡과 주변 부품에 가려져" names the cap as what hides the neck, not as hidden: only count the cap when no neck is named.
  if (CAP.test(text) && !NECK.test(text)) subjects.push(PARTIAL.test(text) ? 'CAP_PARTIAL' : 'CAP');
  if (WHOLE.test(text) && !NECK.test(text) && !CAP.test(text)) subjects.push('WHOLE');
  if (!subjects.length) subjects.push('OTHER');
  return subjects;
}

const coreHidden = (subjects, rubric) => subjects.some(s => s === 'CAP' || s === 'WHOLE' || (rubric.neckCore && (s === 'NECK' || s === 'NECK_PARTIAL')));
const secondaryOnly = (subjects, rubric) => subjects.length > 0 && subjects.every(s => s === 'OTHER' || s === 'CAP_PARTIAL' || (!rubric.neckCore && (s === 'NECK' || s === 'NECK_PARTIAL')));

/**
 * One result, judged against the rubric. Returns { level, findings: [{ level, code, detail }] }.
 * @param raw the provider's answer as received (before or after validation)
 */
export function checkConsistency(raw, { partId = 'washer-fluid-cap', rubric = RUBRIC_V1 } = {}) {
  const findings = [];
  const add = (level, code, detail) => findings.push({ level, code, detail });
  const checked = validateAnalysisResult(partId, raw);
  if (!checked.ok) { add(LEVEL.STRUCTURAL_INVALID, `VALIDATOR_${checked.reason}`, 'refused by the P13-A validator'); return { level: LEVEL.STRUCTURAL_INVALID, findings }; }
  const r = checked.result;

  // Deterministic: structured fields only. The P13-A validator already enforces match/assessment pairing, issues <-> SUSPECTED,
  // reasons for INDETERMINATE and retake <-> instructions; these are the rubric's additions.
  if (r.assessment === ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED && r.retakeRequired) add(LEVEL.DETERMINISTIC_CONTRADICTION, 'NO_ISSUE_BUT_RETAKE', 'rubric: core items were observable, so a retake cannot be required');
  if (r.partMatch === PART_MATCH.LIKELY_MATCH && r.assessment === ASSESSMENT.INDETERMINATE && !r.retakeRequired) add(LEVEL.DETERMINISTIC_CONTRADICTION, 'INDETERMINATE_WITHOUT_RETAKE', 'rubric: a cap that is the part but cannot be judged needs a retake instruction');

  // Semantic: phrase patterns. Each finding says which sentence triggered it.
  const limits = sentences(r.limitations), obs = sentences(r.observations);
  const hidden = limits.flatMap(limitationSubjects);
  const closedSaid = obs.some(s => CLOSED.test(s) && !OPEN.test(s));
  const damageSaid = obs.some(s => DAMAGE.test(s) && !NEGATED_DAMAGE.test(s));
  if (r.assessment === ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED && coreHidden(hidden, rubric)) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'NO_ISSUE_WITH_CORE_HIDDEN', `a core item is described as not visible: ${limits.join(' / ')}`);
  if (r.assessment === ASSESSMENT.INDETERMINATE && r.partMatch === PART_MATCH.LIKELY_MATCH && secondaryOnly(hidden, rubric) && closedSaid && !damageSaid) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'INDETERMINATE_ON_SECONDARY_ONLY', `only secondary items are limited and the cap is described as closed: ${limits.join(' / ')}`);
  for (const issue of r.suspectedIssues) {
    if (issue.code === 'CAP_MISSING_SUSPECTED' && obs.some(s => CLOSED.test(s))) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'MISSING_BUT_CLOSED', 'a missing cap is suspected while an observation says a cap covers the filler');
    if (issue.code === 'CAP_OPEN_SUSPECTED' && closedSaid) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'OPEN_BUT_CLOSED', 'an open cap is suspected while an observation says it is closed');
    if (issue.code === 'CAP_OR_NECK_DAMAGE_SUSPECTED' && obs.some(s => NEGATED_DAMAGE.test(s)) && !obs.some(s => DAMAGE.test(s) && !NEGATED_DAMAGE.test(s))) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'DAMAGE_BUT_NONE_SEEN', 'damage is suspected while every observation says no damage is seen');
  }
  if (r.assessment === ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED && obs.some(s => (OPEN.test(s) && !/열린\s*주입구는\s*보이지\s*않/.test(s)) || (MISSING.test(s) && CAP.test(s)))) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'NO_ISSUE_BUT_ISSUE_WORDS', 'an observation uses open/missing wording under a no-issue verdict');
  if (r.assessment === ASSESSMENT.WRONG_PART && obs.some(s => CLOSED.test(s) || NEGATED_DAMAGE.test(s))) add(LEVEL.SEMANTIC_REVIEW_REQUIRED, 'WRONG_PART_WITH_CAP_STATE', 'a wrong part is reported while the cap state is described');
  return { level: worst(findings.map(f => f.level)), findings, hiddenSubjects: hidden };
}

/**
 * Two answers for the same photo and region (the two margins). Different verdicts are expected only when what was seen differs.
 * Equal hidden-subject sets with different verdicts are flagged: the crop changed, the stated reason did not.
 */
export function checkPair(a, b, options = {}) {
  const x = checkConsistency(a, options), y = checkConsistency(b, options);
  if (x.level === LEVEL.STRUCTURAL_INVALID || y.level === LEVEL.STRUCTURAL_INVALID) return { level: LEVEL.STRUCTURAL_INVALID, code: 'PAIR_HAS_INVALID', a: x, b: y };
  const verdict = r => `${r.partMatch}/${r.assessment}`;
  const same = verdict(a) === verdict(b);
  const subjects = s => [...new Set(s.hiddenSubjects.map(v => v.replace('_PARTIAL', '')))].sort().join(',');
  if (!same && subjects(x) === subjects(y)) return { level: LEVEL.SEMANTIC_REVIEW_REQUIRED, code: 'PAIR_VERDICT_DIFFERS_SAME_LIMITS', detail: `${verdict(a)} vs ${verdict(b)} with the same stated limits (${subjects(x) || 'none'})`, a: x, b: y };
  return { level: worst([x.level, y.level]), code: same ? 'PAIR_SAME_VERDICT' : 'PAIR_VERDICT_DIFFERS_WITH_DIFFERENT_LIMITS', a: x, b: y };
}

/** A run's records, diagnosed. Read-only: the caller decides where to write. */
export function diagnoseRecords(records, options = {}) {
  const rows = records.map(r => ({ imageId: r.imageId, margin: r.margin, ...checkConsistency(r.raw, options) }));
  const pairs = [...new Set(records.map(r => r.imageId))].map(imageId => {
    const [a, b] = [0.4, 0.8].map(m => records.find(r => r.imageId === imageId && r.margin === m));
    if (!a || !b) return null;
    const p = checkPair(a.raw, b.raw, options);
    return { imageId, level: p.level, code: p.code, detail: p.detail ?? null };
  }).filter(Boolean);
  const count = list => Object.fromEntries(Object.values(LEVEL).map(level => [level, list.filter(x => x.level === level).length]));
  return { rubric: options.rubric ?? RUBRIC_V1, results: { counts: count(rows), rows }, pairs: { counts: count(pairs), rows: pairs }, note: 'Diagnostic only. Phrase patterns are approximate; CONSISTENT is not proof.' };
}
