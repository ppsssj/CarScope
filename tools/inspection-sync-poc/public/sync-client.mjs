// AR-02A mobile sync client (browser and Node). Not wired into the AR-01 page: it is exercised by the debug page and
// tests. Rules: send only on an explicit call, only a COMPLETED record that passes the AR-01 validator, one request in
// flight at a time, SENT only after a receipt that matches this record (inspectionId + SHA-256 digest). The completed
// record itself is never modified; transport state lives here.
import { PROTOCOL, PROTOCOL_VERSION, checkEnvelope, parseInviteFragment, receiptMatches, isToken, canonicalJson } from '../src/protocol.mjs';

export const TRANSPORT = Object.freeze({
  NOT_SENT: 'NOT_SENT', SENDING: 'SENDING', SENT: 'SENT', // SENT = server receipt verified
  FAILED_NETWORK: 'FAILED_NETWORK', FAILED_TIMEOUT: 'FAILED_TIMEOUT',
  REJECTED_EXPIRED: 'REJECTED_EXPIRED', REJECTED_CLOSED: 'REJECTED_CLOSED', REJECTED_CONFLICT: 'REJECTED_CONFLICT',
  REJECTED_INVALID: 'REJECTED_INVALID', REJECTED_UNAUTHORIZED: 'REJECTED_UNAUTHORIZED', RATE_LIMITED: 'RATE_LIMITED',
});
const RETRYABLE = new Set([TRANSPORT.FAILED_NETWORK, TRANSPORT.FAILED_TIMEOUT]);

/**
 * Read a v2 invite from location.hash and remove it from the address bar and history entry right away, so the token
 * is not left in the URL, bookmarks or a shared screenshot. Returns the parse result (token only in memory).
 */
export function takeInviteFromLocation(loc = globalThis.location, hist = globalThis.history) {
  const parsed = parseInviteFragment(loc?.hash ?? '');
  if (loc?.hash && hist?.replaceState) hist.replaceState(null, '', loc.pathname + loc.search);
  return parsed;
}

function mapError(status, code) {
  if (status === 410 || code === 'SESSION_EXPIRED') return TRANSPORT.REJECTED_EXPIRED;
  if (code === 'SESSION_CLOSED' || code === 'ALREADY_CLAIMED') return TRANSPORT.REJECTED_CLOSED;
  if (code === 'CONFLICT') return TRANSPORT.REJECTED_CONFLICT;
  if (status === 401 || status === 404) return TRANSPORT.REJECTED_UNAUTHORIZED;
  if (status === 429) return TRANSPORT.RATE_LIMITED;
  if (status === 422 || status === 400 || status === 413 || status === 415) return TRANSPORT.REJECTED_INVALID;
  return TRANSPORT.FAILED_NETWORK; // 5xx and anything unexpected: not a success, may be retried
}

