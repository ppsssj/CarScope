// P15: Google sign-in through Supabase Auth, PKCE flow, plus a CarScope one-time flow nonce.
//
// Supabase Auth runs the OAuth exchange with Google (including Google's `state`) on its own server. What comes back to
// CarScope is `?code=` for the PKCE exchange. On top of PKCE (the code is useless without the verifier this browser
// stored), the page adds its own one-time nonce `cs_flow`, kept in sessionStorage of the tab that started the login:
//   * a callback this tab did not start, or one replayed after it was used, is refused before any network call,
//   * the nonce lives 10 minutes and is consumed on the first callback, whatever the outcome.
// Tokens never appear in a URL we produce or accept: an implicit-flow fragment (#access_token=...) is refused.
// This module has no DOM access and does not log; the pages pass in location, storage and the Supabase client.

export const FLOW_STORAGE_KEY = 'carscope.account.oauthFlow.v1';
export const FLOW_TTL_MS = 10 * 60_000;
export const CALLBACK_PATH = '/account/callback.html';
const NONCE = /^[A-Za-z0-9_-]{43}$/;

export const AUTH_REASONS = Object.freeze({
  EMBEDDED_WEBVIEW: 'EMBEDDED_WEBVIEW',
  CANCELLED: 'CANCELLED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  IMPLICIT_FLOW_REFUSED: 'IMPLICIT_FLOW_REFUSED',
  MISSING_CODE: 'MISSING_CODE',
  NO_PENDING_LOGIN: 'NO_PENDING_LOGIN',
  LOGIN_EXPIRED: 'LOGIN_EXPIRED',
  STATE_MISMATCH: 'STATE_MISMATCH',
  CALLBACK_NOT_FOR_THIS_BROWSER: 'CALLBACK_NOT_FOR_THIS_BROWSER',
  CODE_REJECTED: 'CODE_REJECTED',
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  SESSION_INVALID: 'SESSION_INVALID',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  START_FAILED: 'START_FAILED',
  PROVIDER_NOT_ENABLED: 'PROVIDER_NOT_ENABLED',
});

/** Android System WebView marks its user agent with "; wv)". Google refuses sign-in there, and CarScope does too. */
export function isEmbeddedWebView(userAgent) {
  return typeof userAgent === 'string' && /;\s*wv\)/.test(userAgent);
}

