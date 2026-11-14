#!/usr/bin/env node
// P22: operator-only diagnosis of the AVD → Vision QR path. Read-only by default.
// Never prints, logs or writes an enrollment proof, a stored hash, a grant, a receiver/invite token or a DB URL.
// The proof is read from the Debug app's private file into this process's memory and compared there.
// Live checks are separate, explicit approvals: --approve-provision (one POST /simulator/provision, which writes one
// short-lived grant row) and --approve-session (one session, cancelled again at once). Each is rate-guarded locally.
import { createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', NOT_RUN: 'NOT_RUN' });
const PACKAGE = 'io.carscope.app';
const MAIN_ORIGIN = 'https://carscope-lluo.onrender.com';
const MODE = 'OPERATOR_APPROVED_AVD_SIMULATION';
const AUDIENCE = 'carscope-avd-simulator';
const SCOPE = 'inspection:session:create';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const GRANT_MAX_TTL_MS = 120_000;
const ENROLLMENT_MAX_TTL_MS = 86_400_000;
/** Provision is limited to 4 per minute per proof on the server; one live test per minute keeps well inside it. */
export const LIVE_GUARD_MS = 60_000;

/** Every cause the diagnosis can name, with the operator fix. Public HTTP answers stay the generic 401/403. */
export const CAUSES = Object.freeze({
  AVD_NOT_CONNECTED: 'Start the AVD and check `adb devices` shows the serial as "device".',
  AVD_NOT_BOOTED: 'Wait until the AVD finishes booting (sys.boot_completed=1).',
  APK_MISSING: 'Install the Debug APK for this Android user. Do not uninstall: that deletes the private files.',
  APK_NOT_DEBUGGABLE: 'Install the Debug APK (run-as needs a debuggable build).',
  ENDPOINT_MISSING: 'Run setup-avd-simulator.ps1 -Action Endpoint -VisionOrigin <origin>.',
  ORIGIN_MISMATCH: 'sync-endpoint.json must hold exactly the Vision origin (apiOrigin, mobileRoot with a trailing /).',
  APK_ORIGIN_MISMATCH: 'Rebuild the Debug APK with -PcarscopeVisionOrigin=<origin>; this APK does not allow that origin.',
  SERVER_STARTING: 'The service answered 502/503/504 (starting or unavailable). Wait and run the diagnosis again; this is not an authentication result.',
  SERVER_TIMEOUT: 'The service did not answer in time. Check the Render service state and logs.',
  NETWORK_TLS: 'DNS, TCP or TLS failed. Check the origin spelling, network and certificate.',
  NOT_SIMULATION_MODE: 'The service is not in STATEFUL_AVD_SIMULATION / OPERATOR_APPROVED_AVD_ONLY. That is a separate operator approval on Render.',
  NOT_VISION_SERVICE: 'This origin is not the Vision experiment service (healthz vision != EXPERIMENT).',
  ENROLLMENT_MISSING: 'No enrollment on the device for this origin. Issue one with setup-avd-simulator.ps1 -VisionOrigin (operator approval).',
  ENROLLMENT_PERMISSIONS: 'The enrollment file must be mode 600 and 1..512 bytes.',
  ENROLLMENT_INVALID: 'The enrollment file is not the expected JSON. Re-issue it (operator approval).',
  ENROLLMENT_EXPIRED: 'The enrollment expired. Issue a new one (operator approval); the old registration stays as audit metadata.',
  STATE_MISMATCH: 'The device holds a different registration than the operator state file. Check which registration is current before revoking anything.',
  CLOCK_SKEW: 'Device and server clocks differ. Fix the AVD time (automatic time) before testing grants.',
  DB_NOT_PROVIDED: 'Provide the Vision service DB URL (hidden prompt or PG_VISION_DATABASE_URL) to run the read-only DB checks.',
  DB_CONNECT_FAILED: 'Could not open a verified TLS connection with the given URL, CA and schema.',
  SCHEMA_MISMATCH: 'The DB session schema is not the expected one. Use the Vision service role and its CARSCOPE_DB_SCHEMA.',
  TABLES_MISSING: 'cs_avd_* tables are missing in this schema: this is not the database the Vision service initialised.',
  DB_PERMISSIONS: 'This role lacks the privileges the service needs on cs_avd_* tables.',
  NO_REGISTRATION: 'This DB/schema has no row for the device registration or proof. The enrollment was most likely issued into a different database or schema than the Vision service reads (for example the main carscope schema instead of the Vision schema). Re-issue against the Vision DB and schema (operator approval).',
  PROOF_MISMATCH: 'The registration exists but the device proof does not match its stored hash. The device file was replaced or copied from another issue. Re-issue (operator approval).',
  REVOKED: 'The registration was revoked on the server. Issue a new one (operator approval). Remove the stale device file with setup-avd-simulator.ps1 -Action Remove only after confirming it is this registration.',
  EXPIRED: 'The registration expired on the server clock. Issue a new one (operator approval).',
  STORE_MISMATCH: 'The DB you checked holds a valid, active registration but the service still rejects it: the service reads a different database or schema. Compare the service DATABASE_URL/CARSCOPE_DB_SCHEMA with the ones used to issue.',
  AUTH_REJECTED: 'The service rejected the proof (401). Run the DB checks to name the cause.',
  RATE_LIMITED: 'The service rate limit answered 429. Wait at least a minute; do not retry in a loop.',
  REQUEST_ORIGIN_REJECTED: 'The service answered 400 for the provision payload: its public origin (RENDER_EXTERNAL_URL) differs from this origin.',
  GRANT_INVALID: 'The grant response failed the app contract (mode, origin, audience, scope, ids, TTL). Check the server version.',
  LIVE_GUARD: 'A live test ran less than a minute ago. Wait before running it again.',
  SESSION_REJECTED: 'Session creation with a fresh grant was refused. Check the service logs; no QR can be made.',
  SESSION_INVALID: 'The session response failed its shape checks.',
});

const check = (id, title, status, cause = null, detail = null) => ({ id, title, status, cause, detail, fix: cause ? CAUSES[cause] : null });
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/** Kotlin AvdSimulatorPolicy.grant(), mirrored: the same fields and rules the app applies before it trusts a grant. */
export function grantProblem(grant, { origin, registrationId, at }) {
  const keys = ['mode', 'apiOrigin', 'audience', 'scope', 'credential', 'credentialId', 'issuedAt', 'notBefore', 'expiresAt', 'registrationId', 'simulatorApproved', 'realVehicleOwnershipVerified'];
  if (!grant || typeof grant !== 'object' || Object.keys(grant).length !== keys.length || !keys.every((k) => Object.hasOwn(grant, k))) return 'GRANT_INVALID';
  if (grant.mode !== MODE || grant.apiOrigin !== origin || grant.audience !== AUDIENCE || grant.scope !== SCOPE ||
      grant.simulatorApproved !== true || grant.realVehicleOwnershipVerified !== false) return 'GRANT_INVALID';
  const n = (x) => Number.isSafeInteger(x);
  if (!TOKEN.test(grant.credential ?? '') || !UUID.test(grant.credentialId ?? '') || grant.registrationId !== registrationId ||
      !n(grant.issuedAt) || !n(grant.notBefore) || !n(grant.expiresAt) || grant.issuedAt > grant.notBefore ||
      grant.expiresAt <= grant.notBefore || grant.expiresAt - grant.issuedAt > GRANT_MAX_TTL_MS) return 'GRANT_INVALID';
  // The app waits up to 3 s for notBefore; beyond that it is a clock problem, not a contract one.
  if (grant.notBefore > at + 3000 || grant.expiresAt <= at) return 'CLOCK_SKEW';
  return null;
}

/** Classifies a fetch failure without echoing its message. */
export function networkCause(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'SERVER_TIMEOUT';
  return 'NETWORK_TLS';
}

/** Searches the dex files of an APK (a zip) for an exact UTF-8 string. Only stored or deflated entries; no extraction to disk. */
export function apkContains(zip, needle) {
  const target = Buffer.from(needle, 'utf8');
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) !== 0x06054b50) continue;
    let p = zip.readUInt32LE(i + 16);
    const count = zip.readUInt16LE(i + 10);
    for (let e = 0; e < count && zip.readUInt32LE(p) === 0x02014b50; e++) {
      const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), nameLen = zip.readUInt16LE(p + 28),
        extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32), local = zip.readUInt32LE(p + 42);
      const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (!/^classes\d*\.dex$/.test(name)) continue;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      const dex = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
      if (dex && dex.includes(target)) return true;
    }
    return false;
  }
  throw new Error('APK_NOT_A_ZIP');
}

