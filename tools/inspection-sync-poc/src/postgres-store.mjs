// PostgreSQL adapter for the existing SessionStore contract. Runtime driver is supplied by the caller.
// No production authorization or public listening is enabled by importing this module.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_RATES } from './rate-limit.mjs';
import { acceptedRecord, sameRecordIdentity, HistoryError } from './history.mjs';

const transitions = Object.freeze({
  CREATED: ['CREATED', 'CLAIMED', 'CANCELLED', 'EXPIRED'],
  CLAIMED: ['CLAIMED', 'RESULT_SUBMITTED', 'CANCELLED', 'EXPIRED'],
  RESULT_SUBMITTED: ['RESULT_SUBMITTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['ACCEPTED'], CANCELLED: ['CANCELLED'], EXPIRED: ['EXPIRED'],
});
const clone = value => structuredClone(value);
const hashed = value => createHash('sha256').update(value, 'utf8').digest('hex');
const integer = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('INVALID_DATABASE_INTEGER');
  return n;
};

export class PostgreSQLSessionStore {
  kind = 'postgresql-shared';
  #pool;
  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function' || typeof pool.end !== 'function') {
      throw new Error('POSTGRES_POOL_REQUIRED');
    }
    this.#pool = pool;
  }
  static async open({ pool }) {
    const store = new PostgreSQLSessionStore({ pool });
    await store.initialize();
    return store;
  }
  async #transaction(fn) {
    const c = await this.#pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (error) {
      try { await c.query('ROLLBACK'); } catch { /* Preserve the original failure, never fall back to memory. */ }
      throw error;
    } finally { c.release(); }
  }
  async initialize() {
    return this.#transaction(async c => {
      await c.query('SELECT pg_advisory_xact_lock(821801)');
      const schema = await readFile(new URL('./postgres-schema.sql', import.meta.url), 'utf8');
      await c.query(schema);
      const meta = await c.query('SELECT version FROM cs_schema_meta WHERE id=1');
      if (meta.rows.length !== 1 || integer(meta.rows[0].version) !== 1) throw new Error('UNSUPPORTED_POSTGRES_SCHEMA');
      await c.query(await readFile(new URL('./postgres-history-schema.sql', import.meta.url),'utf8'));
      const history = await c.query('SELECT version FROM cs_history_schema_meta WHERE id=1');
      if(history.rows.length!==1 || integer(history.rows[0].version)!==1)throw new Error('UNSUPPORTED_HISTORY_SCHEMA');
    });
  }
  async #lockCapacity(c) {
    // Serializes insert capacity checks across all server processes/instances.
    const meta = await c.query('SELECT version FROM cs_schema_meta WHERE id=1 FOR UPDATE');
    if (meta.rows.length !== 1 || integer(meta.rows[0].version) !== 1) throw new Error('UNSUPPORTED_POSTGRES_SCHEMA');
  }
  async #replaceTokens(c, s) {
    await c.query('DELETE FROM cs_session_tokens WHERE session_id=$1', [s.id]);
    for (const kind of ['invite', 'submit', 'receiver']) {
      const hash = s[`${kind}Hash`];
      if (hash != null) {
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_TOKEN_HASH');
        await c.query('INSERT INTO cs_session_tokens (hash,kind,session_id) VALUES ($1,$2,$3)', [hash, kind, s.id]);
      }
    }
  }
  async insert(session, { maxSessions = Infinity } = {}) {
    if (!session || typeof session.id !== 'string' || !transitions[session.state] ||
      !(maxSessions === Infinity || Number.isSafeInteger(maxSessions) && maxSessions >= 0)) throw new Error('INVALID_SESSION');
    return this.#transaction(async c => {
      await this.#lockCapacity(c);
      const n = await c.query('SELECT COUNT(*)::int AS n FROM cs_sessions');
      if (integer(n.rows[0].n) >= maxSessions) return false;
      await c.query('INSERT INTO cs_sessions (id,data) VALUES ($1,$2::jsonb)', [session.id, JSON.stringify(session)]);
      await this.#replaceTokens(c, session);
      return true;
    });
  }
  async get(id) {
    const r = await this.#pool.query('SELECT data FROM cs_sessions WHERE id=$1', [id]);
    return r.rows[0] ? clone(r.rows[0].data) : null;
  }
  async idByTokenHash(kind, hash) {
    if (!hash) return null;
    if (!['invite','submit','receiver'].includes(kind) || !/^[a-f0-9]{64}$/.test(hash)) return null;
    const r = await this.#pool.query('SELECT session_id FROM cs_session_tokens WHERE kind=$1 AND hash=$2', [kind, hash]);
    return r.rows[0]?.session_id ?? null;
  }
  async update(id, mutate) {
    if (typeof mutate !== 'function') throw new Error('MUTATOR_REQUIRED');
    return this.#transaction(async c => {
      const r = await c.query('SELECT data FROM cs_sessions WHERE id=$1 FOR UPDATE', [id]);
      if (!r.rows.length) return null;
      const before = r.rows[0].data;
      const next = mutate(clone(before));
      if (!next || typeof next !== 'object' || typeof next.then === 'function' ||
        next.id !== id || !transitions[before.state]?.includes(next.state)) throw new Error('INVALID_STORE_TRANSITION');
      if (['RESULT_SUBMITTED','ACCEPTED'].includes(before.state) &&
        next.resultDigest !== before.resultDigest && next.state !== 'CANCELLED') throw new Error('IMMUTABLE_RESULT_DIGEST');
      if (before.result && next.result && JSON.stringify(before.result) !== JSON.stringify(next.result)) throw new Error('IMMUTABLE_SUBMITTED_RESULT');
      await c.query('UPDATE cs_sessions SET data=$2::jsonb WHERE id=$1', [id, JSON.stringify(next)]);
      await this.#replaceTokens(c, next);
      if(before.state!=='ACCEPTED' && next.state==='ACCEPTED')await this.#archive(c,await acceptedRecord(next));
      return clone(next);
    });
  }
  async delete(id, predicate = () => true) {
    if (typeof predicate !== 'function') throw new Error('PREDICATE_REQUIRED');
    return this.#transaction(async c => {
      // Capacity lock orders deletes against inserts and makes the maxSessions count linearizable.
      await this.#lockCapacity(c);
      const r = await c.query('SELECT data FROM cs_sessions WHERE id=$1 FOR UPDATE', [id]);
      if (!r.rows.length) return false;
      const keep = predicate(clone(r.rows[0].data));
      if (keep && typeof keep.then === 'function') throw new Error('ASYNC_PREDICATE_FORBIDDEN');
      if (!keep) return false;
      const out = await c.query('DELETE FROM cs_sessions WHERE id=$1', [id]);
      return out.rowCount === 1;
    });
  }
  async all() {
    const r = await this.#pool.query('SELECT data FROM cs_sessions');
    return r.rows.map(row => clone(row.data));
  }
  async count() {
    const r = await this.#pool.query('SELECT COUNT(*)::int AS n FROM cs_sessions');
    return integer(r.rows[0].n);
  }
  #record(row) {
    const keys={recordId:'record_id',inspectionId:'inspection_id',syncSessionId:'sync_session_id',taskId:'task_id',partId:'part_id',schemaVersion:'schema_version',inspectionStatus:'inspection_status',originalResult:'original_result',resultDigest:'result_digest',completedAt:'completed_at',receivedAt:'received_at',acceptedAt:'accepted_at',authorityNamespace:'authority_namespace',authorityIssuer:'authority_issuer',userId:'user_id',vehicleId:'vehicle_id',deviceId:'device_id',registrationId:'registration_id',bindingVerifiedAt:'binding_verified_at',createdAt:'created_at'};
    const out=Object.fromEntries(Object.entries(keys).map(([js,sql])=>[js,row[sql]]));
    for(const key of ['schemaVersion','receivedAt','acceptedAt','bindingVerifiedAt','createdAt'])if(out[key]!==null)out[key]=integer(out[key]);
    out.completedAt=Number(out.completedAt);if(!Number.isSafeInteger(out.completedAt))throw new Error('INVALID_DATABASE_INTEGER');
    return out;
  }
  async #archive(c, record) {
    const keys=['recordId','inspectionId','syncSessionId','taskId','partId','schemaVersion','inspectionStatus','originalResult','resultDigest','completedAt','receivedAt','acceptedAt','authorityNamespace','authorityIssuer','userId','vehicleId','deviceId','registrationId','bindingVerifiedAt'];
    const values=keys.map(k=>k==='originalResult'?JSON.stringify(record[k]):record[k]);values.push(Date.now());
    const r=await c.query(`INSERT INTO cs_inspection_records(record_id,inspection_id,sync_session_id,task_id,part_id,schema_version,inspection_status,original_result,result_digest,completed_at,received_at,accepted_at,authority_namespace,authority_issuer,user_id,vehicle_id,device_id,registration_id,binding_verified_at,created_at)
      VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(inspection_id) DO NOTHING RETURNING record_id`,values);
    if(!r.rowCount){
      // A separate statement sees a concurrent winner after ON CONFLICT has waited for its commit.
      const old=await c.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1',[record.inspectionId]);
      if(old.rows.length!==1 || !sameRecordIdentity(this.#record(old.rows[0]),record))throw new HistoryError('CONFLICT',409);
    }
  }
  async historyList(query) {
    const {owner}=query,values=[owner.authorityNamespace,owner.authorityIssuer,owner.userId,owner.vehicleId];
    const where=['authority_namespace=$1','authority_issuer=$2','user_id=$3','vehicle_id=$4'];
    const add=(sql,value)=>{values.push(value);where.push(sql.replace('?', '$'+values.length));};
    if(query.taskId!==null)add('task_id=?',query.taskId);
    if(query.partId!==null)add('part_id=?',query.partId);
    if(query.status!==null)add('inspection_status=?',query.status);
    if(query.from!==null)add('completed_at>=?',query.from);
    if(query.to!==null)add('completed_at<?',query.to);
    if(query.after){values.push(query.after.completedAt,query.after.recordId);where.push(`(completed_at,record_id)<($${values.length-1}::bigint,$${values.length}::uuid)`);}
    values.push(query.limit+1);
    const r=await this.#pool.query(`SELECT * FROM cs_inspection_records WHERE ${where.join(' AND ')} ORDER BY completed_at DESC,record_id DESC LIMIT $${values.length}`,values);
    return r.rows.map(row=>this.#record(row));
  }
  async historyGet(owner,recordId) {
    const r=await this.#pool.query('SELECT * FROM cs_inspection_records WHERE record_id=$1 AND authority_namespace=$2 AND authority_issuer=$3 AND user_id=$4 AND vehicle_id=$5',[recordId,owner.authorityNamespace,owner.authorityIssuer,owner.userId,owner.vehicleId]);
    return r.rows[0]?this.#record(r.rows[0]):null;
  }
  async rateCheck(client, route, { rates = DEFAULT_RATES, now = Date.now, maxKeys = 10000 } = {}) {
    const rate = rates[route];
    if (!rate) return { ok: true };
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new Error('INVALID_RATE_CAP');
    const key = hashed(`${route}|${client}`);
    return this.#transaction(async c => {
      await this.#lockCapacity(c);
      const at = integer(now());
      await c.query('DELETE FROM cs_rate_windows WHERE expires_at <= $1', [at]);
      const r = await c.query('SELECT count, expires_at FROM cs_rate_windows WHERE key=$1', [key]);
      const old = r.rows[0];
      if (!old) {
        const n = await c.query('SELECT COUNT(*)::int AS n FROM cs_rate_windows');
        if (integer(n.rows[0].n) >= maxKeys) return { ok: false, retryAfterS: Math.ceil(rate.windowMs / 1000) };
        await c.query('INSERT INTO cs_rate_windows (key,count,expires_at) VALUES ($1,1,$2)', [key, at + rate.windowMs]);
        return { ok: true };
      }
      if (integer(old.count) >= rate.limit) {
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((integer(old.expires_at) - at) / 1000)) };
      }
      await c.query('UPDATE cs_rate_windows SET count=count+1 WHERE key=$1', [key]);
      return { ok: true };
    });
  }
  async close() { await this.#pool.end(); }
}

export class PostgreSQLRateLimiter {
  constructor({ store, ...options }) {
    if (!(store instanceof PostgreSQLSessionStore)) throw new Error('POSTGRES_STORE_REQUIRED');
    this.store = store; this.options = options;
  }
  check(client, route) { return this.store.rateCheck(client, route, this.options); }
}
