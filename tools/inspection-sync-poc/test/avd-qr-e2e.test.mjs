// P22: AVD enrollment → grant → session → QR → phone claim → submit → vehicle receipt, end to end over real HTTP.
// The real AvdSimulatorCredentialStore and /simulator/provision route run on an in-memory pool that executes the
// store's own SQL (or on PostgreSQL when PG_TEST_URL is set). The "AVD" is a stand-in adb, the phone the real
// SyncClient. No Render, Roboflow or OpenAI call is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { AvdSimulatorCredentialStore } from '../src/avd-simulator-credentials.mjs';
import { serveAvdSimulatorProvision } from '../src/avd-simulator-http.mjs';
import { createSyncHandler } from '../src/server.mjs';
import { SessionService } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { RateLimiter, DEFAULT_RATES } from '../src/rate-limit.mjs';
import { SyncClient } from '../public/sync-client.mjs';
import { diagnose, STATUS } from '../bin/vision-qr-diagnose.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const norm = (q) => (typeof q === 'string' ? q : q.text).replace(/\s+/g, ' ').trim();

/** An in-memory stand-in for pg that runs exactly the statements the credential store and the diagnosis issue. */
export function memoryPool({ schema = 'carscope_vision', now = Date.now } = {}) {
  const regs = new Map(), grants = new Map(), log = [];
  const run = async (q, values = q.values ?? []) => {
    const sql = norm(q); log.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith('INSERT INTO cs_avd_registrations')) { const [id, label, hash, created, expires] = values; regs.set(id, { id, label, enrollment_hash: hash, created_at: created, expires_at: expires, revoked_at: null }); return { rows: [] }; }
    if (sql.startsWith('SELECT id,expires_at,revoked_at FROM cs_avd_registrations WHERE enrollment_hash=$1')) return { rows: [...regs.values()].filter((r) => r.enrollment_hash === values[0]) };
    if (sql.startsWith('INSERT INTO cs_avd_creation_grants')) { const [id, reg, hash, issued, expires] = values; grants.set(id, { id, registration_id: reg, token_hash: hash, issued_at: issued, expires_at: expires, revoked_at: null }); return { rows: [] }; }
    if (sql.startsWith('SELECT 1 AS permitted')) {
      const [hash, at] = values;
      const ok = [...grants.values()].some((g) => g.token_hash === hash && g.revoked_at == null && g.issued_at <= at && g.expires_at > at &&
        regs.get(g.registration_id)?.revoked_at == null && regs.get(g.registration_id)?.expires_at > at);
      return { rows: ok ? [{ permitted: 1 }] : [] };
    }
    if (sql.startsWith('SELECT r.id FROM cs_avd_creation_grants g JOIN cs_avd_registrations r')) {
      const [hash, at] = values;
      const g = [...grants.values()].find((x) => x.token_hash === hash && x.revoked_at == null && x.issued_at <= at && x.expires_at > at);
      const reg = g && regs.get(g.registration_id);
      return { rows: reg && reg.revoked_at == null && reg.expires_at > at ? [{ id: reg.id }] : [] };
    }
    if (sql.startsWith('UPDATE cs_avd_registrations SET revoked_at')) { const r = regs.get(values[0]); if (r) r.revoked_at ??= values[1]; return { rows: r ? [{ id: r.id }] : [] }; }
    if (sql.startsWith('UPDATE cs_avd_creation_grants SET revoked_at')) { for (const g of grants.values()) if (g.registration_id === values[0]) g.revoked_at ??= values[1]; return { rows: [] }; }
    if (sql.startsWith('SELECT current_user AS role')) return { rows: [{ role: 'carscope_vision_app', name: schema, at: String(now()), regs: true, grants: true }] };
    if (sql.startsWith('SELECT has_table_privilege')) return { rows: [{ r: true, gi: true, gs: true }] };
    if (sql.startsWith('SELECT expires_at, revoked_at, enrollment_hash FROM cs_avd_registrations WHERE id=$1')) return { rows: regs.has(values[0]) ? [regs.get(values[0])] : [] };
    if (sql.startsWith('SELECT id FROM cs_avd_registrations WHERE enrollment_hash=$1')) return { rows: [...regs.values()].filter((r) => r.enrollment_hash === values[0]).map((r) => ({ id: r.id })) };
    throw new Error('UNEXPECTED_SQL ' + sql.slice(0, 60));
  };
  const client = { query: run, on() {}, removeListener() {}, release() {} };
  return { regs, grants, log, query: run, connect: async () => client, end: async () => {} };
}

