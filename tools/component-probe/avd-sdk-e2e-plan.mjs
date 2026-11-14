// Pleos Virtual Console -> Vehicle SDK -> CarScope E2E: the pure part (items, write policy, verdicts, state diff).
// The runner (avd-sdk-e2e.mjs) does the I/O. Nothing here talks to adb, the console or a WebView.
//
// Three layers are judged separately and never merged into one PASS:
//   sdk    the app's own SDK callback/getter log line (CarScopeComponent / CarScopeDoor), the real SDK path
//   store  the WebView store fed by the Native cache channel (component/charge/visibility status JSON)
//   card   the text the driver sees in the 3D page card (or the native door text)
// A UNVERIFIED availability with a received value is a received value: the app withholds unit/meaning, not the reading.

export const VERDICT = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_RUN: 'NOT_RUN', BLOCKED: 'BLOCKED', NOT_PLEOS: 'NOT_PLEOS' });

const onOff = (v) => (v ? 'ON' : 'OFF');
const lowBeam = (mode) => ({ Off: 'OFF', LowBeam: 'ON' })[mode] ?? null; // Auto/Position: the reported low-beam state is not known in advance

/**
 * write: null means the runner never changes this property. reversible writes only; test(initial) picks the value
 * to set, and the runner always sets the initial value back. sdk(v) is the raw value the app should log for console value v.
 */
export const ITEMS = Object.freeze([
  { id: 'odometer', feature: 'odometer.distance-driven', screen: 'summary', consolePath: 'odometer.traveled_distance_km',
    write: null, readOnlyReason: 'IRREVERSIBLE: the console rejects a decrease (400 traveled_distance_must_not_decrease)',
    sdk: (v) => `${Number(v).toFixed(1)}`, log: (raw) => `odometer.distance-driven raw=Decimal(value=${raw})` },
  { id: 'soc', feature: 'ev-battery.soc', store: 'componentStatus', screen: 'ev-battery', consolePath: 'ev_battery.state_of_charge',
    write: { endpoint: '/vehicle/ev-battery', params: (v) => ({ field: 'soc', value: v }), test: (s) => (s === 80 ? 70 : 80) },
    sdk: (v) => v, log: (raw) => `ev-battery.soc raw=Integer(value=${raw})`, words: null /* the card never shows the number */ },
  { id: 'charge-switch', feature: 'ev-battery.charge-switch', store: 'componentStatus', screen: 'ev-battery', consolePath: 'ev_battery.charging_activated',
    write: { endpoint: '/vehicle/ev-battery', params: (v) => ({ field: 'charge_switch', value: v }), test: (s) => !s },
    sessionRestart: true, // Vehicle 2.3.2 has no public listener: only a new session's getter sees a change
    sdk: (v) => v, log: (raw) => `current ev-battery.charge-switch raw=Flag(value=${raw})`, words: (v) => (v ? '켜짐' : '꺼짐') },
  { id: 'charge-port', feature: 'ev-charge.port-open', store: 'chargePortStatus', screen: 'result', part: 'ev-charge.port', consolePath: 'ev_battery.charging_door_opened',
    write: { endpoint: '/vehicle/ev-battery', params: (v) => ({ field: 'charge_port_open', value: v }), test: (s) => !s },
    sdk: (v) => v, log: (raw) => `ev-charge.port-open raw=Flag(value=${raw})`, words: (v) => (v ? '열려' : '닫혀') },
  { id: 'wiper-front', feature: 'wiper.front.state', store: 'visibilityStatus', screen: 'result', part: 'wiper.front.left', consolePath: 'body.wipers.front.mode',
    write: { endpoint: '/vehicle/body', params: (v) => ({ front_wiper: v }), test: (s) => (s === 'Off' ? 'Low' : 'Off') },
    sdk: (v) => (v === 'Off' ? 'OFF' : 'ON'), log: (raw) => `wiper.front.state raw=Mode(value=${raw})`, words: (v) => (v === 'Off' ? '꺼짐' : '켜짐') },
  { id: 'high-beam', feature: 'light.high-beam', store: 'visibilityStatus', screen: 'result', part: 'light-high-beam-left-0', consolePath: 'lights.high_beam_on',
    write: { endpoint: '/vehicle/lights', params: (v) => ({ feature: 'high_beam', value: v }), test: (s) => !s },
    sdk: onOff, log: (raw) => `light.high-beam raw=Mode(value=${raw})`, words: (v) => (v ? '켜짐' : '꺼짐') },
  { id: 'low-beam', feature: 'light.low-beam', store: 'visibilityStatus', screen: 'result', part: 'light-low-beam-left-0', consolePath: 'lights.headlamp_mode',
    write: { endpoint: '/vehicle/lights', params: (v) => ({ feature: 'headlamp_mode', value: v }), test: (s) => (s === 'Off' ? 'LowBeam' : s === 'LowBeam' ? 'Off' : null) },
    sdk: lowBeam, log: (raw) => `light.low-beam raw=Mode(value=${raw})`, words: (v) => (lowBeam(v) === 'ON' ? '켜짐' : '꺼짐') },
  { id: 'door-front-left', feature: 'door.front-left', screen: 'main', consolePath: 'body.doors.front_left',
    write: { endpoint: '/vehicle/body', params: (v) => ({ door_fl: v }), test: (s) => !s },
    sdk: (v) => (v ? 1 : 0), log: (raw) => `ROW_1_LEFT · event raw=${raw}`, nativeWords: (v) => `FRONT_LEFT: ${v ? 'OPEN' : 'CLOSED'}` },
]);

