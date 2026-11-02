import { COMPONENT_FEATURES } from '../component-status.mjs';
export function componentFixture() {
  return { schemaVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', sequence: 1, connectionStatus: 'ATTACHED', sessionPhase: 'ACTIVE',
    readings: Object.entries(COMPONENT_FEATURES).map(([featureId, vehiclePartId]) => ({ featureId, vehiclePartId,
      capabilityStatus: 'SUPPORTED', availabilityStatus: featureId === 'ev-battery.soc' ? 'UNVERIFIED' : 'SUPPORTED', source: 'MOCK', observedAt: 1000,
      value: featureId === 'ev-battery.soc' ? 73 : featureId === 'safety.brake-fluid-level' ? 'LOW' : false, unit: null })) };
}
