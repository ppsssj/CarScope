// P13-C: the consistency diagnostics, the v2 rubric proposal and the runner's read-only guarantees. Synthetic answers, phrased like real ones.
// No model call. These tests show what the checks catch and one thing they miss; they do not show any accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSESSMENT, buildAnalysisPrompt, PROMPT_VERSION, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { checkConsistency, checkPair, diagnoseRecords, LEVEL, limitationSubjects, RUBRIC_STRICT, RUBRIC_V1 } from '../washer-eval/consistency.mjs';
import { analysisJsonSchemaV2, buildAnalysisPromptV2, deriveAssessment, ITEM_STATUS, PROMPT_VERSION_V2, toV1, validateV2 } from '../washer-eval/rubric-v2.mjs';
import { diagnose, report, runEvaluation } from '../scripts/washer-eval.mjs';
import { expectedOf } from '../washer-eval/washer-eval-model.mjs';

const W = 'washer-fluid-cap';
const base = (fields = {}) => ({ partId: W, partMatch: 'LIKELY_MATCH', assessment: 'NO_VISIBLE_ISSUE_DETECTED', observations: ['파란 캡에 앞유리 분사 표시가 보입니다.', '캡이 주입구를 덮고 있으며 보이는 부분에 균열이나 파손은 없습니다.'], suspectedIssues: [], limitations: [], retakeRequired: false, retakeInstructions: [], requiresUserConfirmation: true, ...fields });
const NECK_HIDDEN = ['주입구 목 부분은 캡과 주변 부품에 가려져 손상 여부를 판단하기 어렵습니다.'];
const level = (raw, rubric = RUBRIC_V1) => checkConsistency(raw, { rubric });
const codes = (raw, rubric = RUBRIC_V1) => checkConsistency(raw, { rubric }).findings.map(f => f.code);

test('rule cases: what each level means on washer answers', () => {
  // A cap seen clearly, nothing hidden.
  assert.equal(level(base()).level, LEVEL.CONSISTENT);
  // Only the surroundings / neck partly hidden: allowed under rubric v1 when stated.
  assert.equal(level(base({ limitations: ['주입구 목의 일부는 주변 부품에 가려져 있습니다.'] })).level, LEVEL.CONSISTENT);
  // The core (the cap) hidden, yet "no visible issue".
  assert.deepEqual(codes(base({ limitations: ['캡 윗부분이 반사 때문에 보이지 않습니다.'] })), ['NO_ISSUE_WITH_CORE_HIDDEN']);
  // Not sure it is the part: UNCERTAIN + INDETERMINATE is the consistent way.
  assert.equal(level(base({ partMatch: 'UNCERTAIN', assessment: 'INDETERMINATE', limitations: ['표시가 보이지 않아 어떤 캡인지 알 수 없습니다.'], retakeRequired: true, retakeInstructions: ['캡 윗면이 보이게 찍어 주세요.'] })).level, LEVEL.CONSISTENT);
  // Clearly another part, but the cap state is described anyway.
  assert.deepEqual(codes(base({ partMatch: 'NOT_MATCH', assessment: 'WRONG_PART', observations: ['라디에이터 캡으로 보입니다.', '캡이 닫혀 있습니다.'] })), ['WRONG_PART_WITH_CAP_STATE']);
  assert.equal(level(base({ partMatch: 'NOT_MATCH', assessment: 'WRONG_PART', observations: ['냉각수 표시가 있는 금속 캡으로 보입니다.'] })).level, LEVEL.CONSISTENT);
  // A suspicion the observations contradict.
  const issue = code => [{ code, description: '의심됩니다.', evidence: '근거 문장' }];
  assert.deepEqual(codes(base({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: issue('CAP_MISSING_SUSPECTED') })), ['MISSING_BUT_CLOSED']);
  assert.deepEqual(codes(base({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: issue('CAP_OPEN_SUSPECTED') })), ['OPEN_BUT_CLOSED']);
  assert.deepEqual(codes(base({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: issue('CAP_OR_NECK_DAMAGE_SUSPECTED') })), ['DAMAGE_BUT_NONE_SEEN']);
  // Observation and verdict disagree.
  assert.deepEqual(codes(base({ observations: ['캡이 열려 있는 것처럼 보입니다.'] })), ['NO_ISSUE_BUT_ISSUE_WORDS']);
  assert.equal(level(base({ observations: ['파란색 캡이 주입구를 덮고 있으며 열린 주입구는 보이지 않습니다.'] })).level, LEVEL.CONSISTENT, 'a negated "open" is not an issue word');
});

