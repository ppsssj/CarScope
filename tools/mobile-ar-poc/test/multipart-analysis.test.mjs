// P13-D: the six bonnet parts in the analysis contract, and the manual-only path of the detection dialog. Pure; no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_PROFILES, ANALYSIS_SUPPORT, analysisJsonSchema, buildAnalysisPrompt, validateAnalysisResult } from '../public/part-analysis.mjs';
import { initialDetection, offersDetection, PART_DETECTION, PHASE, reduceDetection } from '../public/part-detection.mjs';

const PARTS = Object.keys(ANALYSIS_PROFILES);
const answer = (partId, fields = {}) => ({ partId, partMatch: 'LIKELY_MATCH', assessment: 'NO_VISIBLE_ISSUE_DETECTED', observations: ['부품이 보입니다.'], suspectedIssues: [], limitations: [], retakeRequired: false, retakeInstructions: [], requiresUserConfirmation: true, ...fields });
const reason = (partId, fields) => { const r = validateAnalysisResult(partId, answer(partId, fields)); return r.ok ? 'ok' : r.reason; };

test('every part has its own codes in its own schema; a code of another part is refused', () => {
  for (const id of PARTS) {
    const codes = analysisJsonSchema(id).properties.suspectedIssues.items.properties.code.enum;
    assert.deepEqual(codes, [...ANALYSIS_PROFILES[id].issues], id);
    assert.equal(reason(id, { assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: codes[0], description: '의심됩니다.', evidence: '자국이 보입니다.' }] }), 'ok', id);
  }
  assert.equal(reason('fuse-box', { assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: 'CAP_OPEN_SUSPECTED', description: '열림', evidence: '틈' }] }), 'ISSUE_CODE');
  assert.equal(reason('battery-12v', { assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: 'TERMINAL_CORROSION_SUSPECTED', description: '흰 가루', evidence: '단자 주변 흰 가루' }] }), 'ok');
  assert.equal(reason('lcw-coolant-reservoir', { partId: 'coolant-reservoir' }), 'PART_ID', 'one coolant answer is never taken for the other');
});

test('each part refuses its own forbidden claims, and still allows saying that it cannot tell', () => {
  const claims = {
    'battery-12v': ['전압이 12.6V입니다.', '충전 상태가 양호합니다.', '배터리 수명이 충분합니다.', '배터리를 탈거해 확인하세요.', '단자를 풀어 닦아 주세요.', '점프 시동이 필요해 보입니다.'],
    'lcw-coolant-reservoir': ['전도도가 낮게 유지되고 있습니다.', '농도가 적정합니다.', '냉각수를 교체하세요.'],
    'coolant-reservoir': ['냉각 계통이 정상 작동합니다.', '농도가 적정해 보입니다.'],
    'brake-fluid-reservoir': ['제동 성능이 충분합니다.', '수분 함량은 2% 정도로 보입니다.', '브레이크액 품질이 좋습니다.'],
    'fuse-box': ['퓨즈는 모두 정상으로 보입니다.', '전기 계통은 문제 없습니다.'],
  };
  for (const [id, texts] of Object.entries(claims)) for (const text of texts) {
    const r = reason(id, { observations: [text] });
    assert.ok(['FORBIDDEN_CLAIM', 'FORBIDDEN_TEXT'].includes(r), `${id}: "${text}" -> ${r}`);
  }
  const fine = {
    'battery-12v': ['충전 상태와 전압은 사진으로 알 수 없습니다.', '12V 표시가 있는 배터리로 보입니다.'],
    'lcw-coolant-reservoir': ['전도도와 성분은 사진으로 판단할 수 없습니다.'],
    'coolant-reservoir': ['액면이 가려져 MIN 위인지 알 수 없습니다.'],
    'brake-fluid-reservoir': ['제동 성능은 사진으로 판단할 수 없습니다.'],
    'fuse-box': ['덮개가 닫혀 있어 내부 퓨즈는 보이지 않습니다.'],
  };
  for (const [id, texts] of Object.entries(fine)) assert.equal(reason(id, { assessment: 'INDETERMINATE', partMatch: 'UNCERTAIN', observations: ['부품이 보입니다.'], limitations: texts, retakeRequired: true, retakeInstructions: ['표기가 보이게 찍어 주세요.'] }), 'ok', id);
  // The washer and the global rules are as before.
  assert.equal(reason('washer-fluid-cap', { observations: ['캡은 정상입니다.'] }), 'FORBIDDEN_TEXT');
});

test('manual-only parts are told so in their prompt; identification rules are part specific', () => {
  for (const id of PARTS) {
    const p = buildAnalysisPrompt(id, { targetInCrop: [0.2, 0.2, 0.6, 0.6], regionSource: 'MANUAL' });
    assert.equal(/A person marked this region; no detector proposed it/.test(p.instructions), ANALYSIS_SUPPORT[id].limited, id);
    assert.match(p.instructions, /set partMatch to UNCERTAIN|part match is UNCERTAIN|UNCERTAIN and assessment to INDETERMINATE/, id);
  }
});

test('the dialog state machine: a part with no detector prepares the photo locally and never asks the detector', () => {
  for (const [id, entry] of Object.entries(PART_DETECTION)) assert.equal(offersDetection(entry), !ANALYSIS_SUPPORT[id].limited, id);
  let s = initialDetection('battery-12v');
  const go = e => { s = reduceDetection(s, e); return s; };
  go({ type: 'OPEN' }); assert.equal(s.phase, PHASE.CONSENT);
  assert.equal(go({ type: 'PHOTO' }).phase, PHASE.CONSENT, 'no detection photo without its consent');
  go({ type: 'LOCAL_PHOTO' }); assert.equal(s.phase, PHASE.ANALYZING);
  const attempt = s.attempt;
  assert.equal(go({ type: 'ANSWER', attempt, candidates: [{ score: 1, box: [0, 0, 1, 1] }] }).phase, PHASE.ANALYZING, 'a detection answer cannot land on a local photo');
  assert.equal(go({ type: 'LOCAL_READY', attempt: attempt - 1 }).phase, PHASE.ANALYZING, 'stale');
  go({ type: 'LOCAL_READY', attempt }); assert.equal(s.phase, PHASE.LOCAL_ONLY);
  go({ type: 'AGAIN' }); assert.equal(s.phase, PHASE.CONSENT); assert.equal(s.local, false);
  go({ type: 'LOCAL_PHOTO' }); go({ type: 'FAIL', attempt: s.attempt, code: 'UNREADABLE' }); assert.equal(s.phase, PHASE.FAILED);
  go({ type: 'CLOSE' }); assert.equal(s.phase, PHASE.CLOSED);
  // The detection path is unchanged for a detected part.
  let d = reduceDetection(reduceDetection(initialDetection('fuse-box'), { type: 'OPEN' }), { type: 'CONSENT', value: true });
  d = reduceDetection(d, { type: 'PHOTO' });
  d = reduceDetection(d, { type: 'ANSWER', attempt: d.attempt, candidates: [] });
  assert.equal(d.phase, PHASE.NONE_FOUND);
});
