// P15 sign-in, session and sign-out behaviour, using the real @supabase/supabase-js 2.119.0 client against the mock
// Auth server in support/mock-gotrue.mjs. MOCK_PASS: no Google, no Supabase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { startMockGoTrue, memoryStorage } from './support/mock-gotrue.mjs';
import { AUTH_REASONS, CALLBACK_PATH, FLOW_STORAGE_KEY, createAuthFlow, isEmbeddedWebView } from '../web/lib/auth-flow.mjs';
import { createAccountSession, STATUS } from '../web/lib/account-session.mjs';
import { AUTH_STORAGE_KEY, clientOptions, googleProviderStatus } from '../web/lib/account-runtime.mjs';

const PAGE = 'http://127.0.0.1:8097';
const KEY = 'sb_publishable_TESTONLYpublishable0000';
const WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

async function harness(t, options) {
  const gotrue = await startMockGoTrue(options);
  const clients = [];
  const browser = { local: memoryStorage(), session: memoryStorage() }; // localStorage and this tab's sessionStorage
  const newClient = () => { const c = createClient(gotrue.origin, KEY, clientOptions(browser.local)); clients.push(c); return c; };
  const flowFor = (client, extra = {}) => createAuthFlow({ client, flowStorage: browser.session, origin: PAGE, ...extra });
  t.after(async () => { for (const c of clients) { await c.auth.stopAutoRefresh(); } await gotrue.close(); });
  /** Runs begin -> Google approve and returns the callback URL plus the flow. */
  async function signIn(client, user, extra) {
    const flow = flowFor(client, extra);
    const begun = await flow.beginGoogleLogin(extra?.begin);
    assert.equal(begun.ok, true, JSON.stringify(begun));
    const google = await gotrue.authorize(begun.url);
    return { flow, callback: gotrue.approve(google, user), begun, google };
  }
  return { gotrue, browser, newClient, flowFor, signIn };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const tokensIn = (text, storage) => [...storage.map.values()].some((v) => { try { const s = JSON.parse(v); return s.access_token && text.includes(s.access_token); } catch { return false; } });

test('Google sign-in succeeds through PKCE and the user is confirmed with the Auth server', async (t) => {
  const h = await harness(t);
  const alice = h.gotrue.addUser({ email: 'alice@example.com', name: 'Alice' });
  const client = h.newClient();
  const { flow, callback, begun } = await h.signIn(client, alice);
  const authorize = new URL(begun.url);
  assert.equal(authorize.origin + authorize.pathname, `${h.gotrue.origin}/auth/v1/authorize`);
  assert.equal(authorize.searchParams.get('provider'), 'google');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const redirect = new URL(authorize.searchParams.get('redirect_to'));
  assert.equal(redirect.origin + redirect.pathname, PAGE + CALLBACK_PATH);
  assert.match(redirect.searchParams.get('cs_flow'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(h.browser.local.map.has(`${AUTH_STORAGE_KEY}-code-verifier`), 'verifier kept by supabase-js in this browser');
  assert.ok(!new URL(callback).hash && !new URL(callback).searchParams.has('access_token'), 'no token in the callback URL');

  const result = await flow.completeCallback(callback);
  assert.deepEqual(result, { ok: true, userId: alice.id });
  assert.equal(h.browser.session.getItem(FLOW_STORAGE_KEY), null, 'flow nonce consumed');
  assert.ok(!h.browser.local.map.has(`${AUTH_STORAGE_KEY}-code-verifier`), 'verifier removed after exchange');
  assert.ok(h.gotrue.state.calls.includes('GET /auth/v1/user'), 'getUser confirmed the identity with the server');
});

test('account switch asks Google for the account chooser', async (t) => {
  const h = await harness(t);
  const { begun } = await h.signIn(h.newClient(), h.gotrue.addUser({ email: 'a@example.com', name: 'A' }), { begin: { selectAccount: true } });
  assert.equal(new URL(begun.url).searchParams.get('prompt'), 'select_account');
});

test('login cancelled at Google: CANCELLED, no exchange, nobody signed in', async (t) => {
  const h = await harness(t);
  const client = h.newClient();
  const flow = h.flowFor(client);
  const begun = await flow.beginGoogleLogin();
  const back = h.gotrue.cancel(await h.gotrue.authorize(begun.url));
  const result = await flow.completeCallback(back);
  assert.equal(result.reason, AUTH_REASONS.CANCELLED);
  assert.ok(!h.gotrue.state.calls.some((c) => c.includes('grant_type=pkce')));
  assert.equal((await client.auth.getSession()).data.session, null);
});

test('state mismatch: a different cs_flow is refused before any token request', async (t) => {
  const h = await harness(t);
  const client = h.newClient();
  const { flow, callback } = await h.signIn(client, h.gotrue.addUser({ email: 'a@example.com', name: 'A' }));
  const tampered = new URL(callback); tampered.searchParams.set('cs_flow', 'A'.repeat(43));
  assert.equal((await flow.completeCallback(tampered.href)).reason, AUTH_REASONS.STATE_MISMATCH);
  assert.ok(!h.gotrue.state.calls.some((c) => c.includes('grant_type=pkce')));
  assert.equal((await client.auth.getSession()).data.session, null);
});

test('a callback this tab did not start (login CSRF / injected code) is refused', async (t) => {
  const h = await harness(t);
  const attacker = h.gotrue.addUser({ email: 'mallory@example.com', name: 'M' });
  // The attacker completes their own login elsewhere and sends the victim the callback URL.
  const elsewhere = await harness(t);
  const { callback } = await elsewhere.signIn(elsewhere.newClient(), attacker);
  const victimFlow = h.flowFor(h.newClient());
  assert.equal((await victimFlow.completeCallback(callback.replace(elsewhere.gotrue.origin, h.gotrue.origin))).reason, AUTH_REASONS.NO_PENDING_LOGIN);
});

test('callback reuse: the second visit is refused locally, and the Auth server refuses a reused code', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const client = h.newClient();
  const { flow, callback } = await h.signIn(client, user);
  assert.equal((await flow.completeCallback(callback)).ok, true);
  assert.equal((await flow.completeCallback(callback)).reason, AUTH_REASONS.NO_PENDING_LOGIN, 'nonce already consumed');
  // Even with a fresh nonce (new attempt in the same tab), the old code is useless: no verifier, and the server
  // marks the code used.
  const again = await h.flowFor(client).beginGoogleLogin();
  const nonce = new URL(new URL(again.url).searchParams.get('redirect_to')).searchParams.get('cs_flow');
  const replay = new URL(callback); replay.searchParams.set('cs_flow', nonce);
  assert.equal((await flow.completeCallback(replay.href)).reason, AUTH_REASONS.CODE_REJECTED);
  const direct = await fetch(`${h.gotrue.origin}/auth/v1/token?grant_type=pkce`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: new URL(callback).searchParams.get('code'), code_verifier: 'x'.repeat(43) }) });
  assert.equal(direct.status, 404);
});

