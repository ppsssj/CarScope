// No database and no PostgreSQL client: the boundaries that must hold before any connection is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBackupSource, assertRehearsalTarget, classifyClientError, clientEnvironment, compareState, dockerArguments, dockerClient,
  inspectArchive, parseArchiveList, parseConnection, parseMajor, recoveryVerdict, runBackup, runRestore, runVerify, versionCompatibility,
} from '../preflight/recovery.mjs';
import { parseArguments, reportPayload } from '../bin/db-recovery.mjs';
import { recoveryReportGates, targetCommitGates, runRenderGates } from '../preflight/render-gates.mjs';
import { check } from '../preflight/report.mjs';

const CLI = fileURLToPath(new URL('../bin/db-recovery.mjs', import.meta.url));
const SECRET = 'recovery-sentinel-' + process.pid;
const REMOTE = `postgresql://operator:${SECRET}@db.invalid:5432/carscope_prod`;
const LOCAL = (database) => `postgresql://rehearsal:${SECRET}@127.0.0.1:55432/${database}`;
const NOW = Date.UTC(2026, 10, 6, 12);
const TODAY = '2026-11-06';
const noEnv = {};
const temp = (t) => { const d = mkdtempSync(join(tmpdir(), 'carscope-recovery-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const runCli = (args, env = {}) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|DATABASE_URL|RENDER)/.test(k)));
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...clean, ...env }, windowsHide: true });
};
/** A client that must never be reached: any use fails the test that expected a refusal. */
const untouchable = { kind: 'stub', run: () => assert.fail('client must not run') };

test('a restore target is refused unless loopback, rehearsal-named and not a service database', () => {
  assert.equal(assertRehearsalTarget(LOCAL('carscope_rehearsal_a_target'), noEnv).database, 'carscope_rehearsal_a_target');
  for (const [url, env, code] of [
    [REMOTE, noEnv, 'RESTORE_TARGET_MUST_BE_LOOPBACK'],
    [`postgresql://u:${SECRET}@db.invalid/carscope_rehearsal_a_target`, noEnv, 'RESTORE_TARGET_MUST_BE_LOOPBACK'],
    [LOCAL('carscope'), noEnv, 'RESTORE_TARGET_NAME_NOT_REHEARSAL'],
    [LOCAL('postgres'), noEnv, 'RESTORE_TARGET_NAME_NOT_REHEARSAL'],
    [LOCAL('carscope_rehearsal_'), noEnv, 'RESTORE_TARGET_NAME_NOT_REHEARSAL'],
    [LOCAL('carscope_rehearsal_a;drop'), noEnv, 'RESTORE_TARGET_NAME_NOT_REHEARSAL'],
    [LOCAL('carscope_rehearsal_a_target'), { RENDER: 'true' }, 'RESTORE_ON_RENDER_FORBIDDEN'],
    // Same database through another credential is still the service database.
    [LOCAL('carscope_rehearsal_a_target'), { DATABASE_URL: 'postgresql://other:x@127.0.0.1:55432/carscope_rehearsal_a_target' }, 'TARGET_IS_SERVICE_DATABASE'],
    [LOCAL('carscope_rehearsal_a_target'), { PG_ADMIN_DATABASE_URL: LOCAL('carscope_rehearsal_a_target') }, 'TARGET_IS_SERVICE_DATABASE'],
    [LOCAL('carscope_rehearsal_a_target'), { DATABASE_URL: 'not a url' }, 'SERVICE_VARIABLE_UNREADABLE'],
    ['mysql://u:p@127.0.0.1/carscope_rehearsal_a', noEnv, 'DATABASE_URL_INVALID'],
    ['not a url', noEnv, 'DATABASE_URL_INVALID'],
    [LOCAL('carscope_rehearsal_a') + '?host=db.invalid', noEnv, 'DATABASE_URL_QUERY_REFUSED'],
    [LOCAL('carscope_rehearsal_a') + '?sslmode=disable', noEnv, 'DATABASE_URL_QUERY_REFUSED'],
  ]) assert.throws(() => assertRehearsalTarget(url, env), new RegExp('^Error: ' + code + '$'), code);
});

