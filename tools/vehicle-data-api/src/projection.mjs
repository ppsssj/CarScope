// Server → page projection (carscope.external-vehicle-data v1, validated by tools/three-poc/external-vehicle-data.mjs).
// It carries states and word-level reports only: no binding id, carId, VIN, token, raw body or number. Numbers stay server side
// until a live account confirms their unit; booleans and documented enums become fixed report words.
import { AVAILABILITY as A, FEATURE as F, SOURCE } from './model.mjs';

const BOOLEAN_REPORT = { [F.EV_CHARGING]: v => v ? 'CHARGING' : 'NOT_CHARGING' };
const ENUM_REPORT = new Set(['CONNECTED', 'DISCONNECTED', 'FAST_CHARGER_CONNECTED', 'NORMAL_CHARGER_CONNECTED']);
const PROJECTED = new Set([F.ODOMETER, F.DISTANCE_TO_EMPTY, F.EV_STATE_OF_CHARGE, F.EV_CHARGING, F.EV_PLUG, F.WARNING_WASHER_FLUID, F.WARNING_BRAKE_FLUID,
  F.WARNING_TIRE_PRESSURE, F.WARNING_TIRE_PRESSURE_FL, F.WARNING_TIRE_PRESSURE_FR, F.WARNING_TIRE_PRESSURE_RL, F.WARNING_TIRE_PRESSURE_RR,
  F.TIRE_PRESSURE_FL, F.TIRE_PRESSURE_FR, F.TIRE_PRESSURE_RL, F.TIRE_PRESSURE_RR, F.WARNING_HEAD_LAMP]);

export function report(r) {
  if (![A.RECEIVED, A.STALE].includes(r.availability)) return null;
  if (typeof r.value === 'number') return 'NUMBER_HIDDEN';
  if (typeof r.value === 'boolean') return (BOOLEAN_REPORT[r.featureId] ?? (v => v ? 'ON' : 'OFF'))(r.value);
  if (ENUM_REPORT.has(r.value)) return r.value;
  throw new Error('UNPROJECTABLE_VALUE');
}

/** @param providers [{ provider, availability, reason, readings: [] }] readings only when the provider is bound and connected. */
export function externalCardProjection({ providers }) {
  let mock = false;
  const out = providers.map(({ provider, availability, reason, readings = [] }) => {
    const rows = readings.filter(r => PROJECTED.has(r.featureId));
    mock ||= rows.some(r => r.source === SOURCE.MOCK);
    // With rows, the provider line only says "connected and read"; every row carries its own state (some may have failed).
    return { provider, state: rows.length ? A.RECEIVED : availability, reason: rows.length ? null : reason ?? null,
      features: rows.map(r => ({ featureId: r.featureId, state: r.availability, reason: r.reason, report: report(r),
        observedAt: r.observedAt, observedAtUnzoned: r.observedAtZone === 'UNSPECIFIED' ? r.observedAtRaw : null, fetchedAt: r.fetchedAt })) };
  });
  return { schemaVersion: 1, source: mock ? SOURCE.MOCK : SOURCE.EXTERNAL_REST, providers: out };
}
