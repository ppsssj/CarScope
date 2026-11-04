// Separate read scope and currently verified ownership, never a QR receiver token or creation grant.
import { validIssuer, MAX_CREDENTIAL_TTL_MS } from './verified-creation-authorizer.mjs';
import { historyAuthority } from './history.mjs';
export const HISTORY_READ_SCOPE = 'inspection:history:read';
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(x);
const time = (x) => Number.isSafeInteger(x) && x >= 0;
const exact = (x, keys) =>
  x &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
export class DenyHistoryAuthorizer {
  async resolve() {
    return null;
  }
}
const RESERVED_ISSUER_HOST =
  /(^|\.)(invalid|test|example|localhost)$|^example\.(com|net|org)$|^127\.|^\[::1\]$|^0\.0\.0\.0$/i;
/**
 * Test credentials and reserved fixture issuers run on a loopback bind outside a managed environment only.
 * This blocks mis-composition; it is not evidence that a non-test issuer is trustworthy.
 */
export function assertHistoryAuthorizerDeployable(authorizer, { host, env = process.env } = {}) {
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host),
    managed = env.RENDER === 'true' || env.NODE_ENV === 'production',
    issuer = authorizer?.issuer;
  const fixture =
    authorizer?.testOnly === true ||
    (typeof issuer === 'string' && RESERVED_ISSUER_HOST.test(new URL(issuer).hostname));
  if (fixture && (!loopback || managed)) throw new Error('TEST_HISTORY_AUTHORIZER_FORBIDDEN');
}
export class VerifiedHistoryReadAuthorizer {
  #issuer;
  #audience;
  #verifier;
  #registrations;
  #revocations;
  #now;
  #timeoutMs;
  constructor({
    issuer,
    audience,
    credentialVerifier,
    registrationProvider,
    revocations,
    now = Date.now,
    timeoutMs = 1500,
  } = {}) {
    if (
      !validIssuer(issuer) ||
      typeof audience !== 'string' ||
      !/^[\x21-\x7e]{1,256}$/.test(audience) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 5000
    )
      throw new Error('INVALID_HISTORY_AUTH_POLICY');
    this.#issuer = issuer;
    this.#audience = audience;
    this.#verifier = credentialVerifier;
    this.#registrations = registrationProvider;
    this.#revocations = revocations;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
    this.testOnly = [credentialVerifier, registrationProvider, revocations].some((x) => x?.testOnly === true);
  }
  get issuer() {
    return this.#issuer;
  }
  #validClaim(c, at) {
    return (
      exact(c, [
        'active',
        'issuer',
        'audience',
        'subject',
        'scope',
        'issuedAt',
        'notBefore',
        'expiresAt',
        'credentialId',
        'registrationId',
      ]) &&
      c.active === true &&
      c.issuer === this.#issuer &&
      c.audience === this.#audience &&
      id(c.subject) &&
      id(c.credentialId) &&
      id(c.registrationId) &&
      Array.isArray(c.scope) &&
      c.scope.length === 1 &&
      c.scope[0] === HISTORY_READ_SCOPE &&
      [at, c.issuedAt, c.notBefore, c.expiresAt].every(time) &&
      c.issuedAt <= c.notBefore &&
      c.notBefore <= at &&
      at < c.expiresAt &&
      c.expiresAt - c.issuedAt <= MAX_CREDENTIAL_TTL_MS
    );
  }
  async #check(token, signal) {
    if (
      ![
        this.#verifier?.verify,
        this.#registrations?.resolve,
        this.#revocations?.isActive,
      ].every((x) => typeof x === 'function')
    )
      return null;
    const claim = structuredClone(await this.#verifier.verify({ token, signal }));
    if (signal.aborted || !this.#validClaim(claim, this.#now())) return null;
    const binding = structuredClone(
      await this.#registrations.resolve({
        issuer: claim.issuer,
        subject: claim.subject,
        registrationId: claim.registrationId,
        signal,
      }),
    );
    if (
      signal.aborted ||
      !exact(binding, [
        'issuer',
        'subject',
        'registrationId',
        'userId',
        'vehicleId',
        'deviceId',
        'active',
        'ownershipVerified',
        'expiresAt',
      ]) ||
      binding.issuer !== claim.issuer ||
      binding.subject !== claim.subject ||
      binding.registrationId !== claim.registrationId ||
      ![binding.userId, binding.vehicleId, binding.deviceId].every(id) ||
      binding.active !== true ||
      binding.ownershipVerified !== true ||
      !time(binding.expiresAt)
    )
      return null;
    const active = await this.#revocations.isActive({
        issuer: claim.issuer,
        credentialId: claim.credentialId,
        registrationId: claim.registrationId,
        signal,
      }),
      at = this.#now();
    if (signal.aborted || active !== true || !this.#validClaim(claim, at) || binding.expiresAt <= at)
      return null;
    return historyAuthority({
      authorityNamespace: 'VERIFIED_VEHICLE',
      authorityIssuer: claim.issuer,
      userId: binding.userId,
      vehicleId: binding.vehicleId,
      deviceId: binding.deviceId,
      registrationId: binding.registrationId,
      bindingVerifiedAt: at,
    });
  }
  async resolve({ token, secure } = {}) {
    if (secure !== true || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        this.#check(token, controller.signal),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, this.#timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
