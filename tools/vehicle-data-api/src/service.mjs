// ExternalVehicleDataService: the server-side flow that ties a CarScope person to a provider account, a consented vehicle and a
// CarScope vehicle, then reads documented features. Rules it enforces:
// - sessionKey is the caller's authenticated CarScope identity (server derived). It is not an AVD enrollment or a mobile QR
//   token, and none of those is accepted as a provider login. No route exposes this service yet.
// - OAuth/consent state is single use and bound to that session. Tokens stay in the token store; output carries none.
// - Data is read only for a vehicle that (1) the provider lists for this account, (2) has consent, (3) the person explicitly bound
//   to a CarScope vehicle. A look-alike model (AVD, the IONIQ 5 GLB) is never a reason to bind. No binding → no combination.
// - A withdrawal (callback or disconnect) purges tokens, bindings and cached readings at once and blocks further reads.
// - Per-account and per-provider call limits are CarScope's own guard; the providers publish no limit (docs).
import { RateLimiter } from '../../inspection-sync-poc/src/rate-limit.mjs';
import { AVAILABILITY as A, PROVIDER, SOURCE, emptyReading, reading } from './model.mjs';
import { opaqueKey, Secret, tokenStoreBlock } from './credentials.mjs';
import { HYUNDAI_FEATURE_CALL } from './providers/hyundai-developers.mjs';
import { PLEOS_FEATURE_CALL, pleosRegionServed } from './providers/pleos-vehicle-data.mjs';

