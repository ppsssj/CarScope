// Real pg_dump and pg_restore against a real server, on disposable loopback databases with synthetic rows only.
// Requires PG_TEST_URL (a loopback role with CREATEDB and CREATEROLE) and a client: PG_CLIENT_BIN, PG_CLIENT_DOCKER_IMAGE or PATH.
// Without them this suite is skipped, which is NOT_RUN and never a pass. PG_RECOVERY_REQUIRED=1 turns a missing client into a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolatedTestDatabase, inspectDatabase } from '../preflight/database.mjs';
import {
  captureState, clientVersions, dockerClient, inspectArchive, nativeClient, openClient, parseConnection, recoveryVerdict, runBackup, runRestore, runVerify, sha256File,
} from '../preflight/recovery.mjs';
import { reportPayload } from '../bin/db-recovery.mjs';
import { applyCarScopeSchema, createIsolated, rehearsalUrl, seedSyntheticData } from '../preflight/recovery-seed.mjs';
import { runRenderGates } from '../preflight/render-gates.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';

const uri = process.env.PG_TEST_URL;
const client = process.env.PG_CLIENT_DOCKER_IMAGE ? dockerClient({ image: process.env.PG_CLIENT_DOCKER_IMAGE }) : nativeClient({ binDir: process.env.PG_CLIENT_BIN });
const clientReady = uri ? (await clientVersions(client)).pg_dump !== null : false;
if (uri && !clientReady && process.env.PG_RECOVERY_REQUIRED === '1') throw new Error('PG_RECOVERY_REQUIRED but no PostgreSQL client tools were found');
const skip = !uri ? 'PG_TEST_URL absent: recovery rehearsal NOT_RUN' : !clientReady ? 'pg_dump absent: recovery rehearsal NOT_RUN' : false;

const ENTRY = fileURLToPath(new URL('../src/render-stateful.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../bin/db-recovery.mjs', import.meta.url));
const PUBLIC_ORIGIN = 'https://recovery-test.onrender.com';
const status = (checks, id) => checks.find((c) => c.id === id)?.status;
const detail = (checks, id) => checks.find((c) => c.id === id)?.detail;
const failures = (checks) => checks.filter((c) => c.status === 'FAIL').map((c) => c.id);
const unique = () => 'p' + randomBytes(6).toString('hex');

/** Fixtures for one test: every database and role it makes is dropped afterwards, and only on a loopback server. */
async function harness(t) {
  assertIsolatedTestDatabase(uri);
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 10_000 });
  admin.on('error', () => {});
  await admin.connect();
  const databases = [], roles = [], pools = [];
  const dir = mkdtempSync(join(tmpdir(), 'carscope-recovery-pg-'));
  const pool = (url, max = 2) => {
    const p = new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 10_000 });
    p.on('error', () => {});
    pools.push(p);
    return p;
  };
  const database = async (suffix = 'db') => {
    const name = `carscope_rehearsal_${unique()}_${suffix}`;
    assert.match(name, /^carscope_rehearsal_[a-z0-9_]+$/);
    await admin.query(`CREATE DATABASE ${name}`);
    databases.push(name);
    return { name, url: rehearsalUrl(uri, name) };
  };
  const role = async (extra = '') => {
    const name = 'cs_recovery_' + randomBytes(6).toString('hex'), password = randomBytes(18).toString('hex');
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' ${extra}`);
    roles.push(name);
    const urlFor = (databaseName) => { const u = new URL(rehearsalUrl(uri, databaseName)); u.username = name; u.password = password; return u.href; };
    return { name, password, urlFor };
  };
  t.after(async () => {
    await Promise.allSettled(pools.map((p) => p.end()));
    for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    for (const name of roles) await admin.query(`DROP ROLE IF EXISTS ${name}`).catch(() => {});
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  });
  /** A source with all three schema files and synthetic rows. */
  const source = async () => {
    const db = await database('source');
    const p = pool(db.url);
    await applyCarScopeSchema(p);
    const seeded = await seedSyntheticData(p);
    return { ...db, pool: p, seeded };
  };
  const stateOf = async (p) => {
    const c = await p.connect();
    try {
      await c.query('BEGIN TRANSACTION READ ONLY');
      return await captureState(c);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  };
  const backup = async (url, name = 'carscope.dump') => {
    const out = join(dir, unique() + '-' + name);
    const r = await runBackup({ url, out, client, env: {} });
    return { ...r, out };
  };
  const relationCount = async (p) => Number((await p.query("SELECT count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname NOT IN ('pg_catalog','information_schema') AND s.nspname NOT LIKE 'pg\\_%'")).rows[0].n);
  return { admin, dir, pool, database, role, source, stateOf, backup, relationCount };
}

