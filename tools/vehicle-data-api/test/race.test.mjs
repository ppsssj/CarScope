// Withdrawal ordering and async races (MOCK_PASS). Local access is cut before any provider call returns, and nothing that was in
// flight when access ended is stored, cached or returned. Other people and other vehicles keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalVehicleDataService } from '../src/service.mjs';
import { OAuthStateStore, Secret, TestOnlyMemoryTokenStore } from '../src/credentials.mjs';
import { hyundaiDevelopersProvider } from '../src/providers/hyundai-developers.mjs';
import { AVAILABILITY as A } from '../src/model.mjs';
import { fixtureFetch, json, HYUNDAI_EXAMPLES as H } from '../src/fixture.mjs';

const ALICE = 'session-alice-0000000000000001', BOB = 'session-bob-00000000000000002';
const CAR_A1 = '123e4567-c0a8-4af7-b8e5-262ea1f6aab4', CAR_A2 = '223e4567-c0a8-4af7-b8e5-262ea1f6aab4', CAR_B = '323e4567-c0a8-4af7-b8e5-262ea1f6aab4';
const TOKENS = { 'code-alice': 'fixture-alice-access-0001', 'code-bob': 'fixture-bobby-access-0001' };
const TOKENS_EXTRA = { 'code-carol': 'fixture-carol-access-0001' };
const CARS = { 'fixture-alice-access-0001': [CAR_A1, CAR_A2], 'fixture-bobby-access-0001': [CAR_B], 'fixture-alice-access-0002': [CAR_A1, CAR_A2], 'fixture-carol-access-0001': [CAR_A1] };
const PROVIDER = 'HYUNDAI_DEVELOPERS';

/** Gate: a route answer held until release(). */
function gate() { let release; const opened = new Promise(r => { release = r; }); return { opened, release: () => release() }; }

function setup({ hold = {} } = {}) {
  const now = { t: Date.parse('2026-11-12T01:00:00Z') };
  const bearer = init => init.headers.Authorization?.replace(/^Bearer /, '');
  const held = async (name, answer) => { if (hold[name]) await hold[name].opened; return answer; };
  const routes = {
    'POST /api/v1/user/oauth2/token': ({ init }) => {
      const form = new URLSearchParams(init.body), grant = form.get('grant_type');
      if (grant === 'authorization_code') return json({ access_token: TOKENS[form.get('code')] ?? TOKENS_EXTRA[form.get('code')], token_type: 'Bearer', refresh_token: `fixture-refresh-${form.get('code')}`, expires_in: 7200 });
      if (grant === 'refresh_token') return held('refresh', json({ access_token: 'fixture-alice-access-0002', token_type: 'Bearer', expires_in: 7200 }));
      return held('delete', json(H.deleteToken));
    },
    'GET /api/v1/car/profile/carlist': ({ init }) => held('carlist', null).then(() => json({ cars: (CARS[bearer(init)] ?? []).map(carId => ({ carId, carNickname: 'n', carType: 'EV', carName: 'NE', carSellname: 'IONIQ 5' })), msgId: 'm' })),
    'GET /api/v1/car-service/terms/reject': () => held('reject', json(H.termReject)),
  };
  for (const car of [CAR_A1, CAR_A2, CAR_B]) routes[`GET /api/v1/car/status/${car}/odometer`] = () => held(`odometer-${car}`, json(H.odometer));
  const f = fixtureFetch(routes), tokens = new TestOnlyMemoryTokenStore({});
  const provider = hyundaiDevelopersProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'), redirectUri: 'https://carscope.example/oauth/hyundai', fetchImpl: f.fetchImpl });
  const service = new ExternalVehicleDataService({ providers: { [PROVIDER]: provider }, tokenStore: tokens, keySalt: new Secret('fixture-salt'),
    states: new OAuthStateStore({ now: () => now.t }), now: () => now.t, testMode: true });
  return { service, tokens, calls: f.calls, now };
}
/** Link a person, record consent and bind each listed car to carscope vehicle "<prefix>-<n>". */
async function link(service, session, code, prefix) {
  const state = new URL(service.beginLogin({ sessionKey: session, provider: PROVIDER }).authorizationUrl).searchParams.get('state');
  assert.deepEqual(await service.completeLogin({ sessionKey: session, provider: PROVIDER, state, code }), { connected: true });
  service.testOnlyRecordConsent({ sessionKey: session, provider: PROVIDER, query: { userId: `user-${code}` } });
  const { vehicles } = await service.listVehicles({ sessionKey: session, provider: PROVIDER });
  vehicles.forEach((v, i) => assert.deepEqual(service.bindVehicle({ sessionKey: session, provider: PROVIDER, vehicleHandle: v.vehicleHandle, carscopeVehicleId: `${prefix}-${i + 1}`, ownerConfirmed: true }), { bound: true }));
}
const odometer = (service, session, vehicle) => service.read({ sessionKey: session, provider: PROVIDER, carscopeVehicleId: vehicle, features: ['odometer', 'warning.washer-fluid'] }).then(rs => rs[0]);
const tick = () => new Promise(r => setTimeout(r, 5));

