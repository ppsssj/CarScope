// P11 (PR #121): one capability table for the 19 parts, read by the phone page and the vehicle's 3D page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_STATE, PART_AI_SUPPORT, PLAN, SUPPORT, aiNote, aiSupport, partCapabilities, partIdForTask, partMethodSummary, METHOD_LABELS } from '../public/part-capabilities.mjs';
import { PART_DETECTION, offersDetection } from '../public/part-detection.mjs';
import { ANALYSIS_PROFILES, ANALYSIS_SUPPORT, offersAnalysis } from '../public/part-analysis.mjs';
import { inspectionTask, taskLinks } from '../public/inspection-tasks.mjs';
import { MOBILE_MODULES } from '../public-modules.mjs';
import { PART_ANALYSIS_FILES, PART_DETECTION_FILES } from '../part-detection-modules.mjs';
import { INSPECTION_PARTS } from '../../three-poc/inspection-parts.mjs';
import { MOBILE_TARGETS } from '../../three-poc/mobile-result-contract.mjs';

// The audited matrix (docs/p11-part-capabilities.md). [partId, has task, plan]
const MATRIX = [
  ['washer-fluid-cap', true, PLAN.DETECT_AND_ANALYZE], ['coolant-reservoir', true, PLAN.DETECT_AND_ANALYZE],
  ['brake-fluid-reservoir', true, PLAN.DETECT_AND_ANALYZE], ['fuse-box', true, PLAN.DETECT_AND_ANALYZE],
  ['battery-12v', true, PLAN.MARK_AND_ANALYZE], ['lcw-coolant-reservoir', true, PLAN.MARK_AND_ANALYZE],
  ...['tire.front-left', 'tire.front-right', 'tire.rear-left', 'tire.rear-right', 'wiper.front.left', 'wiper.front.right',
    'light-low-beam-left-0', 'light-low-beam-right-0', 'light-high-beam-left-0', 'light-high-beam-right-0', 'ev-charge.port'].map(id => [id, true, PLAN.MARK_AND_ANALYZE, 'DRAFT']),
  ['ev-battery.pack', false, PLAN.INFO_ONLY], ['ev-charge.flap', false, PLAN.INFO_ONLY],
];
const capOf = (p, host = null) => partCapabilities(p.id, { taskId: p.taskId, host });

test('all 19 parts of the 3D registry: 17 with a phone task, 2 informational, and the audited plan for each', () => {
  assert.equal(INSPECTION_PARTS.length, 19);
  assert.deepEqual(INSPECTION_PARTS.map(p => p.id).sort(), MATRIX.map(([id]) => id).sort());
  for (const [id, hasTask, plan] of MATRIX) {
    const p = INSPECTION_PARTS.find(x => x.id === id), cap = capOf(p);
    assert.equal(Boolean(p.taskId), hasTask, id); assert.equal(cap.partPlan, plan, id);
    assert.equal(cap.manualChecklist, hasTask, `${id}: the manual checklist depends only on the task`);
  }
  assert.equal(INSPECTION_PARTS.filter(p => p.taskId).length, 17);
  // P13-G: the eleven exterior parts gained a marked-region analysis, as DRAFT. No part is manual only any more.
  assert.equal(MATRIX.filter(([, , plan]) => plan === PLAN.MANUAL_ONLY).length, 0);
  assert.equal(MATRIX.filter(([, , , stage]) => stage === 'DRAFT').length, 11);
  for (const [id, , , stage] of MATRIX) { const p = INSPECTION_PARTS.find(x => x.id === id); assert.equal(capOf(p).stage, p.taskId ? stage ?? 'EXPERIMENTAL' : null, id); }
});

