// PleosVehicleDataProvider (Pleos Vehicle Data API, business users). Follows document.pleos.ai/api-reference/vehicle-data-api,
// read 2026-11-12. The intro says the API is "현재(2026.8월) 유럽 지역에서만 사용 가능". So a vehicle outside the listed
// countries is refused before any request: a Korean vehicle never reaches api.pleos.ai from here.
// No token revocation endpoint is documented; disconnect uses Stop Data Sharing and then drops the tokens locally.
import { ProviderHttp, HTTP_OUTCOME, pathSegment } from '../http.mjs';
import { Secret, TokenRecord } from '../credentials.mjs';
import { AVAILABILITY as A, FEATURE as F, PROVIDER } from '../model.mjs';
import { pleos, pleosError } from '../normalizer.mjs';

export const PLEOS_ORIGIN = 'https://api.pleos.ai';
const ACCESS_LIFETIME_MS = 3600_000; // get-access-token: "발급 후 1시간"
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/; // get-vehicles: "차량 식별 번호 (17자리)"
export const PLEOS_BRANDS = Object.freeze(['hyundai', 'kia', 'genesis']);
/** FAQ country list (ISO 3166-1 alpha-2; Canary Islands are ES-CN). KR is not on it. */
export const PLEOS_COUNTRIES = Object.freeze(['GR', 'NL', 'NO', 'DK', 'DE', 'RO', 'MD', 'MT', 'BE', 'BA', 'BG', 'RS', 'SE', 'CH', 'ES', 'SK', 'SI', 'IS',
  'IE', 'EE', 'GB', 'AT', 'UA', 'IT', 'GE', 'CZ', 'ES-CN', 'HR', 'CY', 'PT', 'PL', 'FR', 'FI', 'HU']);
export const pleosRegionServed = country => PLEOS_COUNTRIES.includes(country);

/** Feature → documented status call. Trip series (status/data, driving/data) are not used for features: see readTrips. */
export const PLEOS_FEATURE_CALL = Object.freeze({
  [F.ODOMETER]: 'driving', [F.DISTANCE_TO_EMPTY]: 'powertrains',
  [F.EV_STATE_OF_CHARGE]: 'batteries', [F.EV_PLUG]: 'batteries', [F.EV_CHARGING]: 'batteries',
  ...Object.fromEntries([F.TIRE_PRESSURE_FL, F.TIRE_PRESSURE_FR, F.TIRE_PRESSURE_RL, F.TIRE_PRESSURE_RR, F.WARNING_WASHER_FLUID, F.WARNING_BRAKE_FLUID,
    F.WARNING_TIRE_PRESSURE, F.WARNING_TIRE_PRESSURE_FL, F.WARNING_TIRE_PRESSURE_FR, F.WARNING_TIRE_PRESSURE_RL, F.WARNING_TIRE_PRESSURE_RR,
    F.WARNING_HEAD_LAMP, F.WARNING_ENGINE_OIL, F.WARNING_LOW_FUEL, F.WARNING_SMART_KEY_BATTERY].map(f => [f, 'status'])),
});

