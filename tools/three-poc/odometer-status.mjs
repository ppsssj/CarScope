// P14: independent Odometer UI v1. Reads Native's component cache only (no SDK call of its own) and never appends rows to the
// Component/Tire/Charge/Visibility contracts. The value is the SDK's raw Float: its unit and meaning are UNVERIFIED, so it is never
// converted, labelled in km, or used for any service interval.
import { ComponentStatusStore, ComponentStatusClient } from './component-status.mjs';
export const ODOMETER_FEATURE = 'odometer.distance-driven';
export const ODOMETER_PART = 'vehicle.odometer';
const caps = ['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'ERROR'];
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
export const odometerBlank = () => [{ featureId: ODOMETER_FEATURE, vehiclePartId: ODOMETER_PART, capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', source: null, observedAt: null, value: null, unit: null }];
export function validateOdometerStatus(p) {
  if (!exact(p, ['schemaVersion', 'sessionId', 'sequence', 'connectionStatus', 'sessionPhase', 'readings']) || p.schemaVersion !== 1 || typeof p.sessionId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.sessionId) || !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
    !['ATTACHED', 'STOPPED', 'SUPERSEDED'].includes(p.connectionStatus) || !['IDLE', 'ACTIVE', 'STOPPING', 'UNRESOLVED', 'CLOSED'].includes(p.sessionPhase) ||
    !Array.isArray(p.readings) || p.readings.length !== 1) throw Error('INVALID_ODOMETER_ENVELOPE');
  const r = p.readings[0];
  if (!exact(r, ['featureId', 'vehiclePartId', 'capabilityStatus', 'availabilityStatus', 'source', 'observedAt', 'value', 'unit']) || r.featureId !== ODOMETER_FEATURE ||
    r.vehiclePartId !== ODOMETER_PART || !caps.includes(r.capabilityStatus) || ![...caps, 'UNAVAILABLE', 'STALE'].includes(r.availabilityStatus) ||
    ![null, 'PLEOS', 'MOCK'].includes(r.source) || r.unit !== null ||
    !(r.observedAt === null || Number.isSafeInteger(r.observedAt) && r.observedAt >= 0 && r.observedAt <= 8_640_000_000_000_000)) throw Error('INVALID_ODOMETER_ROW');
  if ((r.value === null) !== (r.observedAt === null)) throw Error('INVALID_ODOMETER_OBSERVATION');
  // A distance is a finite, non-negative number, never SUPPORTED: its unit is unverified, so it stays UNVERIFIED (or STALE).
  if (r.value !== null ? typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0 || r.capabilityStatus !== 'SUPPORTED' || !['UNVERIFIED', 'STALE'].includes(r.availabilityStatus)
    : ['SUPPORTED', 'STALE'].includes(r.availabilityStatus)) throw Error('INVALID_ODOMETER_VALUE');
  if (p.connectionStatus === 'ATTACHED' ? r.source === null : r.source !== null || r.value !== null || r.capabilityStatus !== 'UNVERIFIED' || r.availabilityStatus !== 'UNVERIFIED') throw Error('INVALID_ODOMETER_OWNER');
  return Object.freeze({ ...p, readings: Object.freeze([Object.freeze({ ...r })]) });
}
export const odometerStatus = new ComponentStatusStore(validateOdometerStatus, odometerBlank);
export const odometerClient = new ComponentStatusClient(odometerStatus, { endpoint: './odometer-status.json' });
let unbind;
export function enableOdometerStatus() {
  if (unbind) return; let active = true;
  const update = () => active && document.visibilityState !== 'hidden' ? odometerClient.start() : odometerClient.stop();
  const start = () => { odometerClient.stop(); active = true; update(); }, stop = () => { active = false; update(); };
  addEventListener('carscope-component-active', start); addEventListener('carscope-component-inactive', stop); document.addEventListener('visibilitychange', update);
  unbind = () => { removeEventListener('carscope-component-active', start); removeEventListener('carscope-component-inactive', stop); document.removeEventListener('visibilitychange', update); };
  update();
}
export function disposeOdometerStatus() { unbind?.(); unbind = null; odometerClient.stop(); }
export const odometerReading = () => odometerStatus.state.readings[0];
