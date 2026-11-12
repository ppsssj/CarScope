// P14-B: the external connected-car data block of the part status card (Hyundai Developers, Pleos Vehicle Data API).
// No real provider is connected: there is no approved token store, no developer project and no owner consent. So the driver UI
// never turns this on by itself. It appears only with ?externalVehicleData=fixture, from the MOCK fixture below (no network).
// The block shows each provider's own state and never a number: units are documented but not verified on a live account.
// It sits beside the vehicle SDK, AI and own-check blocks and replaces none of them.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const EXTERNAL_PROVIDERS = Object.freeze({ HYUNDAI_DEVELOPERS: 'Hyundai Developers (국내 커넥티드카)', PLEOS_VEHICLE_DATA: 'Pleos Vehicle Data API (유럽)' });
export const EXTERNAL_STATES = Object.freeze({
  DISABLED: '사용하지 않도록 설정돼 있어요.',
  NOT_CONFIGURED: '개발자 프로젝트가 설정되지 않았어요.',
  BLOCKED: '연결에 필요한 조건이 갖춰지지 않아 연결할 수 없어요.',
  NOT_CONNECTED: '연결되지 않았어요.',
  CONSENT_REQUIRED: '차량 데이터 제공 동의가 필요해요.',
  REGION_UNSUPPORTED: '이 차량의 지역은 지원하지 않아요.',
  FEATURE_UNSUPPORTED: '이 차량에서 지원하지 않는 항목이에요.',
  AUTH_EXPIRED: '계정 연결 권한이 만료됐어요.',
  RATE_LIMITED: '조회 한도에 걸렸어요. 잠시 후 다시 확인해요.',
  PROVIDER_ERROR: '외부 서비스 오류로 받지 못했어요.',
  NO_DATA: '받은 데이터가 없어요.',
  INVALID_VALUE: '받은 값이 유효하지 않아 보여 주지 않아요.',
  STALE: '오래된 데이터예요. 지금 상태로 보지 마세요.',
  RECEIVED: '데이터를 받았어요.',
});
const REPORTS = Object.freeze({ ON: '켜짐으로 보고됐어요.', OFF: '켜짐으로 보고되지 않았어요. 문제가 없다는 판정은 아니에요.',
  CONNECTED: '충전 케이블 연결로 보고됐어요.', DISCONNECTED: '충전 케이블 연결 안 됨으로 보고됐어요.',
  FAST_CHARGER_CONNECTED: '급속 충전기 연결로 보고됐어요.', NORMAL_CHARGER_CONNECTED: '일반 충전기 연결로 보고됐어요.',
  CHARGING: '충전 중으로 보고됐어요.', NOT_CHARGING: '충전 중이 아니라고 보고됐어요.',
  NUMBER_HIDDEN: '값이 보고됐어요. 실제 계정으로 단위를 확인하지 않아 숫자로 보여 주지 않아요.' });
const NAMES = Object.freeze({
  odometer: '누적 주행거리', 'distance-to-empty': '주행 가능 거리', 'ev.state-of-charge': '배터리 잔량', 'ev.charging': '충전 여부', 'ev.plug': '충전 케이블',
  'warning.washer-fluid': '워셔액 경고등', 'warning.brake-fluid': '브레이크 오일 경고등', 'warning.tire-pressure': '타이어 공기압 경고(차량 전체)',
  'warning.tire-pressure.front-left': '앞 왼쪽 공기압 경고', 'warning.tire-pressure.front-right': '앞 오른쪽 공기압 경고',
  'warning.tire-pressure.rear-left': '뒤 왼쪽 공기압 경고', 'warning.tire-pressure.rear-right': '뒤 오른쪽 공기압 경고',
  'tire.pressure.front-left': '앞 왼쪽 공기압', 'tire.pressure.front-right': '앞 오른쪽 공기압', 'tire.pressure.rear-left': '뒤 왼쪽 공기압', 'tire.pressure.rear-right': '뒤 오른쪽 공기압',
  'warning.head-lamp': '전조등 경고(좌우 구분 없음)',
});
const WHEELS = ['front-left', 'front-right', 'rear-left', 'rear-right'];
/** Part → external features. A part not listed has no documented external data; Lamp wire is left out because its meaning is unverified. */
export const EXTERNAL_FOR_PART = Object.freeze({
  'washer-fluid-cap': ['warning.washer-fluid'],
  'brake-fluid-reservoir': ['warning.brake-fluid'],
  'ev-battery.pack': ['ev.state-of-charge', 'ev.charging'],
  'ev-charge.port': ['ev.plug'], 'ev-charge.flap': ['ev.plug'],
  ...Object.fromEntries(WHEELS.map(w => [`tire.${w}`, [`tire.pressure.${w}`, `warning.tire-pressure.${w}`, 'warning.tire-pressure']])),
  ...Object.fromEntries(['left', 'right'].flatMap(s => [[`light-low-beam-${s}-0`, ['warning.head-lamp']], [`light-high-beam-${s}-0`, ['warning.head-lamp']]])),
  'vehicle.odometer': ['odometer', 'distance-to-empty'],
});

