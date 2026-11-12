// VehicleDataNormalizer: official response shapes → common readings. Each mapping cites the spec page it follows
// (docs/p14-external-vehicle-data.md, section "응답 계약"). Anything outside the documented shape becomes a reading with no value.
// The raw response is not stored in a reading; callers keep it (server side only) if they need it, never in the UI projection.
import { AVAILABILITY as A, FEATURE as F, PROVIDER, QUALITY as Q, SOURCE, reading, emptyReading } from './model.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;

function base({ provider, featureId, vehicleBinding, fetchedAt, mock }) {
  return { provider, featureId, vehicleBinding, fetchedAt, source: mock ? SOURCE.MOCK : SOURCE.EXTERNAL_REST };
}
const quality = (ctx, documented = true) => ctx.mock ? Q.MOCK : documented ? Q.DOCUMENTED : Q.UNIT_UNVERIFIED;
const value = (ctx, featureId, v, unit, time, reason = null, documented = true) =>
  reading({ ...base({ ...ctx, featureId }), availability: A.RECEIVED, value: v, unit, dataQuality: quality(ctx, documented), ...time, reason });
const none = (ctx, featureId, availability, reason) => emptyReading(base({ ...ctx, featureId }), availability, reason);

// ───────────── Hyundai Developers (KR) ─────────────
// Times are "YYYYMMDDHHmmSS" with no zone stated in the spec, so no instant is derived from them.
const HYUNDAI_TIME = /^\d{14}$/;
const hyundaiTime = t => HYUNDAI_TIME.test(t ?? '') ? { observedAt: null, observedAtRaw: t, observedAtZone: 'UNSPECIFIED' }
  : { observedAt: null, observedAtRaw: null, observedAtZone: null };
// status_dte / status_odometer: unit (0: feet, 1: km, 2: meter, 3: miles)
const HYUNDAI_DISTANCE_UNIT = Object.freeze({ 0: 'feet', 1: 'km', 2: 'meter', 3: 'mile' });

export const hyundai = Object.freeze({
  /** data/status_odometer: { odometers: [{ date, timestamp, value (소수점 절사), unit }], msgId }. Documented as an object, shown as an array. */
  odometer(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.HYUNDAI_DEVELOPERS };
    const list = Array.isArray(body?.odometers) ? body.odometers : isObj(body?.odometers) ? [body.odometers] : null;
    if (!list || list.length === 0) return [none(ctxp, F.ODOMETER, A.NO_DATA, 'ODOMETER_ABSENT')];
    // More than one entry has no documented order or meaning; picking one would be a guess.
    if (list.length !== 1) return [none(ctxp, F.ODOMETER, A.INVALID_VALUE, 'ODOMETER_MULTIPLE_ENTRIES_UNSPECIFIED')];
    const o = list[0], unit = HYUNDAI_DISTANCE_UNIT[o?.unit];
    if (!isObj(o) || !num(o.value, 0, Number.MAX_SAFE_INTEGER) || !unit) return [none(ctxp, F.ODOMETER, A.INVALID_VALUE, 'ODOMETER_OUT_OF_CONTRACT')];
    return [value(ctxp, F.ODOMETER, o.value, unit, hyundaiTime(o.timestamp))];
  },
  /** data/status_dte: { timestamp, value, unit, phevTotalValue?, phevTotalUnit?, msgId } */
  distanceToEmpty(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.HYUNDAI_DEVELOPERS }, unit = HYUNDAI_DISTANCE_UNIT[body?.unit];
    if (!isObj(body) || !num(body.value, 0, Number.MAX_SAFE_INTEGER) || !unit) return [none(ctxp, F.DISTANCE_TO_EMPTY, A.INVALID_VALUE, 'DTE_OUT_OF_CONTRACT')];
    return [value(ctxp, F.DISTANCE_TO_EMPTY, body.value, unit, hyundaiTime(body.timestamp))];
  },
  /** data/status_evbattery: { soc (단위: %), timestamp, msgId } */
  evBattery(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.HYUNDAI_DEVELOPERS };
    if (!isObj(body) || !num(body.soc, 0, 100)) return [none(ctxp, F.EV_STATE_OF_CHARGE, A.INVALID_VALUE, 'SOC_OUT_OF_CONTRACT')];
    return [value(ctxp, F.EV_STATE_OF_CHARGE, body.soc, 'percent', hyundaiTime(body.timestamp))];
  },
  /** data/status_evcharging: batteryPlugin (0: 연결 안됨, 1: 급속 충전기 연결, 2: 일반 충전기 연결), batteryCharge (boolean), timestamp.
   *  soc is also present; it is read from status_evbattery only, so one feature never has two Hyundai values. */
  evCharging(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.HYUNDAI_DEVELOPERS }, time = hyundaiTime(body?.timestamp);
    const plug = { 0: 'DISCONNECTED', 1: 'FAST_CHARGER_CONNECTED', 2: 'NORMAL_CHARGER_CONNECTED' }[body?.batteryPlugin];
    return [
      plug ? value(ctxp, F.EV_PLUG, plug, null, time) : none(ctxp, F.EV_PLUG, A.INVALID_VALUE, 'PLUG_OUT_OF_CONTRACT'),
      typeof body?.batteryCharge === 'boolean' ? value(ctxp, F.EV_CHARGING, body.batteryCharge, null, time) : none(ctxp, F.EV_CHARGING, A.INVALID_VALUE, 'CHARGING_OUT_OF_CONTRACT'),
    ];
  },
  /** data/statuswarning_*: { status: boolean, msgId }. The spec gives no timestamp for warnings, so none is attached. */
  warning(ctx, featureId, body) {
    const ctxp = { ...ctx, provider: PROVIDER.HYUNDAI_DEVELOPERS };
    if (!isObj(body) || typeof body.status !== 'boolean') return [none(ctxp, featureId, A.INVALID_VALUE, 'WARNING_OUT_OF_CONTRACT')];
    return [value(ctxp, featureId, body.status, null, {}, 'PROVIDER_SENDS_NO_TIMESTAMP')];
  },
});
/** Warning path → feature. Paths are the spec's: /api/v1/car/status/warning/:carId/<path>. */
export const HYUNDAI_WARNINGS = Object.freeze({
  washerFluid: F.WARNING_WASHER_FLUID, breakOil: F.WARNING_BRAKE_FLUID, tirePressure: F.WARNING_TIRE_PRESSURE,
  lampWire: F.WARNING_LAMP_WIRE, engineOil: F.WARNING_ENGINE_OIL, smartKeyBattery: F.WARNING_SMART_KEY_BATTERY, lowFuel: F.WARNING_LOW_FUEL,
});