test('callback opened in another browser (no verifier) is refused without a session', async (t) => {
  const h = await harness(t);
  const { callback } = await h.signIn(h.newClient(), h.gotrue.addUser({ email: 'a@example.com', name: 'A' }));
  h.browser.local.map.delete(`${AUTH_STORAGE_KEY}-code-verifier`);
  const client = h.newClient();
  // Same tab nonce, but this browser no longer has the PKCE verifier.
  const result = await createAuthFlow({ client, flowStorage: h.browser.session, origin: PAGE }).completeCallback(callback);
  assert.equal(result.reason, AUTH_REASONS.CALLBACK_NOT_FOR_THIS_BROWSER);
  assert.ok(!h.gotrue.state.calls.some((c) => c.includes('grant_type=pkce')));
});

test('expired login: nonce older than 10 minutes, and a code older than 5 minutes at the server', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  let clock = Date.now();
  const client = h.newClient();
  const { flow, callback } = await h.signIn(client, user, { now: () => clock });
  clock += 11 * 60_000;
  assert.equal((await flow.completeCallback(callback)).reason, AUTH_REASONS.LOGIN_EXPIRED);
  const second = await h.signIn(client, user);
  h.gotrue.expireCode(new URL(second.callback).searchParams.get('code'));
  assert.equal((await second.flow.completeCallback(second.callback)).reason, AUTH_REASONS.CODE_REJECTED);
});

