// Backup and restore rehearsal. The only module in this tool that may run pg_dump or pg_restore.
// Boundaries, each enforced before any connection is opened:
//   restore targets  loopback only, database name prefixed carscope_rehearsal_, never a service variable, never on Render
//   backup sources   loopback, or a remote database with --allow-remote-read-only AND today's --g3-approved-on date
// Connection details travel in the child environment only: never in argv, a result, a report or a manifest.
// A client's stderr can hold hosts and roles, so it is reduced to a fixed code and never echoed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { check, safeCode, assertOutsideRepository } from './report.mjs';
import { inspectDatabase, LOOPBACK_HOSTS, VERIFIED_MAJORS } from './database.mjs';
import { assertPrivateSchemaName, decodeCaCertificate } from '../src/database-config.mjs';
import { REPO_ROOT } from './static-gates.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';

export const REHEARSAL_PREFIX = 'carscope_rehearsal_';
const REHEARSAL_NAME = /^carscope_rehearsal_[a-z0-9_]{1,40}$/;
const SERVICE_VARIABLES = Object.freeze(['DATABASE_URL', 'PG_ADMIN_DATABASE_URL']);
const SSL_MODES = Object.freeze(['require', 'verify-ca', 'verify-full']);
const PLATFORM_ENV = Object.freeze(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'ProgramData', 'ProgramFiles', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_HOST', 'DOCKER_CONTEXT']);
const MANIFEST_VERSION = 1;

/** Parses a named variable's value. A failure carries a code only, because the value may be a full URL with a password. */
export function parseConnection(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.pathname || u.pathname === '/') throw new Error('DATABASE_URL_INVALID');
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== 'sslmode')) throw new Error('DATABASE_URL_QUERY_REFUSED');
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode !== null && !SSL_MODES.includes(sslmode)) throw new Error('DATABASE_URL_QUERY_REFUSED');
  const loopback = LOOPBACK_HOSTS.includes(u.hostname);
  return Object.freeze({
    host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || '5432',
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)), loopback,
    sslmode: sslmode ?? (loopback ? 'prefer' : 'require'),
  });
}

const sameDatabase = (a, b) => a.host === b.host && a.port === b.port && a.database === b.database;

function assertNotServiceDatabase(connection, env) {
  for (const name of SERVICE_VARIABLES) {
    if (!env[name]) continue;
    let other;
    try { other = parseConnection(env[name]); } catch { throw new Error('SERVICE_VARIABLE_UNREADABLE'); }
    if (sameDatabase(connection, other)) throw new Error('TARGET_IS_SERVICE_DATABASE');
  }
}

/** Every restore or rehearsal write passes here. There is no flag that widens it, by design. */
export function assertRehearsalTarget(url, env = process.env) {
  const connection = parseConnection(url);
  if (env.RENDER) throw new Error('RESTORE_ON_RENDER_FORBIDDEN');
  if (!connection.loopback) throw new Error('RESTORE_TARGET_MUST_BE_LOOPBACK');
  if (!REHEARSAL_NAME.test(connection.database)) throw new Error('RESTORE_TARGET_NAME_NOT_REHEARSAL');
  assertNotServiceDatabase(connection, env);
  return connection;
}

/** A remote source is a G3 action, so it needs a dated approval: a command replayed from history on another day stops. */
export function assertBackupSource(url, { allowRemoteReadOnly = false, g3ApprovedOn, now = Date.now, env = process.env } = {}) {
  const connection = parseConnection(url);
  if (env.RENDER) throw new Error('BACKUP_ON_RENDER_FORBIDDEN');
  if (connection.loopback) return { connection, scope: 'ISOLATED_LOOPBACK' };
  if (!allowRemoteReadOnly) throw new Error('REMOTE_SOURCE_NEEDS_G3_APPROVAL');
  if (g3ApprovedOn !== new Date(now()).toISOString().slice(0, 10)) throw new Error('G3_APPROVAL_DATE_NOT_TODAY_UTC');
  return { connection, scope: 'REMOTE_READ_ONLY' };
}

/** libpq variables. PGPASSWORD reaches the child through its environment, never its arguments. */
export function clientEnvironment(connection, { readOnly = false, hostOverride } = {}) {
  return {
    PGHOST: hostOverride ?? connection.host, PGPORT: connection.port, PGUSER: connection.user, PGPASSWORD: connection.password,
    PGDATABASE: connection.database, PGSSLMODE: connection.sslmode, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'carscope-recovery', LC_MESSAGES: 'C',
    ...(readOnly ? { PGOPTIONS: '-c default_transaction_read_only=on' } : {}),
  };
}

