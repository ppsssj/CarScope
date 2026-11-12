// P14: the per-part status card and the Odometer consumer. Pure projections of cache snapshots; no SDK, no page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSPECTION_PARTS } from '../inspection-parts.mjs';
import { vehicleStatusCardHtml, odometerCardHtml, sdkFeaturesForPart, sdkRowWords, conflictWords } from '../vehicle-status-card.mjs';
import { validateOdometerStatus, odometerBlank } from '../odometer-status.mjs';
import { vehiclePartCapabilities } from '../inspection-results-view.mjs';
import { projectInspectionResults } from '../inspection-results.mjs';
import { createTireInspection } from '../tire-inspection.mjs';

const row = (featureId, value, availabilityStatus = 'SUPPORTED', extra = {}) => ({ featureId, vehiclePartId: 'x', capabilityStatus: 'SUPPORTED', availabilityStatus, source: 'PLEOS', observedAt: value === null ? null : 1_700_000_000_000, value, unit: null, ...extra });
const attached = readings => ({ connectionStatus: 'ATTACHED', readings });
const tireState = (status = 'SUPPORTED') => ({ connectionStatus: 'ATTACHED', source: 'PLEOS', features: ['tire.pressure', 'tire.low-pressure'].map(featureId => ({ featureId, vehiclePartId: 't', capabilityStatus: 'SUPPORTED', availabilityStatus: status, observedAt: 1_700_000_000_000, source: 'PLEOS' })) });
const sdk = (over = {}) => ({ component: attached([row('safety.washer-fluid-warning', true), row('safety.brake-fluid-level', 'NORMAL'), row('ev-battery.soc', 73, 'UNVERIFIED'), row('ev-battery.charge-switch', false)]),
  charge: attached([row('ev-charge.port-open', true)]), visibility: attached([row('wiper.front.state', 'ON'), row('light.low-beam', 'OFF'), row('light.high-beam', 'DAYTIME_RUNNING')]), tire: tireState(), ...over });
const local = createTireInspection('local');
const userRow = partId => projectInspectionResults(local, null).find(r => r.partId === partId) ?? null;
const card = (partId, s = sdk(), r = userRow(partId)) => vehicleStatusCardHtml(partId, { sdk: s, cap: vehiclePartCapabilities(partId), row: r });
const text = html => html.replace(/<[^>]+>/g, ' ');
const VERDICT = /정상입니다|정상이에요|안전합니다|안전해요|문제 없|주행 가능|교체 시기|km|킬로미터/;

test('all 19 parts get a card with three separate sources, and no verdict, unit or invented value', () => {
  assert.equal(INSPECTION_PARTS.length, 19);
  for (const p of INSPECTION_PARTS) {
    const html = card(p.id);
    for (const source of ['PLEOS', 'AI_EXPERIMENT']) assert.match(html, new RegExp(`data-source="${source}"`), p.id);
    assert.match(html, /data-source="(USER_REPORTED|MOBILE)"/, p.id);
    assert.doesNotMatch(text(html), VERDICT, p.id);
    assert.match(html, /3D 참조 모델의 위치·형상을 확인하는 근거가 아니며/);
  }
  for (const id of ['coolant-reservoir', 'lcw-coolant-reservoir', 'battery-12v', 'fuse-box']) {
    assert.deepEqual(sdkFeaturesForPart(id), [], id); assert.match(card(id), /차량 SDK 데이터를 연동하지 않았어요/, id);
  }
  assert.deepEqual(sdkFeaturesForPart('ev-battery.pack'), ['ev-battery.soc', 'ev-battery.charge-switch']);
  assert.match(card('ev-battery.pack', sdk(), null), /따로 점검 기록이 없는 부품/);
});