/**
 * Runs every check in order and returns { checks, final, firstFailure }. Nothing secret is in the result.
 * deps: { adb(args, opts) → {code, stdout: Buffer|string}, fetch, openPool() → pool|null, now(), guard: {last(kind), mark(kind)}, pullApk(path) → Buffer|null }
 */
export async function diagnose(options, deps) {
  const { serial, origin, schema, approveProvision = false, approveSession = false, stateRegistrationId = null, skipApkOrigin = false } = options;
  const now = deps.now ?? Date.now;
  const checks = [];
  const add = (c) => { checks.push(c); return c; };
  const sh = async (cmd) => deps.adb(['-s', serial, 'shell', cmd]);
  const text = (r) => String(r?.stdout ?? '').replace(/\r/g, '').trim();
  let user = null, enrollment = null, serverSkewMs = null, dbState = null, grant = null;

  // 1. AVD
  const state = await deps.adb(['-s', serial, 'get-state']).catch(() => ({ code: 1 }));
  if (state.code !== 0 || text(state) !== 'device') add(check('AVD_CONNECTED', 'AVD connected', STATUS.FAIL, 'AVD_NOT_CONNECTED'));
  else {
    const booted = text(await sh('getprop sys.boot_completed'));
    user = text(await sh('am get-current-user'));
    if (booted !== '1' || !/^\d+$/.test(user)) add(check('AVD_CONNECTED', 'AVD connected', STATUS.FAIL, 'AVD_NOT_BOOTED'));
    else add(check('AVD_CONNECTED', 'AVD connected', STATUS.PASS, null, `user ${user}`));
  }
  const avdOk = checks[0].status === STATUS.PASS;

  // 2. Debug APK
  let apkPath = null;
  if (!avdOk) add(check('DEBUG_APK', 'Debug APK installed', STATUS.NOT_RUN));
  else {
    const path = text(await sh(`pm path --user ${user} ${PACKAGE}`));
    apkPath = /^package:(\S+\.apk)$/m.exec(path)?.[1] ?? null;
    if (!apkPath) add(check('DEBUG_APK', 'Debug APK installed', STATUS.FAIL, 'APK_MISSING'));
    else if ((await sh(`run-as ${PACKAGE} --user ${user} true`)).code !== 0) add(check('DEBUG_APK', 'Debug APK installed', STATUS.FAIL, 'APK_NOT_DEBUGGABLE'));
    else add(check('DEBUG_APK', 'Debug APK installed', STATUS.PASS));
  }
  const appOk = checks[1].status === STATUS.PASS;
  const runAs = (cmd) => sh(`run-as ${PACKAGE} --user ${user} ${cmd}`);

  // 3. Origin: the private endpoint file and the APK's compiled experiment origin.
  if (!appOk) add(check('VISION_ORIGIN', 'Vision Origin configured', STATUS.NOT_RUN));
  else {
    let endpoint = null;
    try { endpoint = JSON.parse(text(await runAs('cat files/sync-endpoint.json')).replace(/^\uFEFF/, '')); } catch { /* missing or not JSON */ }
    if (!endpoint) add(check('VISION_ORIGIN', 'Vision Origin configured', STATUS.FAIL, 'ENDPOINT_MISSING'));
    else if (Object.keys(endpoint).sort().join() !== 'apiOrigin,mobileRoot' || endpoint.apiOrigin !== origin || endpoint.mobileRoot !== origin + '/')
      add(check('VISION_ORIGIN', 'Vision Origin configured', STATUS.FAIL, 'ORIGIN_MISMATCH', `endpoint apiOrigin=${String(endpoint.apiOrigin).slice(0, 80)}`));
    else if (origin === MAIN_ORIGIN || skipApkOrigin) add(check('VISION_ORIGIN', 'Vision Origin configured', STATUS.PASS, null, origin === MAIN_ORIGIN ? 'main origin' : 'endpoint only (APK origin not checked)'));
    else {
      let inApk = null;
      try { const apk = await deps.pullApk(apkPath); inApk = apk ? apkContains(apk, origin) : null; } catch { inApk = null; }
      if (inApk === false) add(check('VISION_ORIGIN', 'Vision Origin configured', STATUS.FAIL, 'APK_ORIGIN_MISMATCH'));
      else add(check('VISION_ORIGIN', 'Vision Origin configured', inApk ? STATUS.PASS : STATUS.WARN, null, inApk ? 'endpoint and APK' : 'endpoint ok; APK origin not verified'));
    }
  }

  // 4. Health (read-only GET; touches no table but `SELECT current_schema()`).
  try {
    const res = await deps.fetch(origin + '/healthz', { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    const date = Date.parse(res.headers.get('date') ?? '');
    if (Number.isFinite(date)) serverSkewMs = now() - date;
    if ([502, 503, 504].includes(res.status)) add(check('VISION_HEALTH', 'Vision server healthy', STATUS.FAIL, 'SERVER_STARTING', `HTTP ${res.status}`));
    else {
      const h = res.status === 200 ? await res.json().catch(() => null) : null;
      if (!h || h.status !== 'UP') add(check('VISION_HEALTH', 'Vision server healthy', STATUS.FAIL, 'SERVER_STARTING', `HTTP ${res.status}`));
      else if (h.mode !== 'STATEFUL_AVD_SIMULATION' || h.sessionCreation !== 'OPERATOR_APPROVED_AVD_ONLY') add(check('VISION_HEALTH', 'Vision server healthy', STATUS.FAIL, 'NOT_SIMULATION_MODE'));
      else if (origin !== MAIN_ORIGIN && h.vision !== 'EXPERIMENT') add(check('VISION_HEALTH', 'Vision server healthy', STATUS.FAIL, 'NOT_VISION_SERVICE'));
      else add(check('VISION_HEALTH', 'Vision server healthy', STATUS.PASS, null, `vision=${h.vision ?? 'n/a'} detection=${h.detection ?? 'n/a'}`));
    }
  } catch (e) { add(check('VISION_HEALTH', 'Vision server healthy', STATUS.FAIL, networkCause(e))); }

  // 5. Enrollment file (read into memory only).
  const file = origin === MAIN_ORIGIN ? 'avd-simulator-enrollment.json' : 'avd-vision-enrollment.json';
  if (!appOk) add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.NOT_RUN));
  else {
    const shape = text(await runAs(`sh -c 'if [ -f files/${file} ]; then stat -c %a:%s files/${file}; else echo missing; fi'`));
    const m = /^(\d+):(\d+)$/.exec(shape);
    if (shape === 'missing' || !m) add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.FAIL, 'ENROLLMENT_MISSING', file));
    else if (m[1] !== '600' || +m[2] < 1 || +m[2] > 512) add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.FAIL, 'ENROLLMENT_PERMISSIONS', `${file} ${shape}`));
    else {
      let x = null;
      try { x = JSON.parse(String((await runAs(`cat files/${file}`)).stdout ?? '').replace(/^\uFEFF/, '')); } catch { /* invalid */ }
      const at = now();
      const deviceSeconds = Number(text(await sh('date +%s')));
      const deviceSkewMs = Number.isFinite(deviceSeconds) ? deviceSeconds * 1000 - at : null;
      const keysOk = x && Object.keys(x).sort().join() === 'enrollmentProof,expiresAt,mode,registrationId';
      if (!keysOk || x.mode !== MODE || !UUID.test(x.registrationId) || !TOKEN.test(x.enrollmentProof) || !Number.isSafeInteger(x.expiresAt))
        add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.FAIL, 'ENROLLMENT_INVALID', file));
      else if (x.expiresAt <= at || x.expiresAt - at > ENROLLMENT_MAX_TTL_MS)
        add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.FAIL, 'ENROLLMENT_EXPIRED', `registration ${x.registrationId}`));
      else {
        enrollment = { registrationId: x.registrationId, expiresAt: x.expiresAt, proof: x.enrollmentProof };
        const skew = Math.max(Math.abs(deviceSkewMs ?? 0), Math.abs(serverSkewMs ?? 0));
        const detail = `registration ${x.registrationId}, expires ${new Date(x.expiresAt).toISOString()}, device skew ${deviceSkewMs == null ? 'n/a' : Math.round(deviceSkewMs / 1000) + 's'}, server skew ${serverSkewMs == null ? 'n/a' : Math.round(serverSkewMs / 1000) + 's'}`;
        if (skew > 60_000) add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.FAIL, 'CLOCK_SKEW', detail));
        else if (stateRegistrationId && stateRegistrationId !== x.registrationId) add(check('ENROLLMENT_FILE', 'Enrollment file valid', STATUS.WARN, 'STATE_MISMATCH', detail));
        else add(check('ENROLLMENT_FILE', 'Enrollment file valid', skew > 3000 ? STATUS.WARN : STATUS.PASS, skew > 3000 ? 'CLOCK_SKEW' : null, detail));
      }
    }
  }

  // 6–9. Database, read-only transaction. The proof hash is computed and compared here and never leaves.
  let pool = null;
  try { pool = enrollment ? await deps.openPool() : null; } catch { pool = undefined; }
  const dbTitles = [['REGISTRATION_EXISTS', 'Registration exists in DB'], ['REGISTRATION_ACTIVE', 'Registration active'], ['PROOF_MATCH', 'Enrollment proof matches DB'], ['DB_PERMISSIONS', 'Database permissions']];
  if (!enrollment) dbTitles.forEach(([id, t]) => add(check(id, t, STATUS.NOT_RUN)));
  else if (pool === null) dbTitles.forEach(([id, t]) => add(check(id, t, STATUS.NOT_RUN, 'DB_NOT_PROVIDED')));
  else if (pool === undefined) { add(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.FAIL, 'DB_CONNECT_FAILED')); dbTitles.slice(1).forEach(([id, t]) => add(check(id, t, STATUS.NOT_RUN))); }
  else {
    const db = [];
    const put = (x) => db.push(x);
    let c = null;
    try {
      c = await pool.connect();
      await c.query('BEGIN TRANSACTION READ ONLY');
      const who = (await c.query("SELECT current_user AS role, current_schema() AS name, (extract(epoch from clock_timestamp())*1000)::bigint AS at, to_regclass('cs_avd_registrations') IS NOT NULL AS regs, to_regclass('cs_avd_creation_grants') IS NOT NULL AS grants")).rows[0];
      const priv = who.regs && who.grants ? (await c.query("SELECT has_table_privilege('cs_avd_registrations','SELECT') AS r, has_table_privilege('cs_avd_creation_grants','INSERT') AS gi, has_table_privilege('cs_avd_creation_grants','SELECT') AS gs")).rows[0] : null;
      const byId = who.regs ? (await c.query('SELECT expires_at, revoked_at, enrollment_hash FROM cs_avd_registrations WHERE id=$1', [enrollment.registrationId])).rows[0] : null;
      const byHash = who.regs && !byId ? (await c.query('SELECT id FROM cs_avd_registrations WHERE enrollment_hash=$1', [sha(enrollment.proof)])).rows[0] : null;
      await c.query('ROLLBACK');
      const permDetail = `role ${who.role}, schema ${who.name}`;
      if (schema && who.name !== schema) put(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.FAIL, 'SCHEMA_MISMATCH', permDetail));
      else if (!who.regs || !who.grants) put(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.FAIL, 'TABLES_MISSING', permDetail));
      else if (!byId) put(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.FAIL, byHash ? 'STATE_MISMATCH' : 'NO_REGISTRATION', permDetail));
      else put(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.PASS, null, permDetail));
      const proofMatch = byId ? sameHex(sha(enrollment.proof), byId.enrollment_hash) : false;
      const active = !!byId && byId.revoked_at == null && Number(byId.expires_at) > Number(who.at);
      if (!byId) dbTitles.slice(1, 3).forEach(([id, t]) => put(check(id, t, STATUS.NOT_RUN)));
      else {
        put(byId.revoked_at != null ? check('REGISTRATION_ACTIVE', 'Registration active', STATUS.FAIL, 'REVOKED')
          : !active ? check('REGISTRATION_ACTIVE', 'Registration active', STATUS.FAIL, 'EXPIRED')
            : check('REGISTRATION_ACTIVE', 'Registration active', STATUS.PASS, null, `expires ${new Date(Number(byId.expires_at)).toISOString()}`));
        put(proofMatch ? check('PROOF_MATCH', 'Enrollment proof matches DB', STATUS.PASS)
          : check('PROOF_MATCH', 'Enrollment proof matches DB', STATUS.FAIL, 'PROOF_MISMATCH'));
      }
      put(priv && priv.r && priv.gi && priv.gs ? check('DB_PERMISSIONS', 'Database permissions', STATUS.PASS, null, permDetail + ' (this role; the service role is proven by the live test)')
        : check('DB_PERMISSIONS', 'Database permissions', priv ? STATUS.FAIL : STATUS.NOT_RUN, priv ? 'DB_PERMISSIONS' : null, permDetail));
      // Only a DB that is the expected schema with the tables can explain a live 401.
      if (!(schema && who.name !== schema) && who.regs && who.grants) dbState = { exists: !!byId, revoked: byId?.revoked_at != null, expired: !!byId && byId.revoked_at == null && !active, proofMatch };
    } catch {
      try { await c?.query('ROLLBACK'); } catch { /* closed */ }
      db.length = 0;
      put(check('REGISTRATION_EXISTS', 'Registration exists in DB', STATUS.FAIL, 'DB_CONNECT_FAILED'));
      dbTitles.slice(1).forEach(([id, t]) => put(check(id, t, STATUS.NOT_RUN)));
    } finally { c?.release(); await pool.end?.().catch(() => {}); }
    db.forEach(add);
  }

  // 10. Approved live provision: exactly one request, guarded locally against repeats.
  const healthOk = checks.find((x) => x.id === 'VISION_HEALTH').status === STATUS.PASS;
  if (!approveProvision) add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.NOT_RUN, null, 'pass -ApproveProvision to run one grant request'));
  else if (!enrollment || !healthOk) add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.NOT_RUN, null, 'needs a valid enrollment and a healthy service'));
  else if (now() - ((await deps.guard.last('provision')) ?? 0) < LIVE_GUARD_MS) add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.NOT_RUN, 'LIVE_GUARD'));
  else {
    await deps.guard.mark('provision');
    try {
      const res = await deps.fetch(origin + '/simulator/provision', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Bearer ' + enrollment.proof, 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ apiOrigin: origin, audience: AUDIENCE }),
      });
      if (res.status === 200) {
        const body = await res.json().catch(() => null);
        const problem = grantProblem(body, { origin, registrationId: enrollment.registrationId, at: now() });
        if (problem) add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.FAIL, problem));
        else { grant = body.credential; add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.PASS, null, `grant valid ${Math.round((body.expiresAt - body.issuedAt) / 1000)}s`)); }
      } else {
        await res.body?.cancel?.().catch(() => {});
        const cause = res.status === 401 ? (dbState ? (!dbState.exists ? 'NO_REGISTRATION' : dbState.revoked ? 'REVOKED' : dbState.expired ? 'EXPIRED' : !dbState.proofMatch ? 'PROOF_MISMATCH' : 'STORE_MISMATCH') : 'AUTH_REJECTED')
          : res.status === 429 ? 'RATE_LIMITED' : res.status === 400 ? 'REQUEST_ORIGIN_REJECTED'
            : [502, 503, 504].includes(res.status) ? 'SERVER_STARTING' : 'AUTH_REJECTED';
        add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.FAIL, cause, `HTTP ${res.status}`));
      }
    } catch (e) { add(check('QR_AUTHORIZATION', 'QR authorization (approved live test only)', STATUS.FAIL, networkCause(e))); }
  }

  // 11. Approved session: one session with that grant, then cancelled so no open QR is left behind.
  if (!approveSession) add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.NOT_RUN, null, 'pass -ApproveSession (with -ApproveProvision) to create and cancel one session'));
  else if (!grant) add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.NOT_RUN, null, 'needs a valid grant from this run'));
  else if (now() - ((await deps.guard.last('session')) ?? 0) < LIVE_GUARD_MS) add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.NOT_RUN, 'LIVE_GUARD'));
  else {
    await deps.guard.mark('session');
    try {
      const res = await deps.fetch(origin + '/v1/sessions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Bearer ' + grant, 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'washer-fluid' }),
      });
      const s = res.status === 201 ? await res.json().catch(() => null) : null;
      if (!s) add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.FAIL, 'SESSION_REJECTED', `HTTP ${res.status}`));
      else if (!UUID.test(s.sessionId ?? '') || !TOKEN.test(s.receiverToken ?? '') || !TOKEN.test(s.inviteToken ?? '') || s.taskId !== 'washer-fluid')
        add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.FAIL, 'SESSION_INVALID'));
      else {
        const cancel = await deps.fetch(`${origin}/v1/sessions/${s.sessionId}/cancel`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + s.receiverToken } });
        add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.PASS, null, `session ${s.sessionId} created, QR payload valid, cancel HTTP ${cancel.status}`));
      }
    } catch (e) { add(check('SESSION_QR', 'Session and QR creation (approved live test only)', STATUS.FAIL, networkCause(e))); }
    grant = null;
  }

  enrollment = null; // drop the proof
  const core = checks.filter((x) => x.id !== 'SESSION_QR');
  const firstFailure = checks.find((x) => x.status === STATUS.FAIL) ?? null;
  const final = firstFailure ? 'BLOCKED' : core.every((x) => x.status === STATUS.PASS || x.status === STATUS.WARN) ? 'READY_FOR_QR_E2E' : 'NOT_VERIFIED';
  return { checks, final, firstFailure };
}