test('full rehearsal: backup, inspect, restore, compare, then the application reads the copy', { skip, timeout: 240_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const target = await h.database('target');
  const targetPool = h.pool(target.url, 4);
  let backup, sourceState;

  await t.test('backup writes the archive, its digest and a manifest with no connection details', async () => {
    sourceState = await h.stateOf(src.pool);
    backup = await h.backup(src.url);
    assert.deepEqual(failures(backup.checks), []);
    assert.equal(status(backup.checks, 'BACKUP_READ_ONLY'), 'PASS');
    assert.equal(status(backup.checks, 'BACKUP_VERSION_COMPATIBILITY'), 'PASS');
    const { sha256 } = backup.checks.find((c) => c.id === 'BACKUP_ARCHIVE');
    assert.equal(await sha256File(backup.out), sha256);
    assert.ok(readFileSync(backup.out + '.sha256', 'utf8').startsWith(sha256 + '  '));
    assert.equal(readdirSync(h.dir).some((f) => f.endsWith('.partial')), false);
    const text = readFileSync(backup.out + '.manifest.json', 'utf8');
    const { host, user, password, database } = parseConnection(src.url);
    for (const value of [password, database, user, host]) assert.equal(text.includes(value), false, 'manifest leaks a connection detail');
    assert.deepEqual(JSON.parse(text).tables, sourceState.tables);
    assert.equal(JSON.parse(text).scope, 'ISOLATED_LOOPBACK');
  });

  await t.test('the archive holds rows, constraints and indexes of all CarScope tables', async () => {
    const r = await inspectArchive({ archive: backup.out, client });
    assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [['ARCHIVE_SHA256', 'PASS'], ['ARCHIVE_LIST', 'PASS']]);
    assert.equal(r.list.format, 'CUSTOM');
    assert.equal(r.list.dumpedFromMajor, Number((await src.pool.query("SELECT current_setting('server_version_num')::int/10000 AS m")).rows[0].m));
    for (const table of ['cs_schema_meta', 'cs_sessions', 'cs_session_tokens', 'cs_rate_windows', 'cs_history_schema_meta', 'cs_inspection_records', 'cs_avd_auth_meta', 'cs_avd_registrations', 'cs_avd_creation_grants']) {
      assert.ok(r.list.tableData.includes('public.' + table), table);
    }
    assert.ok(r.list.indexes >= 5);
    assert.ok(r.list.constraints >= 9);
  });

  await t.test('restore fills the separate database and leaves the source unchanged', async () => {
    const r = await runRestore({ archive: backup.out, url: target.url, client, env: {} });
    assert.deepEqual(failures(r.checks), []);
    assert.equal(status(r.checks, 'RESTORE_APPLY'), 'PASS');
    assert.deepEqual(await h.stateOf(src.pool), sourceState);
  });

  await t.test('verify: structure, counts and digests match, and the schema inspection is clean', async () => {
    const r = await runVerify({ archive: backup.out, url: target.url, env: {} });
    assert.deepEqual(failures(r.checks), []);
    for (const id of ['VERIFY_STRUCTURE', 'VERIFY_ROW_COUNTS', 'VERIFY_ROW_DIGESTS', 'VERIFY_DB_BASE_SCHEMA', 'VERIFY_DB_HISTORY_MIGRATION', 'VERIFY_DB_HISTORY_COLUMNS', 'VERIFY_DB_STARTUP_PRIVILEGE']) assert.equal(status(r.checks, id), 'PASS', id);
    assert.equal(status(r.checks, 'VERIFY_STARTUP_DDL'), 'NOT_RUN');
    assert.equal(recoveryVerdict(r.checks, r.manifest.scope), 'RECOVERY_NOT_VERIFIED', 'a verify without the migration is not a finished rehearsal');
    const expected = { cs_sessions: 5, cs_session_tokens: 5, cs_rate_windows: 3, cs_inspection_records: 17, cs_avd_registrations: 1, cs_avd_creation_grants: 1, cs_schema_meta: 1, cs_history_schema_meta: 1, cs_avd_auth_meta: 1 };
    const counts = Object.fromEntries((await h.stateOf(targetPool)).tables.map((t) => [t.name, t.rows]));
    assert.deepEqual(counts, expected);
  });

  await t.test('session and inspection rows are preserved value for value', async () => {
    for (const session of src.seeded.sessions) assert.deepEqual((await targetPool.query('SELECT data FROM cs_sessions WHERE id=$1', [session.id])).rows[0].data, session);
    for (const record of src.seeded.records) {
      const row = (await targetPool.query('SELECT task_id,original_result FROM cs_inspection_records WHERE record_id=$1', [record.id])).rows[0];
      assert.equal(row.task_id, record.task);
      assert.deepEqual(row.original_result, record.result);
    }
    const label = (await targetPool.query('SELECT label FROM cs_avd_registrations')).rows[0].label;
    assert.equal(label, '합성 리허설 등록', 'non-ASCII text survives');
  });

  await t.test('restored constraints still reject bad rows', async () => {
    const hash = 'f'.repeat(64);
    await assert.rejects(() => targetPool.query("INSERT INTO cs_session_tokens(hash,kind,session_id) VALUES($1,'receiver','missing')", [hash]), { code: '23503' }, 'FK');
    await assert.rejects(() => targetPool.query("INSERT INTO cs_session_tokens(hash,kind,session_id) VALUES('short','receiver',$1)", [src.seeded.sessions[0].id]), { code: '23514' }, 'CHECK');
    await assert.rejects(() => targetPool.query('INSERT INTO cs_schema_meta(id,version) VALUES(1,1)'), { code: '23505' }, 'PK');
    await assert.rejects(() => targetPool.query('UPDATE cs_schema_meta SET version=0'), { code: '23514' });
    assert.equal(Number((await targetPool.query('DELETE FROM cs_sessions WHERE id=$1', [src.seeded.sessions[4].id])).rowCount), 1);
    assert.equal(Number((await targetPool.query('SELECT count(*) n FROM cs_session_tokens WHERE session_id=$1', [src.seeded.sessions[4].id])).rows[0].n), 0, 'ON DELETE CASCADE restored');
    assert.equal(Number((await targetPool.query('SELECT count(*) n FROM cs_inspection_records')).rows[0].n), 17, 'History has no foreign key to sessions');
  });

  await t.test('a damaged copy is detected: verify is not vacuous', async () => {
    const r = await runVerify({ archive: backup.out, url: target.url, env: {} });
    assert.equal(status(r.checks, 'VERIFY_ROW_COUNTS'), 'FAIL', 'the row deleted above');
    await targetPool.query('DELETE FROM cs_sessions');
    const restoredAgain = await h.database('target');
    assert.deepEqual(failures((await runRestore({ archive: backup.out, url: restoredAgain.url, client, env: {} })).checks), []);
    const copy = h.pool(restoredAgain.url);
    await copy.query("UPDATE cs_rate_windows SET count=count+1 WHERE count=7");
    const edited = await runVerify({ archive: backup.out, url: restoredAgain.url, env: {} });
    assert.equal(status(edited.checks, 'VERIFY_ROW_COUNTS'), 'PASS');
    assert.equal(status(edited.checks, 'VERIFY_ROW_DIGESTS'), 'FAIL');
    assert.match(detail(edited.checks, 'VERIFY_ROW_DIGESTS'), /cs_rate_windows/);
    await copy.query('UPDATE cs_rate_windows SET count=count-1 WHERE count=8');
    await copy.query('ALTER TABLE cs_session_tokens DROP CONSTRAINT cs_session_tokens_session_id_fkey');
    const dropped = await runVerify({ archive: backup.out, url: restoredAgain.url, startupDdl: true, env: {} });
    assert.equal(status(dropped.checks, 'VERIFY_STRUCTURE'), 'FAIL');
    assert.match(detail(dropped.checks, 'VERIFY_STRUCTURE'), /constraints/);
    assert.equal(status(dropped.checks, 'VERIFY_STARTUP_DDL'), 'NOT_RUN', 'a failed copy is not migrated');
  });

  await t.test('the real server starts on a fresh copy in DENY_DEFAULT and the store reads the sessions', async () => {
    const copy = await h.database('target');
    assert.deepEqual(failures((await runRestore({ archive: backup.out, url: copy.url, client, env: {} })).checks), []);
    const verified = await runVerify({ archive: backup.out, url: copy.url, startupDdl: true, env: {} });
    assert.deepEqual(failures(verified.checks), []);
    assert.equal(status(verified.checks, 'VERIFY_STARTUP_DDL'), 'PASS');
    assert.equal(recoveryVerdict(verified.checks, verified.manifest.scope), 'LOCAL_BACKUP_RESTORE_PASS');

    const store = await PostgreSQLSessionStore.open({ pool: h.pool(copy.url) });
    const session = await store.get(src.seeded.sessions[3].id);
    assert.equal(session.state, 'ACCEPTED');
    assert.equal(session.note, '합성 세션 3');

    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
    });
    const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const child = spawn(process.execPath, [ENTRY], { env: { ...platform, RENDER: 'true', RENDER_EXTERNAL_URL: PUBLIC_ORIGIN, PORT: String(port), DATABASE_URL: copy.url }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const closed = new Promise((resolve) => child.once('close', resolve));
    t.after(async () => { child.kill(); await closed; });
    const request = (path) => new Promise((resolve, reject) => {
      const q = http.request({ host: '127.0.0.1', port, path, headers: { Host: new URL(PUBLIC_ORIGIN).host, 'X-Forwarded-Proto': 'https' } }, (r) => {
        let body = '';
        r.on('data', (x) => (body += x));
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      q.on('error', reject);
      q.end();
    });
    let health = null;
    for (let i = 0; i < 100 && health?.status !== 200; i++) {
      health = await request('/healthz').catch(() => null);
      if (health?.status !== 200) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(health?.status, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    assert.equal((await request('/v1/inspection-records')).status, 403);
    child.kill();
    await closed;
  });

  await t.test('source survives the whole sequence', async () => {
    assert.deepEqual(await h.stateOf(src.pool), sourceState);
  });
});

test('source owners and grants are not carried: the restoring role owns the copy, and no other role gains access', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const reader = await h.role();
  await src.pool.query(`GRANT USAGE ON SCHEMA public TO ${reader.name}`);
  await src.pool.query(`GRANT SELECT ON cs_sessions TO ${reader.name}`);
  const { out } = await h.backup(src.url);
  const target = await h.database('target');
  const restorer = await h.role();
  const owner = h.pool(target.url);
  await owner.query(`GRANT CREATE ON SCHEMA public TO ${restorer.name}`);
  const r = await runRestore({ archive: out, url: restorer.urlFor(target.name), client, env: {} });
  assert.deepEqual(failures(r.checks), [], 'a non-superuser without the source owner role can restore');
  const row = (await owner.query("SELECT pg_get_userbyid(relowner) AS owner, has_table_privilege($1,'cs_sessions','SELECT') AS granted FROM pg_class WHERE oid='cs_sessions'::regclass", [reader.name])).rows[0];
  assert.equal(row.owner, restorer.name);
  assert.equal(row.granted, false);
  const verified = await runVerify({ archive: out, url: restorer.urlFor(target.name), startupDdl: true, env: {} });
  assert.deepEqual(failures(verified.checks), []);
  assert.equal(status(verified.checks, 'VERIFY_DB_STARTUP_PRIVILEGE'), 'PASS', 'the copy can be started by the role that restored it');
  assert.equal(status(verified.checks, 'VERIFY_STARTUP_DDL'), 'PASS');
  await owner.query(`DROP OWNED BY ${restorer.name} CASCADE`);
  await src.pool.query(`REVOKE ALL ON cs_sessions FROM ${reader.name}`);
  await src.pool.query(`REVOKE ALL ON SCHEMA public FROM ${reader.name}`);
});

test('a target that is not empty, or a repeated restore, is refused and left unchanged', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const { out } = await h.backup(src.url);
  const target = await h.database('target');
  const p = h.pool(target.url);
  assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
  const before = await h.stateOf(p);
  const again = await runRestore({ archive: out, url: target.url, client, env: {} });
  assert.equal(status(again.checks, 'RESTORE_TARGET_EMPTY'), 'FAIL');
  assert.equal(status(again.checks, 'RESTORE_APPLY'), undefined, 'pg_restore never ran');
  assert.deepEqual(await h.stateOf(p), before);

  for (const seed of ['CREATE TABLE unrelated (id INT)', 'CREATE SCHEMA unrelated', 'CREATE SEQUENCE unrelated', "CREATE FUNCTION unrelated() RETURNS int LANGUAGE sql AS 'SELECT 1'"]) {
    const other = await h.database('target');
    await h.pool(other.url).query(seed);
    const r = await runRestore({ archive: out, url: other.url, client, env: {} });
    assert.equal(status(r.checks, 'RESTORE_TARGET_EMPTY'), 'FAIL', seed);
    assert.equal(status(r.checks, 'RESTORE_APPLY'), undefined, seed);
  }
  const named = await h.database('target');
  const sameAsSource = await runRestore({ archive: out, url: src.url, client, env: {} });
  assert.equal(status(sameAsSource.checks, 'RESTORE_TARGET_EMPTY'), 'FAIL', 'the source can never be a restore target');
  const service = await runRestore({ archive: out, url: named.url, client, env: { DATABASE_URL: named.url } });
  assert.equal(detail(service.checks, 'RESTORE_TARGET_POLICY'), 'TARGET_IS_SERVICE_DATABASE');
  assert.equal(await h.relationCount(h.pool(named.url)), 0);
});

test('damaged archives never change the target or the source', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const sourceState = await h.stateOf(src.pool);
  const { out } = await h.backup(src.url);
  const size = statSync(out).size;
  const metadata = (path) => {
    copyFileSync(out + '.manifest.json', path + '.manifest.json');
    copyFileSync(out + '.sha256', path + '.sha256');
  };
  const refresh = async (path) => {
    const sha = await sha256File(path);
    writeFileSync(path + '.sha256', `${sha}  x\n`);
    const manifest = JSON.parse(readFileSync(out + '.manifest.json', 'utf8'));
    manifest.archive.sha256 = sha;
    writeFileSync(path + '.manifest.json', JSON.stringify(manifest));
  };
  const target = await h.database('target');
  const p = h.pool(target.url);
  const cases = {
    truncated: (path) => truncateSync(path, Math.floor(size / 2)),
    corrupted: (path) => { const b = readFileSync(path); b.fill(0x41, Math.floor(size / 2), Math.floor(size / 2) + 64); writeFileSync(path, b); },
    garbage: (path) => writeFileSync(path, randomBytes(4096)),
  };

  for (const [name, damage] of Object.entries(cases)) {
    await t.test(`${name}, digest recorded for the good file: stopped by SHA-256 before the server is touched`, async () => {
      const path = join(h.dir, name + '-stale.dump');
      copyFileSync(out, path);
      metadata(path);
      damage(path);
      const r = await runRestore({ archive: path, url: target.url, client, env: {} });
      assert.equal(status(r.checks, 'ARCHIVE_SHA256'), 'FAIL');
      assert.equal(status(r.checks, 'RESTORE_APPLY'), undefined);
      assert.equal(await h.relationCount(p), 0);
    });
    await t.test(`${name}, digest recomputed by an attacker or a bad copy: pg_restore fails and the transaction rolls back`, async () => {
      const path = join(h.dir, name + '-fresh.dump');
      copyFileSync(out, path);
      damage(path);
      await refresh(path);
      const r = await runRestore({ archive: path, url: target.url, client, env: {} });
      assert.ok(failures(r.checks).length > 0, 'a damaged archive must not pass');
      assert.notEqual(status(r.checks, 'RESTORE_APPLY'), 'PASS');
      assert.equal(await h.relationCount(p), 0, 'target is still empty');
    });
  }
  await t.test('source unchanged', async () => assert.deepEqual(await h.stateOf(src.pool), sourceState));
});