test('implicit-flow tokens in the callback fragment are refused', async (t) => {
  const h = await harness(t);
  const flow = h.flowFor(h.newClient());
  await flow.beginGoogleLogin();
  const result = await flow.completeCallback(`${PAGE}${CALLBACK_PATH}#access_token=x.y.z&refresh_token=r&token_type=bearer`);
  assert.equal(result.reason, AUTH_REASONS.IMPLICIT_FLOW_REFUSED);
});

test('Google provider switched off: login is not started and trial mode is untouched', async (t) => {
  const h = await harness(t, { googleEnabled: false });
  const config = { configured: true, supabaseUrl: h.gotrue.origin, publishableKey: KEY };
  assert.equal(await googleProviderStatus(config), 'DISABLED');
  const flow = h.flowFor(h.newClient(), { providerStatus: () => googleProviderStatus(config) });
  assert.equal((await flow.beginGoogleLogin()).reason, AUTH_REASONS.PROVIDER_NOT_ENABLED);
  assert.equal(h.browser.session.getItem(FLOW_STORAGE_KEY), null);
});

test('embedded Android WebView: Google login is never started', async (t) => {
  const h = await harness(t);
  assert.equal(isEmbeddedWebView(WEBVIEW_UA), true);
  assert.equal(isEmbeddedWebView('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'), false);
  const flow = h.flowFor(h.newClient(), { userAgent: WEBVIEW_UA });
  assert.equal((await flow.beginGoogleLogin()).reason, AUTH_REASONS.EMBEDDED_WEBVIEW);
  assert.ok(!h.gotrue.state.calls.length);
});

test('session survives a reload: a new client on the same storage restores and confirms the user', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'Alice' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  const reloaded = createAccountSession({ client: h.newClient() });
  await reloaded.start();
  assert.equal(reloaded.snapshot().status, STATUS.SIGNED_IN);
  assert.equal(reloaded.snapshot().user.id, user.id);
  assert.equal(reloaded.snapshot().user.displayName, 'Alice');
  assert.ok(!('access_token' in reloaded.snapshot()) && !JSON.stringify(reloaded.snapshot()).includes('eyJ'), 'no token in page state');
  reloaded.stop();
});

test('token refresh: an access token near expiry is refreshed with a rotated refresh token', async (t) => {
  const h = await harness(t, { accessTtlS: 20 }); // inside supabase-js's expiry margin, so the next read refreshes
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  const before = JSON.parse(h.browser.local.getItem(AUTH_STORAGE_KEY));
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  const after = JSON.parse(h.browser.local.getItem(AUTH_STORAGE_KEY));
  assert.equal(session.snapshot().status, STATUS.SIGNED_IN);
  assert.ok(h.gotrue.state.calls.includes('POST /auth/v1/token?grant_type=refresh_token'));
  assert.notEqual(after.refresh_token, before.refresh_token);
  session.stop();
});

test('refresh failure (revoked refresh token, expired access token): signed out, nothing shown', async (t) => {
  const h = await harness(t, { accessTtlS: 20 });
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  const stored = JSON.parse(h.browser.local.getItem(AUTH_STORAGE_KEY));
  for (const s of h.gotrue.state.sessions.values()) s.revoked = true;
  stored.expires_at = Math.floor(Date.now() / 1000) - 5; // access token already expired
  h.browser.local.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  assert.equal(session.snapshot().status, STATUS.SIGNED_OUT);
  assert.equal(session.snapshot().user, null);
  session.stop();
});

test('session expired / revoked on the server while the stored access token still looks valid: SESSION_INVALID', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  for (const s of h.gotrue.state.sessions.values()) s.revoked = true;
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  assert.equal(session.snapshot().status, STATUS.SIGNED_OUT);
  assert.equal(session.snapshot().reason, AUTH_REASONS.SESSION_INVALID);
  assert.equal(h.browser.local.getItem(AUTH_STORAGE_KEY), null, 'local session removed');
  session.stop();
});

test('invalid JWT in storage (forged signature): not trusted, signed out', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const forged = await h.gotrue.sign({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }, {
    key: (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).privateKey,
  });
  h.browser.local.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: forged, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  assert.equal(session.snapshot().status, STATUS.SIGNED_OUT, 'getSession alone would have shown this user');
  session.stop();
});

