import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startHttpsMobileService } from '../src/https-mobile-service.mjs';
import { SyncClient, takeInviteFromLocation } from '../public/sync-client.mjs';
import { buildInviteFragment, receiptMatches, resultDigest } from '../src/protocol.mjs';
import { completeInspection, startInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { probeHost } from '../bin/host-readiness.mjs';
import { authFixture } from './auth-fixture.mjs';
import { tempFixture } from './temp-fixture.mjs';
import { localPki, tlsFetch } from './https-helpers.mjs';

async function fixture(t, options = {}) {
  const owned = tempFixture(), logs = [];
  let at = Date.now(), server, pki;
  t.after(async () => { try { if (server) await server.stop(); } finally { pki?.cleanup(); owned.cleanup(); } });
  pki = localPki();
  const auth = authFixture({ now: () => at });
  const settings = { databasePath: path.join(owned.dir, 'sync.sqlite'), ...pki, authorizer: auth.authorizer, now: () => at, log: (s) => logs.push(s), ...options };
  const start = async (port = 0) => { server = await startHttpsMobileService({ ...settings, port }); return server; };
  const fetch = tlsFetch(pki.ca);
  await start();
  const call = async (method, route, token, body) => {
    const r = await fetch(server.url + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const create = async () => { const r = await call('POST', '/v1/sessions', auth.token, { taskId: 'washer-fluid' }); assert.equal(r.status, 201); return r.body; };
  return { auth, pki, owned, fetch, logs, settings, start, call, create, get server() { return server; }, setTime(value) { at = value; } };
}
const done = () => completeInspection(startInspection(), 'NEEDS_REFILL');
const envelope = (result) => ({ protocol: 'inspection-sync', protocolVersion: 1, result });

test('same-origin TLS mobile/API share SQLite: QR Claim explicit Submit lost ACK restart duplicate Receipt View Accept ACCEPTED', async (t) => {
  const f = await fixture(t);
  assert.equal((await probeHost({ apiOrigin: f.server.url, mobileRoot: f.server.url, ca: f.pki.ca })).hostStatus, 'PASS');
  for (const route of ['/', '/public/mobile-dev-entry.mjs', '/public/mobile-sync.mjs', '/public/sync-client.mjs', '/src/protocol.mjs', '/mobile-ar-poc/public/inspection-result.mjs']) {
    const r = await f.fetch(f.server.url + route); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await f.call('POST', '/v1/sessions', 'wrong'.repeat(9), { taskId: 'washer-fluid' })).status, 403);
  const session = await f.create(), viewPath = `/v1/sessions/${session.sessionId}`;
  const qr = new URL(buildInviteFragment('washer-fluid', session.inviteToken), f.server.url + '/');
  const cleared = [], invite = takeInviteFromLocation(qr, { replaceState: (...a) => cleared.push(a) });
  assert.equal(cleared.length, 1); assert.equal(invite.valid, true); assert.ok(!qr.href.includes(session.receiverToken));
  let submitToken, lost = false; const bodies = [];
  const client = new SyncClient({ baseUrl: f.server.url, backoffMs: 0, fetchImpl: async (url, init) => {
    const r = await f.fetch(url, init);
    if (url.endsWith('/claim')) submitToken = (await r.clone().json()).submitToken;
    if (url.endsWith('/submissions')) { bodies.push(init.body); if (!lost) { lost = true; await r.text(); throw new TypeError('committed ACK lost'); } }
    return r;
  } }); t.after(() => client.dispose());
  assert.equal((await client.claim(invite.invite)).ok, true);
  const result = done(); assert.equal((await f.call('GET', viewPath, session.receiverToken)).body.sessionState, 'CLAIMED');
  assert.equal(bodies.length, 0);
  const sent = await client.send(result); assert.equal(sent.transport, 'SENT');
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(await receiptMatches(sent.receipt, result), true);
  const port = Number(new URL(f.server.url).port); await f.server.stop(); await f.start(port);
  const duplicate = await f.call('POST', '/v1/submissions', submitToken, envelope(result));
  assert.equal(duplicate.body.duplicate, true); assert.deepEqual(duplicate.body.receipt, sent.receipt);
  assert.equal((await f.call('POST', '/v1/submissions', submitToken, envelope(done()))).status, 409);
  const view = (await f.call('GET', viewPath, session.receiverToken)).body;
  assert.deepEqual(view.result, result); assert.equal(view.resultDigest, await resultDigest(result)); assert.equal(view.sessionState, 'RESULT_SUBMITTED');
  assert.equal((await client.status()).sessionState, 'RESULT_SUBMITTED');
  assert.equal((await f.call('POST', viewPath + '/accept', session.receiverToken, { resultDigest: 'sha256:' + '0'.repeat(64) })).status, 409);
  const accepted = await f.call('POST', viewPath + '/accept', session.receiverToken, { resultDigest: view.resultDigest });
  assert.equal(accepted.body.sessionState, 'ACCEPTED');
  assert.equal((await f.call('POST', viewPath + '/accept', session.receiverToken, { resultDigest: view.resultDigest })).body.acceptedAt, accepted.body.acceptedAt);
  const final = await client.status(); assert.equal(final.sessionState, 'ACCEPTED'); assert.equal(final.receipt.sessionState, 'ACCEPTED'); assert.equal(await receiptMatches(final.receipt, result), true);
  for (const secret of [f.auth.token, session.inviteToken, session.receiverToken, submitToken]) assert.ok(!f.logs.join('\n').includes(secret));
});

test('TLS service handles lost Claim, Cancel, session/QR expiry and startup cleanup without token reissue', async (t) => {
  const f = await fixture(t, { limits: { inviteTtlMs: 500, sessionTtlMs: 1000 } });
  const lost = await f.create();
  const first = new SyncClient({ baseUrl: f.server.url, fetchImpl: async (url, init) => { await (await f.fetch(url, init)).text(); throw new TypeError('claim response lost'); } });
  assert.equal((await first.claim(lost.inviteToken)).ok, false); first.dispose();
  const second = new SyncClient({ baseUrl: f.server.url, fetchImpl: f.fetch });
  assert.equal((await second.claim(lost.inviteToken)).code, 'ALREADY_CLAIMED'); second.dispose();
  await f.call('POST', `/v1/sessions/${lost.sessionId}/cancel`, lost.receiverToken);
  const cancelled = await f.create(), phone = new SyncClient({ baseUrl: f.server.url, fetchImpl: f.fetch });
  await phone.claim(cancelled.inviteToken); await phone.send(done());
  await f.call('POST', `/v1/sessions/${cancelled.sessionId}/cancel`, cancelled.receiverToken);
  assert.equal((await phone.status()).sessionState, 'CANCELLED'); phone.dispose();
  assert.equal((await f.call('GET', `/v1/sessions/${cancelled.sessionId}`, cancelled.receiverToken)).body.result, null);
  const expiring = await f.create(), expiredQr = await f.create();
  const p = new SyncClient({ baseUrl: f.server.url, fetchImpl: f.fetch }); await p.claim(expiring.inviteToken);
  f.setTime(expiredQr.inviteExpiresAt + 1);
  assert.equal((await f.call('POST', '/v1/claim', expiredQr.inviteToken)).status, 410);
  f.setTime(expiring.expiresAt + 1);
  const port = Number(new URL(f.server.url).port); await f.server.stop(); await f.start(port);
  assert.equal((await p.status()).sessionState, 'EXPIRED'); p.dispose();
  assert.equal((await f.server.store.get(expiring.sessionId)).result, null);
});

test('default service refuses creation; requires TLS; rejects external test dependencies, Host/Origin/query/debug and untrusted CA', async (t) => {
  const f = await fixture(t, { authorizer: undefined });
  assert.equal((await f.call('POST', '/v1/sessions', f.auth.token, { taskId: 'washer-fluid' })).status, 403);
  assert.equal(await f.server.store.count(), 0);
  await assert.rejects(tlsFetch()(f.server.url + '/'), /certificate|issuer|self.signed/i);
  await assert.rejects(f.fetch(f.server.url + '/', { headers: { Host: 'evil.invalid' } }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  for (const [route, headers, code] of [['/', { Host: 'localhost' }, 403], ['/v1/claim', { Origin: 'https://evil.invalid' }, 403], ['/?token=forbidden', {}, 400], ['/debug', {}, 404], ['/test/auth-fixture.mjs', {}, 404]]) {
    assert.equal((await f.fetch(f.server.url + route, { headers })).status, code);
  }
  await assert.rejects(startHttpsMobileService({ ...f.settings, tlsKey: undefined }), /TLS/);
  await assert.rejects(startHttpsMobileService({ ...f.settings, publicOrigin: 'https://wrong.invalid/' }), /SAN/);
  await assert.rejects(startHttpsMobileService({ ...f.settings, host: '0.0.0.0', publicOrigin: 'https://service.invalid/', authorizer: f.auth.authorizer }), /NON_TEST/);
  const script = fileURLToPath(new URL('../src/https-mobile-service.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, SYNC_LOCAL_TEST_AUTH: '1' } });
  assert.equal(result.status, 1); assert.ok(!result.stderr.includes(f.auth.token));
});

test('credential revoked while request body is pending cannot create a session', async (t) => {
  const f = await fixture(t); await f.server.stop();
  let checked; const initial = new Promise((resolve) => { checked = resolve; }); let checks = 0;
  f.settings.authorizer = { testOnly: true, async authorize(context) { const ok = await f.auth.authorizer.authorize(context); if (++checks === 1) checked(); return ok; } };
  await f.start();
  const body = '{"taskId":"washer-fluid"}';
  let request;
  const response = new Promise((resolve, reject) => {
    request = https.request(f.server.url + '/v1/sessions', { ca: f.pki.ca, agent: false, method: 'POST', headers: { Authorization: `Bearer ${f.auth.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    request.on('error', reject); request.write(body.slice(0, 1));
  });
  await initial; f.auth.state.active = false; request.end(body.slice(1));
  assert.equal(await response, 403); assert.equal(checks, 2); assert.equal(await f.server.store.count(), 0);
});
