// HyundaiDevelopersProvider (KR, Hyundai Developers Data API). Paths, parameters and fields follow the official spec pages
// (developers.hyundai.com/web/v1/hyundai/specification/...), read 2026-11-12. The spec states only the production host
// prd.kr-ccapi.hyundai.com; the guide's sample uses dev.kr-ccapi.hyundai.com without describing it, so it is not allowed.
// Server side only: client secret and tokens never leave this module except as Authorization headers to the fixed origin.
import { ProviderHttp, HTTP_OUTCOME, pathSegment } from '../http.mjs';
import { Secret, TokenRecord } from '../credentials.mjs';
import { AVAILABILITY as A, FEATURE as F, PROVIDER } from '../model.mjs';
import { hyundai, hyundaiError, HYUNDAI_WARNINGS } from '../normalizer.mjs';

export const HYUNDAI_ORIGIN = 'https://prd.kr-ccapi.hyundai.com';
const ACCESS_LIFETIME_MS = 24 * 3600_000; // account_token: "access_token은 발급 후 24시간" (used only when expires_in is absent)
const CAR_ID = /^[A-Za-z0-9-]{8,64}$/;    // "당사 발급 차량 고유 식별자"; the examples are UUIDs. Anything else is refused before a request.

/** Feature → the one documented call that answers it. Absent = no Hyundai API (e.g. per-wheel tire pressure). */
export const HYUNDAI_FEATURE_CALL = Object.freeze({
  [F.ODOMETER]: 'odometer', [F.DISTANCE_TO_EMPTY]: 'dte', [F.EV_STATE_OF_CHARGE]: 'ev-battery',
  [F.EV_PLUG]: 'ev-charging', [F.EV_CHARGING]: 'ev-charging',
  ...Object.fromEntries(Object.entries(HYUNDAI_WARNINGS).map(([path, f]) => [f, `warning:${path}`])),
});

