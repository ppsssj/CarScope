// Operator-selected, authenticated HTTPS bridge to the normalized authority contract.
// Not an issuer or registry. No token-supplied URL, environment loader, positive cache or trust override.
import { VerifiedSessionCreationAuthorizer } from './verified-creation-authorizer.mjs';
import { startHttpsMobileService } from './https-mobile-service.mjs';
import { AuthorityTransport, authorityActive, authorityJson } from './https-authority-transport.mjs';

export { authorityJson };

export class HttpsCreationAuthority {
  #transport;
  constructor(options) { this.#transport = new AuthorityTransport(options); this.testOnly = this.#transport.testOnly; }
  verify({ token, signal }) { return this.#transport.post('/creation/verify', { token }, signal); }
  resolve({ issuer, subject, registrationId, signal }) { return this.#transport.post('/creation/registration', { issuer, subject, registrationId }, signal); }
  async isActive({ issuer, credentialId, registrationId, signal }) {
    return authorityActive(await this.#transport.post('/creation/active', { issuer, credentialId, registrationId }, signal));
  }
  toString() { return 'HttpsCreationAuthority(REDACTED)'; }
}

/** Explicit reviewed bootstrap seam. CLI still denies; missing runtime service credentials deny each create. */
export function httpsCreationAuthorizer({ issuer, audience, ...authorityOptions } = {}) {
  const authority = new HttpsCreationAuthority(authorityOptions);
  return new VerifiedSessionCreationAuthorizer({ issuer, audience, credentialVerifier: authority, registrationProvider: authority, revocations: authority });
}
export function startAuthorizedHttpsMobileService({ authority, ...serviceOptions } = {}) {
  if (Object.hasOwn(serviceOptions, 'authorizer')) throw new Error('AUTHORIZER_OVERRIDE_FORBIDDEN');
  return startHttpsMobileService({ ...serviceOptions, authorizer: httpsCreationAuthorizer(authority) });
}
