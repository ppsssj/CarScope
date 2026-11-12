// Contract tests against the official spec examples (MOCK_PASS: no live provider call).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { hyundaiDevelopersProvider, HYUNDAI_FEATURE_CALL } from '../src/providers/hyundai-developers.mjs';
import { pleosVehicleDataProvider, PLEOS_FEATURE_CALL, pleosRegionServed } from '../src/providers/pleos-vehicle-data.mjs';
import { Secret, TokenRecord } from '../src/credentials.mjs';
import { FEATURE as F, AVAILABILITY as A } from '../src/model.mjs';
import { fixtureFetch, json, HYUNDAI_EXAMPLES as H, HYUNDAI_CAR_ID, PLEOS_EXAMPLES as PL, PLEOS_VIN } from '../src/fixture.mjs';

const ctx = { vehicleBinding: 'vb_fixture_binding_0001', fetchedAt: '2026-11-12T01:00:00Z', mock: false };
const hyundai = routes => { const f = fixtureFetch(routes); return { p: hyundaiDevelopersProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'),
  redirectUri: 'https://carscope.example/oauth/hyundai', fetchImpl: f.fetchImpl }), calls: f.calls }; };
const pleos = routes => { const f = fixtureFetch(routes); return { p: pleosVehicleDataProvider({ clientId: 'fixture-client-id', clientSecret: new Secret('fixture-client-secret'),
  loginRedirectUrl: 'https://carscope.example/oauth/pleos', brand: 'hyundai', fetchImpl: f.fetchImpl }), calls: f.calls }; };
const record = (provider, refresh = 'fixture-refresh-0001') => new TokenRecord({ provider, accountKey: 'acct_fixture', accessToken: 'fixture-access-0001', refreshToken: refresh, expiresAt: Date.now() + 3600_000 });
const byFeature = rs => Object.fromEntries(rs.map(r => [r.featureId, r]));

test('Hyundai: login URL is the documented authorize endpoint with exactly response_type, client_id, redirect_uri, state', () => {
  const { p } = hyundai({});
  const u = new URL(p.authorizationUrl('S'.repeat(43)));
  assert.equal(u.origin + u.pathname, 'https://prd.kr-ccapi.hyundai.com/api/v1/user/oauth2/authorize');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'response_type', 'state']);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.ok(!u.href.includes('fixture-client-secret'));
});

test('Hyundai: token issue / refresh / delete send Basic client credentials and the documented form, and never print tokens', async () => {
  const { p, calls } = hyundai({ 'POST /api/v1/user/oauth2/token': ({ init }) => {
    const form = new URLSearchParams(init.body);
    return json(form.get('grant_type') === 'authorization_code' ? H.token : form.get('grant_type') === 'refresh_token' ? H.refresh : H.deleteToken);
  } });
  const issued = await p.exchangeCode({ code: 'A1B2C3', accountKey: 'acct_x', now: 1_000 });
  assert.equal(issued.record.access.reveal(), H.token.access_token);
  assert.equal(issued.record.expiresAt, 1_000 + 7200 * 1000);
  assert.equal(calls[0].headers.Authorization, 'Basic ' + Buffer.from('fixture-client-id:fixture-client-secret').toString('base64'));
  assert.equal(calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), { grant_type: 'authorization_code', code: 'A1B2C3', redirect_uri: 'https://carscope.example/oauth/hyundai' });
  const refreshed = await p.refresh(issued.record, 2_000);
  assert.equal(refreshed.record.access.reveal(), H.refresh.access_token);
  assert.equal(refreshed.record.refresh.reveal(), H.token.refresh_token, 'refresh response has no refresh_token in the spec, so the old one is kept');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].body)), { grant_type: 'refresh_token', refresh_token: H.token.refresh_token, redirect_uri: 'https://carscope.example/oauth/hyundai' });
  assert.deepEqual(await p.revoke(refreshed.record), { ok: true });
  assert.equal(new URLSearchParams(calls[2].body).get('grant_type'), 'delete');
  for (const shown of [JSON.stringify(issued.record), String(issued.record), inspect(issued.record), inspect(new Secret('fixture-client-secret')), JSON.stringify({ s: new Secret('x-secret-x') })])
    assert.ok(!/fixture-access|YDBRI|fixture-client-secret|x-secret-x/.test(shown), shown);
});

