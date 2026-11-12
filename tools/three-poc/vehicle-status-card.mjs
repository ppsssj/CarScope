// P14: the driver's read-only status card for one part. It projects what other modules already hold and never asks the SDK itself:
//   PLEOS          the vehicle SDK's report, from the Native caches (component, visibility, charge port, tire, odometer stores)
//   AI_EXPERIMENT  what the phone may offer for the part (part-capabilities.mjs). AI results stay on the phone and never reach here.
//   USER_REPORTED / MOBILE  the person's own check, from the existing 17-part projection
// Each source keeps its own status, time and origin. None replaces another, and a disagreement is shown, never resolved.
// Raw values, capability codes and uncertain diagnostics stay in the existing developer panel.
import { partMethodSummary, PLAN } from '../mobile-ar-poc/public/part-capabilities.mjs';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('ko-KR'); };

// Which SDK report belongs to a part. A part not listed has no vehicle data in this app; nothing stands in for it.
const SDK_FOR_PART = Object.freeze({
  'washer-fluid-cap': { store: 'component', features: ['safety.washer-fluid-warning'] },
  'brake-fluid-reservoir': { store: 'component', features: ['safety.brake-fluid-level'] },
  'ev-battery.pack': { store: 'component', features: ['ev-battery.soc', 'ev-battery.charge-switch'] },
  'ev-charge.port': { store: 'charge', features: ['ev-charge.port-open'] },
  'ev-charge.flap': { store: 'charge', features: ['ev-charge.port-open'] },
  'wiper.front.left': { store: 'visibility', features: ['wiper.front.state'], scope: '전면 와이퍼 전체의 상태예요. 왼쪽·오른쪽을 따로 보고하지 않아요.' },
  'wiper.front.right': { store: 'visibility', features: ['wiper.front.state'], scope: '전면 와이퍼 전체의 상태예요. 왼쪽·오른쪽을 따로 보고하지 않아요.' },
  ...Object.fromEntries(['left', 'right'].flatMap(side => [
    [`light-low-beam-${side}-0`, { store: 'visibility', features: ['light.low-beam'], scope: '하향등 전체의 상태예요. 왼쪽·오른쪽을 따로 보고하지 않아요.' }],
    [`light-high-beam-${side}-0`, { store: 'visibility', features: ['light.high-beam'], scope: '상향등 전체의 상태예요. 왼쪽·오른쪽을 따로 보고하지 않아요.' }],
  ])),
  ...Object.fromEntries(['front-left', 'front-right', 'rear-left', 'rear-right'].map(w => [`tire.${w}`, { store: 'tire', features: ['tire.pressure', 'tire.low-pressure'],
    scope: '이 화면에는 상태만 전달돼요. 공기압 수치와 저압 경고 값은 전달하지 않아요(개발자 정보에서 상태 확인).' }])),
});
export const sdkFeaturesForPart = partId => SDK_FOR_PART[partId]?.features ?? [];

const NAMES = Object.freeze({
  'safety.washer-fluid-warning': '워셔액 부족 경고', 'safety.brake-fluid-level': '브레이크액 레벨', 'ev-battery.soc': '충전량',
  'ev-battery.charge-switch': '충전 스위치', 'ev-charge.port-open': '충전구 열림', 'wiper.front.state': '와이퍼 작동',
  'light.low-beam': '하향등', 'light.high-beam': '상향등', 'tire.pressure': '공기압 보고', 'tire.low-pressure': '저압 경고 보고',
});
const MODE = Object.freeze({ OFF: '꺼짐', ON: '켜짐', DAYTIME_RUNNING: '주간주행등', SERVICE: '서비스 위치', OTHER: '확인되지 않은 값' });
const OIL = Object.freeze({ LOW: '낮음', CRITICALLY_LOW: '매우 낮음', HIGH: '높음', NORMAL: '보통' });
/** What a value says, in the vehicle's own words. Never "정상" or "안전": a report is not a verdict. */
function valueWords(featureId, value) {
  switch (featureId) {
    case 'safety.washer-fluid-warning': return value ? '차량이 워셔액 부족 경고를 보고했어요.' : '차량이 워셔액 부족 경고를 보고하지 않았어요. 양이 충분하다는 판정은 아니에요.';
    case 'safety.brake-fluid-level': return `차량이 보고한 레벨: ${OIL[value]}. 제동 성능 판정은 아니에요.`;
    case 'ev-battery.soc': return '충전량 값이 보고됐어요. 단위와 범위를 확인하지 않아 숫자로 보여 주지 않아요.';
    case 'ev-battery.charge-switch': return `충전 스위치가 ${value ? '켜짐' : '꺼짐'}으로 보고됐어요. 충전 중이라는 뜻은 아니에요.`;
    case 'ev-charge.port-open': return `충전구가 ${value ? '열려' : '닫혀'} 있다고 보고됐어요.`;
    case 'wiper.front.state': return `차량이 보고한 와이퍼 상태: ${MODE[value]}.`;
    case 'light.low-beam': case 'light.high-beam': return `차량이 보고한 상태: ${MODE[value]}. 밝기·광축 판정은 아니에요.`;
    default: return '';
  }
}
const STATUS = Object.freeze({
  UNSUPPORTED: '이 차량 또는 실행 환경에서 지원하지 않아요.', PERMISSION_DENIED: '읽기 권한이 없어 읽지 못했어요.', ERROR: '읽는 중 오류가 나서 보여 줄 값이 없어요.',
  UNAVAILABLE: '차량이 값을 보내지 않았어요.', UNVERIFIED: '아직 확인 중이에요.',
});
const SOURCE = Object.freeze({ PLEOS: '차량 SDK', MOCK: '테스트용 모의 데이터(MOCK)' });

