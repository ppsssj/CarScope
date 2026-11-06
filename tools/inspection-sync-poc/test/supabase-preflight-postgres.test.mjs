// Disposable local PostgreSQL only, normally through test/run-pg-matrix.mjs. `platform` below is a local stand-in with the
// roles and defaults the Supabase documentation describes. It is not Supabase, and passing here says nothing about Supavisor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolatedTestDatabase, inspectDatabase, inspectDatabaseUrl } from '../preflight/database.mjs';
import { clientVersions, dockerClient, nativeClient, recoveryVerdict, runBackup, runCompare, runRelocate, runRestore, runVerify, captureState } from '../preflight/recovery.mjs';
import { applyCarScopeSchema, rehearsalUrl, seedSyntheticData } from '../preflight/recovery-seed.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { envelope, historyResult } from './history-fixtures.mjs';

const uri = process.env.PG_TEST_URL;
const client = process.env.PG_CLIENT_DOCKER_IMAGE ? dockerClient({ image: process.env.PG_CLIENT_DOCKER_IMAGE }) : nativeClient({ binDir: process.env.PG_CLIENT_BIN });
const clientReady = uri ? (await clientVersions(client)).pg_dump !== null : false;
if (uri && !clientReady && process.env.PG_RECOVERY_REQUIRED === '1') throw new Error('PG_RECOVERY_REQUIRED but no PostgreSQL client tools were found');
const skip = !uri ? 'PG_TEST_URL absent: NOT_RUN' : !clientReady ? 'pg_dump absent: NOT_RUN' : false;
const tlsSkip = skip || (!process.env.PG_TLS_TEST_URL && 'PG_TLS_TEST_URL absent: NOT_RUN (use npm run test:pg-matrix)');
const outageSkip = skip || (!process.env.PG_MATRIX_CONTAINER && 'PG_MATRIX_CONTAINER absent: NOT_RUN (use npm run test:pg-matrix)');
const crossSkip = skip || (!process.env.PG_CROSS_SOURCE_URL && 'PG_CROSS_SOURCE_URL absent: NOT_RUN (use npm run test:pg-matrix)');