test('disconnect cuts local access before the slow provider answers, and never stores the token again', async () => {
  const reject = gate(), del = gate();
  const { service, tokens, calls } = setup({ hold: { reject, delete: del } });
  await link(service, ALICE, 'code-alice', 'alice-car');
  const pending = service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
  await tick();
  // The provider has not answered yet, and access is already gone.
  assert.equal(tokens.size, 0);
  const before = calls.length;
  const r = await odometer(service, ALICE, 'alice-car-1');
  assert.deepEqual([r.availability, r.value, r.reason], [A.NOT_CONNECTED, null, 'NO_OWNER_CONFIRMED_BINDING']);
  assert.equal((await service.listVehicles({ sessionKey: ALICE, provider: PROVIDER })).availability, A.CONSENT_REQUIRED);
  assert.equal(calls.length, before, 'no provider request while blocked');
  reject.release(); await tick(); del.release();
  assert.deepEqual(await pending, { localAccessBlocked: true, remoteWithdrawal: 'CONFIRMED', steps: [{ step: 'WITHDRAW_CONSENT', ok: true }, { step: 'REVOKE_TOKEN', ok: true }] });
  assert.equal(tokens.size, 0, 'the in-memory credential used for the provider calls was not written back');
  assert.equal(new URLSearchParams(calls.at(-1).body).get('access_token'), 'fixture-alice-access-0001', 'revocation used the held credential');
});

test('a failed or throwing provider withdrawal keeps local data removed and is reported separately', async () => {
  // The real adapter for login; its two withdrawal calls fail in both ways: an error result and an exception.
  const f = fixtureFetch({ 'POST /api/v1/user/oauth2/token': json(H.token) });
  const real = hyundaiDevelopersProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'), redirectUri: 'https://carscope.example/oauth/hyundai', fetchImpl: f.fetchImpl });
  const provider = { ...real, withdrawConsent: async () => ({ error: { availability: A.PROVIDER_ERROR, reason: 'TIMEOUT' } }), revoke: async () => { throw new Error('provider exploded'); } };
  const tokens = new TestOnlyMemoryTokenStore({});
  const service = new ExternalVehicleDataService({ providers: { [PROVIDER]: provider }, tokenStore: tokens, keySalt: new Secret('fixture-salt'), states: new OAuthStateStore(), testMode: true });
  const state = new URL(service.beginLogin({ sessionKey: ALICE, provider: PROVIDER }).authorizationUrl).searchParams.get('state');
  assert.deepEqual(await service.completeLogin({ sessionKey: ALICE, provider: PROVIDER, state, code: 'A1B2C3' }), { connected: true });
  service.testOnlyRecordConsent({ sessionKey: ALICE, provider: PROVIDER, query: { userId: 'user-code-alice' } });
  assert.equal(tokens.size, 1);
  assert.deepEqual(await service.disconnect({ sessionKey: ALICE, provider: PROVIDER }),
    { localAccessBlocked: true, remoteWithdrawal: 'FAILED', steps: [{ step: 'WITHDRAW_CONSENT', ok: false, reason: 'TIMEOUT' }, { step: 'REVOKE_TOKEN', ok: false, reason: 'CALL_FAILED' }] });
  assert.equal(tokens.size, 0, 'local removal holds although the provider failed');
  assert.equal((await service.listVehicles({ sessionKey: ALICE, provider: PROVIDER })).availability, A.CONSENT_REQUIRED);
  // A second disconnect has nothing to send and says so.
  assert.deepEqual(await service.disconnect({ sessionKey: ALICE, provider: PROVIDER }), { localAccessBlocked: true, remoteWithdrawal: 'NOT_ATTEMPTED', steps: [] });
});

test('a token refresh that returns after disconnect or account withdrawal is not stored, and its read is dropped', async () => {
  for (const cut of ['disconnect', 'account-callback']) {
    const refresh = gate();
    const { service, tokens, calls, now } = setup({ hold: { refresh } });
    await link(service, ALICE, 'code-alice', 'alice-car');
    now.t += 7200_000; // access token expired
    const reading = odometer(service, ALICE, 'alice-car-1');
    const second = odometer(service, ALICE, 'alice-car-2');
    await tick();
    assert.equal(calls.filter(c => c.body && new URLSearchParams(c.body).get('grant_type') === 'refresh_token').length, 1, 'one refresh at a time per account');
    if (cut === 'disconnect') await service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
    else assert.deepEqual(service.handleRevocation({ provider: PROVIDER, body: { type: 'account', action: 'delete', userId: 'user-code-alice' } }), { accepted: true, purged: 2 });
    refresh.release();
    for (const r of [await reading, await second]) assert.deepEqual([r.availability, r.value, r.reason], [A.CONSENT_REQUIRED, null, 'ACCESS_WITHDRAWN_DURING_REQUEST'], cut);
    assert.equal(tokens.size, 0, `${cut}: the late refresh result was not written back`);
    assert.equal(calls.filter(c => c.url.endsWith('/odometer')).length, 0, `${cut}: no data request with the late token`);
  }
});

