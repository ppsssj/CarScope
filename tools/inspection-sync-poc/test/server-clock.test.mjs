// P7-C3: `serverNow` in the authenticated creation response. Real PostgreSQL is in postgres-store.test.mjs and the
// real Kotlin decoder is in HttpsSyncReceiverTransportTest; neither is claimed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_LIMITS, SessionService, SyncError } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { SQLiteSessionStore } from '../src/sqlite-store.mjs';
import { DEFAULT_RATES } from '../src/rate-limit.mjs';
import { startSyncServer } from '../src/server.mjs';
import { startHttpsMobileService } from '../src/https-mobile-service.mjs';
import { FakeSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { PROTOCOL, PROTOCOL_VERSION, SUPPORTED_TASKS } from '../src/protocol.mjs';
import { completeInspection, startInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { authFixture } from './auth-fixture.mjs';
import { tempFixture } from './temp-fixture.mjs';
import { localPki, tlsFetch } from './https-helpers.mjs';

const T0 = 2_000_000_000_000; // 2033: far from the host clock, so a Date.now or HTTP Date leak cannot pass by accident
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const KEYS = ['expiresAt', 'inviteExpiresAt', 'inviteToken', 'receiverToken', 'serverNow', 'sessionId', 'taskId'];
const INTERNAL = (e) => e instanceof SyncError && e.code === 'INTERNAL' && e.status === 500;
const RESPONSE_ONLY_CLOCK = /serverNow/;

function storeOf(kind, t) {
  if (kind === 'memory') return new MemorySessionStore();
  const owned = tempFixture(), store = new SQLiteSessionStore({ filename: path.join(owned.dir, 'clock.sqlite') });
  t.after(() => { store.close(); owned.cleanup(); });
  return store;
}
/** Service whose clock moves to `afterInsert` while the row is written, so the read order is observable. */
function serviceWith(store, { start = T0, afterInsert, limits } = {}) {
  let at = start;
  if (afterInsert !== undefined) {
    const insert = store.insert.bind(store);
    store.insert = async (...args) => { const inserted = await insert(...args); at = afterInsert; return inserted; };
  }
  return new SessionService({ store, now: () => at, limits });
}

for (const kind of ['memory', 'sqlite']) {
  test(`${kind}: serverNow is read from the service clock after the insert and shares a domain with proof times`, async (t) => {
    const store = storeOf(kind, t);
    let at = T0;
    const insert = store.insert.bind(store);
    store.insert = async (...args) => { const inserted = await insert(...args); at = T0 + 7; return inserted; };
    const service = new SessionService({ store, now: () => at });
    const created = await service.create({ taskId: 'washer-fluid' });
    assert.deepEqual(Object.keys(created).sort(), KEYS);
    assert.equal(created.serverNow, T0 + 7, 'response time, not the stored createdAt');
    assert.equal(created.inviteExpiresAt, T0 + DEFAULT_LIMITS.inviteTtlMs, 'TTLs still start at createdAt');
    assert.equal(created.expiresAt, T0 + DEFAULT_LIMITS.sessionTtlMs);
    const row = await store.get(created.sessionId);
    assert.equal(row.createdAt, T0);
    assert.ok(!JSON.stringify(row).match(RESPONSE_ONLY_CLOCK), 'serverNow is a response field, never persisted');

    const claim = await service.claim(created.inviteToken);
    at += 5_000;
    const result = completeInspection(startInspection(), 'OK');
    const { receipt } = await service.submit(claim.submitToken, { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });
    at += 1_000;
    const accepted = await service.accept(created.sessionId, created.receiverToken, receipt.resultDigest);
    assert.equal(accepted.receivedAt, created.serverNow + 5_000);
    assert.equal(accepted.acceptedAt, created.serverNow + 6_000);
    assert.ok(created.serverNow <= accepted.receivedAt && accepted.receivedAt <= accepted.acceptedAt && accepted.acceptedAt <= accepted.expiresAt);
  });
}

test('boundaries: 0 <= serverNow < inviteExpiresAt <= expiresAt holds at its edges', async () => {
  const invite = T0 + DEFAULT_LIMITS.inviteTtlMs;
  assert.equal((await serviceWith(new MemorySessionStore()).create({ taskId: 'washer-fluid' })).serverNow, T0, 'same millisecond as createdAt');
  assert.equal((await serviceWith(new MemorySessionStore(), { afterInsert: invite - 1 }).create({ taskId: 'washer-fluid' })).serverNow, invite - 1);
  assert.equal((await serviceWith(new MemorySessionStore(), { start: 0 }).create({ taskId: 'washer-fluid' })).serverNow, 0);
  const equal = await serviceWith(new MemorySessionStore(), { limits: { inviteTtlMs: 1000, sessionTtlMs: 1000 } }).create({ taskId: 'washer-fluid' });
  assert.equal(equal.inviteExpiresAt, equal.expiresAt);
  const top = MAX_EPOCH_MS - DEFAULT_LIMITS.sessionTtlMs;
  assert.equal((await serviceWith(new MemorySessionStore(), { start: top }).create({ taskId: 'washer-fluid' })).serverNow, top);
});

test('a regressed, expired or non-integer clock after the insert fails without returning tokens', async () => {
  const invite = T0 + DEFAULT_LIMITS.inviteTtlMs;
  for (const afterInsert of [T0 - 1, invite, invite + 1, T0 + 0.5, NaN, Infinity, -1, null, String(T0), MAX_EPOCH_MS + 1]) {
    const store = new MemorySessionStore();
    await assert.rejects(serviceWith(store, { afterInsert }).create({ taskId: 'washer-fluid' }), INTERNAL, `clock ${afterInsert}`);
    const rows = await store.all();
    assert.equal(rows.length, 1, 'the row is left to expire; nothing rewrites it');
    assert.equal(rows[0].createdAt, T0);
    assert.equal(rows[0].state, 'CREATED');
  }
});

test('an unusable clock or inverted TTLs fail before anything is stored or any token is minted', async () => {
  const refused = async (options) => {
    const store = new MemorySessionStore();
    let minted = 0;
    const service = new SessionService({ store, token: () => { minted++; return 'x'; }, ...options });
    await assert.rejects(service.create({ taskId: 'washer-fluid' }), INTERNAL);
    assert.equal((await store.all()).length, 0);
    assert.equal(minted, 0);
  };
  for (const start of [NaN, Infinity, -1, 0.5, null, undefined, String(T0), MAX_EPOCH_MS, MAX_EPOCH_MS - 1000]) await refused({ now: () => start });
  for (const limits of [{ inviteTtlMs: 2000, sessionTtlMs: 1000 }, { inviteTtlMs: 0 }, { inviteTtlMs: -1 }, { inviteTtlMs: 0.5 }, { sessionTtlMs: 0.5 }, { sessionTtlMs: NaN }])
    await refused({ now: () => T0, limits });
  // Input validation still answers first, so a bad clock does not change what a bad request sees.
  await assert.rejects(new SessionService({ store: new MemorySessionStore(), now: () => NaN }).create({ taskId: 'coolant' }), (e) => e.code === 'BAD_REQUEST');
});

test('real TLS: all 17 tasks carry an integer serverNow; denied callers and every other route learn no clock', async (t) => {
  const pki = localPki(), fetch = tlsFetch(pki.ca), logs = [], store = new MemorySessionStore();
  t.after(() => pki.cleanup());
  let at = T0;
  const credential = randomBytes(32).toString('base64url');
  const authorizer = new FakeSessionCreationAuthorizer({ token: credential, expiresAt: T0 + 60_000, now: () => T0 });
  // Only the creation budget is widened so one window can cover all 17 tasks; the limiter itself is tested in server.test.mjs.
  const rates = { ...DEFAULT_RATES, create: { limit: 40, windowMs: 60_000 } };
  const s = await startSyncServer({ port: 0, ...pki, store, rates, authorizer, now: () => at, log: (line) => logs.push(line) });
  t.after(() => s.stop());
  const call = async (method, route, token, body) => {
    const r = await fetch(s.url + route, { method, redirect: 'error', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };

  for (const denied of [null, randomBytes(32).toString('base64url')]) {
    const r = await call('POST', '/v1/sessions', denied, { taskId: 'washer-fluid' });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.text), { error: { code: 'FORBIDDEN' } });
  }
  assert.equal((await store.all()).length, 0, 'authorization still precedes creation');

  assert.equal(SUPPORTED_TASKS.length, 17);
  const secrets = [credential];
  let first;
  for (const taskId of SUPPORTED_TASKS) {
    at += 1;
    const r = await call('POST', '/v1/sessions', credential, { taskId, serverNow: 5, now: 5 }); // client values are ignored
    assert.equal(r.status, 201, taskId);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.text, new RegExp(`"serverNow":${at}[,}]`), 'plain JSON integer: no fraction, exponent or string');
    const body = JSON.parse(r.text);
    assert.deepEqual(Object.keys(body).sort(), KEYS);
    assert.equal(body.taskId, taskId);
    assert.equal(body.serverNow, at);
    assert.ok(0 <= body.serverNow && body.serverNow < body.inviteExpiresAt && body.inviteExpiresAt <= body.expiresAt);
    assert.ok(Math.abs(Date.parse(r.headers.get('date')) - body.serverNow) > 86_400_000, 'independent of the HTTP Date header');
    secrets.push(body.receiverToken, body.inviteToken);
    first ??= body;
  }

  const viewPath = `/v1/sessions/${first.sessionId}`;
  const claim = await call('POST', '/v1/claim', first.inviteToken);
  const submit = JSON.parse(claim.text).submitToken; secrets.push(submit);
  const others = [
    claim,
    await call('GET', viewPath, first.receiverToken),
    await call('GET', '/v1/submissions/status', submit),
    await call('GET', viewPath, randomBytes(32).toString('base64url')),
    await call('POST', `${viewPath}/cancel`, first.receiverToken),
  ];
  for (const r of others) assert.doesNotMatch(r.text, RESPONSE_ONLY_CLOCK);

  at = NaN;
  const broken = await call('POST', '/v1/sessions', credential, { taskId: 'washer-fluid' });
  at = T0;
  assert.equal(broken.status, 500);
  assert.deepEqual(JSON.parse(broken.text), { error: { code: 'INTERNAL' } });
  for (const secret of secrets) assert.ok(!logs.join('\n').includes(secret), 'no token in logs');
});

test('HTTPS mobile service on SQLite: verified credential required, serverNow survives the real service composition', async (t) => {
  const owned = tempFixture(), pki = localPki();
  let at = T0;
  const auth = authFixture({ now: () => at }), fetch = tlsFetch(pki.ca);
  const service = await startHttpsMobileService({ databasePath: path.join(owned.dir, 'sync.sqlite'), ...pki, authorizer: auth.authorizer, now: () => at, log: () => {}, port: 0 });
  t.after(async () => { try { await service.stop(); } finally { pki.cleanup(); owned.cleanup(); } });
  const create = (token) => fetch(`${service.url}/v1/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{"taskId":"tire.front-left"}' });

  const wrong = await create(randomBytes(32).toString('base64url'));
  assert.equal(wrong.status, 403);
  assert.doesNotMatch(await wrong.text(), RESPONSE_ONLY_CLOCK);

  at += 250;
  const ok = await create(auth.token);
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.deepEqual(Object.keys(body).sort(), KEYS);
  assert.equal(body.serverNow, T0 + 250);
  assert.equal(body.inviteExpiresAt, body.serverNow + DEFAULT_LIMITS.inviteTtlMs);

  auth.state.active = false; // revocation still wins over the clock path
  const revoked = await create(auth.token);
  assert.equal(revoked.status, 403);
  assert.doesNotMatch(await revoked.text(), RESPONSE_ONLY_CLOCK);
});