test('a failure in the data phase rolls the whole restore back', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  // Valid on the source, false on any other database: tables are created and earlier data loaded before COPY fails here.
  await src.pool.query(`CREATE TABLE cs_zz_restore_poison (id INT, CHECK (current_database() = '${src.name}'))`);
  await src.pool.query('INSERT INTO cs_zz_restore_poison VALUES (1)');
  const sourceState = await h.stateOf(src.pool);
  const { out, checks } = await h.backup(src.url);
  assert.deepEqual(failures(checks), []);
  const target = await h.database('target');
  const r = await runRestore({ archive: out, url: target.url, client, env: {} });
  assert.equal(status(r.checks, 'RESTORE_APPLY'), 'FAIL');
  assert.match(detail(r.checks, 'RESTORE_APPLY'), /CONSTRAINT_VIOLATION/);
  assert.equal(status(r.checks, 'RESTORE_ROLLED_BACK'), 'PASS');
  assert.equal(await h.relationCount(h.pool(target.url)), 0);
  assert.deepEqual(await h.stateOf(src.pool), sourceState);
  assert.equal(JSON.stringify(r.checks).includes(src.name), false, 'no database name in the result');
});

test('insufficient privileges fail safely and leave nothing behind', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const sourceState = await h.stateOf(src.pool);
  const { out } = await h.backup(src.url);

  await t.test('a role that cannot read the tables produces no archive', async () => {
    const reader = await h.role();
    const path = join(h.dir, 'denied.dump');
    const r = await runBackup({ url: reader.urlFor(src.name), out: path, client, env: {} });
    assert.equal(status(r.checks, 'BACKUP_SOURCE_STATE'), 'FAIL');
    assert.match(detail(r.checks, 'BACKUP_SOURCE_STATE'), /42501/);
    assert.deepEqual(readdirSync(h.dir).filter((f) => f.startsWith('denied.dump')), []);
    assert.equal(JSON.stringify(r.checks).includes(reader.password), false);
  });

  await t.test('pg_dump failing after the snapshot removes its partial file', async () => {
    const path = join(h.dir, 'partial.dump');
    const failing = { kind: 'stub', run: async (tool, args, options) => {
      if (tool !== 'pg_dump' || args[0] === '--version') return client.run(tool, args, options);
      options.stdoutSink(Buffer.from('half an archive'));
      return { code: 1, stdout: '', stderrCode: 'PERMISSION_DENIED' };
    } };
    const r = await runBackup({ url: src.url, out: path, client: failing, env: {} });
    assert.equal(status(r.checks, 'BACKUP_ARCHIVE'), 'FAIL');
    assert.match(detail(r.checks, 'BACKUP_ARCHIVE'), /PERMISSION_DENIED/);
    assert.deepEqual(readdirSync(h.dir).filter((f) => f.startsWith('partial.dump')), []);
  });

  await t.test('a role with no CREATE on the target is refused before pg_restore', async () => {
    const target = await h.database('target');
    const limited = await h.role();
    const r = await runRestore({ archive: out, url: limited.urlFor(target.name), client, env: {} });
    assert.equal(status(r.checks, 'RESTORE_TARGET_PRIVILEGE'), 'FAIL');
    assert.equal(status(r.checks, 'RESTORE_APPLY'), undefined);
    assert.equal(await h.relationCount(h.pool(target.url)), 0);
  });

  await t.test('a permission error inside pg_restore rolls back', async () => {
    const extended = await h.source();
    await extended.pool.query('CREATE SCHEMA cs_extra');
    await extended.pool.query('CREATE TABLE cs_extra.side (id INT)');
    const archive = await h.backup(extended.url);
    const target = await h.database('target');
    const limited = await h.role();
    const owner = h.pool(target.url);
    await owner.query(`GRANT CREATE ON SCHEMA public TO ${limited.name}`);
    await owner.query(`REVOKE CREATE ON DATABASE ${target.name} FROM PUBLIC`);
    const r = await runRestore({ archive: archive.out, url: limited.urlFor(target.name), client, env: {} });
    assert.equal(status(r.checks, 'RESTORE_TARGET_PRIVILEGE'), 'PASS', 'passes the early check, so the client itself fails');
    assert.equal(status(r.checks, 'RESTORE_APPLY'), 'FAIL');
    assert.match(detail(r.checks, 'RESTORE_APPLY'), /PERMISSION_DENIED/);
    assert.equal(status(r.checks, 'RESTORE_ROLLED_BACK'), 'PASS');
    assert.equal(await h.relationCount(owner), 0);
    await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${limited.name}`);
  });

  await t.test('a restored copy read by a non-owner role reports that the server could not start', async () => {
    const target = await h.database('target');
    assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
    const limited = await h.role();
    const owner = h.pool(target.url);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${limited.name}`);
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${limited.name}`);
    const r = await runVerify({ archive: out, url: limited.urlFor(target.name), startupDdl: true, env: {} });
    assert.equal(status(r.checks, 'VERIFY_DB_STARTUP_PRIVILEGE'), 'FAIL');
    assert.equal(status(r.checks, 'VERIFY_STARTUP_DDL'), 'NOT_RUN');
    assert.equal(recoveryVerdict(r.checks, r.manifest.scope), 'RECOVERY_NOT_VERIFIED');
    await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${limited.name}`);
    await owner.query(`REVOKE USAGE ON SCHEMA public FROM ${limited.name}`);
  });

  await t.test('source unchanged', async () => assert.deepEqual(await h.stateOf(src.pool), sourceState));
});

