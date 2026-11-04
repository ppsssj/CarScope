// Boundaries the existing PostgreSQL suites leave open: upgrading a pre-History database through the real Render CLI,
// one record's whole lifetime from creation to credential revocation, and the real CLI in both deployable modes.
// Owners, vehicles and authorities are synthetic: nothing here is evidence of real vehicle ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertIsolatedTestDatabase, inspectDatabase } from '../preflight/database.mjs';
import { probeDeployment } from '../preflight/probe.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { DEFAULT_RATES } from '../src/rate-limit.mjs';
import { startSyncServer } from '../src/server.mjs';
import { DEFAULT_LIMITS } from '../src/sessions.mjs';
import { httpsCreationAuthorizer } from '../src/https-creation-authority.mjs';
import { httpsHistoryAuthorizer } from '../src/https-history-authority.mjs';
import { historyAuthorityFixture } from './history-authority-fixture.mjs';
import { envelope, historyResult } from './history-fixtures.mjs';
import { tlsFetch } from './https-helpers.mjs';

const uri = process.env.PG_TEST_URL;
const skip = !uri && 'PG_TEST_URL absent: deployment PostgreSQL integration NOT_RUN';
const ENTRY = fileURLToPath(new URL('../src/render-stateful.mjs', import.meta.url));
const PUBLIC_ORIGIN = 'https://deployment-test.onrender.com';
const BASE_SQL = new URL('../src/postgres-schema.sql', import.meta.url);
const CREATION_KEYS = ['sessionId', 'taskId', 'receiverToken', 'inviteToken', 'inviteExpiresAt', 'expiresAt'];