function randomNonce(getRandomValues) {
  const bytes = new Uint8Array(32);
  getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Network failures and 5xx from the Auth server: the session may be fine, the server is not reachable. */
export function isAuthUnavailable(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = Number(error.status);
  return status === 0 || status >= 500 || (error instanceof TypeError && /fetch|network/i.test(String(error.message)));
}

function classifyExchangeError(error) {
  if (error?.name === 'AuthPKCECodeVerifierMissingError') return AUTH_REASONS.CALLBACK_NOT_FOR_THIS_BROWSER;
  if (isAuthUnavailable(error)) return AUTH_REASONS.AUTH_UNAVAILABLE;
  return AUTH_REASONS.CODE_REJECTED;
}

const safeCode = (value) => (typeof value === 'string' && /^[a-z0-9_]{1,64}$/i.test(value) ? value : null);

/**
 * @param {object} deps
 * @param {object} deps.client           supabase-js client created with flowType 'pkce', detectSessionInUrl false
 * @param {Storage} deps.flowStorage     sessionStorage of this tab
 * @param {string} deps.origin           this page's origin
 * @param {string} [deps.userAgent]
 * @param {() => number} [deps.now]
 * @param {(a: Uint8Array) => void} [deps.getRandomValues]
 */
export function createAuthFlow({ client, flowStorage, origin, userAgent = '', providerStatus = null, now = Date.now, getRandomValues = (a) => crypto.getRandomValues(a) }) {
  function takePendingFlow() {
    let raw = null;
    try { raw = flowStorage.getItem(FLOW_STORAGE_KEY); } finally { flowStorage.removeItem(FLOW_STORAGE_KEY); }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value && NONCE.test(value.nonce) && Number.isFinite(value.at) ? value : null;
    } catch { return null; }
  }

  /** Starts Google sign-in. On success supabase-js navigates the browser to the Supabase /authorize URL. */
  async function beginGoogleLogin({ selectAccount = false } = {}) {
    if (isEmbeddedWebView(userAgent)) return { ok: false, reason: AUTH_REASONS.EMBEDDED_WEBVIEW };
    if (providerStatus) {
      const provider = await providerStatus();
      if (provider === 'DISABLED') return { ok: false, reason: AUTH_REASONS.PROVIDER_NOT_ENABLED };
      if (provider !== 'ENABLED') return { ok: false, reason: AUTH_REASONS.AUTH_UNAVAILABLE };
    }
    const nonce = randomNonce(getRandomValues);
    flowStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify({ nonce, at: now() }));
    const redirectTo = `${origin}${CALLBACK_PATH}?cs_flow=${nonce}`;
    let result;
    try {
      result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: selectAccount ? { prompt: 'select_account' } : undefined },
      });
    } catch (error) {
      flowStorage.removeItem(FLOW_STORAGE_KEY);
      return { ok: false, reason: isAuthUnavailable(error) ? AUTH_REASONS.AUTH_UNAVAILABLE : AUTH_REASONS.START_FAILED };
    }
    if (result?.error || !result?.data?.url) {
      flowStorage.removeItem(FLOW_STORAGE_KEY);
      return { ok: false, reason: isAuthUnavailable(result?.error) ? AUTH_REASONS.AUTH_UNAVAILABLE : AUTH_REASONS.START_FAILED };
    }
    return { ok: true, url: result.data.url };
  }

  /**
   * Handles the callback URL once. The page must remove the query and fragment from the address bar right after
   * reading `href` (history.replaceState), so a reload cannot replay it.
   */
  async function completeCallback(href) {
    const url = new URL(href);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
    const pending = takePendingFlow();

    if (query.has('access_token') || fragment.has('access_token') || fragment.has('refresh_token')) {
      return { ok: false, reason: AUTH_REASONS.IMPLICIT_FLOW_REFUSED };
    }
    const error = query.get('error') ?? fragment.get('error');
    const errorCode = query.get('error_code') ?? fragment.get('error_code');
    if (error || errorCode) {
      return { ok: false, reason: error === 'access_denied' ? AUTH_REASONS.CANCELLED : AUTH_REASONS.PROVIDER_ERROR, code: safeCode(errorCode ?? error) };
    }
    const code = query.get('code');
    if (!code || code.length > 512) return { ok: false, reason: AUTH_REASONS.MISSING_CODE };
    if (!pending) return { ok: false, reason: AUTH_REASONS.NO_PENDING_LOGIN };
    if (now() - pending.at > FLOW_TTL_MS || now() < pending.at) return { ok: false, reason: AUTH_REASONS.LOGIN_EXPIRED };
    if (!constantTimeEqual(pending.nonce, query.get('cs_flow') ?? '')) return { ok: false, reason: AUTH_REASONS.STATE_MISMATCH };

    let exchanged;
    try { exchanged = await client.auth.exchangeCodeForSession(code); } catch (e) { return { ok: false, reason: classifyExchangeError(e) }; }
    if (exchanged.error || !exchanged.data?.session || !exchanged.data?.user) {
      return { ok: false, reason: classifyExchangeError(exchanged.error) };
    }

    // Confirm the new session with the Auth server before treating anyone as signed in.
    const confirmed = await confirmUser(client);
    if (!confirmed.ok) return confirmed;
    if (confirmed.user.id !== exchanged.data.user.id) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      return { ok: false, reason: AUTH_REASONS.IDENTITY_MISMATCH };
    }
    return { ok: true, userId: confirmed.user.id };
  }

  return Object.freeze({ beginGoogleLogin, completeCallback });
}

/**
 * Asks the Auth server who the current access token belongs to (getUser is a network call, unlike getSession).
 * A rejected token signs this browser out locally; an unreachable server keeps the session but reports it.
 */
export async function confirmUser(client) {
  let result;
  try { result = await client.auth.getUser(); } catch (e) { return { ok: false, reason: isAuthUnavailable(e) ? AUTH_REASONS.AUTH_UNAVAILABLE : AUTH_REASONS.SESSION_INVALID }; }
  if (result?.error) {
    if (isAuthUnavailable(result.error)) return { ok: false, reason: AUTH_REASONS.AUTH_UNAVAILABLE };
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    return { ok: false, reason: AUTH_REASONS.SESSION_INVALID };
  }
  if (!result?.data?.user?.id) return { ok: false, reason: AUTH_REASONS.SESSION_INVALID };
  return { ok: true, user: result.data.user };
}