test('schema compatibility: a pre-History backup migrates on the copy, an unknown version never verifies', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);

  await t.test('pre-History source: pending migration is reported, then the real migration keeps every old row', async () => {
    const db = await h.database('source');
    const p = h.pool(db.url);
    await p.query(readFileSync(new URL('../src/postgres-schema.sql', import.meta.url), 'utf8'));
    const id = 'legacy-session-1', data = { id, state: 'ACCEPTED', note: '이전 세션' };
    await p.query('INSERT INTO cs_sessions(id,data) VALUES($1,$2::jsonb)', [id, JSON.stringify(data)]);
    const { out, checks } = await h.backup(db.url);
    assert.deepEqual(failures(checks), []);
    const target = await h.database('target');
    assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
    const r = await runVerify({ archive: out, url: target.url, startupDdl: true, env: {} });
    assert.deepEqual(failures(r.checks), []);
    assert.equal(status(r.checks, 'VERIFY_DB_HISTORY_MIGRATION'), 'MANUAL');
    assert.equal(status(r.checks, 'VERIFY_STARTUP_DDL'), 'PASS');
    assert.match(detail(r.checks, 'VERIFY_STARTUP_DDL'), /cs_inspection_records/);
    const copy = h.pool(target.url);
    assert.deepEqual((await copy.query('SELECT data FROM cs_sessions WHERE id=$1', [id])).rows[0].data, data);
    assert.equal(Number((await copy.query('SELECT count(*) n FROM cs_inspection_records')).rows[0].n), 0, 'no backfill');
    assert.deepEqual(failures(await inspectDatabase(copy)), []);
    assert.equal(Number((await p.query('SELECT count(*) n FROM information_schema.tables WHERE table_schema=current_schema()')).rows[0].n), 4, 'the source was not migrated');
  });

  await t.test('a backup with a future schema version restores faithfully but does not verify', async () => {
    const src = await h.source();
    await src.pool.query('UPDATE cs_history_schema_meta SET version=2');
    const { out } = await h.backup(src.url);
    const target = await h.database('target');
    assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
    const r = await runVerify({ archive: out, url: target.url, startupDdl: true, env: {} });
    assert.equal(status(r.checks, 'VERIFY_ROW_DIGESTS'), 'PASS');
    assert.equal(status(r.checks, 'VERIFY_DB_HISTORY_MIGRATION'), 'FAIL');
    assert.equal(status(r.checks, 'VERIFY_STARTUP_DDL'), 'NOT_RUN');
    assert.equal(recoveryVerdict(r.checks, r.manifest.scope), 'RECOVERY_NOT_VERIFIED');
  });
});