test('a remote backup source needs the flag and the approval date of the current UTC day', () => {
  const now = () => NOW;
  assert.equal(assertBackupSource(LOCAL('anything'), { now, env: noEnv }).scope, 'ISOLATED_LOOPBACK');
  assert.throws(() => assertBackupSource(REMOTE, { now, env: noEnv }), /REMOTE_SOURCE_NEEDS_G3_APPROVAL/);
  assert.throws(() => assertBackupSource(REMOTE, { allowRemoteReadOnly: true, now, env: noEnv }), /G3_APPROVAL_DATE_NOT_TODAY_UTC/);
  assert.throws(() => assertBackupSource(REMOTE, { allowRemoteReadOnly: true, g3ApprovedOn: '2026-11-05', now, env: noEnv }), /G3_APPROVAL_DATE_NOT_TODAY_UTC/);
  assert.throws(() => assertBackupSource(REMOTE, { g3ApprovedOn: TODAY, now, env: noEnv }), /REMOTE_SOURCE_NEEDS_G3_APPROVAL/);
  assert.throws(() => assertBackupSource(LOCAL('x'), { now, env: { RENDER: 'true' } }), /BACKUP_ON_RENDER_FORBIDDEN/);
  const approved = assertBackupSource(REMOTE, { allowRemoteReadOnly: true, g3ApprovedOn: TODAY, now, env: noEnv });
  assert.equal(approved.scope, 'REMOTE_READ_ONLY');
  assert.equal(approved.connection.sslmode, 'require', 'a remote source never defaults to plaintext');
});

test('refused operations never reach a client or a connection, and leave no file', async (t) => {
  const dir = temp(t), out = join(dir, 'backup.dump');
  const backup = await runBackup({ url: REMOTE, out, client: untouchable, now: () => NOW, env: noEnv });
  assert.equal(backup.checks[0].status, 'FAIL');
  assert.equal(backup.checks[0].detail, 'REMOTE_SOURCE_NEEDS_G3_APPROVAL');
  assert.equal(existsSync(out), false);
  for (const url of [REMOTE, LOCAL('carscope')]) {
    const restored = await runRestore({ archive: join(dir, 'never.dump'), url, client: untouchable, env: noEnv });
    assert.equal(restored.checks.length, 1);
    assert.equal(restored.checks[0].status, 'FAIL');
    const verified = await runVerify({ archive: join(dir, 'never.dump'), url, startupDdl: true, env: noEnv });
    assert.equal(verified.checks[0].status, 'FAIL');
  }
  const inRepository = await runBackup({ url: LOCAL('x'), out: fileURLToPath(new URL('./must-not-exist.dump', import.meta.url)), client: untouchable, env: noEnv });
  assert.equal(inRepository.checks[0].detail, 'BACKUP_IN_REPOSITORY_FORBIDDEN');
  writeFileSync(out, 'existing');
  const exists = await runBackup({ url: LOCAL('x'), out, client: untouchable, env: noEnv });
  assert.equal(exists.checks[0].detail, 'BACKUP_FILE_EXISTS');
});

test('connection details stay out of argv: Docker receives variable names, and values only through its environment', () => {
  const connection = parseConnection(REMOTE);
  const environment = clientEnvironment(connection, { readOnly: true });
  assert.equal(environment.PGPASSWORD, SECRET);
  assert.match(environment.PGOPTIONS, /default_transaction_read_only=on/);
  const argv = dockerArguments('postgres:16', 'pg_dump', ['--format=custom'], environment);
  const text = argv.join(' ');
  for (const value of [SECRET, 'db.invalid', 'carscope_prod', 'operator']) assert.equal(text.includes(value), false, value);
  assert.ok(argv.includes('PGPASSWORD'));
  assert.equal(clientEnvironment(parseConnection(LOCAL('x'))).PGOPTIONS, undefined);
  assert.throws(() => dockerClient({ image: 'postgres:16; rm -rf /' }), /DOCKER_IMAGE_INVALID/);
  assert.throws(() => dockerClient({}), /DOCKER_IMAGE_INVALID/);
});

