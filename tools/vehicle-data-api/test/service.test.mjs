// End-to-end server flow with MOCK providers (MOCK_PASS; no live request is possible or attempted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { ExternalVehicleDataService } from '../src/service.mjs';
import { OAuthStateStore, Secret, TestOnlyMemoryTokenStore } from '../src/credentials.mjs';
import { hyundaiDevelopersProvider } from '../src/providers/hyundai-developers.mjs';
import { pleosVehicleDataProvider } from '../src/providers/pleos-vehicle-data.mjs';
import { externalCardProjection } from '../src/projection.mjs';
import { AVAILABILITY as A } from '../src/model.mjs';
import { fixtureFetch, json, HYUNDAI_EXAMPLES as H, HYUNDAI_CAR_ID, PLEOS_EXAMPLES as PL, PLEOS_VIN } from '../src/fixture.mjs';
import { validateExternalVehicleData, externalVehicleDataHtml } from '../../three-poc/external-vehicle-data.mjs';

const ALICE = 'session-alice-0000000000000001', BOB = 'session-bob-00000000000000002';
const W = `/api/v1/car/status/warning/${HYUNDAI_CAR_ID}`, S = `/api/v1/car/status/${HYUNDAI_CAR_ID}`;
const HYUNDAI_ROUTES = { 'POST /api/v1/user/oauth2/token': ({ init }) => json(new URLSearchParams(init.body).get('grant_type') === 'refresh_token' ? H.refresh : new URLSearchParams(init.body).get('grant_type') === 'delete' ? H.deleteToken : H.token),
  'GET /api/v1/car/profile/carlist': json(H.carlist), 'GET /api/v1/car-service/terms/reject': json(H.termReject),
  [`GET ${W}/washerFluid`]: json(H.warningOn), [`GET ${W}/breakOil`]: json(H.warningOff), [`GET ${W}/tirePressure`]: json(H.warningOff),
  [`GET ${S}/odometer`]: json(H.odometer), [`GET ${S}/ev/battery`]: json(H.evBattery), [`GET ${S}/ev/charging`]: json(H.evCharging) };

function setup({ routes = HYUNDAI_ROUTES, pleosRoutes = {}, pleosCountry = null, now = { t: Date.parse('2026-11-12T01:00:00Z') }, rates } = {}) {
  const h = fixtureFetch(routes), pl = fixtureFetch(pleosRoutes), states = new OAuthStateStore({ now: () => now.t });
  const tokens = new TestOnlyMemoryTokenStore({});
  const providers = {
    HYUNDAI_DEVELOPERS: hyundaiDevelopersProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'), redirectUri: 'https://carscope.example/oauth/hyundai', fetchImpl: h.fetchImpl }),
    PLEOS_VEHICLE_DATA: pleosVehicleDataProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'), loginRedirectUrl: 'https://carscope.example/oauth/pleos', brand: 'hyundai', fetchImpl: pl.fetchImpl }),
  };
  const service = new ExternalVehicleDataService({ providers, tokenStore: tokens, keySalt: new Secret('fixture-salt'), states, now: () => now.t, testMode: true, pleosCountry, ...(rates ? { rates } : {}) });
  return { service, states, tokens, calls: h.calls, pleosCalls: pl.calls, now };
}
async function connect(service, session = ALICE, provider = 'HYUNDAI_DEVELOPERS', consent = H.consentRedirect) {
  const { authorizationUrl } = service.beginLogin({ sessionKey: session, provider });
  const state = new URL(authorizationUrl).searchParams.get('state');
  assert.deepEqual(await service.completeLogin({ sessionKey: session, provider, state, code: 'A1B2C3' }), { connected: true });
  assert.deepEqual(service.testOnlyRecordConsent({ sessionKey: session, provider, query: consent }), { consented: true });
  const { vehicles } = await service.listVehicles({ sessionKey: session, provider });
  assert.deepEqual(service.bindVehicle({ sessionKey: session, provider, vehicleHandle: vehicles[0].vehicleHandle, carscopeVehicleId: 'carscope-vehicle-1', ownerConfirmed: true }), { bound: true });
  return vehicles[0];
}
const FEATURES = ['warning.washer-fluid', 'warning.brake-fluid', 'warning.tire-pressure', 'odometer', 'ev.state-of-charge', 'ev.plug', 'tire.pressure.front-left'];

