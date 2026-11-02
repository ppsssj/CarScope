import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComponentStatus, ComponentStatusStore, ComponentStatusClient, componentStatus, componentStatusHtml, enableComponentStatus, disposeComponentStatus } from '../component-status.mjs';
import { componentFixture } from './component-status-fixture.mjs';

test('component contract preserves false raw Integer source and callback time independently of capability', () => {
  const p = validateComponentStatus(componentFixture());
  assert.equal(p.readings[0].value, false); assert.equal(p.readings[2].value, 73);
  assert.equal(p.readings[2].availabilityStatus, 'UNVERIFIED'); assert.equal(p.readings[2].unit, null);
  assert.equal(p.readings[2].vehiclePartId, 'ev-battery.pack'); assert.ok(Object.isFrozen(p.readings[0]));
});
test('component strict allow-list rejects unknown enums duplicate IDs units and impossible observation metadata', () => {
  const edit = (fn) => { const p = componentFixture(); fn(p); return p; };
  for (const p of [edit(p => p.vin = 'forbidden'), edit(p => p.readings.pop()), edit(p => p.readings[1] = p.readings[0]),
    edit(p => p.readings[0].reason = 'raw SDK'), edit(p => p.readings[0].source = 'PLEOS'), edit(p => p.readings[0].vehiclePartId = 'battery-12v'),
    edit(p => p.readings[0].observedAt = 1.2), edit(p => p.readings[0].observedAt = -1), edit(p => p.readings[0].value = 'false'),
    edit(p => p.readings[1].value = 'UNKNOWN'), edit(p => p.readings[1].value = 'ERROR'), edit(p => p.readings[2].unit = '%'),
    edit(p => p.readings[2].value = 1.5), edit(p => p.readings[2].availabilityStatus = 'SUPPORTED'),
    edit(p => p.readings[0].capabilityStatus = 'UNSUPPORTED'), edit(p => p.connectionStatus = 'STOPPED')]) assert.throws(() => validateComponentStatus(p));
});
test('component cache updates atomically and rejects old sequence or unexpected owner', () => {
  const store = new ComponentStatusStore(), p = componentFixture(); let emitted = 0; store.subscribe(() => emitted++);
  assert.equal(store.accept(p), true); assert.equal(emitted, 1); assert.equal(store.accept(p), false);
  assert.equal(store.accept({ ...p, sequence: 2 }), true); assert.equal(emitted, 1, 'sequence alone does not repaint');
  assert.equal(store.accept({ ...p, sequence: 3, sessionId: '00000000-0000-4000-8000-000000000002' }), false);
  const bad = structuredClone(p); bad.readings[0].value = 'bad'; assert.throws(() => store.accept(bad)); assert.equal(store.forPart('washer-fluid-cap')[0].value, false);
  store.unavailable(); assert.equal(store.forPart('washer-fluid-cap')[0].source, 'MOCK'); assert.equal(store.forPart('washer-fluid-cap')[0].value, null);
  store.invalidate(); assert.equal(store.forPart('washer-fluid-cap')[0].source, null);
});
test('component fetch failure clears old observations with no mock fallback and rejects redirects oversize and invalid JSON', async () => {
  for (const response of [new Response('bad'), new Response('x'.repeat(8193), { headers: { 'Content-Type': 'application/json' } }), new Response('{', { headers: { 'Content-Type': 'application/json' } }), { ok: true, redirected: true }]) {
    const store = new ComponentStatusStore(); store.accept(componentFixture());
    const client = new ComponentStatusClient(store, { fetchImpl: async () => response, schedule: () => 1, cancel: () => {} });
    client.running = true; client.generation = 1; await client.poll(1);
    assert.equal(store.state.connectionStatus, 'UNAVAILABLE'); assert.equal(store.state.readings[0].source, 'MOCK'); assert.equal(store.state.readings[0].observedAt, null); assert.equal(store.state.readings[0].value, null); client.stop();
  }
});
test('component client is single-flight and stop rejects a late in-flight response', async () => {
  let resolve, calls = 0, init;
  const store = new ComponentStatusStore();
  const client = new ComponentStatusClient(store, { fetchImpl: (_url, options) => { calls++; init = options; return new Promise(r => { resolve = r; }); }, schedule: () => 1, cancel: () => {} });
  client.start(); client.start(); assert.equal(calls, 1); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
  client.stop(); assert.equal(init.signal.aborted, true); resolve(new Response(JSON.stringify(componentFixture()), { headers: { 'Content-Type': 'application/json' } }));
  await new Promise(r => setTimeout(r, 0)); assert.equal(store.state.connectionStatus, 'STOPPED'); assert.equal(store.state.readings[0].source, null);
});
test('component panel separates API data from geometry and USER_REPORTED and never translates false into healthy', () => {
  componentStatus.invalidate('DETACHED'); assert.match(componentStatusHtml('washer-fluid-cap'), /없음 · 미연동/);
  componentStatus.accept(componentFixture());
  const html = componentStatusHtml('washer-fluid-cap'); assert.match(html, /USER_REPORTED/); assert.match(html, /형상 정확도/); assert.match(html, />false</); assert.ok(!html.includes('정상입니다'));
  const battery = componentStatusHtml('ev-battery.pack'); assert.match(battery, /단위\/범위 미검증/); assert.ok(!battery.includes('73%')); assert.ok(!battery.includes('battery-12v'));
  componentStatus.invalidate();
});

test('native active signal resets owner even if inactive was missed; hidden and disposal stop polling', async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  const events = new EventTarget(), document = new EventTarget(); document.visibilityState = 'visible'; let calls = 0;
  globalThis.document = document; globalThis.addEventListener = (...args) => events.addEventListener(...args); globalThis.removeEventListener = (...args) => events.removeEventListener(...args);
  globalThis.fetch = async () => { calls++; const p = componentFixture(); p.sessionId = calls === 1 ? p.sessionId : '00000000-0000-4000-8000-000000000002'; return new Response(JSON.stringify(p), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    enableComponentStatus(); await new Promise(r => setTimeout(r, 0));
    events.dispatchEvent(new Event('carscope-component-active')); await new Promise(r => setTimeout(r, 0));
    assert.equal(componentStatus.state.connectionStatus, 'ATTACHED'); assert.equal(componentStatus.sessionId, '00000000-0000-4000-8000-000000000002');
    document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); assert.equal(componentStatus.state.connectionStatus, 'STOPPED');
    disposeComponentStatus(); const before = calls; events.dispatchEvent(new Event('carscope-component-active')); await new Promise(r => setTimeout(r, 0)); assert.equal(calls, before);
  } finally { disposeComponentStatus(); Object.assign(globalThis, { fetch: previous.fetch, document: previous.document, addEventListener: previous.add, removeEventListener: previous.remove }); }
});
