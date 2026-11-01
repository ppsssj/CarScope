# inspection-sync-poc (AR-02A)

This is a local PoC for sending a completed AR-01 washer-fluid self-inspection result from a phone to a vehicle-side
receiver. Pairing uses a one-time QR v2 invite. The phone shows a result as sent only after it verifies the server
ACK, and the vehicle must accept the result explicitly.

- It uses Node 22 built-ins only, with **no dependencies**. The browser check borrows Playwright from
  `../mobile-ar-poc`.
- It is **not deployable**:
  - The session store lives in the memory of a single process.
  - Only loopback callers can create sessions.
  - The server binds to loopback and refuses any other bind without TLS.
- It does **not** authenticate a vehicle or an owner. A result is always shown as user-reported, never as a sensor
  diagnosis.

For details, see [docs/ar-02a-sync-architecture.md](../../docs/ar-02a-sync-architecture.md),
[docs/contracts/inspection-sync-v1.md](../../docs/contracts/inspection-sync-v1.md) and
[docs/ar-02a-threat-model.md](../../docs/ar-02a-threat-model.md).

## Run

```
npm test                                   # unit, HTTP, race and synthetic E2E (48 tests)
npm run check                              # syntax check
SYNC_DEBUG_PAGE=1 npm run serve            # http://127.0.0.1:4180, debug phone page at /debug#v=2&task=…&invite=…
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
| `src/server.mjs` | HTTP API, limits, headers, loopback-only create, optional debug page |
| `public/sync-client.mjs` | phone transport client (explicit send, single flight, bounded retry, verified ACK) |
| `public/debug.*` | debug phone page (not the AR-01 production page) |
| `bin/receiver.mjs` | vehicle receiver simulator + `describeReceived()` |
| `test/` | node:test suites + `browser.mjs` |
