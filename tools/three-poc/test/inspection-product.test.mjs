import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, hoodTarget, cameraGoal, STATES as S } from '../inspection-flow.mjs';
import { productSummaryHtml, sessionActions, inspectionBack } from '../inspection-product.mjs';
import { createTireInspection, updateTireInspection, CHECKS } from '../tire-inspection.mjs';
const ev = type => ({ type });
const start = () => transition(initialState(), ev('START'));
const hood = s => transition(s, { type: 'SELECT_AREA', id: 'hood' });
const summary = s => transition(s, ev('SHOW_SUMMARY'));

test('whole-session summary is accessible before any answer and returns to inspection without ending it', () => {
  const state = summary(start());
  assert.equal(state.name, S.INSPECTION_SUMMARY); assert.equal(state.area, null); assert.equal(state.component, null);
  assert.equal(cameraGoal(state), 'overview'); assert.equal(hoodTarget(state), 0);
  assert.equal(summary(state), state); assert.deepEqual(transition(state, ev('BACK')), start());
  assert.equal(transition(state, { type: 'SELECT_TIRE', id: 'tire.rear-right' }).name, S.TIRE_PREVIEW);
  assert.equal(hood(state).name, S.HOOD_OPENING);
  assert.deepEqual(transition(state, ev('EXIT')), initialState());
  const idle = initialState(); assert.equal(summary(idle), idle);
});

test('summary from every hood state closes the model first and rejects late animation callbacks', () => {
  const opening = hood(start()), parts = transition(opening, ev('HOOD_OPENED'));
  const washer = transition(parts, { type: 'SELECT_COMPONENT', id: 'washer-fluid-cap' });
  const preview = transition(parts, { type: 'SELECT_COMPONENT', id: 'battery-12v' });
  const qr = transition(washer, ev('REQUEST_HANDOFF'), { handoffConfigured: true });
  for (const source of [opening, parts, washer, preview, qr, transition(parts, ev('BACK'))]) {
    const closing = summary(source);
    assert.equal(closing.name, S.HOOD_CLOSING); assert.equal(closing.afterClose, S.INSPECTION_SUMMARY);
    assert.equal(summary(closing), closing); assert.equal(transition(closing, ev('HOOD_OPENED')), closing);
    const done = transition(closing, ev('HOOD_CLOSED'));
    assert.equal(done.name, S.INSPECTION_SUMMARY); assert.equal(done.component, null); assert.equal(done.area, null);
    assert.equal(transition(done, ev('HOOD_CLOSED')), done);
    const exiting = transition(closing, ev('EXIT'));
    assert.equal(summary(exiting), exiting, 'late summary cannot supersede explicit end');
    assert.deepEqual(transition(exiting, ev('HOOD_CLOSED')), initialState());
  }
});

test('rapid tire/hood/summary switching never changes user responses or invents washer/SDK observations', () => {
  let record = createTireInspection('session');
  for (const c of CHECKS) record = updateTireInspection(record, { type: 'ANSWER', sessionId: 'session', tireId: 'tire.front-left', checkId: c.id, answer: 'UNABLE' });
  record = updateTireInspection(record, { type: 'CONFIRM', sessionId: 'session', tireId: 'tire.front-left', at: 100 });
  const before = record;
  let state = start();
  for (let n = 0; n < 30; n++) {
    state = transition(summary(state), { type: 'SELECT_TIRE', id: 'tire.front-left' });
    state = summary(state); state = hood(state); state = summary(state); state = transition(state, ev('HOOD_CLOSED'));
    assert.equal(state.name, S.INSPECTION_SUMMARY);
  }
  assert.equal(record, before);
  // P10 PR #2: the summary counts the 17 result parts; the tire, washer and SDK side sections are gone.
  const html = productSummaryHtml(record);
  assert.ok(html.includes('점검 완료 1/17')); assert.ok(html.includes('data-action="result-detail" data-id="tire.front-left"'));
  assert.ok(html.includes('QR을 띄운 것은 완료가 아닙니다')); assert.ok(html.includes('정상·안전·주행 가능 판정이 아닙니다'));
  assert.ok(!/네 타이어 · 로컬 직접 입력 기록|워셔액 · 안내와 스마트폰 점검|실제 SDK 관측과 별개/.test(html));
  assert.equal(record.tires['tire.front-left'].completedAt, 100);
  assert.ok(!/localStorage|sessionStorage|PSI|kPa|source="PLEOS"/.test(html));
});

test('each active screen has one explicit end action, with summary entry except summary/closing', () => {
  for (const name of Object.values(S)) {
    const html = sessionActions({ name });
    if (name === S.IDLE) { assert.equal(html, ''); continue; }
    assert.equal((html.match(/data-action="exit"/g) ?? []).length, 1);
    assert.ok(html.includes('>점검 종료</button>')); assert.ok(html.includes('저장된 과거 점검 기록은 그대로 남습니다'));
    assert.equal(html.includes('data-action="product-summary"'), ![S.INSPECTION_SUMMARY, S.HOOD_CLOSING].includes(name));
  }
});

test('Android Back dispatches exactly one shared step and closes only home or unavailable page', () => {
  const calls = [], closes = [];
  for (const name of Object.values(S).filter(s => s !== S.IDLE)) {
    assert.equal(inspectionBack({ state: { name }, dispatch: e => { calls.push(e); return false; } }, x => closes.push(x)), true);
  }
  assert.ok(calls.every(e => e.type === 'BACK')); assert.equal(closes.length, 0);
  assert.equal(inspectionBack({ state: { name: S.IDLE } }, x => closes.push(x)), true);
  inspectionBack(undefined, x => closes.push(x)); assert.equal(closes.length, 2);
});
