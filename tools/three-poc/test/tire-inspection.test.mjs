import test from 'node:test';
import assert from 'node:assert/strict';
import { createTireInspection, updateTireInspection as update, CHECKS, inspectionProgress, needsReview } from '../tire-inspection.mjs';
import { guideHtml, summaryHtml } from '../tire-inspection-view.mjs';
import { TIRES } from '../inspection-tires.mjs';
import { initialState, transition, cameraGoal, hoodTarget } from '../inspection-flow.mjs';
const ids = TIRES.map(t => t.id), first = ids[0];
const answer = (s, id, check, value) => update(s, { type: 'ANSWER', sessionId: s.sessionId, tireId: id, checkId: check, answer: value });
const confirm = (s, id, at = 100) => update(s, { type: 'CONFIRM', sessionId: s.sessionId, tireId: id, at });
test('four independent immutable rows, user source, no SDK or invented observation', () => {
  const s = createTireInspection('one');
  assert.equal(inspectionProgress(s), 0);
  for (const id of ids) assert.deepEqual(s.tires[id], { tireId: id, sessionId: 'one', source: 'USER_REPORTED', responses: {}, status: 'NOT_STARTED', completedAt: null });
  assert.throws(() => { s.tires[first].responses.damage = 'FOUND'; }, TypeError);
  assert.throws(() => createTireInspection(''));
  const next = answer(s, first, 'damage', 'FOUND');
  assert.equal(next.tires[first].status, 'IN_PROGRESS');
  assert.equal(s.tires[first].status, 'NOT_STARTED');
  for (const id of ids.slice(1)) assert.equal(next.tires[id], s.tires[id]);
});
test('all three answers plus explicit confirmation required, including unable', () => {
  let s = createTireInspection('one');
  for (const c of CHECKS) {
    assert.equal(confirm(s, first), s);
    s = answer(s, first, c.id, c.id === 'debris' ? 'UNABLE' : 'NOT_FOUND');
  }
  assert.equal(s.tires[first].status, 'IN_PROGRESS');
  assert.equal(confirm(s, first, NaN), s);
  assert.equal(confirm(s, first, Number.MAX_SAFE_INTEGER), s);
  s = confirm(s, first);
  assert.equal(s.tires[first].status, 'COMPLETED'); assert.equal(s.tires[first].completedAt, 100);
  assert.deepEqual(needsReview(s.tires[first]), ['눈에 띄는 이물질']);
  assert.equal(confirm(s, first, 200), s);
  assert.equal(inspectionProgress(s), 1);
});
test('editing confirmed response invalidates timestamp until reconfirmation; repeated identical input is idempotent', () => {
  let s = createTireInspection('one');
  for (const c of CHECKS) s = answer(s, first, c.id, 'NOT_FOUND');
  s = confirm(s, first);
  assert.equal(answer(s, first, 'damage', 'NOT_FOUND'), s);
  s = answer(s, first, 'damage', 'FOUND');
  assert.equal(s.tires[first].completedAt, null); assert.equal(inspectionProgress(s), 0);
  assert.deepEqual(needsReview(s.tires[first]), ['외관 손상 또는 균열']);
  s = confirm(s, first, 300); assert.equal(s.tires[first].completedAt, 300);
});
test('invalid IDs, answers, stale session events and inherited keys cannot mutate a session', () => {
  const s = createTireInspection('new');
  for (const patch of [{ tireId: 'Wheel_0_1' }, { tireId: '__proto__' }, { checkId: 'pressure' }, { answer: 'OK' }, { answer: 'toString' }, { sessionId: 'old' }]) {
    assert.equal(update(s, { type: 'ANSWER', sessionId: 'new', tireId: first, checkId: 'damage', answer: 'FOUND', ...patch }), s);
  }
  assert.equal(update(s, { type: 'UNKNOWN', sessionId: 'new', tireId: first }), s);
});
test('rapid wheel switching, summary re-entry and exit preserve state machine camera and hood contracts', () => {
  let state = transition(initialState(), { type: 'START' });
  state = transition(state, { type: 'SELECT_AREA', id: 'tires' });
  for (let i = 0; i < 40; i++) {
    const id = ids[i % 4]; state = transition(state, { type: 'SELECT_TIRE', id });
    assert.equal(state.component, id); assert.equal(cameraGoal(state), id); assert.equal(hoodTarget(state), 0);
    assert.equal(transition(state, { type: 'SELECT_TIRE', id }), state);
  }
  state = transition(state, { type: 'SHOW_TIRE_SUMMARY' });
  assert.equal(state.name, 'TIRE_SUMMARY'); assert.equal(state.component, null); assert.equal(cameraGoal(state), 'tires');
  assert.equal(transition(state, { type: 'SHOW_TIRE_SUMMARY' }), state);
  state = transition(state, { type: 'SELECT_TIRE', id: first }); assert.equal(state.name, 'TIRE_PREVIEW');
  state = transition(state, { type: 'SHOW_TIRE_SUMMARY' });
  assert.equal(transition(state, { type: 'BACK' }).name, 'TIRE_SELECTION');
  assert.deepEqual(transition(state, { type: 'EXIT' }), initialState());
});
test('partial summary includes all vehicle positions and unresolved observations, never a health judgment', () => {
  let s = createTireInspection('one');
  s = answer(s, first, 'wear', 'UNABLE');
  const summary = summaryHtml(s), guide = guideHtml(s, first);
  assert.ok(summary.includes('0/4')); assert.ok(summary.includes('차량 전방'));
  for (const id of ids) assert.ok(summary.includes(id));
  assert.ok(summary.includes('불균일한 마모의 육안상 징후')); assert.ok(summary.includes('진행 중'));
  assert.equal((guide.match(/type="radio"/g) ?? []).length, 9);
  assert.ok(guide.includes('disabled')); assert.ok(guide.includes('USER_REPORTED'));
  assert.ok(!/localStorage|PSI|kPa|SUPPORTED/.test(summary + guide));
});
