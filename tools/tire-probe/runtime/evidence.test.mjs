import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assessExchange, sdkCapabilityObservation, ENDPOINT } from './evidence.mjs';
import { statusFixture } from '../../three-poc/test/tire-status-fixture.mjs';

function sample() {
  const body = statusFixture(1, 'PLEOS');
  return { url: ENDPOINT, method: 'GET', status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Content-Security-Policy': `default-src 'none'; script-src 'self' 'sha256-${Buffer.alloc(32).toString('base64')}'; connect-src 'self'` },
    body, ui: { connectionStatus: body.connectionStatus, sessionPhase: body.sessionPhase, readings: body.readings } };
}
test('synthetic native-response classifier validates the entire private exchange, not SDK health', () => {
  const r = assessExchange(sample()); assert.equal(r.status, 'PASS'); assert.equal(r.view.sessionPhase, 'UNRESOLVED');
});
test('external/query/fragment/post, weakened CSP/cache, mock and raw fields cannot pass runtime evidence', () => {
  const changes = [r => { r.url += '?x=1'; }, r => { r.url += '#x'; }, r => { r.url = 'https://external.invalid/tire-status.json'; },
    r => { r.method = 'POST'; }, r => { r.status = 503; }, r => { r.headers['Cache-Control'] = 'max-age=10'; },
    r => { r.headers['Content-Security-Policy'] = "default-src 'none'; connect-src *; script-src 'unsafe-eval'"; },
    r => { r.body.readings.forEach(x => { x.source = 'MOCK'; }); }, r => { r.body.readings[0].value = 99; },
    r => { r.ui = { ...r.ui, sessionPhase: 'ACTIVE' }; }, r => { r.expectedCsp = "default-src 'none'; connect-src 'self'"; }];
  for (const change of changes) { const r = sample(); change(r); assert.throws(() => assessExchange(r)); }
});
test('no-response, timeout and permission status never become capability support', () => {
  for (const capabilityStatus of ['UNVERIFIED', 'ERROR', 'PERMISSION_DENIED']) assert.equal(sdkCapabilityObservation([{ capabilityStatus }]).status, 'BLOCKED');
  assert.equal(sdkCapabilityObservation([{ capabilityStatus: 'UNSUPPORTED' }]).status, 'BLOCKED');
  assert.equal(sdkCapabilityObservation(Array.from({ length: 8 }, () => ({ capabilityStatus: 'UNSUPPORTED' }))).status, 'PASS');
  const partial = Array.from({ length: 8 }, () => ({ capabilityStatus: 'UNSUPPORTED' })); partial[7].capabilityStatus = 'UNVERIFIED';
  assert.equal(sdkCapabilityObservation(partial).status, 'BLOCKED');
});
test('standalone driver rejects repository and dot-prefixed output paths before device access', () => {
  for (const out of [resolve('tools/tire-probe/runtime'), resolve('..evidence')]) {
    const r = spawnSync(process.execPath, ['tools/tire-probe/runtime/webview.mjs', '--out=' + out], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /External output required/);
  }
});