/** The Vision entry's routing, on loopback: /healthz, /simulator/provision, /v1/*. */
async function startVisionLike({ store, slowProvisionMs = 0, failProvision = false }) {
  let origin;
  const service = new SessionService({ store: new MemorySessionStore() });
  const limiter = new RateLimiter({ rates: { ...DEFAULT_RATES, 'avd-provision': { limit: 4, windowMs: 60_000 } } });
  const api = createSyncHandler({ service, limiter, authorizer: store, trustedEdgeSecure: () => true });
  const credentialStore = failProvision ? { provision: async () => { throw new Error('db down'); } }
    : slowProvisionMs ? { provision: async (x) => { await new Promise((r) => setTimeout(r, slowProvisionMs)); return store.provision(x); } } : store;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json', Date: new Date().toUTCString() }); res.end(JSON.stringify({ status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY', vision: 'EXPERIMENT' })); return; }
    if (req.url === '/simulator/provision') { await serveAvdSimulatorProvision(req, res, { credentialStore, limiter, publicOrigin: origin }); return; }
    if (req.url.startsWith('/v1/')) { await api(req, res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, stop: () => new Promise((r) => server.close(r)) };
}

/** A stand-in AVD: adb answers from a small private-file map. */
function fakeAvd({ origin, enrollment, user = '10', connected = true, clockSkewMs = 0 }) {
  const files = new Map([['sync-endpoint.json', JSON.stringify({ apiOrigin: origin, mobileRoot: origin + '/' })]]);
  if (enrollment) files.set('avd-vision-enrollment.json', JSON.stringify(enrollment));
  const adb = async (args) => {
    const cmd = args.slice(2).join(' ');
    if (args[2] === 'get-state') return { code: connected ? 0 : 1, stdout: connected ? 'device' : '' };
    if (cmd.includes('getprop sys.boot_completed')) return { code: 0, stdout: '1' };
    if (cmd.includes('am get-current-user')) return { code: 0, stdout: user };
    if (cmd.includes('pm path')) return { code: 0, stdout: 'package:/data/app/x/base.apk' };
    if (cmd.endsWith(' true')) return { code: 0, stdout: '' };
    if (cmd.includes('date +%s')) return { code: 0, stdout: String(Math.floor((Date.now() + clockSkewMs) / 1000)) };
    const stat = /stat -c %a:%s files\/([\w.-]+)/.exec(cmd);
    if (stat) return { code: 0, stdout: files.has(stat[1]) ? `600:${Buffer.byteLength(files.get(stat[1]))}` : 'missing' };
    const cat = /cat files\/([\w.-]+)$/.exec(cmd);
    if (cat) return files.has(cat[1]) ? { code: 0, stdout: files.get(cat[1]) } : { code: 1, stdout: '' };
    return { code: 1, stdout: '' };
  };
  return { adb, files };
}
function guardMemory() { const m = new Map(); return { last: async (k) => m.get(k) ?? null, mark: async (k) => m.set(k, Date.now()), m }; }
const enrollmentOf = (issued) => ({ mode: issued.mode, registrationId: issued.registrationId, enrollmentProof: issued.enrollmentProof, expiresAt: issued.expiresAt });
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

async function stack(options = {}) {
  const pool = memoryPool(options);
  const store = new AvdSimulatorCredentialStore({ pool });
  const vision = await startVisionLike({ store, ...options });
  return { pool, store, vision };
}

