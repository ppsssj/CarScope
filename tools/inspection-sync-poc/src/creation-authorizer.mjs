// SessionCreationAuthorizer.authorize({ token, remoteAddress, secure }): Promise<boolean>.
// A production verifier must validate issuer/audience/scope/expiry/revocation and a provisioned device/app identity.
// No Pleos attestation API has been established. Fail closed until a reviewed verifier is supplied.
import { createHash, timingSafeEqual } from 'node:crypto';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const hash = (s) => createHash('sha256').update(s).digest();

export class ProductionSessionCreationAuthorizer {
  async authorize() { return false; }
}

// Explicit opt-in for historical AR-02A synthetic loopback tests only; never vehicle authentication.
export class LocalTestSessionCreationAuthorizer {
  testOnly = true;
  async authorize({ remoteAddress }) { return LOOPBACK.has(remoteAddress); }
}

// Short-lived/revocable fixture credential. Not a production credential issuer/verifier.
export class FakeSessionCreationAuthorizer {
  testOnly = true;
  #credential;
  constructor({ token, expiresAt, now = Date.now }) { this.now = now; this.rotate({ token, expiresAt }); }
  rotate({ token, expiresAt }) {
    if (typeof token !== 'string' || token.length < 32 || !Number.isFinite(expiresAt)) throw new Error('Invalid fixture credential');
    this.#credential = { hash: hash(token), expiresAt };
  }
  revoke() { this.#credential = null; }
  async authorize({ token, remoteAddress, secure }) {
    const c = this.#credential;
    return Boolean(c && secure && LOOPBACK.has(remoteAddress) && typeof token === 'string' && this.now() < c.expiresAt && timingSafeEqual(hash(token), c.hash));
  }
}
