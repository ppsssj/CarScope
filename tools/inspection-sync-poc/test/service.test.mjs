import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService, SyncError, STATES, DEFAULT_LIMITS, newToken } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { PROTOCOL, PROTOCOL_VERSION, resultDigest } from '../src/protocol.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const setup = (limits) => {
  let t = Date.parse('2026-11-01T10:00:00Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = new MemorySessionStore();
  return { clock, store, svc: new SessionService({ store, now: clock.now, limits }) };
};
const done = (status = 'OK') => completeInspection(startInspection(), status);
const env = (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });
const rejects = async (p, code) => { await assert.rejects(p, (e) => e instanceof SyncError && e.code === code, code); };
async function paired(svc) { const s = await svc.create({ taskId: 'washer-fluid' }); const c = await svc.claim(s.inviteToken); return { ...s, submitToken: c.submitToken }; }

test('[1] create: CREATED session, two distinct tokens, only hashes stored', async () => {
  const { svc, store } = setup();
  const s = await svc.create({ taskId: 'washer-fluid' });
  assert.notEqual(s.receiverToken, s.inviteToken);
  const raw = JSON.stringify(await store.all());
  assert.ok(!raw.includes(s.receiverToken) && !raw.includes(s.inviteToken), 'tokens never stored in clear');
  assert.equal((await svc.view(s.sessionId, s.receiverToken)).sessionState, STATES.CREATED);
  assert.equal(s.inviteExpiresAt - Date.parse('2026-11-01T10:00:00Z'), DEFAULT_LIMITS.inviteTtlMs);
  await rejects(svc.create({ taskId: 'coolant' }), 'BAD_REQUEST');
});

test('[5] invalid tokens: malformed -> UNAUTHORIZED, unknown -> NOT_FOUND; invite is one-time', async () => {
  const { svc } = setup();
  const s = await svc.create({ taskId: 'washer-fluid' });
  await rejects(svc.claim('not-a-token'), 'UNAUTHORIZED');
  await rejects(svc.claim(newToken()), 'NOT_FOUND');
  await svc.claim(s.inviteToken);
  await rejects(svc.claim(s.inviteToken), 'ALREADY_CLAIMED');
  await rejects(svc.submit(s.inviteToken, env(done())), 'NOT_FOUND', 'an invite is not a submit token');
});

test('[6] expiry: unclaimed invite after 10 min, unfinished session after 30 min; result data dropped', async () => {
  const a = setup();
  const s = await a.svc.create({ taskId: 'washer-fluid' });
  a.clock.advance(DEFAULT_LIMITS.inviteTtlMs + 1);
  await rejects(a.svc.claim(s.inviteToken), 'SESSION_EXPIRED');
  assert.equal((await a.svc.view(s.sessionId, s.receiverToken)).sessionState, STATES.EXPIRED);
  const b = setup();
  const p = await paired(b.svc);
  await b.svc.submit(p.submitToken, env(done()));
  b.clock.advance(DEFAULT_LIMITS.sessionTtlMs + 1);
  await rejects(b.svc.submit(p.submitToken, env(done())), 'SESSION_EXPIRED');
  const v = await b.svc.view(p.sessionId, p.receiverToken);
  assert.equal(v.sessionState, STATES.EXPIRED);
  assert.equal(v.result, null, 'expired session keeps no result');
  await rejects(b.svc.accept(p.sessionId, p.receiverToken, v.resultDigest), 'SESSION_EXPIRED');
});

test('[7][8] submit: incomplete refused; completed accepted with a receipt', async () => {
  const { svc } = setup();
  const p = await paired(svc);
  await rejects(svc.submit(p.submitToken, env(startInspection())), 'INVALID_RESULT');
  await rejects(svc.submit(p.submitToken, { ...env(done()), extra: 1 }), 'INVALID_RESULT');
  const r = done('NEEDS_REFILL');
  const { receipt, duplicate } = await svc.submit(p.submitToken, env(r));
  assert.equal(duplicate, false);
  assert.deepEqual(Object.keys(receipt).sort(), ['inspectionId', 'protocol', 'protocolVersion', 'receivedAt', 'resultDigest', 'sessionState']);
  assert.equal(receipt.inspectionId, r.inspectionId);
  assert.equal(receipt.resultDigest, await resultDigest(r));
  assert.equal(receipt.sessionState, STATES.RESULT_SUBMITTED);
});

