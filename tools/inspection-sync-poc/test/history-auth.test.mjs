// Contract tests of the history authority adapter against a synthetic TLS authority. No database.
// PASS here proves fail-closed composition only, never a real issuer or vehicle ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { HttpsHistoryAuthority, httpsHistoryAuthorizer } from '../src/https-history-authority.mjs';
import {
  VerifiedHistoryReadAuthorizer,
  DenyHistoryAuthorizer,
  HISTORY_READ_SCOPE,
  assertHistoryAuthorizerDeployable,
} from '../src/history-authorizer.mjs';
import { CREATE_SCOPE } from '../src/verified-creation-authorizer.mjs';
import { startSyncServer } from '../src/server.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { tlsFetch } from './https-helpers.mjs';
import { historyAuthorityFixture, FAULT_MODES } from './history-authority-fixture.mjs';

async function setup(t, options) {
  const f = await historyAuthorityFixture(options);
  t.after(() => f.stop());
  const read = httpsHistoryAuthorizer(f.history);
  const owner = f.register({ userId: 'user-A', vehicleId: 'vehicle-A' });
  return { f, read, owner, resolve: (token, secure = true) => read.resolve({ token, secure }) };
}

test('adapter uses only fixed /history routes, its service credential, TLS and returns the current owner', async (t) => {
  const { f, owner, resolve } = await setup(t);
  const token = f.issue(owner);
  const authority = await resolve(token);
  assert.deepEqual(
    { ...authority, bindingVerifiedAt: 0 },
    {
      authorityNamespace: 'VERIFIED_VEHICLE',
      authorityIssuer: f.issuer,
      userId: 'user-A',
      vehicleId: 'vehicle-A',
      deviceId: owner.deviceId,
      registrationId: owner.registrationId,
      bindingVerifiedAt: 0,
    },
  );
  assert.ok(Object.isFrozen(authority));
  assert.deepEqual(
    f.state.requests.map((r) => r.url),
    ['/history/verify', '/history/registration', '/history/active'],
  );
  for (const r of f.state.requests) assert.notEqual(r.authorization, 'Bearer ' + token);
  assert.equal(JSON.parse(f.state.requests[0].body).token, token);
  for (const r of f.state.requests.slice(1)) assert.equal(r.body.includes(token), false);
  const hits = f.state.hits;
  assert.equal(await resolve(token, false), null, 'no TLS: bearer is never forwarded');
  assert.equal(f.state.hits, hits);
  const redacted = new HttpsHistoryAuthority(f.history);
  assert.equal(String(redacted), 'HttpsHistoryAuthority(REDACTED)');
  assert.equal(redacted.testOnly, true);
  assert.equal(httpsHistoryAuthorizer(f.history).testOnly, true);
});

test('credential issuance/verification defects each deny', async (t) => {
  const { f, owner, resolve } = await setup(t);
  const at = Date.now();
  const cases = {
    'unknown credential': 'u'.repeat(43),
    'creation scope': f.issueCreate(owner),
    'extra scope': f.issue(owner, { scope: [HISTORY_READ_SCOPE, 'admin'] }),
    'empty scope': f.issue(owner, { scope: [] }),
    'string scope': f.issue(owner, { scope: HISTORY_READ_SCOPE }),
    'combined scope': f.issue(owner, { scope: [HISTORY_READ_SCOPE, CREATE_SCOPE] }),
    'inactive claim': f.issue(owner, { patch: { active: false } }),
    'truthy active': f.issue(owner, { patch: { active: 'true' } }),
    'wrong audience': f.issue(owner, { patch: { audience: 'other' } }),
    'wrong issuer': f.issue(owner, { patch: { issuer: 'https://evil.invalid/' } }),
    'AVD simulator issuer': f.issue(owner, { patch: { issuer: 'carscope:avd-simulator' } }),
    'expired claim': f.issue(owner, { patch: { expiresAt: at - 1 } }),
    'TTL over five minutes': f.issue(owner, { ttlMs: 300_001 }),
    'not yet valid': f.issue(owner, { patch: { notBefore: at + 60_000 } }),
    'issued after notBefore': f.issue(owner, { patch: { issuedAt: at, notBefore: at - 1 } }),
    'string time': f.issue(owner, { patch: { expiresAt: String(at + 60_000) } }),
    'extra claim field': f.issue(owner, { patch: { vehicleId: 'vehicle-B' } }),
    'other registration': f.issue(owner, { patch: { registrationId: 'registration-unknown' } }),
    'other subject': f.issue(owner, { patch: { subject: 'subject-user-B' } }),
  };
  for (const [name, token] of Object.entries(cases)) assert.equal(await resolve(token), null, name);
  // Missing field is a distinct verifier response shape.
  const token = f.issue(owner);
  const { credentialId: _omitted, ...missing } = f.claim(token);
  f.tokens.set(token, missing);
  assert.equal(await resolve(token), null, 'missing claim field');
  // Malformed input never reaches the authority.
  const hits = f.state.hits;
  for (const bad of [null, undefined, 42, '', 'short', 'a.b.c'.repeat(10), 'x'.repeat(129), 'ü'.repeat(43)])
    assert.equal(await resolve(bad), null);
  assert.equal(f.state.hits, hits);
});