test('Hyundai: token errors and malformed token bodies never produce a record', async () => {
  const { p } = hyundai({ 'POST /api/v1/user/oauth2/token': json(H.error4002, 400) });
  assert.deepEqual((await p.exchangeCode({ code: 'A1B2C3', accountKey: 'a' })).error, { availability: A.PROVIDER_ERROR, reason: 'HYUNDAI_4002' });
  assert.equal((await p.exchangeCode({ code: 'bad code', accountKey: 'a' })).error.reason, 'INVALID_AUTHORIZATION_CODE');
  const { p: odd } = hyundai({ 'POST /api/v1/user/oauth2/token': json({ access_token: 'x y', token_type: 'Bearer' }) });
  assert.equal((await odd.exchangeCode({ code: 'A1B2C3', accountKey: 'a' })).error.reason, 'TOKEN_RESPONSE_OUT_OF_CONTRACT');
  const { p: expired } = hyundai({ 'POST /api/v1/user/oauth2/token': json(H.error4002, 401) });
  assert.equal((await expired.refresh(record('HYUNDAI_DEVELOPERS'))).error.availability, A.AUTH_EXPIRED);
});

test('Hyundai: car list keeps only id, type and sell name (no nickname, no internal model code)', async () => {
  const { p, calls } = hyundai({ 'GET /api/v1/car/profile/carlist': json(H.carlist) });
  assert.deepEqual(await p.listVehicles(record('HYUNDAI_DEVELOPERS')), { vehicles: [{ providerVehicleId: HYUNDAI_CAR_ID, type: 'GN', model: 'Sonata' }] });
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-access-0001');
  const { p: none } = hyundai({ 'GET /api/v1/car/profile/carlist': json(H.error4045, 404) });
  assert.deepEqual((await none.listVehicles(record('HYUNDAI_DEVELOPERS'))).error, { availability: A.NO_DATA, reason: 'HYUNDAI_4045' });
  const { p: bad } = hyundai({ 'GET /api/v1/car/profile/carlist': json({ cars: [{ carId: '../../x', carType: 'EV' }] }) });
  assert.equal((await bad.listVehicles(record('HYUNDAI_DEVELOPERS'))).error.reason, 'CARLIST_OUT_OF_CONTRACT');
});

test('Hyundai: every documented data call maps to its spec path and normalizes the example', async () => {
  const base = `/api/v1/car/status/${HYUNDAI_CAR_ID}`, w = `/api/v1/car/status/warning/${HYUNDAI_CAR_ID}`;
  const { p, calls } = hyundai({ [`GET ${base}/odometer`]: json(H.odometer), [`GET ${base}/dte`]: json(H.dte), [`GET ${base}/ev/battery`]: json(H.evBattery),
    [`GET ${base}/ev/charging`]: json(H.evCharging), [`GET ${w}/washerFluid`]: json(H.warningOn), [`GET ${w}/breakOil`]: json(H.warningOff),
    [`GET ${w}/tirePressure`]: json(H.warningOff), [`GET ${w}/lampWire`]: json(H.warningOn), [`GET ${w}/engineOil`]: json(H.warningOff),
    [`GET ${w}/smartKeyBattery`]: json(H.warningOn), [`GET ${w}/lowFuel`]: json(H.warningOff) });
  const rec = record('HYUNDAI_DEVELOPERS'), all = [];
  for (const call of new Set(Object.values(HYUNDAI_FEATURE_CALL))) all.push(...(await p.read(rec, HYUNDAI_CAR_ID, call, ctx)).readings);
  const r = byFeature(all);
  assert.equal(calls.length, 11);
  assert.deepEqual([r.odometer.value, r.odometer.unit, r.odometer.observedAt, r.odometer.observedAtRaw, r.odometer.observedAtZone, r.odometer.dataQuality],
    [12320, 'km', null, '20200114152139', 'UNSPECIFIED', 'DOCUMENTED']);
  assert.deepEqual([r['distance-to-empty'].value, r['distance-to-empty'].unit], [32.3, 'km']);
  assert.deepEqual([r['ev.state-of-charge'].value, r['ev.state-of-charge'].unit], [100, 'percent']);
  assert.deepEqual([r['ev.plug'].value, r['ev.charging'].value], ['FAST_CHARGER_CONNECTED', true]);
  assert.deepEqual([r['warning.washer-fluid'].value, r['warning.brake-fluid'].value, r['warning.tire-pressure'].value], [true, false, false]);
  assert.equal(r['warning.washer-fluid'].observedAt, null, 'warnings have no timestamp in the spec; none is invented');
  assert.equal(r['warning.washer-fluid'].reason, 'PROVIDER_SENDS_NO_TIMESTAMP');
  for (const x of all) { assert.equal(x.source, 'EXTERNAL_REST'); assert.equal(x.fetchedAt, ctx.fetchedAt); assert.equal(x.vehicleBinding, ctx.vehicleBinding); }
  // Per-wheel pressure, head lamps and vehicle spec have no Hyundai API in the spec.
  for (const f of [F.TIRE_PRESSURE_FL, F.WARNING_TIRE_PRESSURE_FL, F.WARNING_HEAD_LAMP]) assert.equal(HYUNDAI_FEATURE_CALL[f], undefined);
});