export function formatReport({ checks, final, firstFailure }) {
  const lines = ['CarScope Vision QR Diagnostic', ''];
  for (const c of checks) lines.push(`[${c.status}] ${c.title}${c.detail ? ` - ${c.detail}` : ''}${c.cause && c.status !== STATUS.PASS ? ` (${c.cause})` : ''}`);
  lines.push('', `Final: ${final}`);
  if (firstFailure) lines.push(`First failure: ${firstFailure.title} (${firstFailure.cause})`, `Fix: ${firstFailure.fix}`);
  else if (final === 'NOT_VERIFIED') lines.push('Not verified: NOT_RUN items above were not executed. Nothing is reported as passing that was not checked.');
  return lines.join('\n');
}

// ---- CLI ---------------------------------------------------------------------------------------------------
function parse(argv) {
  const o = { approveProvision: false, approveSession: false, skipApkOrigin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--approve-provision') o.approveProvision = true;
    else if (a === '--approve-session') o.approveSession = true;
    else if (a === '--skip-apk-origin') o.skipApkOrigin = true;
    else if (a === '--no-database') o.noDatabase = true;
    else if (['--serial', '--origin', '--schema', '--adb', '--state-file', '--report', '--guard-dir'].includes(a) && argv[i + 1] && !argv[i + 1].startsWith('--')) o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    else throw new Error('INVALID_ARGUMENTS');
  }
  if (!o.serial || !/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(o.origin ?? '')) throw new Error('INVALID_ARGUMENTS');
  if (o.approveSession && !o.approveProvision) throw new Error('SESSION_NEEDS_PROVISION');
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const adbPath = o.adb ?? 'C:\\Android\\Sdk\\platform-tools\\adb.exe';
  const adb = (args) => new Promise((resolve) => execFile(adbPath, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    (error, stdout) => resolve({ code: error ? (error.code ?? 1) : 0, stdout })));
  let stateRegistrationId = null;
  if (o.stateFile) try { stateRegistrationId = JSON.parse((await readFile(o.stateFile, 'utf8')).replace(/^\uFEFF/, '')).registrationId ?? null; } catch { /* absent */ }
  const guardDir = o.guardDir ?? join(tmpdir(), 'carscope-vision-qr-guard');
  const guardFile = (kind) => join(guardDir, `${kind}-${o.serial.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  const guard = {
    async last(kind) { try { return JSON.parse(await readFile(guardFile(kind), 'utf8')).at; } catch { return null; } },
    async mark(kind) { await mkdir(guardDir, { recursive: true }); await writeFile(guardFile(kind), JSON.stringify({ at: Date.now() })); },
  };
  async function openPool() {
    const url = o.noDatabase ? null : process.env.PG_VISION_DATABASE_URL;
    if (!url) return null;
    const { Pool } = await import('pg');
    const { databasePoolOptions } = await import('../src/database-config.mjs');
    const { expectedSchema, ...connection } = databasePoolOptions({ url, caPemBase64: process.env.CARSCOPE_DB_CA_PEM_BASE64, schema: o.schema });
    void expectedSchema;
    return new Pool({ ...connection, max: 1, connectionTimeoutMillis: 8000 });
  }
  async function pullApk(path) {
    const folder = await mkdtemp(join(tmpdir(), 'carscope-apk-'));
    try {
      const target = join(folder, 'base.apk');
      if ((await adb(['-s', o.serial, 'pull', path, target])).code !== 0) return null;
      return await readFile(target);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  const result = await diagnose({ ...o, stateRegistrationId }, { adb, fetch: globalThis.fetch, openPool, guard, pullApk, now: Date.now });
  process.stdout.write(formatReport(result) + '\n');
  if (o.report) await writeFile(o.report, JSON.stringify({ at: new Date().toISOString(), origin: o.origin, serial: o.serial, ...result }, null, 2));
  process.exitCode = result.final === 'BLOCKED' ? 2 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('VISION_QR_DIAGNOSE_FAILED ' + (/^[A-Z_]+$/.test(e?.message) ? e.message : '(details withheld)')); process.exitCode = 1; });
}
