// Experiment-only PostgreSQL admission and attempted-call budgets. No image, prompt or raw credential is stored.
import { createHash, randomUUID } from 'node:crypto';
import { SyncError } from './sessions.mjs';
const query = (client, text, values) => client.query({ text, values, query_timeout: 5000 });

export class PostgreSQLVisionBudget {
  constructor({ pool, daily, monthly, expectedSchema = null }) {
    if (!pool?.connect || ![daily, monthly].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000) || daily > monthly) throw new Error('VISION_BUDGET_REQUIRED');
    Object.assign(this, { pool, daily, monthly, expectedSchema });
  }
  async transaction(work) {
    const c = await this.pool.connect();
    let lost = null; const onError = e => { lost = e; }; c.on('error', onError);
    const scoped = { query: (text, values) => query(c, text, values) };
    try {
      await scoped.query('BEGIN'); await scoped.query("SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='2s'");
      const value = await work(scoped); await scoped.query('COMMIT'); return value;
    }
    catch (e) { await scoped.query('ROLLBACK').catch(error => { lost ??= error; }); throw e; }
    finally { c.removeListener('error', onError); c.release(lost ?? undefined); }
  }
  async initialize() {
    await this.transaction(async c => {
      if (this.expectedSchema !== null && (await c.query('SELECT current_schema() AS name')).rows[0]?.name !== this.expectedSchema) throw new Error('DATABASE_SCHEMA_MISMATCH');
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':vision-budget', 0))");
      await c.query(`CREATE TABLE IF NOT EXISTS cs_vision_calls (
        provider text NOT NULL CHECK (provider IN ('openai','roboflow')),
        period text NOT NULL CHECK (period ~ '^(day:[0-9]{4}-[0-9]{2}-[0-9]{2}|month:[0-9]{4}-[0-9]{2})$'),
        calls integer NOT NULL CHECK (calls >= 0), PRIMARY KEY(provider,period));
        CREATE TABLE IF NOT EXISTS cs_vision_inflight (
        token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        lease_id uuid NOT NULL, expires_at timestamptz NOT NULL);
        CREATE INDEX IF NOT EXISTS cs_vision_inflight_expiry ON cs_vision_inflight(expires_at)`);
    });
  }
  async reserve(provider) {
    if (!['openai','roboflow'].includes(provider)) throw new Error('VISION_PROVIDER_UNKNOWN');
    return this.transaction(async c => {
      // Serialize the two UTC counters across processes; reserve both, or neither.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':vision-budget', 0))");
      const { day, month } = (await c.query(`SELECT
        'day:' || to_char(current_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
        'month:' || to_char(current_timestamp AT TIME ZONE 'UTC','YYYY-MM') AS month`)).rows[0];
      const rows = (await c.query('SELECT period,calls FROM cs_vision_calls WHERE provider=$1 AND period=ANY($2::text[])', [provider, [day, month]])).rows;
      for (const [period, cap] of [[day, this.daily], [month, this.monthly]]) {
        if (Number(rows.find(r => r.period === period)?.calls ?? 0) >= cap) throw new SyncError('VISION_BUDGET_EXHAUSTED', 429);
      }
      await c.query(`INSERT INTO cs_vision_calls(provider,period,calls) VALUES ($1,$2,1),($1,$3,1)
        ON CONFLICT(provider,period) DO UPDATE SET calls=cs_vision_calls.calls+1`, [provider, day, month]);
    });
  }
  async acquire(token) {
    if (typeof token !== 'string' || !token) throw new Error('VISION_CREDENTIAL_REQUIRED');
    const hash = createHash('sha256').update(token).digest('hex'), lease = randomUUID();
    // No client is held across the remote API call. Expiry also recovers a crashed process.
    await query(this.pool, 'DELETE FROM cs_vision_inflight WHERE expires_at <= current_timestamp');
    const row = await query(this.pool, `INSERT INTO cs_vision_inflight(token_hash,lease_id,expires_at)
      VALUES($1,$2,current_timestamp + interval '90 seconds') ON CONFLICT(token_hash) DO NOTHING RETURNING lease_id`, [hash, lease]);
    if (!row.rows.length) throw new SyncError('PART_ANALYSIS_IN_PROGRESS', 409);
    return { release: () => query(this.pool, 'DELETE FROM cs_vision_inflight WHERE token_hash=$1 AND lease_id=$2', [hash, lease]) };
  }
}

export function budgetedCall({ budget, provider, call }) {
  if (typeof budget?.reserve !== 'function' || typeof call !== 'function') throw new Error('VISION_BUDGET_REQUIRED');
  return async (input, options) => {
    if (options?.signal?.aborted) throw new Error('VISION_CANCELLED');
    await budget.reserve(provider); // Fail closed on DB outage. Failures/cancellations are never refunded.
    if (options?.signal?.aborted) throw new Error('VISION_CANCELLED');
    return call(input, options);
  };
}