test('register → diagnose → grant → session → QR → phone claim → submit → vehicle receipt (MOCK, real HTTP)', async () => {
  const { pool, store, vision } = await stack();
  try {
    const issued = await store.register({ label: 'e2e', ttlMs: 2 * 3600_000 });
    const avd = fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued) });
    let provisions = 0;
    const counting = (url, init) => { if (String(url).endsWith('/simulator/provision')) provisions++; return fetch(url, init); };
    const guard = guardMemory();
    const r = await diagnose({ serial: 'emulator-5554', origin: vision.origin, schema: 'carscope_vision', approveProvision: true, approveSession: true, skipApkOrigin: true },
      { adb: avd.adb, fetch: counting, openPool: async () => pool, guard, pullApk: async () => null });
    assert.equal(r.final, 'READY_FOR_QR_E2E', JSON.stringify(r.checks.map((c) => [c.id, c.status, c.cause])));
    assert.equal(provisions, 1, 'exactly one approved provision request');
    assert.equal(byId(r).SESSION_QR.status, STATUS.PASS);
    // Read-only by default: the diagnosis used a READ ONLY transaction and wrote nothing itself.
    assert.ok(pool.log.includes('BEGIN TRANSACTION READ ONLY'));
    const text = JSON.stringify(r);
    assert.ok(!text.includes(issued.enrollmentProof) && !text.includes(sha(issued.enrollmentProof)), 'no proof or hash in the report');

    // The app path: a fresh grant, one session, the QR invite, the phone, the vehicle.
    const grant = await (await fetch(vision.origin + '/simulator/provision', { method: 'POST', headers: { Authorization: 'Bearer ' + issued.enrollmentProof, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiOrigin: vision.origin, audience: 'carscope-avd-simulator' }) })).json();
    const created = await fetch(vision.origin + '/v1/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + grant.credential, 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'washer-fluid' }) });
    assert.equal(created.status, 201);
    const session = await created.json();
    const phone = new SyncClient({ baseUrl: vision.origin, taskId: 'washer-fluid', retries: 0 });
    assert.equal((await phone.claim(session.inviteToken)).ok, true);
    const record = completeInspection(startInspection(), 'NEEDS_REFILL');
    const sent = await phone.send(record);
    assert.equal(sent.transport, 'SENT');
    const view = await (await fetch(`${vision.origin}/v1/sessions/${session.sessionId}`, { headers: { Authorization: 'Bearer ' + session.receiverToken } })).json();
    assert.equal(view.sessionState, 'RESULT_SUBMITTED');
    const accepted = await fetch(`${vision.origin}/v1/sessions/${session.sessionId}/accept`, { method: 'POST', headers: { Authorization: 'Bearer ' + session.receiverToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ resultDigest: view.resultDigest }) });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).sessionState, 'ACCEPTED');
  } finally { await vision.stop(); }
});

test('each 401 cause is named locally while the public answer stays a bare 401', async () => {
  const { pool, store, vision } = await stack();
  try {
    const run = (enrollment, extra = {}) => diagnose({ serial: 's', origin: vision.origin, schema: 'carscope_vision', approveProvision: true, skipApkOrigin: true, ...extra },
      { adb: fakeAvd({ origin: vision.origin, enrollment }).adb, fetch, openPool: async () => pool, guard: guardMemory(), pullApk: async () => null });
    const good = await store.register({ label: 'a', ttlMs: 3600_000 });
    // No registration in this DB: a well-formed proof the server never issued (the 2026-11-14 case: issued into another schema).
    const foreign = { ...enrollmentOf(good), registrationId: randomUUID(), enrollmentProof: 'A'.repeat(43) };
    let r = await run(foreign);
    assert.equal(byId(r).REGISTRATION_EXISTS.cause, 'NO_REGISTRATION');
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'NO_REGISTRATION');
    const raw = await fetch(vision.origin + '/simulator/provision', { method: 'POST', headers: { Authorization: 'Bearer ' + 'A'.repeat(43), 'Content-Type': 'application/json' }, body: JSON.stringify({ apiOrigin: vision.origin, audience: 'carscope-avd-simulator' }) });
    assert.equal(raw.status, 401);
    assert.deepEqual(await raw.json(), { error: { code: 'UNAUTHORIZED' } }, 'no reason leaks over HTTP');
    // Proof mismatch: right registration id, a different proof.
    r = await run({ ...enrollmentOf(good), enrollmentProof: 'B'.repeat(43) });
    assert.equal(byId(r).PROOF_MATCH.cause, 'PROOF_MISMATCH');
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'PROOF_MISMATCH', 'named precisely locally; the server only sees an unknown hash');
    // Revoked.
    const revoked = await store.register({ label: 'b', ttlMs: 3600_000 });
    await store.revoke({ registrationId: revoked.registrationId });
    r = await run(enrollmentOf(revoked));
    assert.equal(byId(r).REGISTRATION_ACTIVE.cause, 'REVOKED');
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'REVOKED');
    // Expired on the server clock while the device file still looks valid.
    const old = await store.register({ label: 'c', ttlMs: 3600_000 });
    pool.regs.get(old.registrationId).expires_at = Date.now() - 1000;
    r = await run(enrollmentOf(old));
    assert.equal(byId(r).REGISTRATION_ACTIVE.cause, 'EXPIRED');
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'EXPIRED');
    // Store mismatch: the checked DB holds a valid registration, the service reads another store.
    const elsewhere = memoryPool();
    const otherStore = new AvdSimulatorCredentialStore({ pool: elsewhere });
    const there = await otherStore.register({ label: 'd', ttlMs: 3600_000 });
    r = await diagnose({ serial: 's', origin: vision.origin, schema: 'carscope_vision', approveProvision: true, skipApkOrigin: true },
      { adb: fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(there) }).adb, fetch, openPool: async () => elsewhere, guard: guardMemory(), pullApk: async () => null });
    assert.equal(byId(r).PROOF_MATCH.status, STATUS.PASS);
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'STORE_MISMATCH');
    // Schema mismatch: the operator connected to the main schema.
    r = await diagnose({ serial: 's', origin: vision.origin, schema: 'carscope', skipApkOrigin: true },
      { adb: fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(good) }).adb, fetch, openPool: async () => pool, guard: guardMemory(), pullApk: async () => null });
    assert.equal(byId(r).REGISTRATION_EXISTS.cause, 'SCHEMA_MISMATCH');
  } finally { await vision.stop(); }
});

