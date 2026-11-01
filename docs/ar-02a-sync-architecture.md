# AR-02A: secure vehicle ↔ mobile inspection sync foundation

Scope: a **local, self-contained** foundation for sending a completed AR-01 self-inspection result from the phone to a
vehicle-side receiver. It covers:

- pairing through a QR v2 one-time invite;
- transport;
- a verified server ACK;
- duplicate and conflict handling;
- explicit acceptance on the vehicle side.

Code is in `tools/inspection-sync-poc/`. The wire contract is in [contracts/inspection-sync-v1.md](contracts/inspection-sync-v1.md),
the threats are in [ar-02a-threat-model.md](ar-02a-threat-model.md), and the evidence is in [evidence/ar-02a/README.md](evidence/ar-02a/README.md).

What AR-02A is **not**:

- It is not a deployed service. The server binds to loopback and keeps state in process memory.
- It does not change the Android app, the AR-01 production page, or the Vercel project.
- It does not authenticate a vehicle or an owner (see §6).

## 1. Findings that shaped the design

| finding | source | consequence |
|---|---|---|
| The AR-01 page is static and the Vercel project serves files only; there is no backend or storage | `tools/mobile-ar-poc/vercel.json`, staging build | No server can be assumed. The PoC brings its own local Node server. A hosted backend is an AR-02B decision. |
| The AR-01 page CSP is `connect-src 'self'` | `vercel.json`, `server.mjs` | The production page cannot call a sync API on another origin. AR-02B must choose between a same-origin API and a deliberate CSP change. |
| The Android app has no `INTERNET` permission and sets `usesCleartextTraffic="false"` | `app/src/main/AndroidManifest.xml` | The vehicle receiver cannot reach any server today. Adding network access is an AR-02B change and is HTTPS only. |
| The AR-01 v1 parser rejects anything except `#v=1&task=washer-fluid` | `public/handoff.mjs` | A v2 QR opened on today's page shows "unsupported QR"; it never half-pairs. v2 handling is a separate parser. |
| The AR-01 record already has a strict allow-list with no identity, location, or media fields | `public/inspection-result.mjs` | The transport reuses the record verbatim and adds nothing to it. |

## 2. Components

```
 vehicle side (simulated)                 local sync server (Node, loopback)                 phone (debug page / client)
 ┌───────────────────────┐   create     ┌─────────────────────────────────────┐   claim    ┌─────────────────────────┐
 │ bin/receiver.mjs      │ ───────────▶ │ src/server.mjs   HTTP, limits, CORS │ ◀───────── │ public/sync-client.mjs  │
 │  ReceiverClient       │   view       │ src/sessions.mjs state machine      │   submit   │  SyncClient             │
 │  describeReceived()   │ ◀─────────── │ src/protocol.mjs contract, digest   │ ─────────▶ │ public/debug.*          │
 │  (receiver token in   │   accept     │ src/session-store.mjs (interface)   │   status   │  (SYNC_DEBUG_PAGE=1)    │
 │   memory only)        │ ───────────▶ │ src/rate-limit.mjs                  │ ◀───────── │ AR-01 record modules    │
 └───────────────────────┘              └─────────────────────────────────────┘            └─────────────────────────┘
        shows QR v2  ─────────────────────────── #v=2&task=washer-fluid&invite=… ──────────────────────▶ scans
```

- **protocol.mjs** is shared by the server, the browser, and the receiver. It holds the QR v2 parser and builder, the
  envelope check (AR-01 `validateResult()` plus COMPLETED plus the task check), canonical JSON, the SHA-256 digest,
  and the receipt check.
- **sessions.mjs** holds every rule that must not live in a client:
  - token issue and hashing;
  - state transitions;
  - expiry;
  - duplicate and conflict handling;
  - role checks;
  - cleanup.
- **session-store.mjs** defines the storage interface. `MemorySessionStore` serves a single process only.
- **server.mjs** handles HTTP:
  - routes and the bearer-token header only;
  - body limit, media type, query rejection, and rate limits;
  - a loopback-only create route;
  - TLS required for any non-loopback bind;
  - exact-origin CORS opt-in;
  - an optional debug page with a strict CSP;
  - logs that contain no secrets.
- **sync-client.mjs** handles transport on the phone. It sends only on an explicit call and only a valid COMPLETED
  record. Concurrent presses share one request. Network failures and timeouts are retried a bounded number of times;
  rejections are not retried. The client reports SENT only after it verifies the receipt.
- **receiver.mjs** is the vehicle-side simulator. It creates a session, prints the QR content once, waits, shows the
  result in Korean, and then accepts or cancels.

## 3. Data flow

1. The receiver calls `POST /v1/sessions` from the same machine, the only allowed caller. It receives `receiverToken`
   and `inviteToken`; the server keeps only their hashes.
2. The receiver displays `…#v=2&task=washer-fluid&invite=<inviteToken>` as a QR.
3. The phone opens the URL, reads the fragment, and strips it from the URL immediately.
4. The phone calls `POST /v1/claim` with the invite. The session moves CREATED → CLAIMED and the phone gets its own
   `submitToken`. The invite cannot be used again.
5. The user finishes the AR-01 inspection. This step is unchanged; it produces a COMPLETED record with `sync: NOT_SENT`.
6. The user presses **결과 전송**. The client checks the envelope locally, then calls `POST /v1/submissions`.
7. The server validates again, computes the digest, and atomically moves CLAIMED → RESULT_SUBMITTED. It returns a
   receipt naming `inspectionId` and `resultDigest`.
