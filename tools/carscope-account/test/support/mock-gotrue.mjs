// Test-only stand-in for the Supabase Auth (GoTrue) endpoints the account pages use, so the real supabase-js client
// can run the PKCE, refresh, user and logout paths with controllable failures. Loopback only, ES256 tokens from a key
// generated per run. It models the documented behaviour (one-time code, 5-minute code life, verifier check, rotating
// refresh tokens); it is not GoTrue, and results against it are MOCK_PASS.
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export async function startMockGoTrue({ googleEnabled = true, accessTtlS = 3600 } = {}) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const kid = randomUUID();
  const publicJwk = { ...(await subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'ES256', use: 'sig', key_ops: ['verify'] };
  const state = {
    googleEnabled, accessTtlS, outage: false, flows: new Map(), codes: new Map(), refresh: new Map(), sessions: new Map(),
    users: new Map(), calls: [], jwksRequests: 0,
  };
  let origin = '';

  async function sign(claims, { key = pair.privateKey, header = { alg: 'ES256', typ: 'JWT', kid } } = {}) {
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
    return `${input}.${b64u(sig)}`;
  }

  async function issue(user, sessionId = randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + state.accessTtlS;
    const access = await sign({
      iss: `${origin}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, exp, iat: now,
      session_id: sessionId, aal: 'aal1', is_anonymous: false, user_metadata: user.user_metadata, app_metadata: { provider: 'google' },
    });
    const refresh = b64u(randomBytes(24));
    state.refresh.set(refresh, { userId: user.id, sessionId, used: false });
    state.sessions.set(sessionId, { userId: user.id, revoked: false });
    return { access_token: access, token_type: 'bearer', expires_in: state.accessTtlS, expires_at: exp, refresh_token: refresh, user };
  }

  async function verify(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)).catch(() => false);
    if (!ok) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const s = state.sessions.get(claims.session_id);
    return s && !s.revoked ? claims : null;
  }

  const err = (res, status, code, msg) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: status, error_code: code, msg })); };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    state.calls.push(`${req.method} ${url.pathname}${url.searchParams.get('grant_type') ? '?grant_type=' + url.searchParams.get('grant_type') : ''}`);
    if (state.outage) return err(res, 503, 'unexpected_failure', 'Service unavailable');
    if (url.pathname === '/auth/v1/.well-known/jwks.json') { state.jwksRequests += 1; return json(res, 200, { keys: [publicJwk] }); }
    if (url.pathname === '/auth/v1/settings') return json(res, 200, { external: { google: state.googleEnabled, email: false } });
    if (url.pathname === '/auth/v1/authorize') {
      if (!state.googleEnabled) return err(res, 400, 'validation_failed', 'Unsupported provider: provider is not enabled');
      const flowId = randomUUID();
      state.flows.set(flowId, { challenge: url.searchParams.get('code_challenge'), method: url.searchParams.get('code_challenge_method'), redirectTo: url.searchParams.get('redirect_to'), prompt: url.searchParams.get('prompt') });
      res.writeHead(302, { location: `https://accounts.google.invalid/o/oauth2/auth?flow=${flowId}` }); return res.end();
    }
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type'); const b = await body(req);
      if (grant === 'pkce') {
        const entry = state.codes.get(b.auth_code);
        if (!entry || entry.used) return err(res, 404, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        entry.used = true;
        if (Date.now() - entry.at > 5 * 60_000) return err(res, 400, 'flow_state_expired', 'flow state has expired');
        const hashed = createHash('sha256').update(String(b.code_verifier ?? '')).digest('base64url');
        if (entry.method !== 's256' || hashed !== entry.challenge) return err(res, 400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier');
        return json(res, 200, await issue(entry.user));
      }
      if (grant === 'refresh_token') {
        const r = state.refresh.get(b.refresh_token);
        if (!r || r.used || state.sessions.get(r.sessionId)?.revoked) return err(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        r.used = true;
        return json(res, 200, await issue(state.users.get(r.userId), r.sessionId));
      }
      return err(res, 400, 'unsupported_grant_type', 'unsupported grant');
    }
    if (url.pathname === '/auth/v1/user') {
      const claims = await verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!claims) return err(res, 403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature');
      return json(res, 200, state.users.get(claims.sub));
    }
    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
      const claims = await verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (claims) state.sessions.get(claims.session_id).revoked = true;
      res.writeHead(204); return res.end();
    }
    return err(res, 404, 'not_found', 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  function addUser({ email, name }) {
    const user = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: name, avatar_url: 'https://lh3.googleusercontent.com/a/test' }, identities: [], created_at: new Date().toISOString() };
    state.users.set(user.id, user);
    return user;
  }
  /** The user approves at "Google": returns the URL Supabase Auth would redirect the browser to. */
  function approve(authorizeUrl, user) {
    const flowId = new URL(authorizeUrl).searchParams.get('flow');
    const flow = state.flows.get(flowId);
    const code = randomUUID();
    state.codes.set(code, { ...flow, user, at: Date.now(), used: false });
    const target = new URL(flow.redirectTo);
    target.searchParams.set('code', code);
    return target.href;
  }
  /** The user cancels at "Google". */
  function cancel(authorizeUrl) {
    const flow = state.flows.get(new URL(authorizeUrl).searchParams.get('flow'));
    const target = new URL(flow.redirectTo);
    target.searchParams.set('error', 'access_denied'); target.searchParams.set('error_code', 'access_denied'); target.searchParams.set('error_description', 'The user denied the request');
    return target.href;
  }
  /** Follows /authorize like a browser would, up to the Google page. */
  async function authorize(url) {
    const r = await fetch(url, { redirect: 'manual' });
    return r.status === 302 ? r.headers.get('location') : null;
  }
  function expireCode(code) { const e = state.codes.get(code); if (e) e.at -= 6 * 60_000; }

  return {
    get origin() { return origin; }, state, sign, issue, addUser, approve, cancel, authorize, expireCode, publicJwk, privateKey: pair.privateKey,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}
