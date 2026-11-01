import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer, createSyncHandler, MAX_BODY_BYTES } from '../src/server.mjs';
import { SessionService } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { DEFAULT_RATES } from '../src/rate-limit.mjs';
import { PROTOCOL, PROTOCOL_VERSION, resultDigest } from '../src/protocol.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const done = (status = 'OK') => completeInspection(startInspection(), status);
const env = (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });

async function withServer(opts, fn) {
  const lines = [];
  const s = await startSyncServer({ port: 0, log: (l) => lines.push(l), ...opts });
  const call = async (method, path, { token, body, raw, headers = {} } = {}) => {
    const res = await fetch(s.url + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  try { return await fn({ s, call, lines }); } finally { await s.stop(); }
}

async function pair(call) {
  const c = await call('POST', '/v1/sessions', { body: { taskId: 'washer-fluid' } });
  const cl = await call('POST', '/v1/claim', { token: c.json.inviteToken });
  return { ...c.json, submitToken: cl.json.submitToken };
}

test('HTTP flow: 201 create, 201 submit, 200 duplicate, 409 conflict, view/accept by receiver only', () => withServer({}, async ({ call, lines }) => {
  const p = await pair(call);
  const r = done('OK');
  const first = await call('POST', '/v1/submissions', { token: p.submitToken, body: env(r) });
  assert.equal(first.status, 201);
  assert.equal(first.json.duplicate, false);
  assert.equal(first.json.receipt.resultDigest, await resultDigest(r));
  const dup = await call('POST', '/v1/submissions', { token: p.submitToken, body: env(r) });
  assert.equal(dup.status, 200);
  assert.deepEqual(dup.json.receipt, first.json.receipt);
  const conflict = await call('POST', '/v1/submissions', { token: p.submitToken, body: env({ ...r, status: 'UNSURE' }) });
  assert.deepEqual([conflict.status, conflict.json.error.code], [409, 'CONFLICT']);
  // [11] read rights are separate from submit rights
  assert.equal((await call('GET', `/v1/sessions/${p.sessionId}`, { token: p.submitToken })).status, 404);
  assert.equal((await call('GET', `/v1/sessions/${p.sessionId}`)).status, 401);
  assert.equal((await call('POST', `/v1/sessions/${p.sessionId}/accept`, { token: p.submitToken, body: { resultDigest: first.json.receipt.resultDigest } })).status, 404);
  const view = await call('GET', `/v1/sessions/${p.sessionId}`, { token: p.receiverToken });
  assert.equal(view.json.result.inspectionId, r.inspectionId);
  const acc = await call('POST', `/v1/sessions/${p.sessionId}/accept`, { token: p.receiverToken, body: { resultDigest: view.json.resultDigest } });
  assert.equal(acc.json.sessionState, 'ACCEPTED');
  assert.equal((await call('POST', '/v1/submissions', { token: p.submitToken, body: env(r) })).status, 409, '[13] closed after accept');
  // logs: route templates and status only, never tokens, ids or bodies
  const log = lines.join('\n');
  for (const secret of [p.receiverToken, p.inviteToken, p.submitToken, p.sessionId, r.inspectionId]) assert.ok(!log.includes(secret));
  assert.ok(lines.some((l) => /^POST \/v1\/submissions 409 \d+ms$/.test(l)), log);
}));

test('responses never echo tokens beyond the one-time issuance, and carry no-store headers', () => withServer({}, async ({ call }) => {
  const c = await call('POST', '/v1/sessions', { body: { taskId: 'washer-fluid' } });
  assert.equal(c.headers.get('cache-control'), 'no-store');
  assert.equal(c.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(c.headers.get('access-control-allow-origin'), null, 'no CORS by default');
  const cl = await call('POST', '/v1/claim', { token: c.json.inviteToken });
  const view = await call('GET', `/v1/sessions/${c.json.sessionId}`, { token: c.json.receiverToken });
  const st = await call('GET', '/v1/submissions/status', { token: cl.json.submitToken });
  for (const r of [view, st]) for (const t of [c.json.receiverToken, c.json.inviteToken, cl.json.submitToken]) assert.ok(!r.text.includes(t));
  assert.ok(!cl.text.includes(c.json.inviteToken) && !cl.text.includes(c.json.receiverToken));
}));

test('tokens are refused in query strings; bad media type, bad JSON and unknown routes are rejected', () => withServer({}, async ({ call }) => {
  const p = await pair(call);
  assert.equal((await call('GET', `/v1/submissions/status?token=${p.submitToken}`)).status, 400);
  assert.equal((await call('POST', '/v1/submissions', { token: p.submitToken, raw: JSON.stringify(env(done())), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('POST', '/v1/submissions', { token: p.submitToken, raw: '{not json' })).status, 400);
  assert.equal((await call('GET', '/v1/nope')).status, 404);
  assert.equal((await call('DELETE', '/v1/claim')).status, 405);
  assert.equal((await call('GET', '/debug')).status, 404, 'debug page off by default');
  const inc = await call('POST', '/v1/submissions', { token: p.submitToken, body: env(startInspection()) });
  assert.deepEqual([inc.status, inc.json.error.code], [422, 'INVALID_RESULT'], '[7] incomplete over HTTP');
  const pii = await call('POST', '/v1/submissions', { token: p.submitToken, body: env({ ...done(), vin: 'KMHxx', gps: [37.5, 127] }) });
  assert.deepEqual([pii.status, pii.json.error.code], [422, 'INVALID_RESULT'], '[16] sensitive fields over HTTP');
  assert.ok(!pii.text.includes('KMHxx'), 'rejection does not echo the payload');
}));

test('[17] oversize payload -> 413, request floods -> 429 with Retry-After', () => withServer({ rates: { ...DEFAULT_RATES, submit: { limit: 3, windowMs: 60_000 }, create: { limit: 2, windowMs: 60_000 } } }, async ({ call }) => {
  const p = await pair(call);
  const big = await call('POST', '/v1/submissions', { token: p.submitToken, raw: JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES + 10) }) });
  assert.deepEqual([big.status, big.json?.error?.code], [413, 'PAYLOAD_TOO_LARGE']);
  await call('POST', '/v1/submissions', { token: p.submitToken, body: env(done()) });
  await call('POST', '/v1/submissions', { token: p.submitToken, body: env(done()) });
  const flood = await call('POST', '/v1/submissions', { token: p.submitToken, body: env(done()) });
  assert.equal(flood.status, 429);
  assert.ok(Number(flood.headers.get('retry-after')) > 0);
  assert.equal((await call('POST', '/v1/sessions', { body: { taskId: 'washer-fluid' } })).status, 201);
  assert.equal((await call('POST', '/v1/sessions', { body: { taskId: 'washer-fluid' } })).status, 429, 'third create exceeds the budget of 2');
}));

test('session creation is loopback-only (vehicle auth stand-in); non-loopback bind needs TLS', async () => {
  const handler = createSyncHandler({ service: new SessionService({ store: new MemorySessionStore() }) });
  const fakeReq = (remoteAddress) => Object.assign((async function* () { yield Buffer.from(JSON.stringify({ taskId: 'washer-fluid' })); })(), {
    method: 'POST', url: '/v1/sessions', headers: { 'content-type': 'application/json' }, socket: { remoteAddress },
  });
  const run = (addr) => new Promise((resolve) => { handler(fakeReq(addr), { writeHead: (code) => resolve(code), end() {} }); });
  assert.equal(await run('192.168.0.23'), 403);
  assert.equal(await run('127.0.0.1'), 201);
  await assert.rejects(startSyncServer({ host: '0.0.0.0', port: 0, log: () => {} }), /without TLS/);
});

test('CORS only for one exact opt-in origin', () => withServer({ allowedOrigin: 'https://phone.example' }, async ({ call }) => {
  const ok = await call('OPTIONS', '/v1/submissions', { headers: { Origin: 'https://phone.example' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://phone.example');
  const other = await call('OPTIONS', '/v1/submissions', { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.status, 403);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
}));

test('[18] restart: a new server process starts empty; old tokens get 404, never a stale accept', async () => {
  let p;
  await withServer({}, async ({ call }) => { p = await pair(call); await call('POST', '/v1/submissions', { token: p.submitToken, body: env(done()) }); });
  await withServer({}, async ({ call }) => {
    assert.equal((await call('GET', '/v1/submissions/status', { token: p.submitToken })).status, 404);
    assert.equal((await call('GET', `/v1/sessions/${p.sessionId}`, { token: p.receiverToken })).status, 404);
  });
});

test('debug page (opt-in) is served with a strict CSP', () => withServer({ debugPage: true }, async ({ call }) => {
  const page = await call('GET', '/debug');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const path of ['/public/debug.mjs', '/public/sync-client.mjs', '/src/protocol.mjs', '/mobile-ar-poc/public/inspection-result.mjs']) assert.equal((await call('GET', path)).status, 200, path);
  assert.equal((await call('GET', '/src/server.mjs')).status, 404, 'only the allow-listed files');
}));
