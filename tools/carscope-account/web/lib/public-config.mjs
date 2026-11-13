// P15: the only Supabase values a browser may hold are the project URL and a publishable (or legacy anon) key.
// Shared by serve.mjs (refuses to publish anything else) and the pages (refuse to start with anything else).
// A missing or refused configuration is not an error for the rest of CarScope: trial mode never reads this file.

const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]{16,128}$/;
const SECRET = /^sb_secret_/;
const JWT = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;

function decodeSegment(segment) {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Classifies a key without ever returning it. */
export function classifyBrowserKey(key) {
  if (typeof key !== 'string' || key.length === 0) return 'MISSING';
  if (key.length > 2048) return 'REFUSED';
  if (SECRET.test(key)) return 'SECRET_KEY_REFUSED';
  if (PUBLISHABLE.test(key)) return 'PUBLISHABLE';
  const jwt = JWT.exec(key);
  if (jwt) {
    let payload;
    try { payload = decodeSegment(jwt[1]); } catch { return 'REFUSED'; }
    if (payload && payload.role === 'anon') return 'LEGACY_ANON';
    if (payload && payload.role === 'service_role') return 'SECRET_KEY_REFUSED';
    return 'REFUSED';
  }
  return 'REFUSED';
}

export function validateSupabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  return url.origin;
}

function validateTrialUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/**
 * @returns {{configured: true, supabaseUrl: string, publishableKey: string, keyKind: string, trialUrl: string|null}
 *          | {configured: false, reason: string, trialUrl: string|null}}
 */
export function validatePublicConfig(input) {
  const trialUrl = validateTrialUrl(input?.trialUrl);
  const supabaseUrl = validateSupabaseUrl(input?.supabaseUrl);
  const keyKind = classifyBrowserKey(input?.publishableKey);
  if (keyKind === 'SECRET_KEY_REFUSED') return { configured: false, reason: 'SECRET_KEY_REFUSED', trialUrl };
  if (!input?.supabaseUrl && keyKind === 'MISSING') return { configured: false, reason: 'NOT_CONFIGURED', trialUrl };
  if (!supabaseUrl) return { configured: false, reason: 'SUPABASE_URL_INVALID', trialUrl };
  if (keyKind !== 'PUBLISHABLE' && keyKind !== 'LEGACY_ANON') return { configured: false, reason: keyKind === 'MISSING' ? 'NOT_CONFIGURED' : 'KEY_REFUSED', trialUrl };
  return { configured: true, supabaseUrl, publishableKey: input.publishableKey, keyKind, trialUrl };
}