test('registration and vehicle ownership defects each deny, including a later ownership change', async (t) => {
  const { f, owner, resolve } = await setup(t);
  const token = f.issue(owner),
    original = { ...owner };
  assert.ok(await resolve(token));
  const patches = {
    'ownership not verified': { ownershipVerified: false },
    'truthy ownership': { ownershipVerified: 'true' },
    'registration inactive': { active: false },
    'registration expired': { expiresAt: Date.now() - 1 },
    'string expiry': { expiresAt: String(Date.now() + 1000) },
    'null vehicle': { vehicleId: null },
    'numeric user': { userId: 1 },
    'invalid opaque id': { vehicleId: 'KMH 123/456' },
  };
  for (const [name, patch] of Object.entries(patches)) {
    Object.assign(owner, patch);
    assert.equal(await resolve(token), null, name);
    Object.assign(owner, original);
  }
  assert.ok(await resolve(token), 'restored without a cached denial');
  for (const [name, body] of Object.entries({
    'other issuer': { ...owner, issuer: 'https://evil.invalid/' },
    'other subject': { ...owner, subject: 'subject-user-B' },
    'other registration': { ...owner, registrationId: 'registration-B' },
    'extra field': { ...owner, vin: 'forbidden' },
    'null binding': null,
  })) {
    f.state.overrideFor = { registration: body };
    assert.equal(await resolve(token), null, name);
  }
  f.reset();
  const { ownershipVerified: _omitted, ...missing } = owner;
  f.state.overrideFor = { registration: missing };
  assert.equal(await resolve(token), null, 'missing ownershipVerified');
  f.reset();
  // A transfer to another vehicle changes the principal: it never keeps the former scope.
  owner.vehicleId = 'vehicle-T';
  assert.equal((await resolve(token)).vehicleId, 'vehicle-T');
});

test('revocation, expiry and credential reuse deny from the next check, with no positive cache', async (t) => {
  let now = Date.now();
  const clock = () => now;
  const { f, owner, resolve } = await setup(t, { now: clock });
  // Same token twice is deliberate: one read checks before and after the database, so verify cannot consume it.
  const reusable = f.issue(owner);
  assert.ok(await resolve(reusable));
  assert.ok(await resolve(reusable));

  const revoked = f.issue(owner);
  assert.ok(await resolve(revoked));
  f.revokeCredential(revoked);
  for (let i = 0; i < 3; i++) assert.equal(await resolve(revoked), null, 'revoked credential reuse');
  assert.ok(await resolve(f.issue(owner)), 'revoking one credential leaves a fresh one valid');

  const fresh = f.issue(owner);
  const expiring = f.issue(owner, { ttlMs: 1000 });
  assert.ok(await resolve(expiring));
  now += 1000;
  assert.equal(await resolve(expiring), null, 'expiry boundary is exclusive');
  assert.ok(await resolve(fresh));

  for (const body of [{ active: false }, { active: 'true' }, { active: 1 }, { active: true, extra: 1 }, {}, null]) {
    f.state.overrideFor = { active: body };
    assert.equal(await resolve(fresh), null, JSON.stringify(body));
  }
  f.reset();

  const other = f.register({ userId: 'user-A', vehicleId: 'vehicle-A' });
  const sibling = f.issue(other);
  f.revokeRegistration(owner);
  assert.equal(await resolve(fresh), null, 'registration revocation covers its credentials');
  assert.ok(await resolve(sibling), 'other registration of the same owner is independent');
});