/** Hyundai error body { errId, errCode, errMsg } plus HTTP status → availability. Only codes seen in the spec are mapped by code. */
export function hyundaiError(status, body) {
  const code = typeof body?.errCode === 'string' && /^[0-9]{3,6}$/.test(body.errCode) ? body.errCode : null;
  if (code === '4045' || code === '4046') return { availability: A.NO_DATA, reason: `HYUNDAI_${code}` };
  if (status === 401) return { availability: A.AUTH_EXPIRED, reason: 'HTTP_401' };
  if (status === 429) return { availability: A.RATE_LIMITED, reason: 'HTTP_429' };
  return { availability: A.PROVIDER_ERROR, reason: code ? `HYUNDAI_${code}` : `HTTP_${Number.isSafeInteger(status) ? status : 0}` };
}

// ───────────── Pleos Vehicle Data API (EU) ─────────────
const PLEOS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const pleosTime = t => PLEOS_TIME.test(t ?? '') && !Number.isNaN(Date.parse(t)) ? { observedAt: t, observedAtRaw: t, observedAtZone: 'UTC' }
  : { observedAt: null, observedAtRaw: null, observedAtZone: null };
const PLEOS_DISTANCE_UNIT = Object.freeze({ km: 'km', mile: 'mile', miles: 'mile', meter: 'meter', feet: 'feet' });
// get-vehicle-status: tire[].unit; "psi: 원시 값 그대로, kpa: × 5, bar: ÷ 10"; 0~254 valid, 255 invalid.
const PRESSURE = Object.freeze({ psi: v => v, kpa: v => v * 5, bar: v => v / 10 });
const PLEOS_WARNING = Object.freeze({ washFluid: F.WARNING_WASHER_FLUID, brakeOil: F.WARNING_BRAKE_FLUID, engineOil: F.WARNING_ENGINE_OIL,
  lowFuel: F.WARNING_LOW_FUEL, smartKeyBattery: F.WARNING_SMART_KEY_BATTERY, frontHeadLamp: F.WARNING_HEAD_LAMP });
const PLEOS_WHEEL_WARNING = Object.freeze({ tirePressureFrontLeft: F.WARNING_TIRE_PRESSURE_FL, tirePressureFrontRight: F.WARNING_TIRE_PRESSURE_FR,
  tirePressureRearLeft: F.WARNING_TIRE_PRESSURE_RL, tirePressureRearRight: F.WARNING_TIRE_PRESSURE_RR });
const PLEOS_KNOWN_WARNINGS = new Set([...Object.keys(PLEOS_WARNING), ...Object.keys(PLEOS_WHEEL_WARNING), 'tirePressureLow',
  'frontLeftTurnSignal', 'frontRightTurnSignal', 'rearLeftStopLamp', 'rearRightStopLamp', 'rearLeftTurnSignal', 'rearRightTurnSignal']);