test('deterministic contradictions use structured fields only; structural failures pass through from the P13-A validator', () => {
  assert.deepEqual(codes(base({ retakeRequired: true, retakeInstructions: ['다시 찍어 주세요.'] })), ['NO_ISSUE_BUT_RETAKE']);
  assert.equal(level(base({ retakeRequired: true, retakeInstructions: ['다시 찍어 주세요.'] })).level, LEVEL.DETERMINISTIC_CONTRADICTION);
  assert.deepEqual(codes(base({ assessment: 'INDETERMINATE', limitations: ['캡 표면이 흐려 보이지 않습니다.'] })), ['INDETERMINATE_WITHOUT_RETAKE']);
  // Shape problems stay the validator's: refused as STRUCTURAL_INVALID, never softened.
  assert.equal(level({ ...base(), confidence: 0.9 }).level, LEVEL.STRUCTURAL_INVALID);
  assert.equal(level(base({ observations: ['캡은 정상입니다.'] })).level, LEVEL.STRUCTURAL_INVALID, 'forbidden wording is still refused by P13-A');
  assert.equal(level(base({ assessment: 'INDETERMINATE' })).level, LEVEL.STRUCTURAL_INVALID, 'INDETERMINATE without a reason');
  assert.equal(level(base({ assessment: 'SUSPECTED_ISSUE' })).level, LEVEL.STRUCTURAL_INVALID, 'a suspicion without evidence');
});

test('the rubric is explicit: the same neck limitation flips meaning between v1 and the strict reading', () => {
  const noIssue = base({ limitations: NECK_HIDDEN }), indeterminate = base({ assessment: 'INDETERMINATE', limitations: NECK_HIDDEN, retakeRequired: true, retakeInstructions: ['다른 각도로 찍어 주세요.'] });
  assert.deepEqual([level(noIssue).level, level(indeterminate).level], [LEVEL.CONSISTENT, LEVEL.SEMANTIC_REVIEW_REQUIRED]);
  assert.deepEqual([level(noIssue, RUBRIC_STRICT).level, level(indeterminate, RUBRIC_STRICT).level], [LEVEL.SEMANTIC_REVIEW_REQUIRED, LEVEL.CONSISTENT]);
  // The real-001 commons-029 shape: same stated limit, different verdicts. Flagged under either rubric.
  for (const rubric of [RUBRIC_V1, RUBRIC_STRICT]) {
    const pair = checkPair(indeterminate, noIssue, { rubric });
    assert.equal(pair.code, 'PAIR_VERDICT_DIFFERS_SAME_LIMITS', rubric.id);
  }
  assert.equal(checkPair(noIssue, base()).code, 'PAIR_SAME_VERDICT');
  assert.deepEqual(limitationSubjects(NECK_HIDDEN[0]), ['NECK'], '"가려진 목", not a hidden cap: the cap is what hides it');
  assert.deepEqual(limitationSubjects('주입구 목의 일부는 가려져 있습니다.'), ['NECK_PARTIAL']);
  assert.deepEqual(limitationSubjects('캡이 보입니다.'), [], 'no hidden-state word, no subject');
});

test('known limit: phrase patterns miss what they have no words for', () => {
  // "Only the outline can be made out" says the cap surface is not observable, with none of the hidden-state words.
  const missed = base({ limitations: ['캡 윤곽만 겨우 식별됩니다.'] });
  assert.equal(level(missed).level, LEVEL.CONSISTENT, 'a real contradiction that the text check does not see');
  // This is why the checks are a diagnostic and not a gate, and why v2 asks for structured item states.
});

test('unknown is never counted as normal: in the truth, and in the v2 derivation', () => {
  const truth = { region: { source: 'HUMAN', box: [0.1, 0.1, 0.2, 0.2] }, identification: 'WASHER_CAP', capMissing: 'NO', capOpen: 'UNKNOWN', capDamage: 'NO', judgeable: 'JUDGEABLE' };
  assert.equal(expectedOf(truth).state, null, 'an UNKNOWN answer leaves the state unscored, not NO_VISIBLE_ISSUE_DETECTED');
  const items = (overrides = {}) => ({ capPresence: { status: 'OBSERVED_OK', evidence: '' }, capClosure: { status: 'OBSERVED_OK', evidence: '' }, capBody: { status: 'OBSERVED_OK', evidence: '' }, neck: { status: 'OBSERVED_OK', evidence: '' }, ...overrides });
  assert.equal(deriveAssessment('LIKELY_MATCH', items()), ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED);
  assert.equal(deriveAssessment('LIKELY_MATCH', items({ capClosure: { status: 'NOT_VISIBLE', evidence: '' } })), ASSESSMENT.INDETERMINATE, 'core not visible is not normal');
  assert.equal(deriveAssessment('LIKELY_MATCH', items({ capBody: { status: 'PARTIALLY_VISIBLE', evidence: '' } })), ASSESSMENT.INDETERMINATE);
  assert.equal(deriveAssessment('LIKELY_MATCH', items({ neck: { status: 'NOT_VISIBLE', evidence: '' } })), ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED, 'secondary: a limitation, not a verdict');
  assert.equal(deriveAssessment('LIKELY_MATCH', items({ neck: { status: 'NOT_VISIBLE', evidence: '' } }), RUBRIC_STRICT), ASSESSMENT.INDETERMINATE);
  assert.equal(deriveAssessment('LIKELY_MATCH', items({ capClosure: { status: 'OBSERVED_ISSUE', evidence: '뚜껑이 들려 있음' } })), ASSESSMENT.SUSPECTED_ISSUE);
  assert.equal(deriveAssessment('UNCERTAIN', items({ capClosure: { status: 'OBSERVED_ISSUE', evidence: 'x' } })), ASSESSMENT.INDETERMINATE, 'no state judgement on an uncertain part');
  assert.equal(deriveAssessment('NOT_MATCH', items()), ASSESSMENT.WRONG_PART);
});