test('client stderr becomes a fixed code and the message is dropped', () => {
  for (const [stderr, code] of [
    [`pg_dump: error: connection to server at "db.invalid" failed: FATAL: password authentication failed for user "operator"`, 'AUTHENTICATION_FAILED'],
    ['pg_dump: error: query failed: ERROR: permission denied for table cs_sessions', 'PERMISSION_DENIED'],
    ['pg_dump: error: aborting because of server version mismatch', 'VERSION_MISMATCH'],
    ['pg_restore: error: unsupported version (1.16) in file header', 'VERSION_MISMATCH'],
    ['pg_restore: error: could not execute query: ERROR:  new row for relation "x" violates check constraint "y"', 'CONSTRAINT_VIOLATION'],
    ['pg_restore: error: did not find magic string in file header', 'ARCHIVE_INVALID'],
    ['pg_restore: error: could not read from input file: end of file', 'ARCHIVE_INVALID'],
    ['psql: error: connection to server at "db.invalid", port 5432 failed: timeout expired', 'CONNECTION_FAILED'],
    ['something new from a future release', 'CLIENT_FAILED'],
    [undefined, 'CLIENT_FAILED'],
  ]) assert.equal(classifyClientError(stderr), code, String(stderr));
});

test('version rules: an older client fails, an unknown version blocks, an unverified pairing stays open', () => {
  assert.equal(versionCompatibility('X', 16, 16).status, 'PASS');
  assert.equal(versionCompatibility('X', 15, 16).status, 'FAIL');
  assert.equal(versionCompatibility('X', 17, 16).status, 'MANUAL');
  assert.equal(versionCompatibility('X', 17, 17).status, 'MANUAL');
  assert.equal(versionCompatibility('X', null, 16).status, 'BLOCKED');
  assert.equal(versionCompatibility('X', 16, null).status, 'BLOCKED');
  assert.equal(parseMajor('pg_dump (PostgreSQL) 16.15 (Debian 16.15-1.pgdg13+2)'), 16);
  assert.equal(parseMajor('16.15 (Debian 16.15-1)'), 16);
  assert.equal(parseMajor(null), null);
});

test('archive listing yields facts and objects; roles and database names do not survive', () => {
  const list = parseArchiveList([
    ';', '; Archive created at 2026-11-06 00:00:00 UTC', ';     dbname: secret_database', ';     Format: CUSTOM',
    ';     Dumped from database version: 16.15 (Debian 16.15-1.pgdg13+2)', ';     Dumped by pg_dump version: 16.15 (Debian 16.15-1.pgdg13+2)', ';', '; Selected TOC Entries:', ';',
    '218; 1259 16390 TABLE public cs_sessions secret_role', '3400; 0 16390 TABLE DATA public cs_sessions secret_role',
    '3200; 2606 16400 CONSTRAINT public cs_sessions cs_sessions_pkey secret_role', '3201; 2606 16401 FK CONSTRAINT public cs_session_tokens cs_session_tokens_fk secret_role',
    '3202; 1259 16402 INDEX public cs_rate_expiry secret_role',
  ].join('\n'));
  assert.equal(list.format, 'CUSTOM');
  assert.equal(list.dumpedFromMajor, 16);
  assert.deepEqual(list.tables, ['public.cs_sessions']);
  assert.deepEqual(list.tableData, ['public.cs_sessions']);
  assert.equal(list.constraints, 2);
  assert.equal(list.indexes, 1);
  assert.equal(JSON.stringify(list).includes('secret_'), false);
});

test('inspection stops at missing metadata or a digest mismatch, before any client runs', async (t) => {
  const dir = temp(t), archive = join(dir, 'a.dump');
  writeFileSync(archive, 'archive bytes');
  assert.equal((await inspectArchive({ archive, client: untouchable })).checks[0].id, 'ARCHIVE_METADATA');
  const manifest = { kind: 'carscope-recovery-manifest', manifestVersion: 1, archive: { sha256: 'a'.repeat(64) }, tables: [] };
  writeFileSync(archive + '.manifest.json', JSON.stringify(manifest));
  assert.equal((await inspectArchive({ archive, client: untouchable })).checks[0].detail, 'SIDECAR_UNREADABLE');
  writeFileSync(archive + '.sha256', 'a'.repeat(64) + '  a.dump\n');
  const r = await inspectArchive({ archive, client: untouchable });
  assert.equal(r.checks[0].id, 'ARCHIVE_SHA256');
  assert.equal(r.checks[0].status, 'FAIL');
});

