# AR-02A evidence

Run date: 2026-11-01, on a Windows 10 home PC with Node 22.16.0 and headless Microsoft Edge 156 (Playwright 1.56.1).

All results below are **SYNTHETIC / LOCAL**. Every component (server, receiver, and phone client or browser) ran on one
machine over loopback HTTP. **No two-device or real-vehicle verification has been done.** There was no phone, no
vehicle, no hosted server, and no TLS certificate. No result here is a real-device result.

Screenshots and transcripts are stored outside the repository, in `C:\CarScope-External\ar-02a\run-01..04\`. They
contain no tokens: the invite is redacted in transcripts, and the screenshot shows no token because the page strips it
before rendering.

## Commands

```
node --test tools/inspection-sync-poc/test/*.test.mjs           # 48/48 pass (39 original + 8 race + 1 claim-loss E2E; also in Geometry CI)
SYNC_EVIDENCE_DIR=C:\CarScope-External\ar-02a\run-04 node tools/inspection-sync-poc/test/browser.mjs   # 11/11 checks
cd tools/mobile-ar-poc && npm run check && npm test             # AR-01: check OK, 31/31 pass
POC_EVIDENCE_DIR=C:\CarScope-External\qr-ar-01\ar-02a-regression-2 npm run test:browser   # AR-01 browser: PASS
```

## Required tests → where they are covered

| # | requirement | test(s) | result |
|---|---|---|---|
| 1 | session creation | `service [1] create`, `server HTTP flow` | PASS |
| 2 | secure tokens | `protocol [2] tokens` (2000 × unique 32-byte base64url, hash-only storage), `service [1]` (no plaintext in store) | PASS |
| 3 | QR v1 regression | `protocol [3]` (v1 unchanged, parsers mutually exclusive), AR-01 unit 31/31, AR-01 browser PASS | PASS |
| 4 | QR v2 parsing | `protocol [4]` (exact shape, order free; extra, duplicate, or missing keys and bad tokens rejected, token never echoed) | PASS |
| 5 | invalid token | `service [5]` (malformed → 401, unknown → 404, invite ≠ submit token, single-use invite, 3 racing claims → 1 winner) | PASS |
| 6 | expired session | `service [6]` (invite 10 min, session 30 min, result dropped, accept refused) | PASS |
| 7 | incomplete result rejected | `protocol [7][16]`, `service [7][8]`, `server` 422, `client [7]` (never sent) | PASS |
| 8 | valid submission | `service [7][8]`, `server HTTP flow` 201 + receipt, `e2e` | PASS |
| 9 | identical duplicate | `service [9][10]` same receipt, `server` 200 `duplicate: true` | PASS |
| 10 | conflicting result rejected | `service [9][10]` CONFLICT, no overwrite; 20 × racing different submits → exactly one stored | PASS |
| 11 | unauthorized view rejected | `service [11]`, `server HTTP flow` (submit token → 404, none → 401, phone cannot accept) | PASS |
| 12 | vehicle acceptance | `service [12][13]` (digest-bound, idempotent), `e2e`, browser | PASS |
| 13 | resubmit after acceptance blocked | `service [12][13]`, `server` 409 | PASS |
| 14 | cancel | `service [14]` (result deleted, submit and accept refused, invite dead), `e2e decline` | PASS |
| 15 | network failure / retry | `client [15]` ×3 (fail → retry → SENT with the identical envelope; bounded retries stay a failure; real server stopped → FAILED_NETWORK) | PASS |
| 16 | forbidden PII fields | `protocol [7][16]` (vin, plate, account, deviceId, gps, location, photo, video, frame, tapX, tap point in aids), `server` 422 without echo | PASS |
| 17 | flood / oversize | `server [17]` (413 for > 16 KiB, 429 + Retry-After for submit and create) | PASS |
| 18 | server restart policy | `service [18]`, `server [18]`, `client` (restart → stale token rejected, never SENT) | PASS |
| 19 | AR-01 unit and browser regression | `tools/mobile-ar-poc` check, `npm test` 31/31, `test:browser` PASS | PASS |

Additional checks:

- The client calls `fetch` unbound. This test guards the bug where a browser threw "Illegal invocation"; the browser
  test found it.
- A 2xx response without a matching receipt is never SENT.
- Timeout is distinct from network failure.
- Every rejection maps to a distinct, non-retried outcome.
- CORS is opt-in for an exact origin only.
- Loopback-only creation is enforced (a remote address gets 403).
- A non-loopback bind without TLS is refused.
- The debug page has a strict CSP and an allow-listed file set.
- No token, session id, or inspection id appears in server logs.

## Concurrency follow-up (review of e95e644)

The review of `e95e644` raised three issues:

- expiry could overwrite terminal states;
- the count-then-insert capacity check could race;
- a lost claim response needed a recovery path.

Each was reproduced **before** fixing it. `test/race.test.mjs` was run against an unmodified `git archive e95e644`
copy:

| test | e95e644 | fixed |
|---|---|---|
| [1] expiry vs accept (accept read before the deadline, written after; sweep in between) | FAIL: `ACCEPTED -> EXPIRED`, accept had been reported | PASS |
| [2] expiry vs cancel | FAIL: `CANCELLED -> EXPIRED` | PASS |
| [3] stale expiry job (sweep snapshot before the accept, two instances with clock skew) | FAIL: `ACCEPTED -> EXPIRED`, accepted result wiped | PASS: ACCEPTED, result kept until `purgeResultAt` |
| [4] stale expiry job vs CANCELLED | FAIL: `CANCELLED -> EXPIRED` | PASS |
| [5] stale lazy expiry from a late reader | FAIL: `ACCEPTED -> EXPIRED` | PASS: the reader sees ACCEPTED |
| [6] sweep ×2 + accept or cancel + duplicate submit + status, 300 seeded iterations across the expiry boundary | FAIL: 34 invariant violations (terminal overwritten; reported outcome ≠ final state) | PASS: 0 |
| [7] 25 concurrent creates, `maxSessions` = 3 | FAIL: 25 created, 25 stored | PASS: 3 created, 22 `CAPACITY` |
| [8] 20 × 30 concurrent creates with random store latency, `maxSessions` = 5 | FAIL | PASS: always 5 |

Fixes:

- Every write now re-checks its precondition and the clock inside one atomic store operation (`#transition()`).
- Expiry is a conditional write that never touches terminal or not-yet-overdue sessions.
- The purge and the tombstone delete are conditional.
- `insert(session, { maxSessions })` checks capacity and inserts atomically.
- The store contract and the guarantees a durable store must provide are documented in `src/session-store.mjs` and in
  architecture §4.1 and §5.

**Claim response lost** (`e2e` and browser):

1. The server marks the invite CLAIMED, but the response is dropped (fetch wrapper in e2e; Playwright
   `route.fetch()` then `route.abort()` in the browser).
2. The phone is not paired and shows `FAILED_NETWORK` with retry allowed.
3. The retry gets `ALREADY_CLAIMED`, shown as `REJECTED_CLOSED` with new-QR guidance. Further claims are disabled.
4. Nothing can be sent.
5. The vehicle cancels; the old invite then resolves to nothing, and the lost submit token gets 409.
6. A new QR pairs and sends normally.

No token is re-issued or re-sent. The screenshot is `run-04\04-claim-lost.png`.

## Synthetic local E2E

`test/e2e.test.mjs` (in CI):

1. receiver simulator creates a session;
2. QR v2 fragment;
3. phone strips the fragment and claims;
4. a real AR-01 `completeInspection(…, 'NEEDS_REFILL')` record;
5. explicit send;
6. receipt verified (SENT);
7. the record is unchanged (`sync: NOT_SENT`);
8. the receiver views it, `validateResult` passes, and the Korean display contains all required lines;
9. accept with the digest;
10. the phone status is ACCEPTED;
11. a second phone cannot reuse the invite.

The decline path is also covered: cancel leads to the result being deleted and the phone seeing CANCELLED.

**Browser** (`test/browser.mjs`, headless Edge, 390×844): 11 checks. They are the ten below plus the claim-loss
check described above.

- The invite is stripped from the address bar.
- Send is disabled before pairing and before completion.
- A double press sends one request.
- SENT appears only with a matching receipt.
- No token or query string appears in any request URL.
- The phone sees ACCEPTED.
- A reload cannot re-pair.
- There are no console errors.

**CLI process smoke test** (real `src/server.mjs` and `bin/receiver.mjs --auto-accept` processes, phone client in a
third process):

- `transport: SENT` and `phoneSeesState: ACCEPTED`, with receiver exit code 0.
- The server log contained only route templates, for example `POST /v1/submissions 201 3ms`.
- `tokenInServerLog: false`.

Receiver output (invite redacted):

```
세션 생성 · 초대 만료 오후 5:17:24 · 세션 만료 오후 5:37:24
QR 내용(한 번만 표시, 공유하지 마세요):
#v=2&task=washer-fluid&invite=<invite-redacted>
항목: 워셔액 셀프 점검
사용자 보고 결과: 정상 확인 (USER_REPORTED)
완료 시각: 2026. 11. 1. 오후 5:07:24
전송 상태: 서버 수신 확인됨 · 수락 대기
주의: 사용자가 직접 확인해 보고한 결과이며 실제 차량 센서 진단이 아닙니다.
...
전송 상태: 수락됨
```

## Not verified (open)

- **Two devices** (a real phone and a separate receiver) on a LAN with TLS: not run.
- **A real Android vehicle receiver:** not possible yet. There is no `INTERNET` permission and no receiver
  implementation; see the AR-02B entry conditions in the architecture doc.
- **The hosted HTTPS path, a durable store, and multi-instance behaviour:** out of scope.
