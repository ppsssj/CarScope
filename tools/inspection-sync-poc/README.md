# inspection-sync-poc (AR-02B-1)

This is a local PoC for sending a completed AR-01 washer-fluid self-inspection result from a phone to a vehicle-side
receiver. Pairing uses a one-time QR v2 invite. The phone shows a result as sent only after it verifies the server
ACK, and the vehicle must accept the result explicitly.

- It uses Node 22.16.0+ built-ins only, with **no dependencies**. The browser check borrows Playwright from
  `../mobile-ar-poc`.
- It is **not deployable**:
  - Memory is the default; SYNC_DB_PATH selects experimental single-host SQLite and shared request limits.
  - Session creation defaults to denial. SYNC_LOCAL_TEST_AUTH=1 explicitly enables the historical loopback test stand-in.
  - The server binds to loopback and refuses any other bind without TLS.
- It does **not** authenticate a vehicle or an owner. A result is always shown as user-reported, never as a sensor
  diagnosis.

For details, see [docs/ar-02a-sync-architecture.md](../../docs/ar-02a-sync-architecture.md),
[docs/contracts/inspection-sync-v1.md](../../docs/contracts/inspection-sync-v1.md) and
[docs/ar-02a-threat-model.md](../../docs/ar-02a-threat-model.md).

## Run

```
npm test                                   # unit, HTTP, race, durable and TLS tests (OpenSSL required)
npm run check                              # syntax check
SYNC_LOCAL_TEST_AUTH=1 SYNC_DEBUG_PAGE=1 npm run serve            # http://127.0.0.1:4180, debug phone page at /debug#v=2&task=…&invite=…
npm run receiver -- --mobile-base=http://127.0.0.1:4180/debug
                                           # creates a session, prints the QR URL once, waits, asks to accept
SYNC_EVIDENCE_DIR=C:\CarScope-External\ar-02a\<run> npm run test:browser   # needs `npm ci` in ../mobile-ar-poc
```

Environment variables:

| variable | purpose |
|---|---|
| `SYNC_HOST` | bind address; default `127.0.0.1` |
| `SYNC_PORT` | port; default 4180 |
| `SYNC_TLS_CERT`, `SYNC_TLS_KEY` | required for a non-loopback bind |
| `SYNC_ALLOWED_ORIGIN` | the one exact origin allowed for CORS; default none |
| `SYNC_DEBUG_PAGE=1` | serves the debug page |

## Layout

| path | role |
|---|---|
| `src/protocol.mjs` | QR v2, envelope check (AR-01 `validateResult()` + COMPLETED), digest, receipt check |
| `src/sessions.mjs` | state machine, tokens (hash only), expiry, duplicate and conflict handling, cleanup |
| `src/session-store.mjs` | store interface + `MemorySessionStore` (single process) |
| `src/rate-limit.mjs` | fixed-window limits per client and route class |
| `src/server.mjs` | HTTP API, limits, headers, default-deny create authorization, optional local debug page |
| `public/sync-client.mjs` | phone transport client (explicit send, single flight, bounded retry, verified ACK) |
| `public/debug.*` | debug phone page (not the AR-01 production page) |
| `bin/receiver.mjs` | vehicle receiver simulator + `describeReceived()` |
| `test/` | node:test suites + `browser.mjs` |

## AR-02B-1 durable foundation

See [infrastructure](../../docs/ar-02b1-sync-infrastructure.md),
[authentication](../../docs/ar-02b1-authentication-design.md),
[deployment comparison](../../docs/ar-02b1-deployment-options.md) and
[fresh evidence](../../docs/evidence/ar-02b1/README.md).

Set SYNC_DB_PATH to an absolute external filename with an existing parent. Database errors never fall back to memory.
Non-loopback binds reject test authorizers and debug pages. Real vehicle authentication remains blocked.

- `npm run test:legacy`: original 48 tests.
- `npm run test:sqlite`: original race and service cases against SQLite; the memory-loss case stays memory.
- `npm run test:ar01`: all original AR-01 unit tests with an explicit test-only fixture clock; requires npm ci in ../mobile-ar-poc.
- `npm run verify:local`: write check/legacy/all/SQLite/AR-01 logs to an absolute external SYNC_EVIDENCE_DIR.

TLS tests use Git OpenSSL on Windows or OpenSSL on PATH (override with SYNC_OPENSSL). Development keys/CA stay in OS temp storage.
Only the Node client explicitly trusts the generated CA. No OS trust installation or phone/Android trust is claimed.

## AR-02B-2A integrated mobile development

Install the existing mobile test dependencies first (`npm ci --ignore-scripts --prefix ../mobile-ar-poc` from this directory).
`npm run serve:mobile-dev` serves the existing AR-01 flow with an isolated QR v2 sync entry at 127.0.0.1:4182 only.
Creation still defaults to denial; `SYNC_LOCAL_TEST_AUTH=1` is the explicit single-PC synthetic stand-in.
No query flag, external bind, deployment config or production authorization is enabled.
`npm run test:mobile-browser` verifies the integrated page with SQLite and the Node receiver simulator; set an external
SYNC_EVIDENCE_DIR under C:/CarScope-External. Android Debug components use Fake transport only.

See [mobile integration](../../docs/ar-02b2-mobile-receiver.md), [network boundary](../../docs/ar-02b2-network-boundary.md),
[UI contract](../../docs/contracts/inspection-sync-ui-v1.md) and [evidence](../../docs/evidence/ar-02b2/README.md).