test('expiry during a slow authority lookup is rechecked after the last call', async (t) => {
  let now = Date.now();
  const f = await historyAuthorityFixture({ now: () => now });
  t.after(() => f.stop());
  const owner = f.register({ userId: 'user-A', vehicleId: 'vehicle-A' }),
    token = f.issue(owner, { ttlMs: 1000 });
  const authority = new HttpsHistoryAuthority(f.history);
  const read = new VerifiedHistoryReadAuthorizer({
    issuer: f.issuer,
    audience: f.audience,
    now: () => now,
    credentialVerifier: authority,
    registrationProvider: authority,
    revocations: {
      testOnly: true,
      async isActive(request) {
        const active = await authority.isActive(request);
        now += 1000;
        return active;
      },
    },
  });
  assert.equal(await read.resolve({ token, secure: true }), null);
});

test('every authority fault on every endpoint denies, and recovery reflects current state', async (t) => {
  const { f, owner, read, resolve } = await setup(t);
  const token = f.issue(owner);
  const slow = httpsHistoryAuthorizer({ ...f.history, timeoutMs: 50 });
  f.state.delayMs = 150;
  for (const endpoint of ['verify', 'registration', 'active'])
    for (const mode of FAULT_MODES) {
      f.state.modeFor = { [endpoint]: mode };
      assert.equal(await (mode === 'delay' ? slow : read).resolve({ token, secure: true }), null, `${endpoint}/${mode}`);
    }
  f.reset();
  assert.ok(await resolve(token), 'no failure cache');
  f.state.mode = 'outage';
  assert.equal(await resolve(token), null, 'no success cache across an outage');
  f.reset();
  f.revokeCredential(token);
  assert.equal(await resolve(token), null, 'revocation during an outage is seen on recovery');
});

test('missing, failing or wrong service credentials and untrusted TLS deny before trusting anything', async (t) => {
  const { f, owner } = await setup(t);
  const token = f.issue(owner),
    hits = f.state.hits;
  for (const credentials of [
    undefined,
    { credential: () => null },
    { credential: () => 'short' },
    {
      credential() {
        throw Error('secret provider down');
      },
    },
  ])
    assert.equal(await httpsHistoryAuthorizer({ ...f.history, credentials }).resolve({ token, secure: true }), null);
  assert.equal(f.state.hits, hits, 'no authority call without a service credential');
  assert.equal(
    await httpsHistoryAuthorizer({ ...f.history, credentials: f.creation.credentials }).resolve({ token, secure: true }),
    null,
    'creation service credential is not valid for history routes',
  );
  assert.equal(await httpsHistoryAuthorizer({ ...f.history, ca: undefined }).resolve({ token, secure: true }), null);
  for (const origin of ['http://localhost', 'https://u:p@localhost', 'https://localhost/path'])
    assert.throws(() => httpsHistoryAuthorizer({ ...f.history, origin }));
  for (const issuer of ['http://issuer.invalid', 'carscope:avd-simulator', undefined])
    assert.throws(() => httpsHistoryAuthorizer({ ...f.history, issuer }), /INVALID_HISTORY_AUTH_POLICY/);
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    assert.throws(() => httpsHistoryAuthorizer(f.history), /INVALID_AUTHORITY_POLICY/);
  } finally {
    if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
  }
});

