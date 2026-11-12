// Common model and availability gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reading, emptyReading, computable, AVAILABILITY as A, QUALITY as Q } from '../src/model.mjs';
import { vehicleDataAvailability } from '../src/availability.mjs';
import { TestOnlyMemoryTokenStore } from '../src/credentials.mjs';
import { fixtureFetch } from '../src/fixture.mjs';

const base = { provider: 'HYUNDAI_DEVELOPERS', featureId: 'odometer', vehicleBinding: 'vb_fixture_binding_0001', source: 'EXTERNAL_REST', fetchedAt: '2026-11-12T01:00:00Z' };

test('a reading keeps observedAt, fetchedAt, unit and quality honest', () => {
  const ok = reading({ ...base, availability: A.RECEIVED, value: 1, unit: 'km', dataQuality: Q.DOCUMENTED, observedAt: '2026-11-12T00:59:00Z', observedAtRaw: '2026-11-12T00:59:00Z', observedAtZone: 'UTC' });
  assert.ok(Object.isFrozen(ok)); assert.equal(computable(ok), true);
  const bad = [
    { availability: A.RECEIVED, value: null, dataQuality: Q.DOCUMENTED },                     // received without a value
    { availability: A.NO_DATA, value: 3, unit: 'km', dataQuality: Q.DOCUMENTED },              // a value in a failure state
    { availability: A.RECEIVED, value: 3, unit: 'furlong', dataQuality: Q.DOCUMENTED },        // unknown unit
    { availability: A.RECEIVED, value: NaN, dataQuality: Q.DOCUMENTED },
    { availability: A.RECEIVED, value: 3, dataQuality: Q.NONE },
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, observedAt: '20200114152139', observedAtZone: 'UNSPECIFIED' }, // unzoned text as an instant
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, observedAt: '2026-11-12T00:59:00Z' },                             // instant without zone
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, source: 'PLEOS' },        // REST cannot claim the SDK source
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, fetchedAt: 'now' },
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, vehicleBinding: '123e4567-c0a8-4af7-b8e5-262ea1f6aab4' }, // a provider carId
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, featureId: 'brake.pad-wear' },
    { availability: A.RECEIVED, value: 3, dataQuality: Q.DOCUMENTED, raw: {} },
    { availability: A.RECEIVED, value: 3, dataQuality: Q.MOCK },                                 // MOCK quality on a REST source
  ];
  for (const b of bad) assert.throws(() => reading({ ...base, ...b }), /INVALID_READING/, JSON.stringify(b));
  const empty = emptyReading(base, A.CONSENT_REQUIRED, 'PLEOS_5006');
  assert.deepEqual([empty.value, empty.unit, empty.observedAt, empty.dataQuality, computable(empty)], [null, null, null, Q.NONE, false]);
  assert.equal(computable(reading({ ...base, availability: A.RECEIVED, value: 1, unit: null, dataQuality: Q.DOCUMENTED })), false);
});

const full = {
  CARSCOPE_HYUNDAI_DEVELOPERS_APPROVAL: 'OPERATOR_APPROVED', HYUNDAI_DEVELOPERS_CLIENT_ID: 'fixture-client-id', HYUNDAI_DEVELOPERS_CLIENT_SECRET: 'fixture-secret',
  HYUNDAI_DEVELOPERS_REDIRECT_URI: 'https://carscope.example/oauth/hyundai',
  CARSCOPE_PLEOS_VEHICLE_DATA_APPROVAL: 'OPERATOR_APPROVED', PLEOS_VEHICLE_DATA_CLIENT_ID: 'fixture-client-id', PLEOS_VEHICLE_DATA_CLIENT_SECRET: 'fixture-secret',
  PLEOS_VEHICLE_DATA_LOGIN_REDIRECT_URL: 'https://carscope.example/oauth/pleos', PLEOS_VEHICLE_DATA_BRAND: 'hyundai', CARSCOPE_PLEOS_VEHICLE_DATA_COUNTRY: 'KR',
};
const states = x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, [v.availability, v.reason, v.provider !== null]]));

test('availability: DISABLED by default, then NOT_CONFIGURED, REGION_UNSUPPORTED and BLOCKED; never connected today; no request', () => {
  const f = fixtureFetch();
  assert.deepEqual(states(vehicleDataAvailability({}, { fetchImpl: f.fetchImpl })), {
    HYUNDAI_DEVELOPERS: [A.DISABLED, 'NO_OPERATOR_APPROVAL', false], PLEOS_VEHICLE_DATA: [A.DISABLED, 'NO_OPERATOR_APPROVAL', false] });
  assert.deepEqual(states(vehicleDataAvailability({ CARSCOPE_HYUNDAI_DEVELOPERS_APPROVAL: 'yes' })).HYUNDAI_DEVELOPERS, [A.DISABLED, 'APPROVAL_VALUE_NOT_RECOGNIZED', false]);
  assert.deepEqual(states(vehicleDataAvailability({ CARSCOPE_HYUNDAI_DEVELOPERS_APPROVAL: 'OPERATOR_APPROVED' })).HYUNDAI_DEVELOPERS, [A.NOT_CONFIGURED, 'DEVELOPER_PROJECT_CREDENTIALS_MISSING', false]);
  assert.deepEqual(states(vehicleDataAvailability({ ...full, HYUNDAI_DEVELOPERS_REDIRECT_URI: 'http://carscope.example/cb' })).HYUNDAI_DEVELOPERS[0], A.NOT_CONFIGURED);
  assert.deepEqual(states(vehicleDataAvailability(full, { fetchImpl: f.fetchImpl })), {
    HYUNDAI_DEVELOPERS: [A.BLOCKED, 'TOKEN_STORE_MISSING', false], PLEOS_VEHICLE_DATA: [A.REGION_UNSUPPORTED, 'PLEOS_VEHICLE_DATA_EUROPE_ONLY', false] });
  assert.deepEqual(states(vehicleDataAvailability(full, { tokenStore: new TestOnlyMemoryTokenStore({}) })).HYUNDAI_DEVELOPERS, [A.BLOCKED, 'TOKEN_STORE_NOT_APPROVED', false]);
  // Even a test store in test mode stops at the consent page that needs the token in the browser.
  assert.deepEqual(states(vehicleDataAvailability({ ...full, CARSCOPE_PLEOS_VEHICLE_DATA_COUNTRY: 'DE' }, { tokenStore: new TestOnlyMemoryTokenStore({}), testMode: true })), {
    HYUNDAI_DEVELOPERS: [A.BLOCKED, 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER', false], PLEOS_VEHICLE_DATA: [A.BLOCKED, 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER', false] });
  assert.equal(f.calls.length, 0);
});
