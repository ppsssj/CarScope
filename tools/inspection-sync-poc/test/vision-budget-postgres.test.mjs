import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgreSQLVisionBudget, budgetedCall } from '../src/vision-budget.mjs';
import { visionDatabase } from './vision-fixture.mjs';
const skip = !process.env.PG_TEST_URL && 'PG_TEST_URL absent: durable Vision budgets NOT_RUN';

test('atomic UTC day/month reservations across instances persist after reconstruction and never refund failures', { skip }, async t => {
  const db = await visionDatabase(); t.after(() => db.close());
  const pool = db.pool(), a = new PostgreSQLVisionBudget({ pool, daily: 3, monthly: 5, expectedSchema: db.schema }), b = new PostgreSQLVisionBudget({ pool, daily: 3, monthly: 5 });
  await Promise.all([a.initialize(), b.initialize()]);
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).reserve('openai')));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(attempts.filter(r => r.status === 'rejected').every(r => r.reason.code === 'VISION_BUDGET_EXHAUSTED'));
  assert.deepEqual((await pool.query("SELECT calls FROM cs_vision_calls WHERE provider='openai'")).rows.map(r => r.calls), [3,3]);
  const restarted = new PostgreSQLVisionBudget({ pool: db.pool(), daily: 3, monthly: 5 }); await restarted.initialize();
  await assert.rejects(restarted.reserve('openai'), /VISION_BUDGET_EXHAUSTED/);
  // Simulate old day counters while keeping this month's usage; the month cap still wins.
  await pool.query("UPDATE cs_vision_calls SET period='day:2000-01-01' WHERE period LIKE 'day:%'");
  await a.reserve('openai'); await b.reserve('openai');
  await assert.rejects(a.reserve('openai'), /VISION_BUDGET_EXHAUSTED/);
  const failed = budgetedCall({ budget: a, provider: 'roboflow', call: async () => { throw new Error('upstream'); } });
  await assert.rejects(failed('synthetic'), /upstream/);
  assert.deepEqual((await pool.query("SELECT calls FROM cs_vision_calls WHERE provider='roboflow'")).rows.map(r => r.calls), [1,1]);
});

test('cross-instance phone lease expires safely and stale release never removes a newer lease; schema mismatch creates nothing', { skip }, async t => {
  const db = await visionDatabase(); t.after(() => db.close()); const pool = db.pool();
  const a = new PostgreSQLVisionBudget({ pool, daily: 1, monthly: 2 }); await a.initialize();
  const b = new PostgreSQLVisionBudget({ pool: db.pool(), daily: 1, monthly: 2 });
  const first = await a.acquire('synthetic-phone-credential');
  await assert.rejects(b.acquire('synthetic-phone-credential'), /PART_ANALYSIS_IN_PROGRESS/);
  const row = (await pool.query('SELECT token_hash FROM cs_vision_inflight')).rows[0]; assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  await pool.query("UPDATE cs_vision_inflight SET expires_at=current_timestamp - interval '1 second'");
  const next = await b.acquire('synthetic-phone-credential'); await first.release();
  await assert.rejects(a.acquire('synthetic-phone-credential'), /PART_ANALYSIS_IN_PROGRESS/);
  await next.release(); const again = await a.acquire('synthetic-phone-credential'); await again.release();
  const wrong = new PostgreSQLVisionBudget({ pool, daily: 1, monthly: 2, expectedSchema: 'different_private_schema' });
  await assert.rejects(wrong.initialize(), /DATABASE_SCHEMA_MISMATCH/);
});
