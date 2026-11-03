# P6-D2 — PostgreSQL SessionStore foundation

This is a **storage-only PR**. No credentials, Render configuration or Android/AVD settings are changed.
It is not evidence of real phone-to-car E2E. The existing Render preflight remains the only deployed server,
with session creation **DENIED**.

## What is implemented

- `postgres-schema.sql`: JSONB sessions, role-separated token-hash index with foreign-key cascade,
  persisted shared rate windows and a schema-version/capacity-lock row.
- `postgres-store.mjs`: `PostgreSQLSessionStore` with transactional `insert/get/idByTokenHash/update/delete/all/count`,
  row-level locking for state transitions and global capacity lock for inserts/deletes. Result immutability
  and valid state transitions follow the existing SQLite adapter.
- `PostgreSQLRateLimiter` persists fixed-window limits across server instances. No raw tokens or remote
  client identifiers are stored; token/rate keys are SHA-256 hashes.
- Real PostgreSQL 16 GitHub Actions integration checks across two independent pools: capacity contention,
  one-time claim, rollback, end-to-end SessionService flow and rate limit concurrency.
  The test runs only against loopback and explicitly **SKIPS** when no PG_TEST_URL exists.

## Limits / blockers

- There is **no Render stateful HTTP entrypoint** in this PR. Creating the database alone does not activate sync.
- There is **no trusted credential issuer, vehicle ownership/registration proof, revocation service,
  or Android enrollment**. All real creation authorizations remain denied.
- No production DB was touched. GitHub test DB is isolated localhost and uses disposable credentials.
- No Render dashboard changes, no APK builds or AVD actions.
- PostgreSQL availability, schema migrations, backups, connection pooling, operator access and
  application-scoped least privileges require review prior to enabling a public stateful service.
- Render Free PostgreSQL expires after 30 days and has no managed backups; use only for transient E2E trials.
- The PostgreSQL driver is installed from `pg` at version declared in the sync tool's package.json.
  No external DB URI or token should be included in the repository, log, screenshots or chat.

## Local test (requires your own disposable local PostgreSQL and Node 22)

```powershell
cd tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund
$env:PG_TEST_URL = "postgresql://carscope_ci:<local-password>@127.0.0.1:5432/carscope_ci"
node --test test/postgres-store.test.mjs
Remove-Item Env:PG_TEST_URL
```

The integration test TRUNCATEs its dedicated database tables; never use operational DB credentials.