test('each SDK value is said in the vehicle\'s words, with time and origin; SoC and tyre values never become numbers', () => {
  assert.match(text(card('washer-fluid-cap')), /차량이 워셔액 부족 경고를 보고했어요/);
  assert.match(text(card('washer-fluid-cap', sdk({ component: attached([row('safety.washer-fluid-warning', false)]) }))), /보고하지 않았어요\. 양이 충분하다는 판정은 아니에요/);
  assert.match(text(card('brake-fluid-reservoir')), /차량이 보고한 레벨: 보통\. 제동 성능 판정은 아니에요/);
  const pack = text(card('ev-battery.pack', sdk(), null));
  assert.match(pack, /충전량 값이 보고됐어요\. 단위와 범위를 확인하지 않아 숫자로 보여 주지 않아요/); assert.doesNotMatch(pack, /73/);
  assert.match(pack, /충전 스위치가 꺼짐으로 보고됐어요\. 충전 중이라는 뜻은 아니에요/);
  assert.match(text(card('ev-charge.port')), /충전구가 열려 있다고 보고됐어요/);
  assert.match(text(card('wiper.front.right')), /와이퍼 상태: 켜짐[\s\S]*왼쪽·오른쪽을 따로 보고하지 않아요/);
  assert.match(text(card('light-high-beam-left-0')), /차량이 보고한 상태: 주간주행등\. 밝기·광축 판정은 아니에요/);
  const tire = text(card('tire.rear-left'));
  assert.match(tire, /공기압 수치와 저압 경고 값은 전달하지 않아요/); assert.match(tire, /차량이 상태를 보고하고 있어요/);
  assert.match(card('washer-fluid-cap'), /마지막 관측 .*출처 차량 SDK/);
  assert.match(card('washer-fluid-cap', sdk({ component: attached([row('safety.washer-fluid-warning', true, 'SUPPORTED', { source: 'MOCK' })]) })), /출처 테스트용 모의 데이터\(MOCK\)/);
});

