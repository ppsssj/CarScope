import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncClient, TRANSPORT, takeInviteFromLocation } from '../public/sync-client.mjs';
import { startSyncServer } from '../src/server.mjs';
import { buildInviteFragment, resultDigest } from '../src/protocol.mjs';
import { newToken } from '../src/sessions.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const done = (status = 'OK') => completeInspection(startInspection(), status);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noSleep = async () => {};

/** Fake fetch: claim succeeds; submissions follow the scripted list of responders. */
function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/claim')) return json(200, { submitToken: newToken(), taskId: 'washer-fluid', sessionState: 'CLAIMED', expiresAt: 0 });
    const step = steps.shift();
    if (!step) throw new TypeError('no more steps');
    return step(JSON.parse(init.body ?? 'null'), init);
  };
  return { fetchImpl, calls };
}
const receiptFor = async (result, extra = {}) => ({ protocol: 'inspection-sync', protocolVersion: 1, inspectionId: result.inspectionId, resultDigest: await resultDigest(result), receivedAt: 1, sessionState: 'RESULT_SUBMITTED', ...extra });
async function pairedClient(steps, opts = {}) {
  const f = scripted(steps);
  const c = new SyncClient({ baseUrl: 'https://sync.test', fetchImpl: f.fetchImpl, sleep: noSleep, ...opts });
  await c.claim(newToken());
  return { c, ...f };
}

test('[7] incomplete or invalid records are never sent', async () => {
  const { c, calls } = await pairedClient([]);
  for (const bad of [startInspection(), { ...done(), vin: 'x' }, null]) {
    const r = await c.send(bad);
    assert.equal(r.transport, TRANSPORT.REJECTED_INVALID);
  }
  assert.equal(calls.filter((x) => x.url.endsWith('/v1/submissions')).length, 0);
  const unpaired = new SyncClient({ baseUrl: 'https://sync.test', fetchImpl: () => assert.fail('no request') });
  assert.equal((await unpaired.send(done())).transport, TRANSPORT.REJECTED_UNAUTHORIZED);
});

test('double press: concurrent sends share one request; after SENT no further request', async () => {
  const r = done();
  const { c, calls } = await pairedClient([async () => json(201, { receipt: await receiptFor(r), duplicate: false })]);
  const [a, b] = await Promise.all([c.send(r), c.send(r)]);
  assert.equal(a, b);
  assert.equal(a.transport, TRANSPORT.SENT);
  assert.equal((await c.send(r)).transport, TRANSPORT.SENT);
  assert.equal(calls.filter((x) => x.url.endsWith('/v1/submissions')).length, 1);
  const init = calls.at(-1).init;
  assert.deepEqual([init.credentials, init.cache, init.referrerPolicy], ['omit', 'no-store', 'no-referrer']);
  assert.match(init.headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
  assert.ok(!calls.at(-1).url.includes('?'), 'token never in the URL');
});

test('[15] network failure is not success; retry with the same record reaches SENT', async () => {
  const r = done('NEEDS_REFILL');
  const bodies = [];
  const { c } = await pairedClient([
    async (b) => { bodies.push(b); throw new TypeError('Failed to fetch'); },
    async (b) => { bodies.push(b); return json(503, { error: { code: 'INTERNAL' } }); },
    async (b) => { bodies.push(b); return json(200, { receipt: await receiptFor(r), duplicate: true }); },
  ]);
  const res = await c.send(r);
  assert.equal(res.transport, TRANSPORT.SENT, 'a duplicate ACK of the same record counts as received');
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => JSON.stringify(b) === JSON.stringify(bodies[0])), 'every retry carries the identical envelope');
});

test('[15] retries are bounded; the outcome stays a failure', async () => {
  const { c } = await pairedClient([0, 1, 2].map(() => async () => { throw new TypeError('offline'); }));
  const r = await c.send(done());
  assert.equal(r.transport, TRANSPORT.FAILED_NETWORK);
  assert.equal(c.transport, TRANSPORT.FAILED_NETWORK);
  assert.equal(c.receipt, null);
});

