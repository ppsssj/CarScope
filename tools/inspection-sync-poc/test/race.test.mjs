// Concurrency regressions: interleavings are forced with gates on the store boundary (the only place the service
// awaits), plus a seeded fuzz that lets a ticking clock cross the expiry boundary while operations race.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService, STATES } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { PROTOCOL, PROTOCOL_VERSION, resultDigest } from '../src/protocol.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const TERMINAL = new Set([STATES.ACCEPTED, STATES.CANCELLED, STATES.EXPIRED]);
const env = (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, code: e.code ?? String(e) }));
const METHODS = ['insert', 'get', 'idByTokenHash', 'update', 'delete', 'all', 'count'];

/**
 * Store wrapper: hold(method, {after}) pauses the next call of that method before (or after) it runs; every update is
 * also checked for the invariant "a terminal state is never replaced by another state".
 */
function controlledStore({ inner = new MemorySessionStore(), yields = null } = {}) {
  const gates = [], violations = [];
  const store = { kind: inner.kind };
  for (const m of METHODS) {
    store[m] = async (...args) => {
      if (yields) for (let i = yields(); i > 0; i--) await new Promise((r) => setImmediate(r));
      const g = gates.find((x) => x.method === m && !x.taken);
      if (g) g.taken = true;
      if (g && !g.after) { g.arrive(); await g.wait; }
      if (m === 'update') {
        const [id, mutate] = args;
        args = [id, (x) => { const n = mutate(x); if (TERMINAL.has(x.state) && n.state !== x.state) violations.push(`${x.state} -> ${n.state}`); return n; }];
      }
      const out = await inner[m](...args);
      if (g && g.after) { g.arrive(); await g.wait; }
      return out;
    };
  }
  const hold = (method, { after = false } = {}) => {
    let arrive, release;
    const reached = new Promise((r) => { arrive = r; });
    const wait = new Promise((r) => { release = r; });
    gates.push({ method, after, arrive, wait, taken: false });
    return { reached, release };
  };
  return { store, inner, hold, violations };
}

function clockAt(start = Date.parse('2026-11-01T10:00:00Z')) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; } };
}

async function submitted(svc, status = 'OK') {
  const s = await svc.create({ taskId: 'washer-fluid' });
  const c = await svc.claim(s.inviteToken);
  const r = completeInspection(startInspection(), status);
  await svc.submit(c.submitToken, env(r));
  return { ...s, submitToken: c.submitToken, result: r, digest: await resultDigest(r) };
}

test('race: expiry vs accept — accept read before the deadline, written after; sweep expires in between', async () => {
  const clock = clockAt(), cs = controlledStore();
  const svc = new SessionService({ store: cs.store, now: clock.now });
  const p = await submitted(svc);
  clock.set(p.expiresAt - 1);
  const gA = cs.hold('update');
  const accept = settle(svc.accept(p.sessionId, p.receiverToken, p.digest));
  await gA.reached; // accept has read RESULT_SUBMITTED before the deadline
  clock.set(p.expiresAt + 1);
  const gS = cs.hold('update');
  const sweep = svc.sweep();
  await gS.reached; // sweep has decided to expire from its snapshot
  gA.release();
  const a = await accept;
  gS.release();
  await sweep;
  const final = await cs.inner.get(p.sessionId);
  assert.deepEqual(cs.violations, [], 'no terminal state overwritten');
  if (a.ok) { assert.equal(final.state, STATES.ACCEPTED, 'accept was reported, so the session must stay ACCEPTED'); assert.ok(final.result); }
  else { assert.equal(a.code, 'SESSION_EXPIRED'); assert.equal(final.state, STATES.EXPIRED); assert.equal(final.result, null); }
});

test('race: expiry vs cancel — the reported outcome is the final state, result deleted either way', async () => {
  const clock = clockAt(), cs = controlledStore();
  const svc = new SessionService({ store: cs.store, now: clock.now });
  const p = await submitted(svc);
  clock.set(p.expiresAt - 1);
  const gC = cs.hold('update');
  const cancel = settle(svc.cancel(p.sessionId, p.receiverToken));
  await gC.reached;
  clock.set(p.expiresAt + 1);
  const gS = cs.hold('update');
  const sweep = svc.sweep();
  await gS.reached;
  gC.release();
  const c = await cancel;
  gS.release();
  await sweep;
  const final = await cs.inner.get(p.sessionId);
  assert.deepEqual(cs.violations, []);
  assert.equal(final.state, c.ok ? STATES.CANCELLED : STATES.EXPIRED);
  assert.equal(final.result, null);
});

test('race: a stale expiry job (snapshot taken before the accept) never overwrites ACCEPTED', async () => {
  // Two service instances share one store; the sweeping one runs late (clock skew / delayed timer), the other accepts
  // in time. The sweep's snapshot still shows RESULT_SUBMITTED when its expiry write arrives.
  const clock = clockAt(), late = clockAt(), cs = controlledStore();
  const svc = new SessionService({ store: cs.store, now: clock.now });
  const sweeper = new SessionService({ store: cs.store, now: late.now });
  const p = await submitted(svc, 'NEEDS_REFILL');
  clock.set(p.expiresAt - 1);
  late.set(p.expiresAt + 1);
  const gAll = cs.hold('all', { after: true });
  const sweep = sweeper.sweep();
  await gAll.reached; // snapshot: RESULT_SUBMITTED, overdue for the late clock
  const accepted = await svc.accept(p.sessionId, p.receiverToken, p.digest);
  assert.equal(accepted.sessionState, STATES.ACCEPTED);
  gAll.release();
  await sweep;
  const final = await cs.inner.get(p.sessionId);
  assert.deepEqual(cs.violations, []);
  assert.equal(final.state, STATES.ACCEPTED);
  assert.deepEqual(final.result, p.result, 'accepted result kept for its retention window, not wiped by the stale job');
  assert.equal(final.purgeResultAt, final.acceptedAt + 10 * 60_000);
});

