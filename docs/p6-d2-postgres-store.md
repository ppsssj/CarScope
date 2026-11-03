# P6-D2 — PostgreSQL SessionStore foundation

This is a **storage-and-server-code PR**. No credentials, LIVE Render configuration or Android/AVD settings are changed.
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

- `render-stateful.mjs` is a separate Render HTTP ingress + PostgreSQL bootstrap. It requires `DATABASE_URL` and will not start without database availability. Session creation is permanently DENIED in this milestone. The existing `render-preflight.mjs` remains untouched.
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

## Render staging deployment, only after CI and PR review

1. In the same Render workspace and Singapore region, create a dedicated PostgreSQL database.
   For temporary manual E2E research, Free is allowed with **30-day expiry and no backup**.
2. Use **Internal Database URL** only, added as a secret environment variable `DATABASE_URL`
   on the Render Web Service. Never paste connection URLs in chat, screenshots or GitHub.
3. Keep `NODE_VERSION=22.16.0`; Render should already supply `RENDER=true`,
   `RENDER_EXTERNAL_URL` and `PORT`.
4. After PR merges, change Build Command to
   `npm install --prefix tools/inspection-sync-poc --ignore-scripts --no-audit --no-fund --package-lock=false && node --check tools/inspection-sync-poc/src/render-stateful.mjs`
   and Start Command to `node tools/inspection-sync-poc/src/render-stateful.mjs`.
   Health Check Path remains `/healthz`, and auto-deploy remains OFF.
5. Before the first deploy, keep the current live preflight for rollback. Check Build Logs and
   verify `/healthz` returns `mode:STATEFUL_DENY_DEFAULT` and `sessionCreation:DENIED`.
   GET of an arbitrary nonexistent session without a bearer token must return 401.
6. This does **not** allow creating a QR session. Real issuer/registration/revocation/Android
   enrollment integration is a separate reviewed step. Do not inject fixture credentials.

**Risks to review before any actual public sync**: Render reverse proxy trust boundary,
PG schema/migration privileges, deployment rollback, free DB expiry, external access lock-down,
privacy and retention, rate limiting per trusted client identity (ingress remoteAddress may be
shared by all users), token revocation and OEM vs simulated vehicle registration.
