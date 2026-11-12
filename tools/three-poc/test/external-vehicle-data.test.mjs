// P14-B: the external connected-car block on the part card. MOCK projection only; the page never connects to a provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSPECTION_PARTS } from '../inspection-parts.mjs';
import { vehicleStatusCardHtml, odometerCardHtml } from '../vehicle-status-card.mjs';
import { externalVehicleDataHtml, validateExternalVehicleData, EXTERNAL_FIXTURE, EXTERNAL_FOR_PART, EXTERNAL_STATES } from '../external-vehicle-data.mjs';
import { vehiclePartCapabilities } from '../inspection-results-view.mjs';
import { odometerBlank } from '../odometer-status.mjs';

const empty = { component: null, charge: null, visibility: null, tire: null };
const card = (partId, external = null) => vehicleStatusCardHtml(partId, { sdk: empty, cap: vehiclePartCapabilities(partId), row: null, external });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const clone = x => JSON.parse(JSON.stringify(x));

test('default: no external block anywhere (the driver UI does not turn it on)', () => {
  for (const p of INSPECTION_PARTS) {
    const html = card(p.id);
    assert.doesNotMatch(html, /data-source="(EXTERNAL_REST|MOCK)"|외부 커넥티드카/, p.id);
    assert.equal(html, vehicleStatusCardHtml(p.id, { sdk: empty, cap: vehiclePartCapabilities(p.id), row: null }), 'same card as before P14-B');
  }
  assert.doesNotMatch(odometerCardHtml(odometerBlank()[0], 'DETACHED'), /외부 커넥티드카/);
  assert.equal(externalVehicleDataHtml('washer-fluid-cap', null), '');
});

test('fixture: the block sits beside the SDK, AI and own-check blocks and says MOCK; each provider keeps its own state', () => {
  for (const p of INSPECTION_PARTS) {
    const html = card(p.id, EXTERNAL_FIXTURE);
    for (const source of ['PLEOS', 'MOCK', 'AI_EXPERIMENT', 'USER_REPORTED']) assert.match(html, new RegExp(`data-source="${source}"`), p.id);
    assert.match(html, /테스트용 모의 데이터\(MOCK\)/);
    assert.ok(html.indexOf('data-source="PLEOS"') < html.indexOf('data-source="MOCK"') && html.indexOf('data-source="MOCK"') < html.indexOf('data-source="AI_EXPERIMENT"'));
  }
  const washer = text(card('washer-fluid-cap', EXTERNAL_FIXTURE));
  assert.match(washer, /워셔액 경고등 켜짐으로 보고됐어요/);
  assert.match(washer, /차량 데이터 시각 없음/, 'Hyundai warnings carry no timestamp; none is shown as one');
  assert.match(washer, /Pleos Vehicle Data API \(유럽\) 이 차량의 지역은 지원하지 않아요/);
  assert.match(washer, /어느 쪽도 덮어쓰지 않아요/);
  assert.match(text(card('brake-fluid-reservoir', EXTERNAL_FIXTURE)), /오래된 데이터예요\. 지금 상태로 보지 마세요\. 켜짐으로 보고되지 않았어요\. 문제가 없다는 판정은 아니에요/);
  assert.match(card('ev-charge.port', EXTERNAL_FIXTURE), /data-external-feature="ev.plug" data-external-state="AUTH_EXPIRED"/);
  assert.match(text(card('tire.front-left', EXTERNAL_FIXTURE)), /타이어 공기압 경고\(차량 전체\)/);
  assert.match(text(card('coolant-reservoir', EXTERNAL_FIXTURE)), /이 부품에 해당하는 외부 차량 데이터 항목이 없어요/);
});

test('numbers never reach the page: SoC and odometer say "value reported" only; an unzoned time is labelled as such', () => {
  const ev = text(card('ev-battery.pack', EXTERNAL_FIXTURE));
  assert.match(ev, /값이 보고됐어요\. 실제 계정으로 단위를 확인하지 않아 숫자로 보여 주지 않아요/);
  assert.match(ev, /차량 전송 시각 2026-11-12 09:55:00\(시간대 미기재\)/);
  const odo = text(odometerCardHtml(odometerBlank()[0], 'DETACHED', EXTERNAL_FIXTURE));
  assert.match(odo, /누적 주행거리 값이 보고됐어요/);
  assert.match(odo, /주행 가능 거리 외부 서비스 오류로 받지 못했어요/);
  assert.doesNotMatch(odo, /\bkm\b|킬로미터|정비 주기|교체 시기/);
});

test('the projection contract refuses ids, numbers, raw values, rows without a connection and undocumented features', () => {
  const ok = clone(EXTERNAL_FIXTURE);
  assert.doesNotThrow(() => validateExternalVehicleData(ok));
  const broken = [
    p => { p.providers[0].carId = '123e4567-c0a8-4af7-b8e5-262ea1f6aab4'; },
    p => { p.providers[0].features[0].value = 12320; },
    p => { p.providers[0].features[0].report = 12320; },
    p => { p.providers[0].features[0].report = 'NORMAL'; },
    p => { p.providers[0].state = 'CONSENT_REQUIRED'; },
    p => { p.providers[0].features[0].featureId = 'vehicle.location'; },
    p => { p.providers[0].features[0].observedAt = '2026-11-12T00:00:00Z'; p.providers[0].features[0].observedAtUnzoned = '20261112000000'; },
    p => { p.providers[0].features[4].report = 'ON'; },
    p => { p.providers[0].features[0].report = null; },
    p => { p.providers.push(clone(p.providers[0])); },
    p => { p.source = 'PLEOS'; },
    p => { p.providers[0].provider = 'SMARTCAR'; },
    p => { p.providers[0].features[0].fetchedAt = 1_700_000_000_000; },
  ];
  for (const [i, change] of broken.entries()) { const p = clone(ok); change(p); assert.throws(() => validateExternalVehicleData(p), /INVALID_EXTERNAL/, String(i)); }
});

test('every state has driver words, and every mapped part names only documented features', () => {
  for (const state of ['DISABLED', 'NOT_CONFIGURED', 'BLOCKED', 'NOT_CONNECTED', 'CONSENT_REQUIRED', 'REGION_UNSUPPORTED', 'FEATURE_UNSUPPORTED', 'AUTH_EXPIRED',
    'RATE_LIMITED', 'PROVIDER_ERROR', 'NO_DATA', 'INVALID_VALUE', 'STALE', 'RECEIVED']) {
    assert.ok(EXTERNAL_STATES[state], state);
    const html = externalVehicleDataHtml('washer-fluid-cap', { schemaVersion: 1, source: 'EXTERNAL_REST', providers: [{ provider: 'HYUNDAI_DEVELOPERS', state, reason: null, features: [] }] });
    assert.match(html, new RegExp(`data-external-state="${state}"`));
  }
  const ids = new Set(INSPECTION_PARTS.map(p => p.id));
  for (const part of Object.keys(EXTERNAL_FOR_PART)) assert.ok(ids.has(part) || part === 'vehicle.odometer', part);
  assert.equal(EXTERNAL_FOR_PART['light-low-beam-left-0'][0], 'warning.head-lamp');
  assert.ok(!Object.values(EXTERNAL_FOR_PART).flat().includes('warning.lamp-wire'), 'Lamp wire meaning is unverified, so it maps to no part');
});
