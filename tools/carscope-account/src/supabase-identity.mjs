// P15: server-side verification of a Supabase Auth access token.
//
// A server never trusts a session object the browser hands it (the `getSession()` user is read from client storage and
// can be forged). It verifies the access token signature against the project's JWKS and checks issuer, audience, role,
// expiry and subject, then derives identity from those verified claims only. `user_metadata` / `app_metadata` are
// ignored: they are not needed and user_metadata is user-editable.
//
// Only asymmetric signing keys (ES256, RS256) are accepted. A project still on the legacy symmetric secret must either
// migrate to signing keys or call the Auth server's /user endpoint; this module refuses HS256 rather than holding the
// shared secret. No network origin other than the configured project's /auth/v1/.well-known/jwks.json is contacted.
//
// Result: { ok: true, identity } or { ok: false, reason } where reason is one of the REASONS below. Errors never carry
// the token, claims or key material. The module does not log.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

export const REASONS = Object.freeze({
  MALFORMED: 'MALFORMED',
  UNSUPPORTED_ALGORITHM: 'UNSUPPORTED_ALGORITHM',
  UNKNOWN_KEY: 'UNKNOWN_KEY',
  BAD_SIGNATURE: 'BAD_SIGNATURE',
  WRONG_ISSUER: 'WRONG_ISSUER',
  WRONG_AUDIENCE: 'WRONG_AUDIENCE',
  NOT_AUTHENTICATED_ROLE: 'NOT_AUTHENTICATED_ROLE',
  ANONYMOUS_USER: 'ANONYMOUS_USER',
  EXPIRED: 'EXPIRED',
  NOT_YET_VALID: 'NOT_YET_VALID',
  BAD_SUBJECT: 'BAD_SUBJECT',
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
});

