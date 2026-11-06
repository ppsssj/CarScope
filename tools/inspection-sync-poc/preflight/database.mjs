// Read-only schema inspection. Everything runs inside BEGIN READ ONLY and ends in ROLLBACK: this module has no
// migration path, and PostgreSQL itself refuses a write in this transaction. It reads catalog facts and row counts
// only, never session or record contents.
import { check, safeCode } from './report.mjs';
import { schemaInventory } from './static-gates.mjs';
import { assertPrivateSchemaName, decodeCaCertificate } from '../src/database-config.mjs';

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const VERIFIED_MAJORS = Object.freeze([16, 17]);
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const HISTORY_COLUMNS = Object.freeze([
  'record_id', 'inspection_id', 'sync_session_id', 'task_id', 'part_id', 'schema_version', 'inspection_status', 'original_result',
  'result_digest', 'completed_at', 'received_at', 'accepted_at', 'authority_namespace', 'authority_issuer', 'user_id', 'vehicle_id',
  'device_id', 'registration_id', 'binding_verified_at', 'created_at',
]);

/** True only for a loopback database. Used by the CLI gate and by every integration test in this tool. */
export function isLoopbackUrl(url) {
  try { return LOOPBACK_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

/** Refuses the two ways a test can reach a shared database: a remote host, or the same URL as a service variable. */
export function assertIsolatedTestDatabase(url, env = process.env) {
  if (!isLoopbackUrl(url)) throw new Error('TEST_DATABASE_MUST_BE_LOOPBACK');
  for (const name of ['DATABASE_URL', 'PG_ADMIN_DATABASE_URL']) if (env[name] && env[name] === url) throw new Error('TEST_DATABASE_EQUALS_SERVICE_DATABASE');
}

function schemaCheck(id, inventory, present, version, { pendingStatus, pendingDetail }) {
  const wanted = [...inventory.tables, ...inventory.indexes.map((x) => x.name)];
  const missing = wanted.filter((name) => !present.get(name));
  if (missing.length === wanted.length) return check(id, pendingStatus, pendingDetail, { state: 'PENDING', ddl: wanted });
  if (missing.length) return check(id, 'FAIL', 'partial schema, missing: ' + missing.join(', '), { state: 'PARTIAL' });
  if (version === null) return check(id, 'FAIL', 'version row missing', { state: 'MISSING_META' });
  if (version !== 1) return check(id, 'FAIL', `version ${version} is not supported by this tree`, { state: 'UNSUPPORTED' });
  return check(id, 'PASS', 'all objects present, version 1', { state: 'APPLIED' });
}

async function metaVersion(client, table, present) {
  if (!present.get(table)) return null;
  const r = await client.query(`SELECT version FROM ${table} WHERE id=1`);
  return r.rows.length === 1 ? Number(r.rows[0].version) : null;
}

/**
 * What makes a schema private on a platform with a Data API. The Data API setting itself is outside PostgreSQL's view,
 * so it stays a dashboard item in the checklist. Absent platform roles cannot be judged, which is never a pass.
 */
export async function privateSchemaChecks(client, schema) {
  const out = [];
  const current = (await client.query('SELECT current_schema() AS name')).rows[0]?.name;
  out.push(check('DB_PRIVATE_SCHEMA', current === schema ? 'PASS' : 'FAIL', current === schema ? `search_path resolves to ${schema}` : 'search_path does not resolve to the expected schema: the server would refuse to start'));
  const leaked = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cs\\_%'")).rows.map((r) => r.tablename);
  out.push(check('DB_PUBLIC_HOLDS_NO_CARSCOPE', leaked.length ? 'FAIL' : 'PASS', leaked.length ? 'CarScope tables in public: ' + leaked.join(', ') : 'no CarScope table in public'));
  // A privilege function raises an error on a schema that does not exist, which would hide every later check.
  const exists = (await client.query('SELECT to_regnamespace($1) IS NOT NULL AS found', [schema])).rows[0].found;
  const roles = (await client.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [API_ROLES])).rows.map((r) => r.rolname);
  const allowed = [];
  for (const role of exists ? roles : []) {
    const r = (await client.query(`SELECT has_schema_privilege($1,$2,'USAGE') OR has_schema_privilege($1,$2,'CREATE') AS schema_access,
      EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname=$2 AND has_table_privilege($1,format('%I.%I',t.schemaname,t.tablename),'SELECT,INSERT,UPDATE,DELETE')) AS table_access`, [role, schema])).rows[0];
    if (r.schema_access || r.table_access) allowed.push(role);
  }
  const missing = API_ROLES.filter((r) => !roles.includes(r));
  out.push(check('DB_API_ROLES_DENIED', !exists ? 'NOT_RUN' : allowed.length ? 'FAIL' : missing.length ? 'MANUAL' : 'PASS', !exists ? 'the schema does not exist yet' : allowed.length ? 'can reach the schema: ' + allowed.join(', ') : missing.length ? 'not on this server, so not judged: ' + missing.join(', ') : API_ROLES.join(', ') + ' cannot reach the schema'));
  const attributes = (await client.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0] ?? {};
  const excess = Object.entries(attributes).filter(([, on]) => on).map(([name]) => name);
  out.push(check('DB_ROLE_ATTRIBUTES', excess.length ? 'FAIL' : 'PASS', excess.length ? 'role holds: ' + excess.join(', ') : 'no superuser, role, database, replication or RLS bypass attribute'));
  return out;
}

/** @param pool a pg Pool/Client factory owned by the caller; connection details never enter a result. */
export async function inspectDatabase(pool, { expectedSchema = null, requireTls = false } = {}) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    return [check('DB_CONNECT', 'BLOCKED', 'cannot connect: ' + safeCode(error))];
  }
  const out = [check('DB_CONNECT', 'PASS', 'connected')];
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    const readOnly = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
    out.push(check('DB_INSPECTION_READ_ONLY', readOnly === 'on' ? 'PASS' : 'FAIL', 'transaction_read_only=' + readOnly));
    if (readOnly !== 'on') return out;

    const major = Math.floor(Number((await client.query("SELECT current_setting('server_version_num') AS v")).rows[0].v) / 10000);
    const verified = VERIFIED_MAJORS.includes(major);
    out.push(check('DB_POSTGRES_VERSION', verified ? 'PASS' : 'MANUAL', verified ? `PostgreSQL ${major}, a CI-verified major version` : `PostgreSQL ${major}: CI verified only ${VERIFIED_MAJORS.join(' and ')}`));
    if (expectedSchema !== null || requireTls) {
      const tls = (await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl === true;
      out.push(check('DB_TLS_IN_USE', tls ? 'PASS' : requireTls ? 'FAIL' : 'MANUAL', tls ? 'this connection uses TLS' : 'this connection is not encrypted'));
    }
    if (expectedSchema !== null) out.push(...await privateSchemaChecks(client, expectedSchema));

    const inventory = schemaInventory();
    const names = Object.values(inventory).flatMap((x) => [...x.tables, ...x.indexes.map((i) => i.name)]);
    const present = new Map();
    for (const name of names) present.set(name, (await client.query('SELECT to_regclass($1) IS NOT NULL AS found', [name])).rows[0].found);

    const firstDeploy = inventory.base.tables.every((t) => !present.get(t));
    out.push(schemaCheck('DB_BASE_SCHEMA', inventory.base, present, await metaVersion(client, 'cs_schema_meta', present), {
      pendingStatus: 'MANUAL', pendingDetail: 'empty database: the first server start creates the base schema',
    }));
    const history = schemaCheck('DB_HISTORY_MIGRATION', inventory.history, present, await metaVersion(client, 'cs_history_schema_meta', present), {
      pendingStatus: 'MANUAL', pendingDetail: 'migration pending: the next server start applies it. Back up first; this tool applied nothing',
    });
    out.push(history);
    if (history.state === 'APPLIED') {
      const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='cs_inspection_records'")).rows.map((r) => r.column_name);
      const missing = HISTORY_COLUMNS.filter((c) => !columns.includes(c)), extra = columns.filter((c) => !HISTORY_COLUMNS.includes(c));
      out.push(check('DB_HISTORY_COLUMNS', missing.length || extra.length ? 'FAIL' : 'PASS', missing.length || extra.length ? `missing [${missing}] extra [${extra}]` : '20 expected columns'));
    }
    out.push(check('DB_AVD_SCHEMA', inventory.avd.tables.every((t) => present.get(t)) ? 'PASS' : 'MANUAL',
      inventory.avd.tables.every((t) => present.get(t)) ? 'simulator tables present (no real-vehicle ownership meaning)' : 'simulator tables absent: created only when simulator mode or the admin CLI starts'));

    // initialize() re-executes CREATE ... IF NOT EXISTS on every start. PostgreSQL checks schema privilege and
    // table ownership before it can skip an existing object, so a non-owner role fails even after migration.
    const canCreate = (await client.query("SELECT has_schema_privilege(current_schema(),'CREATE') AS ok")).rows[0].ok;
    const existing = inventory.base.tables.concat(inventory.history.tables).filter((t) => present.get(t));
    const notOwned = [];
    for (const table of existing) {
      const owned = (await client.query('SELECT pg_get_userbyid(relowner)=current_user AS ok FROM pg_class WHERE oid=to_regclass($1)', [table])).rows[0]?.ok;
      if (!owned) notOwned.push(table);
    }
    out.push(check('DB_STARTUP_PRIVILEGE', canCreate && !notOwned.length ? 'PASS' : 'FAIL',
      canCreate && !notOwned.length ? 'this role can run the startup DDL' : `server start would fail: createOnSchema=${canCreate} notOwned=[${notOwned}]`));

    const superuser = (await client.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0]?.rolsuper;
    if (superuser) out.push(check('DB_LEAST_PRIVILEGE', 'MANUAL', 'connected role is a superuser: acceptable only on a disposable database'));

    const count = async (table) => (present.get(table) ? Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n) : null);
    out.push(check('DB_ROW_COUNTS', 'PASS', `sessions=${await count('cs_sessions')} records=${await count('cs_inspection_records')} (counts only)`));
    out.push(check('DB_FIRST_DEPLOY', firstDeploy ? 'MANUAL' : 'PASS', firstDeploy ? 'no CarScope tables found: confirm this is the intended database' : 'existing CarScope schema found'));
    return out;
  } catch (error) {
    out.push(check('DB_INSPECTION', 'FAIL', 'inspection failed: ' + safeCode(error)));
    return out;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** CLI seam: the URL comes from a named variable and stays out of argv, output and errors. */
export async function inspectDatabaseUrl({ url, allowRemoteReadOnly = false, env = process.env, expectedSchema = null, caPemBase64 = null }) {
  if (!url) return [check('DB_CONNECT', 'NOT_RUN', 'named environment variable is empty')];
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return [check('DB_CONNECT', 'FAIL', 'NODE_TLS_REJECT_UNAUTHORIZED=0 is refused')];
  if (!isLoopbackUrl(url) && !allowRemoteReadOnly) return [check('DB_CONNECT', 'BLOCKED', 'non-loopback database needs the explicit --allow-remote-read-only approval')];
  let Pool;
  try {
    ({ Pool } = (await import('pg')).default);
  } catch {
    return [check('DB_CONNECT', 'BLOCKED', 'pg driver is not installed')];
  }
  let extra = {}, schema = null;
  try {
    schema = expectedSchema === null ? null : assertPrivateSchemaName(expectedSchema);
    if (caPemBase64) {
      if (new URL(url).search) throw new Error('DATABASE_URL_QUERY_REFUSED');
      extra = { ssl: { ca: decodeCaCertificate(caPemBase64), rejectUnauthorized: true } };
    }
  } catch (error) {
    return [check('DB_CONNECT', 'FAIL', safeCode(error))];
  }
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, ...extra });
  pool.on('error', () => {});
  try {
    return await inspectDatabase(pool, { expectedSchema: schema, requireTls: !isLoopbackUrl(url) && Boolean(caPemBase64) });
  } finally {
    await pool.end().catch(() => {});
  }
}
