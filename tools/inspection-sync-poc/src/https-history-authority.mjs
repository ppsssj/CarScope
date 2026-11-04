// Operator-selected, authenticated HTTPS bridge to the normalized history-read authority contract.
// Not an issuer, registry or ownership proof: an actual authority must be separately approved and provisioned.
// No environment loader, no public selection and no caching of any verdict.
import { AuthorityTransport, authorityActive } from './https-authority-transport.mjs';
import { VerifiedHistoryReadAuthorizer } from './history-authorizer.mjs';

export class HttpsHistoryAuthority {
  #transport;
  constructor(options) {
    this.#transport = new AuthorityTransport(options);
    this.testOnly = this.#transport.testOnly;
  }
  verify({ token, signal }) {
    return this.#transport.post('/history/verify', { token }, signal);
  }
  resolve({ issuer, subject, registrationId, signal }) {
    return this.#transport.post('/history/registration', { issuer, subject, registrationId }, signal);
  }
  async isActive({ issuer, credentialId, registrationId, signal }) {
    return authorityActive(
      await this.#transport.post('/history/active', { issuer, credentialId, registrationId }, signal),
    );
  }
  toString() {
    return 'HttpsHistoryAuthority(REDACTED)';
  }
}

/** Explicit reviewed bootstrap seam. The Render CLI never calls it, so deployed reads stay DENY_DEFAULT. */
export function httpsHistoryAuthorizer({ issuer, audience, now, timeoutMs, authorityTimeoutMs, ...authorityOptions } = {}) {
  const authority = new HttpsHistoryAuthority({
    ...authorityOptions,
    ...(authorityTimeoutMs ? { timeoutMs: authorityTimeoutMs } : {}),
  });
  return new VerifiedHistoryReadAuthorizer({
    issuer,
    audience,
    ...(now ? { now } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    credentialVerifier: authority,
    registrationProvider: authority,
    revocations: authority,
  });
}