const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REASON = r => r === null || typeof r === 'string' && /^[A-Z0-9_]{2,64}$/.test(r);
const FEATURES = new Set(Object.keys(NAMES));
/** The projection the server may send (carscope.external-vehicle-data v1). No ids, tokens, raw bodies or numbers fit in it. */
export function validateExternalVehicleData(p) {
  if (!exact(p, ['schemaVersion', 'source', 'providers']) || p.schemaVersion !== 1 || !['EXTERNAL_REST', 'MOCK'].includes(p.source) ||
      !Array.isArray(p.providers) || p.providers.length > 2) throw new Error('INVALID_EXTERNAL_ENVELOPE');
  const seen = new Set();
  for (const q of p.providers) {
    if (!exact(q, ['provider', 'state', 'reason', 'features']) || !(q.provider in EXTERNAL_PROVIDERS) || seen.has(q.provider) || !(q.state in EXTERNAL_STATES) ||
        !REASON(q.reason) || !Array.isArray(q.features) || q.features.length > 32) throw new Error('INVALID_EXTERNAL_PROVIDER');
    seen.add(q.provider);
    // Feature rows exist only once the provider is connected and a vehicle is bound (provider state RECEIVED); each row has its own state.
    if (q.features.length && q.state !== 'RECEIVED') throw new Error('INVALID_EXTERNAL_PROVIDER_STATE');
    const ids = new Set();
    for (const f of q.features) {
      if (!exact(f, ['featureId', 'state', 'reason', 'report', 'observedAt', 'observedAtUnzoned', 'fetchedAt']) || !FEATURES.has(f.featureId) || ids.has(f.featureId) ||
          !(f.state in EXTERNAL_STATES) || !REASON(f.reason) || !(f.report === null || f.report in REPORTS) ||
          !(f.observedAt === null || ISO.test(f.observedAt)) || !(f.observedAtUnzoned === null || /^\d{14}$/.test(f.observedAtUnzoned)) ||
          typeof f.fetchedAt !== 'string' || !ISO.test(f.fetchedAt)) throw new Error('INVALID_EXTERNAL_FEATURE');
      if ((f.report !== null) !== ['RECEIVED', 'STALE'].includes(f.state)) throw new Error('INVALID_EXTERNAL_FEATURE_STATE');
      if (f.observedAt !== null && f.observedAtUnzoned !== null) throw new Error('INVALID_EXTERNAL_FEATURE_TIME');
      ids.add(f.featureId);
    }
  }
  return p;
}

const when = f => f.observedAt ? `차량 데이터 시각 ${new Date(f.observedAt).toLocaleString('ko-KR')}`
  : f.observedAtUnzoned ? `차량 전송 시각 ${f.observedAtUnzoned.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6')}(시간대 미기재)`
    : '차량 데이터 시각 없음';