const ALGORITHMS = Object.freeze({
  ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' }, kty: 'EC', crv: 'P-256' },
  RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' }, kty: 'RSA' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 8192;
const MAX_JWKS_BYTES = 64 * 1024;
const LEEWAY_S = 30;

const brand = new WeakSet();

/** True only for identity objects produced by a verifier in this process. */
export function isVerifiedIdentity(value) {
  return typeof value === 'object' && value !== null && brand.has(value);
}

/**
 * The project URL must be the bare https origin of a Supabase project (or loopback http for a local stack).
 * Returns the canonical origin or throws.
 */
export function supabaseProjectOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > 256) throw new TypeError('SUPABASE_URL_INVALID');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('SUPABASE_URL_INVALID'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new TypeError('SUPABASE_URL_INVALID');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new TypeError('SUPABASE_URL_INVALID');
  return url.origin;
}

function b64urlBytes(part) {
  if (typeof part !== 'string' || part.length === 0 || !B64URL.test(part)) return null;
  const bytes = Buffer.from(part, 'base64url');
  // Reject non-canonical encodings (trailing bits) so one token has exactly one byte form.
  return bytes.toString('base64url') === part ? bytes : null;
}

function parseJsonObject(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/**
 * @param {object} options
 * @param {string} options.supabaseUrl  Project origin, e.g. https://<ref>.supabase.co
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]  milliseconds
 * @param {number} [options.jwksTtlMs]
 * @param {number} [options.timeoutMs]
 */
export function createSupabaseIdentityVerifier({ supabaseUrl, fetchImpl = globalThis.fetch, now = Date.now, jwksTtlMs = 10 * 60_000, timeoutMs = 5_000 } = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS_VERIFICATION_DISABLED');
  const origin = supabaseProjectOrigin(supabaseUrl);
  const issuer = `${origin}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  let cache = { keys: new Map(), at: -Infinity };
  let inflight = null;

  async function loadJwks() {
    const response = await fetchImpl(jwksUrl, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!response || response.status !== 200) throw new Error('JWKS_HTTP');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_JWKS_BYTES) throw new Error('JWKS_TOO_LARGE');
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > MAX_JWKS_BYTES) throw new Error('JWKS_TOO_LARGE');
    const doc = parseJsonObject(body);
    if (!doc || !Array.isArray(doc.keys)) throw new Error('JWKS_SHAPE');
    const keys = new Map();
    for (const jwk of doc.keys) {
      if (!jwk || typeof jwk.kid !== 'string' || typeof jwk.alg !== 'string' || !ALGORITHMS[jwk.alg]) continue;
      if (jwk.use && jwk.use !== 'sig') continue;
      if ('d' in jwk || 'p' in jwk || 'k' in jwk) continue; // never import private or symmetric material
      const spec = ALGORITHMS[jwk.alg];
      if (jwk.kty !== spec.kty || (spec.crv && jwk.crv !== spec.crv)) continue;
      const publicJwk = spec.kty === 'EC' ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y } : { kty: 'RSA', n: jwk.n, e: jwk.e };
      try { keys.set(jwk.kid, { alg: jwk.alg, key: await subtle.importKey('jwk', publicJwk, spec.import, false, ['verify']) }); } catch { /* skip unusable key */ }
    }
    cache = { keys, at: now() };
    return keys;
  }

  async function keyFor(kid) {
    const fresh = now() - cache.at < jwksTtlMs;
    if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);
    // An unknown kid refetches at most every 30 s, so forged kids cannot turn every request into a JWKS fetch.
    if (fresh && now() - cache.at < 30_000) return null;
    // Unknown kid or stale cache: refetch once (key rotation), sharing one request between concurrent callers.
    inflight ??= loadJwks().finally(() => { inflight = null; });
    const keys = await inflight;
    return keys.get(kid) ?? null;
  }

  async function verify(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) return { ok: false, reason: REASONS.MALFORMED };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: REASONS.MALFORMED };
    const [h, p, s] = parts.map(b64urlBytes);
    if (!h || !p || !s) return { ok: false, reason: REASONS.MALFORMED };
    const header = parseJsonObject(h), claims = parseJsonObject(p);
    if (!header || !claims) return { ok: false, reason: REASONS.MALFORMED };
    if (!ALGORITHMS[header.alg] || (header.typ !== undefined && header.typ !== 'JWT') || 'crit' in header || 'jku' in header || 'jwk' in header || 'x5u' in header) {
      return { ok: false, reason: REASONS.UNSUPPORTED_ALGORITHM };
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 128) return { ok: false, reason: REASONS.UNKNOWN_KEY };

    let entry;
    try { entry = await keyFor(header.kid); } catch { return { ok: false, reason: REASONS.AUTH_UNAVAILABLE }; }
    if (!entry || entry.alg !== header.alg) return { ok: false, reason: REASONS.UNKNOWN_KEY };
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    let valid = false;
    try { valid = await subtle.verify(ALGORITHMS[header.alg].verify, entry.key, s, signed); } catch { valid = false; }
    if (!valid) return { ok: false, reason: REASONS.BAD_SIGNATURE };

    // Claims are checked only after the signature, so nothing above depends on attacker-chosen claim values.
    if (claims.iss !== issuer) return { ok: false, reason: REASONS.WRONG_ISSUER };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes('authenticated')) return { ok: false, reason: REASONS.WRONG_AUDIENCE };
    if (claims.role !== 'authenticated') return { ok: false, reason: REASONS.NOT_AUTHENTICATED_ROLE };
    if (claims.is_anonymous === true) return { ok: false, reason: REASONS.ANONYMOUS_USER };
    const nowS = Math.floor(now() / 1000);
    if (!Number.isInteger(claims.exp) || claims.exp <= nowS) return { ok: false, reason: REASONS.EXPIRED };
    if (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > nowS + LEEWAY_S)) return { ok: false, reason: REASONS.NOT_YET_VALID };
    if (claims.iat !== undefined && (!Number.isInteger(claims.iat) || claims.iat > nowS + LEEWAY_S)) return { ok: false, reason: REASONS.NOT_YET_VALID };
    if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return { ok: false, reason: REASONS.BAD_SUBJECT };

    const identity = Object.freeze({
      provider: 'SUPABASE_AUTH',
      issuer,
      userId: claims.sub,
      sessionId: typeof claims.session_id === 'string' && UUID.test(claims.session_id) ? claims.session_id : null,
      aal: claims.aal === 'aal1' || claims.aal === 'aal2' ? claims.aal : null,
      expiresAt: claims.exp * 1000,
    });
    brand.add(identity);
    return { ok: true, identity };
  }

  return Object.freeze({ verify, issuer, jwksUrl });
}

/** Reads `Authorization: Bearer <token>` strictly. Returns the token or null. */
export function bearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(headerValue);
  return match ? match[1] : null;
}
