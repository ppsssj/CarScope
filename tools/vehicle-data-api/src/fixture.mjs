// ExternalVehicleDataFixture: the official spec examples (field names, types and example values as published, with the
// documents' own placeholder ids) and a fake fetch that serves them. Tests and the MOCK page use this; nothing here touches a network.
// Ids below are the spec's example ids, not any real account or vehicle.

export const HYUNDAI_EXAMPLES = Object.freeze({
  token: { access_token: 'fixture-access-token-0001', token_type: 'Bearer', refresh_token: 'fixture-refresh-token-0001', expires_in: 7200 },
  refresh: { access_token: 'fixture-access-token-0002', token_type: 'Bearer', expires_in: 7200 },
  deleteToken: { access_token: 'fixture-access-token-0002' },
  carlist: { cars: [{ carId: '123e4567-c0a8-4af7-b8e5-262ea1f6aab4', carNickname: 'my sonata', carType: 'GN', carName: 'LF', carSellname: 'Sonata' }], msgId: '714dd6b9-af57-4c25-9630-0f0eef9175f9' },
  odometer: { msgId: '5db9fc02-1b36-448e-9307-52761fd9ad92', odometers: [{ date: '20190821', unit: 1, value: 12320, timestamp: '20200114152139' }] },
  dte: { timestamp: '20200114152139', value: 32.3, unit: 1, msgId: '714dd6b9-af57-4c25-9630-0f0eef9175f9' },
  evBattery: { soc: 100, timestamp: '20200701101011', msgId: 'bc0b86cb-f9bc-4013-b9ca-e353894a341a' },
  evCharging: { batteryPlugin: 1, batteryCharge: true, soc: 51, targetSOC: { plugType: 0, targetSOClevel: 80 }, remainTime: { value: 17, unit: 1 }, timestamp: '20200701101011', msgId: 'bc0b86cb-f9bc-4013-b9ca-e353894a341a' },
  warningOff: { status: false, msgId: '714dd6b9-af57-4c25-9630-0f0eef9175f9' },
  warningOn: { status: true, msgId: '714dd6b9-af57-4c25-9630-0f0eef9175f9' },
  termReject: { msgId: '11e77efa-aff0-4b3c-a5a0-c4cde4674963' },
  error4002: { errId: '123e4567-e89b-12d3-a456-426655440000', errCode: '4002', errMsg: 'Invalid request body' },
  error4045: { errId: '123e4567-e89b-12d3-a456-426655440000', errCode: '4045', errMsg: 'No data' },
  revokeVehicle: { type: 'vehicle', action: 'delete', carId: '123e4567-c0a8-4af7-b8e5-262ea1f6aab4' },
  revokeAgreement: { type: 'agreement', action: 'reject', carId: '123e4567-c0a8-4af7-b8e5-262ea1f6aab4' },
  revokeAccount: { type: 'account', action: 'delete', userId: '11e77efa-aff0-4b3c-a5a0-c4cde4674963' },
  consentRedirect: { userId: '11e77efa-aff0-4b3c-a5a0-c4cde4674963' },
});
export const HYUNDAI_CAR_ID = HYUNDAI_EXAMPLES.carlist.cars[0].carId;

const meta = { code: 200, message: 'Success', success: 'true', timestamp: '2025-09-01T00:10:00Z', requestId: 'fixture-request-0001' };
const ok = data => ({ data, meta });
// get-vehicles example vin is "TEST111111111TEST"; letters I/O/Q are not used in VINs, so this one passes the 17-character check.
export const PLEOS_VIN = 'TEST111111111TEST';
export const PLEOS_EXAMPLES = Object.freeze({
  token: ok({ accessToken: 'fixture-pleos-access-0001', refreshToken: 'fixture-pleos-refresh-0001' }),
  refresh: ok({ accessToken: 'fixture-pleos-access-0002', refreshToken: 'fixture-pleos-refresh-0002' }),
  vehicles: ok({ vehicles: [{ vin: PLEOS_VIN, nickname: 'My Car', name: 'UM(UM)', type: 'GN', sellname: 'Sorento' }] }),
  stopSharing: ok({}),
  status: ok({ doors: [{ left: 'locked', right: 'locked' }, { left: 'locked', right: 'locked' }], hood: 'closed', trunk: 'closed', sunroof: 'closed',
    tire: [{ left: 40, right: 40, unit: 'psi' }, { left: 40, right: 40, unit: 'psi' }], warnings: ['washFluid'],
    climateControl: { mode: 'auto', status: 'on', speed: -1, temperature: { value: 17, unit: 'C' } }, windshield: { defrost: 'off' }, steeringWheelHeat: 'off',
    seats: [{ left: { heat: 'off', ventilation: 'off' }, right: { heat: 'off', ventilation: 'off' } }], outsideTemperature: { value: 30, unit: 'C' }, timestamp: '2025-09-01T09:10:00Z' }),
  batteries: ok({ charge: { plugin: 'connected', status: 'fastCharging', charging: true, stateOfCharge: 30.5, batteryCapacity: 273960,
    targetStateOfCharge: { standard: 100, quick: 100 }, remainTime: 54 }, timestamp: '2025-09-01T00:10:00Z' }),
  driving: ok({ ignition: { status: 'off', ignitionDetails: [{ type: 'ign1', status: 'off' }] }, sleepMode: 'off', odometer: { value: 6549.2, unit: 'km' },
    transmission: { parkingPosition: true }, timestamp: '2025-09-01T00:10:00Z' }),
  powertrains: ok({ engine: { fuelLevel: 0 }, batteries: [{ type: 'main', remainRatio: 30.5 }], distanceToEmpties: [{ type: 'EV', value: '106', unit: 'km' }], timestamp: '2025-09-01T00:10:00Z' }),
  trips: ok({ trips: [{ triggerStartTime: '2025-09-01T10:00:00.000Z', tripLength: 10000 }] }),
  error: code => ({ error: { code, message: 'fixture', details: [], timestamp: '2025-09-01T00:10:00Z', requestId: 'fixture-request-0001' } }),
  consentRedirect: { vehicles: Buffer.from(JSON.stringify([PLEOS_VIN])).toString('base64') },
  revoke: { userIds: ['11e77efa-aff0-4b3c-a5a0-c4cde4674963'], vins: [PLEOS_VIN] },
});

/** A JSON response as a provider would send it. */
export const json = (body, status = 200, headers = {}) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json;charset=UTF-8', ...headers } });

/**
 * Fake fetch. routes: { 'GET /path': spec | (req) => spec } where spec is { status, body, headers } or { hang: true }.
 * Every call is recorded (url, method, headers, body) so tests can prove what was sent, and that nothing was sent.
 */
export function fixtureFetch(routes = {}) {
  const calls = [];
  const fetchImpl = async (href, init = {}) => {
    const url = new URL(href), key = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push({ url: href, method: init.method ?? 'GET', headers: { ...init.headers }, body: init.body ?? null, redirect: init.redirect });
    let spec = routes[key];
    if (typeof spec === 'function') spec = await spec({ url, init });
    if (!spec) spec = json({ error: { code: '404' } }, 404);
    if (spec.hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    if (spec.throws) throw new TypeError('fetch failed');
    return new Response(spec.status >= 300 && spec.status < 400 || spec.status === 204 ? null : spec.body, { status: spec.status, headers: spec.headers ?? {} });
  };
  return { fetchImpl, calls };
}
