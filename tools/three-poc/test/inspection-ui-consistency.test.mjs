// P9-S2: deterministic rules behind the result surfaces and the mobile request. No DOM, Native, device or GLB. AVD_NOT_RUN.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNativeInspectionResults } from '../native-inspection-results.mjs';
import { createAndroidNativeInspectionAdapter } from '../android-native-inspection-adapter.mjs';
import { createMobileRequestNotifier, createToast, MOBILE_REQUEST_TEXT as TEXT, TOAST_MS } from '../inspection-toast.mjs';
import { projectInspectionResults, resultCounts } from '../inspection-results.mjs';
import { partResultHtml, resultSummaryHtml } from '../inspection-results-view.mjs';
import { createTireInspection, updateTireInspection, CHECKS } from '../tire-inspection.mjs';
import { digestResult, MOBILE_TARGETS } from '../mobile-result-contract.mjs';
import { testAuthority, wireResult } from './result-fixtures.mjs';

const TIRE = 'tire.front-left', OTHER = 'brake-fluid';
const tick = () => new Promise(resolve => setImmediate(resolve));
function connected(options = {}) {
  const authority = testAuthority();
  const controller = createNativeInspectionResults({ adapter: authority.adapter, ...options });
  controller.startSession('local');
  return { authority, controller };
}
function held(authority) {
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  authority.reply(() => promise);
  return settle;
}
const rejected = () => Promise.reject(Object.assign(Error('refused'), { nativeRejected: true }));
function confirmed(session = createTireInspection('local'), id = TIRE, answer = 'FOUND') {
  let next = session;
  for (const check of CHECKS) next = updateTireInspection(next, { type: 'ANSWER', tireId: id, sessionId: next.sessionId, checkId: check.id, answer });
  return updateTireInspection(next, { type: 'CONFIRM', tireId: id, sessionId: next.sessionId, at: 1000 });
}
function notifierFor(controller, startScreen = 'part') {
  const shown = [];
  let screen = startScreen;
  const click = createMobileRequestNotifier({ request: taskId => controller.request(taskId), show: text => shown.push(text), screen: () => screen });
  return { shown, click, go: next => { screen = next; } };
}

// ---- result surfaces ----------------------------------------------------------------------------------------------------
test('card and summary are drawn from the same record the moment it is confirmed', () => {
  const { controller } = connected();
  const before = createTireInspection('local'), after = confirmed(before), mobile = controller.snapshot;
  assert.match(partResultHtml(before, mobile, TIRE), /data-inspection-state="NOT_INSPECTED"/);
  const card = partResultHtml(after, mobile, TIRE), summary = resultSummaryHtml(after, mobile);
  assert.match(card, /data-inspection-state="FINDINGS_REPORTED"/);
  assert.match(card, /이 화면에서 직접 입력/);
  assert.match(card, /1970-01-01T00:00:01\.000Z/);
  assert.match(summary, /점검 완료 1\/17 · 미점검 16 · 이상 징후 보고 1 · 확인 불가 0 · 발견 사항 없음 0/);
  const counts = resultCounts(projectInspectionResults(after, mobile));
  assert.equal(counts.FINDINGS_REPORTED, 1);
  assert.equal(Object.values(counts).reduce((sum, n) => sum + n), 17);
  controller.dispose();
});

test('a second confirm of the same record changes nothing', () => {
  const once = confirmed();
  assert.equal(updateTireInspection(once, { type: 'CONFIRM', tireId: TIRE, sessionId: once.sessionId, at: 2000 }), once);
  assert.equal(once.tires[TIRE].completedAt, 1000);
});

test('the newest verified mobile result is shown, and local and mobile stay separate', async () => {
  const { authority: { callbacks: c }, controller } = connected();
  const binding = { bindingId: 'b', localSessionId: c.localSessionId, generation: c.generation, syncSessionId: 's', taskId: TIRE, partId: TIRE, serverNow: 1000, expiresAt: 1e12 };
  assert.equal(c.onBinding(binding), 'BOUND');
  const result = wireResult(TIRE, 'UNABLE');
  assert.equal(await c.onAccepted({ bindingId: 'b', localSessionId: c.localSessionId, generation: c.generation, syncSessionId: 's', taskId: TIRE, inspectionId: result.inspectionId, resultDigest: await digestResult(result), result }), 'STAGED');
  const local = confirmed();
  const row = () => projectInspectionResults(local, controller.snapshot).find(r => r.partId === TIRE);
  assert.equal(controller.snapshot.selected[TIRE], result.inspectionId);
  assert.equal(row().status, 'UNABLE');
  assert.equal(row().source, 'MOBILE');
  assert.equal(row().local.status, 'FINDINGS_REPORTED', 'local record kept beside it');
  controller.dispose();
});