test('Hyundai: values outside the documented contract carry no value', async () => {
  const base = `/api/v1/car/status/${HYUNDAI_CAR_ID}`;
  const cases = { odometer: [{ odometers: [] }, { odometers: [H.odometer.odometers[0], H.odometer.odometers[0]] }, { odometers: [{ ...H.odometer.odometers[0], unit: 7 }] }, { odometers: [{ ...H.odometer.odometers[0], value: -1 }] }],
    'ev/battery': [{ soc: 101 }, { soc: '50' }], dte: [{ value: 3, unit: 9 }] };
  for (const [path, bodies] of Object.entries(cases)) for (const body of bodies) {
    const { p } = hyundai({ [`GET ${base}/${path}`]: json(body) });
    const [x] = (await p.read(record('HYUNDAI_DEVELOPERS'), HYUNDAI_CAR_ID, { odometer: 'odometer', 'ev/battery': 'ev-battery', dte: 'dte' }[path], ctx)).readings;
    assert.equal(x.value, null, JSON.stringify(body)); assert.ok([A.NO_DATA, A.INVALID_VALUE].includes(x.availability)); assert.equal(x.dataQuality, 'NONE');
  }
  const { p } = hyundai({});
  await assert.rejects(() => p.read(record('HYUNDAI_DEVELOPERS'), '../carlist', 'odometer', ctx), /INVALID_PATH_SEGMENT/);
  await assert.rejects(() => p.read(record('HYUNDAI_DEVELOPERS'), HYUNDAI_CAR_ID, 'warning:../../profile', ctx), /UNKNOWN_HYUNDAI_CALL/);
});

