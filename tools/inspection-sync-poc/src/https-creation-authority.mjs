// Operator-selected, authenticated HTTPS bridge to the normalized authority contract.
// Not an issuer or registry. No token-supplied URL, environment loader, positive cache or trust override.
import https from 'node:https';
import { VerifiedSessionCreationAuthorizer } from './verified-creation-authorizer.mjs';
import { startHttpsMobileService } from './https-mobile-service.mjs';
import { httpsOrigin } from '../bin/host-readiness.mjs';

const MAX = 16 * 1024;
// JSON.parse alone silently accepts duplicate names. Validate structure/duplicates before materializing assertions.
export function authorityJson(bytes) {
  if (bytes.length > MAX) throw new Error('INVALID_AUTHORITY_RESPONSE');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); let i = 0;
  const space = () => { while (/[ \t\r\n]/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('INVALID_AUTHORITY_RESPONSE');
  }
  function value(depth = 0) {
    if (depth > 8) throw new Error('INVALID_AUTHORITY_RESPONSE'); space();
    const c = text[i];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      i++; space(); const end = c === '{' ? '}' : ']', keys = new Set();
      if (text[i] === end) { i++; return; }
      for (;;) {
        if (c === '{') {
          if (text[i] !== '"') throw new Error('INVALID_AUTHORITY_RESPONSE');
          const key = string(); if (keys.has(key)) throw new Error('INVALID_AUTHORITY_RESPONSE'); keys.add(key);
          space(); if (text[i++] !== ':') throw new Error('INVALID_AUTHORITY_RESPONSE');
        }
        value(depth + 1); space(); if (text[i] === end) { i++; return; }
        if (text[i++] !== ',') throw new Error('INVALID_AUTHORITY_RESPONSE'); space();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) throw new Error('INVALID_AUTHORITY_RESPONSE'); i += token[0].length;
  }
  value(); space(); if (i !== text.length) throw new Error('INVALID_AUTHORITY_RESPONSE');
  return JSON.parse(text);
}

export class HttpsCreationAuthority {
  #origin; #credentials; #ca; #timeout;
  constructor({ origin, credentials, ca, timeoutMs = 1200 } = {}) {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('INVALID_AUTHORITY_POLICY');
    this.#origin = httpsOrigin(origin); this.#credentials = credentials; this.#ca = ca;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('INVALID_AUTHORITY_POLICY');
    this.#timeout = timeoutMs;
    this.testOnly = credentials?.testOnly === true;
  }
  async #post(route, body, signal) {
    const ctrl = new AbortController(); const abort = () => ctrl.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) ctrl.abort();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          // Separately provisioned service credential, never the caller's session-creation token.
          const credential = await this.#credentials?.credential({ signal: ctrl.signal });
          if (ctrl.signal.aborted || typeof credential !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(credential)) return null;
          const bytes = Buffer.from(JSON.stringify(body)); if (bytes.length > MAX) return null;
          return await new Promise((resolve, reject) => {
            const req = https.request(this.#origin + route, { method: 'POST', agent: false, ca: this.#ca, signal: ctrl.signal, rejectUnauthorized: true, minVersion: 'TLSv1.2',
              headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'application/json',
                'Cache-Control': 'no-store', 'Content-Length': bytes.length } }, res => {
              if (res.statusCode !== 200 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers['content-type'] ?? '') ||
                (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length']) > MAX) {
                res.destroy(); resolve(null); return;
              }
              const chunks = []; let size = 0;
              res.on('data', chunk => { size += chunk.length; if (size > MAX) res.destroy(new Error('INVALID_AUTHORITY_RESPONSE')); else chunks.push(chunk); });
              res.on('error', reject); res.on('end', () => { try { resolve(authorityJson(Buffer.concat(chunks))); } catch { resolve(null); } });
            });
            req.on('error', reject); req.end(bytes);
          });
        })(),
        new Promise(resolve => { timer = setTimeout(() => { ctrl.abort(); resolve(null); }, this.#timeout); }),
      ]);
    } catch { return null; }
    finally { clearTimeout(timer); ctrl.abort(); signal?.removeEventListener('abort', abort); }
  }
  verify({ token, signal }) { return this.#post('/creation/verify', { token }, signal); }
  resolve({ issuer, subject, registrationId, signal }) { return this.#post('/creation/registration', { issuer, subject, registrationId }, signal); }
  async isActive({ issuer, credentialId, registrationId, signal }) {
    const x = await this.#post('/creation/active', { issuer, credentialId, registrationId }, signal);
    return x !== null && typeof x === 'object' && Object.keys(x).length === 1 && x.active === true;
  }
  toString() { return 'HttpsCreationAuthority(REDACTED)'; }
}

/** Explicit reviewed bootstrap seam. CLI still denies; missing runtime service credentials deny each create. */
export function httpsCreationAuthorizer({ issuer, audience, ...authorityOptions } = {}) {
  const authority = new HttpsCreationAuthority(authorityOptions);
  return new VerifiedSessionCreationAuthorizer({ issuer, audience, credentialVerifier: authority, registrationProvider: authority, revocations: authority });
}
export function startAuthorizedHttpsMobileService({ authority, ...serviceOptions } = {}) {
  if (Object.hasOwn(serviceOptions, 'authorizer')) throw new Error('AUTHORIZER_OVERRIDE_FORBIDDEN');
  return startHttpsMobileService({ ...serviceOptions, authorizer: httpsCreationAuthorizer(authority) });
}