test('an in-flight read is dropped and not cached when access ends; a later consent starts clean', async () => {
  const hold = gate();
  const { service, calls } = setup({ hold: { [`odometer-${CAR_A1}`]: hold } });
  await link(service, ALICE, 'code-alice', 'alice-car');
  const pending = odometer(service, ALICE, 'alice-car-1');
  await tick();
  await service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
  hold.release();
  const r = await pending;
  assert.deepEqual([r.availability, r.value], [A.CONSENT_REQUIRED, null]);
  // Re-link: the dropped answer was never cached, so the provider is asked again.
  await link(service, ALICE, 'code-alice', 'alice-car');
  const before = calls.filter(c => c.url.endsWith(`${CAR_A1}/odometer`)).length;
  const again = await odometer(service, ALICE, 'alice-car-1');
  assert.deepEqual([again.availability, again.value], [A.RECEIVED, 12320]);
  assert.equal(calls.filter(c => c.url.endsWith(`${CAR_A1}/odometer`)).length, before + 1);
});

test('isolation: one vehicle\'s withdrawal leaves the person\'s other vehicle, and one person\'s disconnect leaves another person', async () => {
  const bobHold = gate();
  const { service, tokens } = setup({ hold: { [`odometer-${CAR_B}`]: bobHold } });
  await link(service, ALICE, 'code-alice', 'alice-car');
  await link(service, BOB, 'code-bob', 'bob-car');
  // Vehicle-level withdrawal for Alice's first car only.
  assert.deepEqual(service.handleRevocation({ provider: PROVIDER, body: { type: 'agreement', action: 'reject', carId: CAR_A1 } }), { accepted: true, purged: 1 });
  assert.equal((await odometer(service, ALICE, 'alice-car-1')).availability, A.NOT_CONNECTED);
  assert.deepEqual([(await odometer(service, ALICE, 'alice-car-2')).availability, tokens.size], [A.RECEIVED, 2]);
  // Bob's read is in flight while Alice disconnects: Bob's answer still arrives and is kept.
  const bobPending = odometer(service, BOB, 'bob-car-1');
  await tick();
  const result = await service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
  assert.equal(result.localAccessBlocked, true);
  bobHold.release();
  const bob = await bobPending;
  assert.deepEqual([bob.availability, bob.value], [A.RECEIVED, 12320]);
  assert.equal(tokens.size, 1, 'only Alice\'s tokens are gone');
  assert.equal((await odometer(service, ALICE, 'alice-car-2')).availability, A.NOT_CONNECTED);
  assert.equal((await odometer(service, BOB, 'bob-car-1')).availability, A.RECEIVED);
  // Bob cannot read Alice's CarScope vehicles, and Alice's ids never resolve for him.
  assert.equal((await odometer(service, BOB, 'alice-car-2')).reason, 'NO_OWNER_CONFIRMED_BINDING');
});

test("one person's disconnect blocks that vehicle only for them; another account that also holds it keeps reading", async () => {
  const { service } = setup();
  await link(service, ALICE, 'code-alice', 'alice-car');
  await link(service, 'session-carol-000000000000003', 'code-carol', 'carol-car'); // a second account that also lists CAR_A1
  await service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
  assert.equal((await odometer(service, ALICE, 'alice-car-1')).availability, A.NOT_CONNECTED);
  const carol = await odometer(service, 'session-carol-000000000000003', 'carol-car-1');
  assert.deepEqual([carol.availability, carol.value], [A.RECEIVED, 12320]);
  // A provider notice for the vehicle itself, by contrast, applies to every account holding it.
  service.handleRevocation({ provider: PROVIDER, body: { type: 'vehicle', action: 'delete', carId: CAR_A1 } });
  assert.equal((await odometer(service, 'session-carol-000000000000003', 'carol-car-1')).availability, A.NOT_CONNECTED);
});

test('a vehicle list that returns after disconnect is dropped and creates no selectable handle', async () => {
  const carlist = gate();
  const { service } = setup({ hold: { carlist } });
  const state = new URL(service.beginLogin({ sessionKey: ALICE, provider: PROVIDER }).authorizationUrl).searchParams.get('state');
  await service.completeLogin({ sessionKey: ALICE, provider: PROVIDER, state, code: 'code-alice' });
  service.testOnlyRecordConsent({ sessionKey: ALICE, provider: PROVIDER, query: { userId: 'user-code-alice' } });
  const pending = service.listVehicles({ sessionKey: ALICE, provider: PROVIDER });
  await tick();
  await service.disconnect({ sessionKey: ALICE, provider: PROVIDER });
  carlist.release();
  assert.deepEqual(await pending, { availability: A.CONSENT_REQUIRED, reason: 'ACCESS_WITHDRAWN_DURING_REQUEST' });
});
