// Outbound HTTPS to one fixed provider origin. The origin comes from a compiled allowlist, never from a client, a token or a
// response; paths are built from fixed templates with validated, encoded identifiers. Redirects are refused (a provider 3xx is a
// failure, not something to follow), certificates and host names are verified by the platform (and a process that disabled that
// is refused), and responses are bounded in time, size, Content-Type and JSON shape. Nothing here logs.
import { strictJson } from './strict-json.mjs';

/** Every origin any adapter may contact. Documented in docs/p14-external-vehicle-data.md with its source page. */
export const ALLOWED_ORIGINS = Object.freeze({
  HYUNDAI_DEVELOPERS: Object.freeze(['https://prd.kr-ccapi.hyundai.com']),
  PLEOS_VEHICLE_DATA: Object.freeze(['https://api.pleos.ai']),
});

export const HTTP_OUTCOME = Object.freeze({ OK: 'OK', HTTP_ERROR: 'HTTP_ERROR', REDIRECT_REFUSED: 'REDIRECT_REFUSED', TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK', BAD_RESPONSE: 'BAD_RESPONSE', CANCELLED: 'CANCELLED' });

/** An identifier that goes into a path: provider-issued ids are opaque, so only a conservative alphabet passes. */
export function pathSegment(value, pattern = /^[A-Za-z0-9-]{1,64}$/) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('INVALID_PATH_SEGMENT');
  return encodeURIComponent(value);
}

export class ProviderHttp {
  #origin; #fetch; #timeout; #maxBytes;
  constructor({ provider, origin, fetchImpl = globalThis.fetch, timeoutMs = 5000, maxBytes = 64 * 1024 } = {}) {
    if (globalThis.process?.env?.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS_VERIFICATION_DISABLED');
    const allowed = ALLOWED_ORIGINS[provider];
    if (!allowed || !allowed.includes(origin)) throw new Error('ORIGIN_NOT_ALLOWED');
    if (typeof fetchImpl !== 'function') throw new Error('INVALID_HTTP_CONFIG');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new Error('INVALID_HTTP_CONFIG');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 * 1024) throw new Error('INVALID_HTTP_CONFIG');
    this.#origin = origin; this.#fetch = fetchImpl; this.#timeout = timeoutMs; this.#maxBytes = maxBytes;
  }
  get origin() { return this.#origin; }

  /** The absolute URL for a fixed path template. Used for the browser login link too, so it obeys the same allowlist. */
  url(path, query = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#?]|\.\.|%2e|%2f/i.test(path)) throw new Error('INVALID_PATH');
    const url = new URL(path, this.#origin);
    if (url.origin !== this.#origin) throw new Error('ORIGIN_NOT_ALLOWED');
    for (const [k, v] of Object.entries(query)) {
      if (typeof v !== 'string') throw new Error('INVALID_QUERY');
      url.searchParams.set(k, v);
    }
    return url;
  }

  /**
   * @returns {Promise<{outcome, status?, body?}>} body is parsed JSON (strict) or null. Never throws for remote behaviour.
   */
  async request({ method = 'GET', path, query, headers = {}, body = null, signal } = {}) {
    const url = this.url(path, query);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) ctrl.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, this.#timeout);
    try {
      const res = await this.#fetch(url.href, { method, headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...headers }, body,
        redirect: 'manual', signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (res.status >= 300 && res.status < 400 || res.type === 'opaqueredirect') { await res.body?.cancel?.().catch(() => {}); return { outcome: HTTP_OUTCOME.REDIRECT_REFUSED, status: res.status }; }
      const type = res.headers.get('content-type') ?? '';
      const declared = Number(res.headers.get('content-length') ?? 0);
      const encoding = res.headers.get('content-encoding');
      const json = /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type);
      if (!json || declared > this.#maxBytes || (encoding && encoding !== 'identity')) {
        await res.body?.cancel?.().catch(() => {});
        return res.ok ? { outcome: HTTP_OUTCOME.BAD_RESPONSE, status: res.status } : { outcome: HTTP_OUTCOME.HTTP_ERROR, status: res.status, body: null };
      }
      const bytes = await this.#read(res);
      if (bytes === null) return { outcome: HTTP_OUTCOME.BAD_RESPONSE, status: res.status };
      let parsed;
      try { parsed = strictJson(bytes, { maxBytes: this.#maxBytes }); } catch { return { outcome: HTTP_OUTCOME.BAD_RESPONSE, status: res.status }; }
      return { outcome: res.ok ? HTTP_OUTCOME.OK : HTTP_OUTCOME.HTTP_ERROR, status: res.status, body: parsed };
    } catch {
      return { outcome: timedOut ? HTTP_OUTCOME.TIMEOUT : signal?.aborted ? HTTP_OUTCOME.CANCELLED : HTTP_OUTCOME.NETWORK };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    }
  }

  async #read(res) {
    if (!res.body?.getReader) return null;
    const reader = res.body.getReader(), chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > this.#maxBytes) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const out = new Uint8Array(size); let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