test('state comparison names what differs and never a row', () => {
  const structure = { schemas: [{ name: 'public' }], columns: [], constraints: [{ name: 'c' }], indexes: [], sequences: [], triggers: [], functions: [], extensions: [] };
  const manifest = { structure, tables: [{ schema: 'public', name: 'a', rows: 2, digest: 'x' }, { schema: 'public', name: 'b', rows: 1, digest: 'y' }] };
  const status = (checks, id) => checks.find((c) => c.id === id).status;
  const good = compareState(manifest, { structure, structureDigest: 'd', tables: manifest.tables });
  assert.deepEqual(good.map((c) => c.status), ['PASS', 'PASS', 'PASS']);
  const drift = compareState(manifest, { structure: { ...structure, constraints: [] }, structureDigest: 'd', tables: manifest.tables });
  assert.equal(status(drift, 'VERIFY_STRUCTURE'), 'FAIL');
  assert.match(drift[0].detail, /constraints/);
  assert.equal(status(compareState(manifest, { structure, structureDigest: 'd', tables: [manifest.tables[0]] }), 'VERIFY_ROW_COUNTS'), 'FAIL');
  assert.equal(status(compareState(manifest, { structure, structureDigest: 'd', tables: [...manifest.tables, { schema: 'public', name: 'c', rows: 0, digest: 'z' }] }), 'VERIFY_ROW_COUNTS'), 'FAIL');
  assert.equal(status(compareState(manifest, { structure, structureDigest: 'd', tables: [{ ...manifest.tables[0], rows: 3 }, manifest.tables[1]] }), 'VERIFY_ROW_COUNTS'), 'FAIL');
  assert.equal(status(compareState(manifest, { structure, structureDigest: 'd', tables: [{ ...manifest.tables[0], digest: 'tampered' }, manifest.tables[1]] }), 'VERIFY_ROW_DIGESTS'), 'FAIL');
});

test('the verdict needs a clean verify including the migration; a local rehearsal is never a production verdict', () => {
  const ddl = (status) => check('VERIFY_STARTUP_DDL', status, '');
  assert.equal(recoveryVerdict([ddl('PASS')], 'ISOLATED_LOOPBACK'), 'LOCAL_BACKUP_RESTORE_PASS');
  assert.equal(recoveryVerdict([ddl('PASS')], 'REMOTE_READ_ONLY'), 'G3_REHEARSAL_VERIFIED');
  assert.equal(recoveryVerdict([ddl('NOT_RUN')], 'ISOLATED_LOOPBACK'), 'RECOVERY_NOT_VERIFIED');
  assert.equal(recoveryVerdict([], 'ISOLATED_LOOPBACK'), 'RECOVERY_NOT_VERIFIED');
  assert.equal(recoveryVerdict([ddl('PASS'), check('X', 'FAIL', '')], 'ISOLATED_LOOPBACK'), 'RECOVERY_NOT_VERIFIED');
  assert.equal(recoveryVerdict([ddl('PASS'), check('X', 'BLOCKED', '')], 'REMOTE_READ_ONLY'), 'RECOVERY_NOT_VERIFIED');
  const local = reportPayload('verify', { checks: [ddl('PASS')], manifest: { scope: 'ISOLATED_LOOPBACK', createdAt: 'x', archive: { sha256: 'y' } } });
  assert.equal(local.verdict, 'LOCAL_BACKUP_RESTORE_PASS');
  assert.ok(local.notRun.includes('PRODUCTION_DB_NOT_RUN') && local.notRun.includes('RENDER_DEPLOY_NOT_RUN'));
  assert.equal(reportPayload('backup', { checks: [ddl('PASS')], manifest: { scope: 'ISOLATED_LOOPBACK' } }).verdict, null, 'only verify names a verdict');
});

