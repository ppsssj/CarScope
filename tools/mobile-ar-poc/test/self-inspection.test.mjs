import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInspection, noteAids, completeInspection, validateResult, STATUSES, STATES, SCHEMA_VERSION, STATUS_TEXT } from '../public/inspection-result.mjs';
import { reduce, initialState, allChecked, progressOf, CHECK_ITEMS } from '../public/self-inspection.mjs';
import { tapToVideoPoint, videoPointToStage } from '../public/marker.mjs';
import { HANDOFF, parseHandoff } from '../public/handoff.mjs';

let clock = Date.parse('2026-11-01T09:00:00.000Z');
const ctx = { now: () => clock, newId: () => 'd8e1c3b2-5a4f-4c6e-9b7a-1f2e3d4c5b6a' };

test('a new record is IN_PROGRESS with only the allowed fields and no vehicle or personal data', () => {
  const r = startInspection(ctx);
  assert.deepEqual(validateResult(r), []);
  assert.equal(r.state, STATES.IN_PROGRESS);
  assert.deepEqual(Object.keys(r).sort(), ['aids', 'inspectionId', 'method', 'schemaVersion', 'source', 'startedAt', 'state', 'taskId']);
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.taskId, 'washer-fluid');
  assert.equal(r.method, 'SELF');
  assert.equal(r.source, 'MOBILE');
  assert.ok(!('status' in r) && !('completedAt' in r), 'an unfinished attempt carries no result');
  assert.ok(Object.isFrozen(r));
});

test('completion: three statuses, USER_REPORTED, NOT_SENT, timestamps ordered', () => {
  for (const status of STATUSES) {
    const started = startInspection(ctx);
    clock += 60_000;
    const done = completeInspection(started, status, ctx);
    assert.deepEqual(validateResult(done), []);
    assert.equal(done.state, STATES.COMPLETED);
    assert.equal(done.status, status);
    assert.equal(done.confirmation, 'USER_REPORTED');
    assert.equal(done.sync, 'NOT_SENT', 'AR-01 has no transport: never marked as sent');
    assert.ok(Date.parse(done.completedAt) >= Date.parse(done.startedAt));
    assert.equal(done.inspectionId, started.inspectionId);
    assert.ok(STATUS_TEXT[status].label && STATUS_TEXT[status].followUp);
  }
  assert.match(STATUS_TEXT.OK.followUp, /인증하지 않습니다/, 'OK is a user report, not a safety certification');
});

test('one attempt yields at most one completed result; bad statuses are refused', () => {
  const started = startInspection(ctx);
  const done = completeInspection(started, 'OK', ctx);
  assert.throws(() => completeInspection(done, 'NEEDS_REFILL', ctx), /not in progress/);
  assert.throws(() => completeInspection(started, 'GOOD', ctx), /unknown status/);
  assert.throws(() => completeInspection(null, 'OK', ctx));
});

test('validation rejects extra or sensitive fields and malformed values', () => {
  const done = completeInspection(startInspection(ctx), 'UNSURE', ctx);
  for (const extra of ['vin', 'VIN', 'crn', 'plate', 'image', 'video', 'photo', 'location', 'email', 'account', 'deviceId']) {
    assert.ok(validateResult({ ...done, [extra]: 'x' }).includes(`unexpected field: ${extra}`), extra);
  }
  assert.ok(validateResult({ ...done, aids: { ...done.aids, point: { x: 0.5, y: 0.5 } } }).includes('aids'), 'no screen coordinates');
  assert.ok(validateResult({ ...done, status: 'GOOD' }).includes('status'));
  assert.ok(validateResult({ ...done, confirmation: 'VERIFIED' }).includes('confirmation'));
  assert.ok(validateResult({ ...done, sync: 'SENT' }).includes('sync'));
  assert.ok(validateResult({ ...done, completedAt: '2020-01-01T00:00:00.000Z' }).includes('completedAt'));
  assert.ok(validateResult({ ...done, inspectionId: 'abc' }).includes('inspectionId'));
  assert.ok(validateResult({ ...done, taskId: 'coolant' }).includes('taskId'));
  const { completedAt, ...missing } = done;
  assert.ok(validateResult(missing).includes('missing field: completedAt'));
  assert.deepEqual(validateResult({ state: 'DRAFT' }), ['unknown state: DRAFT']);
});

test('ids are random per attempt (UUID v4) and aids record booleans only', () => {
  const a = startInspection(), b = startInspection();
  assert.notEqual(a.inspectionId, b.inspectionId);
  assert.deepEqual(validateResult(a), []);
  const marked = noteAids(a, { cameraUsed: true, locationMarked: true, x: 0.3 });
  assert.deepEqual(marked.aids, { cameraUsed: true, locationMarked: true });
  assert.deepEqual(validateResult(marked), []);
  const done = completeInspection(marked, 'OK', ctx);
  assert.equal(noteAids(done, { cameraUsed: false }), done, 'completed record is not modified');
});

const run = (events, s = initialState()) => events.reduce((st, e) => reduce(st, e, ctx), s);
const checkAll = CHECK_ITEMS.map((c) => ({ type: 'TOGGLE', id: c.id, value: true }));

