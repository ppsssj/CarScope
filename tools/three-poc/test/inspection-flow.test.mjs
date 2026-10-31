import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES as S, EVENTS as E, INSPECTION_AREAS, initialState, transition, hoodTarget, cameraGoal, HOOD_OPEN_DEG } from '../inspection-flow.mjs';
import { SERVICE_EVIDENCE } from '../../ioniq5-asset/service-components.mjs';
import { handoffTarget, HANDOFF_FRAGMENT } from '../inspection-handoff.mjs';
import { handoffURL, parseHandoff } from '../../mobile-ar-poc/public/handoff.mjs';

const run = (events, ctx = { handoffConfigured: true }, s = initialState()) => events.reduce((st, ev) => transition(st, ev, ctx), s);
const START = { type: E.START }, HOOD = { type: E.SELECT_AREA, id: 'hood' }, OPENED = { type: E.HOOD_OPENED }, CLOSED = { type: E.HOOD_CLOSED };
const WASHER = { type: E.SELECT_COMPONENT, id: 'washer-fluid-cap' }, QR = { type: E.REQUEST_HANDOFF }, BACK = { type: E.BACK }, EXIT = { type: E.EXIT };

test('happy path reaches the mobile handoff with the hood open and the washer close-up', () => {
  const names = [];
  let st = initialState();
  for (const ev of [START, HOOD, OPENED, WASHER, QR]) { st = transition(st, ev, { handoffConfigured: true }); names.push(st.name); }
  assert.deepEqual(names, [S.INSPECTION_OVERVIEW, S.HOOD_OPENING, S.COMPONENT_SELECTION, S.WASHER_SELECTED, S.MOBILE_HANDOFF_READY]);
  assert.equal(hoodTarget(st), HOOD_OPEN_DEG);
  assert.equal(cameraGoal(st), 'washer');
  assert.equal(st.component, 'washer-fluid-cap');
});

test('duplicate and out-of-order events return the same state object', () => {
  const opening = run([START, HOOD]);
  assert.equal(transition(opening, HOOD), opening, 'second hood click while opening');
  assert.equal(transition(opening, WASHER), opening, 'cap click before the hood is open');
  assert.equal(transition(opening, CLOSED), opening, 'late close callback');
  const idle = initialState();
  for (const ev of [HOOD, WASHER, QR, OPENED, CLOSED, BACK]) assert.equal(transition(idle, ev), idle);
  const washer = run([START, HOOD, OPENED, WASHER]);
  assert.equal(transition(washer, WASHER), washer, 'second cap click');
});

test('cancel while opening closes the hood before returning to the overview', () => {
  const closing = run([START, HOOD, BACK]);
  assert.equal(closing.name, S.HOOD_CLOSING);
  assert.equal(hoodTarget(closing), 0);
  assert.equal(transition(closing, OPENED), closing, 'stale open completion is ignored');
  assert.equal(transition(closing, CLOSED).name, S.INSPECTION_OVERVIEW);
  // Re-selecting the hood while it closes reopens from the current pose.
  assert.equal(transition(closing, HOOD).name, S.HOOD_OPENING);
});

test('exit from any open state closes the hood and ends at home', () => {
  for (const path of [[START, HOOD], [START, HOOD, OPENED], [START, HOOD, OPENED, WASHER], [START, HOOD, OPENED, WASHER, QR]]) {
    const st = run([...path, EXIT]);
    assert.equal(st.name, S.HOOD_CLOSING, path.map((e) => e.type).join('>'));
    assert.equal(cameraGoal(st), 'home');
    const end = transition(st, CLOSED);
    assert.deepEqual(end, initialState());
  }
  assert.equal(run([START, EXIT]).name, S.IDLE, 'overview exits directly: hood is already closed');
  assert.equal(run([START, HOOD, BACK, EXIT, CLOSED]).name, S.IDLE, 'exit during a back-close retargets home');
});

test('back walks one step at a time', () => {
  assert.equal(run([START, HOOD, OPENED, WASHER, QR, BACK]).name, S.WASHER_SELECTED);
  assert.equal(run([START, HOOD, OPENED, WASHER, BACK]).name, S.COMPONENT_SELECTION);
  assert.equal(run([START, HOOD, OPENED, BACK]).name, S.HOOD_CLOSING);
  assert.equal(run([START, BACK]).name, S.IDLE);
});

test('the hood is closed in every state where it is not explicitly open', () => {
  for (const st of [initialState(), run([START]), run([START, HOOD, BACK])]) assert.equal(hoodTarget(st), 0, st.name);
});

test('planned components and a missing handoff are never active', () => {
  const sel = run([START, HOOD, OPENED]);
  for (const c of INSPECTION_AREAS[0].components.filter((c) => c.status !== 'available')) assert.equal(transition(sel, { type: E.SELECT_COMPONENT, id: c.id }), sel, c.id);
  const washer = run([START, HOOD, OPENED, WASHER]);
  assert.equal(transition(washer, QR, { handoffConfigured: false }), washer);
  assert.equal(transition(run([START]), { type: E.SELECT_AREA, id: 'tailgate' }).name, S.INSPECTION_OVERVIEW);
});

test('component ids match the service geometry evidence', () => {
  assert.deepEqual(INSPECTION_AREAS[0].components.map((c) => c.id), SERVICE_EVIDENCE.map((e) => e.id));
  assert.deepEqual(INSPECTION_AREAS[0].components.filter((c) => c.status === 'available').map((c) => c.id), ['washer-fluid-cap']);
});

test('handoff uses the QR-AR contract and rejects unsafe origins', () => {
  assert.equal(HANDOFF_FRAGMENT, '#v=1&task=washer-fluid');
  assert.deepEqual(handoffTarget('https://assist.example.test/'), { configured: true, url: 'https://assist.example.test/#v=1&task=washer-fluid', reason: null });
  assert.equal(handoffTarget('https://assist.example.test').url, 'https://assist.example.test/#v=1&task=washer-fluid');
  // Single source: the same URL the QR-AR server and staging build produce, and it parses as a valid task there.
  for (const origin of ['https://assist.example.test/', 'https://poc.example:4174/']) {
    assert.equal(handoffTarget(origin).url, handoffURL(origin));
    assert.deepEqual(parseHandoff(new URL(handoffTarget(origin).url).hash), { valid: true, source: 'qr-task' });
  }
  for (const bad of [undefined, '', 'not a url', 'javascript:alert(1)', 'http://assist.example.test/', 'https://u:p@assist.example.test/', 'https://assist.example.test/app/', 'https://assist.example.test/?x=1', 'https://assist.example.test/#v=2', 'https://localhost/', 'https://test.localhost/', 'https://127.0.0.1/', 'https://127.1.2.3/', 'https://[::1]/']) {
    const r = handoffTarget(bad);
    assert.equal(r.configured, false, String(bad));
    assert.equal(r.url, null);
  }
});