test('Hyundai: consent page is BLOCKED (token would go to the browser); redirect result and withdrawal callback are parsed strictly', () => {
  const { p } = hyundai({});
  assert.deepEqual(p.consentStart(), { blocked: { availability: A.BLOCKED, reason: 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER' } });
  assert.deepEqual(p.consentResult(H.consentRedirect), { providerUserId: H.consentRedirect.userId });
  assert.equal(p.consentResult({ errCode: '4046' }).error.availability, A.NO_DATA);
  assert.equal(p.consentResult({ userId: '<script>' }).error.availability, A.CONSENT_REQUIRED);
  assert.deepEqual(p.parseRevocation(H.revokeAgreement), { providerVehicleIds: [HYUNDAI_CAR_ID], providerUserIds: [] });
  assert.deepEqual(p.parseRevocation(H.revokeAccount), { providerVehicleIds: [], providerUserIds: [H.revokeAccount.userId] });
  for (const bad of [null, {}, { type: 'vehicle', action: 'delete' }, { ...H.revokeVehicle, extra: 1 }, { ...H.revokeVehicle, type: 'x' }]) assert.equal(p.parseRevocation(bad), null);
});

test('Pleos: login, token and refresh follow the spec; the refresh token rotates', async () => {
  const { p, calls } = pleos({ 'POST /v1/auth/token': json(PL.token), 'POST /v1/auth/token-refresh': json(PL.refresh) });
  const u = new URL(p.authorizationUrl('S'.repeat(43)));
  assert.equal(u.origin + u.pathname, 'https://api.pleos.ai/v1/auth/login');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['brand', 'clientId', 'redirectUrl', 'state']);
  const issued = await p.exchangeCode({ code: 'AUTHCODE', accountKey: 'acct_x', now: 0 });
  assert.equal(issued.record.expiresAt, 3600_000);
  assert.equal(calls[0].headers.Brand, 'hyundai');
  assert.deepEqual(JSON.parse(calls[0].body), { clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret', code: 'AUTHCODE', redirectUrl: 'https://carscope.example/oauth/pleos' });
  const next = await p.refresh(issued.record, 10);
  assert.deepEqual(JSON.parse(calls[1].body), { clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret', refreshToken: 'fixture-pleos-refresh-0001' });
  assert.equal(next.record.refresh.reveal(), 'fixture-pleos-refresh-0002');
  const { p: used } = pleos({ 'POST /v1/auth/token-refresh': json(PL.error('4009'), 400) });
  assert.deepEqual((await used.refresh(issued.record)).error, { availability: A.AUTH_EXPIRED, reason: 'PLEOS_4009' });
  assert.deepEqual(await p.revoke(), { ok: true, localOnly: true }, 'no revoke endpoint is documented');
});

test('Pleos: status example → per-wheel pressure with the documented conversion and warnings as reported/not reported', async () => {
  const path = `GET /v1/vehicles/${PLEOS_VIN}/status`;
  const { p, calls } = pleos({ [path]: json(PL.status) });
  const r = byFeature((await p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'status', ctx)).readings);
  assert.equal(calls[0].headers.Brand, 'hyundai');
  assert.deepEqual([r['tire.pressure.front-left'].value, r['tire.pressure.front-left'].unit, r['tire.pressure.front-left'].observedAt, r['tire.pressure.front-left'].observedAtZone], [40, 'psi', '2025-09-01T09:10:00Z', 'UTC']);
  assert.deepEqual([r['warning.washer-fluid'].value, r['warning.brake-fluid'].value, r['warning.tire-pressure'].value, r['warning.tire-pressure.rear-right'].value], [true, false, false, false]);
  const conv = async (unit, raw) => byFeature((await pleos({ [path]: json({ ...PL.status, data: { ...PL.status.data, tire: [{ left: raw, right: 255, unit }, { left: null, right: raw, unit }] } }) })
    .p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'status', ctx)).readings);
  const kpa = await conv('kpa', 72), bar = await conv('bar', 36);
  assert.equal(kpa['tire.pressure.front-left'].value, 360); assert.equal(bar['tire.pressure.front-left'].value, 3.6);
  assert.deepEqual([kpa['tire.pressure.front-right'].availability, kpa['tire.pressure.front-right'].reason], [A.INVALID_VALUE, 'PLEOS_255_INVALID']);
  assert.equal(kpa['tire.pressure.rear-left'].availability, A.FEATURE_UNSUPPORTED);
  const low = byFeature((await pleos({ [path]: json({ ...PL.status, data: { ...PL.status.data, warnings: ['tirePressureLow'] } }) }).p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'status', ctx)).readings);
  assert.equal(low['warning.tire-pressure'].value, true);
  assert.deepEqual([low['warning.tire-pressure.front-left'].availability, low['warning.tire-pressure.front-left'].reason], [A.FEATURE_UNSUPPORTED, 'VEHICLE_WARNING_NOT_PER_WHEEL']);
  const odd = byFeature((await pleos({ [path]: json({ ...PL.status, data: { ...PL.status.data, warnings: ['washFluid', 'somethingNew'] } }) }).p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'status', ctx)).readings);
  assert.equal(odd['warning.washer-fluid'].availability, A.INVALID_VALUE, 'an undocumented warning name invalidates the list rather than being ignored');
});

test('Pleos: batteries, operation status and powertrain examples; invalid markers and ambiguities carry no value', async () => {
  const v = `/v1/vehicles/${PLEOS_VIN}`;
  const { p } = pleos({ [`GET ${v}/batteries`]: json(PL.batteries), [`GET ${v}/driving`]: json(PL.driving), [`GET ${v}/powertrains`]: json(PL.powertrains) });
  const rec = record('PLEOS_VEHICLE_DATA');
  const r = byFeature([...(await p.read(rec, PLEOS_VIN, 'batteries', ctx)).readings, ...(await p.read(rec, PLEOS_VIN, 'driving', ctx)).readings, ...(await p.read(rec, PLEOS_VIN, 'powertrains', ctx)).readings]);
  assert.deepEqual([r['ev.plug'].value, r['ev.charging'].value, r['ev.state-of-charge'].value, r['ev.state-of-charge'].unit], ['CONNECTED', true, 30.5, 'percent']);
  assert.deepEqual([r.odometer.value, r.odometer.unit, r.odometer.observedAt], [6549.2, 'km', '2025-09-01T00:10:00Z']);
  assert.deepEqual([r['distance-to-empty'].value, r['distance-to-empty'].unit], [106, 'km']);
  const one = async (call, data) => (await pleos({ [`GET ${v}/${call}`]: json({ ...PL[call], data: { ...PL[call].data, ...data } }) }).p.read(rec, PLEOS_VIN, call, ctx)).readings;
  assert.equal((await one('batteries', { charge: { ...PL.batteries.data.charge, stateOfCharge: 255 } })).find(x => x.featureId === 'ev.state-of-charge').reason, 'PLEOS_255_INVALID');
  assert.equal((await one('driving', { odometer: { value: 1, unit: 'invalid' } }))[0].reason, 'PLEOS_INVALID');
  assert.equal((await one('driving', { odometer: { value: 1, unit: 'miles' } }))[0].availability, A.INVALID_VALUE, 'Operation Status documents "mile"');
  assert.equal((await one('driving', { odometer: null }))[0].reason, 'PROVIDER_NULL_NOT_COLLECTED');
  assert.equal((await one('powertrains', { distanceToEmpties: [{ type: 'EV', value: '1', unit: 'km' }, { type: 'ICE', value: '2', unit: 'km' }] }))[0].reason, 'DTE_MULTIPLE_ENTRIES_UNSPECIFIED');
  assert.equal((await one('powertrains', { distanceToEmpties: [{ type: 'EV', value: '5000', unit: 'km' }] }))[0].availability, A.INVALID_VALUE);
});

test('Pleos: documented error codes map to distinct states', async () => {
  const path = `GET /v1/vehicles/${PLEOS_VIN}/driving`;
  const expect = { 4011: A.AUTH_EXPIRED, 40002: A.AUTH_EXPIRED, 5006: A.CONSENT_REQUIRED, 4101: A.CONSENT_REQUIRED, 4045: A.NO_DATA, 403: A.PROVIDER_ERROR, 5001: A.PROVIDER_ERROR };
  for (const [code, availability] of Object.entries(expect)) {
    const { p } = pleos({ [path]: json(PL.error(code), code === '4045' ? 404 : code === '5001' ? 500 : 400) });
    assert.deepEqual((await p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'driving', ctx)).error, { availability, reason: `PLEOS_${code}` }, code);
  }
  const { p } = pleos({ [path]: json({}, 429) });
  assert.deepEqual((await p.read(record('PLEOS_VEHICLE_DATA'), PLEOS_VIN, 'driving', ctx)).error, { availability: A.RATE_LIMITED, reason: 'HTTP_429' });
});

test('Pleos: vehicles, consent redirect, stop sharing (always with a VIN), trips (≤7 days, count only) and withdrawal callback', async () => {
  const { p, calls } = pleos({ 'GET /v1/vehicles/consent': json(PL.vehicles), 'DELETE /v1/vehicles/consent': json(PL.stopSharing),
    [`GET /v1/vehicles/${PLEOS_VIN}/driving/data`]: json(PL.trips) });
  const rec = record('PLEOS_VEHICLE_DATA');
  assert.deepEqual(await p.listVehicles(rec), { vehicles: [{ providerVehicleId: PLEOS_VIN, type: 'GN', model: 'Sorento' }] });
  assert.deepEqual(p.consentResult(PL.consentRedirect), { providerVehicleIds: [PLEOS_VIN] });
  assert.equal(p.consentResult({ vehicles: 'not-base64-json' }).error.availability, A.CONSENT_REQUIRED);
  assert.deepEqual(p.consentStart().blocked.reason, 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER');
  await assert.rejects(() => p.withdrawConsent(rec), /VIN_REQUIRED/);
  assert.deepEqual(await p.withdrawConsent(rec, PLEOS_VIN), { ok: true });
  assert.equal(new URL(calls.at(-1).url).search, `?vin=${PLEOS_VIN}`);
  assert.deepEqual(await p.readTrips(rec, PLEOS_VIN, 'operation-data', { startDate: '20250901', endDate: '20250908' }), { tripCount: 1 });
  await assert.rejects(() => p.readTrips(rec, PLEOS_VIN, 'operation-data', { startDate: '20250901', endDate: '20250909' }), /INVALID_TRIP_QUERY/);
  assert.deepEqual(p.parseRevocation(PL.revoke), { providerVehicleIds: [PLEOS_VIN], providerUserIds: PL.revoke.userIds });
  assert.equal(p.parseRevocation({ vins: ['short'] }), null);
});

test('Pleos region: only the FAQ country list; Korea is not served', () => {
  assert.equal(pleosRegionServed('KR'), false);
  assert.equal(pleosRegionServed(undefined), false);
  assert.equal(pleosRegionServed('DE'), true);
  assert.equal(PLEOS_FEATURE_CALL[F.WARNING_LAMP_WIRE], undefined);
});