/** One UUID-named schema per test, on a loopback database only, dropped afterwards. */
async function ownedSchema(t, prefix) {
  assertIsolatedTestDatabase(uri);
  const { default: { Pool } } = await import('pg');
  const schema = prefix + randomUUID().replaceAll('-', '');
  assert.match(schema, /^cs_deploy_[a-z]+_[a-f0-9]{32}$/);
  const admin = new Pool({ connectionString: uri, max: 2, connectionTimeoutMillis: 5000 });
  admin.on('error', () => {});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pools = [];
  const pool = ({ url = uri, max = 4 } = {}) => {
    const p = new Pool({ connectionString: url, max, options: '-c search_path=' + schema, connectionTimeoutMillis: 5000 });
    p.on('error', () => {});
    pools.push(p);
    return p;
  };
  t.after(async () => {
    await Promise.allSettled(pools.map((p) => p.end()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return { schema, admin, pool };
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** The actual Render start command, as a child process, with PGOPTIONS keeping it inside the owned schema. */
async function renderCli(t, schema, { url = uri, env = {} } = {}) {
  const port = await freePort();
  const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...platform, RENDER: 'true', RENDER_EXTERNAL_URL: PUBLIC_ORIGIN, PORT: String(port), DATABASE_URL: url, PGOPTIONS: '-c search_path=' + schema, ...env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  const closed = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => { child.kill(); await closed; };
  t.after(stop);
  return { port, closed, stop, output: () => output };
}

function edgeRequest(port, path, { method = 'GET', headers = {}, bearer, body } = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request({
      host: '127.0.0.1', port, method, path,
      headers: {
        Host: new URL(PUBLIC_ORIGIN).host, 'X-Forwarded-Proto': 'https',
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* A page or an empty refusal. */ }
        resolve({ status: r.statusCode, data, body: text, headers: r.headers });
      });
    });
    q.on('error', reject);
    q.end(body ? JSON.stringify(body) : undefined);
  });
}

async function waitHealthy(app) {
  for (let i = 0; i < 100; i++) {
    const r = await edgeRequest(app.port, '/healthz').catch(() => null);
    if (r?.status === 200) return r.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('RENDER_CLI_NOT_HEALTHY');
}

const status = (checks, id) => checks.find((c) => c.id === id)?.status;
const failures = (checks) => checks.filter((c) => c.status === 'FAIL').map((c) => c.id);

function assertCreationKeys(created) {
  const keys = Object.keys(created);
  assert.deepEqual(keys.filter((k) => k !== 'serverNow').sort(), [...CREATION_KEYS].sort());
  if (keys.includes('serverNow')) {
    assert.ok(Number.isSafeInteger(created.serverNow) && created.serverNow >= 0 && created.serverNow < created.inviteExpiresAt);
    assert.ok(created.inviteExpiresAt <= created.expiresAt);
  }
}

test('migration: the real Render start upgrades a pre-History database additively; preflight only observes', { skip, timeout: 180_000 }, async (t) => {
  const { schema, admin, pool } = await ownedSchema(t, 'cs_deploy_mig_');
  const db = pool();
  await db.query(readFileSync(BASE_SQL, 'utf8'));
  const legacy = randomUUID();
  const legacySession = { id: legacy, state: 'ACCEPTED', taskId: 'washer-fluid', createdAt: 1, expiresAt: Date.now() + 3_600_000, inviteExpiresAt: 2, endedAt: Date.now(), receiverHash: 'a'.repeat(64), result: { kept: true }, resultDigest: 'sha256:' + 'b'.repeat(64) };
  await db.query('INSERT INTO cs_sessions(id,data) VALUES($1,$2::jsonb)', [legacy, JSON.stringify(legacySession)]);
  await db.query("INSERT INTO cs_session_tokens(hash,kind,session_id) VALUES($1,'receiver',$2)", ['a'.repeat(64), legacy]);

  const tables = async () => (await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY 1')).rows.map((r) => r.table_name);
  const baseShape = async () => (await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('cs_schema_meta','cs_sessions','cs_session_tokens','cs_rate_windows') ORDER BY 1,2")).rows;
  const beforeTables = await tables(), beforeShape = await baseShape();
  const preHistoryTables = ['cs_rate_windows', 'cs_schema_meta', 'cs_session_tokens', 'cs_sessions'];
  assert.deepEqual(beforeTables, preHistoryTables);

  // A role with table rights but no schema CREATE and no ownership, as a least-privilege service role would be.
  const role = 'cs_deploy_role_' + randomBytes(8).toString('hex'), password = randomBytes(18).toString('hex');
  const roleUrl = (() => { const u = new URL(uri); u.username = role; u.password = password; return u.href; })();
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  t.after(async () => {
    await admin.query(`DROP OWNED BY ${role}`).catch(() => {});
    await admin.query(`DROP ROLE ${role}`).catch(() => {});
  });

  await t.test('preflight reports the pending migration inside READ ONLY and changes nothing', async () => {
    const seen = [];
    const spy = {
      connect: async () => {
        const client = await db.connect();
        return { query: (...args) => { seen.push(String(args[0])); return client.query(...args); }, release: () => client.release() };
      },
    };
    const checks = await inspectDatabase(spy);
    assert.equal(status(checks, 'DB_INSPECTION_READ_ONLY'), 'PASS');
    assert.equal(status(checks, 'DB_BASE_SCHEMA'), 'PASS');
    const history = checks.find((c) => c.id === 'DB_HISTORY_MIGRATION');
    assert.equal(history.status, 'MANUAL');
    assert.equal(history.state, 'PENDING');
    assert.deepEqual(history.ddl, ['cs_history_schema_meta', 'cs_inspection_records', 'cs_history_owner_page', 'cs_history_owner_task_page']);
    assert.equal(seen[0], 'BEGIN TRANSACTION READ ONLY');
    assert.equal(seen.at(-1), 'ROLLBACK');
    assert.deepEqual(await tables(), preHistoryTables);
    assert.deepEqual(await baseShape(), beforeShape);
  });

  await t.test('PostgreSQL itself refuses a write in the transaction mode preflight uses', async () => {
    const c = await db.connect();
    try {
      await c.query('BEGIN TRANSACTION READ ONLY');
      await assert.rejects(() => c.query('CREATE TABLE cs_never_created (id INT)'), { code: '25006' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    assert.deepEqual(await tables(), preHistoryTables);
  });

  await t.test('a role that cannot run the startup DDL is flagged, and the real CLI fails closed without changes', async () => {
    const limited = pool({ url: roleUrl, max: 1 });
    const checks = await inspectDatabase(limited);
    assert.equal(status(checks, 'DB_STARTUP_PRIVILEGE'), 'FAIL');
    await assert.rejects(() => PostgreSQLSessionStore.open({ pool: limited }), { code: '42501' });
    const app = await renderCli(t, schema, { url: roleUrl });
    assert.equal(await app.closed, 1);
    assert.equal(app.output().trim(), 'RENDER_STATEFUL_CONFIGURATION_FAILED');
    assert.equal(app.output().includes(password), false);
    assert.deepEqual(await tables(), preHistoryTables);
  });

  await t.test('the real start applies the migration, keeps old rows and backfills nothing', async () => {
    const before = (await db.query('SELECT data FROM cs_sessions WHERE id=$1', [legacy])).rows[0].data;
    const app = await renderCli(t, schema);
    const healthy = await waitHealthy(app);
    assert.deepEqual(healthy, { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    assert.deepEqual(await tables(), [...preHistoryTables, 'cs_history_schema_meta', 'cs_inspection_records'].sort());
    assert.deepEqual(await baseShape(), beforeShape, 'existing tables keep their columns');
    assert.equal(Number((await db.query('SELECT version FROM cs_schema_meta')).rows[0].version), 1);
    assert.equal(Number((await db.query('SELECT version FROM cs_history_schema_meta')).rows[0].version), 1);
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_inspection_records')).rows[0].n), 0, 'a prior ACCEPTED session is not backfilled');
    assert.deepEqual((await db.query('SELECT data FROM cs_sessions WHERE id=$1', [legacy])).rows[0].data, before);
    await app.stop();
  });

  await t.test('after migration preflight passes, and repeated concurrent starts stay idempotent', async () => {
    const checks = await inspectDatabase(db);
    assert.deepEqual(failures(checks), []);
    assert.equal(status(checks, 'DB_HISTORY_MIGRATION'), 'PASS');
    assert.equal(status(checks, 'DB_HISTORY_COLUMNS'), 'PASS');
    await Promise.all(Array.from({ length: 3 }, () => PostgreSQLSessionStore.open({ pool: pool({ max: 2 }) })));
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_history_schema_meta')).rows[0].n), 1);
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_schema_meta')).rows[0].n), 1);
  });

  await t.test('a non-owner role fails at every start, even after the migration is complete', async () => {
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    const limited = pool({ url: roleUrl, max: 1 });
    const checks = await inspectDatabase(limited);
    assert.equal(status(checks, 'DB_HISTORY_MIGRATION'), 'PASS');
    assert.equal(status(checks, 'DB_STARTUP_PRIVILEGE'), 'FAIL');
    // Least-privilege runtime roles are not possible today: the startup DDL needs schema CREATE and table ownership.
    await assert.rejects(() => PostgreSQLSessionStore.open({ pool: limited }), { code: '42501' });
  });

  await t.test('preflight detects partial or unknown schema states; a restart restores a dropped index only', async () => {
    await db.query('DROP INDEX cs_history_owner_task_page');
    let checks = await inspectDatabase(db);
    assert.equal(status(checks, 'DB_HISTORY_MIGRATION'), 'FAIL');
    assert.match(checks.find((c) => c.id === 'DB_HISTORY_MIGRATION').detail, /cs_history_owner_task_page/);
    await PostgreSQLSessionStore.open({ pool: pool({ max: 2 }) });
    assert.equal(status(await inspectDatabase(db), 'DB_HISTORY_MIGRATION'), 'PASS');

    await db.query('UPDATE cs_history_schema_meta SET version=2');
    assert.equal(status(await inspectDatabase(db), 'DB_HISTORY_MIGRATION'), 'FAIL');
    await db.query('UPDATE cs_history_schema_meta SET version=1');
    await db.query('UPDATE cs_schema_meta SET version=2');
    assert.equal(status(await inspectDatabase(db), 'DB_BASE_SCHEMA'), 'FAIL');
    await db.query('UPDATE cs_schema_meta SET version=1');
    await db.query('ALTER TABLE cs_inspection_records ADD COLUMN unexpected TEXT');
    assert.equal(status(await inspectDatabase(db), 'DB_HISTORY_COLUMNS'), 'FAIL');
    await db.query('ALTER TABLE cs_inspection_records DROP COLUMN unexpected');
    assert.deepEqual(failures(await inspectDatabase(db)), []);
  });

  await t.test('code rollback stays possible: base DDL replays on the migrated schema and no foreign key ties sessions to records', async () => {
    await db.query(readFileSync(BASE_SQL, 'utf8'));
    assert.equal(Number((await db.query('SELECT version FROM cs_schema_meta')).rows[0].version), 1);
    const linked = await db.query("SELECT conname FROM pg_constraint WHERE contype='f' AND (conrelid=to_regclass('cs_inspection_records') OR confrelid=to_regclass('cs_inspection_records'))");
    assert.equal(linked.rows.length, 0);
    assert.equal((await db.query('DELETE FROM cs_sessions WHERE id=$1', [legacy])).rowCount, 1);
  });
});

test('lifecycle: synthetic session -> Accept -> History -> purge -> scoped read -> revocation, on one set of records', { skip, timeout: 180_000 }, async (t) => {
  const { pool } = await ownedSchema(t, 'cs_deploy_flow_');
  const db = pool({ max: 6 });
  const store = await PostgreSQLSessionStore.open({ pool: db });
  let now = Date.now();
  const clock = () => now;
  const f = await historyAuthorityFixture({ now: clock });
  t.after(() => f.stop());
  const wide = { limit: 100_000, windowMs: 60_000 };
  const logs = [];
  const app = await startSyncServer({
    port: 0, store, now: clock, log: (line) => logs.push(line),
    rates: { ...DEFAULT_RATES, client: wide, token: wide, create: wide, claim: wide, submit: wide, read: wide },
    authorizer: httpsCreationAuthorizer({ ...f.creation, timeoutMs: 5000, authorityTimeoutMs: 5000 }),
    historyAuthorizer: httpsHistoryAuthorizer({ ...f.history, timeoutMs: 5000, authorityTimeoutMs: 5000 }),
    tlsCert: f.pki.tlsCert, tlsKey: f.pki.tlsKey,
  });
  t.after(() => app.stop());
  const fetchTls = tlsFetch(f.pki.ca);
  const call = async (method, path, token, body) => {
    const r = await fetchTls(app.url + path, {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const list = (token) => call('GET', '/v1/inspection-records?limit=100', token);
  const detail = (token, id) => call('GET', '/v1/inspection-records/' + id, token);
  const rows = async () => (await db.query('SELECT * FROM cs_inspection_records ORDER BY record_id')).rows;
  const count = async (table) => Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);

  const longLived = { expiresInMs: 12 * 3_600_000 };
  const owner = f.register({ userId: 'user-owner', vehicleId: 'vehicle-owned', ...longLived });
  const otherUser = f.register({ userId: 'user-other', vehicleId: 'vehicle-owned', ...longLived });
  const otherVehicle = f.register({ userId: 'user-owner', vehicleId: 'vehicle-second', ...longLived });

  async function open(task, binding = owner) {
    const result = historyResult(task, { completedAt: now - 1000 });
    const created = await call('POST', '/v1/sessions', f.issueCreate(binding), { taskId: task, userId: 'spoofed', vehicleId: 'spoofed' });
    assert.equal(created.status, 201, task);
    assertCreationKeys(created.body);
    const claimed = await call('POST', '/v1/claim', created.body.inviteToken);
    assert.equal(claimed.status, 200);
    return { task, result, session: created.body, submitToken: claimed.body.submitToken };
  }
  async function submit(x) {
    const r = await call('POST', '/v1/submissions', x.submitToken, envelope(x.result));
    assert.equal(r.status, 201);
    x.digest = r.body.receipt.resultDigest;
    return x;
  }

  // Each schema v1/v2 family of the 17 tasks; the full 17 run in history-postgres.test.mjs.
  const TASKS = ['washer-fluid', 'brake-fluid', 'tire.front-left', 'ev-charge.port', 'light-low-beam-left-0'];
  const accepted = [];
  let snapshot, unaccepted, cancelled;

  await t.test('submission alone archives nothing; only the Native role can Accept, and only the exact digest', async () => {
    for (const task of TASKS) accepted.push(await submit(await open(task)));
    unaccepted = await submit(await open('fuse-box'));
    cancelled = await submit(await open('coolant-reservoir'));
    assert.equal(await count('cs_inspection_records'), 0, 'RESULT_SUBMITTED is not a record');
    const [x] = accepted, path = `/v1/sessions/${x.session.sessionId}/accept`, digest = { resultDigest: x.digest };
    assert.equal((await call('POST', path, x.submitToken, digest)).status, 404, 'phone submit token');
    assert.equal((await call('POST', path, x.session.inviteToken, digest)).status, 404, 'QR invite token');
    assert.equal((await call('POST', path, null, digest)).status, 401);
    assert.equal((await call('POST', path, x.session.receiverToken, { resultDigest: 'sha256:' + '0'.repeat(64) })).status, 409);
    assert.equal(await count('cs_inspection_records'), 0);
  });

  await t.test('explicit Accept creates one owner-bound record per session and repeats are idempotent', async () => {
    for (const x of accepted) {
      const path = `/v1/sessions/${x.session.sessionId}/accept`;
      const first = await call('POST', path, x.session.receiverToken, { resultDigest: x.digest });
      assert.equal(first.status, 200);
      assert.equal(first.body.sessionState, 'ACCEPTED');
      assert.equal((await call('POST', path, x.session.receiverToken, { resultDigest: x.digest })).status, 200);
    }
    assert.equal((await call('POST', `/v1/sessions/${cancelled.session.sessionId}/cancel`, cancelled.session.receiverToken)).status, 200);
    snapshot = await rows();
    assert.equal(snapshot.length, TASKS.length);
    for (const row of snapshot) {
      assert.equal(row.authority_namespace, 'VERIFIED_VEHICLE');
      assert.equal(row.user_id, 'user-owner', 'spoofed creation body never becomes the owner');
      assert.equal(row.vehicle_id, 'vehicle-owned');
    }
    assert.deepEqual(snapshot.map((r) => r.task_id).sort(), [...TASKS].sort());
  });

  await t.test('sessions expire and purge on the unchanged TTLs; only the records remain', async () => {
    const [x] = accepted;
    const session = await store.get(x.session.sessionId);
    assert.equal(session.inviteExpiresAt - session.createdAt, DEFAULT_LIMITS.inviteTtlMs);
    assert.equal(session.expiresAt - session.createdAt, DEFAULT_LIMITS.sessionTtlMs);
    assert.equal(session.purgeResultAt - session.acceptedAt, DEFAULT_LIMITS.acceptedRetentionMs);

    now = session.purgeResultAt + 1;
    await app.service.sweep();
    const purged = await call('GET', `/v1/sessions/${x.session.sessionId}`, x.session.receiverToken);
    assert.equal(purged.body.sessionState, 'ACCEPTED');
    assert.equal(purged.body.result, null, 'accepted result leaves the session after retention');

    now = Math.max(now, session.expiresAt + 1);
    await app.service.sweep();
    const expired = await call('GET', `/v1/sessions/${unaccepted.session.sessionId}`, unaccepted.session.receiverToken);
    assert.equal(expired.body.sessionState, 'EXPIRED');
    assert.equal(expired.body.result, null);
    assert.equal((await call('POST', `/v1/sessions/${unaccepted.session.sessionId}/accept`, unaccepted.session.receiverToken, { resultDigest: unaccepted.digest })).status, 410);

    now += DEFAULT_LIMITS.tombstoneMs + 1;
    await app.service.sweep();
    assert.equal(await count('cs_sessions'), 0);
    assert.equal(await count('cs_session_tokens'), 0);
    assert.equal((await call('GET', `/v1/sessions/${x.session.sessionId}`, x.session.receiverToken)).status, 404);
    assert.deepEqual(await rows(), snapshot, 'records are unchanged by session purge, and no unaccepted session was archived');
  });

  await t.test('after the purge the owner reads every record; digests still match', async () => {
    const token = f.issue(owner);
    const page = await list(token);
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.items.map((i) => i.recordId).sort(), snapshot.map((r) => r.record_id).sort());
    for (const x of accepted) {
      const item = page.body.items.find((i) => i.inspectionId === x.result.inspectionId);
      assert.equal(item.resultDigest, x.digest);
      const one = await detail(token, item.recordId);
      assert.equal(one.status, 200);
      assert.deepEqual(one.body.record.originalResult, x.result);
    }
  });

  await t.test('another user, another vehicle and non-history credentials read nothing', async () => {
    const recordId = snapshot[0].record_id;
    for (const binding of [otherUser, otherVehicle]) {
      const token = f.issue(binding);
      const page = await list(token);
      assert.equal(page.status, 200);
      assert.deepEqual(page.body.items, []);
      assert.equal((await detail(token, recordId)).status, 404);
    }
    for (const token of [null, accepted[0].session.receiverToken, accepted[0].submitToken, f.issueCreate(owner), 'x'.repeat(43)]) {
      const r = await list(token);
      assert.equal(r.status, 403);
      assert.deepEqual(r.body, { error: { code: 'FORBIDDEN' } });
    }
  });

  await t.test('credential and registration revocation cut access at once and leave the records in place', async () => {
    const recordId = snapshot[0].record_id;
    const credential = f.issue(owner);
    assert.equal((await list(credential)).status, 200);
    f.revokeCredential(credential);
    assert.equal((await list(credential)).status, 403);
    assert.equal((await detail(credential, recordId)).status, 403);
    const live = f.issue(owner);
    assert.equal((await list(live)).status, 200, 'revoking one credential leaves the registration usable');

    const create = f.issueCreate(owner);
    f.revokeRegistration(owner);
    assert.equal((await list(live)).status, 403);
    assert.equal((await list(f.issue(owner))).status, 403, 'a credential issued afterwards is refused as well');
    assert.equal((await call('POST', '/v1/sessions', create, { taskId: 'washer-fluid' })).status, 403);
    assert.deepEqual(await rows(), snapshot);
  });

  await t.test('no credential or owner identifier reached the request log', () => {
    const text = logs.join('\n');
    assert.ok(logs.length > 0);
    for (const x of accepted) for (const secret of [x.session.receiverToken, x.session.inviteToken, x.submitToken]) assert.equal(text.includes(secret), false);
    for (const id of ['user-owner', 'vehicle-owned']) assert.equal(text.includes(id), false);
  });
});

test('real Render CLI: environment cannot open History, and simulator credentials never become owner reads', { skip, timeout: 180_000 }, async (t) => {
  const { schema, pool } = await ownedSchema(t, 'cs_deploy_cli_');
  const db = pool();

  await t.test('DENY_DEFAULT holds under hostile environment switches; the preflight probe agrees', async () => {
    const app = await renderCli(t, schema, {
      env: {
        NODE_ENV: 'production', CARSCOPE_HISTORY_READ: 'ALLOW', CARSCOPE_HISTORY_AUTH: 'true', HISTORY_AUTHORITY_ORIGIN: 'https://evil.example',
        HISTORY_AUTHORIZER: 'allow', HISTORY_READ_ENABLED: '1', AUTHORIZER_OVERRIDE: '1',
      },
    });
    assert.deepEqual(await waitHealthy(app), { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    const bearer = randomBytes(32).toString('base64url');
    assert.equal((await edgeRequest(app.port, '/v1/inspection-records', { bearer })).status, 403);
    assert.equal((await edgeRequest(app.port, '/v1/inspection-records')).status, 403);
    assert.equal((await edgeRequest(app.port, '/v1/sessions', { method: 'POST', bearer, body: { taskId: 'washer-fluid' } })).status, 403);
    assert.equal((await edgeRequest(app.port, '/simulator/provision', { method: 'POST', bearer, body: {} })).status, 404);
    const checks = await probeDeployment({
      origin: PUBLIC_ORIGIN, approveRateWindowWrites: true,
      request: (origin, path, options) => edgeRequest(app.port, path, options),
    });
    assert.deepEqual(checks.map((c) => [c.id, c.status]), [['RENDER_HEALTH', 'PASS'], ['RENDER_HISTORY_AUTHORITY', 'PASS'], ['RENDER_API_BOUNDARY', 'PASS']]);
    assert.ok(Number((await db.query('SELECT count(*) n FROM cs_rate_windows')).rows[0].n) > 0, 'confirms why /v1 probes need an explicit approval');
    assert.equal(app.output().includes(bearer), false);
    await app.stop();
  });

  await t.test('simulator mode: operator approval -> QR -> Accept archives as AVD_SIMULATOR, never an owner; revocation stops creation', async () => {
    const registry = new AvdSimulatorCredentialStore({ pool: db });
    await registry.initialize();
    const app = await renderCli(t, schema, { env: { CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED' } });
    assert.deepEqual(await waitHealthy(app), { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' });
    const { registrationId, enrollmentProof } = await registry.register({ label: 'deployment-readiness-test', ttlMs: 3_600_000 });
    const provision = (bearer) => edgeRequest(app.port, '/simulator/provision', { method: 'POST', bearer, body: { apiOrigin: PUBLIC_ORIGIN, audience: AVD_AUDIENCE } });
    const grant = await provision(enrollmentProof);
    assert.equal(grant.status, 200);
    assert.equal(grant.data.realVehicleOwnershipVerified, false);
    const credential = grant.data.credential;

    const task = 'brake-fluid', result = historyResult(task, { completedAt: Date.now() - 1000 });
    const created = await edgeRequest(app.port, '/v1/sessions', { method: 'POST', bearer: credential, body: { taskId: task } });
    assert.equal(created.status, 201);
    assertCreationKeys(created.data);
    const claim = await edgeRequest(app.port, '/v1/claim', { method: 'POST', bearer: created.data.inviteToken });
    assert.equal(claim.status, 200);
    const submitted = await edgeRequest(app.port, '/v1/submissions', { method: 'POST', bearer: claim.data.submitToken, body: envelope(result) });
    assert.equal(submitted.status, 201);
    const accept = await edgeRequest(app.port, `/v1/sessions/${created.data.sessionId}/accept`, { method: 'POST', bearer: created.data.receiverToken, body: { resultDigest: submitted.data.receipt.resultDigest } });
    assert.equal(accept.status, 200);

    const row = (await db.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1', [result.inspectionId])).rows[0];
    assert.equal(row.authority_namespace, 'AVD_SIMULATOR');
    assert.equal(row.registration_id, registrationId);
    assert.deepEqual([row.user_id, row.vehicle_id, row.device_id], [null, null, null], 'no vehicle owner is claimed');

    for (const bearer of [credential, enrollmentProof, created.data.receiverToken, claim.data.submitToken]) {
      assert.equal((await edgeRequest(app.port, '/v1/inspection-records', { bearer })).status, 403);
      assert.equal((await edgeRequest(app.port, '/v1/inspection-records/' + row.record_id, { bearer })).status, 403);
    }

    assert.equal(await registry.revoke({ registrationId }), true);
    assert.equal((await provision(enrollmentProof)).status, 401);
    assert.equal((await edgeRequest(app.port, '/v1/sessions', { method: 'POST', bearer: credential, body: { taskId: task } })).status, 403);
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_inspection_records WHERE record_id=$1', [row.record_id])).rows[0].n), 1);
    for (const secret of [enrollmentProof, credential, created.data.receiverToken]) assert.equal(app.output().includes(secret), false);
    await app.stop();
  });
});