const ENTRY = fileURLToPath(new URL('../src/render-stateful.mjs', import.meta.url));
const PUBLIC_ORIGIN = 'https://supabase-preflight.onrender.com';
const SCHEMA = 'carscope';
const sql = (file) => readFileSync(new URL('../preflight/' + file, import.meta.url), 'utf8');
const status = (checks, id) => checks.find((c) => c.id === id)?.status;
const failures = (checks) => checks.filter((c) => c.status === 'FAIL').map((c) => c.id + ':' + c.detail);
const unique = () => 'p' + randomBytes(6).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function harness(t) {
  assertIsolatedTestDatabase(uri);
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 10_000 });
  admin.on('error', () => {});
  await admin.connect();
  const databases = [], roles = [], pools = [];
  const dir = mkdtempSync(join(tmpdir(), 'carscope-a4-'));
  const pool = (url, { max = 3, options } = {}) => {
    const p = new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 10_000, ...(options ? { options } : {}) });
    p.on('error', () => {});
    pools.push(p);
    return p;
  };
  const database = async (suffix = 'db', { owner } = {}) => {
    const name = `carscope_rehearsal_${unique()}_${suffix}`;
    await admin.query(`CREATE DATABASE ${name}${owner ? ' OWNER ' + owner : ''}`);
    databases.push(name);
    return { name, url: rehearsalUrl(uri, name) };
  };
  const urlAs = (role, password, databaseName) => { const u = new URL(rehearsalUrl(uri, databaseName)); u.username = role; u.password = password; return u.href; };
  t.after(async () => {
    // A fresh connection: the outage test stops the server, which ends the one this harness has been using.
    await Promise.allSettled(pools.map((p) => p.end()));
    await Promise.race([admin.end().catch(() => {}), sleep(2000)]);
    const cleaner = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 10_000 });
    cleaner.on('error', () => {});
    try {
      await cleaner.connect();
      for (const name of databases) await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      for (const role of roles) await cleaner.query(`DROP ROLE IF EXISTS ${role}`);
      await cleaner.query('DROP ROLE IF EXISTS carscope_app'); // After its databases, or it would leak into the next test.
    } finally {
      await Promise.race([cleaner.end().catch(() => {}), sleep(2000)]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  /**
   * A database laid out as the documentation describes: a non-superuser admin owning it, the three API roles, managed
   * schemas with sentinel rows, and public open to those roles by default. Role names are global, so they are shared.
   */
  const platform = async () => {
    const suffix = randomBytes(4).toString('hex');
    const adminRole = 'cs_platform_admin_' + suffix, adminPassword = randomBytes(18).toString('hex');
    await admin.query(`CREATE ROLE ${adminRole} LOGIN CREATEROLE PASSWORD '${adminPassword}'`);
    roles.push(adminRole);
    for (const role of ['anon', 'authenticated', 'service_role']) await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    const db = await database('platform', { owner: adminRole });
    const owner = pool(urlAs(adminRole, adminPassword, db.name));
    await owner.query(`CREATE SCHEMA auth; CREATE TABLE auth.users (id INT); INSERT INTO auth.users VALUES (1);
      CREATE SCHEMA storage; CREATE TABLE storage.objects (id INT); INSERT INTO storage.objects VALUES (1);
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.other_app (id INT); INSERT INTO public.other_app VALUES (1);
      CREATE SCHEMA carscope_private;`); // Empty and unused, as on the real project. It must stay exactly that.
    return { ...db, adminRole, adminPassword, owner };
  };
  /** Runs supabase-bootstrap.sql as the platform admin. The role name is fixed by that file, so one test at a time holds it. */
  const bootstrap = async (p) => {
    await admin.query('DROP ROLE IF EXISTS carscope_app').catch(() => {});
    await p.owner.query(sql('supabase-bootstrap.sql'));
    const password = randomBytes(18).toString('hex');
    await p.owner.query(`ALTER ROLE carscope_app PASSWORD '${password}'`);
    return { password, url: urlAs('carscope_app', password, p.name) };
  };
  const stateOf = async (p, options) => {
    const c = await p.connect();
    try {
      await c.query('BEGIN TRANSACTION READ ONLY');
      return await captureState(c, options);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  };
  /** Local stand-in for the separately approved Supabase restore: plain pg_restore run as the application role. */
  const restoreAsApp = async (p, app, archive) => {
    const connection = (await import('../preflight/recovery.mjs')).parseConnection(app.url);
    const r = await client.run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname=' + p.name], { connection, stdinFile: archive });
    assert.equal(r.code, 0, 'pg_restore: ' + r.stderrCode);
    await p.owner.query(sql('supabase-post-restore.sql'));
  };
  /** The G3 path up to the archive S3 restores: backup, loopback copy, relocate, second backup. */
  const migrationArchive = async () => {
    const source = await database('source');
    const sourcePool = pool(source.url);
    await applyCarScopeSchema(sourcePool);
    const seeded = await seedSyntheticData(sourcePool);
    const first = join(dir, unique() + '-render.dump');
    assert.deepEqual(failures((await runBackup({ url: source.url, out: first, client, env: {} })).checks), []);
    const copy = await database('copy');
    assert.deepEqual(failures((await runRestore({ archive: first, url: copy.url, client, env: {} })).checks), []);
    assert.deepEqual(failures((await runVerify({ archive: first, url: copy.url, env: {} })).checks), []);
    const relocated = await runRelocate({ url: copy.url, schema: SCHEMA, env: {} });
    assert.deepEqual(failures(relocated.checks), []);
    const second = join(dir, unique() + '-migration.dump');
    assert.deepEqual(failures((await runBackup({ url: copy.url, out: second, client, env: {} })).checks), []);
    return { archive: second, seeded, source, sourcePool, copy };
  };
  return { admin, dir, pool, database, platform, bootstrap, stateOf, restoreAsApp, migrationArchive, urlAs };
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function cli(t, env) {
  const port = await freePort();
  const platformEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const child = spawn(process.execPath, [ENTRY], { env: { ...platformEnv, RENDER: 'true', RENDER_EXTERNAL_URL: PUBLIC_ORIGIN, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  const closed = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => { child.kill(); return closed; };
  t.after(stop);
  // A server that should have refused to start would keep running, so waiting for its exit needs a limit.
  const exited = () => Promise.race([closed, sleep(40_000).then(() => 'STILL_RUNNING')]);
  return { port, closed, exited, stop, output: () => output, alive: () => child.exitCode === null };
}

function edge(port, path, { method = 'GET', bearer, body } = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, method, path, timeout: 15_000, headers: { Host: new URL(PUBLIC_ORIGIN).host, 'X-Forwarded-Proto': 'https', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* A page or an empty refusal. */ }
        resolve({ status: r.statusCode, data });
      });
    });
    q.on('timeout', () => q.destroy(new Error('TIMEOUT')));
    q.on('error', reject);
    q.end(body ? JSON.stringify(body) : undefined);
  });
}

async function waitHealth(app, wanted = 200) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    last = await edge(app.port, '/healthz').catch(() => null);
    if (last?.status === wanted) return last.data;
    await sleep(150);
  }
  throw new Error(`HEALTH_NOT_${wanted}`);
}

