// P15 local account server: publishes only public configuration, refuses secret keys, strict headers, no path escape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBrowserKey, validatePublicConfig } from '../web/lib/public-config.mjs';
import { createAccountServer } from '../serve.mjs';

const jwt = (payload) => ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload), 'sig'].map((s, i) => (i < 2 ? Buffer.from(s).toString('base64url') : s)).join('.');
const PUB = 'sb_publishable_TESTONLYpublishable0000';

test('browser key classification: publishable and legacy anon accepted; secret and service_role refused', () => {
  assert.equal(classifyBrowserKey(PUB), 'PUBLISHABLE');
  assert.equal(classifyBrowserKey(jwt({ role: 'anon', iss: 'supabase' })), 'LEGACY_ANON');
  assert.equal(classifyBrowserKey('sb_secret_abcdefabcdefabcdef'), 'SECRET_KEY_REFUSED');
  assert.equal(classifyBrowserKey(jwt({ role: 'service_role', iss: 'supabase' })), 'SECRET_KEY_REFUSED');
  assert.equal(classifyBrowserKey(jwt({ role: 'authenticated' })), 'REFUSED');
  assert.equal(classifyBrowserKey('random'), 'REFUSED');
  assert.equal(classifyBrowserKey(undefined), 'MISSING');
});

test('config validation: missing config is NOT_CONFIGURED, bad URLs refused, trial URL kept either way', () => {
  assert.deepEqual(validatePublicConfig({}), { configured: false, reason: 'NOT_CONFIGURED', trialUrl: null });
  assert.equal(validatePublicConfig({ supabaseUrl: 'http://x.supabase.co', publishableKey: PUB }).reason, 'SUPABASE_URL_INVALID');
  assert.equal(validatePublicConfig({ supabaseUrl: 'https://x.supabase.co/rest/v1', publishableKey: PUB }).reason, 'SUPABASE_URL_INVALID');
  assert.equal(validatePublicConfig({ supabaseUrl: 'https://x.supabase.co', publishableKey: 'sb_secret_xxxxxxxxxxxxxxxxxx', trialUrl: 'http://127.0.0.1:8095/inspect.html' }).trialUrl, 'http://127.0.0.1:8095/inspect.html');
  assert.equal(validatePublicConfig({ trialUrl: 'javascript:alert(1)' }).trialUrl, null);
  const ok = validatePublicConfig({ supabaseUrl: 'https://x.supabase.co/', publishableKey: PUB });
  assert.equal(ok.configured, true);
  assert.equal(ok.supabaseUrl, 'https://x.supabase.co');
});

async function serve(t, env) {
  const { server, config } = createAccountServer({ env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { base: `http://127.0.0.1:${server.address().port}`, config };
}

test('a secret key in SUPABASE_PUBLISHABLE_KEY is never served, and other secret variables are never read', async (t) => {
  const secret = 'sb_secret_THISMUSTNEVERLEAVE0000';
  const { base, config } = await serve(t, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: secret, SUPABASE_SECRET_KEY: 'sb_secret_OTHER000000000000', SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role' }) });
  assert.equal(config.reason, 'SECRET_KEY_REFUSED');
  const body = await (await fetch(`${base}/account/config.json`)).text();
  assert.ok(!body.includes('sb_secret') && !body.includes(secret));
  assert.deepEqual(JSON.parse(body), { trialUrl: null });
});

test('configured server publishes URL + publishable key only, with strict security headers', async (t) => {
  const { base } = await serve(t, { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUB, CARSCOPE_TRIAL_URL: 'http://127.0.0.1:8095/inspect.html' });
  const res = await fetch(`${base}/account/config.json`);
  assert.deepEqual(await res.json(), { supabaseUrl: 'https://abc.supabase.co', publishableKey: PUB, trialUrl: 'http://127.0.0.1:8095/inspect.html' });
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  for (const page of ['/account/', '/account/callback.html', '/account/vehicles.html', '/account/login-page.mjs', '/account/lib/auth-flow.mjs', '/account/account.css']) {
    assert.equal((await fetch(base + page)).status, 200, page);
  }
  const vendor = await fetch(`${base}/account/vendor/supabase.js`);
  assert.equal(vendor.status, 200);
  assert.match(await vendor.text(), /supabase/);
});

test('no path escape, no other files, GET/HEAD only', async (t) => {
  const { base } = await serve(t, {});
  for (const p of ['/account/../package.json', '/account/%2e%2e/serve.mjs', '/account/..%2fpackage-lock.json', '/package.json', '/account/lib/../../serve.mjs', '/account/supabase/config.toml', '/node_modules/pg/package.json']) {
    const r = await fetch(base + p);
    assert.ok(r.status === 404 || r.status === 400, `${p}: ${r.status}`);
  }
  assert.equal((await fetch(`${base}/account/`, { method: 'POST' })).status, 405);
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/account/');
});
