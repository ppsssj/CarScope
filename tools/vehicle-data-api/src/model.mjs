// P14-B common external vehicle data model. One reading = one feature from one provider for one bound vehicle.
// Nothing here is invented: a field the provider does not send stays null and says why in `reason`.
// observedAt (when the provider says the vehicle produced the value) and fetchedAt (when CarScope's server received it) are
// different facts, and neither is the Pleos SDK's callback time. They are never merged or substituted for each other.

export const PROVIDER = Object.freeze({ HYUNDAI_DEVELOPERS: 'HYUNDAI_DEVELOPERS', PLEOS_VEHICLE_DATA: 'PLEOS_VEHICLE_DATA' });
// PLEOS (the in-car SDK) is a separate source on its own Native channel. It is listed so a REST reading can never claim it.
export const SOURCE = Object.freeze({ EXTERNAL_REST: 'EXTERNAL_REST', MOCK: 'MOCK' });

/** Provider/feature state. The UI distinguishes every one of these; none of them is a verdict about the car. */
export const AVAILABILITY = Object.freeze({
  DISABLED: 'DISABLED',                     // default: no operator approval for this provider
  NOT_CONFIGURED: 'NOT_CONFIGURED',         // approved, but developer project credentials or redirect URLs are missing
  BLOCKED: 'BLOCKED',                       // configured, but a prerequisite (secure token store, consent flow) is not available
  NOT_CONNECTED: 'NOT_CONNECTED',           // no account linked for this person
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',     // no data-sharing consent, or it was withdrawn
  REGION_UNSUPPORTED: 'REGION_UNSUPPORTED', // provider does not serve the vehicle's region
  FEATURE_UNSUPPORTED: 'FEATURE_UNSUPPORTED', // provider has no documented API for it, or the vehicle does not send it
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',         // outage, timeout, malformed response, redirect
  NO_DATA: 'NO_DATA',                       // provider answered "no data" for this vehicle
  INVALID_VALUE: 'INVALID_VALUE',           // provider sent its documented "invalid" marker or an out-of-range value
  STALE: 'STALE',                           // CarScope's copy is older than the server cache window
  RECEIVED: 'RECEIVED',
});

/** Normalized features. Each has a documented source in docs/p14-external-vehicle-data.md; nothing else is accepted. */
export const FEATURE = Object.freeze({
  ODOMETER: 'odometer',
  DISTANCE_TO_EMPTY: 'distance-to-empty',
  EV_STATE_OF_CHARGE: 'ev.state-of-charge',
  EV_CHARGING: 'ev.charging',
  EV_PLUG: 'ev.plug',
  WARNING_WASHER_FLUID: 'warning.washer-fluid',
  WARNING_BRAKE_FLUID: 'warning.brake-fluid',
  WARNING_TIRE_PRESSURE: 'warning.tire-pressure',
  WARNING_TIRE_PRESSURE_FL: 'warning.tire-pressure.front-left',
  WARNING_TIRE_PRESSURE_FR: 'warning.tire-pressure.front-right',
  WARNING_TIRE_PRESSURE_RL: 'warning.tire-pressure.rear-left',
  WARNING_TIRE_PRESSURE_RR: 'warning.tire-pressure.rear-right',
  TIRE_PRESSURE_FL: 'tire.pressure.front-left',
  TIRE_PRESSURE_FR: 'tire.pressure.front-right',
  TIRE_PRESSURE_RL: 'tire.pressure.rear-left',
  TIRE_PRESSURE_RR: 'tire.pressure.rear-right',
  WARNING_HEAD_LAMP: 'warning.head-lamp',
  WARNING_LAMP_WIRE: 'warning.lamp-wire',
  WARNING_ENGINE_OIL: 'warning.engine-oil',
  WARNING_SMART_KEY_BATTERY: 'warning.smart-key-battery',
  WARNING_LOW_FUEL: 'warning.low-fuel',
});
const FEATURES = new Set(Object.values(FEATURE));
const AVAILABILITIES = new Set(Object.values(AVAILABILITY));