/** One SDK row in plain words, with its own status, time and origin. A row with no value never gets a value phrase. */
export function sdkRowWords(row, connectionStatus) {
  if (connectionStatus !== 'ATTACHED') return { state: 'DISCONNECTED', text: '차량 데이터에 연결되지 않았어요.' };
  const tire = row.featureId.startsWith('tire.');
  const observed = row.observedAt !== null && ['SUPPORTED', 'UNVERIFIED', 'STALE'].includes(row.availabilityStatus);
  let text;
  if (row.capabilityStatus !== 'SUPPORTED') text = STATUS[row.capabilityStatus] ?? STATUS.UNVERIFIED;
  else if (!observed) text = STATUS[row.availabilityStatus] ?? STATUS.UNVERIFIED;
  else if (tire) text = '차량이 상태를 보고하고 있어요.';
  else if (row.value === null || row.value === undefined) text = STATUS.UNVERIFIED;
  else text = valueWords(row.featureId, row.value);
  if (observed && row.availabilityStatus === 'STALE') text = `오래된 보고예요(5초 넘게 새 보고 없음). 지금 상태로 보지 마세요. ${text}`;
  return { state: observed ? row.availabilityStatus : row.capabilityStatus !== 'SUPPORTED' ? row.capabilityStatus : row.availabilityStatus, text,
    at: observed ? clock(row.observedAt) : null, source: row.source ? SOURCE[row.source] ?? null : null };
}

/** Disagreements between a fresh vehicle report and the person's check. Shown, never resolved: neither side is replaced. */
export function conflictWords(partId, sdkRows, connectionStatus, userStatus) {
  if (connectionStatus !== 'ATTACHED' || !userStatus || userStatus === 'NOT_INSPECTED') return null;
  const fresh = id => sdkRows.find(r => r.featureId === id && r.availabilityStatus === 'SUPPORTED' && r.value !== null && r.value !== undefined);
  const washer = partId === 'washer-fluid-cap' && fresh('safety.washer-fluid-warning');
  const brake = partId === 'brake-fluid-reservoir' && fresh('safety.brake-fluid-level');
  const differs = washer && (washer.value === true && userStatus === 'NO_FINDINGS_REPORTED' || washer.value === false && userStatus === 'FINDINGS_REPORTED')
    || brake && ['LOW', 'CRITICALLY_LOW'].includes(brake.value) && userStatus === 'NO_FINDINGS_REPORTED';
  return differs ? '차량 보고와 직접 점검 결과가 서로 달라요. 어느 쪽도 자동으로 정답으로 정하지 않아요. 부품을 직접 다시 확인해 주세요.' : null;
}

const USER_SOURCE = Object.freeze({ MOBILE: '스마트폰 점검', USER_REPORTED: '이 화면에서 직접 입력' });
/**
 * The card. Inputs are plain snapshots, so it is tested without a page:
 * @param partId   a 3D registry part id
 * @param sdk      { component, charge, visibility } store states ({ connectionStatus, readings }) and tire: tireStatus.forTire(id) or null
 * @param cap      vehiclePartCapabilities(partId) (no host: support only, never "available")
 * @param row      the part's row of projectInspectionResults, or null for a part with no inspection
 */
