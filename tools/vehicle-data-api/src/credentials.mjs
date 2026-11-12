// Server-side credentials: OAuth state, provider tokens and client secrets.
// - State is single use, short lived and bound to the CarScope session that started the flow (a callback from any other session,
//   or a replay, is refused). It is not the AVD enrollment or the mobile QR token, and neither of those is accepted as one.
// - Tokens and secrets live in objects that refuse to serialize or print, so a log line or a JSON response cannot carry them.
// - No encrypted token store has been approved in this repository. Live activation therefore stays BLOCKED; only the
//   test-only in-memory store exists, and it refuses to load on a deployed host.
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const REDACTED = '[REDACTED]';
const hidden = { toJSON: () => REDACTED, toString: () => REDACTED, [Symbol.for('nodejs.util.inspect.custom')]: () => REDACTED };

/** A secret value that never leaves through JSON, string conversion or inspection. Read it only with reveal(). */
export class Secret {
  #value;
  constructor(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\r\n]/.test(value)) throw new Error('INVALID_SECRET');
    this.#value = value; Object.assign(this, hidden); Object.freeze(this);
  }
  reveal() { return this.#value; }
}
export const isSecret = x => x instanceof Secret;

/** Tokens for one linked account. expiresAt is from the provider's expires_in or its documented lifetime, in ms since epoch. */
export class TokenRecord {
  #access; #refresh;
  constructor({ accessToken, refreshToken = null, expiresAt, provider, accountKey }) {
    this.#access = new Secret(accessToken); this.#refresh = refreshToken === null ? null : new Secret(refreshToken);
    if (!Number.isSafeInteger(expiresAt) || typeof provider !== 'string' || typeof accountKey !== 'string') throw new Error('INVALID_TOKEN_RECORD');
    this.expiresAt = expiresAt; this.provider = provider; this.accountKey = accountKey;
    Object.assign(this, { toJSON: () => ({ provider, accountKey: REDACTED, expiresAt, accessToken: REDACTED, refreshToken: REDACTED }),
      toString: () => REDACTED, [Symbol.for('nodejs.util.inspect.custom')]: () => `TokenRecord(${provider}, ${REDACTED})` });
    Object.freeze(this);
  }
  get access() { return this.#access; }
  get refresh() { return this.#refresh; }
}

/** Opaque, non-reversible key for a person, account or vehicle. Provider ids (carId, VIN, userId) never appear in keys or output. */
export function opaqueKey(prefix, salt, ...parts) {
  if (!(salt instanceof Secret)) throw new Error('INVALID_KEY_SALT');
  const h = createHash('sha256').update(salt.reveal());
  for (const p of parts) h.update('\u0000' + String(p));
  return `${prefix}_${h.digest('base64url').slice(0, 32)}`;
}

/** Single-use OAuth / consent state bound to (session, provider, purpose). */
export class OAuthStateStore {
  #states = new Map(); #now; #ttl; #max;
  constructor({ now = Date.now, ttlMs = 10 * 60_000, maxEntries = 10_000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 30 * 60_000) throw new Error('INVALID_STATE_POLICY');
    this.#now = now; this.#ttl = ttlMs; this.#max = maxEntries;
  }
  create({ sessionKey, provider, purpose }) {
    if (typeof sessionKey !== 'string' || sessionKey.length < 16 || !['LOGIN', 'CONSENT'].includes(purpose) || typeof provider !== 'string') throw new Error('INVALID_STATE_REQUEST');
    this.#prune();
    if (this.#states.size >= this.#max) throw new Error('STATE_CAPACITY');
    const state = randomBytes(32).toString('base64url'); // URL-safe, so no extra encoding is needed by either provider
    this.#states.set(state, { sessionKey, provider, purpose, expires: this.#now() + this.#ttl });
    return state;
  }
  /** True once, for the exact session/provider/purpose that created it, before it expires. Any attempt consumes it. */
  consume({ state, sessionKey, provider, purpose }) {
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
    const entry = this.#states.get(state);
    if (!entry) return false;
    this.#states.delete(state);
    const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
    return entry.expires > this.#now() && same(entry.sessionKey, sessionKey) && entry.provider === provider && entry.purpose === purpose;
  }
  get size() { return this.#states.size; }
  #prune() { const t = this.#now(); for (const [k, v] of this.#states) if (v.expires <= t) this.#states.delete(k); }
}

/**
 * Token store contract: get(accountKey) → TokenRecord|null, put(record), delete(accountKey), deleteWhere(predicate).
 * A deployable store must encrypt at rest with a key held outside the database and must be reviewed and added here.
 * None is: so every real configuration is BLOCKED with TOKEN_STORE_NOT_APPROVED.
 */
export const APPROVED_TOKEN_STORES = Object.freeze([]);

export class TestOnlyMemoryTokenStore {
  #records = new Map();
  constructor(env = globalThis.process?.env ?? {}) {
    if (env.RENDER || env.NODE_ENV === 'production') throw new Error('TEST_TOKEN_STORE_FORBIDDEN');
    this.testOnly = true; Object.freeze(this);
  }
  get(accountKey) { return this.#records.get(accountKey) ?? null; }
  put(record) { if (!(record instanceof TokenRecord)) throw new Error('INVALID_TOKEN_RECORD'); this.#records.set(record.accountKey, record); }
  delete(accountKey) { this.#records.delete(accountKey); }
  get size() { return this.#records.size; }
}

/** BLOCKED reason or null. A test-only store is accepted only when the caller is a test (testMode) and the host is not deployed. */
export function tokenStoreBlock(store, { testMode = false, env = globalThis.process?.env ?? {} } = {}) {
  if (!store) return 'TOKEN_STORE_MISSING';
  if (store.testOnly === true) return testMode && !env.RENDER && env.NODE_ENV !== 'production' ? null : 'TOKEN_STORE_NOT_APPROVED';
  return APPROVED_TOKEN_STORES.some(Kind => store instanceof Kind) ? null : 'TOKEN_STORE_NOT_APPROVED';
}
