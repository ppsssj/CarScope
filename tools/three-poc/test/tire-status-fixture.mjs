// Explicit synthetic status metadata only; no pressure observations or SDK objects.
import { TIRES } from '../inspection-tires.mjs';
import { TIRE_FEATURES } from '../tire-status.mjs';
export function statusFixture(sequence = 1, source = 'MOCK') {
  const states = [['SUPPORTED', 'UNVERIFIED', 1793520000000], ['UNSUPPORTED', 'UNSUPPORTED', null],
    ['PERMISSION_DENIED', 'PERMISSION_DENIED', null], ['SUPPORTED', 'ERROR', null],
    ['SUPPORTED', 'STALE', 1793519999000], ['UNVERIFIED', 'UNVERIFIED', null],
    ['SUPPORTED', 'SUPPORTED', 1793520001000], ['ERROR', 'ERROR', null]];
  return { schemaVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', sequence,
    connectionStatus: 'ATTACHED', sessionPhase: 'UNRESOLVED', readings: TIRE_FEATURES.flatMap((featureId, f) => TIRES.map((t, i) => ({
      featureId, vehiclePartId: t.id, capabilityStatus: states[f * 4 + i][0], availabilityStatus: states[f * 4 + i][1],
      observedAt: states[f * 4 + i][2], source,
    }))) };
}
