// VehicleDataAvailability: what a provider can do on this host, decided from operator configuration before anything is called.
// Default is DISABLED. Each later gate only narrows: NOT_CONFIGURED → REGION_UNSUPPORTED → BLOCKED. Nothing here reaches the network.
// No entrypoint reads this today: no server in this repository imports the external data layer (see test/boundary.test.mjs).
import { AVAILABILITY as A, PROVIDER } from './model.mjs';
import { Secret, tokenStoreBlock } from './credentials.mjs';
import { hyundaiDevelopersProvider } from './providers/hyundai-developers.mjs';
import { pleosVehicleDataProvider, pleosRegionServed } from './providers/pleos-vehicle-data.mjs';

export const ENV = Object.freeze({
  HYUNDAI_DEVELOPERS: Object.freeze({ approval: 'CARSCOPE_HYUNDAI_DEVELOPERS_APPROVAL', clientId: 'HYUNDAI_DEVELOPERS_CLIENT_ID',
    clientSecret: 'HYUNDAI_DEVELOPERS_CLIENT_SECRET', redirectUri: 'HYUNDAI_DEVELOPERS_REDIRECT_URI' }),
  PLEOS_VEHICLE_DATA: Object.freeze({ approval: 'CARSCOPE_PLEOS_VEHICLE_DATA_APPROVAL', clientId: 'PLEOS_VEHICLE_DATA_CLIENT_ID',
    clientSecret: 'PLEOS_VEHICLE_DATA_CLIENT_SECRET', loginRedirectUrl: 'PLEOS_VEHICLE_DATA_LOGIN_REDIRECT_URL', brand: 'PLEOS_VEHICLE_DATA_BRAND',
    country: 'CARSCOPE_PLEOS_VEHICLE_DATA_COUNTRY' }),
});

/**
 * @returns {{ HYUNDAI_DEVELOPERS: {availability, reason, provider}, PLEOS_VEHICLE_DATA: {...} }}
 *   provider is non-null only when every gate passed. With today's repository that never happens (no approved token store,
 *   consent pages need the token in the browser), so a real host always reports BLOCKED at best.
 */
export function vehicleDataAvailability(env = {}, { tokenStore = null, testMode = false, fetchImpl } = {}) {
  const out = {};
  for (const id of Object.values(PROVIDER)) {
    const keys = ENV[id];
    const result = (availability, reason, provider = null) => (out[id] = Object.freeze({ availability, reason, provider }));
    if (env[keys.approval] === undefined || env[keys.approval] === '') { result(A.DISABLED, 'NO_OPERATOR_APPROVAL'); continue; }
    if (env[keys.approval] !== 'OPERATOR_APPROVED') { result(A.DISABLED, 'APPROVAL_VALUE_NOT_RECOGNIZED'); continue; }
    let provider;
    try {
      const secret = typeof env[keys.clientSecret] === 'string' && env[keys.clientSecret] ? new Secret(env[keys.clientSecret]) : null;
      provider = id === PROVIDER.HYUNDAI_DEVELOPERS
        ? hyundaiDevelopersProvider({ clientId: env[keys.clientId], clientSecret: secret, redirectUri: env[keys.redirectUri], fetchImpl })
        : pleosVehicleDataProvider({ clientId: env[keys.clientId], clientSecret: secret, loginRedirectUrl: env[keys.loginRedirectUrl], brand: env[keys.brand], fetchImpl });
    } catch { result(A.NOT_CONFIGURED, 'DEVELOPER_PROJECT_CREDENTIALS_MISSING'); continue; }
    if (id === PROVIDER.PLEOS_VEHICLE_DATA && !pleosRegionServed(env[keys.country])) { result(A.REGION_UNSUPPORTED, 'PLEOS_VEHICLE_DATA_EUROPE_ONLY'); continue; }
    const store = tokenStoreBlock(tokenStore, { testMode, env });
    if (store) { result(A.BLOCKED, store); continue; }
    if (provider.consentStart().blocked) { result(A.BLOCKED, provider.consentStart().blocked.reason); continue; }
    result(A.NOT_CONNECTED, null, provider);
  }
  return Object.freeze(out);
}
