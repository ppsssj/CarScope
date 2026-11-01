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
| Claim response lost: the server marked the invite used, but the phone never received its submit token | Session stays `CLAIMED`; a retried claim gets 409 `ALREADY_CLAIMED`. The submit token is **never** re-issued or re-sent. | Claim: `FAILED_NETWORK`, then retry gives `REJECTED_CLOSED` and the page tells the user to get a new QR |

### 4.1 Concurrency rules

A read only locates a session. Every write re-evaluates its precondition **and the clock** inside one atomic store
operation (`#transition()` in `sessions.mjs`). This covers transitions, expiry, result purge, tombstone delete, and
the capacity check. As a result:

- **Terminal states are final.** ACCEPTED, CANCELLED and EXPIRED are never replaced. An expiry decided earlier by a
  request, a sweep snapshot, or a delayed timer is conditional: it does nothing unless the session is *still*
  non-terminal and overdue *at write time*.
- **The deadline is enforced at write time.** A transition whose read happened before the deadline but whose write
  lands after it does not commit. The session is written as EXPIRED and the caller gets `SESSION_EXPIRED`. What a
  caller is told always equals the stored final state; for example, an accept is never reported while the session
  ends EXPIRED.
- **Expiry does not conflict with retention.** EXPIRED and CANCELLED drop the result in the same write. ACCEPTED keeps
  the result until `purgeResultAt`, and a stale expiry can no longer wipe it early. The purge and tombstone delete
  re-check their own conditions at write time.
- **Capacity is checked in the insert.** `insert(session, { maxSessions })` checks capacity and inserts in one atomic
  step, so concurrent creates cannot overshoot `maxSessions`.
- **Racing writes:** racing claims of one invite produce exactly one submit token. Racing submits of different
  records store exactly one record.

All of these are reproduced in `test/race.test.mjs` with forced interleavings and a seeded fuzz across the expiry
boundary. All 8 cases failed before the fix; see the evidence README.

### 4.2 Recovery when the claim response is lost

The invite stays one-time even when its response was lost, because the server cannot tell a lost response from a
replay by someone else. The procedure is explicit and driven by the user:

1. **Phone.** The first claim shows "연결에 실패했습니다… 다시 시도했을 때 '이미 사용됨'이 나오면 새 QR이 필요합니다", and
   retry is allowed. If the retry returns `ALREADY_CLAIMED`, the page shows "이 QR은 이미 사용되었거나
   종료되었습니다. 차량 화면에서 기존 요청을 취소하고 새 QR을 발급받아 다시 스캔하세요" and disables further claims.
2. **Vehicle.** The receiver sees the session stuck in `CLAIMED` with no result. The user cancels it, which deletes
   the session data and makes the old invite and the lost submit token useless. Then the receiver creates a new
   session and shows a new QR. The receiver CLI does this cancel automatically when its wait times out, and prints
   the guidance to start again.
3. **Phone.** The user scans the new QR and the normal flow continues.

Nothing in this procedure re-exposes a token or relaxes the one-time rule.

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
- **Store interface and guarantees** (the full text is in `src/session-store.mjs`). A durable store must provide all
  of the following, linearizable per session:
  - `update(id, mutate)` is atomic. Use a transaction, or compare-and-set on a version column. `mutate` may be
    re-run on retry, so it must be a pure function of the stored value and the clock.
  - `insert(session, { maxSessions })` checks capacity and inserts in one transaction, for example with a counter row
    in the same transaction or with SERIALIZABLE isolation. Session id and every token hash have unique constraints.
  - `delete(id, predicate)` is a single conditional delete.
  - Token-hash indexes change in the same transaction as the row.
  - Only token hashes are indexed.

  `MemorySessionStore` meets these guarantees only inside one process, because no store method awaits. It must not
  back a multi-instance or serverless deployment.

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