/** The whole QR v2 path over HTTP, as the simulator mode allows it. Returns what later steps need. */
async function qrAccept(app, registry, task) {
  const { enrollmentProof } = await registry.register({ label: 'supabase-preflight', ttlMs: 3_600_000 });
  const grant = await edge(app.port, '/simulator/provision', { method: 'POST', bearer: enrollmentProof, body: { apiOrigin: PUBLIC_ORIGIN, audience: AVD_AUDIENCE } });
  assert.equal(grant.status, 200);
  const result = historyResult(task, { completedAt: Date.now() - 1000 });
  const created = await edge(app.port, '/v1/sessions', { method: 'POST', bearer: grant.data.credential, body: { taskId: task } });
  assert.equal(created.status, 201);
  const claim = await edge(app.port, '/v1/claim', { method: 'POST', bearer: created.data.inviteToken });
  assert.equal(claim.status, 200);
  const submitted = await edge(app.port, '/v1/submissions', { method: 'POST', bearer: claim.data.submitToken, body: envelope(result) });
  assert.equal(submitted.status, 201);
  return { created: created.data, digest: submitted.data.receipt.resultDigest, result };
}
const accept = (app, x) => edge(app.port, `/v1/sessions/${x.created.sessionId}/accept`, { method: 'POST', bearer: x.created.receiverToken, body: { resultDigest: x.digest } });

