# AR-02A threat model: inspection pairing and sync

Assets:

- the user-reported inspection result (low sensitivity, but integrity matters);
- the pairing tokens;
- the vehicle display's claim of "what was received".

The result never carries identity, location, or media; see the AR-01 allow-list.

Trust boundaries:

- QR display → phone camera (optical, observable);
- phone → sync server (network);
- sync server → vehicle receiver (network);
- the server process memory.

## Threats and controls

| # | threat | control in AR-02A | test |
|---|---|---|---|
| T1 | Guessing a token | 256-bit `randomBytes` tokens; only SHA-256 hashes are stored; malformed tokens are rejected before lookup; rate limits per client and route class | protocol [2], server 429 |
| T2 | Replay of a photographed or forwarded QR | Invite is single use (CREATED → CLAIMED inside one atomic update), expires after 10 min, and the session closes after accept | service [5] incl. racing claims, e2e second phone |
| T3 | Token leak through URL, Referer, history, or logs | Invite is in the fragment (never sent to servers) and stripped with `replaceState`. API tokens travel only in the `Authorization` header; a query string gets 400. `Referrer-Policy: no-referrer`. Logs hold method, route template, status, and ms only. Error bodies hold a code only. | server log and response checks, browser "no token in URL" |
| T4 | Phone reading another session's data | Read rights (`receiverToken`) are separate from submit rights. The phone status has no result view. A wrong token looks the same as an unknown id (404). | service [11], server HTTP roles |
| T5 | Overwriting a submitted result (malicious or by a race) | One result per session; a different digest gets 409 CONFLICT; the check is atomic in the store update | service [9][10] incl. concurrency |
| T6 | Accepting a result other than the one displayed | Accept carries the digest the receiver saw; a mismatch gets CONFLICT | service [12] |
| T7 | Sending incomplete, forged, or overlong results | Server-side `checkEnvelope()` runs the AR-01 strict allow-list, requires COMPLETED, and checks the task. Bodies are limited to 16 KiB, JSON only. | protocol [7][16], server 413/415/422 |
| T8 | Smuggling PII (VIN, plate, account, device id, GPS, photo, frame, tap coordinates) | Unknown fields are rejected at the envelope and record levels; `aids` accepts booleans only | protocol [16], server [16] |
| T9 | False "sent" on the phone | SENT only after a receipt matching `inspectionId` and digest; timeouts, network failures, and mismatched 2xx stay failures | client tests |
| T10 | Stale data after a restart or expiry | Memory store: a restart drops everything and old tokens get 404. Expired or cancelled sessions drop the result immediately. Accepted results are purged after 10 min. Tombstones are deleted after 60 min. | service [6][14][18], server restart, client restart |
| T11 | Flooding and memory exhaustion | Fixed-window rate limits (429 + Retry-After), a 500-session cap (503), a rate-limit key table that prunes expired windows, header and request timeouts | server [17], service capacity |
| T12 | Cross-origin abuse by a browser | No CORS unless one exact origin is configured; preflight from other origins gets 403; `credentials: 'omit'` (no cookies exist anyway) | server CORS |
| T13 | Network eavesdropping | The server refuses a non-loopback bind without TLS; HSTS is sent over TLS | server bind test |
| T14 | Script injection on the debug page | Strict CSP (`default-src 'none'`, `script-src 'self'`); results are rendered with `textContent` only; the page is off unless `SYNC_DEBUG_PAGE=1` | server debug CSP, browser no-errors |
| T15 | Rogue session creation, e.g. a fake "vehicle" | **Partially mitigated.** Only loopback callers may create. This is a stand-in, not vehicle authentication. | server loopback test |

## Residual risks and explicit limits

- **No vehicle or owner authentication.** A QR proves only that someone saw it. Anyone who sees the QR in the first
  10 minutes and claims it first becomes the submitter. The result is labeled as user-reported and is never treated
  as a diagnosis or as proof of ownership.
- **Shoulder-surfing or relaying the QR** before the owner claims it is possible; the window is 10 minutes. The
  receiver shows the received result for an explicit decision, which is the mitigation. A short confirmation code shown
  on both screens is a candidate for AR-02B.
- **Single process, memory only.** Rate limits and the session cap do not hold across instances. This must not be
  deployed to serverless or multi-instance hosting.
- **No hosted TLS in this PR.** TLS support exists (`SYNC_TLS_CERT` / `SYNC_TLS_KEY`) but was not exercised with a
  real certificate. All tests ran over loopback HTTP.
- **Receiver token at rest.** The simulator keeps it in memory only. The future Android receiver must not persist it in
  plain storage.
- **Debug page.** It must never be enabled on a public host. It is meant for local and LAN testing behind TLS only.
