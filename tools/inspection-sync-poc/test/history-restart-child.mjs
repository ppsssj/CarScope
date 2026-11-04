// Isolated test process: no parent SessionService or in-memory state can supply this record.
import { Pool } from 'pg';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { HistoryService } from '../src/history.mjs';
import { historyAuthFixture } from './history-fixtures.mjs';

const [schema, recordId, clock] = process.argv.slice(2),
  uri = process.env.PG_TEST_URL;
if (
  !/^cs_history_test_[a-f0-9]{32}$/.test(schema) ||
  !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(uri).hostname)
)
  throw Error('OWNED_LOOPBACK_DATABASE_REQUIRED');
const pool = new Pool({
  connectionString: uri,
  options: '-c search_path=' + schema,
  connectionTimeoutMillis: 5000,
});
try {
  const store = await PostgreSQLSessionStore.open({ pool }),
    auth = historyAuthFixture({ now: () => Number(clock) });
  const owner = await auth.read.resolve({ token: auth.tokens.Aread, secure: true });
  const result = await new HistoryService({ store }).detail(owner, recordId);
  process.stdout.write(
    JSON.stringify({ recordId: result.record.recordId, resultDigest: result.record.resultDigest }),
  );
} finally {
  await pool.end();
}