8. The client compares the receipt with the record it sent. Only on a match does it show **SENT**, worded as "서버 수신
   확인 · 차량 수락 전".
9. The receiver polls `GET /v1/sessions/:id` and shows:
   - 워셔액 셀프 점검
   - 사용자 보고 결과
   - 완료 시각
   - 전송 상태
   - 실제 차량 센서 진단이 아닙니다
10. The user on the vehicle side accepts. `POST …/accept` carries the digest the receiver displayed, so it accepts
    exactly that record and moves the session to ACCEPTED. Declining calls cancel, which deletes the result.
11. The phone can poll `GET /v1/submissions/status` and see ACCEPTED, CANCELLED, or EXPIRED.

## 4. Duplicates, conflicts, retries

| situation | server | client |
|---|---|---|
| Same record sent again, e.g. a retry after a lost response | 200 with the **same** receipt, `duplicate: true` | SENT (receipt matches) |
| A different record (other status or other `inspectionId`) after one was stored | 409 `CONFLICT`; the stored record is unchanged | `REJECTED_CONFLICT` |
| Two different records racing | exactly one is stored; the other gets `CONFLICT` (the check is inside the atomic update) | one SENT, one `REJECTED_CONFLICT` |
| Double press of the send button | – | one request in flight; the second press gets the same promise |
| Network error or timeout | – | retried up to 2 times with backoff, carrying the identical envelope; stays `FAILED_*` if every attempt fails |
| 4xx rejection | – | not retried; the specific `REJECTED_*` state is shown |
| 2xx without a matching receipt | – | treated as a failure, never SENT |
| Submit after ACCEPTED or CANCELLED | 409 `SESSION_CLOSED` | `REJECTED_CLOSED` |
| Submit after expiry | 410 `SESSION_EXPIRED` | `REJECTED_EXPIRED` |

## 5. Storage and expiry policy

- The invite must be claimed within **10 min**. The whole session (claim, submit, accept) must finish within **30 min**.
- After ACCEPTED, the receiver can re-read the result for **10 min**; after that the result is purged.
- CANCELLED and EXPIRED delete the result **immediately**.
- A state-only tombstone, with no result and only token hashes, is kept for **60 min**. This lets late requests get a
  precise `SESSION_EXPIRED` or `SESSION_CLOSED` instead of `NOT_FOUND`. After that the session is deleted.
- Expiry is enforced lazily on every access and by a 30 s sweep.
- At most 500 sessions exist at once; beyond that, create returns 503 `CAPACITY`.
- **Restart policy:** the memory store does not survive a restart. Every token held before the restart then resolves to
  404, which the phone shows as `REJECTED_UNAUTHORIZED`. The phone is never told SENT for a result the server no
  longer has, and a receiver can never accept stale data.
- **Store interface:** a durable store must implement `update()` atomically (a transaction or conditional write) and
  must index only token hashes. `MemorySessionStore` must not back a multi-instance or serverless deployment.

## 6. Receiver authentication: scope and limits

- In AR-02A, the only control on **who may create a session** is that the caller is on loopback. This simulates "the
  vehicle app is the only creator". It is **not** vehicle authentication.
- The `receiverToken` proves only that the caller created this session. It does not prove which vehicle or owner is
  involved.
- Nothing in AR-02A identifies or authenticates a vehicle, an owner, or a phone user. The receiver shows the result as
  a user-reported self-check, never as a sensor diagnosis.

## 7. Android integration: entry conditions (AR-02B)

Android integration is **feasible but not possible today without changes**. Each change below is a separate,
reviewed change:

1. Add `android.permission.INTERNET`. Keep `usesCleartextTraffic="false"`, and add a network security config that
   allows only the sync host over HTTPS.
2. Implement a receiver equivalent to `ReceiverClient`:
   - hold the receiver token in memory, or in encrypted storage if needed;
   - render the QR v2 locally;
   - poll with backoff;
   - show the Korean summary lines from `describeReceived()`;
   - accept or cancel only on an explicit driver action, and only while the vehicle is parked if the UX requires it.
3. Replace the loopback stand-in with real service authentication of the vehicle app, for example an app or device
   attestation or a provisioned client credential. Decide this before any non-local server exists.
4. Use a durable, atomic store and a hosted HTTPS server. Each of these is a new service decision that needs approval
   and is not covered here.

## 8. Preview deployment: entry conditions (AR-02B)

Before any sync API is reachable beyond localhost:

- **Authentication:** session creation is authenticated (§7.3). Unauthenticated sync endpoints on the public internet
  are not allowed.
- **Storage:** a durable store with atomic conditional updates, a TTL index, and hashed tokens. Any new database or paid
  service needs explicit approval.
- **Transport and origin:**
  - TLS everywhere.
  - Either a same-origin API for the mobile page (preferred, since it keeps `connect-src 'self'`) or a reviewed CSP
    change plus `SYNC_ALLOWED_ORIGIN`-style exact CORS.
- **Distributed limits:** rate limits and capacity limits that work across instances (the in-memory limiter does not).
- **Mobile page:**
  - v2 integration into the AR-01 page behind a flag, so v1 and direct visits keep working.
  - The send button appears only after COMPLETED.
  - Wording: "서버 수신 확인" ≠ "차량 수락".
- **Logging:** request logs reviewed so they contain no tokens, no fragments, and no bodies.
- **Deployment rules:** preview deployment only, with no production alias and no change to Deployment Protection.
