import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { authorityFixture } from './authority-fixture.mjs';
import { tlsFetch } from './https-helpers.mjs';
import { HttpsCreationAuthority, authorityJson, startAuthorizedHttpsMobileService, httpsCreationAuthorizer } from '../src/https-creation-authority.mjs';

test('normalized authority parser rejects duplicate escaped names invalid UTF8 oversize nesting and syntax', () => {
  for (const value of ['{"active":false,"active":true}', '{"active":false,"\\u0061ctive":true}', '{"x":{"a":1,"a":2}}', '[] trailing', ' '.repeat(17000), '{"x":'.repeat(10) + 'null' + '}'.repeat(10)]) {
    assert.throws(() => authorityJson(Buffer.from(value)));
  }
  assert.throws(() => authorityJson(Buffer.from([0xc3, 0x28])));
  assert.deepEqual(authorityJson(Buffer.from('{"scope":["inspection:session:create"],"active":true}')), { scope: ['inspection:session:create'], active: true });
});

test('real HTTPS authority -> existing verifier/registration/revocation policy -> same-origin TLS SQLite service', async t => {
  const f = await authorityFixture(); let service;
  t.after(async () => { try { await service?.stop(); } finally { await f.stop(); } });
  const authority = { origin: f.origin, issuer: f.issuer, audience: f.audience, credentials: f.credentials, ca: f.pki.ca };
  service = await startAuthorizedHttpsMobileService({ authority, ...f.pki, databasePath: path.join(f.pki.dir, 'sessions.sqlite') });
  const fetch = tlsFetch(f.pki.ca);
  for (const route of ['/src/https-creation-authority.mjs', '/test/authority-fixture.mjs', '/tools/native-auth-sync/fixture.mjs']) assert.equal((await fetch(service.url + route)).status, 404);
  const create = token => fetch(service.url + '/v1/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{"taskId":"tire.front-left"}' });
  assert.equal((await create(f.state.token)).status, 201);
  assert.equal((await create('wrong'.repeat(9))).status, 403);
  f.state.revoked = true; assert.equal((await create(f.state.token)).status, 403);
  f.rotate(); assert.equal((await create(f.state.token)).status, 201);
  f.state.registered = false; assert.equal((await create(f.state.token)).status, 403); f.state.registered = true;
  f.state.claim.expiresAt = Date.now(); assert.equal((await create(f.state.token)).status, 403);
  const old = f.state.token; f.rotate(); assert.equal((await create(old)).status, 403); assert.equal((await create(f.state.token)).status, 201);
  f.state.mode = 'outage'; assert.equal((await create(f.state.token)).status, 403);
  f.state.mode = 'ok'; assert.equal((await create(f.state.token)).status, 201, 'no stale failure or success cache');
  f.state.claim.audience = 'other'; assert.equal(await httpsCreationAuthorizer(authority).authorize({ token: f.state.token, secure: true }), false);
  assert.equal(httpsCreationAuthorizer(authority).testOnly, true);
  await assert.rejects(startAuthorizedHttpsMobileService({ authority, ...f.pki, host: '0.0.0.0', publicOrigin: 'https://localhost/', databasePath: path.join(f.pki.dir, 'forbidden.sqlite') }), /EXTERNAL_BIND/);
});

test('authority transport rejects redirects bad bodies missing credentials deadlines and untrusted or mismatched TLS', async t => {
  const f = await authorityFixture(); t.after(() => f.stop());
  const options = { origin: f.origin, credentials: f.credentials, ca: f.pki.ca };
  const call = { token: f.state.token };
  const adapter = new HttpsCreationAuthority(options);
  for (const mode of ['redirect', 'html', 'large', 'duplicate']) { f.state.mode = mode; assert.equal(await adapter.verify(call), null); }
  f.state.mode = 'delay'; assert.equal(await new HttpsCreationAuthority({ ...options, timeoutMs: 30 }).verify(call), null);
  f.state.mode = 'ok'; const hits = f.state.hits;
  assert.equal(await new HttpsCreationAuthority({ origin: f.origin }).verify(call), null); assert.equal(f.state.hits, hits);
  assert.equal(await new HttpsCreationAuthority({ origin: f.origin, credentials: f.credentials }).verify(call), null, 'untrusted fixture CA denied');
  const ctrl = new AbortController(); ctrl.abort(); assert.equal(await adapter.verify({ ...call, signal: ctrl.signal }), null);
  const ipv6 = await authorityFixture({ host: '::1' }); t.after(() => ipv6.stop());
  assert.equal(await new HttpsCreationAuthority({ origin: ipv6.origin, credentials: ipv6.credentials, ca: ipv6.pki.ca }).verify({ token: ipv6.state.token }), null, 'IPv6 address absent from certificate SAN');
  for (const origin of ['http://localhost', 'https://u:p@localhost', 'https://localhost/path', 'https://localhost/?token=x']) assert.throws(() => new HttpsCreationAuthority({ origin }));
});