test('the 17 phone tasks are the 3D tasks, with the same names on both screens', () => {
  const tasks = taskLinks();
  assert.equal(tasks.length, 17);
  for (const p of INSPECTION_PARTS.filter(x => x.taskId)) {
    const task = inspectionTask(p.taskId);
    assert.ok(task, p.taskId); assert.equal(task.label, p.label, `${p.id}: the phone and the vehicle name the part the same way`);
    assert.equal(partIdForTask(p.taskId), p.id, `${p.taskId} maps back to its 3D part`);
  }
  for (const t of MOBILE_TARGETS) assert.equal(partIdForTask(t.taskId), t.partId, 'the vehicle result contract agrees');
});

test('detection and analysis take their status from this table: one source, no second registry', () => {
  for (const [partId, row] of Object.entries(PART_DETECTION)) {
    assert.equal(row.status, aiSupport(partId).detection, partId);
    if (row.status === SUPPORT.EXPERIMENTAL) assert.ok(row.modelClass, `${partId}: a detecting part needs a model class`);
    assert.equal(offersDetection(row), aiSupport(partId).detection === SUPPORT.EXPERIMENTAL, partId);
    assert.equal(partIdForTask(row.taskId), partId);
  }
  for (const [partId, profile] of Object.entries(ANALYSIS_PROFILES)) {
    assert.equal(profile.status, aiSupport(partId).analysis, partId);
    assert.equal(offersAnalysis(partId), aiSupport(partId).analysis === SUPPORT.EXPERIMENTAL, partId);
    assert.deepEqual([...ANALYSIS_SUPPORT[partId].regionModes], aiSupport(partId).detection === SUPPORT.EXPERIMENTAL ? ['AI_CANDIDATE', 'MANUAL'] : ['MANUAL'], partId);
  }
  assert.deepEqual(Object.keys(PART_AI_SUPPORT).sort(), Object.keys(ANALYSIS_PROFILES).sort(), 'every AI part has a profile');
  for (const file of ['part-detection.mjs', 'part-analysis.mjs']) {
    const src = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /(row|profile)\('[\w.-]+', ('[\w.-]+', )?(DETECTION_STATUS|PROFILE_STATUS)\./, `${file} declares no status of its own`);
  }
});

test('the table is served by every host, the AI files only by a host that enabled them', () => {
  assert.ok(MOBILE_MODULES.includes('part-capabilities.mjs'));
  for (const f of [...PART_DETECTION_FILES, ...PART_ANALYSIS_FILES]) assert.ok(!MOBILE_MODULES.includes(f), f);
  assert.doesNotMatch(readFileSync(new URL('../public/part-capabilities.mjs', import.meta.url), 'utf8'), /^import /m, 'pure data with no imports');
});

