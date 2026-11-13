// P15: the boundary between a verified CarScope user (Supabase Auth) and the P14-B external vehicle data service.
//
// ExternalVehicleDataService (tools/vehicle-data-api) takes `sessionKey`: "the caller's authenticated CarScope identity
// (server derived)". This module is the only place that turns a verified Supabase identity into that key:
//   * it accepts only identities produced by createSupabaseIdentityVerifier in this process (never a client object),
//   * the key is an HMAC of the Supabase user id under a server-held salt, so the Supabase UUID itself is not handed
//     to provider code and cannot be guessed from the key,
//   * it grants nothing. Google sign-in proves who the user is, not that they own a car or consented to share its data.
//     Provider login, consent and an owner-confirmed binding are still required inside ExternalVehicleDataService, and
//     both providers stay BLOCKED / DISABLED by default (docs/p14-external-vehicle-data.md).
// Nothing in this PR imports this module from a server entrypoint; there is no route.

import { createHmac } from 'node:crypto';
import { isVerifiedIdentity } from './supabase-identity.mjs';

export const EXTERNAL_DATA_STATUS = Object.freeze({
  // What the account page may show for "Hyundai account connection". It is a fixed status, not a probe.
  HYUNDAI_DEVELOPERS: 'BLOCKED',
  PLEOS_VEHICLE_DATA: 'BLOCKED',
  reason: 'SEPARATE_PROVIDER_LOGIN_CONSENT_AND_OWNERSHIP_REQUIRED',
});

/**
 * @param {object} identity   result.identity from createSupabaseIdentityVerifier().verify()
 * @param {object} options
 * @param {Uint8Array|string} options.salt  server secret, at least 32 bytes; never sent to a browser
 * @param {() => number} [options.now]
 */
export function carscopeSessionKey(identity, { salt, now = Date.now } = {}) {
  if (!isVerifiedIdentity(identity)) throw new TypeError('UNVERIFIED_IDENTITY');
  if (identity.expiresAt <= now()) throw new TypeError('IDENTITY_EXPIRED');
  const secret = typeof salt === 'string' ? Buffer.from(salt, 'utf8') : salt;
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) throw new TypeError('SALT_TOO_SHORT');
  const mac = createHmac('sha256', secret).update(`carscope-user:v1:${identity.issuer}:${identity.userId}`).digest('base64url');
  return `csu_${mac}`;
}