test('timeout is reported as FAILED_TIMEOUT, distinct from network failure', async () => {
  const hang = () => async (_b, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const { c } = await pairedClient([hang()], { timeoutMs: 20, retries: 0 });
  assert.equal((await c.send(done())).transport, TRANSPORT.FAILED_TIMEOUT);
});

test('a 2xx without a matching receipt is never SENT', async () => {
  const r = done();
  for (const bad of [
    async () => json(201, {}),
    async () => json(201, { receipt: await receiptFor(r, { resultDigest: 'sha256:' + '0'.repeat(64) }) }),
    async () => json(201, { receipt: await receiptFor(done()) }),
    async () => new Response('<html>ok</html>', { status: 200 }),
  ]) {
    const { c } = await pairedClient([bad]);
    const res = await c.send(r);
    assert.notEqual(res.transport, TRANSPORT.SENT);
    assert.equal(c.receipt, null);
  }
});

test('expiry, closed, conflict, unauthorized and rate limits are distinct outcomes and not retried', async () => {
  const cases = [[410, 'SESSION_EXPIRED', TRANSPORT.REJECTED_EXPIRED], [409, 'SESSION_CLOSED', TRANSPORT.REJECTED_CLOSED], [409, 'CONFLICT', TRANSPORT.REJECTED_CONFLICT],
    [404, 'NOT_FOUND', TRANSPORT.REJECTED_UNAUTHORIZED], [422, 'INVALID_RESULT', TRANSPORT.REJECTED_INVALID], [429, 'RATE_LIMITED', TRANSPORT.RATE_LIMITED]];
  for (const [status, code, expected] of cases) {
    const { c, calls } = await pairedClient([async () => json(status, { error: { code } }), async () => assert.fail('must not retry')]);
    assert.equal((await c.send(done())).transport, expected, code);
    assert.equal(calls.filter((x) => x.url.endsWith('/v1/submissions')).length, 1);
  }
});

test('fetch is called unbound (browsers reject window.fetch invoked on another object)', async () => {
  const strictFetch = function (url) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return Promise.resolve(json(200, { submitToken: newToken(), taskId: 'washer-fluid' })); };
  const c = new SyncClient({ baseUrl: 'https://sync.test', fetchImpl: strictFetch });
  assert.equal((await c.claim(newToken())).ok, true);
});

test('the invite fragment is removed from the address bar on read', () => {
  const tok = newToken();
  const replaced = [];
  const loc = { hash: buildInviteFragment('washer-fluid', tok), pathname: '/debug', search: '' };
  const r = takeInviteFromLocation(loc, { replaceState: (...a) => replaced.push(a) });
  assert.deepEqual(r, { valid: true, task: 'washer-fluid', invite: tok });
  assert.deepEqual(replaced, [[null, '', '/debug']]);
  const none = [];
  takeInviteFromLocation({ hash: '', pathname: '/', search: '' }, { replaceState: (...a) => none.push(a) });
  assert.equal(none.length, 0);
});

test('[15] against the real server: server down -> FAILED_NETWORK, after restart the stale token is rejected, not silently SENT', async () => {
  const s = await startSyncServer({ port: 0, log: () => {} });
  const create = await (await fetch(`${s.url}/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"taskId":"washer-fluid"}' })).json();
  const c = new SyncClient({ baseUrl: s.url, sleep: noSleep, retries: 1 });
  assert.equal((await c.claim(create.inviteToken)).ok, true);
  const port = new URL(s.url).port;
  await s.stop();
  const r = done();
  assert.equal((await c.send(r)).transport, TRANSPORT.FAILED_NETWORK);
  const s2 = await startSyncServer({ port: Number(port), log: () => {} });
  try { assert.equal((await c.send(r)).transport, TRANSPORT.REJECTED_UNAUTHORIZED); } finally { await s2.stop(); }
});