/** How much is known about a value. Documented ≠ verified on a real account. */
export const QUALITY = Object.freeze({
  DOCUMENTED: 'DOCUMENTED',   // field, meaning and unit are in the official spec; not yet seen from a live account
  UNIT_UNVERIFIED: 'UNIT_UNVERIFIED', // the spec does not state the unit or the meaning precisely enough to show or compute
  MOCK: 'MOCK',
  NONE: 'NONE',               // no value
});

export const UNITS = Object.freeze(['km', 'mile', 'meter', 'feet', 'percent', 'psi', 'kpa', 'bar', 'minute', 'hour', 'second', 'millisecond']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const KEYS = ['provider', 'featureId', 'vehicleBinding', 'source', 'availability', 'observedAt', 'observedAtRaw', 'observedAtZone', 'fetchedAt', 'value', 'unit', 'dataQuality', 'reason'];

/**
 * Validated, frozen reading. `vehicleBinding` is the server-side binding id (never a carId or VIN).
 * observedAt is ISO-8601 UTC only when the provider states the zone; otherwise null and observedAtRaw keeps the provider's text.
 */
export function reading(r) {
  const x = { observedAt: null, observedAtRaw: null, observedAtZone: null, value: null, unit: null, reason: null, ...r };
  if (Object.keys(x).length !== KEYS.length || !KEYS.every(k => Object.hasOwn(x, k))) throw new Error('INVALID_READING_SHAPE');
  if (!Object.values(PROVIDER).includes(x.provider) || !FEATURES.has(x.featureId) || !Object.values(SOURCE).includes(x.source) ||
      !AVAILABILITIES.has(x.availability) || !Object.values(QUALITY).includes(x.dataQuality)) throw new Error('INVALID_READING_ENUM');
  if (typeof x.vehicleBinding !== 'string' || !/^vb_[A-Za-z0-9_-]{16,64}$/.test(x.vehicleBinding)) throw new Error('INVALID_READING_BINDING');
  if (typeof x.fetchedAt !== 'string' || !ISO_UTC.test(x.fetchedAt)) throw new Error('INVALID_READING_FETCHED_AT');
  if (x.observedAt !== null && (typeof x.observedAt !== 'string' || !ISO_UTC.test(x.observedAt))) throw new Error('INVALID_READING_OBSERVED_AT');
  if (x.observedAtZone !== null && !['UTC', 'UNSPECIFIED'].includes(x.observedAtZone)) throw new Error('INVALID_READING_ZONE');
  if (x.observedAt !== null && x.observedAtZone !== 'UTC') throw new Error('INVALID_READING_ZONE');
  if (x.unit !== null && !UNITS.includes(x.unit)) throw new Error('INVALID_READING_UNIT');
  if (x.value !== null && !['number', 'boolean', 'string'].includes(typeof x.value)) throw new Error('INVALID_READING_VALUE');
  if (typeof x.value === 'number' && !Number.isFinite(x.value)) throw new Error('INVALID_READING_VALUE');
  const hasValue = x.value !== null;
  if (hasValue !== [AVAILABILITY.RECEIVED, AVAILABILITY.STALE].includes(x.availability)) throw new Error('INVALID_READING_VALUE_STATE');
  if (!hasValue && (x.unit !== null || x.dataQuality !== QUALITY.NONE)) throw new Error('INVALID_READING_VALUE_STATE');
  if (hasValue && x.dataQuality === QUALITY.NONE) throw new Error('INVALID_READING_VALUE_STATE');
  if ((x.source === SOURCE.MOCK) !== (x.dataQuality === QUALITY.MOCK) && hasValue) throw new Error('INVALID_READING_SOURCE');
  if (x.reason !== null && (typeof x.reason !== 'string' || !/^[A-Z0-9_]{2,64}$/.test(x.reason))) throw new Error('INVALID_READING_REASON');
  return Object.freeze(x);
}

/** A reading with no value: every non-received state. */
export const emptyReading = (base, availability, reason) =>
  reading({ ...base, availability, reason, value: null, unit: null, dataQuality: QUALITY.NONE, observedAt: null, observedAtRaw: null, observedAtZone: null });

/** True only when both the unit and the meaning are documented. The driver UI still shows no numbers in this PR. */
export const computable = r => r.availability === AVAILABILITY.RECEIVED && r.dataQuality === QUALITY.DOCUMENTED && r.unit !== null;