test('authorizer dependencies are private and cannot be swapped after construction', async (t) => {
  const { f, owner, read } = await setup(t);
  assert.equal(JSON.stringify(read).includes('credential'), false);
  assert.equal(read.check, undefined);
  assert.equal(read.validClaim, undefined);
  read.credentialVerifier = { verify: async () => f.claim(f.issue(owner)) };
  assert.equal(await read.resolve({ token: 'u'.repeat(43), secure: true }), null);
});

test('concurrent lookups keep identities separate and revocation mid-burst denies every later check', async (t) => {
  const { f, owner } = await setup(t);
  // Generous deadlines: this asserts isolation, so a slow runner must not turn into a false denial.
  const read = httpsHistoryAuthorizer({ ...f.history, timeoutMs: 5000, authorityTimeoutMs: 5000 });
  const other = f.register({ userId: 'user-B', vehicleId: 'vehicle-B' });
  const [a, b] = [f.issue(owner), f.issue(other)];
  f.state.mode = 'delay';
  f.state.delayMs = 5;
  const burst = await Promise.all(
    Array.from({ length: 40 }, (_, i) => read.resolve({ token: i % 2 ? b : a, secure: true })),
  );
  burst.forEach((authority, i) => {
    assert.equal(authority.userId, i % 2 ? 'user-B' : 'user-A');
    assert.equal(authority.vehicleId, i % 2 ? 'vehicle-B' : 'vehicle-A');
  });
  f.reset();
  const inFlight = Array.from({ length: 20 }, () => read.resolve({ token: a, secure: true }));
  f.revokeCredential(a);
  await Promise.all(inFlight);
  const after = await Promise.all(Array.from({ length: 20 }, () => read.resolve({ token: a, secure: true })));
  assert.ok(after.every((x) => x === null));
  assert.equal((await read.resolve({ token: b, secure: true })).userId, 'user-B');
});