const v2 = (fields = {}, items = {}) => ({ ...base(fields), schemaVersion: 2, itemChecks: { capPresence: { status: 'OBSERVED_OK', evidence: '캡이 있습니다.' }, capClosure: { status: 'OBSERVED_OK', evidence: '닫혀 있습니다.' }, capBody: { status: 'OBSERVED_OK', evidence: '균열이 없습니다.' }, neck: { status: 'PARTIALLY_VISIBLE', evidence: '일부 가려짐' }, ...items } });

test('v2 proposal: item states decide the verdict, and every v2 answer projects to a valid v1 answer', () => {
  const good = v2({ limitations: ['주입구 목의 일부는 가려져 있습니다.'] });
  const ok = validateV2(W, good);
  assert.equal(ok.ok, true, ok.reasons?.join());
  assert.equal(validateAnalysisResult(W, toV1(ok.result)).ok, true, 'a v1 client gets a valid v1 answer');
  assert.deepEqual(Object.keys(toV1(good)).sort(), Object.keys(base()).sort());
  const refused = (raw, reason) => { const r = validateV2(W, raw); assert.equal(r.ok, false); assert.ok(r.reasons.includes(reason), `${reason} in ${r.reasons}`); };
  refused(v2({ limitations: ['주입구 목의 일부는 가려져 있습니다.'] }, { capClosure: { status: 'NOT_VISIBLE', evidence: '' } }), 'ASSESSMENT_NOT_DERIVED');
  refused(v2({}, {}), 'LIMITS_NOT_STATED');
  refused(v2({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: 'CAP_OPEN_SUSPECTED', description: '열린 듯', evidence: '틈' }], limitations: ['목 일부 가려짐'] }), 'ISSUES_NOT_FROM_ITEMS');
  refused(v2({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: 'CAP_OPEN_SUSPECTED', description: '열린 듯', evidence: '틈' }], limitations: ['목 일부 가려짐'] }, { capClosure: { status: 'OBSERVED_ISSUE', evidence: '' } }), 'ITEM_capClosure_ISSUE_WITHOUT_EVIDENCE');
  refused(v2({ partMatch: 'NOT_MATCH', assessment: 'WRONG_PART', observations: ['라디에이터 캡으로 보입니다.'] }), 'WRONG_PART_WITH_ITEM_STATE');
  assert.equal(validateV2(W, v2({ partMatch: 'NOT_MATCH', assessment: 'WRONG_PART', observations: ['라디에이터 캡으로 보입니다.'] }, Object.fromEntries(['capPresence', 'capClosure', 'capBody', 'neck'].map(k => [k, { status: 'NOT_APPLICABLE', evidence: '' }])))).ok, true);
  refused(v2({ limitations: ['목 일부 가려짐'] }, { capClosure: { status: 'NOT_APPLICABLE', evidence: '' } }), 'NOT_APPLICABLE_capClosure');
  refused({ ...good, schemaVersion: 1 }, 'SCHEMA_VERSION');
  refused({ ...good, itemChecks: { ...good.itemChecks, extra: { status: 'OBSERVED_OK', evidence: '' } } }, 'ITEM_KEYS');
  refused({ ...good, observations: ['캡은 정상입니다.'] }, 'V1_FORBIDDEN_TEXT');
});

test('v2 prompt and schema are new versions; the P13-A prompt and schema are untouched', () => {
  assert.equal(PROMPT_VERSION, 'p13-a-1');
  assert.equal(PROMPT_VERSION_V2, 'p13-c-rubric-1');
  const context = { targetInCrop: [0.2, 0.2, 0.6, 0.6], regionSource: 'MANUAL' };
  const p1 = buildAnalysisPrompt(W, context), p2 = buildAnalysisPromptV2(W, context);
  assert.ok(p2.instructions.startsWith(p1.instructions), 'v2 adds to the v1 rules, removes none');
  assert.match(p2.instructions, /neck \(secondary\)/); assert.match(buildAnalysisPromptV2(W, context, RUBRIC_STRICT).instructions, /neck \(core\)/);
  assert.equal(p2.userText, p1.userText);
  const walk = node => { if (node?.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); Object.values(node.properties).forEach(walk); } if (node?.type === 'array') walk(node.items); };
  walk(analysisJsonSchemaV2(W));
  assert.deepEqual(analysisJsonSchemaV2(W).properties.itemChecks.properties.neck.properties.status.enum, Object.values(ITEM_STATUS));
});

