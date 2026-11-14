import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { apkContains, grantProblem, formatReport, CAUSES, STATUS } from '../bin/vision-qr-diagnose.mjs';

/** A minimal zip with the given entries (method 0 stored or 8 deflated), enough for the central-directory walk. */
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data, method] of entries) {
    const body = method === 8 ? deflateRawSync(data) : data, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body); centrals.push(central, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('the APK check finds the compiled origin only inside dex entries, stored or deflated', () => {
  const origin = 'https://carscope-vision-experiment.onrender.com';
  const dex = Buffer.concat([Buffer.from('dex\n035\0'), Buffer.from('xx' + origin + 'yy')]);
  assert.equal(apkContains(zip([['AndroidManifest.xml', Buffer.from('m'), 0], ['classes.dex', dex, 8]]), origin), true);
  assert.equal(apkContains(zip([['classes2.dex', dex, 0]]), origin), true);
  assert.equal(apkContains(zip([['classes.dex', Buffer.from('other'), 8], ['res/x.txt', Buffer.from(origin), 0]]), origin), false, 'a non-dex entry does not count');
  assert.throws(() => apkContains(Buffer.from('not a zip at all, definitely not'), origin), /APK_NOT_A_ZIP/);
});

test('the grant check mirrors the app contract and separates clock problems', () => {
  const origin = 'https://x.onrender.com', registrationId = '11111111-1111-4111-8111-111111111111', at = 1_800_000_000_000;
  const ok = { mode: 'OPERATOR_APPROVED_AVD_SIMULATION', apiOrigin: origin, audience: 'carscope-avd-simulator', scope: 'inspection:session:create',
    credential: 'C'.repeat(43), credentialId: '22222222-2222-4222-8222-222222222222', issuedAt: at, notBefore: at, expiresAt: at + 120_000,
    registrationId, simulatorApproved: true, realVehicleOwnershipVerified: false };
  assert.equal(grantProblem(ok, { origin, registrationId, at }), null);
  for (const bad of [{ ...ok, extra: 1 }, { ...ok, apiOrigin: 'https://y.onrender.com' }, { ...ok, realVehicleOwnershipVerified: true },
    { ...ok, expiresAt: at + 121_000 }, { ...ok, registrationId: '33333333-3333-4333-8333-333333333333' }, { ...ok, credential: 'short' }])
    assert.equal(grantProblem(bad, { origin, registrationId, at }), 'GRANT_INVALID');
  assert.equal(grantProblem({ ...ok, notBefore: at + 10_000, expiresAt: at + 100_000 }, { origin, registrationId, at }), 'CLOCK_SKEW');
  assert.equal(grantProblem(ok, { origin, registrationId, at: at + 200_000 }), 'CLOCK_SKEW');
});

test('every named cause has a fix, and the report shows the first failure with its fix', () => {
  for (const [cause, fix] of Object.entries(CAUSES)) assert.ok(fix.length > 20, cause);
  const text = formatReport({ checks: [
    { id: 'A', title: 'AVD connected', status: STATUS.PASS, cause: null, detail: null, fix: null },
    { id: 'B', title: 'Registration exists in DB', status: STATUS.FAIL, cause: 'NO_REGISTRATION', detail: 'role r, schema carscope', fix: CAUSES.NO_REGISTRATION },
    { id: 'C', title: 'QR authorization (approved live test only)', status: STATUS.NOT_RUN, cause: null, detail: null, fix: null },
  ], final: 'BLOCKED', firstFailure: { title: 'Registration exists in DB', cause: 'NO_REGISTRATION', fix: CAUSES.NO_REGISTRATION } });
  assert.match(text, /^CarScope Vision QR Diagnostic/);
  assert.match(text, /\[FAIL\] Registration exists in DB - role r, schema carscope \(NO_REGISTRATION\)/);
  assert.match(text, /\[NOT_RUN\] QR authorization/);
  assert.match(text, /Final: BLOCKED\nFirst failure: Registration exists in DB \(NO_REGISTRATION\)\nFix: /);
});

test('the CLI refuses a session test without a provision test and never takes a secret argument', () => {
  const cli = fileURLToPath(new URL('../bin/vision-qr-diagnose.mjs', import.meta.url));
  const source = readFileSync(cli, 'utf8');
  assert.doesNotMatch(source.slice(source.indexOf('function parse(')), /--(proof|token|password|url|database)/i);
  const run = (args) => { try { execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (e) { return e.stderr; } };
  assert.match(run(['--serial', 's', '--origin', 'https://x.onrender.com', '--approve-session']), /SESSION_NEEDS_PROVISION/);
  assert.match(run(['--serial', 's', '--origin', 'http://insecure.example']), /INVALID_ARGUMENTS/);
  assert.match(run(['--serial', 's', '--origin', 'https://x.onrender.com', '--proof', 'x']), /INVALID_ARGUMENTS/);
});

test('the source never logs a proof, hash, grant or token', () => {
  const source = readFileSync(new URL('../bin/vision-qr-diagnose.mjs', import.meta.url), 'utf8');
  for (const line of source.split('\n').filter((l) => /console\.|process\.std(out|err)\.write|writeFile\(o\.report/.test(l)))
    assert.doesNotMatch(line, /proof|enrollment_hash|credential|receiverToken|inviteToken|PG_VISION_DATABASE_URL/, line.trim());
});