test('camera path: intro -> locate -> check -> result -> confirm -> done', () => {
  const steps = [];
  let s = initialState();
  for (const e of [{ type: 'START', camera: true }, { type: 'TO_CHECK' }, ...checkAll, { type: 'TO_RESULT' }, { type: 'SELECT', status: 'NEEDS_REFILL' }, { type: 'TO_CONFIRM' }, { type: 'CONFIRM' }]) {
    s = reduce(s, e, ctx); steps.push(s.step);
  }
  assert.deepEqual([...new Set(steps)], ['locate', 'check', 'result', 'confirm', 'done']);
  assert.equal(s.record.status, 'NEEDS_REFILL');
  assert.deepEqual(validateResult(s.record), []);
  assert.equal(progressOf('locate'), 2);
  assert.equal(progressOf('done'), 4);
});

test('manual path skips the camera step', () => {
  const s = run([{ type: 'START', camera: false }]);
  assert.equal(s.step, 'check');
  assert.equal(s.mode, 'manual');
  assert.equal(run([{ type: 'BACK' }], s).step, 'intro', 'back from manual check returns to the start');
  const viaLocate = run([{ type: 'START', camera: true }, { type: 'TO_CHECK', manual: true }]);
  assert.equal(viaLocate.mode, 'manual');
});

test('gates: no result before every check item, no confirm before a choice, unknown status ignored', () => {
  let s = run([{ type: 'START', camera: false }, { type: 'TOGGLE', id: 'parked', value: true }]);
  assert.equal(reduce(s, { type: 'TO_RESULT' }, ctx), s);
  s = run([...checkAll.slice(1), { type: 'TO_RESULT' }], s);
  assert.equal(s.step, 'result');
  assert.equal(reduce(s, { type: 'TO_CONFIRM' }, ctx), s);
  assert.equal(reduce(s, { type: 'SELECT', status: 'MAYBE' }, ctx), s);
  assert.equal(reduce(s, { type: 'TOGGLE', id: 'parked', value: false }, ctx), s, 'checklist frozen outside its step');
  assert.ok(allChecked(s));
});

test('duplicate confirm and late events cannot create or change a second result', () => {
  const confirm = run([{ type: 'START', camera: false }, ...checkAll, { type: 'TO_RESULT' }, { type: 'SELECT', status: 'OK' }, { type: 'TO_CONFIRM' }]);
  const done = reduce(confirm, { type: 'CONFIRM' }, ctx);
  for (const e of [{ type: 'CONFIRM' }, { type: 'SELECT', status: 'UNSURE' }, { type: 'BACK' }, { type: 'CANCEL' }, { type: 'NOTE_AIDS', cameraUsed: true }]) {
    assert.equal(reduce(done, e, ctx), done, e.type);
  }
});

test('back steps one at a time; cancel discards an unfinished attempt; restart begins a new one', () => {
  const confirm = run([{ type: 'START', camera: true }, { type: 'TO_CHECK' }, ...checkAll, { type: 'TO_RESULT' }, { type: 'SELECT', status: 'OK' }, { type: 'TO_CONFIRM' }]);
  assert.equal(run([{ type: 'BACK' }], confirm).step, 'result');
  assert.equal(run([{ type: 'BACK' }, { type: 'BACK' }], confirm).step, 'check');
  assert.equal(run([{ type: 'BACK' }, { type: 'BACK' }, { type: 'BACK' }], confirm).step, 'locate');
  assert.deepEqual(run([{ type: 'BACK' }, { type: 'BACK' }, { type: 'BACK' }, { type: 'BACK' }], confirm), initialState());
  assert.deepEqual(run([{ type: 'CANCEL' }], confirm), initialState(), 'cancel leaves no record');
  const done = reduce(confirm, { type: 'CONFIRM' }, ctx);
  const again = run([{ type: 'RESTART' }, { type: 'START', camera: false }], done);
  assert.equal(again.step, 'check');
  assert.equal(again.record.state, STATES.IN_PROGRESS);
  assert.equal(done.record.state, STATES.COMPLETED, 'restart leaves the completed record untouched');
});

test('marker: taps map into the video frame through letterboxing and back; letterbox taps are rejected', () => {
  // 1280x720 video in a 390x520 portrait stage: letterboxed top and bottom.
  const p = tapToVideoPoint(195, 260, 1280, 720, 390, 520);
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9);
  assert.equal(tapToVideoPoint(195, 10, 1280, 720, 390, 520), null, 'tap on the letterbox');
  const back = videoPointToStage({ x: 0.25, y: 0.75 }, 1280, 720, 390, 520);
  const again = tapToVideoPoint(back.x, back.y, 1280, 720, 390, 520);
  assert.ok(Math.abs(again.x - 0.25) < 1e-9 && Math.abs(again.y - 0.75) < 1e-9);
  // Same video point after a resize lands at the corresponding place (2D re-projection, not 3D tracking).
  const wide = videoPointToStage({ x: 0.25, y: 0.75 }, 1280, 720, 844, 390);
  assert.ok(wide.x > 0 && wide.x < 844 && wide.y > 0 && wide.y < 390);
  assert.equal(tapToVideoPoint(10, 10, 0, 0, 390, 520), null, 'no video yet');
});

test('the QR v1 contract is unchanged and carries no vehicle or session identifier', () => {
  assert.equal(HANDOFF, '#v=1&task=washer-fluid');
  assert.deepEqual(parseHandoff(HANDOFF), { valid: true, source: 'qr-task' });
  for (const hash of ['#v=1&task=washer-fluid&vin=KMH', '#v=1&task=washer-fluid&inspectionId=x', '#v=1&task=washer-fluid&session=1']) {
    assert.equal(parseHandoff(hash).valid, false, hash);
  }
});