test('the backup matches its manifest while a writer keeps changing the source', { skip, timeout: 120_000 }, async (t) => {
  const h = await harness(t);
  const src = await h.source();
  const writer = h.pool(src.url);
  let stop = false, writes = 0;
  const loop = (async () => {
    while (!stop) {
      await writer.query('INSERT INTO cs_rate_windows(key,count,expires_at) VALUES($1,1,1800000000000)', [randomBytes(32).toString('hex')]);
      writes++;
    }
  })();
  const { out, checks } = await h.backup(src.url);
  stop = true;
  await loop;
  assert.deepEqual(failures(checks), []);
  const target = await h.database('target');
  assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
  const r = await runVerify({ archive: out, url: target.url, env: {} });
  assert.equal(status(r.checks, 'VERIFY_ROW_COUNTS'), 'PASS');
  assert.equal(status(r.checks, 'VERIFY_ROW_DIGESTS'), 'PASS');
  const now = Number((await writer.query('SELECT count(*) n FROM cs_rate_windows')).rows[0].n);
  const inBackup = JSON.parse(readFileSync(out + '.manifest.json', 'utf8')).tables.find((x) => x.name === 'cs_rate_windows').rows;
  assert.ok(writes > 0);
  assert.ok(now > inBackup, 'writes continued past the snapshot');
});

