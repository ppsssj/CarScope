import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { ProductionSessionCreationAuthorizer, FakeSessionCreationAuthorizer, LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { startSyncServer } from '../src/server.mjs';
import { RateLimiter } from '../src/rate-limit.mjs';
import { PROTOCOL, PROTOCOL_VERSION, receiptMatches } from '../src/protocol.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

test('creation defaults to denial even on loopback and with a forged authorization token', async (t) => {
  const s = await startSyncServer({ port: 0, log: () => {} }); t.after(() => s.stop());
  for (const token of [null, 'A'.repeat(43)]) {
    const r = await fetch(s.url + '/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: '{"taskId":"washer-fluid"}' });
    assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: { code: 'FORBIDDEN' } });
  }
  assert.equal(await s.store.count(), 0);
  assert.equal(await new ProductionSessionCreationAuthorizer().authorize({}), false);
});

test('fake credential requires TLS and loopback, expires, rotates and revokes; never an ownership proof', async () => {
  let now = 100;
  const token = 'A'.repeat(43), replacement = 'B'.repeat(43);
  const fake = new FakeSessionCreationAuthorizer({ token, expiresAt: 200, now: () => now });
  const ctx = { token, secure: true, remoteAddress: '127.0.0.1' };
  assert.equal(await fake.authorize(ctx), true);
  assert.equal(await fake.authorize({ ...ctx, token: replacement }), false);
  assert.equal(await fake.authorize({ ...ctx, secure: false }), false);
  assert.equal(await fake.authorize({ ...ctx, remoteAddress: '192.168.1.5' }), false);
  now = 200; assert.equal(await fake.authorize(ctx), false);
  fake.rotate({ token: replacement, expiresAt: 300 });
  assert.equal(await fake.authorize(ctx), false);
  assert.equal(await fake.authorize({ ...ctx, token: replacement }), true);
  fake.revoke(); assert.equal(await fake.authorize({ ...ctx, token: replacement }), false);
});

test('memory limiter bounds keys and rolls expired windows without relaxing budgets', () => {
  let now = 0;
  const limiter = new RateLimiter({ rates: { create: { limit: 1, windowMs: 1000 } }, maxKeys: 1, now: () => now });
  assert.equal(limiter.check('a', 'create').ok, true);
  assert.equal(limiter.check('b', 'create').ok, false);
  assert.equal(limiter.check('a', 'create').ok, false);
  now = 1000; assert.equal(limiter.check('b', 'create').ok, true);
});

function certificates() {
  const dir = mkdtempSync(path.join(tmpdir(), 'carscope-tls-'));
  const openssl = process.env.SYNC_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const run = (...args) => execFileSync(openssl, args, { cwd: dir, stdio: 'pipe' });
  writeFileSync(path.join(dir, 'extensions.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=CarScope Local Test CA');
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions.cnf');
  // Newer OpenSSL rejects a negative -days. Use a valid historical interval, not end < start.
  writeFileSync(path.join(dir, 'index.txt'), '');
  writeFileSync(path.join(dir, 'serial'), '1000\n');
  writeFileSync(path.join(dir, 'ca.cnf'), '[ca]\ndefault_ca=local\n[local]\ndatabase=index.txt\nserial=serial\nnew_certs_dir=.\ncertificate=ca.pem\nprivate_key=ca.key\ndefault_md=sha256\npolicy=subject_policy\nx509_extensions=server_ext\n[subject_policy]\ncommonName=supplied\n[server_ext]\n' + readFileSync(path.join(dir, 'extensions.cnf'), 'utf8'));
  run('ca', '-batch', '-notext', '-config', 'ca.cnf', '-in', 'server.csr', '-out', 'expired.pem', '-startdate', '200101000000Z', '-enddate', '200102000000Z');
  return { dir, ca: readFileSync(path.join(dir, 'ca.pem')), tlsKey: path.join(dir, 'server.key'), tlsCert: path.join(dir, 'server.pem'), expired: path.join(dir, 'expired.pem') };
}
function request(url, { ca, servername, method = 'GET', token, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ca, servername, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (x) => { text += x; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('HTTPS: trusted CA and SAN succeed; untrusted CA, hostname mismatch and expired certificate fail closed', async (t) => {
  const cert = certificates(), lines = []; let now = 100;
  const token = 'T'.repeat(43), authorizer = new FakeSessionCreationAuthorizer({ token, expiresAt: 200, now: () => now });
  const s = await startSyncServer({ port: 0, tlsCert: cert.tlsCert, tlsKey: cert.tlsKey, authorizer, debugPage: true, allowedOrigin: 'https://phone.example', log: (x) => lines.push(x) });
  t.after(() => s.stop());
  await assert.rejects(request(s.url + '/debug'), /certificate|issuer|self.signed/i);
  await assert.rejects(request(s.url + '/debug', { ca: cert.ca, servername: 'wrong.example' }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  const page = await request(s.url + '/debug', { ca: cert.ca });
  assert.equal(page.status, 200); assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.ok(page.headers['strict-transport-security']);
  const call = (opts) => request(s.url + '/v1/sessions', { ca: cert.ca, method: 'POST', body: '{"taskId":"washer-fluid"}', ...opts });
  assert.equal((await call({})).status, 403);
  assert.equal((await call({ token: 'X'.repeat(43) })).status, 403);
  const created = await call({ token }); assert.equal(created.status, 201);
  const session = JSON.parse(created.text);
  const claim = await request(s.url + '/v1/claim', { ca: cert.ca, method: 'POST', token: session.inviteToken });
  assert.equal(claim.status, 200);
  const submitToken = JSON.parse(claim.text).submitToken;
  const result = completeInspection(startInspection(), 'OK');
  const sent = await request(s.url + '/v1/submissions', { ca: cert.ca, method: 'POST', token: submitToken,
    body: JSON.stringify({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result }) });
  assert.equal(sent.status, 201);
  const receipt = JSON.parse(sent.text).receipt;
  assert.equal(await receiptMatches(receipt, result), true);
  const accepted = await request(`${s.url}/v1/sessions/${session.sessionId}/accept`, { ca: cert.ca, method: 'POST', token: session.receiverToken,
    body: JSON.stringify({ resultDigest: receipt.resultDigest }) });
  assert.equal(JSON.parse(accepted.text).sessionState, 'ACCEPTED');
  now = 200; assert.equal((await call({ token })).status, 403);
  const cors = await request(s.url + '/v1/claim', { ca: cert.ca, method: 'OPTIONS', origin: 'https://phone.example' });
  assert.equal(cors.status, 204); assert.equal(cors.headers['access-control-allow-origin'], 'https://phone.example');
  const denied = await request(s.url + '/v1/claim', { ca: cert.ca, method: 'OPTIONS', origin: 'https://attacker.example' });
  assert.equal(denied.status, 403); assert.equal(denied.headers['access-control-allow-origin'], undefined);
  for (const secret of [token, submitToken, ...Object.values(JSON.parse(created.text)).filter((x) => typeof x === 'string' && x.length === 43)]) assert.ok(!lines.join('\n').includes(secret));
  const expired = await startSyncServer({ port: 0, tlsCert: cert.expired, tlsKey: cert.tlsKey, log: () => {} }); t.after(() => expired.stop());
  await assert.rejects(request(expired.url + '/debug', { ca: cert.ca }), { code: 'CERT_HAS_EXPIRED' });
  await assert.rejects(startSyncServer({ host: '0.0.0.0', port: 0, tlsCert: cert.tlsCert, tlsKey: cert.tlsKey, authorizer: new LocalTestSessionCreationAuthorizer() }), /loopback bind/);
});
