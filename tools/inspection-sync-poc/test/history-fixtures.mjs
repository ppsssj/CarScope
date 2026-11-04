// Synthetic owners and user answers only. Never imported by a runtime entrypoint.
import { randomBytes, randomUUID } from 'node:crypto';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { tireResult, TIRE_CHECKS } from '../../mobile-ar-poc/public/tire-result.mjs';
import { chargeResult, CHARGE_CHECKS } from '../../mobile-ar-poc/public/charge-result.mjs';
import { brakeResult, BRAKE_CHECKS } from '../../mobile-ar-poc/public/brake-result.mjs';
import { extraTask } from '../../mobile-ar-poc/public/extra-tasks.mjs';
import { getExtraResult } from '../../mobile-ar-poc/public/extra-result.mjs';
import { VerifiedSessionCreationAuthorizer, CREATE_SCOPE } from '../src/verified-creation-authorizer.mjs';
import { VerifiedHistoryReadAuthorizer, HISTORY_READ_SCOPE } from '../src/history-authorizer.mjs';

export function historyResult(
  task,
  { answer = 'UNABLE', inspectionId = randomUUID(), completedAt = Date.UTC(2026, 10, 4, 8) } = {},
) {
  const options = { newId: () => inspectionId, now: () => completedAt - 60_000 };
  if (task === 'washer-fluid')
    return completeInspection(
      startInspection(options),
      answer === 'FOUND' ? 'NEEDS_REFILL' : answer === 'NOT_FOUND' ? 'OK' : 'UNSURE',
      { now: () => completedAt },
    );
  const extra = extraTask(task);
  const [profile, checks] = extra
    ? [getExtraResult(task), extra.checks]
    : task.startsWith('tire.')
      ? [tireResult, TIRE_CHECKS]
      : task === 'ev-charge.port'
        ? [chargeResult, CHARGE_CHECKS]
        : [brakeResult, BRAKE_CHECKS];
  let result = profile.start(task, options);
  for (const check of checks) result = profile.answer(result, check.id, answer);
  return profile.complete(result, { now: () => completedAt });
}
export const envelope = (result) => ({ protocol: 'inspection-sync', protocolVersion: 1, result });
export function historyAuthFixture({ now = Date.now } = {}) {
  const issuer = 'https://history-issuer.fixture.invalid/',
    audience = 'carscope-history-fixture';
  const owners = Object.fromEntries(
    ['A', 'B'].map((owner) => [
      owner,
      {
        issuer,
        subject: 'subject-' + owner,
        registrationId: 'registration-' + owner,
        userId: 'user-' + owner,
        vehicleId: 'vehicle-' + owner,
        deviceId: 'device-' + owner,
        active: true,
        ownershipVerified: true,
        expiresAt: now() + 3600_000,
      },
    ]),
  );
  const grants = new Map(),
    tokens = {};
  function refresh() {
    grants.clear();
    for (const owner of ['A', 'B'])
      for (const role of ['create', 'read']) {
        const token = randomBytes(32).toString('base64url');
        tokens[owner + role] = token;
        grants.set(token, {
          active: true,
          issuer,
          audience,
          subject: owners[owner].subject,
          scope: [role === 'create' ? CREATE_SCOPE : HISTORY_READ_SCOPE],
          issuedAt: now(),
          notBefore: now(),
          expiresAt: now() + 60_000,
          credentialId: randomUUID(),
          registrationId: owners[owner].registrationId,
        });
        owners[owner].expiresAt = now() + 3600_000;
      }
  }
  refresh();
  const options = {
    issuer,
    audience,
    now,
    credentialVerifier: {
      testOnly: true,
      async verify({ token }) {
        return grants.get(token) ?? null;
      },
    },
    registrationProvider: {
      testOnly: true,
      async resolve({ issuer, subject, registrationId }) {
        return (
          Object.values(owners).find(
            (o) => o.issuer === issuer && o.subject === subject && o.registrationId === registrationId,
          ) ?? null
        );
      },
    },
    revocations: {
      testOnly: true,
      async isActive({ credentialId }) {
        return [...grants.values()].some((g) => g.credentialId === credentialId && g.active === true);
      },
    },
  };
  return {
    owners,
    grants,
    tokens,
    refresh,
    options,
    creation: new VerifiedSessionCreationAuthorizer(options),
    read: new VerifiedHistoryReadAuthorizer(options),
  };
}