/** The card block for one part, or '' when the page has no external data (the default: nothing is shown). */
export function externalVehicleDataHtml(partId, projection) {
  if (!projection) return '';
  const wanted = EXTERNAL_FOR_PART[partId];
  const body = !wanted ? '<p>이 부품에 해당하는 외부 차량 데이터 항목이 없어요.</p>' : projection.providers.map(q => {
    const rows = q.features.filter(f => wanted.includes(f.featureId));
    const list = rows.length ? `<ul class="vehicle-status-list">${rows.map(f => `<li data-external-feature="${f.featureId}" data-external-state="${f.state}"><strong>${NAMES[f.featureId]}</strong> ${esc(f.report ? `${f.state === 'STALE' ? EXTERNAL_STATES.STALE + ' ' : ''}${REPORTS[f.report]}` : EXTERNAL_STATES[f.state])}${f.report ? ` <small>${esc(when(f))} · 받은 시각 ${esc(new Date(f.fetchedAt).toLocaleString('ko-KR'))}</small>` : ''}</li>`).join('')}</ul>` : '';
    return `<div data-external-provider="${q.provider}" data-external-state="${q.state}"><p><strong>${EXTERNAL_PROVIDERS[q.provider]}</strong> ${esc(rows.length ? '' : ['RECEIVED', 'STALE'].includes(q.state) ? '이 부품 항목은 받지 않았어요.' : EXTERNAL_STATES[q.state])}</p>${list}</div>`;
  }).join('');
  return `<div class="vehicle-status-source" data-source="${projection.source === 'MOCK' ? 'MOCK' : 'EXTERNAL_REST'}"><h4>외부 커넥티드카 데이터${projection.source === 'MOCK' ? ' · 테스트용 모의 데이터(MOCK)' : ''}</h4>${body}<p class="note">인증된 차량의 원격 보고예요. 차량 SDK 보고·직접 점검과 따로 보여 주며 어느 쪽도 덮어쓰지 않아요. 정상·안전 판정이 아니에요.</p></div>`;
}

/** MOCK fixture for the browser check: Hyundai bound with a few readings, Pleos refused for region. Not a live result. */
export const EXTERNAL_FIXTURE = Object.freeze(validateExternalVehicleData({ schemaVersion: 1, source: 'MOCK', providers: [
  { provider: 'HYUNDAI_DEVELOPERS', state: 'RECEIVED', reason: null, features: [
    { featureId: 'warning.washer-fluid', state: 'RECEIVED', reason: 'PROVIDER_SENDS_NO_TIMESTAMP', report: 'ON', observedAt: null, observedAtUnzoned: null, fetchedAt: '2026-11-12T01:00:00Z' },
    { featureId: 'warning.brake-fluid', state: 'STALE', reason: 'CARSCOPE_COPY_OLDER_THAN_WINDOW', report: 'OFF', observedAt: null, observedAtUnzoned: null, fetchedAt: '2026-11-11T01:00:00Z' },
    { featureId: 'warning.tire-pressure', state: 'RECEIVED', reason: 'PROVIDER_SENDS_NO_TIMESTAMP', report: 'OFF', observedAt: null, observedAtUnzoned: null, fetchedAt: '2026-11-12T01:00:00Z' },
    { featureId: 'ev.state-of-charge', state: 'RECEIVED', reason: null, report: 'NUMBER_HIDDEN', observedAt: null, observedAtUnzoned: '20261112095500', fetchedAt: '2026-11-12T01:00:00Z' },
    { featureId: 'ev.plug', state: 'AUTH_EXPIRED', reason: 'HTTP_401', report: null, observedAt: null, observedAtUnzoned: null, fetchedAt: '2026-11-12T01:00:00Z' },
    { featureId: 'odometer', state: 'RECEIVED', reason: null, report: 'NUMBER_HIDDEN', observedAt: null, observedAtUnzoned: '20261112095500', fetchedAt: '2026-11-12T01:00:00Z' },
    { featureId: 'distance-to-empty', state: 'PROVIDER_ERROR', reason: 'TIMEOUT', report: null, observedAt: null, observedAtUnzoned: null, fetchedAt: '2026-11-12T01:00:00Z' },
  ] },
  { provider: 'PLEOS_VEHICLE_DATA', state: 'REGION_UNSUPPORTED', reason: 'PLEOS_VEHICLE_DATA_EUROPE_ONLY', features: [] },
] }));