test('unsupported, denied, error, unavailable, unknown, stale and disconnected stay distinct, and none shows a value', () => {
  const cases = [
    [{ capabilityStatus: 'UNSUPPORTED', availabilityStatus: 'UNSUPPORTED' }, /지원하지 않아요/], [{ capabilityStatus: 'PERMISSION_DENIED', availabilityStatus: 'PERMISSION_DENIED' }, /권한이 없어/],
    [{ availabilityStatus: 'ERROR' }, /오류가 나서/], [{ availabilityStatus: 'UNAVAILABLE' }, /값을 보내지 않았어요/], [{ capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED' }, /아직 확인 중/],
  ];
  for (const [over, words] of cases) {
    const w = sdkRowWords(row('safety.washer-fluid-warning', null, over.availabilityStatus, over), 'ATTACHED');
    assert.match(w.text, words); assert.doesNotMatch(w.text, /경고를 보고/); assert.equal(w.at, null);
  }
  const stale = sdkRowWords(row('light.low-beam', 'ON', 'STALE'), 'ATTACHED');
  assert.match(stale.text, /^오래된 보고예요\(5초 넘게 새 보고 없음\)\. 지금 상태로 보지 마세요\. 차량이 보고한 상태: 켜짐/); assert.equal(stale.state, 'STALE');
  for (const connection of ['STOPPED', 'SUPERSEDED', 'UNAVAILABLE', 'DETACHED']) assert.equal(sdkRowWords(row('light.low-beam', 'ON'), connection).text, '차량 데이터에 연결되지 않았어요.');
  assert.match(text(card('washer-fluid-cap', sdk({ component: { connectionStatus: 'STOPPED', readings: [] } }))), /차량 데이터에 연결되지 않았어요/);
});

test('a fresh vehicle report that disagrees with the person\'s check is shown, never resolved, and neither side is replaced', () => {
  const found = { ...userRow('washer-fluid-cap'), status: 'NO_FINDINGS_REPORTED', label: '발견 사항 없음', origin: 'MOBILE_RECEIVER', source: 'MOBILE', completedAt: '2026-11-12T01:02:03.000Z' };
  const html = card('washer-fluid-cap', sdk(), found);
  assert.match(html, /data-conflict="true"/); assert.match(text(html), /어느 쪽도 자동으로 정답으로 정하지 않아요/);
  assert.match(text(html), /차량이 워셔액 부족 경고를 보고했어요/); assert.match(text(html), /발견 사항 없음\s+· 스마트폰 점검/);
  assert.equal(conflictWords('washer-fluid-cap', [row('safety.washer-fluid-warning', true, 'STALE')], 'ATTACHED', 'NO_FINDINGS_REPORTED'), null, 'a stale report raises no conflict');
  assert.equal(conflictWords('washer-fluid-cap', [row('safety.washer-fluid-warning', true)], 'STOPPED', 'NO_FINDINGS_REPORTED'), null);
  assert.equal(conflictWords('washer-fluid-cap', [row('safety.washer-fluid-warning', true)], 'ATTACHED', 'NOT_INSPECTED'), null);
  assert.ok(conflictWords('washer-fluid-cap', [row('safety.washer-fluid-warning', false)], 'ATTACHED', 'FINDINGS_REPORTED'));
  assert.ok(conflictWords('brake-fluid-reservoir', [row('safety.brake-fluid-level', 'CRITICALLY_LOW')], 'ATTACHED', 'NO_FINDINGS_REPORTED'));
  assert.equal(conflictWords('brake-fluid-reservoir', [row('safety.brake-fluid-level', 'NORMAL')], 'ATTACHED', 'FINDINGS_REPORTED'), null, 'NORMAL is not a claim the part is fine');
});

test('the AI section names the part\'s stage and says results stay on the phone, unverified', () => {
  assert.match(text(card('washer-fluid-cap')), /AI 위치 찾기와 외관 분석\(실험\)/);
  assert.match(text(card('tire.front-left')), /시험 단계/);
  for (const id of ['washer-fluid-cap', 'tire.front-left']) assert.match(text(card(id)), /스마트폰에서만 보여 주고 차량으로 보내지 않아요\. 실제 사진으로 정확도를 확인하지 않았어요/);
  assert.match(text(card('ev-charge.flap', sdk(), null)), /AI 분석 대상이 아니에요/);
});

test('the Odometer consumer accepts only a finite non-negative raw number with no unit, never SUPPORTED', () => {
  const envelope = (r, connectionStatus = 'ATTACHED') => ({ schemaVersion: 1, sessionId: '12345678-1234-4123-8123-123456789abc', sequence: 1, connectionStatus, sessionPhase: 'ACTIVE', readings: [{ ...odometerBlank()[0], ...r }] });
  const ok = { capabilityStatus: 'SUPPORTED', availabilityStatus: 'UNVERIFIED', source: 'PLEOS', observedAt: 1000, value: 12345.6 };
  assert.equal(validateOdometerStatus(envelope(ok)).readings[0].value, 12345.6);
  assert.equal(validateOdometerStatus(envelope({ ...ok, availabilityStatus: 'STALE' })).readings[0].availabilityStatus, 'STALE');
  for (const [bad, why] of [[{ ...ok, value: -1 }, 'negative'], [{ ...ok, availabilityStatus: 'SUPPORTED' }, 'never SUPPORTED'], [{ ...ok, unit: 'km' }, 'no unit'], [{ ...ok, value: '12' }, 'number'],
    [{ ...ok, observedAt: null }, 'time'], [{ ...ok, source: 'REST' }, 'source'], [{ ...ok, extra: 1 }, 'keys'], [{ ...ok, featureId: 'odometer.trip' }, 'feature']])
    assert.throws(() => validateOdometerStatus(envelope(bad)), Error, why);
  assert.throws(() => validateOdometerStatus(envelope(ok, 'STOPPED')), /OWNER/);
  assert.throws(() => validateOdometerStatus({ ...envelope(ok), readings: [] }), /ENVELOPE/);
});

test('the Odometer card never shows the number or a unit to the driver, and keeps the raw Float in the developer details', () => {
  const reading = { ...odometerBlank()[0], capabilityStatus: 'SUPPORTED', availabilityStatus: 'UNVERIFIED', source: 'PLEOS', observedAt: 1_700_000_000_000, value: 12345.6 };
  const html = odometerCardHtml(reading, 'ATTACHED'), driver = html.split('<details')[0];
  assert.doesNotMatch(driver, /12345|km|킬로/); assert.match(text(driver), /단위와 의미를 확인하지 않아 숫자로 보여 주지 않고, 정비 주기도 계산하지 않아요/);
  assert.match(html, /SDK 원시 Float<\/dt><dd>12345\.6 · 단위 미확인/);
  assert.match(text(odometerCardHtml({ ...reading, availabilityStatus: 'STALE' }, 'ATTACHED')), /오래된 보고예요/);
  assert.match(text(odometerCardHtml(odometerBlank()[0], 'STOPPED')), /차량 데이터에 연결되지 않았어요/);
  assert.match(text(odometerCardHtml({ ...odometerBlank()[0], capabilityStatus: 'PERMISSION_DENIED', availabilityStatus: 'PERMISSION_DENIED', source: 'PLEOS' }, 'ATTACHED')), /권한이 없어/);
});