test('OAuth state: bound to the session, single use, expires; another session or a replay cannot complete the login', async () => {
  const { service, calls, now } = setup();
  const state = new URL(service.beginLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }).authorizationUrl).searchParams.get('state');
  assert.deepEqual(await service.completeLogin({ sessionKey: BOB, provider: 'HYUNDAI_DEVELOPERS', state, code: 'A1B2C3' }), { availability: A.NOT_CONNECTED, reason: 'OAUTH_STATE_MISMATCH' });
  assert.deepEqual(await service.completeLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', state, code: 'A1B2C3' }), { availability: A.NOT_CONNECTED, reason: 'OAUTH_STATE_MISMATCH' }, 'the failed attempt consumed it');
  const forged = 'A'.repeat(43);
  assert.equal((await service.completeLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', state: forged, code: 'A1B2C3' })).reason, 'OAUTH_STATE_MISMATCH');
  const late = new URL(service.beginLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }).authorizationUrl).searchParams.get('state');
  now.t += 10 * 60_000 + 1;
  assert.equal((await service.completeLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', state: late, code: 'A1B2C3' })).reason, 'OAUTH_STATE_MISMATCH');
  const consentState = new URL(service.beginLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }).authorizationUrl).searchParams.get('state');
  assert.equal((await service.completeConsent({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', state: consentState, query: H.consentRedirect })).reason, 'CONSENT_STATE_MISMATCH', 'a login state is not a consent state');
  assert.equal(calls.length, 0, 'no token request was made for any refused callback');
});

test('no reads before consent, without an owner-confirmed binding, or for a vehicle the account does not list', async () => {
  const { service, calls } = setup();
  const state = new URL(service.beginLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }).authorizationUrl).searchParams.get('state');
  await service.completeLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', state, code: 'A1B2C3' });
  assert.deepEqual(await service.listVehicles({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }), { availability: A.CONSENT_REQUIRED, reason: 'NO_DATA_SHARING_CONSENT' });
  assert.deepEqual(service.beginConsent({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }), { availability: A.BLOCKED, reason: 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER' });
  service.testOnlyRecordConsent({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', query: H.consentRedirect });
  const { vehicles } = await service.listVehicles({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' });
  assert.ok(vehicles[0].vehicleHandle.startsWith('vh_'));
  assert.ok(!JSON.stringify(vehicles).includes(HYUNDAI_CAR_ID), 'carId never leaves the server');
  const before = calls.length;
  const unbound = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: FEATURES });
  assert.ok(unbound.every(r => r.availability === A.NOT_CONNECTED && r.reason === 'NO_OWNER_CONFIRMED_BINDING' && r.value === null));
  assert.equal(service.bindVehicle({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', vehicleHandle: vehicles[0].vehicleHandle, carscopeVehicleId: 'carscope-vehicle-1' }).reason, 'OWNER_CONFIRMATION_REQUIRED');
  assert.equal(service.bindVehicle({ sessionKey: BOB, provider: 'HYUNDAI_DEVELOPERS', vehicleHandle: vehicles[0].vehicleHandle, carscopeVehicleId: 'carscope-vehicle-1', ownerConfirmed: true }).reason, 'VEHICLE_NOT_AUTHORIZED_FOR_ACCOUNT', 'another person cannot bind this account\'s vehicle');
  assert.equal(service.bindVehicle({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', vehicleHandle: 'vh_' + 'x'.repeat(32), carscopeVehicleId: 'carscope-vehicle-1', ownerConfirmed: true }).reason, 'VEHICLE_NOT_AUTHORIZED_FOR_ACCOUNT');
  assert.equal(calls.length, before, 'refusals made no provider request');
});

test('bound and consented: documented features are read once per call, per-wheel pressure is unsupported without a request, and the cache limits calls', async () => {
  const { service, calls, now } = setup();
  await connect(service);
  const before = calls.length;
  const rs = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: FEATURES });
  const r = Object.fromEntries(rs.map(x => [x.featureId, x]));
  assert.deepEqual([r['warning.washer-fluid'].value, r.odometer.value, r['ev.plug'].value], [true, 12320, 'FAST_CHARGER_CONNECTED']);
  assert.deepEqual([r['tire.pressure.front-left'].availability, r['tire.pressure.front-left'].reason], [A.FEATURE_UNSUPPORTED, 'PROVIDER_HAS_NO_DOCUMENTED_API']);
  assert.equal(calls.length - before, 6, 'washer, brake, tire lamp, odometer, ev battery, ev charging');
  await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: FEATURES });
  assert.equal(calls.length - before, 6, 'within the minimum interval the copy is reused');
  assert.equal(await service.read({ sessionKey: BOB, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer'] }).then(x => x[0].reason), 'NO_OWNER_CONFIRMED_BINDING', 'another session cannot read the binding');
  now.t += 16 * 60_000;
  const stale = service.freshness(rs);
  assert.equal(stale.find(x => x.featureId === 'odometer').availability, A.STALE);
  assert.equal(stale.find(x => x.featureId === 'tire.pressure.front-left').availability, A.FEATURE_UNSUPPORTED);
});

test('token expiry refreshes once; a refused refresh drops the tokens and reports AUTH_EXPIRED', async () => {
  const env = setup();
  await connect(env.service);
  env.now.t += 7200_000; // expires_in 7200
  await env.service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer'] });
  assert.equal(env.calls.filter(c => c.body && new URLSearchParams(c.body).get('grant_type') === 'refresh_token').length, 1);
  const routes = { ...HYUNDAI_ROUTES, 'POST /api/v1/user/oauth2/token': ({ init }) => new URLSearchParams(init.body).get('grant_type') === 'refresh_token' ? json(H.error4002, 401) : json(H.token) };
  const bad = setup({ routes });
  await connect(bad.service);
  bad.now.t += 7200_000;
  const [x] = await bad.service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer'] });
  assert.deepEqual([x.availability, x.value], [A.AUTH_EXPIRED, null]);
  assert.equal(bad.tokens.size, 0);
});

test('provider failures stay distinct: no data, unauthorized, rate limited, outage, timeout-like network error, redirect', async () => {
  const cases = [[json(H.error4045, 404), A.NO_DATA], [json(H.error4002, 401), A.AUTH_EXPIRED], [json(H.error4002, 429), A.RATE_LIMITED],
    [json(H.error4002, 503), A.PROVIDER_ERROR], [{ throws: true }, A.PROVIDER_ERROR], [{ status: 302, headers: { location: 'https://evil.example' } }, A.PROVIDER_ERROR]];
  for (const [spec, availability] of cases) {
    const { service } = setup({ routes: { ...HYUNDAI_ROUTES, [`GET ${S}/odometer`]: spec } });
    await connect(service);
    const [x] = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer'] });
    assert.deepEqual([x.availability, x.value], [availability, null], JSON.stringify(spec));
  }
});

test('CarScope rate limit is enforced per account before the provider is called', async () => {
  const { service, calls, now } = setup({ rates: { 'external-auth': { limit: 100, windowMs: 60_000 }, 'external-read': { limit: 3, windowMs: 60_000 }, 'external-provider': { limit: 100, windowMs: 60_000 } } });
  await connect(service); // carlist used 1
  const before = calls.length;
  const rs = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer', 'warning.washer-fluid', 'ev.state-of-charge'] });
  assert.equal(calls.length - before, 2);
  assert.deepEqual(rs.map(r => r.availability), [A.RECEIVED, A.RECEIVED, A.RATE_LIMITED]);
  now.t += 61_000;
  assert.equal((await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['ev.state-of-charge'] }))[0].availability, A.RECEIVED);
});

test('withdrawal callback purges at once and blocks re-query; an answer in flight is dropped', async () => {
  let release;
  const routes = { ...HYUNDAI_ROUTES, [`GET ${S}/odometer`]: () => new Promise(r => { release = () => r(json(H.odometer)); }) };
  const { service, calls } = setup({ routes });
  const v = await connect(service);
  const pending = service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer'] });
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(service.handleRevocation({ provider: 'HYUNDAI_DEVELOPERS', body: H.revokeAgreement }), { accepted: true, purged: 1 });
  release();
  assert.deepEqual((await pending).map(r => [r.availability, r.value]), [[A.CONSENT_REQUIRED, null]]);
  const before = calls.length;
  const after = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: ['odometer', 'warning.washer-fluid'] });
  assert.ok(after.every(r => r.value === null && r.availability === A.NOT_CONNECTED));
  assert.equal(service.bindVehicle({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', vehicleHandle: v.vehicleHandle, carscopeVehicleId: 'carscope-vehicle-1', ownerConfirmed: true }).reason, 'VEHICLE_NOT_AUTHORIZED_FOR_ACCOUNT');
  assert.deepEqual((await service.listVehicles({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' })).vehicles, [], 'the withdrawn vehicle is not offered again without new consent');
  assert.equal(calls.length - before, 1, 'only the car list was asked');
  assert.deepEqual(service.handleRevocation({ provider: 'HYUNDAI_DEVELOPERS', body: { type: 'x' } }), { accepted: false });
});

test('account deletion callback drops tokens and consent for that provider user', async () => {
  const { service, tokens } = setup();
  await connect(service);
  assert.equal(tokens.size, 1);
  assert.deepEqual(service.handleRevocation({ provider: 'HYUNDAI_DEVELOPERS', body: H.revokeAccount }), { accepted: true, purged: 1 });
  assert.equal(tokens.size, 0);
  assert.equal((await service.listVehicles({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' })).availability, A.CONSENT_REQUIRED);
});

test('disconnect tells Hyundai (terms reject + token delete) and purges locally even if the provider fails', async () => {
  const { service, calls, tokens } = setup();
  await connect(service);
  assert.deepEqual(await service.disconnect({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }),
    { localAccessBlocked: true, remoteWithdrawal: 'CONFIRMED', steps: [{ step: 'WITHDRAW_CONSENT', ok: true }, { step: 'REVOKE_TOKEN', ok: true }] });
  assert.ok(calls.some(c => c.url.endsWith('/api/v1/car-service/terms/reject')));
  assert.equal(new URLSearchParams(calls.at(-1).body).get('grant_type'), 'delete');
  assert.equal(tokens.size, 0);
  const failing = setup({ routes: { ...HYUNDAI_ROUTES, 'GET /api/v1/car-service/terms/reject': json(H.error4002, 500) } });
  await connect(failing.service);
  assert.deepEqual(await failing.service.disconnect({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }),
    { localAccessBlocked: true, remoteWithdrawal: 'FAILED', steps: [{ step: 'WITHDRAW_CONSENT', ok: false, reason: 'HYUNDAI_4002' }, { step: 'REVOKE_TOKEN', ok: true }] });
  assert.equal(failing.tokens.size, 0);
});

test('Pleos is refused for a Korean (or unknown) vehicle region before any request; an EU host can run the MOCK flow', async () => {
  const pleosRoutes = { 'POST /v1/auth/token': json(PL.token), 'GET /v1/vehicles/consent': json(PL.vehicles), [`GET /v1/vehicles/${PLEOS_VIN}/status`]: json(PL.status),
    'DELETE /v1/vehicles/consent': json(PL.stopSharing) };
  for (const pleosCountry of ['KR', null]) {
    const { service, pleosCalls } = setup({ pleosRoutes, pleosCountry });
    assert.deepEqual(service.beginLogin({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA' }), { availability: A.REGION_UNSUPPORTED, reason: 'PLEOS_VEHICLE_DATA_EUROPE_ONLY' });
    const rs = await service.read({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA', carscopeVehicleId: 'carscope-vehicle-1', features: ['warning.washer-fluid'] });
    assert.equal(rs[0].availability, A.REGION_UNSUPPORTED);
    assert.equal(pleosCalls.length, 0);
  }
  const { service, pleosCalls } = setup({ pleosRoutes, pleosCountry: 'DE' });
  await connect(service, ALICE, 'PLEOS_VEHICLE_DATA', PL.consentRedirect);
  const r = Object.fromEntries((await service.read({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA', carscopeVehicleId: 'carscope-vehicle-1', features: ['warning.washer-fluid', 'tire.pressure.front-left', 'warning.lamp-wire'] })).map(x => [x.featureId, x]));
  assert.deepEqual([r['warning.washer-fluid'].value, r['tire.pressure.front-left'].value, r['warning.lamp-wire'].availability], [true, 40, A.FEATURE_UNSUPPORTED]);
  assert.equal(pleosCalls.filter(c => c.url.endsWith('/status')).length, 1, 'one status call answers every status feature');
  await service.disconnect({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA' });
  assert.ok(pleosCalls.some(c => c.method === 'DELETE' && c.url.endsWith(`?vin=${PLEOS_VIN}`)));
});

test('nothing secret or identifying leaves through readings, projection, errors or inspection', async () => {
  const { service, tokens } = setup();
  await connect(service);
  const rs = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: FEATURES });
  const projection = externalCardProjection({ providers: [{ provider: 'HYUNDAI_DEVELOPERS', availability: A.RECEIVED, readings: rs },
    { provider: 'PLEOS_VEHICLE_DATA', availability: A.REGION_UNSUPPORTED, reason: 'PLEOS_VEHICLE_DATA_EUROPE_ONLY' }] });
  validateExternalVehicleData(projection);
  const everything = [JSON.stringify(rs), JSON.stringify(projection), inspect(service, { depth: 5 }), inspect(tokens, { depth: 5 }), JSON.stringify(tokens)].join('\n');
  for (const secret of [H.token.access_token, H.refresh.access_token, H.token.refresh_token, 'fixture-client-secret', HYUNDAI_CAR_ID, ALICE, 'fixture-salt', H.consentRedirect.userId])
    assert.ok(!everything.includes(secret), secret);
  const json1 = JSON.stringify(projection);
  assert.ok(!/12320|\b100\b|32\.3/.test(json1), 'numbers stay server side');
  assert.equal(projection.providers[0].features.find(f => f.featureId === 'odometer').report, 'NUMBER_HIDDEN');
  assert.equal(projection.providers[0].features.find(f => f.featureId === 'odometer').observedAtUnzoned, '20200114152139');
});

test('SDK and REST stay separate: the external block never replaces the SDK block and shows its own states', async () => {
  const { service } = setup();
  await connect(service);
  const rs = await service.read({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: 'carscope-vehicle-1', features: FEATURES });
  const projection = externalCardProjection({ providers: [{ provider: 'HYUNDAI_DEVELOPERS', availability: A.RECEIVED, readings: rs }] });
  const html = externalVehicleDataHtml('washer-fluid-cap', projection);
  assert.match(html, /data-source="EXTERNAL_REST"/);
  assert.match(html, /data-external-feature="warning.washer-fluid" data-external-state="RECEIVED"/);
  assert.match(html, /어느 쪽도 덮어쓰지 않아요/);
  assert.doesNotMatch(html, /data-source="PLEOS"/);
  assert.match(externalVehicleDataHtml('tire.front-left', projection), /data-external-feature="tire.pressure.front-left" data-external-state="FEATURE_UNSUPPORTED"/);
});

test('the service refuses a token store that is not approved, and test mode cannot be used on a deployed host', () => {
  const base = { providers: {}, keySalt: new Secret('s'), states: new OAuthStateStore() };
  assert.throws(() => new ExternalVehicleDataService({ ...base, tokenStore: new TestOnlyMemoryTokenStore({}) }), /TOKEN_STORE_NOT_APPROVED/);
  assert.throws(() => new ExternalVehicleDataService({ ...base, tokenStore: { get() {}, put() {}, delete() {} }, testMode: true }), /TOKEN_STORE_NOT_APPROVED/);
  assert.throws(() => new ExternalVehicleDataService({ ...base, tokenStore: null, testMode: true }), /TOKEN_STORE_MISSING/);
  assert.throws(() => new TestOnlyMemoryTokenStore({ RENDER: 'true' }), /TEST_TOKEN_STORE_FORBIDDEN/);
  const svc = new ExternalVehicleDataService({ ...base, tokenStore: new TestOnlyMemoryTokenStore({}), testMode: true });
  assert.deepEqual(svc.beginLogin({ sessionKey: ALICE, provider: 'HYUNDAI_DEVELOPERS' }), { availability: A.DISABLED, reason: 'PROVIDER_NOT_ENABLED' });
  assert.deepEqual(svc.beginLogin({ sessionKey: 'short', provider: 'HYUNDAI_DEVELOPERS' }).reason, 'NO_AUTHENTICATED_SESSION');
});

test('Pleos: a provider withdrawal notice for a VIN survives the owner re-consenting to that VIN through the consent redirect', async () => {
  const pleosRoutes = { 'POST /v1/auth/token': json(PL.token), 'GET /v1/vehicles/consent': json(PL.vehicles), [`GET /v1/vehicles/${PLEOS_VIN}/status`]: json(PL.status) };
  const { service, pleosCalls } = setup({ pleosRoutes, pleosCountry: 'DE' });
  await connect(service, ALICE, 'PLEOS_VEHICLE_DATA', PL.consentRedirect);
  assert.deepEqual(service.handleRevocation({ provider: 'PLEOS_VEHICLE_DATA', body: PL.revoke }), { accepted: true, purged: 1 });
  assert.deepEqual(service.testOnlyRecordConsent({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA', query: PL.consentRedirect }), { consented: true });
  assert.equal(service.testOnlyIsRevoked({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA', providerVehicleId: PLEOS_VIN }), true);
  assert.deepEqual((await service.listVehicles({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA' })).vehicles, []);
  const before = pleosCalls.length;
  const [r] = await service.read({ sessionKey: ALICE, provider: 'PLEOS_VEHICLE_DATA', carscopeVehicleId: 'carscope-vehicle-1', features: ['warning.washer-fluid'] });
  assert.deepEqual([r.availability, r.value], [A.NOT_CONNECTED, null]);
  assert.equal(pleosCalls.filter(c => c.url.endsWith('/status')).length, pleosCalls.slice(0, before).filter(c => c.url.endsWith('/status')).length);
});
