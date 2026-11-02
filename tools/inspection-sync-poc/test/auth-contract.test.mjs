import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProductionSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { VerifiedSessionCreationAuthorizer } from '../src/verified-creation-authorizer.mjs';
import { authFixture } from './auth-fixture.mjs';
import { tempFixture } from './temp-fixture.mjs';
import { localPki } from './https-helpers.mjs';

test('auth defaults deny, even with valid-looking metadata; missing dependencies never create trust', async () => {
  const f = authFixture();
  for (const issuer of ['http://issuer.invalid', 'https://u:p@issuer.invalid', 'https://issuer.invalid:0/', 'https://issuer.invalid/?', 'https://issuer.invalid/#']) assert.throws(() => new VerifiedSessionCreationAuthorizer({ ...f.options, issuer }), /INVALID_AUTH_POLICY/);
  assert.equal(await new ProductionSessionCreationAuthorizer().authorize({ token: f.token, secure: true }), false);
  for (const dependency of ['credentialVerifier', 'registrationProvider', 'revocations']) {
    assert.equal(await new VerifiedSessionCreationAuthorizer({ ...f.options, [dependency]: undefined }).authorize({ token: f.token, secure: true }), false);
  }
  assert.equal(f.authorizer.testOnly, true);
  assert.equal(await f.authorizer.authorize({ token: f.token, secure: true }), true);
});

test('auth validates issuer/audience/exact scope/safe times/lifetime/active/credential and registration identity', async () => {
  for (const patch of [{ active: false }, { active: 'true' }, { issuer: 'https://evil.invalid/' }, { audience: 'other' }, { scope: [] }, { scope: ['inspection:session:create', 'admin'] },
    { expiresAt: 1000 }, { expiresAt: '2000' }, { issuedAt: -1 }, { issuedAt: 2000 }, { notBefore: 1001 }, { notBefore: 0 }, { expiresAt: 302000 }, { credentialId: '' }, { subject: null }, { registrationId: 'other' }, { injected: true }]) {
    const f = authFixture({ now: () => 1000 }); Object.assign(f.state.claim, patch);
    assert.equal(await f.authorizer.authorize({ token: f.token, secure: true }), false);
  }
  const f = authFixture();
  for (const context of [{ token: f.token, secure: false }, { token: f.token, secure: 'true' }, { token: 'x'.repeat(43), secure: true }, { token: null, secure: true }, { token: f.token + '.jwt', secure: true }]) assert.equal(await f.authorizer.authorize(context), false);
});

test('registration lookup must authenticate the user vehicle device relationship; unknown/revoked ownership fails', async () => {
  for (const patch of [{ active: false }, { ownershipVerified: false }, { issuer: 'other' }, { subject: 'other' }, { registrationId: 'other' }, { userId: '' }, { vehicleId: null }, { deviceId: '../untrusted' }, { expiresAt: 1000 }, { injected: true }]) {
    const f = authFixture({ now: () => 1000 }); Object.assign(f.state.binding, patch);
    assert.equal(await f.authorizer.authorize({ token: f.token, secure: true }), false);
  }
  const f = authFixture(); f.state.binding = null;
  assert.equal(await f.authorizer.authorize({ token: f.token, secure: true }), false);
});

test('revoke/unknown/outage denies without positive caching or credential-bearing exceptions', async () => {
  const f = authFixture(); const context = { token: f.token, secure: true };
  assert.equal(await f.authorizer.authorize(context), true);
  for (const value of [false, null, undefined, 1, 'true']) { f.state.active = value; assert.equal(await f.authorizer.authorize(context), false); }
  for (const [dependency, method] of [['credentialVerifier', 'verify'], ['registrationProvider', 'resolve'], ['revocations', 'isActive']]) {
    const g = authFixture(); g.options[dependency][method] = async () => { throw Object.assign(new Error(g.token), { name: g.token }); };
    assert.equal(await g.authorizer.authorize({ token: g.token, secure: true }), false);
  }
});

test('auth timeout aborts adapters; expiry is checked again after asynchronous registration/revocation', async () => {
  let at = 1000; const f = authFixture({ now: () => at });
  f.options.revocations.isActive = async () => { at = f.state.claim.expiresAt; return true; };
  assert.equal(await f.authorizer.authorize({ token: f.token, secure: true }), false);
  let signal;
  const g = authFixture({ timeoutMs: 15 });
  g.options.credentialVerifier.verify = ({ signal: s }) => { signal = s; return new Promise(() => {}); };
  assert.equal(await g.authorizer.authorize({ token: g.token, secure: true }), false);
  assert.equal(signal.aborted, true);
});

test('test PKI and owned temporary state are outside Git and explicitly removed, cleanup is idempotent', (t) => {
  const pki = localPki(); t.after(() => pki.cleanup()); assert.equal(existsSync(pki.tlsKey), true); assert.equal(existsSync(pki.tlsCert), true);
  pki.cleanup(); assert.equal(existsSync(pki.dir), false); pki.cleanup();
  const owned = tempFixture(); owned.cleanup(); assert.equal(existsSync(owned.dir), false);
  const failed = tempFixture(); t.after(() => failed.cleanup());
  const helper = new URL('./https-helpers.mjs', import.meta.url).href;
  const script = `import { localPki } from ${JSON.stringify(helper)}; try { localPki(); process.exitCode=1; } catch { console.log('EXPECTED_GENERATION_FAILURE'); }`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TEMP: failed.dir, TMP: failed.dir, TMPDIR: failed.dir, SYNC_OPENSSL: path.join(failed.dir, 'missing-openssl') } });
  assert.equal(child.status, 0); assert.match(child.stdout, /EXPECTED_GENERATION_FAILURE/);
  assert.deepEqual(readdirSync(failed.dir), [], 'generation failure leaves no owned PKI directory');
});
