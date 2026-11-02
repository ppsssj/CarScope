// Synthetic dependency implementations, never a production credential issuer or identity registry.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { VerifiedSessionCreationAuthorizer, CREATE_SCOPE } from '../src/verified-creation-authorizer.mjs';
const hash = (s) => createHash('sha256').update(s).digest();
export function authFixture({ now = Date.now, timeoutMs = 1500 } = {}) {
  const token = randomBytes(32).toString('base64url'), tokenHash = hash(token);
  const issuer = 'https://fixture-issuer.invalid/', audience = 'carscope-sync-test';
  const at = now();
  const state = {
    claim: { active: true, issuer, audience, subject: 'fixture-subject', scope: [CREATE_SCOPE], issuedAt: at, notBefore: at, expiresAt: at + 60_000, credentialId: 'fixture-grant', registrationId: 'fixture-registration' },
    binding: { issuer, subject: 'fixture-subject', registrationId: 'fixture-registration', userId: 'fixture-user', vehicleId: 'fixture-vehicle', deviceId: 'fixture-device', active: true, ownershipVerified: true, expiresAt: at + 300_000 },
    active: true,
  };
  const credentialVerifier = { testOnly: true, async verify({ token: input }) { return typeof input === 'string' && timingSafeEqual(hash(input), tokenHash) ? state.claim : null; } };
  const registrationProvider = { testOnly: true, async resolve() { return state.binding; } };
  const revocations = { testOnly: true, async isActive() { return state.active; } };
  const options = { issuer, audience, credentialVerifier, registrationProvider, revocations, now, timeoutMs };
  return { token, state, options, authorizer: new VerifiedSessionCreationAuthorizer(options) };
}
