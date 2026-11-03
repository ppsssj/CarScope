// Synthetic vectors from shipped JS validators, canonicalizer and digest; no server or credentials.
import assert from 'node:assert/strict';
import {canonicalJson, resultDigest, checkEnvelope} from '../inspection-sync-poc/src/protocol.mjs';
for (const cameraUsed of [false, true]) for (const locationMarked of [false, true]) {
  for (const flapDamage of ['FOUND', 'NOT_FOUND', 'UNABLE']) for (const debris of ['FOUND', 'NOT_FOUND', 'UNABLE']) for (const visibleDamage of ['FOUND', 'NOT_FOUND', 'UNABLE']) {
    const responses = {visibleDamage, flapDamage, debris}; // deliberately unsorted
    const status = Object.values(responses).includes('FOUND') ? 'REVIEW_NEEDED' : Object.values(responses).includes('UNABLE') ? 'UNABLE' : 'NO_FINDINGS_REPORTED';
    const result = {schemaVersion: 2, taskId: 'ev-charge.port', inspectionId: '12345678-1234-4123-8123-123456789abc',
      method: 'SELF', source: 'MOBILE', state: 'COMPLETED', startedAt: '2026-11-03T00:00:00.000Z',
      completedAt: '2026-11-03T00:02:00.000Z', aids: {locationMarked, cameraUsed}, responses, status,
      confirmation: 'USER_REPORTED', sync: 'NOT_SENT'};
    assert.deepEqual(checkEnvelope({protocol: 'inspection-sync', protocolVersion: 1, result}, result.taskId), []);
    console.log([JSON.stringify(result), canonicalJson(result), await resultDigest(result)].join('\t'));
  }
}