const CLIENT_ERRORS = Object.freeze([
  [/server version mismatch|aborting because of server version|unsupported version .* in file header/i, 'VERSION_MISMATCH'],
  [/password authentication failed|no pg_hba|authentication failed/i, 'AUTHENTICATION_FAILED'],
  [/permission denied|must be owner/i, 'PERMISSION_DENIED'],
  [/violates (check|foreign key|unique|not-null)/i, 'CONSTRAINT_VIOLATION'],
  [/already exists/i, 'OBJECT_ALREADY_EXISTS'],
  [/input file does not appear|not a valid archive|did not find magic string|could not read from input|could not uncompress|unexpected end of file|corrupt|could not find block/i, 'ARCHIVE_INVALID'],
  [/could not connect|connection to server|timeout expired|could not translate host/i, 'CONNECTION_FAILED'],
]);
export function classifyClientError(stderr = '') {
  for (const [pattern, code] of CLIENT_ERRORS) if (pattern.test(stderr)) return code;
  return 'CLIENT_FAILED';
}

function platformEnvironment() {
  return Object.fromEntries(PLATFORM_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

/** Streams stdin from a file and stdout to a sink. Binary safe under both clients, since no shell is involved. */
function runProcess(command, args, env, { stdinFile, stdoutSink } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { env, stdio: [stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', finished = false;
    const finish = (result) => { if (!finished) { finished = true; done(result); } };
    child.on('error', (error) => finish({ code: null, stdout, stderrCode: error?.code === 'ENOENT' ? 'CLIENT_NOT_FOUND' : 'CLIENT_FAILED' }));
    child.stderr.on('data', (x) => { stderr = (stderr + x).slice(-16_384); });
    if (stdoutSink) {
      child.stdout.on('data', (x) => {
        const drained = stdoutSink(x); // A sink returns a promise when it is full, so a large dump is not buffered in memory.
        if (drained) { child.stdout.pause(); drained.then(() => child.stdout.resume()); }
      });
    } else child.stdout.on('data', (x) => { stdout += x; });
    if (stdinFile) {
      child.stdin.on('error', () => {}); // The client exits early on a bad archive; its exit code decides.
      createReadStream(stdinFile).on('error', () => child.kill()).pipe(child.stdin);
    }
    child.on('close', (code) => finish({ code, stdout, stderrCode: code === 0 ? null : classifyClientError(stderr) }));
  });
}

/** PostgreSQL client tools from a directory, or from PATH when no directory is given. */
export function nativeClient({ binDir } = {}) {
  const resolveTool = (tool) => (binDir ? join(binDir, process.platform === 'win32' ? tool + '.exe' : tool) : tool);
  return {
    kind: 'native',
    run: (tool, args, { connection, readOnly, stdinFile, stdoutSink } = {}) =>
      runProcess(resolveTool(tool), args, { ...platformEnvironment(), ...(connection ? clientEnvironment(connection, { readOnly }) : {}) }, { stdinFile, stdoutSink }),
  };
}

/** Argument list for the Docker client. `-e NAME` makes Docker copy the value from its own environment, keeping it out of argv. */
export function dockerArguments(image, tool, args, environment) {
  return ['run', '--rm', '-i', '--add-host=host.docker.internal:host-gateway', ...Object.keys(environment).flatMap((k) => ['-e', k]), image, tool, ...args];
}

/** The same tools from a container, for an operator PC without a PostgreSQL client. A loopback server is reached through the host gateway. */
export function dockerClient({ image }) {
  if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/.test(image ?? '')) throw new Error('DOCKER_IMAGE_INVALID');
  return {
    kind: 'docker',
    run: (tool, args, { connection, readOnly, stdinFile, stdoutSink } = {}) => {
      const environment = connection ? clientEnvironment(connection, { readOnly, hostOverride: connection.loopback ? 'host.docker.internal' : undefined }) : {};
      return runProcess('docker', dockerArguments(image, tool, args, environment), { ...platformEnvironment(), ...environment }, { stdinFile, stdoutSink });
    },
  };
}

export const parseMajor = (text) => {
  const m = /(?:PostgreSQL\)?|version:?)\s+(\d+)(?:\.(\d+))?/.exec(text ?? '') ?? /^\s*(\d+)(?:\.(\d+))?/.exec(text ?? '');
  return m ? Number(m[1]) : null;
};

export async function clientVersions(client) {
  const out = {};
  for (const tool of ['pg_dump', 'pg_restore']) {
    const r = await client.run(tool, ['--version']);
    out[tool] = r.code === 0 ? parseMajor(r.stdout) : null;
    out[tool + 'Version'] = r.code === 0 ? /(\d+\.\d+)/.exec(r.stdout)?.[1] ?? null : null;
    if (r.code !== 0) out.error = r.stderrCode;
  }
  return out;
}

