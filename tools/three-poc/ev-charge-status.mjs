// Independent EV Charge UI v1. Never extends the fixed four-row Component UI v1 envelope.
import { ComponentStatusStore, ComponentStatusClient } from './component-status.mjs';
const caps = ['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'ERROR'];
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
export const chargeBlank = () => [{ featureId: 'ev-charge.port-open', vehiclePartId: 'ev-charge.port', capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', source: null, observedAt: null, value: null, unit: null }];
export function validateChargePortStatus(p) {
  if (!exact(p, ['schemaVersion', 'sessionId', 'sequence', 'connectionStatus', 'sessionPhase', 'readings']) || p.schemaVersion !== 1 ||
      typeof p.sessionId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.sessionId) || !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
      !['ATTACHED', 'STOPPED', 'SUPERSEDED'].includes(p.connectionStatus) || !['IDLE', 'ACTIVE', 'STOPPING', 'UNRESOLVED', 'CLOSED'].includes(p.sessionPhase) || !Array.isArray(p.readings) || p.readings.length !== 1) throw Error('INVALID_CHARGE_ENVELOPE');
  const r = p.readings[0];
  if (!exact(r, ['featureId', 'vehiclePartId', 'capabilityStatus', 'availabilityStatus', 'source', 'observedAt', 'value', 'unit']) || r.featureId !== 'ev-charge.port-open' || r.vehiclePartId !== 'ev-charge.port' ||
      !caps.includes(r.capabilityStatus) || ![...caps, 'UNAVAILABLE', 'STALE'].includes(r.availabilityStatus) || ![null, 'MOCK', 'PLEOS'].includes(r.source) || r.unit !== null ||
      !(r.observedAt === null || Number.isSafeInteger(r.observedAt) && r.observedAt >= 0 && r.observedAt <= 8_640_000_000_000_000) || !(r.value === null || typeof r.value === 'boolean') ||
      (r.value === null) !== (r.observedAt === null) || (r.value !== null ? r.capabilityStatus !== 'SUPPORTED' || !['SUPPORTED', 'STALE'].includes(r.availabilityStatus) : ['SUPPORTED', 'STALE'].includes(r.availabilityStatus)) ||
      (p.connectionStatus === 'ATTACHED' ? r.source === null : r.source !== null || r.value !== null || r.capabilityStatus !== 'UNVERIFIED' || r.availabilityStatus !== 'UNVERIFIED')) throw Error('INVALID_CHARGE_ROW');
  return Object.freeze({ ...p, readings: Object.freeze([Object.freeze({ ...r })]) });
}
export const chargePortStatus = new ComponentStatusStore(validateChargePortStatus, chargeBlank);
export const chargePortClient = new ComponentStatusClient(chargePortStatus, { endpoint: './ev-charge-status.json' });
let unbind;
export function enableChargePortStatus() {
  if (unbind) return;
  let active = true;
  const update = () => active && document.visibilityState !== 'hidden' ? chargePortClient.start() : chargePortClient.stop();
  const start = () => { chargePortClient.stop(); active = true; update(); }, stop = () => { active = false; update(); };
  addEventListener('carscope-component-active', start); addEventListener('carscope-component-inactive', stop); document.addEventListener('visibilitychange', update);
  unbind = () => { removeEventListener('carscope-component-active', start); removeEventListener('carscope-component-inactive', stop); document.removeEventListener('visibilitychange', update); };
  update();
}
export function disposeChargePortStatus() { unbind?.(); unbind = null; chargePortClient.stop(); }
export function chargePortStatusHtml() {
  const r = chargePortStatus.state.readings[0];
  return `<p class="note">Deprecated Pleos SDK 보고입니다. USER_REPORTED·형상 정확도와 별개이며 충전 중·완료·잠금·안전 판정이 아닙니다. 여러 포트 중 어느 포트인지는 미검증입니다.</p>
    <dl class="tire-status"><dt>데이터 출처</dt><dd>${r.source ?? '없음 · 미연동'}</dd><dt>Capability · 조회 지원</dt><dd>${r.capabilityStatus}</dd><dt>Availability · 읽기 상태</dt><dd>${r.availabilityStatus}</dd><dt>SDK 보고값 · 개방 Boolean</dt><dd>${r.value === null ? '없음 · 미수신' : String(r.value)}</dd><dt>앱 callback 수신 시각</dt><dd>${r.observedAt === null ? '없음' : new Date(r.observedAt).toISOString()}</dd></dl>
    <p class="note">정적 닫힌 추정 형상은 SDK 값으로 회전하지 않습니다. 연결 ${chargePortStatus.state.connectionStatus} · 로컬 세션 ${chargePortStatus.state.sessionPhase} · 원격 정리 미검증</p>`;
}