test('every one of the 17 targets still projects to not inspected from an empty session', () => {
  const rows = projectInspectionResults(createTireInspection('local'), null);
  assert.equal(rows.length, 17);
  assert.deepEqual(rows.map(r => r.taskId).sort(), MOBILE_TARGETS.map(t => t.taskId).sort());
  assert.ok(rows.every(r => r.status === 'NOT_INSPECTED'));
});

// ---- request outcomes -------------------------------------------------------------------------------------------------
test('Native accepting: sending first, then accepted; ids only, and no session or result is created', async () => {
  const { authority, controller } = connected(), settle = held(authority), ui = notifierFor(controller);
  const pending = ui.click(OTHER);
  assert.deepEqual(ui.shown, [TEXT.SENDING]);
  settle.resolve({ ok: true });
  assert.equal(await pending, 'ACCEPTED');
  assert.deepEqual(ui.shown, [TEXT.SENDING, TEXT.ACCEPTED]);
  assert.deepEqual(Object.keys(authority.requests[0]).sort(), ['generation', 'localSessionId', 'partId', 'taskId']);
  const snapshot = controller.snapshot;
  assert.equal(snapshot.bindings.length, 0);
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.notice, null);
  controller.dispose();
});

test('Native refusing after the fact never shows a success, and keeps a reason-neutral notice', async () => {
  const { authority, controller } = connected(), ui = notifierFor(controller);
  authority.reply(rejected);
  assert.equal(await ui.click(OTHER), 'REJECTED');
  assert.deepEqual(ui.shown, [TEXT.SENDING, TEXT.REJECTED]);
  assert.equal(controller.snapshot.notice, 'REQUEST_REJECTED');
  assert.equal(controller.snapshot.connection, 'ADAPTER_CONNECTED', 'one refusal does not end the connection');
  assert.match(partResultHtml(createTireInspection('local'), controller.snapshot, TIRE), /점검 요청을 시작할 수 없습니다/);
  assert.doesNotMatch(partResultHtml(createTireInspection('local'), controller.snapshot, TIRE), /다른 부품|새 결과를 완료로/);
  assert.doesNotMatch(resultSummaryHtml(createTireInspection('local'), controller.snapshot), /기존 표시 기록/);
  controller.dispose();
});

for (const [name, reply] of [
  ['a failed RPC', () => Promise.reject(Error('network'))],
  ['a synchronous throw', () => { throw Error('Old session'); }],
  ['an empty answer', () => undefined],
  ['an answer without ok:true', () => ({ ok: 'true' })],
  ['an unknown error shape', () => ({ error: 'REJECTED' })],
]) test(`${name} is a connection failure, never an acceptance`, async () => {
  const { authority, controller } = connected(), ui = notifierFor(controller);
  authority.reply(reply);
  assert.equal(await ui.click(OTHER), 'FAILED');
  assert.equal(ui.shown.at(-1), TEXT.FAILED);
  assert.equal(controller.snapshot.notice, 'REQUEST_FAILED');
  controller.dispose();
});

test('no adapter path: nothing is sent and the message says so', async () => {
  const controller = createNativeInspectionResults(), ui = notifierFor(controller);
  controller.startSession('local');
  assert.equal(await ui.click(OTHER), 'NOT_CONNECTED');
  assert.equal(ui.shown.at(-1), TEXT.NOT_CONNECTED);
  controller.dispose();
});

test('concurrent parts: while one request waits, another part sends nothing and does not disturb it', async () => {
  const { authority, controller } = connected(), settle = held(authority), ui = notifierFor(controller);
  const first = ui.click(TIRE);
  assert.equal(await ui.click(OTHER), 'IN_FLIGHT');
  assert.equal(ui.shown.at(-1), TEXT.IN_FLIGHT);
  assert.doesNotMatch(TEXT.IN_FLIGHT, /다른 부품/);
  assert.deepEqual(authority.requests.map(r => r.taskId), [TIRE]);
  settle.resolve({ ok: true });
  assert.equal(await first, 'ACCEPTED');
  controller.dispose();
});

test('repeated clicks send one request; the next request after an answer is sent normally', async () => {
  const { authority, controller } = connected(), settle = held(authority), ui = notifierFor(controller);
  const clicks = [ui.click(TIRE), ui.click(TIRE), ui.click(TIRE)];
  assert.equal(authority.requests.length, 1);
  settle.resolve({ ok: true });
  assert.deepEqual(await Promise.all(clicks), ['ACCEPTED', 'IN_FLIGHT', 'IN_FLIGHT']);
  authority.reply(() => ({ ok: true }));
  assert.equal(await ui.click(TIRE), 'ACCEPTED');
  assert.equal(authority.requests.length, 2);
  controller.dispose();
});