test('[9][10] duplicate: identical result is idempotent; a different result is a conflict and never overwrites', async () => {
  const { svc } = setup();
  const p = await paired(svc);
  const r = done('OK');
  const first = await svc.submit(p.submitToken, env(r));
  const again = await svc.submit(p.submitToken, env(structuredClone(r)));
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.receipt, first.receipt);
  await rejects(svc.submit(p.submitToken, env({ ...r, status: 'UNSURE' })), 'CONFLICT'); // same inspectionId, other status
  await rejects(svc.submit(p.submitToken, env(done('UNSURE'))), 'CONFLICT'); // another attempt in the same session
  assert.equal((await svc.view(p.sessionId, p.receiverToken)).result.status, 'OK');
});

test('[9][10] concurrency: racing submits of different results -> exactly one stored, the other CONFLICT', async () => {
  for (let i = 0; i < 20; i++) {
    const { svc } = setup();
    const p = await paired(svc);
    const a = done('OK'), b = done('NEEDS_REFILL');
    const out = await Promise.allSettled([svc.submit(p.submitToken, env(a)), svc.submit(p.submitToken, env(b))]);
    const ok = out.filter((o) => o.status === 'fulfilled');
    assert.equal(ok.length, 1);
    assert.equal(out.find((o) => o.status === 'rejected').reason.code, 'CONFLICT');
    const stored = (await svc.view(p.sessionId, p.receiverToken)).result;
    assert.equal(stored.inspectionId, ok[0].value.receipt.inspectionId, 'the stored result is the acknowledged one');
  }
});

test('[5] concurrency: racing claims of one invite -> exactly one submit token', async () => {
  const { svc } = setup();
  const s = await svc.create({ taskId: 'washer-fluid' });
  const out = await Promise.allSettled([svc.claim(s.inviteToken), svc.claim(s.inviteToken), svc.claim(s.inviteToken)]);
  assert.equal(out.filter((o) => o.status === 'fulfilled').length, 1);
  assert.ok(out.filter((o) => o.status === 'rejected').every((o) => o.reason.code === 'ALREADY_CLAIMED'));
});

test('[11] roles: only the receiver token of that session reads results; the phone sees state only', async () => {
  const { svc } = setup();
  const p = await paired(svc), other = await paired(svc);
  await svc.submit(p.submitToken, env(done()));
  await rejects(svc.view(p.sessionId, other.receiverToken), 'NOT_FOUND', 'another session token');
  await rejects(svc.view(p.sessionId, p.submitToken), 'NOT_FOUND', 'phone token cannot read the receiver view');
  await rejects(svc.view(p.sessionId, p.inviteToken), 'NOT_FOUND');
  await rejects(svc.view(p.sessionId, 'x'), 'UNAUTHORIZED');
  const st = await svc.status(p.submitToken);
  assert.equal(st.sessionState, STATES.RESULT_SUBMITTED);
  assert.ok(!('result' in st), 'phone status carries no result view');
  await rejects(svc.accept(p.sessionId, p.submitToken, st.receipt.resultDigest), 'NOT_FOUND', 'phone cannot accept');
});

