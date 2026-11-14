import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEMS, NEVER_WRITE, VERDICT, writePlan, stateDiff, layerVerdict, combine, cardShows, storeShows, lastStatusFromLog } from '../avd-sdk-e2e-plan.mjs';

const state = { gear: { actual: { value: 'Drive' } }, odometer: { traveled_distance_km: 951700 },
  ev_battery: { state_of_charge: 100, charging_activated: false, charging_door_opened: false },
  body: { wipers: { front: { mode: 'Off' } }, doors: { front_left: false } }, lights: { high_beam_on: false, headlamp_mode: 'Off' } };
const byId = (plan) => Object.fromEntries(plan.map((p) => [p.item.id, p]));

test('without approval nothing is written, and the odometer is never written even with every approval', () => {
  assert.ok(writePlan(ITEMS, state).every((p) => !p.write));
  const all = byId(writePlan(ITEMS, state, { approveWrites: true, approveUi: true }));
  assert.equal(all.odometer.write, false);
  assert.match(all.odometer.reason, /IRREVERSIBLE/);
  assert.ok(NEVER_WRITE.includes('odometer.traveled_distance_km'));
  for (const id of ['soc', 'charge-switch', 'charge-port', 'wiper-front', 'high-beam', 'low-beam', 'door-front-left']) assert.equal(all[id].write, true, id);
  // every written item is set back to the value it started with
  assert.deepEqual([all.soc.initial, all.soc.test], [100, 80]);
  assert.deepEqual([all['low-beam'].initial, all['low-beam'].test], ['Off', 'LowBeam']);
});

test('writes needing the app driven wait for UI approval, and unknown expectations are not written', () => {
  const noUi = byId(writePlan(ITEMS, state, { approveWrites: true }));
  assert.equal(noUi['charge-switch'].reason, 'NEEDS_UI_APPROVAL'); // a new session's getter is the only way to see it
  assert.equal(noUi['door-front-left'].reason, 'NEEDS_UI_APPROVAL');
  assert.equal(noUi.soc.write, true);
  const auto = byId(writePlan(ITEMS, { ...state, lights: { ...state.lights, headlamp_mode: 'Auto' } }, { approveWrites: true, approveUi: true }));
  assert.equal(auto['low-beam'].write, false); // Auto's reported low-beam state is not known in advance
  assert.equal(auto['low-beam'].reason, 'EXPECTED_SDK_VALUE_UNKNOWN');
  const missing = byId(writePlan(ITEMS, { ...state, ev_battery: {} }, { approveWrites: true, approveUi: true }));
  assert.equal(missing.soc.reason, 'INITIAL_VALUE_UNKNOWN');
});

test('MOCK is never a PASS, and each layer keeps its own verdict', () => {
  assert.equal(layerVerdict({ ran: true, observed: true, source: 'MOCK' }), VERDICT.NOT_PLEOS);
  assert.equal(layerVerdict({ ran: true, observed: true, source: 'PLEOS' }), VERDICT.PASS);
  assert.equal(layerVerdict({ ran: false, observed: true }), VERDICT.NOT_RUN);
  assert.equal(combine([VERDICT.PASS, VERDICT.NOT_RUN, VERDICT.PASS]), VERDICT.PASS);
  assert.equal(combine([VERDICT.PASS, VERDICT.NOT_PLEOS]), VERDICT.NOT_PLEOS);
  assert.equal(combine([VERDICT.NOT_RUN]), VERDICT.NOT_RUN);
  const mock = cardShows({ text: '충전구 충전구가 열려 있다고 보고됐어요. 출처 테스트용 모의 데이터(MOCK)' }, '열려');
  assert.deepEqual(mock, { observed: false, source: 'MOCK' });
  assert.equal(cardShows({ text: '충전구 충전구가 닫혀 있다고 보고됐어요. 출처 차량 SDK' }, '열려').observed, false);
  assert.equal(cardShows({ text: '충전구 충전구가 열려 있다고 보고됐어요. 출처 차량 SDK' }, '열려').observed, true);
  assert.equal(cardShows(null, '열려').observed, false);
});

test('a received value counts even when UNVERIFIED or STALE, but not from MOCK or with another value', () => {
  const r = (availabilityStatus, value = 80, source = 'PLEOS') => ({ availabilityStatus, value, source });
  assert.equal(storeShows(r('UNVERIFIED'), 80).observed, true); // unit/meaning withheld by policy, the reading is real
  assert.deepEqual(storeShows(r('STALE'), 80), { observed: true, source: 'PLEOS', stale: true });
  assert.equal(storeShows(r('UNVERIFIED', 100), 80).observed, false);
  assert.equal(storeShows(r('SUPPORTED', 80, 'MOCK'), 80).observed, false);
  assert.equal(storeShows(r('ERROR', null), 80).observed, false);
});

test('the before/after comparison reports every difference', () => {
  const after = { ...state, odometer: { traveled_distance_km: 951800 } };
  const d = stateDiff(state, after, ['odometer.traveled_distance_km', 'gear.actual.value']);
  assert.deepEqual(d.map((x) => x.same), [false, true]);
});

test('the read-only log summary keeps the last status per feature, including the SDK error code', () => {
  const lines = [
    'I CarScopeComponent: capability ev-battery.soc readable=true values=null',
    'I CarScopeComponent: event ev-battery.soc raw=Integer(value=80) receivedAt=1',
    'I CarScopeComponent: failed safety.washer-fluid-warning status=ERROR type=a class=ai.pleos.playground.vehicle.callback.exception.a sdkError=ERROR_NOT_SUPPORTED_PROPERTY',
    'I CarScopeTire: capability tire.low-pressure access=READ areas=[]',
  ];
  const s = lastStatusFromLog(lines);
  assert.deepEqual(s['ev-battery.soc'], { kind: 'received', detail: 'Integer(value=80)' });
  assert.match(s['safety.washer-fluid-warning'].detail, /sdkError=ERROR_NOT_SUPPORTED_PROPERTY/);
  assert.equal(s['tire.low-pressure'].kind, 'capability');
});

test('the runner only writes through the approval-gated path and keeps evidence outside the repository', () => {
  const src = readFileSync(new URL('../avd-sdk-e2e.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/method: 'PUT'/g) ?? []).length, 1);
  assert.match(src, /if \(!approveWrites\) throw Error\('WRITE_NOT_APPROVED'\)/);
  assert.match(src, /An --out outside the repository is required/);
  assert.doesNotMatch(src, /logcat', '-c'|'logcat', '-b', 'all', '-c'/);
  assert.doesNotMatch(src, /traveled_distance_km:/); // no code path builds an odometer write
});
