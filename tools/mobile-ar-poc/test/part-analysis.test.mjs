// P13-A: the analysis result contract, the profiles and the page's state machine. Pure; no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_PROFILES, ANALYSIS_SUPPORT, regionAllowed, analysisJsonSchema, APHASE, ASSESSMENT, buildAnalysisPrompt, FORBIDDEN_TEXT, initialAnalysis, ISSUE_LABELS, offersAnalysis, PART_MATCH, PROFILE_STATUS, reduceAnalysis, REGION_SOURCE, RESULT_LIMITS, unsupportedResult, validateAnalysisResult } from '../public/part-analysis.mjs';
import { PART_DETECTION, DETECTION_STATUS } from '../public/part-detection.mjs';
import { MOCK_SCENARIOS } from '../../vision-poc/src/mock-vision-provider.mjs';

const W = 'washer-fluid-cap';
const ok = (fields = {}) => ({ ...structuredClone(MOCK_SCENARIOS['no-visible-issue']), ...fields });
const refused = (value, reason, partId = W) => { const r = validateAnalysisResult(partId, value); assert.equal(r.ok, false, JSON.stringify(value)); if (reason) assert.equal(r.reason, reason); };

test('profiles follow the detection table: six bonnet experimental, eleven exterior drafts, none verified', () => {
  assert.deepEqual(Object.keys(ANALYSIS_PROFILES).sort(), Object.keys(PART_DETECTION).sort());
  // P13-D: the six bonnet parts are offered for analysis, as an experiment. P13-G: the eleven exterior parts are DRAFT, offered only where a
  // host's operator approved drafts. Detection support is a separate table: four bonnet classes, nothing for any other part.
  const BONNET = ['washer-fluid-cap', 'coolant-reservoir', 'lcw-coolant-reservoir', 'brake-fluid-reservoir', 'battery-12v', 'fuse-box'];
  const status = Object.fromEntries(Object.values(ANALYSIS_PROFILES).map(p => [p.partId, p.status]));
  assert.deepEqual(status, Object.fromEntries(Object.keys(PART_DETECTION).map(id => [id, BONNET.includes(id) ? 'EXPERIMENTAL' : 'DRAFT'])));
  assert.deepEqual(Object.keys(ANALYSIS_PROFILES).filter(id => offersAnalysis(id)).sort(), [...BONNET].sort());
  assert.deepEqual(Object.keys(ANALYSIS_PROFILES).filter(id => offersAnalysis(id, { allowDraft: true })).sort(), Object.keys(PART_DETECTION).sort());
  assert.deepEqual(Object.fromEntries(Object.values(PART_DETECTION).map(e => [e.partId, e.status])),
    Object.fromEntries(Object.keys(PART_DETECTION).map(id => [id, ['washer-fluid-cap', 'coolant-reservoir', 'brake-fluid-reservoir', 'fuse-box'].includes(id) ? 'EXPERIMENTAL' : 'UNSUPPORTED'])));
  for (const p of Object.values(ANALYSIS_PROFILES)) {
    assert.ok(!Object.values(p).includes('VERIFIED'));
    assert.ok(p.reason.length > 20, p.partId);
    // Where detection is unsupported, analysis comes only from a region the person marks, and is labelled limited.
    const detects = PART_DETECTION[p.partId].status !== DETECTION_STATUS.UNSUPPORTED;
    assert.deepEqual(ANALYSIS_SUPPORT[p.partId].regionModes, detects ? ['AI_CANDIDATE', 'MANUAL'] : ['MANUAL'], p.partId);
    assert.equal(ANALYSIS_SUPPORT[p.partId].limited, !detects, p.partId);
    const draft = p.status === PROFILE_STATUS.DRAFT;
    assert.equal(regionAllowed(p.partId, 'AI_CANDIDATE'), detects, p.partId);
    assert.equal(regionAllowed(p.partId, 'MANUAL'), !draft, `${p.partId}: a draft region is refused without the host's approval`);
    assert.equal(regionAllowed(p.partId, 'MANUAL', { allowDraft: true }), true, p.partId);
    assert.equal(regionAllowed(p.partId, 'AI_CANDIDATE', { allowDraft: true }), detects, `${p.partId}: approval never admits a detector region for a part with no class`);
    assert.equal(ANALYSIS_SUPPORT[p.partId].evidence, p.partId === W ? 'REAL_SMOKE_4_CALLS_NO_ACCURACY' : draft ? 'DRAFT_MOCK_ONLY' : 'MOCK_ONLY');
    if (p.status !== PROFILE_STATUS.UNSUPPORTED) {
      assert.ok(p.identify && p.check.length && p.never.length && p.issues.length, p.partId);
      for (const code of p.issues) assert.ok(ISSUE_LABELS[code], code);
    }
  }
  assert.match(ANALYSIS_PROFILES['brake-fluid-reservoir'].never.join(' '), /braking performance/);
  assert.match(ANALYSIS_PROFILES['fuse-box'].never.join(' '), /fuse or relay inside/);
  assert.match(ANALYSIS_PROFILES['coolant-reservoir'].identify, /low-conductivity/);
  assert.match(ANALYSIS_PROFILES['coolant-reservoir'].never.join(' '), /hidden level normal/);
  assert.match(ANALYSIS_PROFILES['battery-12v'].identify, /high-voltage parts.*never the 12V battery/);
  assert.match(ANALYSIS_PROFILES['battery-12v'].never.join(' '), /state of charge, voltage/);
  assert.match(ANALYSIS_PROFILES['battery-12v'].never.join(' '), /removing the battery, touching or loosening terminals/);
  assert.match(ANALYSIS_PROFILES['lcw-coolant-reservoir'].identify, /only from a printed label/);
  assert.match(ANALYSIS_PROFILES['lcw-coolant-reservoir'].never.join(' '), /conductivity/);
  assert.equal(regionAllowed('nothing', 'MANUAL'), false);
  assert.ok(ANALYSIS_PROFILES[W].crop.margin > 0.4, 'a small cap keeps more surroundings than the default');
});