export class SyncClient {
  #submitToken = null; #inFlight = null; #claimFlight = null; #claimAttempted = false;
  #disposed = false; #controllers = new Set(); #sendingJson = null; #sentJson = null;
  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000, retries = 2, backoffMs = 400, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    // Wrapped: browsers throw "Illegal invocation" when window.fetch is called as a method of another object.
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.fetch = (...a) => fetchImpl(...a); this.timeoutMs = timeoutMs; this.retries = retries; this.backoffMs = backoffMs; this.sleep = sleep;
    this.transport = TRANSPORT.NOT_SENT; this.receipt = null; this.lastError = null;
  }

  get paired() { return Boolean(this.#submitToken); }

  async #call(method, path, token, body) {
    if (this.#disposed) return { ok: false, status: 0, outcome: TRANSPORT.REJECTED_CLOSED };
    const ctrl = new AbortController();
    this.#controllers.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(this.baseUrl + path, {
        method, signal: ctrl.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      return { ok: false, status: 0, json: null, outcome: e?.name === 'AbortError' ? TRANSPORT.FAILED_TIMEOUT : TRANSPORT.FAILED_NETWORK };
    } finally { clearTimeout(timer); this.#controllers.delete(ctrl); }
  }

  /** Exchange the one-time invite for this phone's submit token. */
  claim(inviteToken) {
    if (this.#claimFlight) return this.#claimFlight;
    if (this.#disposed || this.#claimAttempted) return Promise.resolve({ ok: false, outcome: TRANSPORT.REJECTED_CLOSED });
    this.#claimAttempted = true; // even a lost response never permits another claim/re-issue
    this.#claimFlight = this.#claim(inviteToken).finally(() => { this.#claimFlight = null; });
    return this.#claimFlight;
  }

  async #claim(inviteToken) {
    const r = await this.#call('POST', '/v1/claim', inviteToken);
    if (this.#disposed) return { ok: false, outcome: TRANSPORT.REJECTED_CLOSED };
    if (!r.ok) return { ok: false, outcome: r.outcome ?? mapError(r.status, r.json?.error?.code), code: r.json?.error?.code ?? null };
    if (!isToken(r.json?.submitToken) || r.json?.taskId !== 'washer-fluid') return { ok: false, outcome: TRANSPORT.REJECTED_INVALID };
    this.#submitToken = r.json.submitToken;
    return { ok: true, taskId: r.json.taskId, expiresAt: r.json.expiresAt };
  }

  /**
   * Explicit send. Concurrent calls share one request. Network failures and timeouts are retried (the same result is
   * idempotent on the server); rejections are not. Resolves to { transport, receipt }.
   */
  send(result) {
    if (this.#disposed) return Promise.resolve({ transport: TRANSPORT.REJECTED_CLOSED, receipt: null });
    const json = canonicalJson(result);
    if (this.#inFlight) return json === this.#sendingJson ? this.#inFlight : Promise.resolve({ transport: TRANSPORT.REJECTED_CONFLICT, receipt: null });
    if (this.transport === TRANSPORT.SENT && json === this.#sentJson) return Promise.resolve({ transport: this.transport, receipt: this.receipt });
    this.#sendingJson = json;
    this.#inFlight = this.#send(structuredClone(result)).finally(() => { this.#inFlight = null; this.#sendingJson = null; });
    return this.#inFlight;
  }

  async #send(result) {
    const finish = (transport, receipt = null, error = null) => {
      if (this.#disposed) return { transport: TRANSPORT.REJECTED_CLOSED, receipt: null };
      this.transport = transport; this.receipt = receipt; this.lastError = error;
      if (transport === TRANSPORT.SENT) this.#sentJson = canonicalJson(result);
      return { transport, receipt, error };
    };
    if (!this.#submitToken) return finish(TRANSPORT.REJECTED_UNAUTHORIZED, null, 'not paired');
    const envelope = { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result };
    const local = checkEnvelope(envelope, result?.taskId);
    if (local.length) return finish(TRANSPORT.REJECTED_INVALID, null, local.join('; ')); // incomplete or malformed: never sent
    this.transport = TRANSPORT.SENDING;
    let outcome = TRANSPORT.FAILED_NETWORK, code = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.#disposed) return finish(TRANSPORT.REJECTED_CLOSED);
      if (attempt) await this.sleep(this.backoffMs * 2 ** (attempt - 1));
      const r = await this.#call('POST', '/v1/submissions', this.#submitToken, envelope);
      if (r.ok) {
        // Success only with a receipt for exactly this record.
        if (await receiptMatches(r.json?.receipt, result)) return finish(TRANSPORT.SENT, r.json.receipt);
        return finish(TRANSPORT.FAILED_NETWORK, null, 'receipt does not match the submitted result');
      }
      outcome = r.outcome ?? mapError(r.status, r.json?.error?.code);
      code = r.json?.error?.code ?? null;
      if (!RETRYABLE.has(outcome)) break;
    }
    return finish(outcome, null, code);
  }

  /** Session state as seen by the phone (e.g. ACCEPTED after the vehicle side accepted). */
  async status() {
    if (!this.#submitToken) return { ok: false, outcome: TRANSPORT.REJECTED_UNAUTHORIZED };
    const r = await this.#call('GET', '/v1/submissions/status', this.#submitToken);
    if (this.#disposed) return { ok: false, outcome: TRANSPORT.REJECTED_CLOSED };
    if (r.ok && !['CREATED', 'CLAIMED', 'RESULT_SUBMITTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED'].includes(r.json?.sessionState)) return { ok: false, outcome: TRANSPORT.REJECTED_INVALID };
    return r.ok ? { ok: true, sessionState: r.json.sessionState, receipt: r.json.receipt } : { ok: false, outcome: r.outcome ?? mapError(r.status, r.json?.error?.code) };
  }

  dispose() {
    this.#disposed = true; this.#submitToken = null; this.receipt = null;
    this.transport = TRANSPORT.REJECTED_CLOSED;
    for (const c of this.#controllers) c.abort();
  }
}