test('live failures: 429, 400 origin, 503, slow server, invalid grant; live tests need approval and are guarded', async () => {
  const { pool, store, vision } = await stack();
  try {
    const issued = await store.register({ label: 'e', ttlMs: 3600_000 });
    const avd = fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued) });
    const go = (deps = {}, extra = {}) => diagnose({ serial: 's', origin: vision.origin, schema: 'carscope_vision', approveProvision: true, skipApkOrigin: true, ...extra },
      { adb: avd.adb, fetch, openPool: async () => pool, guard: guardMemory(), pullApk: async () => null, ...deps });
    // Without approval: no provision request at all.
    const seen = [];
    let r = await diagnose({ serial: 's', origin: vision.origin, skipApkOrigin: true }, { adb: avd.adb, fetch: (u, i) => { seen.push(String(u)); return fetch(u, i); }, openPool: async () => pool, guard: guardMemory(), pullApk: async () => null });
    assert.deepEqual(seen.map((u) => new URL(u).pathname), ['/healthz']);
    assert.equal(byId(r).QR_AUTHORIZATION.status, STATUS.NOT_RUN);
    assert.equal(r.final, 'NOT_VERIFIED');
    // Guard: a second live run within a minute does not send.
    const guard = guardMemory();
    await go({ guard }); r = await go({ guard });
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'LIVE_GUARD');
    // 429 after the per-proof budget (4/min): the fifth request.
    for (let i = 0; i < 3; i++) await go();
    r = await go();
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'RATE_LIMITED');
    // 400: the request's origin differs from the service's public origin.
    const stub = (status, body = '{}') => async (u, i) => String(u).endsWith('/healthz') ? fetch(u, i) : new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    assert.equal(byId(await go({ fetch: stub(400) })).QR_AUTHORIZATION.cause, 'REQUEST_ORIGIN_REJECTED');
    assert.equal(byId(await go({ fetch: stub(503) })).QR_AUTHORIZATION.cause, 'SERVER_STARTING');
    assert.equal(byId(await go({ fetch: stub(200, JSON.stringify({ mode: 'X' })) })).QR_AUTHORIZATION.cause, 'GRANT_INVALID');
    const timeout = async (u, i) => { if (String(u).endsWith('/healthz')) return fetch(u, i); throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
    assert.equal(byId(await go({ fetch: timeout })).QR_AUTHORIZATION.cause, 'SERVER_TIMEOUT');
    const tls = async (u) => { throw new TypeError('fetch failed'); };
    assert.equal(byId(await go({ fetch: tls })).VISION_HEALTH.cause, 'NETWORK_TLS');
  } finally { await vision.stop(); }
  // A store that throws answers 503 through the real route; a slow one still answers.
  const broken = await stack({ failProvision: true });
  try {
    const issued = await broken.store.register({ label: 'f', ttlMs: 3600_000 });
    const r = await diagnose({ serial: 's', origin: broken.vision.origin, approveProvision: true, skipApkOrigin: true },
      { adb: fakeAvd({ origin: broken.vision.origin, enrollment: enrollmentOf(issued) }).adb, fetch, openPool: async () => null, guard: guardMemory(), pullApk: async () => null });
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'SERVER_STARTING');
  } finally { await broken.vision.stop(); }
  const slow = await stack({ slowProvisionMs: 300 });
  try {
    const issued = await slow.store.register({ label: 'g', ttlMs: 3600_000 });
    const r = await diagnose({ serial: 's', origin: slow.vision.origin, approveProvision: true, skipApkOrigin: true },
      { adb: fakeAvd({ origin: slow.vision.origin, enrollment: enrollmentOf(issued) }).adb, fetch, openPool: async () => slow.pool, guard: guardMemory(), pullApk: async () => null });
    assert.equal(byId(r).QR_AUTHORIZATION.status, STATUS.PASS, 'a delay inside the timeout is not a failure');
  } finally { await slow.vision.stop(); }
});

