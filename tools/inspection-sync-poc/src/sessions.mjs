// AR-02A server-side session service: the pairing state machine and every check that must not live in a client.
//
//   CREATED --claim(invite)--> CLAIMED --submit(result)--> RESULT_SUBMITTED --accept(digest)--> ACCEPTED
//      \______________________ cancel (receiver) ______________________/            (terminal)
//      \______________________ time limit passed ______________________/ -> EXPIRED (terminal)
//
// Roles have separate tokens: the vehicle receiver holds `receiver` (read + accept + cancel), the phone first holds the
// one-time `invite` from the QR and exchanges it for a `submit` token (submit + read its own status, never the result
// view). Only SHA-256 hashes of tokens are stored. One session carries at most one result; a different result is a
// conflict, the identical one is an idempotent duplicate.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ERRORS, PROTOCOL, PROTOCOL_VERSION, SUPPORTED_TASKS, TOKEN_BYTES, checkEnvelope, isToken, resultDigest } from './protocol.mjs';

export const STATES = Object.freeze({ CREATED: 'CREATED', CLAIMED: 'CLAIMED', RESULT_SUBMITTED: 'RESULT_SUBMITTED', ACCEPTED: 'ACCEPTED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED' });
const TERMINAL = new Set([STATES.ACCEPTED, STATES.EXPIRED, STATES.CANCELLED]);

export const DEFAULT_LIMITS = Object.freeze({
  inviteTtlMs: 10 * 60_000, // the QR must be claimed within 10 min
  sessionTtlMs: 30 * 60_000, // the whole pairing (claim, submit, accept) must finish within 30 min
  acceptedRetentionMs: 10 * 60_000, // after ACCEPTED the receiver can re-read the result for 10 min, then it is purged
  tombstoneMs: 60 * 60_000, // state-only record kept 60 min so late requests get EXPIRED/CLOSED instead of NOT_FOUND
  maxSessions: 500,
});

export class SyncError extends Error {
  constructor(code, status, message = code) { super(message); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new SyncError(code, status); };
const failClosed = (state) => (state === STATES.EXPIRED ? fail(ERRORS.SESSION_EXPIRED, 410) : fail(ERRORS.SESSION_CLOSED, 409));

export const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

export class SessionService {
  constructor({ store, now = Date.now, limits = {}, newId = randomUUID, token = newToken } = {}) {
    this.store = store; this.now = now; this.limits = { ...DEFAULT_LIMITS, ...limits }; this.newId = newId; this.token = token;
  }

  // Every transition re-checks its precondition inside store.update() (atomic per session) and throws there to abort,
  // so two concurrent requests can never both pass a check made on an earlier read.

  // ---------- vehicle receiver ----------

  /** New pairing session. Returns both tokens exactly once; only their hashes are kept. */
  async create({ taskId }) {
    if (!SUPPORTED_TASKS.includes(taskId)) fail(ERRORS.BAD_REQUEST, 400);
    if (await this.store.count() >= this.limits.maxSessions) {
      await this.sweep();
      if (await this.store.count() >= this.limits.maxSessions) fail(ERRORS.CAPACITY, 503);
    }
    const t = this.now(), receiver = this.token(), invite = this.token();
    const session = {
      id: this.newId(), taskId, state: STATES.CREATED, createdAt: t,
      inviteExpiresAt: t + this.limits.inviteTtlMs, expiresAt: t + this.limits.sessionTtlMs,
      receiverHash: hashToken(receiver), inviteHash: hashToken(invite), submitHash: null,
      result: null, resultDigest: null, inspectionId: null, receivedAt: null, acceptedAt: null, endedAt: null, purgeResultAt: null,
    };
    await this.store.insert(session);
    return { sessionId: session.id, taskId, receiverToken: receiver, inviteToken: invite, inviteExpiresAt: session.inviteExpiresAt, expiresAt: session.expiresAt };
  }

  /** Receiver view: state and, once submitted, the result. Wrong token and unknown id are indistinguishable. */
  async view(sessionId, receiverToken) {
    const s = await this.#receiverSession(sessionId, receiverToken);
    return {
      sessionId: s.id, taskId: s.taskId, sessionState: s.state, expiresAt: s.expiresAt,
      result: s.result, resultDigest: s.resultDigest, receivedAt: s.receivedAt, acceptedAt: s.acceptedAt,
    };
  }