export function hyundaiDevelopersProvider({ clientId, clientSecret, redirectUri, fetchImpl, timeoutMs } = {}) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(clientId) || !(clientSecret instanceof Secret)) throw new Error('HYUNDAI_NOT_CONFIGURED');
  if (typeof redirectUri !== 'string' || !/^https:\/\/[^\s#]+$/.test(redirectUri) || new URL(redirectUri).protocol !== 'https:') throw new Error('HYUNDAI_NOT_CONFIGURED');
  const http = new ProviderHttp({ provider: PROVIDER.HYUNDAI_DEVELOPERS, origin: HYUNDAI_ORIGIN, fetchImpl, timeoutMs });
  const basic = () => 'Basic ' + Buffer.from(`${clientId}:${clientSecret.reveal()}`, 'utf8').toString('base64');
  const bearer = record => ({ Authorization: `Bearer ${record.access.reveal()}` });

  async function token(form) {
    const res = await http.request({ method: 'POST', path: '/api/v1/user/oauth2/token',
      headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    if (res.outcome !== HTTP_OUTCOME.OK) return { error: res.outcome === HTTP_OUTCOME.HTTP_ERROR ? hyundaiError(res.status, res.body) : { availability: A.PROVIDER_ERROR, reason: res.outcome } };
    return { body: res.body };
  }
  const expiresAt = (now, s) => {
    const n = typeof s === 'number' ? s : typeof s === 'string' && /^[1-9][0-9]{0,8}$/.test(s) ? Number(s) : null; // documented "string", example number
    return now + (Number.isSafeInteger(n) && n > 0 ? n * 1000 : ACCESS_LIFETIME_MS);
  };
  const validToken = t => typeof t === 'string' && t.length >= 8 && t.length <= 4096 && !/[\s]/.test(t);

  return Object.freeze({
    id: PROVIDER.HYUNDAI_DEVELOPERS,
    origin: HYUNDAI_ORIGIN,
    features: Object.freeze(Object.keys(HYUNDAI_FEATURE_CALL)),
    /** account_authorize: the browser goes here; the code comes back to redirectUri with the same state. */
    authorizationUrl(state) {
      return http.url('/api/v1/user/oauth2/authorize', { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state }).href;
    },
    /** account_token grant_type=authorization_code. */
    async exchangeCode({ code, accountKey, now = Date.now() }) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9._~-]{4,512}$/.test(code)) return { error: { availability: A.AUTH_EXPIRED, reason: 'INVALID_AUTHORIZATION_CODE' } };
      const r = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if (r.error) return r;
      if (!validToken(r.body?.access_token) || (r.body.refresh_token !== undefined && !validToken(r.body.refresh_token)) ||
          (r.body.token_type !== undefined && r.body.token_type !== 'Bearer')) return { error: { availability: A.PROVIDER_ERROR, reason: 'TOKEN_RESPONSE_OUT_OF_CONTRACT' } };
      return { record: new TokenRecord({ provider: this.id, accountKey, accessToken: r.body.access_token, refreshToken: r.body.refresh_token ?? null, expiresAt: expiresAt(now, r.body.expires_in) }) };
    },
    /** account_token grant_type=refresh_token. The refresh response example has no refresh_token, so the old one is kept. */
    async refresh(record, now = Date.now()) {
      if (!record.refresh) return { error: { availability: A.AUTH_EXPIRED, reason: 'NO_REFRESH_TOKEN' } };
      const r = await token({ grant_type: 'refresh_token', refresh_token: record.refresh.reveal(), redirect_uri: redirectUri });
      if (r.error) return { error: r.error.availability === A.PROVIDER_ERROR ? r.error : { availability: A.AUTH_EXPIRED, reason: r.error.reason } };
      if (!validToken(r.body?.access_token) || (r.body.refresh_token !== undefined && !validToken(r.body.refresh_token))) return { error: { availability: A.PROVIDER_ERROR, reason: 'TOKEN_RESPONSE_OUT_OF_CONTRACT' } };
      return { record: new TokenRecord({ provider: this.id, accountKey: record.accountKey, accessToken: r.body.access_token,
        refreshToken: r.body.refresh_token ?? record.refresh.reveal(), expiresAt: expiresAt(now, r.body.expires_in) }) };
    },
    /** account_token grant_type=delete (documented token deletion). */
    async revoke(record) {
      const r = await token({ grant_type: 'delete', access_token: record.access.reveal(), redirect_uri: redirectUri });
      return r.error ? { error: r.error } : { ok: true };
    },
    /**
     * service_agreement is a browser form POST that carries the access token as a form field ("token: Bearer {access_token}")
     * to the provider's consent page. That puts the token in the person's browser, which this project does not allow, and a
     * server-side relay is not described. So this step is BLOCKED until Hyundai confirms a token-free way to open the page.
     */
    consentStart() { return { blocked: { availability: A.BLOCKED, reason: 'CONSENT_PAGE_REQUIRES_TOKEN_IN_BROWSER' } }; },
    /** service_agreement redirect: redirect_url?userId=:userId&state=:state, or ?errCode=…&errMsg=…&errId=… */
    consentResult(query) {
      if (typeof query?.errCode === 'string') return { error: hyundaiError(400, { errCode: query.errCode }) };
      if (typeof query?.userId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(query.userId)) return { error: { availability: A.CONSENT_REQUIRED, reason: 'CONSENT_RESULT_OUT_OF_CONTRACT' } };
      return { providerUserId: query.userId };
    },
    /** service_termreject: tells Hyundai that consent was withdrawn on our side. */
    async withdrawConsent(record) {
      const res = await http.request({ path: '/api/v1/car-service/terms/reject', headers: bearer(record) });
      return res.outcome === HTTP_OUTCOME.OK ? { ok: true } : { error: res.outcome === HTTP_OUTCOME.HTTP_ERROR ? hyundaiError(res.status, res.body) : { availability: A.PROVIDER_ERROR, reason: res.outcome } };
    },
    /** carprofile_carlist: cars[{ carId, carNickname, carType, carName, carSellname }]. Only vehicles approved at login appear. */
    async listVehicles(record) {
      const res = await http.request({ path: '/api/v1/car/profile/carlist', headers: bearer(record) });
      if (res.outcome !== HTTP_OUTCOME.OK) return { error: res.outcome === HTTP_OUTCOME.HTTP_ERROR ? hyundaiError(res.status, res.body) : { availability: A.PROVIDER_ERROR, reason: res.outcome } };
      const cars = res.body?.cars;
      if (!Array.isArray(cars) || cars.length > 50 || !cars.every(c => CAR_ID.test(c?.carId ?? '') && ['GN', 'EV', 'HEV', 'PHEV', 'FCEV'].includes(c.carType)))
        return { error: { availability: A.PROVIDER_ERROR, reason: 'CARLIST_OUT_OF_CONTRACT' } };
      // Nickname is personal text and carName is an internal code: neither is kept. Sell name and type are enough to choose.
      return { vehicles: cars.map(c => ({ providerVehicleId: c.carId, type: c.carType, model: typeof c.carSellname === 'string' ? c.carSellname.slice(0, 40) : null })) };
    },
    /** One documented call → readings. `call` comes from HYUNDAI_FEATURE_CALL only. */
    async read(record, providerVehicleId, call, ctx) {
      const id = pathSegment(providerVehicleId, CAR_ID);
      const [kind, warning] = call.split(':');
      const path = { odometer: `/api/v1/car/status/${id}/odometer`, dte: `/api/v1/car/status/${id}/dte`, 'ev-battery': `/api/v1/car/status/${id}/ev/battery`,
        'ev-charging': `/api/v1/car/status/${id}/ev/charging`, warning: warning in HYUNDAI_WARNINGS ? `/api/v1/car/status/warning/${id}/${warning}` : null }[kind];
      if (!path) throw new Error('UNKNOWN_HYUNDAI_CALL');
      const res = await http.request({ path, headers: { ...bearer(record), 'Content-Type': 'application/json' } });
      if (res.outcome !== HTTP_OUTCOME.OK) return { error: res.outcome === HTTP_OUTCOME.HTTP_ERROR ? hyundaiError(res.status, res.body) : { availability: A.PROVIDER_ERROR, reason: res.outcome } };
      const readings = kind === 'odometer' ? hyundai.odometer(ctx, res.body) : kind === 'dte' ? hyundai.distanceToEmpty(ctx, res.body)
        : kind === 'ev-battery' ? hyundai.evBattery(ctx, res.body) : kind === 'ev-charging' ? hyundai.evCharging(ctx, res.body)
          : hyundai.warning(ctx, HYUNDAI_WARNINGS[warning], res.body);
      return { readings };
    },
    /**
     * partner_deletecallback body: { type: account|vehicle|agreement, action: delete|reject, userId?, carId?, vin? }.
     * The spec documents no signature or sender authentication for this POST, so the route is not exposed anywhere;
     * this parser exists so the purge it triggers is tested.
     */
    parseRevocation(body) {
      const ok = body && typeof body === 'object' && ['account', 'vehicle', 'agreement'].includes(body.type) && ['delete', 'reject'].includes(body.action) &&
        Object.keys(body).every(k => ['type', 'action', 'userId', 'carId', 'vin'].includes(k));
      if (!ok) return null;
      const carId = typeof body.carId === 'string' && CAR_ID.test(body.carId) ? body.carId : null;
      const userId = typeof body.userId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.userId) ? body.userId : null;
      if (!carId && !userId) return null;
      return { providerVehicleIds: carId ? [carId] : [], providerUserIds: userId ? [userId] : [] };
    },
  });
}
