import test from 'node:test';
import assert from 'node:assert/strict';
import { statusFixture } from './tire-status-fixture.mjs';

test('visibility and native lifecycle bindings discard late bodies, avoid duplicate polling and unbind on renderer disposal', async () => {
  // Synthetic Window/Document event targets, not an Android lifecycle runtime result.
  const names = ['document', 'addEventListener', 'removeEventListener', 'fetch', 'setTimeout', 'clearTimeout'];
  const previous = new Map(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const page = new EventTarget(), events = new EventTarget(), requests = [], timers = new Map(); let id = 0;
  page.visibilityState = 'visible';
  Object.assign(globalThis, { document: page,
    addEventListener: (...a) => events.addEventListener(...a), removeEventListener: (...a) => events.removeEventListener(...a),
    fetch: (_, options) => new Promise(resolve => requests.push({ options, resolve })),
    setTimeout: (f, ms) => { const key = ++id; timers.set(key, { f, ms }); return key; }, clearTimeout: key => timers.delete(key) });
  const flush = () => new Promise(r => setImmediate(r));
  const packet = () => ({ ok: true, redirected: false, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(statusFixture()) });
  const api = await import('../tire-status.mjs?lifecycle-test');
  try {
    api.enableTireStatus(); api.enableTireStatus(); assert.equal(requests.length, 1);
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(requests[0].options.signal.aborted, true);
    events.dispatchEvent(new Event('carscope-tire-active')); assert.equal(requests.length, 1);
    requests[0].resolve(packet()); await flush();
    assert.equal(api.tireStatus.state.connectionStatus, 'STOPPED');
    assert.ok(api.tireStatus.state.readings.every(r => r.source === null && r.observedAt === null));
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); assert.equal(requests.length, 2);
    requests[1].resolve(packet()); await flush(); assert.equal(api.tireStatus.state.readings[0].source, 'MOCK');
    events.dispatchEvent(new Event('carscope-tire-inactive')); assert.equal(api.tireStatus.state.connectionStatus, 'STOPPED');
    events.dispatchEvent(new Event('carscope-tire-active')); assert.equal(requests.length, 3);
    api.disposeTireStatus(); requests[2].resolve(packet()); await flush();
    events.dispatchEvent(new Event('carscope-tire-active')); page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(requests.length, 3); assert.ok(api.tireStatus.state.readings.every(r => r.observedAt === null));
    assert.equal(timers.size, 0);
  } finally {
    api.disposeTireStatus();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