test('a new request after a failure clears the old failure before its own answer arrives', async () => {
  const { authority, controller } = connected(), ui = notifierFor(controller);
  authority.reply(rejected);
  await ui.click(OTHER);
  const settle = held(authority);
  const pending = ui.click(TIRE);
  assert.equal(controller.snapshot.notice, null);
  settle.resolve({ ok: true });
  assert.equal(await pending, 'ACCEPTED');
  assert.equal(controller.snapshot.notice, null);
  controller.dispose();
});

test('a request notice never removes an unrelated delivery notice', async () => {
  const { authority, controller } = connected();
  assert.equal(authority.callbacks.onBinding({}), 'INVALID_BINDING');
  await controller.request(OTHER);
  assert.equal(controller.snapshot.notice, 'INVALID_BINDING');
  controller.dispose();
});

test('reopening a task with a live binding does not say the session is not created', async () => {
  const { authority, controller } = connected(), ui = notifierFor(controller), c = authority.callbacks;
  assert.equal(c.onBinding({ bindingId: 'b', localSessionId: c.localSessionId, generation: c.generation, syncSessionId: 's', taskId: TIRE, partId: TIRE, serverNow: 1000, expiresAt: 1e12 }), 'BOUND');
  assert.equal(await ui.click(TIRE), 'ACCEPTED_ACTIVE_BINDING');
  assert.equal(ui.shown.at(-1), TEXT.ACCEPTED_ACTIVE_BINDING);
  assert.doesNotMatch(ui.shown.at(-1), /세션 생성 전/);
  assert.equal(await ui.click(OTHER), 'ACCEPTED', 'a different task has no such binding');
  controller.dispose();
});

// ---- late answers ------------------------------------------------------------------------------------------------------
test('Back while waiting: the late answer shows nothing on the next screen, but a refusal stays as a notice', async () => {
  for (const [settleIt, outcome, notice] of [[s => s.resolve({ ok: true }), 'ACCEPTED', null], [s => s.reject(Object.assign(Error('x'), { nativeRejected: true })), 'REJECTED', 'REQUEST_REJECTED']]) {
    const { authority, controller } = connected(), settle = held(authority), ui = notifierFor(controller);
    const pending = ui.click(TIRE);
    ui.go('summary');
    settleIt(settle);
    assert.equal(await pending, outcome);
    assert.deepEqual(ui.shown, [TEXT.SENDING]);
    assert.equal(controller.snapshot.notice, notice);
    controller.dispose();
  }
});

for (const [name, leave] of [
  ['ending the session', c => c.endSession()],
  ['a new session generation', c => c.startSession('next')],
  ['closing the screen', c => c.dispose()],
]) test(`${name} while waiting: the late success and late refusal are both silent`, async () => {
  for (const late of [s => s.resolve({ ok: true }), s => s.reject(Object.assign(Error('x'), { nativeRejected: true }))]) {
    const { authority, controller } = connected(), settle = held(authority), ui = notifierFor(controller);
    const pending = ui.click(TIRE);
    leave(controller);
    assert.equal(await Promise.race([pending, tick().then(() => 'STILL_WAITING')]), 'STALE', 'settled at once, not left to a timeout');
    late(settle);
    await tick();
    assert.deepEqual(ui.shown, [TEXT.SENDING]);
    assert.equal(controller.snapshot.notice, null);
    controller.dispose();
  }
});

test('an old answer cannot speak for the new session, and does not block its requests', async () => {
  const { authority, controller } = connected(), settleOld = held(authority);
  const old = controller.request(TIRE);
  controller.startSession('next');
  assert.equal(await old, 'STALE');
  const settleNew = held(authority);
  const fresh = controller.request(TIRE);
  settleOld.resolve({ ok: true });
  await tick();
  assert.equal(controller.snapshot.notice, null);
  settleNew.reject(Object.assign(Error('x'), { nativeRejected: true }));
  assert.equal(await fresh, 'REJECTED');
  controller.dispose();
});

test('an unavailable connection during a request ends it silently: the panel already reports the connection', async () => {
  const { authority, controller } = connected(), settle = held(authority);
  const pending = controller.request(TIRE);
  authority.callbacks.onUnavailable();
  settle.resolve({ ok: true });
  assert.equal(await pending, 'STALE');
  assert.equal(controller.snapshot.connection, 'UNAVAILABLE');
  controller.dispose();
});