test('CLI has no URL argument, no widening flag and no deploy or production-restore command', () => {
  assert.equal(parseArguments(['restore', '--archive', 'a', '--target-url-env', 'T']).command, 'restore');
  for (const argv of [
    [], ['deploy'], ['migrate'], ['drop'], ['restore'], ['restore', '--archive', 'a'], ['restore', '--archive', 'a', '--target-url-env', 'postgresql://u:p@h/x'],
    ['restore', '--archive', 'a', '--target-url', 'postgresql://u:p@h/x'], ['restore', '--archive', 'a', '--target-url-env', 'T', '--allow-remote-read-only'],
    ['restore', '--archive', 'a', '--target-url-env', 'T', '--force'], ['backup', '--source-url-env', 'S'], ['backup', '--source-url-env', 'S', '--out', 'postgresql://u:p@h/x'],
    ['backup', '--source-url-env', 'S', '--out', 'x', '--g3-approved-on', TODAY], ['backup', '--source-url-env', 'S', '--out', 'x', '--pg-bin', 'a', '--docker-image', 'b'],
    ['inspect', '--archive', 'postgresql://u:p@h/x'], ['verify', '--archive', 'a', '--target-url-env', 'T', '--allow-remote-read-only'],
  ]) assert.throws(() => parseArguments(argv), undefined, JSON.stringify(argv));
  const usage = runCli(['restore', '--archive', 'a', '--target-url', `postgresql://u:${SECRET}@db.invalid/x`]);
  assert.equal(usage.status, 2);
  assert.equal((usage.stdout + usage.stderr).includes(SECRET), false);
});

test('CLI output: refused commands exit 1 and a URL, host or password never leaves the process', (t) => {
  const dir = temp(t);
  for (const [args, env, expected] of [
    [['restore', '--archive', join(dir, 'x.dump'), '--target-url-env', 'T'], { T: REMOTE }, 'RESTORE_TARGET_MUST_BE_LOOPBACK'],
    [['verify', '--archive', join(dir, 'x.dump'), '--target-url-env', 'T', '--startup-ddl'], { T: REMOTE }, 'RESTORE_TARGET_MUST_BE_LOOPBACK'],
    [['backup', '--source-url-env', 'S', '--out', join(dir, 'x.dump')], { S: REMOTE }, 'REMOTE_SOURCE_NEEDS_G3_APPROVAL'],
    [['backup', '--source-url-env', 'S', '--out', join(dir, 'x.dump'), '--allow-remote-read-only', '--g3-approved-on', '2000-01-01'], { S: REMOTE }, 'G3_APPROVAL_DATE_NOT_TODAY_UTC'],
    [['create-isolated', '--admin-url-env', 'A', '--name', 'x'], { A: REMOTE }, 'RESTORE_TARGET_MUST_BE_LOOPBACK'],
    [['restore', '--archive', join(dir, 'x.dump'), '--target-url-env', 'T'], { T: 'postgresql://u:' + SECRET + '@[bad' }, 'DATABASE_URL_INVALID'],
    [['restore', '--archive', join(dir, 'x.dump'), '--target-url-env', 'T'], {}, 'NAMED_VARIABLE_EMPTY'],
  ]) {
    const r = runCli(args, env);
    const output = r.stdout + r.stderr;
    assert.equal(r.status, 1, args.join(' '));
    assert.match(output, new RegExp(expected));
    assert.match(output, /RENDER_DEPLOY_NOT_RUN/);
    for (const leak of [SECRET, 'db.invalid', 'carscope_prod']) assert.equal(output.includes(leak), false, leak);
  }
  const server = runCli(['environment', '--url-env', 'T', '--pg-bin', join(dir, 'no-such-client')], { T: REMOTE });
  assert.equal(server.status, 0, 'BLOCKED is an open item');
  assert.match(server.stdout, /BLOCKED\s+SERVER_VERSION\s+non-loopback/);
  assert.match(server.stdout, /BLOCKED\s+CLIENT_PG_DUMP\s+not available: CLIENT_NOT_FOUND/);
  assert.equal(server.stdout.includes(SECRET), false);
});