/** Never written by any mode, whatever the flags: reaching these needs a console or emulator reset. */
export const NEVER_WRITE = Object.freeze(['odometer.traveled_distance_km', 'odometer.usage_time_min']);

export const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/** Which items the runner may change. Read-only unless the console write is approved; never an irreversible property. */
export function writePlan(items, initialState, { approveWrites = false, approveUi = false } = {}) {
  return items.map((item) => {
    const initial = get(initialState, item.consolePath);
    if (!item.write || NEVER_WRITE.includes(item.consolePath)) return { item, initial, write: false, reason: item.readOnlyReason ?? 'READ_ONLY_ITEM' };
    if (!approveWrites) return { item, initial, write: false, reason: 'WRITE_NOT_APPROVED' };
    if (initial === undefined || initial === null) return { item, initial, write: false, reason: 'INITIAL_VALUE_UNKNOWN' };
    if ((item.sessionRestart || item.screen === 'main') && !approveUi) return { item, initial, write: false, reason: 'NEEDS_UI_APPROVAL' };
    const test = item.write.test(initial);
    if (test === null || test === undefined || item.sdk(test) === null || item.sdk(initial) === null) return { item, initial, write: false, reason: 'EXPECTED_SDK_VALUE_UNKNOWN' };
    return { item, initial, write: true, test };
  });
}

/** Compare the console state before and after. Paths are the items' properties plus the gear. */
export function stateDiff(before, after, paths) {
  return paths.map((path) => ({ path, before: get(before, path), after: get(after, path) }))
    .map((d) => ({ ...d, same: JSON.stringify(d.before) === JSON.stringify(d.after) }));
}

/** One layer's verdict for one phase. MOCK or a non-SDK source is never a PASS. */
export function layerVerdict({ ran, observed, source }) {
  if (!ran) return VERDICT.NOT_RUN;
  if (source && source !== 'PLEOS') return VERDICT.NOT_PLEOS;
  return observed ? VERDICT.PASS : VERDICT.FAIL;
}

/** Combine phases (change, restore) of one layer: PASS only if every phase that ran passed. */
export function combine(verdicts) {
  const ran = verdicts.filter((v) => v !== VERDICT.NOT_RUN);
  if (!ran.length) return VERDICT.NOT_RUN;
  for (const bad of [VERDICT.NOT_PLEOS, VERDICT.BLOCKED, VERDICT.FAIL]) if (ran.includes(bad)) return bad;
  return VERDICT.PASS;
}

/** Card text check: the feature row exists, comes from the vehicle SDK, and states the expected words. */
export function cardShows(row, words) {
  if (!row) return { observed: false, source: null };
  const source = /출처 차량 SDK/.test(row.text) ? 'PLEOS' : /MOCK/.test(row.text) ? 'MOCK' : null;
  return { observed: source === 'PLEOS' && (!words || row.text.includes(words)), source };
}

/**
 * Store check: the reading carries the expected raw value from the PLEOS source. UNVERIFIED (unit/meaning withheld) and
 * STALE (no new report for 5 s, the value is kept and shown as old) both still carry the received value; stale is reported.
 */
export function storeShows(reading, expected) {
  if (!reading) return { observed: false, source: null, stale: false };
  return { observed: reading.source === 'PLEOS' && reading.value === expected && ['SUPPORTED', 'UNVERIFIED', 'STALE'].includes(reading.availabilityStatus),
    source: reading.source, stale: reading.availabilityStatus === 'STALE' };
}

/** Last app-side status per feature from CarScopeComponent/CarScopeTire log lines (read-only mode). */
export function lastStatusFromLog(lines) {
  const out = {};
  for (const line of lines) {
    let m = line.match(/CarScope(?:Component|Tire): capability (\S+) (.*)$/); if (m) out[m[1]] = { kind: 'capability', detail: m[2] };
    m = line.match(/CarScope(?:Component|Tire): failed (\S+) (.*)$/); if (m) out[m[1]] = { kind: 'failed', detail: m[2] };
    m = line.match(/CarScopeComponent: (?:event|current) (\S+) raw=(.*) receivedAt=/); if (m) out[m[1]] = { kind: 'received', detail: m[2] };
  }
  return out;
}