test('on the phone, AI is AVAILABLE only where this server offers it and the page came from the vehicle QR', () => {
  const on = { connected: true, detection: true, analysis: true };
  const rows = [
    // [partId, host, offered, ai]
    ['washer-fluid-cap', on, PLAN.DETECT_AND_ANALYZE, AI_STATE.AVAILABLE],
    ['washer-fluid-cap', { ...on, analysis: false }, PLAN.DETECT_ONLY, AI_STATE.AVAILABLE],
    ['washer-fluid-cap', { ...on, detection: false }, PLAN.MARK_AND_ANALYZE, AI_STATE.AVAILABLE],
    ['washer-fluid-cap', { connected: true, detection: false, analysis: false }, PLAN.MANUAL_ONLY, AI_STATE.SERVER_DISABLED],
    ['washer-fluid-cap', { ...on, connected: false }, PLAN.MANUAL_ONLY, AI_STATE.NOT_CONNECTED],
    ['battery-12v', on, PLAN.MARK_AND_ANALYZE, AI_STATE.AVAILABLE],
    ['battery-12v', { ...on, analysis: false }, PLAN.MANUAL_ONLY, AI_STATE.SERVER_DISABLED, 'the detector cannot help a part it has no class for'],
    // P13-G: a draft is offered only where the host also approved drafts; detection never helps a part with no class.
    ...['tire.front-left', 'wiper.front.left', 'light-high-beam-right-0', 'ev-charge.port'].flatMap(id => [
      [id, on, PLAN.MANUAL_ONLY, AI_STATE.SERVER_DISABLED, 'analysis on, drafts not approved'],
      [id, { ...on, draftAnalysis: true }, PLAN.MARK_AND_ANALYZE, AI_STATE.AVAILABLE],
      [id, { ...on, analysis: false, draftAnalysis: true }, PLAN.MANUAL_ONLY, AI_STATE.SERVER_DISABLED, 'the draft flag alone never turns analysis on'],
      [id, { ...on, connected: false, draftAnalysis: true }, PLAN.MANUAL_ONLY, AI_STATE.NOT_CONNECTED],
    ]),
    ['washer-fluid-cap', { ...on, draftAnalysis: true }, PLAN.DETECT_AND_ANALYZE, AI_STATE.AVAILABLE, 'drafts do not change an experimental part'],
  ];
  for (const [partId, host, offered, state, why] of rows) {
    const p = INSPECTION_PARTS.find(x => x.id === partId), cap = capOf(p, host);
    assert.deepEqual([cap.offered, cap.ai], [offered, state], `${partId} ${JSON.stringify(host)} ${why ?? ''}`);
    assert.equal(cap.manualChecklist, true, `${partId}: never blocked by AI`);
  }
  // The vehicle passes no host: it states support, never availability.
  for (const p of INSPECTION_PARTS) {
    const cap = capOf(p);
    assert.notEqual(cap.ai, AI_STATE.AVAILABLE, p.id);
    assert.equal(cap.ai, [PLAN.MANUAL_ONLY, PLAN.INFO_ONLY].includes(cap.partPlan) ? AI_STATE.UNSUPPORTED : AI_STATE.UNKNOWN, p.id);
  }
});

test('the words a driver reads hold no enum, environment variable or provider internals, and never call AI a verdict', () => {
  const hosts = [null, { connected: false, detection: true, analysis: true }, { connected: true, detection: false, analysis: false },
    { connected: true, detection: true, analysis: true }, { connected: true, detection: true, analysis: false }, { connected: true, detection: false, analysis: true },
    { connected: true, detection: true, analysis: true, draftAnalysis: true }, { connected: true, detection: false, analysis: true, draftAnalysis: true }];
  const words = new Set(Object.values(METHOD_LABELS));
  for (const p of INSPECTION_PARTS) for (const host of hosts) { const cap = capOf(p, host); words.add(aiNote(cap)); words.add(partMethodSummary(cap)); }
  for (const w of words) {
    assert.doesNotMatch(w, /[A-Z]{2,}_[A-Z_]+|ROBOFLOW|OPENAI|GPT|process\.env|data-part|EXPERIMENTAL|UNSUPPORTED/, w);
    assert.doesNotMatch(w, /정상입니다|안전합니다|문제 없|주행 가능합니다/, w);
  }
  assert.equal(aiNote(capOf(INSPECTION_PARTS.find(p => p.id === 'ev-charge.flap'))), '현재 AI 외관 분석은 지원하지 않습니다.');
  // P13-G: a draft names its stage in every state: offered, not approved here, and on the vehicle.
  const tire = INSPECTION_PARTS.find(p => p.id === 'tire.front-left'), on = { connected: true, detection: true, analysis: true };
  assert.match(aiNote(capOf(tire, { ...on, draftAnalysis: true })), /시험 단계예요\. 자동으로 위치를 찾지 않아요.*정확도를 확인하지 않았어요/);
  assert.match(aiNote(capOf(tire, on)), /시험 단계라 승인된 실험 서비스에서만/);
  assert.match(partMethodSummary(capOf(tire)), /AI 외관 분석\(시험 단계\)은 승인된 실험 서비스에서만/);
  assert.match(aiNote(capOf(INSPECTION_PARTS.find(p => p.id === 'battery-12v'), { connected: true, detection: true, analysis: true })), /자동으로 위치를 찾지 않아요/);
});
