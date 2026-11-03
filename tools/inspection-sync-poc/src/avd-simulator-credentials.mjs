// Operator-approved Pleos AVD simulator grants. These never authenticate an OEM vehicle.
// Only the local DB-admin CLI can register/revoke. Public HTTPS can only exchange an
// operator-issued enrollment proof for a short-lived simulator creation credential.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const AVD_MODE = 'OPERATOR_APPROVED_AVD_SIMULATION';
export const AVD_AUDIENCE = 'carscope-avd-simulator';
export const AVD_CREATE_SCOPE = 'inspection:session:create';
export const AVD_GRANT_TTL_MS = 120_000;
export const AVD_MAX_ENROLLMENT_MS = 24 * 60 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = value => createHash('sha256').update(value, 'utf8').digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const finiteMs = x => Number.isSafeInteger(x) && x > 0;

export class AvdSimulatorCredentialStore {
  #pool;
  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new Error('POSTGRES_POOL_REQUIRED');
    this.#pool = pool;
  }
  async #tx(fn) {
    const c = await this.#pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* fail closed */ }
      throw e;
    } finally { c.release(); }
  }
  async initialize() {
    await this.#tx(async c => {
      await c.query(await readFile(new URL('./avd-simulator-schema.sql', import.meta.url), 'utf8'));
      const r = await c.query('SELECT version FROM cs_avd_auth_meta WHERE id=1');
      if (r.rows.length !== 1 || Number(r.rows[0].version) !== 1) throw new Error('AVD_SCHEMA_VERSION_UNSUPPORTED');
    });
  }
  // Called by an operator CLI, NEVER via a public request route.
  async register({ label, ttlMs = 2 * 60 * 60_000, now = Date.now } = {}) {
    if (typeof label !== 'string' || !/^[a-zA-Z0-9._ -]{1,80}$/.test(label) ||
      !finiteMs(ttlMs) || ttlMs > AVD_MAX_ENROLLMENT_MS) throw new Error('INVALID_AVD_REGISTRATION');
    const at = now();
    if (!finiteMs(at) || !Number.isSafeInteger(at + ttlMs)) throw new Error('INVALID_CLOCK');
    const id = randomUUID(), proof = newToken(), expiresAt = at + ttlMs;
    await this.#pool.query(
      'INSERT INTO cs_avd_registrations(id,label,enrollment_hash,created_at,expires_at) VALUES ($1,$2,$3,$4,$5)',
      [id, label, HASH(proof), at, expiresAt]);
    return { registrationId: id, enrollmentProof: proof, expiresAt, mode: AVD_MODE };
  }
  async provision({ enrollmentProof, apiOrigin, now = Date.now } = {}) {
    if (typeof enrollmentProof !== 'string' || !TOKEN.test(enrollmentProof)) return null;
    const at = now();
    if (!finiteMs(at)) return null;
    return this.#tx(async c => {
      const r = await c.query(
        'SELECT id,expires_at,revoked_at FROM cs_avd_registrations WHERE enrollment_hash=$1 FOR UPDATE',
        [HASH(enrollmentProof)]);
      const reg = r.rows[0];
      if (!reg || reg.revoked_at != null || Number(reg.expires_at) <= at) return null;
      const id = randomUUID(), token = newToken(), expiresAt = at + AVD_GRANT_TTL_MS;
      await c.query(
        'INSERT INTO cs_avd_creation_grants(id,registration_id,token_hash,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5)',
        [id,reg.id,HASH(token),at,expiresAt]);
      return { mode: AVD_MODE, apiOrigin, audience: AVD_AUDIENCE, scope: AVD_CREATE_SCOPE,
        credential: token, credentialId: id, issuedAt: at, notBefore: at, expiresAt,
        registrationId: reg.id, simulatorApproved: true, realVehicleOwnershipVerified: false };
    });
  }
  async authorize({ token, secure, now = Date.now } = {}) {
    if (secure !== true || typeof token !== 'string' || !TOKEN.test(token)) return false;
    const at = now();
    if (!finiteMs(at)) return false;
    try {
      const r = await this.#pool.query({
        text: `SELECT 1 AS permitted FROM cs_avd_creation_grants g
          JOIN cs_avd_registrations r ON r.id = g.registration_id
          WHERE g.token_hash=$1 AND g.revoked_at IS NULL AND g.issued_at<=$2 AND g.expires_at>$2
            AND r.revoked_at IS NULL AND r.expires_at>$2 LIMIT 1`,
        values: [HASH(token), at], query_timeout: 1500,
      });
      return r.rows.length === 1;
    } catch { return false; }
  }
  async revoke({ registrationId, now = Date.now } = {}) {
    if (typeof registrationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(registrationId)) throw new Error('INVALID_REGISTRATION_ID');
    const at = now();
    if (!finiteMs(at)) throw new Error('INVALID_CLOCK');
    return this.#tx(async c => {
      const r = await c.query(
        'UPDATE cs_avd_registrations SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1 RETURNING id',
        [registrationId,at]);
      if (!r.rows.length) return false;
      await c.query('UPDATE cs_avd_creation_grants SET revoked_at=COALESCE(revoked_at,$2) WHERE registration_id=$1', [registrationId,at]);
      return true;
    });
  }
  async prune({ now = Date.now } = {}) {
    const at = now(); if (!finiteMs(at)) throw new Error('INVALID_CLOCK');
    // Retain registration metadata for explicit operator revocation/audit; remove expired bearer grants only.
    return this.#pool.query('DELETE FROM cs_avd_creation_grants WHERE expires_at<=$1', [at]);
  }
  async metadata() {
    const r = await this.#pool.query('SELECT id,label,created_at,expires_at,revoked_at FROM cs_avd_registrations ORDER BY created_at DESC LIMIT 30');
    return r.rows.map(x=>({ registrationId: x.id, label: x.label, createdAt: Number(x.created_at),
      expiresAt: Number(x.expires_at), revoked: x.revoked_at != null }));
  }
}
