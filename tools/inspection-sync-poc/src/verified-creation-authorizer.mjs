// Trusted adapter boundary, not an issuer, JWT decoder or device-ID authenticator.
// No adapters are installed by the CLI. Every external assertion must already be authenticated.
export const CREATE_SCOPE = 'inspection:session:create';
export const MAX_CREDENTIAL_TTL_MS = 300_000;
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(x);
const time = (x) => Number.isSafeInteger(x) && x >= 0;
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const claimKeys = ['active', 'issuer', 'audience', 'subject', 'scope', 'issuedAt', 'notBefore', 'expiresAt', 'credentialId', 'registrationId'];
const bindingKeys = ['issuer', 'subject', 'registrationId', 'userId', 'vehicleId', 'deviceId', 'active', 'ownershipVerified', 'expiresAt'];

export function validIssuer(value) {
  try {
    const u = new URL(value);
    return typeof value === 'string' && value.length <= 512 && /^[\x21-\x7e]+$/.test(value) && value.startsWith('https://') && !/[\\?#]/.test(value) &&
      u.protocol === 'https:' && Boolean(u.hostname) && (!u.port || Number(u.port) > 0) && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

/**
 * credentialVerifier.verify({token,signal}) -> authenticated normalized claim or null.
 * registrationProvider.resolve({issuer,subject,registrationId,signal}) -> verified current user/vehicle/device binding or null.
 * revocations.isActive({issuer,credentialId,registrationId,signal}) -> true only for a current non-revoked grant.
 * Adapters must bound I/O and honor AbortSignal. Unknown/unavailable means deny; no stale-positive cache here.
 */
export class VerifiedSessionCreationAuthorizer {
  #issuer; #audience; #verifier; #registrations; #revocations; #now; #timeout;
  constructor({ issuer, audience, credentialVerifier, registrationProvider, revocations, now = Date.now, timeoutMs = 1500 } = {}) {
    if (!validIssuer(issuer) || typeof audience !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(audience) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('INVALID_AUTH_POLICY');
    this.#issuer = issuer; this.#audience = audience; this.#verifier = credentialVerifier;
    this.#registrations = registrationProvider; this.#revocations = revocations; this.#now = now; this.#timeout = timeoutMs;
    // Test dependencies can never become an externally bindable authorizer through composition.
    this.testOnly = [credentialVerifier, registrationProvider, revocations].some((x) => x?.testOnly === true);
  }
  #validClaim(c, at) {
    return exact(c, claimKeys) && c.active === true && c.issuer === this.#issuer && c.audience === this.#audience &&
      id(c.subject) && id(c.credentialId) && id(c.registrationId) && Array.isArray(c.scope) && c.scope.length === 1 && c.scope[0] === CREATE_SCOPE &&
      [at, c.issuedAt, c.notBefore, c.expiresAt].every(time) && c.issuedAt <= c.notBefore && c.notBefore <= at &&
      c.expiresAt > at && c.expiresAt > c.notBefore && c.expiresAt - c.issuedAt <= MAX_CREDENTIAL_TTL_MS;
  }
  async #check(token, signal) {
    if (![this.#verifier?.verify, this.#registrations?.resolve, this.#revocations?.isActive].every((x) => typeof x === 'function')) return false;
    const c = structuredClone(await this.#verifier.verify({ token, signal }));
    if (signal.aborted || !this.#validClaim(c, this.#now())) return false;
    const binding = structuredClone(await this.#registrations.resolve({ issuer: c.issuer, subject: c.subject, registrationId: c.registrationId, signal }));
    if (signal.aborted || !exact(binding, bindingKeys) || binding.issuer !== c.issuer || binding.subject !== c.subject || binding.registrationId !== c.registrationId ||
      ![binding.userId, binding.vehicleId, binding.deviceId].every(id) || binding.active !== true || binding.ownershipVerified !== true || !time(binding.expiresAt)) return false;
    const active = await this.#revocations.isActive({ issuer: c.issuer, credentialId: c.credentialId, registrationId: c.registrationId, signal });
    const at = this.#now();
    return !signal.aborted && active === true && this.#validClaim(c, at) && binding.expiresAt > at;
  }
  async authorize({ token, secure } = {}) {
    if (secure !== true || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return false;
    const ctrl = new AbortController(); let timer;
    try {
      return await Promise.race([
        this.#check(token, ctrl.signal),
        new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve(false); }, this.#timeout); }),
      ]) === true;
    } catch { return false; } // Never log adapter exceptions, tokens, claims or registration identities.
    finally { clearTimeout(timer); ctrl.abort(); }
  }
}