test('CLI end to end: the runbook sequence, no secret on any channel, and a local report cannot pass G4', { skip, timeout: 180_000 }, async (t) => {
  const h = await harness(t);
  const name = unique();
  const clientFlags = process.env.PG_CLIENT_DOCKER_IMAGE ? ['--docker-image', process.env.PG_CLIENT_DOCKER_IMAGE] : process.env.PG_CLIENT_BIN ? ['--pg-bin', process.env.PG_CLIENT_BIN] : [];
  const created = [`carscope_rehearsal_${name}_source`, `carscope_rehearsal_${name}_target`];
  t.after(async () => { for (const db of created) await h.admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => {}); });
  const { password } = parseConnection(uri);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|DATABASE_URL|RENDER)/.test(k)));
  const run = (args, env) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...clean, ...env }, windowsHide: true, timeout: 120_000 });
    const output = r.stdout + r.stderr;
    assert.equal(output.includes(password), false, 'password in output');
    assert.equal(/postgres(ql)?:\/\//.test(output), false, 'URL in output');
    return r;
  };
  const created1 = run(['create-isolated', '--admin-url-env', 'ADMIN', '--name', name], { ADMIN: uri });
  assert.equal(created1.status, 0, created1.stdout);
  assert.match(created1.stdout, /5 sessions, 17 records, synthetic/);
  assert.equal(run(['create-isolated', '--admin-url-env', 'ADMIN', '--name', name], { ADMIN: uri }).status, 1, 'an existing database stops it');

  const SOURCE = rehearsalUrl(uri, created[0]), TARGET = rehearsalUrl(uri, created[1]);
  const archive = join(h.dir, 'cli.dump'), report = join(h.dir, 'cli-verify.json');
  const environment = run(['environment', '--url-env', 'SOURCE', ...clientFlags], { SOURCE });
  assert.equal(environment.status, 0, environment.stdout);
  assert.match(environment.stdout, /PASS\s+CLIENT_SERVER_COMPATIBILITY/);
  const backedUp = run(['backup', '--source-url-env', 'SOURCE', '--out', archive, ...clientFlags], { SOURCE });
  assert.equal(backedUp.status, 0, backedUp.stdout);
  assert.equal(run(['backup', '--source-url-env', 'SOURCE', '--out', archive, ...clientFlags], { SOURCE }).status, 1, 'never overwrites');
  const inspected = run(['inspect', '--archive', archive, ...clientFlags]);
  assert.equal(inspected.status, 0, inspected.stdout);
  const restored = run(['restore', '--archive', archive, '--target-url-env', 'TARGET', ...clientFlags], { TARGET });
  assert.equal(restored.status, 0, restored.stdout);
  assert.equal(run(['restore', '--archive', archive, '--target-url-env', 'TARGET', ...clientFlags], { TARGET }).status, 1, 'second restore refused');
  const verified = run(['verify', '--archive', archive, '--target-url-env', 'TARGET', '--startup-ddl', '--report', report], { TARGET });
  assert.equal(verified.status, 0, verified.stdout);
  assert.match(verified.stdout, /LOCAL_BACKUP_RESTORE_PASS/);
  assert.match(verified.stdout, /PRODUCTION_DB_NOT_RUN/);

  const text = readFileSync(report, 'utf8'), parsed = JSON.parse(text);
  assert.equal(parsed.verdict, 'LOCAL_BACKUP_RESTORE_PASS');
  assert.equal(parsed.scope, 'ISOLATED_LOOPBACK');
  for (const value of [password, created[0], created[1]]) assert.equal(text.includes(value), false);
  const gates = runRenderGates({ recoveryReport: text });
  assert.equal(gates.find((c) => c.id === 'RENDER_BACKUP_READY').status, 'NOT_VERIFIED');
  assert.equal(gates.find((c) => c.id === 'RENDER_RESTORE_REHEARSED').status, 'NOT_RUN');
  assert.ok(existsSync(archive + '.sha256') && existsSync(archive + '.manifest.json'));
});