test('race: a stale expiry job never overwrites CANCELLED', async () => {
  const clock = clockAt(), late = clockAt(), cs = controlledStore();
  const svc = new SessionService({ store: cs.store, now: clock.now });
  const sweeper = new SessionService({ store: cs.store, now: late.now });
  const p = await submitted(svc);
  clock.set(p.expiresAt - 1);
  late.set(p.expiresAt + 1);
  const gAll = cs.hold('all', { after: true });
  const sweep = sweeper.sweep();
  await gAll.reached;
  await svc.cancel(p.sessionId, p.receiverToken);
  gAll.release();
  await sweep;
  assert.deepEqual(cs.violations, []);
  assert.equal((await cs.inner.get(p.sessionId)).state, STATES.CANCELLED);
});

test('race: a stale lazy expiry (read before the deadline by one request) does not undo a later transition', async () => {
  // Request A (late clock) reads the session as overdue and is about to write EXPIRED; request B (in time) accepts first.
  const clock = clockAt(), late = clockAt(), cs = controlledStore();
  const svc = new SessionService({ store: cs.store, now: clock.now });
  const lateSvc = new SessionService({ store: cs.store, now: late.now });
  const p = await submitted(svc);
  clock.set(p.expiresAt - 1);
  late.set(p.expiresAt + 1);
  const gU = cs.hold('update');
  const lateRead = settle(lateSvc.view(p.sessionId, p.receiverToken));
  await gU.reached;
  const acceptedP = svc.accept(p.sessionId, p.receiverToken, p.digest);
  // accept's own update is queued behind nothing (the gate is used up), so it commits now
  const accepted = await acceptedP;
  gU.release();
  const lr = await lateRead;
  assert.equal(accepted.sessionState, STATES.ACCEPTED);
  assert.deepEqual(cs.violations, []);
  assert.equal((await cs.inner.get(p.sessionId)).state, STATES.ACCEPTED);
  assert.ok(lr.ok && lr.v.sessionState === STATES.ACCEPTED, 'the late reader sees the committed ACCEPTED state');
});

test('race: sweep running concurrently with transitions (seeded fuzz across the expiry boundary)', async () => {
  let seed = 0x2a02a;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const problems = [];
  for (let i = 0; i < 300; i++) {
    let t = Date.parse('2026-11-01T10:00:00Z'), ticking = false;
    const now = () => (ticking ? (t += 1) : t);
    const cs = controlledStore({ yields: () => (ticking ? Math.floor(rnd() * 3) : 0) });
    const svc = new SessionService({ store: cs.store, now, limits: { sessionTtlMs: 60_000, acceptedRetentionMs: 2, tombstoneMs: 4 } });
    const p = await submitted(svc);
    t = p.expiresAt - Math.floor(rnd() * 8);
    ticking = true;
    const ops = { sweep1: settle(svc.sweep()), sweep2: settle(svc.sweep()), status: settle(svc.status(p.submitToken)), dup: settle(svc.submit(p.submitToken, env(p.result))) };
    if (rnd() < 0.5) ops.accept = settle(svc.accept(p.sessionId, p.receiverToken, p.digest));
    else ops.cancel = settle(svc.cancel(p.sessionId, p.receiverToken));
    const out = Object.fromEntries(await Promise.all(Object.entries(ops).map(async ([k, v]) => [k, await v])));
    const final = await cs.inner.get(p.sessionId); // may be null if a tombstone was already deleted
    const tag = `iter ${i}`;
    if (cs.violations.length) problems.push(`${tag}: ${cs.violations.join(', ')}`);
    if (out.accept?.ok && final && final.state !== STATES.ACCEPTED) problems.push(`${tag}: accept reported, final ${final.state}`);
    if (out.cancel?.ok && final && final.state !== STATES.CANCELLED) problems.push(`${tag}: cancel reported, final ${final.state}`);
    if (final && (final.state === STATES.EXPIRED || final.state === STATES.CANCELLED) && final.result !== null) problems.push(`${tag}: ${final.state} kept result`);
    for (const k of ['sweep1', 'sweep2']) if (!out[k].ok) problems.push(`${tag}: ${k} threw ${out[k].code}`);
  }
  assert.deepEqual(problems, []);
});

test('race: concurrent creates never exceed maxSessions', async () => {
  const cs = controlledStore();
  const svc = new SessionService({ store: cs.store, limits: { maxSessions: 3 } });
  const out = await Promise.all(Array.from({ length: 25 }, () => settle(svc.create({ taskId: 'washer-fluid' }))));
  assert.equal(out.filter((o) => o.ok).length, 3);
  assert.ok(out.filter((o) => !o.ok).every((o) => o.code === 'CAPACITY'));
  assert.equal(await cs.inner.count(), 3);
});

test('race: concurrent creates with random store latency still respect maxSessions', async () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 20; i++) {
    const cs = controlledStore({ yields: () => Math.floor(rnd() * 4) });
    const svc = new SessionService({ store: cs.store, limits: { maxSessions: 5 } });
    await Promise.all(Array.from({ length: 30 }, () => settle(svc.create({ taskId: 'washer-fluid' }))));
    assert.equal(await cs.inner.count(), 5, `iter ${i}`);
  }
});
