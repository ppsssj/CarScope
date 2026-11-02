// Read-only reuse of the shipped JS validators/canonicalizer. No credentials or server required.
import assert from 'node:assert/strict';
import {canonicalJson, resultDigest, checkEnvelope} from '../inspection-sync-poc/src/protocol.mjs';
const base = {
  inspectionId: '12345678-1234-4123-8123-123456789abc', method: 'SELF', source: 'MOBILE', state: 'COMPLETED',
  startedAt: '2026-11-03T00:00:00.000Z', completedAt: '2026-11-03T00:02:00.000Z',
  aids: {locationMarked: true, cameraUsed: false}, confirmation: 'USER_REPORTED', sync: 'NOT_SENT',
};
const records = [{...base, schemaVersion: 1, taskId: 'washer-fluid', status: 'NEEDS_REFILL'}];
for (const taskId of ['tire.front-left', 'tire.front-right', 'tire.rear-left', 'tire.rear-right']) {
  for (const damage of ['FOUND', 'NOT_FOUND', 'UNABLE']) for (const debris of ['FOUND', 'NOT_FOUND', 'UNABLE']) for (const wear of ['FOUND', 'NOT_FOUND', 'UNABLE']) {
    const responses = {wear, debris, damage}; // deliberately not canonical key order
    const status = Object.values(responses).includes('FOUND') ? 'REVIEW_NEEDED' : Object.values(responses).includes('UNABLE') ? 'UNABLE' : 'NO_FINDINGS_REPORTED';
    records.push({...base, schemaVersion: 2, taskId, responses, status});
  }
}
for (const result of records) {
  assert.deepEqual(checkEnvelope({protocol: 'inspection-sync', protocolVersion: 1, result}, result.taskId), []);
  console.log([JSON.stringify(result), canonicalJson(result), await resultDigest(result)].join('\t'));
}