test('[12][13] accept: explicit, bound to the digest seen; afterwards no resubmission', async () => {
  const { svc, clock } = setup();
  const p = await paired(svc);
  await rejects(svc.accept(p.sessionId, p.receiverToken, 'sha256:x'), 'INVALID_STATE', 'nothing to accept yet');
  const r = done('UNSURE');
  await svc.submit(p.submitToken, env(r));
  await rejects(svc.accept(p.sessionId, p.receiverToken, 'sha256:not-it'), 'CONFLICT');
  const digest = await resultDigest(r);
  const v = await svc.accept(p.sessionId, p.receiverToken, digest);
  assert.equal(v.sessionState, STATES.ACCEPTED);
  assert.equal((await svc.accept(p.sessionId, p.receiverToken, digest)).sessionState, STATES.ACCEPTED, 'repeat accept is idempotent');
  await rejects(svc.submit(p.submitToken, env(r)), 'SESSION_CLOSED');
  await rejects(svc.submit(p.submitToken, env(done('OK'))), 'SESSION_CLOSED');
  assert.equal((await svc.status(p.submitToken)).sessionState, STATES.ACCEPTED);
  clock.advance(DEFAULT_LIMITS.acceptedRetentionMs + 1);
  await svc.sweep();
  assert.equal((await svc.view(p.sessionId, p.receiverToken)).result, null, 'result purged after retention');
});

test('[14] cancel: receiver ends the session, result deleted, further submit refused', async () => {
  const { svc } = setup();
  const p = await paired(svc);
  await svc.submit(p.submitToken, env(done()));
  const c = await svc.cancel(p.sessionId, p.receiverToken);
  assert.equal(c.sessionState, STATES.CANCELLED);
  const v = await svc.view(p.sessionId, p.receiverToken);
  assert.equal(v.result, null);
  await rejects(svc.submit(p.submitToken, env(done())), 'SESSION_CLOSED');
  await rejects(svc.accept(p.sessionId, p.receiverToken, 'sha256:x'), 'SESSION_CLOSED');
  const fresh = await svc.create({ taskId: 'washer-fluid' });
  await svc.cancel(fresh.sessionId, fresh.receiverToken);
  await rejects(svc.claim(fresh.inviteToken), 'NOT_FOUND', 'cancelled invite no longer resolves');
});

test('sweep: tombstones disappear after their window; capacity is bounded', async () => {
  const { svc, store, clock } = setup({ maxSessions: 3 });
  const s = await svc.create({ taskId: 'washer-fluid' });
  await svc.create({ taskId: 'washer-fluid' }); await svc.create({ taskId: 'washer-fluid' });
  await rejects(svc.create({ taskId: 'washer-fluid' }), 'CAPACITY');
  clock.advance(DEFAULT_LIMITS.inviteTtlMs + 1);
  assert.equal((await svc.sweep()).expired, 3);
  clock.advance(DEFAULT_LIMITS.tombstoneMs + 1);
  assert.equal((await svc.sweep()).deleted, 3);
  assert.equal(await store.count(), 0);
  await rejects(svc.view(s.sessionId, s.receiverToken), 'NOT_FOUND');
  await svc.create({ taskId: 'washer-fluid' }); // capacity freed
});

test('[18] restart policy: the memory store does not survive; old tokens resolve to NOT_FOUND, nothing is half-kept', async () => {
  const before = setup();
  const p = await paired(before.svc);
  await before.svc.submit(p.submitToken, env(done()));
  const restarted = new SessionService({ store: new MemorySessionStore() }); // a new process = a new empty store
  await rejects(restarted.status(p.submitToken), 'NOT_FOUND');
  await rejects(restarted.view(p.sessionId, p.receiverToken), 'NOT_FOUND');
  await rejects(restarted.submit(p.submitToken, env(done())), 'NOT_FOUND');
  assert.equal(new MemorySessionStore().kind, 'memory-single-process');
});

test('the service works against any store implementing the interface', async () => {
  const calls = [];
  const inner = new MemorySessionStore();
  const traced = new Proxy(inner, { get: (o, k) => (typeof o[k] === 'function' ? (...a) => { calls.push(k); return o[k](...a); } : o[k]) });
  const svc = new SessionService({ store: traced });
  const p = await paired(svc);
  await svc.submit(p.submitToken, env(done()));
  for (const m of ['insert', 'get', 'idByTokenHash', 'update']) assert.ok(calls.includes(m), m);
});
