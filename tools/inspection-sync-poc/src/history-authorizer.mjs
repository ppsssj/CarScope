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
export class VerifiedHistoryReadAuthorizer {
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
    Object.assign(this, {
      issuer,
      audience,
      credentialVerifier,
      registrationProvider,
      revocations,
      now,
      timeoutMs,
    });
    this.testOnly = [credentialVerifier, registrationProvider, revocations].some((x) => x?.testOnly === true);
  }
  validClaim(c, at) {
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
      c.issuer === this.issuer &&
      c.audience === this.audience &&
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
  async check(token, signal) {
    if (
      ![
        this.credentialVerifier?.verify,
        this.registrationProvider?.resolve,
        this.revocations?.isActive,
      ].every((x) => typeof x === 'function')
    )
      return null;
    const claim = structuredClone(await this.credentialVerifier.verify({ token, signal }));
    if (signal.aborted || !this.validClaim(claim, this.now())) return null;
    const binding = structuredClone(
      await this.registrationProvider.resolve({
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
    const active = await this.revocations.isActive({
        issuer: claim.issuer,
        credentialId: claim.credentialId,
        registrationId: claim.registrationId,
        signal,
      }),
      at = this.now();
    if (signal.aborted || active !== true || !this.validClaim(claim, at) || binding.expiresAt <= at)
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
        this.check(token, controller.signal),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, this.timeoutMs);
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