const CALLS = { [PROVIDER.HYUNDAI_DEVELOPERS]: HYUNDAI_FEATURE_CALL, [PROVIDER.PLEOS_VEHICLE_DATA]: PLEOS_FEATURE_CALL };
export const EXTERNAL_RATES = Object.freeze({
  'external-auth': { limit: 10, windowMs: 60_000 },       // per session: login/consent starts and callbacks
  'external-read': { limit: 30, windowMs: 60_000 },       // per account: provider calls
  'external-provider': { limit: 600, windowMs: 60_000 },  // per provider, whole host
});
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const VEHICLE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class ExternalVehicleDataService {
  #providers; #tokens; #salt; #now; #limiter; #states; #minIntervalMs; #staleAfterMs; #testMode; #pleosCountry;
  #consents = new Map();   // accountKey → { providerUserId|null, vehicles:Set|null }
  #handles = new Map();    // vehicleHandle → { accountKey, provider, providerVehicleId }
  #bindings = new Map();   // bindingId → { accountKey, provider, providerVehicleId, carscopeVehicleId }
  #cache = new Map();      // bindingId|call → { fetchedAt, readings }
  #revoked = new Set();    // provider|providerVehicleId withdrawn; cleared only by a new consent result

  constructor({ providers = {}, tokenStore, keySalt, states, now = Date.now, testMode = false, rates = EXTERNAL_RATES,
    minIntervalMs = 60_000, staleAfterMs = 15 * 60_000, pleosCountry = null } = {}) {
    if (!(keySalt instanceof Secret) || !states) throw new Error('INVALID_EXTERNAL_SERVICE_CONFIG');
    this.#providers = providers; this.#tokens = tokenStore; this.#salt = keySalt; this.#states = states; this.#now = now;
    this.#limiter = new RateLimiter({ rates, now }); this.#minIntervalMs = minIntervalMs; this.#staleAfterMs = staleAfterMs;
    this.#testMode = testMode; this.#pleosCountry = pleosCountry;
    const blocked = tokenStoreBlock(tokenStore, { testMode });
    if (blocked) throw new Error(blocked);
  }

  #gate(sessionKey, providerId, limit = 'external-auth') {
    if (typeof sessionKey !== 'string' || sessionKey.length < 16) return { availability: A.NOT_CONNECTED, reason: 'NO_AUTHENTICATED_SESSION' };
    const provider = this.#providers[providerId];
    if (!provider) return { availability: A.DISABLED, reason: 'PROVIDER_NOT_ENABLED' };
    if (providerId === PROVIDER.PLEOS_VEHICLE_DATA && !pleosRegionServed(this.#pleosCountry)) return { availability: A.REGION_UNSUPPORTED, reason: 'PLEOS_VEHICLE_DATA_EUROPE_ONLY' };
    if (limit && !this.#limiter.check(sessionKey, limit).ok) return { availability: A.RATE_LIMITED, reason: 'CARSCOPE_LIMIT' };
    return { provider };
  }
  #account(sessionKey, providerId) { return opaqueKey('acct', this.#salt, providerId, sessionKey); }

  beginLogin({ sessionKey, provider: id }) {
    const g = this.#gate(sessionKey, id); if (!g.provider) return g;
    return { authorizationUrl: g.provider.authorizationUrl(this.#states.create({ sessionKey, provider: id, purpose: 'LOGIN' })) };
  }
  async completeLogin({ sessionKey, provider: id, state, code }) {
    const g = this.#gate(sessionKey, id); if (!g.provider) return g;
    if (!this.#states.consume({ state, sessionKey, provider: id, purpose: 'LOGIN' })) return { availability: A.NOT_CONNECTED, reason: 'OAUTH_STATE_MISMATCH' };
    const accountKey = this.#account(sessionKey, id);
    const r = await g.provider.exchangeCode({ code, accountKey, now: this.#now() });
    if (r.error) return r.error;
    this.#tokens.put(r.record);
    return { connected: true };
  }
  beginConsent({ sessionKey, provider: id }) {
    const g = this.#gate(sessionKey, id); if (!g.provider) return g;
    const start = g.provider.consentStart();
    return start.blocked ?? { availability: A.BLOCKED, reason: 'CONSENT_FLOW_NOT_IMPLEMENTED' };
  }
  async completeConsent({ sessionKey, provider: id, state, query }) {
    const g = this.#gate(sessionKey, id); if (!g.provider) return g;
    if (!this.#states.consume({ state, sessionKey, provider: id, purpose: 'CONSENT' })) return { availability: A.CONSENT_REQUIRED, reason: 'CONSENT_STATE_MISMATCH' };
    return this.#recordConsent(sessionKey, id, g.provider.consentResult(query));
  }
  /** Tests only: the consent page cannot be opened (BLOCKED), so tests record the documented redirect result directly. */
  testOnlyRecordConsent({ sessionKey, provider: id, query }) {
    if (!this.#testMode) throw new Error('TEST_ONLY');
    const g = this.#gate(sessionKey, id, null); if (!g.provider) return g;
    return this.#recordConsent(sessionKey, id, g.provider.consentResult(query));
  }
  #recordConsent(sessionKey, id, result) {
    if (result.error) return result.error;
    const accountKey = this.#account(sessionKey, id);
    const vehicles = result.providerVehicleIds ? new Set(result.providerVehicleIds) : null;
    this.#consents.set(accountKey, { providerUserId: result.providerUserId ?? null, vehicles });
    for (const v of vehicles ?? []) this.#revoked.delete(`${id}|${v}`);
    return { consented: true };
  }

  async #token(accountKey, provider) {
    let record = this.#tokens.get(accountKey);
    if (!record) return { error: { availability: A.NOT_CONNECTED, reason: 'NO_LINKED_ACCOUNT' } };
    if (record.expiresAt <= this.#now() + 30_000) {
      const r = await provider.refresh(record, this.#now());
      if (r.error) { if (r.error.availability === A.AUTH_EXPIRED) this.#tokens.delete(accountKey); return { error: r.error.availability === A.PROVIDER_ERROR ? r.error : { availability: A.AUTH_EXPIRED, reason: r.error.reason } }; }
      this.#tokens.put(r.record); record = r.record;
    }
    return { record };
  }

  /** Vehicles the provider lists for this account and (Pleos) that the owner consented to. Output is handles, never ids. */
  async listVehicles({ sessionKey, provider: id }) {
    const g = this.#gate(sessionKey, id, null); if (!g.provider) return g;
    const accountKey = this.#account(sessionKey, id), consent = this.#consents.get(accountKey);
    if (!consent) return { availability: A.CONSENT_REQUIRED, reason: 'NO_DATA_SHARING_CONSENT' };
    if (!this.#limiter.check(accountKey, 'external-read').ok || !this.#limiter.check(id, 'external-provider').ok) return { availability: A.RATE_LIMITED, reason: 'CARSCOPE_LIMIT' };
    const t = await this.#token(accountKey, g.provider); if (t.error) return t.error;
    const r = await g.provider.listVehicles(t.record); if (r.error) return this.#onError(accountKey, r.error);
    const vehicles = r.vehicles.filter(v => (consent.vehicles === null || consent.vehicles.has(v.providerVehicleId)) && !this.#revoked.has(`${id}|${v.providerVehicleId}`));
    return { vehicles: vehicles.map(v => {
      const vehicleHandle = opaqueKey('vh', this.#salt, id, accountKey, v.providerVehicleId);
      this.#handles.set(vehicleHandle, { accountKey, provider: id, providerVehicleId: v.providerVehicleId });
      return { vehicleHandle, type: v.type, model: v.model };
    }) };
  }

  /** The person states that this provider vehicle is the CarScope vehicle. Without that statement nothing is combined. */
  bindVehicle({ sessionKey, provider: id, vehicleHandle, carscopeVehicleId, ownerConfirmed }) {
    const g = this.#gate(sessionKey, id, null); if (!g.provider) return g;
    const accountKey = this.#account(sessionKey, id), h = this.#handles.get(vehicleHandle);
    if (ownerConfirmed !== true) return { availability: A.NOT_CONNECTED, reason: 'OWNER_CONFIRMATION_REQUIRED' };
    if (typeof carscopeVehicleId !== 'string' || !VEHICLE_ID.test(carscopeVehicleId)) return { availability: A.NOT_CONNECTED, reason: 'INVALID_CARSCOPE_VEHICLE' };
    if (!h || h.accountKey !== accountKey || h.provider !== id) return { availability: A.NOT_CONNECTED, reason: 'VEHICLE_NOT_AUTHORIZED_FOR_ACCOUNT' };
    if (this.#revoked.has(`${id}|${h.providerVehicleId}`)) return { availability: A.CONSENT_REQUIRED, reason: 'CONSENT_WITHDRAWN' };
    for (const b of this.#bindings.values()) if (b.carscopeVehicleId === carscopeVehicleId && b.provider === id && b.accountKey !== accountKey) return { availability: A.NOT_CONNECTED, reason: 'CARSCOPE_VEHICLE_BOUND_TO_OTHER_ACCOUNT' };
    const bindingId = opaqueKey('vb', this.#salt, id, accountKey, h.providerVehicleId, carscopeVehicleId);
    this.#bindings.set(bindingId, { accountKey, provider: id, providerVehicleId: h.providerVehicleId, carscopeVehicleId });
    return { bound: true };
  }

  #binding(sessionKey, id, carscopeVehicleId) {
    const accountKey = this.#account(sessionKey, id);
    for (const [bindingId, b] of this.#bindings) if (b.accountKey === accountKey && b.provider === id && b.carscopeVehicleId === carscopeVehicleId) return { bindingId, ...b };
    return null;
  }
  #onError(accountKey, error) {
    if (error.availability === A.CONSENT_REQUIRED) this.#consents.delete(accountKey);
    if (error.availability === A.AUTH_EXPIRED) this.#tokens.delete(accountKey);
    return error;
  }

  /** Readings for documented features. A feature the provider has no call for is FEATURE_UNSUPPORTED without a request. */
  async read({ sessionKey, provider: id, carscopeVehicleId, features }) {
    const g = this.#gate(sessionKey, id, null);
    const fetchedAt = iso(this.#now());
    const blank = (featureId, availability, reason, bindingId = 'vb_unbound_00000000') =>
      emptyReading({ provider: id, featureId, vehicleBinding: bindingId, source: SOURCE.EXTERNAL_REST, fetchedAt }, availability, reason);
    if (!g.provider) return features.map(f => blank(f, g.availability, g.reason));
    const b = this.#binding(sessionKey, id, carscopeVehicleId);
    if (!b) return features.map(f => blank(f, A.NOT_CONNECTED, 'NO_OWNER_CONFIRMED_BINDING'));
    if (this.#revoked.has(`${id}|${b.providerVehicleId}`) || !this.#consents.has(b.accountKey)) return features.map(f => blank(f, A.CONSENT_REQUIRED, 'NO_DATA_SHARING_CONSENT', b.bindingId));
    const calls = new Map(), out = new Map();
    for (const f of features) {
      const call = CALLS[id][f];
      if (!call) out.set(f, blank(f, A.FEATURE_UNSUPPORTED, 'PROVIDER_HAS_NO_DOCUMENTED_API', b.bindingId));
      else calls.set(call, [...(calls.get(call) ?? []), f]);
    }
    for (const [call, wanted] of calls) {
      const key = `${b.bindingId}|${call}`, cached = this.#cache.get(key);
      let readings = cached && this.#now() - Date.parse(cached.fetchedAt) < this.#minIntervalMs ? cached.readings : null;
      if (!readings) {
        if (!this.#limiter.check(b.accountKey, 'external-read').ok || !this.#limiter.check(id, 'external-provider').ok) {
          for (const f of wanted) out.set(f, blank(f, A.RATE_LIMITED, 'CARSCOPE_LIMIT', b.bindingId)); continue;
        }
        const t = await this.#token(b.accountKey, g.provider);
        const r = t.error ? t : await g.provider.read(t.record, b.providerVehicleId, call, { vehicleBinding: b.bindingId, fetchedAt, mock: false });
        // The withdrawal may have arrived while the request was in flight: then the answer is dropped.
        if (this.#revoked.has(`${id}|${b.providerVehicleId}`) || !this.#bindings.has(b.bindingId)) { for (const f of wanted) out.set(f, blank(f, A.CONSENT_REQUIRED, 'CONSENT_WITHDRAWN', b.bindingId)); continue; }
        if (r.error) { this.#onError(b.accountKey, r.error); for (const f of wanted) out.set(f, blank(f, r.error.availability, r.error.reason, b.bindingId)); continue; }
        readings = r.readings; this.#cache.set(key, { fetchedAt, readings });
      }
      for (const f of wanted) out.set(f, readings.find(x => x.featureId === f) ?? blank(f, A.FEATURE_UNSUPPORTED, 'VEHICLE_DID_NOT_SEND', b.bindingId));
    }
    return features.map(f => out.get(f));
  }

  /** Provider withdrawal notice (Hyundai partner_deletecallback, Pleos consent-withdraw). Returns how many bindings were purged. */
  handleRevocation({ provider: id, body }) {
    const provider = this.#providers[id], parsed = provider?.parseRevocation(body);
    if (!parsed) return { accepted: false };
    const users = new Set(parsed.providerUserIds), vehicles = new Set(parsed.providerVehicleIds);
    for (const v of vehicles) this.#revoked.add(`${id}|${v}`);
    const accounts = new Set();
    for (const [key, c] of this.#consents) if (c.providerUserId && users.has(c.providerUserId)) accounts.add(key);
    let purged = 0;
    for (const [bid, b] of this.#bindings) if (b.provider === id && (vehicles.has(b.providerVehicleId) || accounts.has(b.accountKey))) { this.#purgeBinding(bid); purged++; }
    for (const [h, v] of this.#handles) if (v.provider === id && (vehicles.has(v.providerVehicleId) || accounts.has(v.accountKey))) this.#handles.delete(h);
    for (const key of accounts) { this.#consents.delete(key); this.#tokens.delete(key); }
    return { accepted: true, purged };
  }
  #purgeBinding(bindingId) {
    this.#bindings.delete(bindingId);
    for (const key of this.#cache.keys()) if (key.startsWith(bindingId + '|')) this.#cache.delete(key);
  }

  /** Owner disconnects: tell the provider (best effort), then purge locally regardless of the answer. */
  async disconnect({ sessionKey, provider: id }) {
    const g = this.#gate(sessionKey, id, null); if (!g.provider) return g;
    const accountKey = this.#account(sessionKey, id), record = this.#tokens.get(accountKey), remote = [];
    const mine = [...this.#bindings].filter(([, b]) => b.accountKey === accountKey && b.provider === id);
    if (record) {
      if (id === PROVIDER.PLEOS_VEHICLE_DATA) for (const [, b] of mine) remote.push(await g.provider.withdrawConsent(record, b.providerVehicleId));
      else remote.push(await g.provider.withdrawConsent(record));
      remote.push(await g.provider.revoke(record));
    }
    for (const [bid, b] of mine) { this.#purgeBinding(bid); this.#revoked.add(`${id}|${b.providerVehicleId}`); }
    for (const [h, v] of this.#handles) if (v.accountKey === accountKey) this.#handles.delete(h);
    this.#consents.delete(accountKey); this.#tokens.delete(accountKey);
    return { disconnected: true, providerConfirmed: remote.length > 0 && remote.every(r => r.ok) };
  }

  /** Readings with STALE applied for the card: a received value whose fetch is older than staleAfterMs. */
  freshness(readings) {
    return readings.map(r => r.availability === A.RECEIVED && this.#now() - Date.parse(r.fetchedAt) > this.#staleAfterMs ? reading({ ...r, availability: A.STALE, reason: 'CARSCOPE_COPY_OLDER_THAN_WINDOW' }) : r);
  }
}