/** pg_dump refuses a newer server, and pg_restore a newer archive. A newer client is allowed but not what CI verified. */
export function versionCompatibility(id, clientMajor, serverMajor) {
  if (clientMajor === null || serverMajor === null) return check(id, 'BLOCKED', `client=${clientMajor} server=${serverMajor}: version unknown`);
  if (clientMajor < serverMajor) return check(id, 'FAIL', `client ${clientMajor} is older than ${serverMajor}`);
  if (clientMajor !== serverMajor || !VERIFIED_MAJORS.includes(serverMajor)) return check(id, 'MANUAL', `client ${clientMajor}, server ${serverMajor}: CI verified the matching pairs ${VERIFIED_MAJORS.join(' and ')}`);
  return check(id, 'PASS', `client and server are PostgreSQL ${serverMajor}`);
}

export async function openClient(connection, { searchPath, caPemBase64 } = {}) {
  let pg;
  try { ({ default: pg } = await import('pg')); } catch { throw new Error('PG_DRIVER_NOT_INSTALLED'); }
  const ssl = caPemBase64
    ? { ca: decodeCaCertificate(caPemBase64), rejectUnauthorized: true }
    : connection.loopback ? undefined : { rejectUnauthorized: connection.sslmode !== 'require' };
  const client = new pg.Client({
    host: connection.host, port: Number(connection.port), user: connection.user, password: connection.password,
    database: connection.database, ssl, connectionTimeoutMillis: 10_000, application_name: 'carscope-recovery',
    ...(searchPath ? { options: '-c search_path=' + assertPrivateSchemaName(searchPath) } : {}),
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const USER_SCHEMA = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_%'";
const structureQueries = (USER_SCHEMA) => ({
  schemas: `SELECT n.nspname AS name FROM pg_namespace n WHERE ${USER_SCHEMA} ORDER BY 1`,
  columns: `SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS "notNull",pg_get_expr(d.adbin,d.adrelid) AS "default"
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE ${USER_SCHEMA} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,a.attnum`,
  constraints: `SELECT n.nspname||'.'||c.relname AS relation,k.conname AS name,k.contype::text AS type,k.convalidated AS validated,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA} ORDER BY 1,2`,
  indexes: `SELECT n.nspname||'.'||c.relname AS name,pg_get_indexdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA} AND c.relkind='i' ORDER BY 1`,
  sequences: `SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA} AND c.relkind='S' ORDER BY 1`,
  triggers: `SELECT n.nspname||'.'||c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA} AND NOT t.tgisinternal ORDER BY 1,2`,
  functions: `SELECT n.nspname||'.'||p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,md5(p.prosrc) AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${USER_SCHEMA} ORDER BY 1,2`,
  extensions: `SELECT extname AS name FROM pg_extension ORDER BY 1`,
});
const STRUCTURE_KEYS = Object.freeze(Object.keys(structureQueries(USER_SCHEMA)));

/**
 * Catalog facts and per-table counts and digests. Row contents never leave the database: the digest is a hash over
 * per-row hashes, ordered by hash, so it needs no collation and is independent of physical row order. Session settings
 * are fixed because a row's text form depends on them. Runs inside the caller's transaction.
 */
export async function captureState(client, { schema } = {}) {
  // Scoped to one schema on a platform whose managed schemas this role cannot and must not read.
  const scope = schema ? `n.nspname='${assertPrivateSchemaName(schema)}'` : USER_SCHEMA;
  await client.query("SET LOCAL TimeZone='UTC'");
  await client.query("SET LOCAL DateStyle='ISO, YMD'");
  await client.query("SET LOCAL IntervalStyle='postgres'");
  await client.query('SET LOCAL extra_float_digits=3');
  await client.query("SET LOCAL bytea_output='hex'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SET LOCAL lock_timeout='5s'");
  // Catalog functions omit a schema that is on search_path. A fixed path makes definitions comparable between connections.
  await client.query('SET LOCAL search_path=pg_catalog');
  const structure = {};
  for (const [key, sql] of Object.entries(structureQueries(scope))) structure[key] = schema && key === 'extensions' ? [] : (await client.query(sql)).rows;
  const relations = (await client.query(`SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${scope} AND c.relkind IN ('r','p') ORDER BY 1,2`)).rows;
  const tables = [];
  for (const { schema, name } of relations) {
    const q = `${quote(schema)}.${quote(name)}`;
    const r = await client.query(`SELECT count(*) AS n,encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS digest
      FROM (SELECT encode(sha256(convert_to(t::text,'UTF8')),'hex') AS h FROM ${q} t) x`);
    tables.push({ schema, name, rows: Number(r.rows[0].n), digest: r.rows[0].digest });
  }
  return { structure, structureDigest: sha256Text(JSON.stringify(structure)), tables };
}

const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function sha256File(path) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path).on('error', fail).on('data', (x) => hash.update(x)).on('end', () => done(hash.digest('hex')));
  });
}

