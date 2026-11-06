// Creates disposable rehearsal databases and fills the source with synthetic rows through the real schema path.
// Every owner, vehicle and token below is generated here: nothing is evidence of a real user or vehicle.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertRehearsalTarget, openClient, parseConnection, REHEARSAL_PREFIX } from './recovery.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { AvdSimulatorCredentialStore } from '../src/avd-simulator-credentials.mjs';
import { SUPPORTED_TASKS } from '../src/protocol.mjs';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const NAME = /^[a-z0-9_]{1,24}$/;
const STATES = Object.freeze(['CREATED', 'CLAIMED', 'RESULT_SUBMITTED', 'ACCEPTED', 'EXPIRED']);

export function rehearsalUrl(adminUrl, database) {
  const u = new URL(adminUrl);
  u.pathname = '/' + database;
  u.search = '';
  return u.href;
}

function ownerColumns(index, registrationId) {
  if (index % 3 === 0) return { namespace: 'VERIFIED_VEHICLE', user: 'synthetic-user-' + index, vehicle: 'synthetic-vehicle-' + index, device: 'synthetic-device-' + index, registration: registrationId, bound: 1_800_000_000_000 };
  if (index % 3 === 1) return { namespace: 'AVD_SIMULATOR', user: null, vehicle: null, device: null, registration: registrationId, bound: 1_800_000_000_000 };
  return { namespace: 'UNVERIFIED', user: null, vehicle: null, device: null, registration: null, bound: null };
}

/** One row per supported task, in all three authority namespaces, with non-ASCII text in JSONB and in a label. */
export async function seedSyntheticData(pool) {
  const { historyResult } = await import('../test/history-fixtures.mjs');
  const sessions = [];
  for (const [i, state] of STATES.entries()) {
    const id = randomUUID(), receiverHash = sha256('synthetic-receiver-' + id);
    const data = { id, state, taskId: 'washer-fluid', createdAt: 1_800_000_000_000 + i, expiresAt: 1_800_001_800_000 + i, inviteExpiresAt: 1_800_000_600_000 + i, receiverHash, note: '합성 세션 ' + i };
    await pool.query('INSERT INTO cs_sessions(id,data) VALUES($1,$2::jsonb)', [id, JSON.stringify(data)]);
    await pool.query("INSERT INTO cs_session_tokens(hash,kind,session_id) VALUES($1,'receiver',$2)", [receiverHash, id]);
    sessions.push(data);
  }
  await pool.query('INSERT INTO cs_rate_windows(key,count,expires_at) VALUES($1,1,1800000000000),($2,7,1800000060000),($3,2,1800000120000)', [sha256('rate-a'), sha256('rate-b'), sha256('rate-c')]);
  const registration = randomUUID();
  await pool.query('INSERT INTO cs_avd_registrations(id,label,enrollment_hash,created_at,expires_at) VALUES($1,$2,$3,1800000000000,1800003600000)', [registration, '합성 리허설 등록', sha256(randomBytes(32).toString('hex'))]);
  await pool.query('INSERT INTO cs_avd_creation_grants(id,registration_id,token_hash,issued_at,expires_at) VALUES($1,$2,$3,1800000000000,1800000120000)', [randomUUID(), registration, sha256(randomBytes(32).toString('hex'))]);
  const records = [];
  for (const [i, task] of SUPPORTED_TASKS.entries()) {
    const result = historyResult(task, { completedAt: 1_800_000_000_000 + i * 1000 });
    const owner = ownerColumns(i, registration), id = randomUUID();
    const partId = task === 'washer-fluid' ? 'washer-fluid-cap' : task === 'brake-fluid' ? 'brake-fluid-reservoir' : task;
    await pool.query(`INSERT INTO cs_inspection_records(record_id,inspection_id,sync_session_id,task_id,part_id,schema_version,inspection_status,original_result,result_digest,completed_at,received_at,accepted_at,authority_namespace,authority_issuer,user_id,vehicle_id,device_id,registration_id,binding_verified_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [
      id, result.inspectionId, randomUUID(), task, partId, result.schemaVersion, result.status, JSON.stringify(result),
      'sha256:' + sha256(JSON.stringify(result)), Date.parse(result.completedAt), 1_800_000_500_000 + i, 1_800_000_600_000 + i,
      owner.namespace, 'https://synthetic-issuer.invalid/', owner.user, owner.vehicle, owner.device, owner.registration, owner.bound, 1_800_000_700_000 + i,
    ]);
    records.push({ id, task, result });
  }
  return { sessions, records, registration };
}

/** Applies the same statements the server and the admin CLI apply, so a rehearsal covers all three schema files. */
export async function applyCarScopeSchema(pool) {
  const store = await PostgreSQLSessionStore.open({ pool });
  await new AvdSimulatorCredentialStore({ pool }).initialize();
  return store;
}

/** Creates `<name>_source` (schema and synthetic rows) and an empty `<name>_target`. An existing database stops it. */
export async function createIsolated({ adminUrl, name, env = process.env }) {
  if (!NAME.test(name ?? '')) throw new Error('REHEARSAL_NAME_INVALID');
  const admin = parseConnection(adminUrl);
  if (env.RENDER) throw new Error('RESTORE_ON_RENDER_FORBIDDEN');
  if (!admin.loopback) throw new Error('RESTORE_TARGET_MUST_BE_LOOPBACK');
  const source = `${REHEARSAL_PREFIX}${name}_source`, target = `${REHEARSAL_PREFIX}${name}_target`;
  const sourceUrl = rehearsalUrl(adminUrl, source), targetUrl = rehearsalUrl(adminUrl, target);
  assertRehearsalTarget(sourceUrl, env);
  assertRehearsalTarget(targetUrl, env);
  const db = await openClient(admin);
  try {
    await db.query(`CREATE DATABASE ${source}`);
    await db.query(`CREATE DATABASE ${target}`);
  } finally {
    await db.end().catch(() => {});
  }
  const { default: { Pool } } = await import('pg');
  const pool = new Pool({ connectionString: sourceUrl, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => {});
  try {
    await applyCarScopeSchema(pool);
    const seeded = await seedSyntheticData(pool);
    return { source, target, sessions: seeded.sessions.length, records: seeded.records.length };
  } finally {
    await pool.end().catch(() => {});
  }
}