const data = body => isObj(body) && isObj(body.data) ? body.data : null;

export const pleos = Object.freeze({
  /** GET /v1/vehicles/{vin}/status: tire[0 front, 1 rear].{left,right,unit}, warnings[], timestamp (UTC). */
  vehicleStatus(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.PLEOS_VEHICLE_DATA }, d = data(body), out = [];
    const time = pleosTime(d?.timestamp);
    const wheels = [[0, 'left', F.TIRE_PRESSURE_FL], [0, 'right', F.TIRE_PRESSURE_FR], [1, 'left', F.TIRE_PRESSURE_RL], [1, 'right', F.TIRE_PRESSURE_RR]];
    for (const [row, side, featureId] of wheels) {
      const axle = Array.isArray(d?.tire) ? d.tire[row] : undefined, raw = axle?.[side], convert = PRESSURE[axle?.unit];
      if (axle === undefined || raw === null || raw === undefined) out.push(none(ctxp, featureId, A.FEATURE_UNSUPPORTED, 'PROVIDER_NULL_NOT_COLLECTED'));
      else if (raw === 255) out.push(none(ctxp, featureId, A.INVALID_VALUE, 'PLEOS_255_INVALID'));
      else if (!Number.isInteger(raw) || raw < 0 || raw > 254 || !convert) out.push(none(ctxp, featureId, A.INVALID_VALUE, 'TIRE_OUT_OF_CONTRACT'));
      else out.push(value(ctxp, featureId, convert(raw), axle.unit, time));
    }
    const warnings = d?.warnings;
    const all = [...Object.values(PLEOS_WARNING), F.WARNING_TIRE_PRESSURE, ...Object.values(PLEOS_WHEEL_WARNING)];
    if (warnings === null || warnings === undefined) return [...out, ...all.map(f => none(ctxp, f, A.FEATURE_UNSUPPORTED, 'PROVIDER_NULL_NOT_COLLECTED'))];
    if (!Array.isArray(warnings) || !warnings.every(w => typeof w === 'string' && PLEOS_KNOWN_WARNINGS.has(w)) || new Set(warnings).size !== warnings.length)
      return [...out, ...all.map(f => none(ctxp, f, A.INVALID_VALUE, 'WARNINGS_OUT_OF_CONTRACT'))];
    // An active-warning list: present = reported, absent = not reported. "Not reported" is not "fine"; the UI says so.
    for (const [key, f] of Object.entries(PLEOS_WARNING)) out.push(value(ctxp, f, warnings.includes(key), null, time));
    const anyTire = warnings.some(w => w === 'tirePressureLow' || w in PLEOS_WHEEL_WARNING);
    out.push(value(ctxp, F.WARNING_TIRE_PRESSURE, anyTire, null, time));
    // tirePressureLow is for vehicles without per-wheel pressure: then a wheel's absence says nothing about that wheel.
    for (const [key, f] of Object.entries(PLEOS_WHEEL_WARNING)) {
      out.push(warnings.includes('tirePressureLow') && !warnings.includes(key) ? none(ctxp, f, A.FEATURE_UNSUPPORTED, 'VEHICLE_WARNING_NOT_PER_WHEEL')
        : value(ctxp, f, warnings.includes(key), null, time));
    }
    return out;
  },
  /** GET /v1/vehicles/{vin}/batteries: charge.{plugin, status, charging, stateOfCharge (%, 0~100, 255 invalid), ...}, timestamp. */
  batteryCharging(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.PLEOS_VEHICLE_DATA }, d = data(body), c = d?.charge, time = pleosTime(d?.timestamp);
    if (!isObj(c)) return [F.EV_PLUG, F.EV_CHARGING, F.EV_STATE_OF_CHARGE].map(f => none(ctxp, f, A.FEATURE_UNSUPPORTED, 'PROVIDER_NULL_NOT_COLLECTED'));
    const plug = { connected: 'CONNECTED', disconnected: 'DISCONNECTED' }[c.plugin];
    return [
      plug ? value(ctxp, F.EV_PLUG, plug, null, time) : none(ctxp, F.EV_PLUG, c.plugin === 'invalid' ? A.INVALID_VALUE : c.plugin == null ? A.FEATURE_UNSUPPORTED : A.INVALID_VALUE, c.plugin === 'invalid' ? 'PLEOS_INVALID' : 'PLUG_OUT_OF_CONTRACT'),
      typeof c.charging === 'boolean' ? value(ctxp, F.EV_CHARGING, c.charging, null, time) : none(ctxp, F.EV_CHARGING, c.charging == null ? A.FEATURE_UNSUPPORTED : A.INVALID_VALUE, 'CHARGING_OUT_OF_CONTRACT'),
      c.stateOfCharge === 255 ? none(ctxp, F.EV_STATE_OF_CHARGE, A.INVALID_VALUE, 'PLEOS_255_INVALID')
        : num(c.stateOfCharge, 0, 100) ? value(ctxp, F.EV_STATE_OF_CHARGE, c.stateOfCharge, 'percent', time)
          : none(ctxp, F.EV_STATE_OF_CHARGE, c.stateOfCharge == null ? A.FEATURE_UNSUPPORTED : A.INVALID_VALUE, 'SOC_OUT_OF_CONTRACT'),
    ];
  },
  /** GET /v1/vehicles/{vin}/driving: odometer.{value (0~16777214), unit (km, mile, meter, feet, invalid)}, timestamp. */
  operationStatus(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.PLEOS_VEHICLE_DATA }, d = data(body), o = d?.odometer;
    if (o === null || o === undefined) return [none(ctxp, F.ODOMETER, A.FEATURE_UNSUPPORTED, 'PROVIDER_NULL_NOT_COLLECTED')];
    if (o?.unit === 'invalid') return [none(ctxp, F.ODOMETER, A.INVALID_VALUE, 'PLEOS_INVALID')];
    const unit = o?.unit === 'miles' ? null : PLEOS_DISTANCE_UNIT[o?.unit]; // Operation Status documents "mile", not "miles"
    if (!unit || !num(o.value, 0, 16_777_214)) return [none(ctxp, F.ODOMETER, A.INVALID_VALUE, 'ODOMETER_OUT_OF_CONTRACT')];
    return [value(ctxp, F.ODOMETER, o.value, unit, pleosTime(d.timestamp))];
  },
  /** GET /v1/vehicles/{vin}/powertrains: distanceToEmpties[{type, value (string, 1~4095), unit (feet, km, meter, miles, invalid)}]. */
  powertrainStatus(ctx, body) {
    const ctxp = { ...ctx, provider: PROVIDER.PLEOS_VEHICLE_DATA }, d = data(body), list = d?.distanceToEmpties;
    if (list === null || list === undefined) return [none(ctxp, F.DISTANCE_TO_EMPTY, A.FEATURE_UNSUPPORTED, 'PROVIDER_NULL_NOT_COLLECTED')];
    if (!Array.isArray(list) || list.length === 0) return [none(ctxp, F.DISTANCE_TO_EMPTY, A.INVALID_VALUE, 'DTE_OUT_OF_CONTRACT')];
    // Several entries (e.g. a PHEV's EV and ICE ranges) have no documented combined meaning; none is chosen.
    if (list.length !== 1) return [none(ctxp, F.DISTANCE_TO_EMPTY, A.INVALID_VALUE, 'DTE_MULTIPLE_ENTRIES_UNSPECIFIED')];
    const e = list[0];
    if (e?.unit === 'invalid' || e?.type === 'invalid' || e?.value === 'invalid') return [none(ctxp, F.DISTANCE_TO_EMPTY, A.INVALID_VALUE, 'PLEOS_INVALID')];
    const unit = e?.unit === 'mile' ? null : PLEOS_DISTANCE_UNIT[e?.unit]; // Powertrain Status documents "miles"
    const n = typeof e?.value === 'string' && /^[1-9][0-9]{0,3}$/.test(e.value) ? Number(e.value) : NaN;
    if (!unit || !(n >= 1 && n <= 4095) || !['ICE', 'EV', 'HEV', 'PHEV', 'FCEV'].includes(e.type)) return [none(ctxp, F.DISTANCE_TO_EMPTY, A.INVALID_VALUE, 'DTE_OUT_OF_CONTRACT')];
    return [value(ctxp, F.DISTANCE_TO_EMPTY, n, unit, pleosTime(d.timestamp))];
  },
});

/** Pleos error { error: { code, message, details, timestamp, requestId } } → availability (error-code page). */
export function pleosError(status, body) {
  const code = typeof body?.error?.code === 'string' && /^[0-9]{3,6}$/.test(body.error.code) ? body.error.code : null;
  const map = { 401: A.AUTH_EXPIRED, 4011: A.AUTH_EXPIRED, 40002: A.AUTH_EXPIRED, 4009: A.AUTH_EXPIRED, 5006: A.CONSENT_REQUIRED, 4101: A.CONSENT_REQUIRED,
    4045: A.NO_DATA, 403: A.PROVIDER_ERROR, 404: A.PROVIDER_ERROR, 4002: A.PROVIDER_ERROR, 5001: A.PROVIDER_ERROR };
  if (code && map[code]) return { availability: map[code], reason: `PLEOS_${code}` };
  if (status === 429) return { availability: A.RATE_LIMITED, reason: 'HTTP_429' };
  return { availability: A.PROVIDER_ERROR, reason: code ? `PLEOS_${code}` : `HTTP_${Number.isSafeInteger(status) ? status : 0}` };
}
