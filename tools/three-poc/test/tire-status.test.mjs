import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTireStatus, TireStatusStore, TireStatusClient } from '../tire-status.mjs';
import { statusFixture } from './tire-status-fixture.mjs';
import { TIRES } from '../inspection-tires.mjs';

test('four IDs and two features map eight independent states, without pressure values', () => {
  const store = new TireStatusStore(); store.accept(statusFixture());
  for (const t of TIRES) {
    const view = store.forTire(t.id); assert.equal(view.features.length, 2); assert.equal(view.source, 'MOCK');
    assert.ok(view.features.every(r => r.vehiclePartId === t.id));
  }
  const left = store.forTire('tire.front-left');
  assert.equal(left.features[0].availabilityStatus, 'UNVERIFIED'); assert.equal(left.features[1].availabilityStatus, 'STALE');
  assert.equal(left.features[1].observedAt, 1793519999000);
  assert.equal(store.forTire('tire.front-right').features[0].availabilityStatus, 'UNSUPPORTED');
  assert.equal(store.forTire('tire.rear-left').features[0].availabilityStatus, 'PERMISSION_DENIED');
  assert.equal(store.forTire('tire.rear-right').features[0].availabilityStatus, 'ERROR');
  assert.equal(store.state.sessionPhase, 'UNRESOLVED');
  assert.ok(!JSON.stringify(store.state).includes('"value"'));
});
test('strict validation rejects unknown IDs, statuses, duplicate rows, raw fields and mixed sources', () => {
  const changes = [p => { p.readings[0].vehiclePartId = 'Wheel_0_1'; }, p => { p.readings[0].featureId = 'TirePressure'; },
    p => { p.readings[0].capabilityStatus = 'STALE'; }, p => { p.readings[0].availabilityStatus = 'UNRESOLVED'; },
    p => { p.readings[0].availabilityStatus = 'NORMAL'; }, p => { p.readings[1] = p.readings[0]; },
    p => { p.readings[0].value = 999.5; }, p => { p.readings[0].unit = 'kPa'; }, p => { p.readings[0].reason = '<script>private</script>'; },
    p => { p.readings[0].source = 'PLEOS'; }, p => { p.readings[0].source = null; }, p => { p.readings.pop(); },
    p => { p.readings[0].observedAt = -1; }, p => { p.readings[0].observedAt = Infinity; },
    p => { p.readings[1].observedAt = 1; }, p => { p.readings[4].observedAt = null; }, p => { p.sequence = 0; }, p => { p.sessionId = 'bad'; },
    p => { p.sdk = {}; }, p => { p.connectionStatus = 'STOPPED'; }];
  for (const change of changes) { const p = statusFixture(); change(p); assert.throws(() => validateTireStatus(p)); }
});
test('detached, PLEOS and explicit MOCK stay distinct; stopped clears every observation', () => {
  const store = new TireStatusStore(); assert.equal(store.forTire(TIRES[0].id).source, null);
  store.accept(statusFixture(1, 'PLEOS')); assert.equal(store.forTire(TIRES[0].id).source, 'PLEOS');
  store.invalidate(); assert.ok(store.state.readings.every(r => r.source === null && r.observedAt === null));
  store.accept(statusFixture(1)); assert.equal(store.forTire(TIRES[0].id).source, 'MOCK');
});
test('replay and old session are ignored until reset; payload is copied and immutable', () => {
  const store = new TireStatusStore(), p = statusFixture(); let updates = 0; store.subscribe(() => updates++);
  assert.equal(store.accept(p), true); p.readings[0].availabilityStatus = 'STALE';
  assert.equal(store.forTire(TIRES[0].id).features[0].availabilityStatus, 'UNVERIFIED');
  assert.equal(store.accept(p), false); assert.equal(updates, 1);
  const next = statusFixture(2); next.sessionId = '00000000-0000-4000-8000-000000000002';
  assert.equal(store.accept(next), false); store.invalidate(); assert.equal(store.accept(next), true);
  assert.throws(() => { store.state.readings[0].source = 'PLEOS'; });
});
test('unchanged metadata advances sequence without rerender and a real observation time change notifies once', () => {
  const store = new TireStatusStore(); let updates = 0; store.subscribe(() => updates++);
  store.accept(statusFixture(1)); store.accept(statusFixture(2)); assert.equal(updates, 1);
  const next = statusFixture(3); next.readings[0].observedAt++;
  store.accept(next); assert.equal(updates, 2); assert.equal(store.sequence, 3);
});