test('device states: not connected, wrong origin, reinstall (files gone), AVD restart, clock skew, invalid file', async () => {
  const { pool, store, vision } = await stack();
  try {
    const issued = await store.register({ label: 'h', ttlMs: 3600_000 });
    const deps = (avd) => ({ adb: avd.adb, fetch, openPool: async () => pool, guard: guardMemory(), pullApk: async () => null });
    const opts = { serial: 's', origin: vision.origin, schema: 'carscope_vision', skipApkOrigin: true };
    let r = await diagnose(opts, deps(fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued), connected: false })));
    assert.equal(r.firstFailure.cause, 'AVD_NOT_CONNECTED');
    assert.ok(r.checks.slice(1).every((c) => c.status !== STATUS.PASS || c.id === 'VISION_HEALTH'), 'nothing device-side passes without a device');
    r = await diagnose(opts, deps(fakeAvd({ origin: 'https://carscope-lluo.onrender.com', enrollment: enrollmentOf(issued) })));
    assert.equal(byId(r).VISION_ORIGIN.cause, 'ORIGIN_MISMATCH');
    // Reinstall: private files are gone, the server registration stays.
    const reinstalled = fakeAvd({ origin: vision.origin });
    r = await diagnose(opts, deps(reinstalled));
    assert.equal(byId(r).ENROLLMENT_FILE.cause, 'ENROLLMENT_MISSING');
    assert.equal(byId(r).REGISTRATION_EXISTS.status, STATUS.NOT_RUN);
    assert.equal(pool.regs.get(issued.registrationId).revoked_at, null, 'nothing was revoked');
    // AVD restart: same private files, a fresh grant works again.
    const restarted = fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued) });
    r = await diagnose({ ...opts, approveProvision: true }, deps(restarted));
    assert.equal(byId(r).QR_AUTHORIZATION.status, STATUS.PASS);
    r = await diagnose(opts, deps(fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued), clockSkewMs: 120_000 })));
    assert.equal(byId(r).ENROLLMENT_FILE.cause, 'CLOCK_SKEW');
    r = await diagnose(opts, deps(fakeAvd({ origin: vision.origin, enrollment: { ...enrollmentOf(issued), enrollmentProof: 'short' } })));
    assert.equal(byId(r).ENROLLMENT_FILE.cause, 'ENROLLMENT_INVALID');
    r = await diagnose({ ...opts, stateRegistrationId: randomUUID() }, deps(fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued) })));
    assert.equal(byId(r).ENROLLMENT_FILE.cause, 'STATE_MISMATCH');
    assert.equal(byId(r).ENROLLMENT_FILE.status, STATUS.WARN);
  } finally { await vision.stop(); }
});

// The same path on PostgreSQL: the store's real SQL, schema init, read-only diagnosis and revocation. CI only.
test('PostgreSQL: issue → diagnose (live grant and session) → revoke → diagnosed as REVOKED', { skip: !process.env.PG_TEST_URL && 'PG_TEST_URL absent: PostgreSQL E2E NOT_RUN', timeout: 90_000 }, async () => {
  const url = process.env.PG_TEST_URL;
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('PG_TEST_URL_MUST_BE_LOCAL');
  const { default: pg } = await import('pg');
  const schema = 'p22_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
  let vision;
  try {
    const store = new AvdSimulatorCredentialStore({ pool });
    await store.initialize();
    vision = await startVisionLike({ store });
    const issued = await store.register({ label: 'pg-e2e', ttlMs: 3600_000 });
    const deps = () => ({ adb: fakeAvd({ origin: vision.origin, enrollment: enrollmentOf(issued) }).adb, fetch, openPool: async () => ({ connect: () => pool.connect(), end: async () => {} }), guard: guardMemory(), pullApk: async () => null });
    let r = await diagnose({ serial: 's', origin: vision.origin, schema, approveProvision: true, approveSession: true, skipApkOrigin: true }, deps());
    assert.equal(r.final, 'READY_FOR_QR_E2E', JSON.stringify(r.checks.map((c) => [c.id, c.status, c.cause])));
    assert.equal(byId(r).DB_PERMISSIONS.status, STATUS.PASS);
    await store.revoke({ registrationId: issued.registrationId });
    r = await diagnose({ serial: 's', origin: vision.origin, schema, approveProvision: true, skipApkOrigin: true }, deps());
    assert.equal(byId(r).REGISTRATION_ACTIVE.cause, 'REVOKED');
    assert.equal(byId(r).QR_AUTHORIZATION.cause, 'REVOKED');
    r = await diagnose({ serial: 's', origin: vision.origin, schema: 'carscope', skipApkOrigin: true }, deps());
    assert.equal(byId(r).REGISTRATION_EXISTS.cause, 'SCHEMA_MISMATCH');
  } finally {
    await vision?.stop(); await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