test('Auth server outage: AUTH_UNAVAILABLE, no user and no data shown, retry recovers', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  h.gotrue.state.outage = true;
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  assert.equal(session.snapshot().status, STATUS.AUTH_UNAVAILABLE);
  assert.equal(session.snapshot().user, null);
  assert.ok(h.browser.local.getItem(AUTH_STORAGE_KEY), 'an outage does not destroy the session');
  h.gotrue.state.outage = false;
  await session.retry();
  assert.equal(session.snapshot().status, STATUS.SIGNED_IN);
  session.stop();
});

test('Auth server outage during login: AUTH_UNAVAILABLE, not signed in', async (t) => {
  const h = await harness(t);
  const { flow, callback } = await h.signIn(h.newClient(), h.gotrue.addUser({ email: 'a@example.com', name: 'A' }));
  h.gotrue.state.outage = true;
  assert.equal((await flow.completeCallback(callback)).reason, AUTH_REASONS.AUTH_UNAVAILABLE);
});

test('logout clears the page synchronously, revokes the session on the server and removes local tokens', async (t) => {
  const h = await harness(t);
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  const events = [];
  session.subscribe((type, s) => events.push([type, s.status, s.user?.id ?? null]));
  const epoch = session.epoch;
  const pending = session.signOut();
  assert.deepEqual(events[0], ['clear', STATUS.SIGNED_OUT, null], 'cleared before the network call returns');
  assert.ok(session.epoch > epoch);
  assert.deepEqual(await pending, { localCleared: true, serverConfirmed: true });
  assert.equal(h.browser.local.getItem(AUTH_STORAGE_KEY), null);
  assert.ok([...h.gotrue.state.sessions.values()].every((s) => s.revoked));
  session.stop();
});

test('logout while the Auth server is down still removes the local session', async (t) => {
  const h = await harness(t);
  const { flow, callback } = await h.signIn(h.newClient(), h.gotrue.addUser({ email: 'a@example.com', name: 'A' }));
  await flow.completeCallback(callback);
  const session = createAccountSession({ client: h.newClient() });
  await session.start();
  h.gotrue.state.outage = true;
  const r = await session.signOut();
  assert.equal(r.localCleared, true);
  assert.equal(h.browser.local.getItem(AUTH_STORAGE_KEY), null);
  session.stop();
});

test('account switch: B signing in where A was clears A synchronously and confirms B', async (t) => {
  const h = await harness(t);
  const a = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const b = h.gotrue.addUser({ email: 'b@example.com', name: 'B' });
  const client = h.newClient();
  const first = await h.signIn(client, a);
  await first.flow.completeCallback(first.callback);
  const session = createAccountSession({ client });
  await session.start();
  assert.equal(session.snapshot().user.id, a.id);
  const events = [];
  session.subscribe((type, s) => events.push([type, s.user?.id ?? null]));
  const epoch = session.epoch;
  const second = await h.signIn(client, b);
  await second.flow.completeCallback(second.callback);
  await settle(); await settle();
  assert.deepEqual(events.find(([type]) => type === 'clear'), ['clear', null], 'A cleared');
  const firstB = events.findIndex(([, id]) => id === b.id);
  assert.ok(events.findIndex(([type]) => type === 'clear') < firstB, 'cleared before B is shown');
  assert.ok(!events.slice(firstB).some(([, id]) => id === a.id), 'A never shown again');
  assert.equal(session.snapshot().user.id, b.id);
  assert.ok(session.epoch > epoch);
  session.stop();
});

test('tokens never reach the page state, the URL we build, or any console output', async (t) => {
  const h = await harness(t);
  const logged = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(original)) console[k] = (...args) => logged.push(args.map(String).join(' '));
  t.after(() => Object.assign(console, original));
  const user = h.gotrue.addUser({ email: 'a@example.com', name: 'A' });
  const { flow, callback, begun } = await h.signIn(h.newClient(), user);
  await flow.completeCallback(callback);
  const session = createAccountSession({ client: h.newClient() });
  const seen = [];
  session.subscribe((type, s) => seen.push(JSON.stringify(s)));
  await session.start();
  await session.signOut();
  session.stop();
  const stored = memoryStorage(); stored.map = h.browser.local.map;
  assert.equal(logged.length, 0, 'nothing logged');
  assert.ok(!seen.some((s) => /eyJ|refresh_token|access_token/.test(s)));
  assert.ok(!/access_token|refresh_token|eyJ/.test(begun.url));
});