  /** Explicit acceptance of the exact result the receiver saw (by digest). */
  async accept(sessionId, receiverToken, digest) {
    const s = await this.#receiverSession(sessionId, receiverToken);
    const t = this.now();
    await this.#update(s.id, (x) => {
      if (x.state === STATES.ACCEPTED && x.resultDigest === digest) return x; // idempotent repeat
      if (TERMINAL.has(x.state)) failClosed(x.state);
      if (x.state !== STATES.RESULT_SUBMITTED) fail(ERRORS.INVALID_STATE, 409);
      if (typeof digest !== 'string' || digest !== x.resultDigest) fail(ERRORS.CONFLICT, 409);
      return { ...x, state: STATES.ACCEPTED, acceptedAt: t, endedAt: t, purgeResultAt: t + this.limits.acceptedRetentionMs };
    });
    return this.view(sessionId, receiverToken);
  }

  /** Receiver ends the session; any submitted result is deleted at once. */
  async cancel(sessionId, receiverToken) {
    const s = await this.#receiverSession(sessionId, receiverToken);
    const t = this.now();
    await this.#update(s.id, (x) => {
      if (x.state === STATES.CANCELLED) return x;
      if (TERMINAL.has(x.state)) failClosed(x.state);
      return { ...x, state: STATES.CANCELLED, endedAt: t, result: null, resultDigest: null, inviteHash: null };
    });
    return { sessionId: s.id, sessionState: STATES.CANCELLED };
  }

  // ---------- phone ----------

  /** One-time: the invite from the QR becomes a submit token. A second claim of the same invite is refused. */
  async claim(inviteToken) {
    const s = await this.#byToken('invite', inviteToken);
    const submit = this.token(), t = this.now();
    // The invite hash stays indexed so a replay answers ALREADY_CLAIMED instead of NOT_FOUND.
    await this.#update(s.id, (x) => {
      if (TERMINAL.has(x.state)) failClosed(x.state);
      if (x.state !== STATES.CREATED) fail(ERRORS.ALREADY_CLAIMED, 409);
      if (t > x.inviteExpiresAt) fail(ERRORS.SESSION_EXPIRED, 410); // marked EXPIRED by the next read or sweep
      return { ...x, state: STATES.CLAIMED, submitHash: hashToken(submit) };
    });
    return { submitToken: submit, taskId: s.taskId, sessionState: STATES.CLAIMED, expiresAt: s.expiresAt };
  }

  /** Submit the completed result. Same result again -> same receipt; any different result -> CONFLICT. */
  async submit(submitToken, envelope) {
    const s = await this.#byToken('submit', submitToken);
    if (TERMINAL.has(s.state)) failClosed(s.state);
    const problems = checkEnvelope(envelope, s.taskId);
    if (problems.length) fail(problems.some((p) => p.includes('task mismatch')) ? ERRORS.TASK_MISMATCH : ERRORS.INVALID_RESULT, 422);
    const digest = await resultDigest(envelope.result);
    const t = this.now();
    let duplicate = false;
    const next = await this.#update(s.id, (x) => {
      if (TERMINAL.has(x.state)) failClosed(x.state);
      if (x.state === STATES.RESULT_SUBMITTED) {
        if (digest !== x.resultDigest) fail(ERRORS.CONFLICT, 409); // never overwrite a submitted result
        duplicate = true;
        return x;
      }
      if (x.state !== STATES.CLAIMED) fail(ERRORS.INVALID_STATE, 409);
      return { ...x, state: STATES.RESULT_SUBMITTED, result: structuredClone(envelope.result), resultDigest: digest, inspectionId: envelope.result.inspectionId, receivedAt: t };
    });
    return { receipt: this.#receipt(next), duplicate };
  }

  /** Phone-side status (no result view): lets the phone learn ACCEPTED / CANCELLED / EXPIRED. */
  async status(submitToken) {
    const s = await this.#byToken('submit', submitToken);
    return { sessionState: s.state, expiresAt: s.expiresAt, receipt: s.resultDigest ? this.#receipt(s) : null };
  }

  // ---------- housekeeping ----------

  /** Expire overdue sessions, purge results past retention, drop old tombstones. Returns counts. */
  async sweep() {
    const t = this.now(), out = { expired: 0, purged: 0, deleted: 0 };
    for (const s of await this.store.all()) {
      if (!TERMINAL.has(s.state) && (t > s.expiresAt || (s.state === STATES.CREATED && t > s.inviteExpiresAt))) { await this.#expire(s.id); out.expired++; continue; }
      if (s.result && s.purgeResultAt && t > s.purgeResultAt) { await this.store.update(s.id, (x) => ({ ...x, result: null })); out.purged++; }
      if (TERMINAL.has(s.state) && s.endedAt && t > s.endedAt + this.limits.tombstoneMs) { await this.store.delete(s.id); out.deleted++; }
    }
    return out;
  }

  // ---------- internals ----------

  async #update(id, mutate) {
    const next = await this.store.update(id, mutate);
    if (!next) fail(ERRORS.NOT_FOUND, 404); // deleted by a sweep in between
    return next;
  }

  async #byToken(kind, token) {
    if (!isToken(token)) fail(ERRORS.UNAUTHORIZED, 401);
    const id = await this.store.idByTokenHash(kind, hashToken(token));
    const s = id && await this.store.get(id);
    if (!s) fail(ERRORS.NOT_FOUND, 404);
    return this.#lazyExpire(s);
  }

  async #receiverSession(sessionId, token) {
    if (!isToken(token)) fail(ERRORS.UNAUTHORIZED, 401);
    const id = await this.store.idByTokenHash('receiver', hashToken(token));
    if (!id || id !== sessionId) fail(ERRORS.NOT_FOUND, 404); // no oracle for "exists but not yours"
    const s = await this.store.get(id);
    if (!s) fail(ERRORS.NOT_FOUND, 404);
    return this.#lazyExpire(s);
  }

  async #lazyExpire(s) {
    if (!TERMINAL.has(s.state) && this.now() > s.expiresAt) return this.#expire(s.id);
    if (s.state === STATES.CREATED && this.now() > s.inviteExpiresAt) return this.#expire(s.id);
    return s;
  }

  async #expire(id) {
    const t = this.now();
    return this.store.update(id, (x) => ({ ...x, state: STATES.EXPIRED, endedAt: t, result: null, resultDigest: x.resultDigest }));
  }

  #receipt(s) {
    return { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, inspectionId: s.inspectionId, resultDigest: s.resultDigest, receivedAt: s.receivedAt, sessionState: s.state };
  }
}