test('the prompt carries the rules, the part, the region and nothing personal; every bonnet part has one, an unknown part none', () => {
  const p = buildAnalysisPrompt(W, { targetInCrop: [0.3, 0.3, 0.4, 0.4], regionSource: REGION_SOURCE.MANUAL });
  for (const rule of [/Never state that the car/, /Never invent an issue/, /UNCERTAIN and assessment to INDETERMINATE/, /Never tell the person to open a cap/, /requiresUserConfirmation is always true/]) assert.match(p.instructions, rule);
  assert.match(p.instructions, /windshield washer fluid filler cap/);
  assert.match(p.userText, /A person marked/); assert.match(p.userText, /0\.300, 0\.300, 0\.400, 0\.400/);
  assert.match(buildAnalysisPrompt(W, { targetInCrop: [0, 0, 1, 1], regionSource: REGION_SOURCE.AI_CANDIDATE }).userText, /object detector proposed/);
  for (const id of Object.keys(ANALYSIS_PROFILES)) assert.match(buildAnalysisPrompt(id, { targetInCrop: [0, 0, 1, 1], regionSource: REGION_SOURCE.MANUAL }).instructions, /Never judge:/, id);
  assert.match(buildAnalysisPrompt('battery-12v', { targetInCrop: [0, 0, 1, 1], regionSource: REGION_SOURCE.MANUAL }).instructions, /A person marked this region/);
  assert.throws(() => buildAnalysisPrompt('nope', { targetInCrop: [0, 0, 1, 1] }), /UNSUPPORTED/);
});

test('the JSON schema is strict-mode shaped: every key required, no other keys, closed enums', () => {
  const walk = node => {
    if (node?.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); Object.values(node.properties).forEach(walk); }
    if (node?.type === 'array') { assert.equal(node.maxItems, RESULT_LIMITS.items); walk(node.items); }
  };
  const schema = analysisJsonSchema(W);
  walk(schema);
  assert.deepEqual(schema.properties.partId.enum, [W]);
  assert.ok(!schema.properties.assessment.enum.includes(ASSESSMENT.UNSUPPORTED), 'a model cannot choose UNSUPPORTED');
  assert.deepEqual(schema.properties.suspectedIssues.items.properties.code.enum, ANALYSIS_PROFILES[W].issues);
  assert.ok(!JSON.stringify(schema).includes('confidence'), 'no self-reported confidence');
});