test('runner: reports never overwrite, diagnosis is read-only and outside the run, a real v2 run is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carscope-p13c-')), runs = join(dir, 'runs'), run = join(runs, 'r1');
  mkdirSync(run, { recursive: true });
  const records = [
    { imageId: 'a', margin: 0.4, raw: base({ assessment: 'INDETERMINATE', limitations: NECK_HIDDEN, retakeRequired: true, retakeInstructions: ['다른 각도로 찍어 주세요.'] }), latencyMs: 1 },
    { imageId: 'a', margin: 0.8, raw: base({ limitations: NECK_HIDDEN }), latencyMs: 1 },
  ];
  writeFileSync(join(run, 'run.json'), JSON.stringify({ synthetic: true, model: 'mock', rubric: 'v1' }));
  writeFileSync(join(run, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
  writeFileSync(join(run, 'report.json'), '{"kept":true}');
  const before = readFileSync(join(run, 'records.jsonl'), 'utf8');
  assert.throws(() => report({ runId: 'r1', runsDir: runs }), /REPORT_EXISTS/);
  assert.equal(readFileSync(join(run, 'report.json'), 'utf8'), '{"kept":true}');
  assert.throws(() => diagnose({ runId: 'r1', runsDir: runs }), /OUT_REQUIRED/);
  assert.throws(() => diagnose({ runId: 'r1', runsDir: runs, out: join(run, 'd.json') }), /OUT_INSIDE_RUN/);
  const out = join(dir, 'diag', 'r1.json');
  const d = diagnose({ runId: 'r1', runsDir: runs, out });
  assert.equal(d.byRubric['washer-rubric-v1'].pairs.rows[0].code, 'PAIR_VERDICT_DIFFERS_SAME_LIMITS');
  assert.deepEqual(d.byRubric['washer-rubric-v1'].results.counts, { STRUCTURAL_INVALID: 0, DETERMINISTIC_CONTRADICTION: 0, SEMANTIC_REVIEW_REQUIRED: 1, CONSISTENT: 1 });
  assert.deepEqual(d.byRubric['washer-rubric-v1-neck-core'].results.counts, { STRUCTURAL_INVALID: 0, DETERMINISTIC_CONTRADICTION: 0, SEMANTIC_REVIEW_REQUIRED: 1, CONSISTENT: 1 });
  assert.throws(() => diagnose({ runId: 'r1', runsDir: runs, out }), /DIAGNOSIS_EXISTS/);
  assert.equal(readFileSync(join(run, 'records.jsonl'), 'utf8'), before, 'records untouched');
  assert.ok(existsSync(out));
  await assert.rejects(runEvaluation({ runId: 'real-v2', real: true, rubric: 'v2', runsDir: runs, env: {} }), /REAL_V2_NEEDS_NEW_CRITERIA/);
  await assert.rejects(runEvaluation({ runId: 'x-v3', mock: true, rubric: 'v3', runsDir: runs, env: {} }), /RUBRIC_INVALID/);
  assert.equal(diagnoseRecords([]).results.rows.length, 0);
  // A stored v2 run: valid v2 answers are read as their v1 projection, invalid ones as refused.
  const v2run = join(runs, 'r2'); mkdirSync(v2run);
  writeFileSync(join(v2run, 'run.json'), JSON.stringify({ synthetic: true, model: 'mock', rubric: 'v2' }));
  writeFileSync(join(v2run, 'records.jsonl'), [
    { imageId: 'b', margin: 0.4, raw: v2({ limitations: ['주입구 목의 일부는 가려져 있습니다.'] }) },
    { imageId: 'b', margin: 0.8, raw: v2({ limitations: ['주입구 목의 일부는 가려져 있습니다.'] }, { capClosure: { status: 'NOT_VISIBLE', evidence: '' } }) },
  ].map(r => JSON.stringify(r)).join('\n'));
  const d2 = diagnose({ runId: 'r2', runsDir: runs, out: join(dir, 'diag', 'r2.json') });
  assert.deepEqual(d2.byRubric['washer-rubric-v1'].results.rows.map(r => r.level), [LEVEL.CONSISTENT, LEVEL.STRUCTURAL_INVALID], 'a verdict not derived from its items is refused');
});