export function vehicleStatusCardHtml(partId, { sdk, cap, row }) {
  const plan = SDK_FOR_PART[partId];
  let sdkHtml, sdkRows = [], connection = null;
  if (!plan) sdkHtml = '<p>이 부품은 차량 SDK 데이터를 연동하지 않았어요. 직접 점검 결과로 대신하지 않아요.</p>';
  else {
    const store = plan.store === 'tire' ? sdk.tire : sdk[plan.store];
    connection = store?.connectionStatus ?? 'DETACHED';
    sdkRows = plan.store === 'tire' ? store?.features ?? [] : (store?.readings ?? []).filter(r => plan.features.includes(r.featureId));
    sdkHtml = `<ul class="vehicle-status-list">${plan.features.map(id => {
      const r = sdkRows.find(x => x.featureId === id), w = r ? sdkRowWords(r, connection) : { state: 'DISCONNECTED', text: '차량 데이터에 연결되지 않았어요.' };
      return `<li data-sdk-feature="${id}" data-sdk-state="${w.state}"><strong>${NAMES[id]}</strong> ${esc(w.text)}${w.at ? ` <small>마지막 관측 ${esc(w.at)}</small>` : ''}${w.source ? ` <small>출처 ${esc(w.source)}</small>` : ''}</li>`;
    }).join('')}</ul>${plan.scope ? `<p class="note">${plan.scope}</p>` : ''}`;
  }
  const aiHtml = cap.partPlan === PLAN.INFO_ONLY ? '<p>따로 점검 기록이 없는 부품이라 AI 분석 대상이 아니에요.</p>'
    : `<p>${esc(partMethodSummary(cap))}</p><p class="note">AI 분석 결과는 스마트폰에서만 보여 주고 차량으로 보내지 않아요. 실제 사진으로 정확도를 확인하지 않았어요.</p>`;
  const userHtml = !row ? '<p>따로 점검 기록이 없는 부품이에요.</p>'
    : row.origin ? `<p><strong>${esc(row.label)}</strong> · ${esc(USER_SOURCE[row.source] ?? '직접 점검')}${row.completedAt ? ` · ${esc(clock(row.completedAt) ?? '')}` : ''}</p><p class="note">위 「현재 점검 결과」와 같은 기록이에요. 저장된 과거 기록은 과거 점검 기록에서 볼 수 있어요.</p>`
    : '<p>아직 직접 점검한 결과가 없어요.</p>';
  const conflict = row ? conflictWords(partId, sdkRows, connection, row.status) : null;
  return `<section class="vehicle-status-card" aria-label="부품 상태 한눈에 보기" data-part="${esc(partId)}">
    <h3>부품 상태 한눈에 보기</h3>
    <div class="vehicle-status-source" data-source="PLEOS"><h4>차량 SDK 데이터</h4>${sdkHtml}</div>
    <div class="vehicle-status-source" data-source="AI_EXPERIMENT"><h4>AI 외관 분석 · 실험</h4>${aiHtml}</div>
    <div class="vehicle-status-source" data-source="${row?.source === 'MOBILE' ? 'MOBILE' : 'USER_REPORTED'}"><h4>직접 점검</h4>${userHtml}</div>
    ${conflict ? `<p class="result-error" role="status" data-conflict="true">${conflict}</p>` : ''}
    <p class="note">각 정보는 출처별로 따로 보여요. 차량 보고는 이 3D 참조 모델의 위치·형상을 확인하는 근거가 아니며, 정상·안전 판정이 아니에요.</p>
  </section>`;
}

/** The vehicle-level Odometer, for the summary. The raw Float stays in the developer details; nothing is converted or scheduled. */
export function odometerCardHtml(reading, connectionStatus) {
  const w = sdkRowWords({ ...reading, featureId: 'odometer.distance-driven' }, connectionStatus);
  const reported = reading.value !== null && ['UNVERIFIED', 'STALE'].includes(reading.availabilityStatus) && connectionStatus === 'ATTACHED';
  const text = reported ? `${reading.availabilityStatus === 'STALE' ? '오래된 보고예요(5초 넘게 새 보고 없음). ' : ''}차량이 주행거리 값을 보고했어요. 단위와 의미를 확인하지 않아 숫자로 보여 주지 않고, 정비 주기도 계산하지 않아요.` : w.text;
  return `<section class="vehicle-status-card" aria-label="차량 정보" data-part="vehicle.odometer"><h3>차량 정보</h3>
    <ul class="vehicle-status-list"><li data-sdk-feature="odometer.distance-driven" data-sdk-state="${reported ? reading.availabilityStatus : w.state}"><strong>주행거리</strong> ${esc(text)}${w.at ? ` <small>마지막 관측 ${esc(w.at)}</small>` : ''}${w.source ? ` <small>출처 ${esc(w.source)}</small>` : ''}</li></ul>
    <details class="dev-info"><summary>개발자 정보</summary><dl class="tire-status"><dt>Capability</dt><dd>${esc(reading.capabilityStatus)}</dd><dt>Availability</dt><dd>${esc(reading.availabilityStatus)}</dd><dt>SDK 원시 Float</dt><dd>${reading.value === null ? '없음' : esc(reading.value)} · 단위 미확인</dd><dt>관측 시각(ms)</dt><dd>${reading.observedAt ?? '없음'}</dd></dl></details>
  </section>`;
}