test('each valid mock answer passes, and a passing result is a frozen copy', () => {
  for (const name of ['no-visible-issue', 'suspected', 'indeterminate', 'wrong-part']) {
    const r = validateAnalysisResult(W, structuredClone(MOCK_SCENARIOS[name]));
    assert.equal(r.ok, true, `${name}: ${r.reason}`);
    assert.ok(Object.isFrozen(r.result) && Object.isFrozen(r.result.observations));
    assert.equal(r.result.requiresUserConfirmation, true);
  }
});

test('malformed answers are refused whole: shape, keys, enums, lengths, types', () => {
  refused('text', 'NOT_OBJECT'); refused(null, 'NOT_OBJECT'); refused([ok()], 'NOT_OBJECT'); refused(MOCK_SCENARIOS['not-json'], 'NOT_OBJECT');
  refused(MOCK_SCENARIOS['extra-key'], 'KEYS');
  const { limitations, ...missing } = ok(); refused(missing, 'KEYS');
  refused(ok({ partId: 'coolant-reservoir' }), 'PART_ID');
  refused(ok({ partMatch: 'MATCH' }), 'PART_MATCH');
  refused(ok({ assessment: 'OK' }), 'ASSESSMENT');
  refused(ok({ assessment: 'UNSUPPORTED' }), 'ASSESSMENT');
  refused(ok({ observations: 'one' }), 'LIST');
  refused(ok({ observations: Array(6).fill('보입니다.') }), 'LIST');
  refused(ok({ observations: ['x'.repeat(RESULT_LIMITS.textChars + 1)] }), 'TEXT');
  refused(ok({ observations: ['  '] }), 'TEXT');
  refused(ok({ observations: ['a\u0007b'] }), 'TEXT');
  refused(ok({ observations: [42] }), 'TEXT');
  refused(ok({ retakeRequired: 'no' }), 'RETAKE');
  refused(ok({ requiresUserConfirmation: false }), 'CONFIRMATION');
  const issue = { code: 'CAP_MISSING_SUSPECTED', description: '캡이 보이지 않습니다.', evidence: '입구가 드러나 있습니다.' };
  refused(ok({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ ...issue, code: 'LEVEL_BELOW_MIN_SUSPECTED' }] }), 'ISSUE_CODE');
  refused(ok({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ ...issue, severity: 'high' }] }), 'ISSUE_KEYS');
  refused(ok({ assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ ...issue, evidence: '' }] }), 'TEXT');
  refused(ok(), 'PART_UNSUPPORTED', 'nothing');
  refused(ok(), 'PART_ID', 'battery-12v');
});

test('the rules are enforced, not trusted', () => {
  refused(ok({ observations: [] }), 'NO_OBSERVATION');
  refused(ok({ partMatch: PART_MATCH.UNCERTAIN }), 'UNCERTAIN_JUDGED'); // not sure it is the part, yet judged its state
  refused(ok({ partMatch: PART_MATCH.UNCERTAIN, assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: 'CAP_OPEN_SUSPECTED', description: '열린 듯', evidence: '틈' }] }), 'UNCERTAIN_JUDGED');
  refused(ok({ partMatch: PART_MATCH.NOT_MATCH }), 'MATCH_ASSESSMENT');
  refused(ok({ assessment: 'WRONG_PART' }), 'MATCH_ASSESSMENT');
  refused(ok({ assessment: 'SUSPECTED_ISSUE' }), 'ISSUES_ASSESSMENT'); // an issue with no evidence
  refused(ok({ suspectedIssues: [{ code: 'CAP_OPEN_SUSPECTED', description: '열린 듯', evidence: '틈' }] }), 'ISSUES_ASSESSMENT');
  refused(ok({ assessment: 'INDETERMINATE' }), 'INDETERMINATE_WITHOUT_REASON');
  refused(ok({ retakeRequired: true }), 'RETAKE_INSTRUCTIONS');
  refused(ok({ retakeInstructions: ['가까이 찍어 주세요.'] }), 'RETAKE_INSTRUCTIONS');
});