export function pleosVehicleDataProvider({ clientId, clientSecret, loginRedirectUrl, brand, fetchImpl, timeoutMs } = {}) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(clientId) || !(clientSecret instanceof Secret) || !PLEOS_BRANDS.includes(brand)) throw new Error('PLEOS_NOT_CONFIGURED');
  if (typeof loginRedirectUrl !== 'string' || !/^https:\/\/[^\s#]+$/.test(loginRedirectUrl)) throw new Error('PLEOS_NOT_CONFIGURED');
  const http = new ProviderHttp({ provider: PROVIDER.PLEOS_VEHICLE_DATA, origin: PLEOS_ORIGIN, fetchImpl, timeoutMs, maxBytes: 256 * 1024 });
  const headers = record => ({ Authorization: `Bearer ${record.access.reveal()}`, Brand: brand, 'Content-Type': 'application/json' });
  const fail = res => ({ error: res.outcome === HTTP_OUTCOME.HTTP_ERROR ? pleosError(res.status, res.body) : { availability: A.PROVIDER_ERROR, reason: res.outcome } });
  const validToken = t => typeof t === 'string' && t.length >= 8 && t.length <= 4096 && !/\s/.test(t);
  const ok = body => body?.meta?.code === 200 && body.meta.success === 'true' && body.data && typeof body.data === 'object';

  async function tokenCall(path, json, accountKey, now) {
    const res = await http.request({ method: 'POST', path, headers: { Brand: brand, 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (res.outcome !== HTTP_OUTCOME.OK) return fail(res);
    const d = res.body?.data;
    if (!ok(res.body) || !validToken(d.accessToken) || !validToken(d.refreshToken)) return { error: { availability: A.PROVIDER_ERROR, reason: 'TOKEN_RESPONSE_OUT_OF_CONTRACT' } };
    // The refresh token is single use and rotates: the new one always replaces the old one.
    return { record: new TokenRecord({ provider: PROVIDER.PLEOS_VEHICLE_DATA, accountKey, accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: now + ACCESS_LIFETIME_MS }) };
  }

  return Object.freeze({
    id: PROVIDER.PLEOS_VEHICLE_DATA,
    origin: PLEOS_ORIGIN,
    brand,
    features: Object.freeze(Object.keys(PLEOS_FEATURE_CALL)),
    /** login-api: GET /v1/auth/login?clientId&brand&redirectUrl&state → 302 to redirectUrl?code&state. */
    authorizationUrl(state) { return http.url('/v1/auth/login', { clientId, brand, redirectUrl: loginRedirectUrl, state }).href; },
    /** get-access-token: POST /v1/auth/token { clientId, clientSecret, code, redirectUrl }. */
    async exchangeCode({ code, accountKey, now = Date.now() }) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9._~-]{4,512}$/.test(code)) return { error: { availability: A.AUTH_EXPIRED, reason: 'INVALID_AUTHORIZATION_CODE' } };
      return tokenCall('/v1/auth/token', { clientId, clientSecret: clientSecret.reveal(), code, redirectUrl: loginRedirectUrl }, accountKey, now);
    },
    /** get-access-token-refresh: POST /v1/auth/token-refresh { clientId, clientSecret, refreshToken }. */
    async refresh(record, now = Date.now()) {
      if (!record.refresh) return { error: { availability: A.AUTH_EXPIRED, reason: 'NO_REFRESH_TOKEN' } };
      return tokenCall('/v1/auth/token-refresh', { clientId, clientSecret: clientSecret.reveal(), refreshToken: record.refresh.reveal() }, record.accountKey, now);
    },
    /** No revoke endpoint is documented. Tokens are dropped locally by the service; nothing is called. */
    async revoke() { return { ok: true, localOnly: true }; },
    /**
     * select-vehicles returns data.redirectUrl for the owner's browser, and the documented example carries the access token in
     * it (…&gwToken=Bearer%20<ACCESS_TOKEN>). Handing that URL to a browser exposes the token, so this step is BLOCKED.
     * (request-for-data-sharing also documents this call as GET and select-vehicles as POST; the method is unconfirmed.)
     */
    consentStart() { return { blocked: { availability: A.BLOCKED, reason: 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER' } }; },
    /** Consent redirect: ?vehicles=<Base64 of an array of VINs>&state=… (request-for-data-sharing STEP 2). */
    consentResult(query) {
      try {
        if (typeof query?.vehicles !== 'string' || query.vehicles.length > 4096) throw 0;
        const list = JSON.parse(Buffer.from(query.vehicles, 'base64').toString('utf8'));
        if (!Array.isArray(list) || list.length === 0 || list.length > 50 || !list.every(v => typeof v === 'string' && VIN.test(v))) throw 0;
        return { providerVehicleIds: [...new Set(list)] };
      } catch { return { error: { availability: A.CONSENT_REQUIRED, reason: 'CONSENT_RESULT_OUT_OF_CONTRACT' } }; }
    },
    /** stop-data-sharing: DELETE /v1/vehicles/consent?vin={vin}. Always with a vin: without one it withdraws every vehicle of the brand. */
    async withdrawConsent(record, providerVehicleId) {
      if (typeof providerVehicleId !== 'string' || !VIN.test(providerVehicleId)) throw new Error('VIN_REQUIRED');
      const res = await http.request({ method: 'DELETE', path: '/v1/vehicles/consent', query: { vin: providerVehicleId }, headers: headers(record) });
      return res.outcome === HTTP_OUTCOME.OK && ok(res.body) ? { ok: true } : fail(res.outcome === HTTP_OUTCOME.OK ? { outcome: HTTP_OUTCOME.BAD_RESPONSE } : res);
    },
    /** get-vehicles (business): GET /v1/vehicles/consent → data.vehicles[{ vin, type, nickname, name, sellname }]. */
    async listVehicles(record) {
      const res = await http.request({ path: '/v1/vehicles/consent', headers: headers(record) });
      if (res.outcome !== HTTP_OUTCOME.OK) return fail(res);
      const list = res.body?.data?.vehicles;
      if (!ok(res.body) || !Array.isArray(list) || list.length > 50 || !list.every(v => VIN.test(v?.vin ?? '') && ['GN', 'EV', 'HV', 'PE', 'FV', 'UNKNOWN'].includes(v.type)))
        return { error: { availability: A.PROVIDER_ERROR, reason: 'VEHICLES_OUT_OF_CONTRACT' } };
      return { vehicles: list.map(v => ({ providerVehicleId: v.vin, type: v.type, model: typeof v.sellname === 'string' ? v.sellname.slice(0, 40) : null })) };
    },
    async read(record, providerVehicleId, call, ctx) {
      const vin = pathSegment(providerVehicleId, VIN);
      const path = { status: `/v1/vehicles/${vin}/status`, batteries: `/v1/vehicles/${vin}/batteries`, driving: `/v1/vehicles/${vin}/driving`,
        powertrains: `/v1/vehicles/${vin}/powertrains` }[call];
      if (!path) throw new Error('UNKNOWN_PLEOS_CALL');
      const res = await http.request({ path, headers: headers(record) });
      if (res.outcome !== HTTP_OUTCOME.OK) return fail(res);
      if (!ok(res.body)) return { error: { availability: A.PROVIDER_ERROR, reason: 'ENVELOPE_OUT_OF_CONTRACT' } };
      const readings = call === 'status' ? pleos.vehicleStatus(ctx, res.body) : call === 'batteries' ? pleos.batteryCharging(ctx, res.body)
        : call === 'driving' ? pleos.operationStatus(ctx, res.body) : pleos.powertrainStatus(ctx, res.body);
      return { readings };
    },
    /**
     * get-vehicle-data (/status/data) and get-vehicle-operation-data (/driving/data): per-trip series, at most 7 days.
     * They describe how and where the person drove, which no inspection card needs, so only the envelope is checked and only
     * a trip count leaves this function. Nothing is stored.
     */
    async readTrips(record, providerVehicleId, kind, { startDate, endDate, zoneId = 'UTC' }) {
      const vin = pathSegment(providerVehicleId, VIN);
      const path = { 'vehicle-data': `/v1/vehicles/${vin}/status/data`, 'operation-data': `/v1/vehicles/${vin}/driving/data` }[kind];
      const day = s => typeof s === 'string' && /^\d{8}$/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) : NaN;
      const span = (day(endDate) - day(startDate)) / 86_400_000;
      if (!path || !(span >= 0 && span <= 7) || zoneId !== 'UTC') throw new Error('INVALID_TRIP_QUERY');
      const res = await http.request({ path, query: { startDate, endDate, zoneId }, headers: headers(record) });
      if (res.outcome !== HTTP_OUTCOME.OK) return fail(res);
      if (!ok(res.body) || !Array.isArray(res.body.data.trips)) return { error: { availability: A.PROVIDER_ERROR, reason: 'TRIPS_OUT_OF_CONTRACT' } };
      return { tripCount: res.body.data.trips.length };
    },
    /** notify-data-sharing-consent-withdraw body: { userIds: [UUID], vins: [vin] }. No sender authentication is documented. */
    parseRevocation(body) {
      if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['userIds', 'vins'].includes(k))) return null;
      const vins = Array.isArray(body.vins) ? body.vins.filter(v => typeof v === 'string' && VIN.test(v)) : [];
      const users = Array.isArray(body.userIds) ? body.userIds.filter(u => typeof u === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(u)) : [];
      return vins.length || users.length ? { providerVehicleIds: vins, providerUserIds: users } : null;
    },
  });
}
