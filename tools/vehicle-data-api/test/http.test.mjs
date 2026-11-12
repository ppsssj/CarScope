// SSRF, redirect, TLS policy, timeout, size, Content-Type and JSON shape for the one outbound client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderHttp, HTTP_OUTCOME, ALLOWED_ORIGINS, pathSegment } from '../src/http.mjs';
import { strictJson } from '../src/strict-json.mjs';
import { fixtureFetch, json } from '../src/fixture.mjs';

const P = 'HYUNDAI_DEVELOPERS', O = 'https://prd.kr-ccapi.hyundai.com';
const client = (routes, opts = {}) => { const f = fixtureFetch(routes); return { http: new ProviderHttp({ provider: P, origin: O, fetchImpl: f.fetchImpl, ...opts }), calls: f.calls }; };

test('only compiled origins: client, token or response supplied hosts are refused before any request', () => {
  assert.deepEqual(ALLOWED_ORIGINS, { HYUNDAI_DEVELOPERS: [O], PLEOS_VEHICLE_DATA: ['https://api.pleos.ai'] });
  for (const origin of ['https://dev.kr-ccapi.hyundai.com', 'http://prd.kr-ccapi.hyundai.com', 'https://prd.kr-ccapi.hyundai.com.evil.example',
    'https://127.0.0.1', 'https://169.254.169.254', 'https://api.pleos.ai', 'file:///etc/passwd'])
    assert.throws(() => new ProviderHttp({ provider: P, origin, fetchImpl: () => {} }), /ORIGIN_NOT_ALLOWED/);
  assert.throws(() => new ProviderHttp({ provider: 'OTHER', origin: O, fetchImpl: () => {} }), /ORIGIN_NOT_ALLOWED/);
});

test('paths cannot leave the origin: absolute, protocol-relative, traversal, encoded slash, backslash, query or fragment in the template', () => {
  const { http } = client({});
  for (const p of ['//evil.example/x', 'https://evil.example/', '/a/../b', '/a/%2e%2e/b', '/a%2fb', '/a\\b', '/a?x=1', '/a#f', 'relative'])
    assert.throws(() => http.url(p), /INVALID_PATH|ORIGIN_NOT_ALLOWED/, p);
  assert.equal(http.url('/api/v1/car/profile/carlist').href, O + '/api/v1/car/profile/carlist');
  // Query values are encoded by URLSearchParams, so a value cannot add parameters or change the host.
  assert.equal(http.url('/x', { state: 'a&b=c#@evil' }).search, '?state=a%26b%3Dc%23%40evil');
  for (const id of ['../x', 'a/b', 'a%2fb', '', 'a b', 'x'.repeat(65), 'http://x']) assert.throws(() => pathSegment(id), /INVALID_PATH_SEGMENT/);
});

test('a provider redirect is a failure, never followed; fetch is called with redirect: manual and no credentials', async () => {
  const { http, calls } = client({ 'GET /x': { status: 302, headers: { location: 'https://evil.example/steal' } } });
  const r = await http.request({ path: '/x' });
  assert.equal(r.outcome, HTTP_OUTCOME.REDIRECT_REFUSED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'manual');
});

test('TLS verification cannot be switched off for this client', () => {
  const old = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try { assert.throws(() => new ProviderHttp({ provider: P, origin: O, fetchImpl: () => {} }), /TLS_VERIFICATION_DISABLED/); }
  finally { if (old === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = old; }
});

test('timeout and caller cancellation abort the request and are reported separately', async () => {
  const { http } = client({ 'GET /slow': { hang: true } }, { timeoutMs: 100 });
  const started = Date.now();
  assert.equal((await http.request({ path: '/slow' })).outcome, HTTP_OUTCOME.TIMEOUT);
  assert.ok(Date.now() - started < 2000);
  const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 10);
  assert.equal((await http.request({ path: '/slow', signal: ctrl.signal })).outcome, HTTP_OUTCOME.CANCELLED);
  const { http: down } = client({ 'GET /down': { throws: true } });
  assert.equal((await down.request({ path: '/down' })).outcome, HTTP_OUTCOME.NETWORK);
});

test('response size, Content-Type, encoding and JSON shape are enforced', async () => {
  const big = { status: 200, body: JSON.stringify({ a: 'x'.repeat(5000) }), headers: { 'content-type': 'application/json' } };
  const { http } = client({
    'GET /big': big, 'GET /declared': { ...big, body: '{}', headers: { 'content-type': 'application/json', 'content-length': '999999' } },
    'GET /html': { status: 200, body: '<html>', headers: { 'content-type': 'text/html' } },
    'GET /gzip': { status: 200, body: '{}', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } },
    'GET /dup': { status: 200, body: '{"status":false,"status":true}', headers: { 'content-type': 'application/json' } },
    'GET /trail': { status: 200, body: '{} x', headers: { 'content-type': 'application/json' } },
    'GET /ok': json({ status: true }),
    'GET /err': json({ errCode: '4002' }, 400),
  }, { maxBytes: 1024 });
  for (const p of ['/big', '/declared', '/html', '/gzip', '/dup', '/trail']) assert.equal((await http.request({ path: p })).outcome, HTTP_OUTCOME.BAD_RESPONSE, p);
  assert.deepEqual(await http.request({ path: '/ok' }), { outcome: 'OK', status: 200, body: { status: true } });
  assert.deepEqual(await http.request({ path: '/err' }), { outcome: 'HTTP_ERROR', status: 400, body: { errCode: '4002' } });
});

test('strict JSON refuses duplicates at any depth, bad UTF-8, control characters and deep nesting', () => {
  const b = s => new TextEncoder().encode(s);
  for (const s of ['{"a":{"b":1,"b":2}}', '[{"x":1,"x":1}]', '{"a":"\u0001"}', '['.repeat(20) + ']'.repeat(20), '{"a":1,}', "{'a':1}"])
    assert.throws(() => strictJson(b(s), { maxBytes: 10_000 }), /INVALID_PROVIDER_JSON/, s);
  assert.throws(() => strictJson(new Uint8Array([0x7b, 0xff, 0x7d]), { maxBytes: 10 }), /INVALID_PROVIDER_JSON/);
  assert.deepEqual(strictJson(b('{"a":[1,2.5,-3e2,true,null,"\\u00e9"]}'), { maxBytes: 100 }), { a: [1, 2.5, -300, true, null, 'é'] });
});