test('safety verdicts and invitations to handle the part are refused', () => {
  refused(MOCK_SCENARIOS['claims-safe'], 'FORBIDDEN_TEXT');
  for (const text of ['워셔액 캡은 정상입니다.', '이대로 운행해도 됩니다.', '문제없습니다.', 'The car is safe to drive.', '캡을 열어 확인하세요.', '워셔액을 보충하세요.', '손으로 만져 보세요.', '캡을 분리해 보세요.'])
    assert.match(text, FORBIDDEN_TEXT, text);
  for (const text of ['캡이 닫혀 있는 것으로 보입니다.', '제동 성능이 안전한지는 판단할 수 없습니다.', '캡이 열려 있는 것처럼 보입니다.', '보이는 이상 징후는 없습니다.'])
    assert.doesNotMatch(text, FORBIDDEN_TEXT, text);
  refused(ok({ retakeInstructions: ['캡을 열어 확인하세요.'], retakeRequired: true }), 'FORBIDDEN_TEXT');
});

test('the server\'s UNSUPPORTED answer is its own, never a model\'s', () => {
  const r = unsupportedResult('battery-12v');
  assert.equal(r.assessment, ASSESSMENT.UNSUPPORTED); assert.equal(r.requiresUserConfirmation, true);
  assert.equal(validateAnalysisResult(W, { ...r, partId: W }).ok, false);
});

test('page states: region and analysis are separate steps; consent, crop and one request gate the send', () => {
  let s = initialAnalysis();
  const go = event => { s = reduceAnalysis(s, event); return s; };
  assert.equal(go({ type: 'ANALYZE' }).phase, APHASE.IDLE);
  go({ type: 'START', manual: false }); assert.equal(s.phase, APHASE.REGION);
  go({ type: 'MANUAL_PICK', box: [0, 0, 0.1, 0.1] }); assert.equal(s.phase, APHASE.REGION, 'no manual pick unless in manual mode');
  go({ type: 'SELECT_CANDIDATE', index: 0, box: [0.1, 0.1, 0.2, 0.2] }); assert.equal(s.phase, APHASE.PREVIEW);
  assert.equal(s.region.source, REGION_SOURCE.AI_CANDIDATE);
  const cropAttempt = s.attempt;
  go({ type: 'CONSENT', value: true });
  go({ type: 'ANALYZE' }); assert.equal(s.phase, APHASE.PREVIEW, 'not before the crop is ready');
  go({ type: 'CROPPED', attempt: cropAttempt - 1, ok: true }); assert.equal(s.cropReady, false, 'a stale crop is ignored');
  go({ type: 'CROPPED', attempt: cropAttempt, ok: true });
  go({ type: 'CONSENT', value: false }); go({ type: 'ANALYZE' }); assert.equal(s.phase, APHASE.PREVIEW, 'not without consent');
  go({ type: 'CONSENT', value: true }); go({ type: 'ANALYZE' }); assert.equal(s.phase, APHASE.ANALYZING);
  const sent = s.attempt;
  go({ type: 'ANALYZE' }); assert.equal(s.attempt, sent, 'a second press sends nothing');
  // Cancel: back to the preview, consent asked again, and the late answer is dropped.
  go({ type: 'CANCEL' }); assert.equal(s.phase, APHASE.PREVIEW); assert.equal(s.consented, false);
  go({ type: 'ANSWER', attempt: sent, result: {} }); assert.equal(s.phase, APHASE.PREVIEW);
  go({ type: 'CONSENT', value: true }); go({ type: 'ANALYZE' });
  go({ type: 'FAIL', attempt: s.attempt, code: 'UNAVAILABLE' }); assert.equal(s.phase, APHASE.FAILED);
  go({ type: 'RETRY' }); assert.equal(s.phase, APHASE.PREVIEW); assert.equal(s.consented, false);
  go({ type: 'CONSENT', value: true }); go({ type: 'ANALYZE' });
  const result = validateAnalysisResult(W, ok()).result;
  go({ type: 'ANSWER', attempt: s.attempt, result }); assert.equal(s.phase, APHASE.RESULT); assert.equal(s.acknowledged, false);
  go({ type: 'ACKNOWLEDGE', value: true }); assert.equal(s.acknowledged, true);
  // Changing the candidate starts over; a manual region is marked as such.
  go({ type: 'MANUAL' }); assert.equal(s.phase, APHASE.REGION); assert.equal(s.result, null);
  go({ type: 'MANUAL_PICK', box: [0.2, 0.2, 0.1, 0.1] }); assert.equal(s.region.source, REGION_SOURCE.MANUAL);
  const before = s.attempt;
  go({ type: 'RESET' }); assert.equal(s.phase, APHASE.IDLE); assert.ok(s.attempt > before);
});