class Timers {
  next = 0; jobs = new Map();
  schedule = (f, ms) => { const id = ++this.next; this.jobs.set(id, { f, ms }); return id; };
  cancel = id => this.jobs.delete(id);
  run(ms) { for (const [id, job] of [...this.jobs]) if (job.ms === ms) { this.jobs.delete(id); job.f(); } }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = payload => ({ ok: true, redirected: false, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(payload) });
test('default timers never receive the client as a browser Window method receiver', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  try {
    globalThis.setTimeout = function () { assert.ok(!(this instanceof TireStatusClient)); return 1; };
    globalThis.clearTimeout = function () { assert.ok(!(this instanceof TireStatusClient)); };
    const client = new TireStatusClient(new TireStatusStore(), { fetchImpl: async () => response(statusFixture()) });
    client.start(); await flush(); client.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
test('single-flight fetch uses fixed path; a response after stop or restart cannot restore old data', async () => {
  const requests = [], timers = new Timers(), store = new TireStatusStore();
  const client = new TireStatusClient(store, { ...timers, schedule: timers.schedule, cancel: timers.cancel,
    fetchImpl: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) });
  client.start(); client.start(); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, './tire-status.json'); assert.equal(requests[0].options.credentials, 'omit');
  client.stop(); assert.equal(requests[0].options.signal.aborted, true); client.start();
  requests[0].resolve(response(statusFixture(1, 'PLEOS'))); await flush();
  assert.ok(store.state.readings.every(r => r.source === null));
  requests[1].resolve(response(statusFixture(1))); await flush();
  assert.equal(store.forTire(TIRES[0].id).source, 'MOCK'); client.stop();
  assert.ok(store.state.readings.every(r => r.observedAt === null));
});
test('transport timeout and invalid JSON become visible ERROR, with no mock fallback or secret retention', async () => {
  const store = new TireStatusStore(), timers = new Timers(); let calls = 0;
  const client = new TireStatusClient(store, { schedule: timers.schedule, cancel: timers.cancel,
    fetchImpl: (_, { signal }) => { calls++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('private text')))); } });
  client.start(); timers.run(3000); await flush();
  assert.equal(store.state.connectionStatus, 'UNAVAILABLE'); assert.ok(store.state.readings.every(r => r.availabilityStatus === 'ERROR' && r.source === null));
  assert.equal(calls, 1); timers.run(1000); assert.equal(calls, 2); client.stop(); await flush();
  const invalid = new TireStatusClient(store, { schedule: timers.schedule, cancel: timers.cancel, fetchImpl: async () => response({ value: 'secret' }) });
  invalid.start(); await flush(); assert.equal(store.state.connectionStatus, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(store.state).includes('secret')); invalid.stop();
});
test('an unexpected new native generation clears old observations instead of silently adopting another session', async () => {
  const store = new TireStatusStore(), timers = new Timers(); let calls = 0;
  const client = new TireStatusClient(store, { schedule: timers.schedule, cancel: timers.cancel,
    fetchImpl: async () => { const packet = statusFixture(++calls); if (calls > 1) packet.sessionId = '00000000-0000-4000-8000-000000000002'; return response(packet); } });
  client.start(); await flush(); assert.equal(store.state.connectionStatus, 'ATTACHED');
  timers.run(1000); await flush();
  assert.equal(store.state.connectionStatus, 'UNAVAILABLE'); assert.ok(store.state.readings.every(r => r.observedAt === null));
  assert.equal(store.sessionId, '00000000-0000-4000-8000-000000000001'); client.stop();
});