test('Render gates: a synthetic rehearsal, a failed report or an old backup cannot satisfy G4', () => {
  const at = (id, checks) => checks.find((c) => c.id === id);
  const now = () => NOW;
  const report = (fields) => JSON.stringify({ kind: 'carscope-recovery-report', command: 'verify', scope: 'REMOTE_READ_ONLY', verdict: 'G3_REHEARSAL_VERIFIED', backupCreatedAt: new Date(NOW - 3_600_000).toISOString(), archiveSha256: 'a'.repeat(64), ...fields });
  const none = recoveryReportGates(undefined, { now });
  assert.equal(at('RENDER_BACKUP_READY', none).status, 'NOT_VERIFIED');
  assert.equal(at('RENDER_RESTORE_REHEARSED', none).status, 'NOT_RUN');
  const local = recoveryReportGates(report({ scope: 'ISOLATED_LOOPBACK', verdict: 'LOCAL_BACKUP_RESTORE_PASS' }), { now });
  assert.equal(at('RENDER_BACKUP_READY', local).status, 'NOT_VERIFIED');
  assert.equal(at('RENDER_RESTORE_REHEARSED', local).status, 'NOT_RUN');
  assert.equal(at('RENDER_BACKUP_READY', recoveryReportGates(report({ verdict: 'RECOVERY_NOT_VERIFIED' }), { now })).status, 'FAIL');
  assert.equal(at('RENDER_BACKUP_READY', recoveryReportGates(report({ backupCreatedAt: new Date(NOW - 25 * 3_600_000).toISOString() }), { now })).status, 'FAIL');
  assert.equal(at('RENDER_BACKUP_READY', recoveryReportGates(report({ backupCreatedAt: new Date(NOW + 3_600_000).toISOString() }), { now })).status, 'FAIL');
  assert.equal(at('RENDER_BACKUP_READY', recoveryReportGates('not json', { now })).status, 'FAIL');
  assert.equal(at('RENDER_BACKUP_READY', recoveryReportGates(report({ command: 'backup' }), { now })).status, 'FAIL');
  const good = recoveryReportGates(report({}), { now });
  assert.equal(at('RENDER_BACKUP_READY', good).status, 'MANUAL', 'an operator-supplied file is never PASS');
  assert.equal(at('RENDER_RESTORE_REHEARSED', good).status, 'MANUAL');
});

test('target commit gates separate the deploy target from origin/main and from the deployed commit', (t) => {
  // Without --verify, a missing ref exits 128 yet still prints its own name to stdout. A shallow checkout has no origin/main.
  const resolved = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], { encoding: 'utf8' });
  const main = resolved.status === 0 ? resolved.stdout.trim() : '';
  if (!main) {
    assert.notEqual(process.env.REQUIRE_ORIGIN_MAIN, '1', 'this job promises full history');
    return t.skip('origin/main unavailable: NOT_RUN');
  }
  const at = (id, checks) => checks.find((c) => c.id === id);
  assert.equal(targetCommitGates({})[0].status, 'NOT_VERIFIED');
  assert.equal(targetCommitGates({ targetCommit: 'not-hex' })[0].status, 'FAIL');
  assert.equal(targetCommitGates({ targetCommit: 'f'.repeat(40) })[0].status, 'FAIL');
  const unknownDeployed = targetCommitGates({ targetCommit: main });
  assert.equal(at('RENDER_TARGET_COMMIT', unknownDeployed).status, 'PASS');
  assert.equal(at('RENDER_TARGET_DDL_DELTA', unknownDeployed).status, 'NOT_VERIFIED');
  assert.equal(at('RENDER_TARGET_DDL_DELTA', targetCommitGates({ targetCommit: main, deployedCommit: main })).status, 'PASS');
  assert.ok(runRenderGates().some((c) => c.id === 'RENDER_TARGET_COMMIT' && c.status === 'NOT_VERIFIED'));
  assert.ok(runRenderGates().some((c) => c.id === 'RENDER_DEPLOYMENT' && c.status === 'NOT_RUN'));
});