test('test credentials and reserved issuers are refused outside a loopback, non-managed process', async (t) => {
  const { f, read } = await setup(t);
  const allow = (authorizer, options) => assert.doesNotThrow(() => assertHistoryAuthorizerDeployable(authorizer, options));
  const deny = (authorizer, options) =>
    assert.throws(() => assertHistoryAuthorizerDeployable(authorizer, options), /TEST_HISTORY_AUTHORIZER_FORBIDDEN/);
  allow(read, { host: '127.0.0.1', env: {} });
  deny(read, { host: '0.0.0.0', env: {} });
  deny(read, { host: '127.0.0.1', env: { RENDER: 'true' } });
  deny(read, { host: '127.0.0.1', env: { NODE_ENV: 'production' } });
  // Without the marker a reserved issuer still fails: the marker alone is not the only guard.
  for (const issuer of [
    f.issuer,
    'https://issuer.test/',
    'https://issuer.example/',
    'https://example.com/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
  ]) {
    const unmarked = new VerifiedHistoryReadAuthorizer({ issuer, audience: 'a' });
    assert.equal(unmarked.testOnly, false);
    deny(unmarked, { host: '0.0.0.0', env: {} });
    deny(unmarked, { host: '127.0.0.1', env: { RENDER: 'true' } });
  }
  // Passing this guard says nothing about trust; a non-reserved issuer still needs the operator's review.
  allow(new VerifiedHistoryReadAuthorizer({ issuer: 'https://auth.approved-operator.net/', audience: 'a' }), {
    host: '0.0.0.0',
    env: { RENDER: 'true' },
  });
  allow(new DenyHistoryAuthorizer(), { host: '0.0.0.0', env: { RENDER: 'true' } });

  await assert.rejects(
    startSyncServer({ host: '0.0.0.0', tlsCert: f.pki.tlsCert, tlsKey: f.pki.tlsKey, historyAuthorizer: read, log: () => {} }),
    /require a loopback bind/,
  );
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(startSyncServer({ port: 0, historyAuthorizer: read, log: () => {} }), /TEST_HISTORY_AUTHORIZER_FORBIDDEN/);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test('Render seam refuses injected objects, AVD mode and test authority before touching the database', async (t) => {
  const { f, read } = await setup(t);
  const publicOrigin = 'https://history-test.onrender.com';
  const pool = new Proxy(
    {},
    {
      get() {
        throw Error('DATABASE_TOUCHED');
      },
    },
  );
  await assert.rejects(startRenderStateful({ pool, publicOrigin, historyAuthorizer: read }), /AUTHORIZER_OVERRIDE_FORBIDDEN/);
  await assert.rejects(
    startRenderStateful({ pool, publicOrigin, historyAuthority: f.history, enableAvdSimulation: true }),
    /HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN/,
  );
  await assert.rejects(
    startRenderStateful({ pool, publicOrigin, historyAuthority: f.history, host: '0.0.0.0' }),
    /TEST_HISTORY_AUTHORIZER_FORBIDDEN/,
  );
});

test('runtime entrypoints never load fixtures and CLIs never install a history authority', () => {
  const src = new URL('../src/', import.meta.url);
  for (const name of readdirSync(src).filter((x) => x.endsWith('.mjs'))) {
    const source = readFileSync(new URL(name, src), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*\/test\//, name);
    const cli = source.indexOf('process.argv[1]');
    if (cli >= 0) assert.doesNotMatch(source.slice(cli), /historyAuthori(ty|zer)/, name + ' CLI');
    assert.doesNotMatch(source, /process\.env\.[A-Z_]*(ISSUER|HISTORY|AUTHORITY)/, name);
  }
});

test('HTTP route denies on every authentication failure, ignores spoofed identity and logs no credential', async (t) => {
  const { f, owner, read } = await setup(t);
  const fetchTls = tlsFetch(f.pki.ca);
  const logs = [],
    log = (line) => logs.push(line);
  const scoped = [];
  // Unit-level store double: the database-backed path is covered by history-auth-postgres.test.mjs.
  const store = Object.assign(new MemorySessionStore(), {
    async historyList(query) {
      scoped.push(query.owner);
      return [];
    },
    async historyGet(authority) {
      scoped.push(authority);
      return null;
    },
  });
  const server = await startSyncServer({
    port: 0,
    store,
    historyAuthorizer: read,
    tlsCert: f.pki.tlsCert,
    tlsKey: f.pki.tlsKey,
    log,
  });
  t.after(() => server.stop());
  const call = async (token, path = '/v1/inspection-records', headers = {}) => {
    const r = await fetchTls(server.url + path, {
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    });
    return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
  };
  const token = f.issue(owner);
  const ok = await call(token);
  assert.equal(ok.status, 200);
  assert.match(ok.cache, /no-store/);

  const denied = await call(null);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: { code: 'FORBIDDEN' } });
  assert.equal((await call('x'.repeat(43))).status, 403, 'unknown credential, e.g. a QR receiver token');
  assert.equal((await call(f.issueCreate(owner))).status, 403);
  f.state.mode = 'outage';
  const outage = await call(token);
  assert.equal(outage.status, 403, 'authority outage is DENY_DEFAULT, not an empty list');
  assert.deepEqual(outage.body, { error: { code: 'FORBIDDEN' } });
  f.reset();

  scoped.length = 0;
  const spoofed = await call(token, '/v1/inspection-records', {
    'X-User-Id': 'user-B',
    'X-Vehicle-Id': 'vehicle-B',
    'X-Forwarded-User': 'user-B',
    'X-Forwarded-Proto': 'https',
  });
  assert.equal(spoofed.status, 200);
  assert.equal(scoped[0].userId, 'user-A', 'scope comes from the authority, never from headers');
  assert.equal(scoped[0].vehicleId, 'vehicle-A');
  for (const q of ['userId=user-B', 'vehicleId=vehicle-B', 'registrationId=x'])
    assert.equal((await call(token, '/v1/inspection-records?' + q)).status, 400);
  assert.equal((await call(token, '/v1/inspection-records/' + randomUUID())).status, 404);
  assert.equal(logs.join('\n').includes(token), false);
  assert.equal(logs.join('\n').includes('user-A'), false);
});