// The branch G3 would use, exercised without touching a service database. PG_REMOTE_SIM_URL names a disposable TLS server
// under a non-loopback name with a self-signed certificate. It is a stand-in for the code path, not evidence about Render.
const remoteSimUrl = process.env.PG_REMOTE_SIM_URL;
const remoteSkip = skip || (!remoteSimUrl && 'PG_REMOTE_SIM_URL absent: remote branch NOT_RUN');
test('remote branch on a disposable TLS server: dated approval, read-only dump, loopback copy, G3 verdict, MANUAL gate', { skip: remoteSkip, timeout: 180_000 }, async (t) => {
  const h = await harness(t);
  const remote = parseConnection(remoteSimUrl);
  assert.equal(remote.loopback, false, 'the simulated source must take the remote branch');
  assert.equal(remote.sslmode, 'require');
  const adminRemote = await openClient(remote);
  const name = `carscope_rehearsal_${unique()}_remote`;
  await adminRemote.query(`CREATE DATABASE ${name}`);
  t.after(async () => {
    await adminRemote.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await adminRemote.end();
  });
  const { default: pg } = await import('pg');
  const sourceUrl = rehearsalUrl(remoteSimUrl, name);
  const sourceConnection = parseConnection(sourceUrl);
  const pool = new pg.Pool({ host: sourceConnection.host, port: Number(sourceConnection.port), user: sourceConnection.user, password: sourceConnection.password, database: name, ssl: { rejectUnauthorized: false }, max: 2 });
  pool.on('error', () => {});
  t.after(() => pool.end());
  await applyCarScopeSchema(pool);
  await seedSyntheticData(pool);
  assert.equal((await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl, true, 'the stand-in really uses TLS');
  const before = await h.stateOf(pool);

  const out = join(h.dir, 'remote.dump');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(detail((await runBackup({ url: sourceUrl, out, client, env: {} })).checks, 'BACKUP_POLICY'), 'REMOTE_SOURCE_NEEDS_G3_APPROVAL');
  assert.equal(detail((await runBackup({ url: sourceUrl, out, client, allowRemoteReadOnly: true, g3ApprovedOn: '2000-01-01', env: {} })).checks, 'BACKUP_POLICY'), 'G3_APPROVAL_DATE_NOT_TODAY_UTC');
  assert.equal(existsSync(out), false);

  const unverified = await runBackup({ url: sourceUrl + '?sslmode=verify-full', out: out + '.strict', client, allowRemoteReadOnly: true, g3ApprovedOn: today, env: {} });
  assert.equal(status(unverified.checks, 'BACKUP_CONNECT'), 'BLOCKED', 'an untrusted certificate is refused under verify-full');
  assert.equal(existsSync(out + '.strict'), false);

  const backup = await runBackup({ url: sourceUrl, out, client, allowRemoteReadOnly: true, g3ApprovedOn: today, env: {} });
  assert.deepEqual(failures(backup.checks), []);
  assert.equal(status(backup.checks, 'BACKUP_POLICY'), 'MANUAL');
  assert.equal(status(backup.checks, 'BACKUP_TLS_IDENTITY'), 'MANUAL');
  assert.equal(status(backup.checks, 'BACKUP_READ_ONLY'), 'PASS');
  assert.equal(backup.manifest.scope, 'REMOTE_READ_ONLY');
  const text = readFileSync(out + '.manifest.json', 'utf8');
  for (const value of [remote.host, remote.password, name]) assert.equal(text.includes(value), false);
  assert.deepEqual(await h.stateOf(pool), before, 'the read-only source is unchanged');

  assert.equal(detail((await runRestore({ archive: out, url: sourceUrl, client, env: {} })).checks, 'RESTORE_TARGET_POLICY'), 'RESTORE_TARGET_MUST_BE_LOOPBACK', 'the source can never be restored into');
  assert.deepEqual(await h.stateOf(pool), before);

  const target = await h.database('target');
  assert.deepEqual(failures((await runRestore({ archive: out, url: target.url, client, env: {} })).checks), []);
  const verified = await runVerify({ archive: out, url: target.url, startupDdl: true, env: {} });
  assert.deepEqual(failures(verified.checks), []);
  assert.equal(recoveryVerdict(verified.checks, verified.manifest.scope), 'G3_REHEARSAL_VERIFIED');
  const report = reportPayload('verify', verified);
  assert.equal(report.notRun.includes('PRODUCTION_DB_NOT_RUN'), false);
  const gates = runRenderGates({ recoveryReport: JSON.stringify(report) });
  assert.equal(gates.find((c) => c.id === 'RENDER_BACKUP_READY').status, 'MANUAL', 'never PASS: the tool cannot authenticate an operator file');
  assert.equal(gates.find((c) => c.id === 'RENDER_RESTORE_REHEARSED').status, 'MANUAL');
});

test('create-isolated refuses every non-rehearsal situation before it connects', { skip }, async () => {
  await assert.rejects(() => createIsolated({ adminUrl: uri, name: 'BAD-NAME', env: {} }), /REHEARSAL_NAME_INVALID/);
  await assert.rejects(() => createIsolated({ adminUrl: uri, name: 'x', env: { RENDER: 'true' } }), /RESTORE_ON_RENDER_FORBIDDEN/);
  await assert.rejects(() => createIsolated({ adminUrl: 'postgresql://u:p@db.invalid/x', name: 'x', env: {} }), /RESTORE_TARGET_MUST_BE_LOOPBACK/);
});