test('private schema: migration archive, API roles shut out, managed schemas untouched, QR v2 and restart', { skip, timeout: 300_000 }, async (t) => {
  const h = await harness(t);
  const p = await h.platform();
  const managedBefore = await h.stateOf(p.owner, undefined).catch(() => null);
  const { archive, seeded } = await h.migrationArchive();
  const app = await h.bootstrap(p);
  await h.restoreAsApp(p, app, archive);
  const appPool = h.pool(app.url);
  const env = { DATABASE_URL: app.url, CARSCOPE_DB_SCHEMA: SCHEMA };

  await t.test('the role resolves to the private schema and holds no platform power', async () => {
    assert.equal((await appPool.query('SELECT current_schema() AS s')).rows[0].s, SCHEMA);
    const checks = await inspectDatabase(appPool, { expectedSchema: SCHEMA });
    assert.deepEqual(failures(checks), []);
    for (const id of ['DB_PRIVATE_SCHEMA', 'DB_PUBLIC_HOLDS_NO_CARSCOPE', 'DB_API_ROLES_DENIED', 'DB_ROLE_ATTRIBUTES', 'DB_STARTUP_PRIVILEGE', 'DB_BASE_SCHEMA', 'DB_HISTORY_MIGRATION']) assert.equal(status(checks, id), 'PASS', id);
    assert.equal((await appPool.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') AS ok")).rows[0].ok, false, 'the temporary grant is gone');
  });

  await t.test('rows match the manifest, scoped to the private schema, read only', async () => {
    const r = await runCompare({ archive, url: app.url, schema: SCHEMA, env: {} });
    assert.deepEqual(failures(r.checks), []);
    for (const id of ['VERIFY_STRUCTURE', 'VERIFY_ROW_COUNTS', 'VERIFY_ROW_DIGESTS', 'COMPARE_DB_PRIVATE_SCHEMA', 'COMPARE_DB_API_ROLES_DENIED']) assert.equal(status(r.checks, id), 'PASS', id);
    const session = seeded.sessions[3];
    assert.deepEqual((await appPool.query('SELECT data FROM cs_sessions WHERE id=$1', [session.id])).rows[0].data, session);
    for (const record of seeded.records) assert.deepEqual((await appPool.query('SELECT original_result FROM cs_inspection_records WHERE record_id=$1', [record.id])).rows[0].original_result, record.result);
  });

  await t.test('anon, authenticated and service_role reach nothing, by real statements as each role', async () => {
    const c = await p.owner.connect();
    try {
      await h.admin.query(`GRANT anon, authenticated, service_role TO ${p.adminRole}`); // Test scaffolding, to act as each role.
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE ' + role);
        await assert.rejects(() => c.query('SELECT * FROM carscope.cs_inspection_records'), { code: '42501' }, role);
        await c.query('ROLLBACK');
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE ' + role);
        assert.equal((await c.query("SELECT to_regclass('other_app') IS NOT NULL AS ok")).rows[0].ok, true, 'control: the role does work on public');
        assert.equal((await c.query('SELECT count(*)::int AS n FROM public.other_app')).rows[0].n, 1, 'control');
        await c.query('ROLLBACK');
      }
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
    await assert.rejects(() => appPool.query('SELECT * FROM auth.users'), { code: '42501' }, 'the application cannot read a managed schema');
    await assert.rejects(() => appPool.query('CREATE TABLE auth.intruder (id INT)'), { code: '42501' });
    await assert.rejects(() => appPool.query('CREATE TABLE public.intruder (id INT)'), { code: '42501' });
    await assert.rejects(() => appPool.query('CREATE ROLE intruder'), { code: '42501' });
  });

  await t.test('real server: DENY_DEFAULT is unchanged and startup adds nothing to public', async () => {
    const before = (await p.owner.query("SELECT table_schema||'.'||table_name AS t FROM information_schema.tables WHERE table_schema IN ('public','auth','storage') ORDER BY 1")).rows;
    const server = await cli(t, env);
    assert.deepEqual(await waitHealth(server), { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    const bearer = randomBytes(32).toString('base64url');
    assert.equal((await edge(server.port, '/v1/inspection-records', { bearer })).status, 403);
    assert.equal((await edge(server.port, '/v1/sessions', { method: 'POST', bearer, body: { taskId: 'washer-fluid' } })).status, 403);
    assert.equal((await edge(server.port, '/simulator/provision', { method: 'POST', bearer, body: {} })).status, 404);
    await server.stop();
    assert.deepEqual((await p.owner.query("SELECT table_schema||'.'||table_name AS t FROM information_schema.tables WHERE table_schema IN ('public','auth','storage') ORDER BY 1")).rows, before);
    assert.equal(server.output().includes(app.password), false);
  });

  await t.test('QR v2 through the real server; the session and its record survive restarts; simulator DDL stays private', async () => {
    const registry = new AvdSimulatorCredentialStore({ pool: appPool });
    const simulator = { ...env, CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED' };
    let server = await cli(t, simulator);
    await waitHealth(server);
    const x = await qrAccept(server, registry, 'brake-fluid');
    await server.stop();
    // The result was submitted but not accepted when the server stopped.
    server = await cli(t, simulator);
    await waitHealth(server);
    const pending = await edge(server.port, `/v1/sessions/${x.created.sessionId}`, { bearer: x.created.receiverToken });
    assert.equal(pending.data.sessionState, 'RESULT_SUBMITTED');
    assert.equal((await edge(server.port, `/v1/sessions/${x.created.sessionId}/accept`, { method: 'POST', bearer: x.created.receiverToken, body: { resultDigest: 'sha256:' + '0'.repeat(64) } })).status, 409);
    assert.equal((await accept(server, x)).status, 200);
    await server.stop();
    server = await cli(t, simulator);
    await waitHealth(server);
    const after = await edge(server.port, `/v1/sessions/${x.created.sessionId}`, { bearer: x.created.receiverToken });
    assert.equal(after.data.sessionState, 'ACCEPTED');
    const row = (await appPool.query('SELECT authority_namespace,user_id,result_digest,original_result FROM carscope.cs_inspection_records WHERE inspection_id=$1', [x.result.inspectionId])).rows[0];
    assert.equal(row.authority_namespace, 'AVD_SIMULATOR');
    assert.equal(row.user_id, null);
    assert.equal(row.result_digest, x.digest);
    assert.deepEqual(row.original_result, x.result);
    assert.equal((await edge(server.port, '/v1/inspection-records', { bearer: x.created.receiverToken })).status, 403);
    await server.stop();
    const leaked = (await p.owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cs\\_%'")).rows;
    assert.deepEqual(leaked, [], 'every CarScope table, including cs_avd_*, stayed private');
  });

  await t.test('managed schemas and other tables are unchanged by the whole migration', async () => {
    assert.ok(managedBefore === null || managedBefore.tables.length >= 3);
    assert.deepEqual((await p.owner.query('SELECT (SELECT count(*)::int FROM auth.users) a,(SELECT count(*)::int FROM storage.objects) b,(SELECT count(*)::int FROM public.other_app) c')).rows[0], { a: 1, b: 1, c: 1 });
  });

  await t.test('the existing empty carscope_private schema is neither used nor changed', async () => {
    const row = (await p.owner.query(`SELECT pg_get_userbyid(n.nspowner) AS owner, (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace=n.oid) AS objects FROM pg_namespace n WHERE n.nspname='carscope_private'`)).rows[0];
    assert.deepEqual(row, { owner: p.adminRole, objects: 0 });
    for (const role of ['carscope_app', 'anon', 'authenticated', 'service_role']) assert.equal((await p.owner.query("SELECT has_schema_privilege($1,'carscope_private','USAGE') AS ok", [role])).rows[0].ok, false, role);
    await assert.rejects(() => appPool.query('CREATE TABLE carscope_private.intruder (id INT)'), { code: '42501' });
  });
});

test('S2 premise: a non-superuser database owner with CREATEROLE can run the operator SQL, and the check says so', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const p = await h.platform();
  const premise = (await p.owner.query(sql('supabase-s2-premise-check.sql'))).rows[0];
  assert.equal(premise.is_superuser, false, 'is_superuser');
  assert.equal(premise.can_create_roles, true, 'can_create_roles');
  assert.equal(premise.database_owner, p.adminRole, 'database_owner');
  assert.equal(premise.can_grant_create_on_database, true, 'can_grant_create_on_database');
  assert.equal(premise.carscope_schema_absent, true, 'carscope_schema_absent');
  assert.equal(premise.carscope_app_absent, true, 'carscope_app_absent');
  assert.equal(premise.server_major, Number(process.env.PG_MATRIX_MAJOR ?? premise.server_major));
  const before = await p.owner.query('SELECT count(*)::int AS n FROM pg_roles');

  const app = await h.bootstrap(p); // Includes setting the password, as \password does.
  const role = (await p.owner.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit,rolconfig FROM pg_roles WHERE rolname='carscope_app'")).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true, rolconnlimit: 10, rolconfig: ['search_path=carscope'] });
  assert.equal((await p.owner.query('SELECT count(*)::int AS n FROM pg_roles')).rows[0].n, before.rows[0].n + 1);
  assert.equal((await p.owner.query(sql('supabase-s2-premise-check.sql'))).rows[0].carscope_app_absent, false, 'the check notices a second run');
  const { archive } = await h.migrationArchive();
  await h.restoreAsApp(p, app, archive); // Restore as the role, then the admin revokes what it granted.
  assert.equal((await p.owner.query("SELECT has_database_privilege('carscope_app',current_database(),'CREATE') AS ok")).rows[0].ok, false);
  assert.equal((await p.owner.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='carscope'")).rows[0].owner, 'carscope_app');
});

/** One connection, because a failed script leaves its transaction open, and psql with ON_ERROR_STOP would just exit. */
async function runBootstrapAs(url) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  c.on('error', () => {});
  const notices = [];
  c.on('notice', (n) => notices.push(n.message));
  await c.connect();
  try {
    await c.query(sql('supabase-bootstrap.sql'));
    return { error: null, notices };
  } catch (error) {
    return { error, notices };
  } finally {
    await c.end().catch(() => {});
  }
}

for (const [name, attributes, grant, expected] of [
  ['CREATEROLE and CREATE on the database, but no grant option: PostgreSQL only warns, so the script must raise', 'LOGIN CREATEROLE', 'CREATE', 'P0001'],
  ['CREATEROLE and only the PUBLIC rights on the database: also just a warning, so the script must raise', 'LOGIN CREATEROLE', null, 'P0001'],
  ['no CREATEROLE', 'LOGIN', 'CREATE', '42501'],
]) {
  test(`S2 premise not met, ${name}: stops and leaves nothing`, { skip, timeout: 60_000 }, async (t) => {
    const h = await harness(t);
    await h.admin.query('DROP ROLE IF EXISTS carscope_app').catch(() => {});
    const db = await h.database('premise');
    const adminRole = 'cs_premise_' + randomBytes(4).toString('hex'), password = randomBytes(18).toString('hex');
    await h.admin.query(`CREATE ROLE ${adminRole} ${attributes} PASSWORD '${password}'`);
    t.after(async () => { await h.admin.query(`DROP OWNED BY ${adminRole} CASCADE`).catch(() => {}); await h.admin.query(`DROP ROLE IF EXISTS ${adminRole}`).catch(() => {}); });
    if (grant) await h.admin.query(`GRANT ${grant} ON DATABASE ${db.name} TO ${adminRole}`);
    const url = h.urlAs(adminRole, password, db.name);
    const r = await runBootstrapAs(url);
    assert.equal(r.error?.code, expected);
    assert.equal((await h.admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='carscope_app'")).rows[0].n, 0, 'the role creation rolled back');
    const premise = (await h.pool(url).query(sql('supabase-s2-premise-check.sql'))).rows[0];
    assert.equal(premise.can_grant_create_on_database, false, 'the check reports this before anything runs');
    assert.equal(premise.is_superuser, false);
  });
}

test('fail closed on the wrong search_path: nothing lands in public, and the guard is what stops it', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const p = await h.platform();
  const app = await h.bootstrap(p);
  await p.owner.query('ALTER ROLE carscope_app RESET search_path');
  await p.owner.query('GRANT CREATE ON SCHEMA public TO carscope_app');
  const cs = async () => (await p.owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cs\\_%'")).rows.length;

  const refused = await cli(t, { DATABASE_URL: app.url, CARSCOPE_DB_SCHEMA: SCHEMA });
  assert.equal(await refused.exited(), 1);
  assert.equal(refused.output().trim(), 'RENDER_STATEFUL_CONFIGURATION_FAILED');
  assert.equal(await cs(), 0, 'the guard stopped the DDL');

  // Control: the same role with no expected schema does create tables in public, and the API roles can then read them.
  const appPool = h.pool(app.url);
  await PostgreSQLSessionStore.open({ pool: appPool });
  assert.ok(await cs() > 0, 'control: the risk is real without the guard');
  const checks = await inspectDatabase(appPool, { expectedSchema: SCHEMA });
  assert.equal(status(checks, 'DB_PUBLIC_HOLDS_NO_CARSCOPE'), 'FAIL', 'the read-only gate reports it');
  assert.equal(status(checks, 'DB_PRIVATE_SCHEMA'), 'FAIL');
});

test('the private-schema gates fail when the condition is really broken', { skip, timeout: 180_000 }, async (t) => {
  const h = await harness(t);
  const p = await h.platform();
  const { archive } = await h.migrationArchive();
  const app = await h.bootstrap(p);
  await h.restoreAsApp(p, app, archive);
  const appPool = h.pool(app.url);
  const gates = (pool, options = {}) => inspectDatabase(pool, { expectedSchema: SCHEMA, ...options });
  assert.equal(status(await gates(appPool), 'DB_API_ROLES_DENIED'), 'PASS', 'control');

  await t.test('a schema grant to any API role fails, and revoking it restores the pass', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await appPool.query('GRANT USAGE ON SCHEMA carscope TO ' + role);
      const denied = (await gates(appPool)).find((c) => c.id === 'DB_API_ROLES_DENIED');
      assert.equal(denied.status, 'FAIL', role);
      assert.match(denied.detail, new RegExp(role));
      await appPool.query('REVOKE USAGE ON SCHEMA carscope FROM ' + role);
    }
    assert.equal(status(await gates(appPool), 'DB_API_ROLES_DENIED'), 'PASS');
  });

  await t.test('a table grant alone fails too', async () => {
    await appPool.query('GRANT SELECT ON carscope.cs_inspection_records TO anon');
    assert.equal(status(await gates(appPool), 'DB_API_ROLES_DENIED'), 'FAIL');
    await appPool.query('REVOKE SELECT ON carscope.cs_inspection_records FROM anon');
  });

  await t.test('a role with platform powers fails', async () => {
    const superuser = h.pool(rehearsalUrl(uri, p.name), { options: '-c search_path=carscope' });
    const attributes = (await gates(superuser)).find((c) => c.id === 'DB_ROLE_ATTRIBUTES');
    assert.equal(attributes.status, 'FAIL');
    assert.match(attributes.detail, /rolsuper/);
  });

  await t.test('plaintext is MANUAL when TLS is not demanded, and FAIL when it is', async () => {
    assert.equal(status(await gates(appPool), 'DB_TLS_IN_USE'), 'MANUAL');
    assert.equal(status(await gates(appPool, { requireTls: true }), 'DB_TLS_IN_USE'), 'FAIL');
  });

  await t.test('compare notices one changed row in the private schema', async () => {
    await appPool.query('UPDATE carscope.cs_rate_windows SET count=count+1 WHERE count=7');
    const r = await runCompare({ archive, url: app.url, schema: SCHEMA, env: {} });
    assert.equal(status(r.checks, 'VERIFY_ROW_DIGESTS'), 'FAIL');
    await appPool.query('UPDATE carscope.cs_rate_windows SET count=count-1 WHERE count=8');
    assert.equal(status((await runCompare({ archive, url: app.url, schema: SCHEMA, env: {} })).checks, 'VERIFY_ROW_DIGESTS'), 'PASS');
  });

  await t.test('compare writes nothing, even to the rate table a service keeps changing', async () => {
    const before = await h.stateOf(appPool, { schema: SCHEMA });
    await runCompare({ archive, url: app.url, schema: SCHEMA, env: {} });
    assert.deepEqual(await h.stateOf(appPool, { schema: SCHEMA }), before);
  });
});

test('a schema that drifts after startup turns health to 503 instead of serving from the wrong place', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const p = await h.platform();
  const { archive } = await h.migrationArchive();
  const app = await h.bootstrap(p);
  await h.restoreAsApp(p, app, archive);
  const server = await cli(t, { DATABASE_URL: app.url, CARSCOPE_DB_SCHEMA: SCHEMA });
  await waitHealth(server);
  await p.owner.query('ALTER ROLE carscope_app RESET search_path');
  // Idle connections leave the pool after 10 seconds; a new one carries the changed role setting.
  await sleep(11_000);
  const drifted = await waitHealth(server, 503);
  assert.deepEqual(drifted, { status: 'UNAVAILABLE' });
  await p.owner.query('ALTER ROLE carscope_app SET search_path = carscope');
  await sleep(11_000);
  await waitHealth(server, 200);
});

test('relocate refuses foreign tables and a second run, and changes nothing when it refuses', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const db = await h.database('copy');
  const p = h.pool(db.url);
  await applyCarScopeSchema(p);
  await seedSyntheticData(p);
  await p.query('CREATE TABLE other_app (id INT)');
  const before = await h.stateOf(p);
  const r = await runRelocate({ url: db.url, schema: SCHEMA, env: {} });
  assert.match(r.checks.find((c) => c.id === 'RELOCATE_APPLY').detail, /PUBLIC_HOLDS_OTHER_TABLES/);
  assert.deepEqual(await h.stateOf(p), before);
  await p.query('DROP TABLE other_app');
  assert.equal(status((await runRelocate({ url: db.url, schema: SCHEMA, env: {} })).checks, 'RELOCATE_APPLY'), 'PASS');
  const again = await runRelocate({ url: db.url, schema: SCHEMA, env: {} });
  assert.match(again.checks.find((c) => c.id === 'RELOCATE_APPLY').detail, /NO_CARSCOPE_TABLES/);
});

test('the relocated copy passes the existing verify, including the migration under the private schema', { skip, timeout: 180_000 }, async (t) => {
  const h = await harness(t);
  const { archive } = await h.migrationArchive();
  const target = await h.database('target');
  assert.deepEqual(failures((await runRestore({ archive, url: target.url, client, env: {} })).checks), []);
  const v = await runVerify({ archive, url: target.url, schema: SCHEMA, startupDdl: true, env: {} });
  assert.deepEqual(failures(v.checks), []);
  assert.equal(status(v.checks, 'VERIFY_STARTUP_DDL'), 'PASS');
  assert.equal(recoveryVerdict(v.checks, v.manifest.scope), 'LOCAL_BACKUP_RESTORE_PASS');
  const leaked = (await h.pool(target.url).query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
  assert.deepEqual(leaked, [], 'the rehearsal migration used the private schema');
});

test('TLS: a pinned CA verifies chain and hostname, and the server refuses this role in plaintext', { skip: tlsSkip, timeout: 120_000 }, async (t) => {
  const tlsUrl = process.env.PG_TLS_TEST_URL, byIp = process.env.PG_TLS_TEST_URL_BY_IP, ca = process.env.PG_TLS_TEST_CA, wrong = process.env.PG_TLS_TEST_WRONG_CA;
  const boot = (url, extra = {}) => cli(t, { DATABASE_URL: url, ...extra });

  await t.test('right CA and hostname: the real server starts, and PostgreSQL reports TLS', async () => {
    const server = await boot(tlsUrl, { CARSCOPE_DB_CA_PEM_BASE64: ca });
    assert.deepEqual(await waitHealth(server), { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    await server.stop();
    const checks = await inspectDatabaseUrl({ url: tlsUrl, env: {}, caPemBase64: ca });
    assert.equal(status(checks, 'DB_CONNECT'), 'PASS');
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: tlsUrl, ssl: { ca: Buffer.from(ca, 'base64').toString(), rejectUnauthorized: true } });
    await c.connect();
    assert.equal((await c.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl, true);
    await c.end();
  });

  for (const [name, url, extra] of [
    ['wrong CA', tlsUrl, { CARSCOPE_DB_CA_PEM_BASE64: wrong }],
    ['hostname not in the certificate', byIp, { CARSCOPE_DB_CA_PEM_BASE64: ca }],
    ['no CA, so plaintext, which the server refuses', tlsUrl, {}],
  ]) {
    await t.test(`${name}: exit 1 with one sanitized line`, async () => {
      const server = await boot(url, extra);
      assert.equal(await server.exited(), 1);
      assert.equal(server.output().trim(), 'RENDER_STATEFUL_CONFIGURATION_FAILED');
    });
  }
  await t.test('read-only inspection and compare refuse an unverifiable server too', async () => {
    const wrongCa = await inspectDatabaseUrl({ url: tlsUrl, env: {}, caPemBase64: wrong });
    assert.equal(status(wrongCa, 'DB_CONNECT'), 'BLOCKED');
    assert.equal((await inspectDatabaseUrl({ url: tlsUrl + '?sslmode=disable', env: {}, caPemBase64: ca }))[0].detail, 'DATABASE_URL_QUERY_REFUSED');
  });
});

test('outage: fail closed, no fallback, recovery without restart, data intact', { skip: outageSkip, timeout: 240_000 }, async (t) => {
  const h = await harness(t);
  const container = process.env.PG_MATRIX_CONTAINER;
  const docker = (...args) => { const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0); };
  const p = await h.platform();
  const { archive } = await h.migrationArchive();
  const app = await h.bootstrap(p);
  await h.restoreAsApp(p, app, archive);
  const env = { DATABASE_URL: app.url, CARSCOPE_DB_SCHEMA: SCHEMA, CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED' };
  const appPool = h.pool(app.url);
  const registry = new AvdSimulatorCredentialStore({ pool: appPool });
  const server = await cli(t, env);
  await waitHealth(server);
  const x = await qrAccept(server, registry, 'washer-fluid');
  const before = await h.stateOf(appPool, { schema: SCHEMA });
  try {
    docker('stop', '-t', '5', container);
    assert.deepEqual(await waitHealth(server, 503), { status: 'UNAVAILABLE' });
    assert.equal(server.alive(), true, 'the process survives and reports');
    const during = await edge(server.port, `/v1/sessions/${x.created.sessionId}`, { bearer: x.created.receiverToken }).catch(() => null);
    assert.ok(during === null || during.status >= 500, 'no answer from anywhere else while the database is down');
    const cold = await cli(t, env);
    assert.equal(await cold.exited(), 1, 'a new instance refuses to start without its database');
    assert.equal(cold.output().trim(), 'RENDER_STATEFUL_CONFIGURATION_FAILED');
  } finally {
    docker('start', container);
  }
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'carscope_rehearsal'], { windowsHide: true }).status === 0) break;
    await sleep(1000);
  }
  await waitHealth(server, 200);
  assert.equal(server.alive(), true);
  const after = await edge(server.port, `/v1/sessions/${x.created.sessionId}`, { bearer: x.created.receiverToken });
  assert.equal(after.data.sessionState, 'RESULT_SUBMITTED', 'the session outlived the outage');
  assert.equal((await accept(server, x)).status, 200, 'and it can still finish');
  const state = await h.stateOf(h.pool(app.url), { schema: SCHEMA });
  const records = (t2) => t2.tables.find((r) => r.name === 'cs_inspection_records');
  assert.equal(records(state).rows, records(before).rows + 1);
});

test('a backend killed in the middle of a transaction rejects that call and leaves the process and pool working', { skip, timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  const db = await h.database('kill');
  const p = h.pool(db.url, { max: 2 });
  const store = await PostgreSQLSessionStore.open({ pool: p });
  const id = 'session-' + unique();
  assert.equal(await store.insert({ id, state: 'CREATED' }), true);
  const holder = h.pool(db.url, { max: 1 });
  const lock = await holder.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT 1 FROM cs_sessions WHERE id=$1 FOR UPDATE', [id]);
  let uncaught = null;
  const onUncaught = (error) => { uncaught = error; };
  process.on('uncaughtException', onUncaught);
  t.after(() => process.removeListener('uncaughtException', onUncaught));
  const pending = store.update(id, (s) => ({ ...s, state: 'CLAIMED' }));
  let killed = 0;
  for (let i = 0; i < 100 && !killed; i++) {
    await sleep(50);
    killed = (await h.admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'", [db.name])).rowCount;
  }
  assert.equal(killed, 1, 'the waiting backend was terminated');
  await assert.rejects(pending);
  await lock.query('ROLLBACK');
  lock.release();
  await sleep(200);
  assert.equal(uncaught, null, 'a lost connection must not become an uncaught event');
  assert.equal((await store.get(id)).state, 'CREATED', 'the interrupted change did not apply');
  assert.equal((await store.update(id, (s) => ({ ...s, state: 'CLAIMED' }))).state, 'CLAIMED', 'the pool recovered');

  // The simulator registry has its own transaction path.
  const registry = new AvdSimulatorCredentialStore({ pool: p });
  await registry.initialize();
  const { registrationId } = await registry.register({ label: 'kill-test', ttlMs: 3_600_000 });
  const lock2 = await holder.connect();
  await lock2.query('BEGIN');
  await lock2.query('SELECT 1 FROM cs_avd_registrations WHERE id=$1 FOR UPDATE', [registrationId]);
  const revoking = registry.revoke({ registrationId });
  killed = 0;
  for (let i = 0; i < 100 && !killed; i++) {
    await sleep(50);
    killed = (await h.admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'", [db.name])).rowCount;
  }
  assert.equal(killed, 1);
  await assert.rejects(revoking);
  await lock2.query('ROLLBACK');
  lock2.release();
  await sleep(200);
  assert.equal(uncaught, null, 'the same for the simulator registry');
  assert.equal(await registry.revoke({ registrationId }), true, 'and its pool recovered');
});

test('cross-version restore: a PostgreSQL 16 source reaches a PostgreSQL 17 target with identical rows', { skip: crossSkip, timeout: 180_000 }, async (t) => {
  const h = await harness(t);
  const sourceUrl = process.env.PG_CROSS_SOURCE_URL;
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: sourceUrl });
  await admin.connect();
  const name = `carscope_rehearsal_${unique()}_src16`;
  await admin.query(`CREATE DATABASE ${name}`);
  t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {}); await admin.end(); });
  const url = rehearsalUrl(sourceUrl, name);
  const p = h.pool(url);
  await applyCarScopeSchema(p);
  const seeded = await seedSyntheticData(p);
  const source16 = dockerClient({ image: process.env.PG_CROSS_SOURCE_IMAGE });
  const archive = join(h.dir, 'cross.dump');
  const backed = await runBackup({ url, out: archive, client: source16, env: {} });
  assert.deepEqual(failures(backed.checks), []);
  assert.equal(backed.manifest.sourceServer.major, 16);
  const target = await h.database('target');
  const major = Number((await h.admin.query("SELECT current_setting('server_version_num')::int/10000 AS m")).rows[0].m);
  assert.equal(major, 17, 'this test only means something across versions');
  const restored = await runRestore({ archive, url: target.url, client, env: {} });
  assert.deepEqual(failures(restored.checks), []);
  const v = await runVerify({ archive, url: target.url, startupDdl: true, env: {} });
  assert.deepEqual(failures(v.checks), []);
  assert.equal(status(v.checks, 'VERIFY_ROW_DIGESTS'), 'PASS');
  assert.equal(status(v.checks, 'VERIFY_STRUCTURE'), 'PASS');
  assert.deepEqual((await h.pool(target.url).query('SELECT data FROM cs_sessions WHERE id=$1', [seeded.sessions[0].id])).rows[0].data, seeded.sessions[0]);
  // The other direction: a 17 client's archive is refused by a 16 client, without touching the target.
  const newer = join(h.dir, 'newer.dump');
  assert.deepEqual(failures((await runBackup({ url: target.url, out: newer, client, env: {} })).checks), []);
  const empty = await h.database('target');
  const refused = await runRestore({ archive: newer, url: empty.url, client: source16, env: {} });
  assert.ok(failures(refused.checks).length > 0, 'a 16 client cannot read a 17 archive');
  assert.equal((await h.pool(empty.url).query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
});