async function serverMajor(client) {
  const r = await client.query("SELECT current_setting('server_version_num') AS num, split_part(current_setting('server_version'),' ',1) AS text");
  return { major: Math.floor(Number(r.rows[0].num) / 10000), version: r.rows[0].text };
}

const artifactPaths = (out) => ({ archive: out, partial: out + '.partial', sidecar: out + '.sha256', manifest: out + '.manifest.json' });

/** The dump and the manifest read one exported snapshot, so counts match the archive even while a service keeps writing. */
export async function runBackup({ url, out, client, allowRemoteReadOnly = false, g3ApprovedOn, now = Date.now, env = process.env, repoRoot = REPO_ROOT }) {
  const checks = [];
  let source;
  try {
    source = assertBackupSource(url, { allowRemoteReadOnly, g3ApprovedOn, now, env });
    assertOutsideRepository(out, repoRoot, 'BACKUP_IN_REPOSITORY_FORBIDDEN');
    const paths = artifactPaths(out);
    if (Object.values(paths).some((p) => existsSync(p))) throw new Error('BACKUP_FILE_EXISTS');
  } catch (error) {
    return { checks: [check('BACKUP_POLICY', 'FAIL', safeCode(error))] };
  }
  checks.push(check('BACKUP_POLICY', source.scope === 'ISOLATED_LOOPBACK' ? 'PASS' : 'MANUAL', source.scope === 'ISOLATED_LOOPBACK' ? 'loopback source' : 'remote source under a dated G3 approval'));
  if (source.scope !== 'ISOLATED_LOOPBACK' && source.connection.sslmode === 'require') checks.push(check('BACKUP_TLS_IDENTITY', 'MANUAL', 'sslmode=require encrypts but does not authenticate the server; add sslmode=verify-full when a CA is available'));

  const versions = await clientVersions(client);
  let db;
  try {
    db = await openClient(source.connection);
  } catch (error) {
    return { checks: [...checks, check('BACKUP_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))] };
  }
  const paths = artifactPaths(out);
  try {
    const server = await serverMajor(db);
    const compat = versionCompatibility('BACKUP_VERSION_COMPATIBILITY', versions.pg_dump, server.major);
    checks.push(compat);
    if (compat.status === 'FAIL' || compat.status === 'BLOCKED') return { checks };

    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = (await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
    checks.push(check('BACKUP_READ_ONLY', readOnly === 'on' ? 'PASS' : 'FAIL', 'transaction_read_only=' + readOnly));
    if (readOnly !== 'on') return { checks };
    const snapshot = (await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const state = await captureState(db);

    const hash = createHash('sha256');
    let bytes = 0, sinkError = null;
    const sink = createWriteStream(paths.partial, { flags: 'wx', mode: 0o600 });
    const sinkClosed = new Promise((done) => { sink.on('close', done); sink.on('error', (e) => { sinkError = e; done(); }); });
    const dump = await client.run('pg_dump', ['--format=custom', '--snapshot=' + snapshot, '--lock-wait-timeout=30000'], {
      connection: source.connection, readOnly: true,
      stdoutSink: (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
        return sink.write(chunk) ? undefined : Promise.race([once(sink, 'drain'), sinkClosed]);
      },
    });
    sink.end();
    await sinkClosed;
    if (dump.code !== 0 || sinkError || bytes === 0) {
      rmSync(paths.partial, { force: true });
      checks.push(check('BACKUP_ARCHIVE', 'FAIL', `pg_dump failed: ${dump.stderrCode ?? (sinkError ? safeCode(sinkError) : 'EMPTY_OUTPUT')}; partial file removed`));
      return { checks };
    }
    const sha256 = hash.digest('hex');
    renameSync(paths.partial, paths.archive);
    writeFileSync(paths.sidecar, `${sha256}  ${basename(paths.archive)}\n`, { flag: 'wx', mode: 0o600 });
    const manifest = {
      kind: 'carscope-recovery-manifest', manifestVersion: MANIFEST_VERSION, createdAt: new Date(now()).toISOString(),
      scope: source.scope, sourceServer: { major: server.major, version: server.version },
      client: { kind: client.kind, pg_dump: versions.pg_dumpVersion }, archive: { sha256, bytes }, ...state,
    };
    writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const rows = state.tables.reduce((n, t) => n + t.rows, 0);
    checks.push(check('BACKUP_ARCHIVE', 'PASS', `${bytes} bytes, sha256 ${sha256}`, { sha256, bytes }));
    checks.push(check('BACKUP_SNAPSHOT_STATE', 'PASS', `${state.tables.length} tables, ${rows} rows captured from the dump's snapshot (counts only)`));
    return { checks, manifest };
  } catch (error) {
    rmSync(paths.partial, { force: true });
    checks.push(check('BACKUP_SOURCE_STATE', 'FAIL', 'backup failed: ' + safeCode(error)));
    return { checks };
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end().catch(() => {});
  }
}

/** Header facts and object counts from `pg_restore --list`. The archive's database and role names stay out of the result. */
export function parseArchiveList(text) {
  const header = (label) => new RegExp(`^;\\s+${label}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1] ?? null;
  const entries = (kind) => [...text.matchAll(new RegExp(`^\\d+; \\d+ \\d+ ${kind} (\\S+) (\\S+)`, 'gm'))].map((m) => `${m[1]}.${m[2]}`);
  return {
    format: header('Format'), dumpedFromMajor: parseMajor(header('Dumped from database version')), dumpedByMajor: parseMajor(header('Dumped by pg_dump version')),
    tables: entries('TABLE(?! DATA )'), tableData: entries('TABLE DATA'),
    constraints: entries('CONSTRAINT').length + entries('FK CONSTRAINT').length, indexes: entries('INDEX').length,
  };
}

function readManifest(archive) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(artifactPaths(archive).manifest, 'utf8')); } catch { throw new Error('MANIFEST_UNREADABLE'); }
  if (manifest?.kind !== 'carscope-recovery-manifest' || manifest.manifestVersion !== MANIFEST_VERSION) throw new Error('MANIFEST_UNSUPPORTED');
  return manifest;
}

/** No database. SHA-256 first: `--list` reads only the table of contents, so it cannot see damaged table data by itself. */
export async function inspectArchive({ archive, client }) {
  const checks = [];
  let manifest, recorded;
  try {
    manifest = readManifest(archive);
    recorded = /^([a-f0-9]{64})\s/.exec(readFileSync(artifactPaths(archive).sidecar, 'utf8'))?.[1];
    if (!recorded) throw new Error('SIDECAR_UNREADABLE');
  } catch (error) {
    return { checks: [check('ARCHIVE_METADATA', 'FAIL', error?.code === 'ENOENT' ? 'SIDECAR_UNREADABLE' : safeCode(error))] };
  }
  let actual;
  try { actual = await sha256File(archive); } catch { return { checks: [check('ARCHIVE_SHA256', 'FAIL', 'archive unreadable')] }; }
  if (actual !== recorded || actual !== manifest.archive?.sha256) return { checks: [check('ARCHIVE_SHA256', 'FAIL', 'digest differs from the recorded value: do not use this file')] };
  checks.push(check('ARCHIVE_SHA256', 'PASS', actual, { sha256: actual, bytes: statSync(archive).size }));

  const listed = await client.run('pg_restore', ['--list'], { stdinFile: archive });
  if (listed.code !== 0) return { checks: [...checks, check('ARCHIVE_LIST', 'FAIL', 'pg_restore --list failed: ' + listed.stderrCode)], manifest };
  const list = parseArchiveList(listed.stdout);
  const wanted = manifest.tables.map((t) => `${t.schema}.${t.name}`);
  const missing = wanted.filter((t) => !list.tables.includes(t) || !list.tableData.includes(t));
  const bad = list.format !== 'CUSTOM' || missing.length;
  checks.push(check('ARCHIVE_LIST', bad ? 'FAIL' : 'PASS', bad ? `format=${list.format} missing [${missing}]` : `CUSTOM, ${list.tables.length} tables, ${list.constraints} constraints, ${list.indexes} indexes, dumped from PostgreSQL ${list.dumpedFromMajor}`));
  return { checks, manifest, list };
}

/** Refuses anything already in the database. Default PUBLIC and owner rights are not inspected as content. */
export async function assessTarget(db) {
  const r = await db.query(`SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA}) AS relations,
    (SELECT count(*) FROM pg_namespace n WHERE ${USER_SCHEMA} AND n.nspname<>'public') AS schemas,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${USER_SCHEMA}) AS functions,
    (SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql') AS extensions,
    has_schema_privilege(current_user,'public','CREATE') AS can_create`);
  const row = r.rows[0];
  return { empty: [row.relations, row.schemas, row.functions, row.extensions].every((n) => Number(n) === 0), objects: Number(row.relations) + Number(row.schemas) + Number(row.functions) + Number(row.extensions), canCreate: row.can_create };
}

/** Verifies the archive, then restores in one transaction: a failure at any point leaves the target as it was. */
export async function runRestore({ archive, url, client, env = process.env }) {
  let connection;
  try {
    connection = assertRehearsalTarget(url, env);
  } catch (error) {
    return { checks: [check('RESTORE_TARGET_POLICY', 'FAIL', safeCode(error))] };
  }
  const checks = [check('RESTORE_TARGET_POLICY', 'PASS', 'loopback rehearsal database')];
  const inspected = await inspectArchive({ archive, client });
  checks.push(...inspected.checks);
  if (inspected.checks.some((c) => c.status !== 'PASS')) return { checks };

  let db;
  try {
    db = await openClient(connection);
  } catch (error) {
    return { checks: [...checks, check('RESTORE_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))] };
  }
  try {
    const before = await assessTarget(db);
    if (!before.empty) return { checks: [...checks, check('RESTORE_TARGET_EMPTY', 'FAIL', `target holds ${before.objects} objects: restore refused, nothing changed`)] };
    checks.push(check('RESTORE_TARGET_EMPTY', 'PASS', 'no user objects'));
    if (!before.canCreate) return { checks: [...checks, check('RESTORE_TARGET_PRIVILEGE', 'FAIL', 'role has no CREATE on schema public: restore refused, nothing changed')] };
    checks.push(check('RESTORE_TARGET_PRIVILEGE', 'PASS', 'role can create objects'));

    const server = await serverMajor(db);
    const versions = await clientVersions(client);
    const archiveFit = server.major < inspected.manifest.sourceServer.major
      ? check('RESTORE_VERSION_COMPATIBILITY', 'FAIL', `target server ${server.major} is older than source ${inspected.manifest.sourceServer.major}`)
      : versionCompatibility('RESTORE_VERSION_COMPATIBILITY', versions.pg_restore, server.major);
    checks.push(archiveFit);
    if (archiveFit.status === 'FAIL' || archiveFit.status === 'BLOCKED') return { checks };

    const restored = await client.run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname=' + connection.database], { connection, stdinFile: archive });
    if (restored.code !== 0) {
      const after = await assessTarget(db);
      checks.push(check('RESTORE_APPLY', 'FAIL', 'pg_restore failed: ' + restored.stderrCode));
      checks.push(check('RESTORE_ROLLED_BACK', after.empty ? 'PASS' : 'FAIL', after.empty ? 'target is still empty' : `target holds ${after.objects} objects after a failed restore`));
      return { checks };
    }
    checks.push(check('RESTORE_APPLY', 'PASS', 'single transaction committed'));
    return { checks };
  } catch (error) {
    checks.push(check('RESTORE_APPLY', 'FAIL', 'restore failed: ' + safeCode(error)));
    return { checks };
  } finally {
    await db.end().catch(() => {});
  }
}

const key = (t) => `${t.schema}.${t.name}`;

/** Names what differs. Digests and counts only, never a row. */
export function compareState(manifest, state) {
  const checks = [];
  const differing = STRUCTURE_KEYS.filter((k) => JSON.stringify(manifest.structure?.[k]) !== JSON.stringify(state.structure[k]));
  checks.push(check('VERIFY_STRUCTURE', differing.length ? 'FAIL' : 'PASS', differing.length ? 'differs in: ' + differing.join(', ') : `columns, constraints, indexes, triggers and functions match (${state.structureDigest})`));
  const actual = new Map(state.tables.map((t) => [key(t), t]));
  const expected = new Map(manifest.tables.map((t) => [key(t), t]));
  const absent = [...expected.keys()].filter((k) => !actual.has(k)), added = [...actual.keys()].filter((k) => !expected.has(k));
  const countDiff = [...expected.values()].filter((t) => actual.has(key(t)) && actual.get(key(t)).rows !== t.rows).map((t) => `${key(t)} ${t.rows}->${actual.get(key(t)).rows}`);
  const contentDiff = [...expected.values()].filter((t) => actual.has(key(t)) && actual.get(key(t)).rows === t.rows && actual.get(key(t)).digest !== t.digest).map(key);
  const rows = [...expected.values()].reduce((n, t) => n + t.rows, 0);
  checks.push(check('VERIFY_ROW_COUNTS', absent.length || added.length || countDiff.length ? 'FAIL' : 'PASS', absent.length || added.length || countDiff.length ? `absent [${absent}] added [${added}] counts [${countDiff}]` : `${expected.size} tables, ${rows} rows`));
  checks.push(check('VERIFY_ROW_DIGESTS', contentDiff.length ? 'FAIL' : 'PASS', contentDiff.length ? 'content differs in: ' + contentDiff.join(', ') : 'every table digest matches'));
  return checks;
}

/**
 * Compares a restored database with the manifest, then runs the existing schema inspection against it. With
 * startupDdl the real server migration runs on the rehearsal copy: that is what G4 will do to the service database.
 */
export async function runVerify({ archive, url, startupDdl = false, schema = null, env = process.env }) {
  let connection, manifest;
  try {
    connection = assertRehearsalTarget(url, env);
    manifest = readManifest(archive);
  } catch (error) {
    return { checks: [check('VERIFY_POLICY', 'FAIL', safeCode(error))] };
  }
  const checks = [check('VERIFY_POLICY', 'PASS', 'loopback rehearsal database')];
  let db;
  try {
    db = await openClient(connection, { searchPath: schema ?? undefined });
  } catch (error) {
    return { checks: [...checks, check('VERIFY_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))], manifest };
  }
  const pool = { connect: async () => ({ query: (...a) => db.query(...a), release: () => {} }) };
  try {
    const capture = async () => {
      await db.query('BEGIN TRANSACTION READ ONLY');
      try { return await captureState(db); } finally { await db.query('ROLLBACK'); }
    };
    const state = await capture();
    checks.push(...compareState(manifest, state));
    checks.push(...(await inspectDatabase(pool)).map((c) => ({ ...c, id: 'VERIFY_' + c.id })));
    if (startupDdl) {
      if (checks.some((c) => c.status === 'FAIL')) {
        checks.push(check('VERIFY_STARTUP_DDL', 'NOT_RUN', 'earlier failure: the rehearsal copy was left untouched'));
      } else {
        checks.push(...await rehearseStartupDdl(connection, state, capture, schema));
      }
    } else {
      checks.push(check('VERIFY_STARTUP_DDL', 'NOT_RUN', 'pass --startup-ddl to run the server migration on this rehearsal copy'));
    }
    return { checks, manifest };
  } catch (error) {
    checks.push(check('VERIFY', 'FAIL', 'verification failed: ' + safeCode(error)));
    return { checks, manifest };
  } finally {
    await db.end().catch(() => {});
  }
}

async function rehearseStartupDdl(connection, before, capture, schema) {
  const { default: { Pool } } = await import('pg');
  const pool = new Pool({ host: connection.host, port: Number(connection.port), user: connection.user, password: connection.password, database: connection.database, max: 2, connectionTimeoutMillis: 10_000, ...(schema ? { options: '-c search_path=' + schema } : {}) });
  pool.on('error', () => {});
  try {
    await PostgreSQLSessionStore.open({ pool, expectedSchema: schema });
  } catch (error) {
    return [check('VERIFY_STARTUP_DDL', 'FAIL', 'server migration failed on the copy: ' + safeCode(error))];
  } finally {
    await pool.end().catch(() => {});
  }
  const after = await capture();
  const now = new Map(after.tables.map((t) => [key(t), t]));
  const changed = before.tables.filter((t) => !now.has(key(t)) || now.get(key(t)).digest !== t.digest || now.get(key(t)).rows !== t.rows).map(key);
  const known = new Set(before.tables.map(key));
  const added = after.tables.map(key).filter((k) => !known.has(k));
  return [check('VERIFY_STARTUP_DDL', changed.length ? 'FAIL' : 'PASS', changed.length ? 'startup changed existing rows in: ' + changed.join(', ') : `server migration kept existing rows; added tables [${added}]`)];
}

/** One schema's part of a whole-database manifest, so it can be compared with a server that also holds other schemas. */
export function scopeManifest(manifest, schema) {
  const inSchema = (name) => name.startsWith(schema + '.');
  const s = manifest.structure ?? {};
  return {
    ...manifest,
    tables: manifest.tables.filter((t) => t.schema === schema),
    structure: {
      schemas: (s.schemas ?? []).filter((x) => x.name === schema), columns: (s.columns ?? []).filter((x) => inSchema(x.relation)),
      constraints: (s.constraints ?? []).filter((x) => inSchema(x.relation)), indexes: (s.indexes ?? []).filter((x) => inSchema(x.name)),
      sequences: (s.sequences ?? []).filter((x) => inSchema(x.name)), triggers: (s.triggers ?? []).filter((x) => inSchema(x.relation)),
      functions: (s.functions ?? []).filter((x) => inSchema(x.name)), extensions: [],
    },
  };
}

/**
 * Moves the CarScope tables of a rehearsal copy from public into a private schema, in one transaction, and proves that
 * rows and definitions are unchanged. Only a rehearsal database qualifies; the archive of the result is what S3 restores.
 */
export async function runRelocate({ url, schema, env = process.env }) {
  let connection, target;
  try {
    connection = assertRehearsalTarget(url, env);
    target = assertPrivateSchemaName(schema);
  } catch (error) {
    return { checks: [check('RELOCATE_POLICY', 'FAIL', safeCode(error))] };
  }
  const checks = [check('RELOCATE_POLICY', 'PASS', 'loopback rehearsal database')];
  let db;
  try {
    db = await openClient(connection);
  } catch (error) {
    return { checks: [...checks, check('RELOCATE_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))] };
  }
  try {
    await db.query('BEGIN');
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r) => r.tablename);
    const foreign = tables.filter((t) => !/^cs_[a-z0-9_]+$/.test(t));
    if (foreign.length || !tables.includes('cs_sessions')) throw Object.assign(new Error(), { code: foreign.length ? 'PUBLIC_HOLDS_OTHER_TABLES' : 'NO_CARSCOPE_TABLES' });
    const before = await captureState(db);
    await db.query('CREATE SCHEMA ' + target);
    for (const table of tables) await db.query(`ALTER TABLE public.${table} SET SCHEMA ${target}`);
    const after = await captureState(db);
    const moved = (value) => JSON.stringify(value).replaceAll('public.', target + '.');
    const sameStructure = STRUCTURE_KEYS.filter((k) => k !== 'schemas').every((k) => moved(before.structure[k]) === JSON.stringify(after.structure[k]));
    const sameRows = JSON.stringify(before.tables.map((t) => [t.name, t.rows, t.digest])) === JSON.stringify(after.tables.map((t) => [t.name, t.rows, t.digest]));
    if (!sameStructure || !sameRows || after.tables.some((t) => t.schema !== target)) throw Object.assign(new Error(), { code: 'RELOCATE_CHANGED_DATA' });
    await db.query('COMMIT');
    const rows = after.tables.reduce((n, t) => n + t.rows, 0);
    checks.push(check('RELOCATE_APPLY', 'PASS', `${tables.length} tables, ${rows} rows moved to ${target}; rows and definitions unchanged`));
    return { checks };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    checks.push(check('RELOCATE_APPLY', 'FAIL', 'nothing changed: ' + safeCode(error)));
    return { checks };
  } finally {
    await db.end().catch(() => {});
  }
}

/**
 * Read-only comparison of one schema with a manifest. It may read a remote server under the same dated approval as a
 * backup, and it has no statement that writes: this is how a separately approved restore is checked before cutover.
 */
export async function runCompare({ archive, url, schema, caPemBase64, allowRemoteReadOnly = false, approvedOn, now = Date.now, env = process.env }) {
  let source, manifest, target;
  try {
    source = assertBackupSource(url, { allowRemoteReadOnly, g3ApprovedOn: approvedOn, now, env });
    target = assertPrivateSchemaName(schema);
    manifest = readManifest(archive);
  } catch (error) {
    return { checks: [check('COMPARE_POLICY', 'FAIL', safeCode(error))] };
  }
  const checks = [check('COMPARE_POLICY', source.scope === 'ISOLATED_LOOPBACK' ? 'PASS' : 'MANUAL', source.scope === 'ISOLATED_LOOPBACK' ? 'loopback server' : 'remote server under a dated approval, read only')];
  let db;
  try {
    db = await openClient(source.connection, { caPemBase64 });
  } catch (error) {
    return { checks: [...checks, check('COMPARE_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))] };
  }
  const pool = { connect: async () => ({ query: (...a) => db.query(...a), release: () => {} }) };
  try {
    await db.query('BEGIN TRANSACTION READ ONLY');
    let state;
    try { state = await captureState(db, { schema: target }); } finally { await db.query('ROLLBACK').catch(() => {}); }
    checks.push(...compareState(scopeManifest(manifest, target), state));
    checks.push(...(await inspectDatabase(pool, { expectedSchema: target, requireTls: !source.connection.loopback })).map((c) => ({ ...c, id: 'COMPARE_' + c.id })));
    return { checks };
  } catch (error) {
    checks.push(check('COMPARE', 'FAIL', 'comparison failed: ' + safeCode(error)));
    return { checks };
  } finally {
    await db.end().catch(() => {});
  }
}

/** Base for every verdict: a skipped or failed check can never be reported as a completed rehearsal. */
export function recoveryVerdict(checks, scope) {
  const blocking = checks.filter((c) => ['FAIL', 'BLOCKED'].includes(c.status));
  if (blocking.length) return 'RECOVERY_NOT_VERIFIED';
  if (checks.find((c) => c.id === 'VERIFY_STARTUP_DDL')?.status !== 'PASS') return 'RECOVERY_NOT_VERIFIED';
  return scope === 'REMOTE_READ_ONLY' ? 'G3_REHEARSAL_VERIFIED' : 'LOCAL_BACKUP_RESTORE_PASS';
}