test('an adapter that never answers times out as a failure, frees the next request, and its late success is ignored', async () => {
  let fire = null, cleared = 0;
  const { authority, controller } = connected({ requestTimeoutMs: 8000, setTimer: fn => { fire = fn; return 1; }, clearTimer: () => { cleared++; } });
  const settle = held(authority), first = controller.request(TIRE);
  fire();
  assert.equal(await first, 'FAILED');
  assert.equal(controller.snapshot.notice, 'REQUEST_FAILED');
  authority.reply(() => ({ ok: true }));
  assert.equal(await controller.request(TIRE), 'ACCEPTED');
  settle.resolve({ ok: true });
  await tick();
  assert.equal(controller.snapshot.notice, null);
  assert.ok(cleared >= 2, 'timers do not outlive their request');
  controller.dispose();
});

test('toast timing: 4 seconds, a newer message cancels the old timer, and a late outcome restarts it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const classes = new Set(), element = { textContent: '', classList: { toggle: (n, v) => (v ? classes.add(n) : classes.delete(n)), remove: n => classes.delete(n) } };
    const show = createToast(element, { setTimer: setTimeout, clearTimer: clearTimeout });
    let answer, screen = 'part';
    const click = createMobileRequestNotifier({ request: () => new Promise(resolve => { answer = resolve; }), show, screen: () => screen });
    const pending = click(TIRE);
    assert.equal(element.textContent, TEXT.SENDING);
    mock.timers.tick(TOAST_MS - 1);
    assert.ok(classes.has('on'));
    answer('REJECTED');
    await pending;
    assert.equal(element.textContent, TEXT.REJECTED);
    mock.timers.tick(TOAST_MS - 1);
    assert.ok(classes.has('on'), 'the SENDING timer was cancelled');
    mock.timers.tick(1);
    assert.equal(classes.has('on'), false);
  } finally { mock.timers.reset(); }
});

// ---- the real adapter's distinction ----------------------------------------------------------------------------------
async function withBridge(reply, run) {
  const original = Object.fromEntries(['location', 'self', 'top', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    globalThis.location = { origin: 'https://carscope-inspection.invalid', pathname: '/index.html' };
    globalThis.self = globalThis.top = globalThis;
    globalThis.fetch = async url => {
      const command = JSON.parse(new URL(url, location.origin).searchParams.get('command'));
      if (command.op === 'request') { const answer = await reply(command); if (answer instanceof Response) return answer; return new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } }); }
      return new Response(JSON.stringify(command.op === 'poll' ? { bindings: [], accepted: [], terminal: [], unavailable: null } : { ok: true }), { headers: { 'Content-Type': 'application/json' } });
    };
    const controller = createNativeInspectionResults({ adapter: createAndroidNativeInspectionAdapter() });
    controller.startSession('local');
    try { await run(controller); } finally { controller.dispose(); await new Promise(resolve => setTimeout(resolve, 20)); }
  } finally { for (const [k, d] of Object.entries(original)) if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
}
for (const [name, reply, outcome] of [
  ['ok', () => ({ ok: true }), 'ACCEPTED'],
  ['the conflict answer the bridge sends today', () => ({ error: 'REJECTED' }), 'REJECTED'],
  ['bridge inactive', () => ({ error: 'UNAVAILABLE' }), 'FAILED'],
  ['HTTP failure', () => new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }), 'FAILED'],
  ['network failure', () => { throw new TypeError('offline'); }, 'FAILED'],
  ['a reply without ok', () => ({}), 'FAILED'],
]) test(`fixed adapter maps ${name} to ${outcome}`, () => withBridge(reply, async controller => {
  assert.equal(await controller.request(TIRE), outcome);
}));

// ---- wiring and boundaries ----------------------------------------------------------------------------------------------
test('inspect.js routes local and mobile changes through one refresh and no longer treats a call as a confirmation', () => {
  const source = readFileSync(new URL('../inspect.js', import.meta.url), 'utf8');
  const guide = source.slice(source.indexOf('function renderGuide('), source.indexOf("$('panel').addEventListener('change', e =>"));
  assert.match(guide, /syncResultSurfaces\(\)/);
  assert.match(source, /mobileResults\.subscribe\(\(\)=>\{syncResultSurfaces\(\)/);
  assert.equal(source.match(/refreshResultRegions\(/g).length, 1);
  assert.doesNotMatch(source, /mobileRequestToast/);
  assert.doesNotMatch(source, /\$\('mobilePartResults'\)|\$\('allResults'\)/, 'no second writer for these regions');
});

test('the request path carries identifiers only and adds no storage or auto-selection', () => {
  const consumer = readFileSync(new URL('../native-inspection-results.mjs', import.meta.url), 'utf8');
  const request = consumer.slice(consumer.indexOf('request(taskId){'), consumer.indexOf('select(taskId,inspectionId){'));
  assert.doesNotMatch(request, /selected\.|records\.|token|credential|invite|localStorage|sessionStorage/i);
  for (const file of ['inspection-toast.mjs']) assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /localStorage|sessionStorage|fetch\(|token/i, file);
});
