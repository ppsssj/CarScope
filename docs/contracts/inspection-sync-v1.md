# Contract: inspection-sync v1 (AR-02A)

Status: **PoC contract**, implemented in `tools/inspection-sync-poc/` and run only on a local machine. No public endpoint exists.
The AR-01 result record (schema v1, `tools/mobile-ar-poc/public/inspection-result.mjs`) is reused **unchanged**; this
contract only wraps and transports it.

## 1. QR v2 invite

```
<mobile page URL>#v=2&task=washer-fluid&invite=<token>
```

| key | rule |
|---|---|
| `v` | exactly `2` |
| `task` | a supported task id; only `washer-fluid` today |
| `invite` | 43 chars `[A-Za-z0-9_-]` = 32 random bytes, base64url |

- Exactly these three keys, each once, in any order. Anything else (extra keys such as `vin`, a repeated key, a
  missing `#`, a short token) makes the fragment invalid. A failed parse never returns the token.
- The token lives in the **fragment**, so browsers do not send it in HTTP requests or `Referer`. The page reads it once and
  removes it right away with `history.replaceState`, so it does not stay in the address bar, the history entry, or a
  bookmark.
- The token is **not** a vehicle identifier. Scanning it proves only that someone saw the QR. It says nothing about who
  owns the vehicle or which car it is.
- QR v1 (`#v=1&task=washer-fluid`, AR-01) is unchanged. The v1 parser rejects v2 and the v2 parser rejects v1. The
  current AR-01 page therefore shows "unsupported QR" for a v2 code; that page is changed only in AR-02B.

## 2. Tokens

| token | holder | issued | grants | lifetime |
|---|---|---|---|---|
| `receiverToken` | vehicle receiver | `POST /v1/sessions` (once) | view the session and its result, accept, cancel | the session |
| `inviteToken` | QR → phone | `POST /v1/sessions` (once) | one `POST /v1/claim` | 10 min, single use |
| `submitToken` | phone | `POST /v1/claim` (once) | submit one result, read its own session state (no result view) | the session |

- All tokens are 32 bytes from `crypto.randomBytes`, sent only as `Authorization: Bearer <token>`. A query string on
  any API route is rejected with 400.
- The server stores only `sha256(token)`. Tokens are never logged and never returned after they are issued.
- A wrong `receiverToken` and an unknown `sessionId` give the same `404`, so the API never reveals whether a session
  exists.

## 3. Envelope (phone → server)

```json
{
  "protocol": "inspection-sync",
  "protocolVersion": 1,
  "result": { "...": "AR-01 schema v1 record, state COMPLETED" }
}
```

- Exactly these three keys.
- `result` must pass the AR-01 `validateResult()` strict allow-list with no problems. That means exact field set,
  constants, UUID, ISO times, boolean `aids` only, and `sync: "NOT_SENT"`.
- `state` must be `COMPLETED` and `taskId` must equal the session task.
- Anything else, such as a VIN, plate, account, device id, GPS, photo or video, frame, or tap coordinates, is an
  unexpected field and is rejected with 422.
- The record's own `sync` field stays `NOT_SENT`. Transport state never goes into the record; it lives in the client's
  transport state and the receipt (below).

Result example (the AR-01 record, verbatim):

```json
{
  "schemaVersion": 1, "inspectionId": "c91062e5-2cb2-45e6-b86f-25c65f18cb73", "taskId": "washer-fluid",
  "method": "SELF", "source": "MOBILE", "state": "COMPLETED", "startedAt": "2026-11-01T08:06:43.685Z",
  "aids": { "cameraUsed": false, "locationMarked": false }, "status": "NEEDS_REFILL",
  "confirmation": "USER_REPORTED", "completedAt": "2026-11-01T08:06:43.685Z", "sync": "NOT_SENT"
}
```

## 4. Result digest

`resultDigest = "sha256:" + hex(SHA-256(canonicalJson(result)))`. Canonical JSON sorts object keys recursively and
has no whitespace. It identifies "this exact record" for duplicate detection, the receipt, and acceptance.

## 5. Receipt (server → phone, the ACK)

```json
{
  "protocol": "inspection-sync", "protocolVersion": 1,
  "inspectionId": "c91062e5-…", "resultDigest": "sha256:…",
  "receivedAt": 1793520403685, "sessionState": "RESULT_SUBMITTED"
}
```

The client shows **SENT** only when all of these hold for the record it sent:

- The receipt has exactly these six keys.
- `protocol` and `protocolVersion` match.
- `inspectionId` and `resultDigest` equal those of the record that was sent.
- `sessionState` is `RESULT_SUBMITTED` or `ACCEPTED`.

A 2xx response without such a receipt is **not** a success.

## 6. API

| method & path | auth | body | success |
|---|---|---|---|
| `POST /v1/sessions` | caller must be loopback (stand-in for vehicle auth) | `{ "taskId": "washer-fluid" }` | 201 `{ sessionId, taskId, receiverToken, inviteToken, inviteExpiresAt, expiresAt }` |
| `GET /v1/sessions/:id` | receiver | – | 200 `{ sessionId, taskId, sessionState, expiresAt, result, resultDigest, receivedAt, acceptedAt }` |
| `POST /v1/sessions/:id/accept` | receiver | `{ "resultDigest": "sha256:…" }` | 200 view (`ACCEPTED`); repeat with the same digest is idempotent |
| `POST /v1/sessions/:id/cancel` | receiver | – | 200 `{ sessionId, sessionState: "CANCELLED" }` |
| `POST /v1/claim` | invite | – | 200 `{ submitToken, taskId, sessionState: "CLAIMED", expiresAt }` |
| `POST /v1/submissions` | submit | envelope | 201 `{ receipt, duplicate: false }` new / 200 `{ receipt, duplicate: true }` identical repeat |
| `GET /v1/submissions/status` | submit | – | 200 `{ sessionState, expiresAt, receipt \| null }` |

Request rules:

- JSON bodies require `Content-Type: application/json` (otherwise 415).
- Bodies are limited to 16 KiB (otherwise 413).
- Every response carries `Cache-Control: no-store`, `nosniff`, `Referrer-Policy: no-referrer`, and a `default-src 'none'`
  CSP. HSTS is added when served over TLS.

Errors are returned as `{ "error": { "code": "<CODE>" } }`. The body has no message, no echo of the input, and no token.

| HTTP | code | meaning | phone transport state |
|---|---|---|---|
| 400 | `BAD_REQUEST` | bad JSON, query string, unsupported task | `REJECTED_INVALID` |
| 401 | `UNAUTHORIZED` | missing or malformed bearer token | `REJECTED_UNAUTHORIZED` |
| 403 | `FORBIDDEN` | non-loopback session creation; CORS preflight from another origin | – |
| 404 | `NOT_FOUND` | unknown token, wrong receiver token, unknown session | `REJECTED_UNAUTHORIZED` |
| 409 | `ALREADY_CLAIMED` | the invite was already used | `REJECTED_CLOSED` |
| 409 | `SESSION_CLOSED` | session accepted or cancelled | `REJECTED_CLOSED` |
| 409 | `CONFLICT` | a different result for this session, or accept with a digest that was not submitted | `REJECTED_CONFLICT` |
| 409 | `INVALID_STATE` | transition not allowed now (e.g. accept before submit) | `REJECTED_INVALID` |
| 410 | `SESSION_EXPIRED` | invite or session time limit passed | `REJECTED_EXPIRED` |
| 413 | `PAYLOAD_TOO_LARGE` | body > 16 KiB | `REJECTED_INVALID` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | not JSON | `REJECTED_INVALID` |
| 422 | `INVALID_RESULT` / `TASK_MISMATCH` | envelope or record failed validation | `REJECTED_INVALID` |
| 429 | `RATE_LIMITED` | per-client window exceeded (`Retry-After` set) | `RATE_LIMITED` |
| 5xx | `INTERNAL` / `CAPACITY` | server fault or session table full | `FAILED_NETWORK` (retryable) |
| – | – | no response | `FAILED_NETWORK` / `FAILED_TIMEOUT` (retryable) |

## 7. Session states

```
CREATED --claim--> CLAIMED --submit--> RESULT_SUBMITTED --accept(digest)--> ACCEPTED
   |                  |                       |
   +------ cancel (receiver) --------------------+--> CANCELLED
   +------ invite 10 min / session 30 min --------+--> EXPIRED
```

- `ACCEPTED`, `CANCELLED`, and `EXPIRED` are terminal.
- Every transition is checked on the server, inside one atomic store update. The deadline is evaluated at write time:
  a request read before the deadline but written after it fails `SESSION_EXPIRED` and leaves the session EXPIRED.
- Terminal states are never replaced, including by a late or stale expiry.
- A lost `POST /v1/claim` response does not reopen the invite. The retry gets `ALREADY_CLAIMED`, and recovery is a new
  session and QR from the vehicle (architecture §4.2).
- Clients cannot set a state.
