// Read-only projection of Native component cache. EV IDs are data-only until a model contract is merged.
export const COMPONENT_FEATURES = Object.freeze({
  'safety.washer-fluid-warning': 'washer-fluid-cap',
  'safety.brake-fluid-level': 'brake-fluid-reservoir',
  'ev-battery.soc': 'ev-battery.pack',
  'ev-battery.charge-switch': 'ev-battery.pack',
});
const caps = ['UNVERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'ERROR'];
const availability = [...caps, 'UNAVAILABLE', 'STALE'];
const oil = ['LOW', 'HIGH', 'NORMAL', 'CRITICALLY_LOW'];
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const exact = (x, keys) => x && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const blank = () => Object.entries(COMPONENT_FEATURES).map(([featureId, vehiclePartId]) => ({ featureId, vehiclePartId, capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', source: null, observedAt: null, value: null, unit: null }));

export function validateComponentStatus(p) {
  if (!exact(p, ['schemaVersion', 'sessionId', 'sequence', 'connectionStatus', 'sessionPhase', 'readings']) || p.schemaVersion !== 1 ||
    typeof p.sessionId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.sessionId) || !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
    !['ATTACHED', 'STOPPED', 'SUPERSEDED'].includes(p.connectionStatus) || !['IDLE', 'ACTIVE', 'STOPPING', 'UNRESOLVED', 'CLOSED'].includes(p.sessionPhase) || !Array.isArray(p.readings) || p.readings.length !== 4) throw Error('INVALID_COMPONENT_ENVELOPE');
  const seen = new Set(), sources = new Set();
  const readings = p.readings.map(r => {
    if (!exact(r, ['featureId', 'vehiclePartId', 'capabilityStatus', 'availabilityStatus', 'source', 'observedAt', 'value', 'unit']) ||
      !Object.hasOwn(COMPONENT_FEATURES, r.featureId) || COMPONENT_FEATURES[r.featureId] !== r.vehiclePartId || seen.has(r.featureId) ||
      !caps.includes(r.capabilityStatus) || !availability.includes(r.availabilityStatus) || ![null, 'PLEOS', 'MOCK'].includes(r.source) || r.unit !== null ||
      !(r.observedAt === null || Number.isSafeInteger(r.observedAt) && r.observedAt >= 0 && r.observedAt <= 8_640_000_000_000_000)) throw Error('INVALID_COMPONENT_ROW');
    seen.add(r.featureId); sources.add(r.source);
    if ((r.value === null) !== (r.observedAt === null)) throw Error('INVALID_COMPONENT_OBSERVATION');
    if (r.value !== null) {
      const soc = r.featureId === 'ev-battery.soc';
      const valid = soc ? Number.isInteger(r.value) && r.value >= -2147483648 && r.value <= 2147483647 : r.featureId === 'safety.brake-fluid-level' ? oil.includes(r.value) : typeof r.value === 'boolean';
      if (!valid || r.capabilityStatus !== 'SUPPORTED' || !(soc ? ['UNVERIFIED', 'STALE'] : ['SUPPORTED', 'STALE']).includes(r.availabilityStatus)) throw Error('INVALID_COMPONENT_VALUE');
    } else if (['SUPPORTED', 'STALE'].includes(r.availabilityStatus)) throw Error('MISSING_COMPONENT_VALUE');
    if (p.connectionStatus === 'ATTACHED' ? r.source === null : r.source !== null || r.value !== null || r.capabilityStatus !== 'UNVERIFIED' || r.availabilityStatus !== 'UNVERIFIED') throw Error('INVALID_COMPONENT_OWNER');
    return { ...r };
  });
  if (sources.size !== 1) throw Error('MIXED_COMPONENT_SOURCE');
  return freeze({ ...p, readings });
}
export class ComponentStatusStore {
  constructor() { this.listeners = new Set(); this.invalidate('DETACHED'); }
  subscribe(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit() { for (const f of this.listeners) f(); }
  invalidate(connectionStatus = 'STOPPED') { this.sessionId = null; this.sequence = 0; this.state = freeze({ connectionStatus, sessionPhase: 'IDLE', readings: blank() }); this.emit(); }
  accept(payload) {
    const p = validateComponentStatus(payload);
    if (this.sessionId !== null && this.sessionId !== p.sessionId || p.sequence <= this.sequence) return false;
    this.sessionId = p.sessionId; this.sequence = p.sequence;
    const view = { connectionStatus: p.connectionStatus, sessionPhase: p.sessionPhase, readings: p.readings };
    const changed = JSON.stringify(view) !== JSON.stringify(this.state); this.state = freeze(view); if (changed) this.emit(); return true;
  }
  unavailable() { this.state = freeze({ connectionStatus: 'UNAVAILABLE', sessionPhase: 'UNRESOLVED', readings: this.state.readings.map(r => ({ ...r, availabilityStatus: 'ERROR', value: null, observedAt: null })) }); this.emit(); }
  forPart(id) {
    if (!Object.values(COMPONENT_FEATURES).includes(id)) throw Error('UNKNOWN_COMPONENT_PART');
    return this.state.readings.filter(r => r.vehiclePartId === id);
  }
}
export class ComponentStatusClient {
  constructor(store, { fetchImpl = (...a) => fetch(...a), schedule = (f, ms) => setTimeout(f, ms), cancel = id => clearTimeout(id) } = {}) { Object.assign(this, { store, fetchImpl, schedule, cancel, running: false, generation: 0 }); }
  start() { if (!this.running) { this.running = true; this.generation++; this.store.invalidate('DETACHED'); void this.poll(this.generation); } }
  stop() { this.running = false; this.generation++; this.cancel(this.timer); this.controller?.abort(); this.store.invalidate('STOPPED'); }
  async poll(generation) {
    const controller = new AbortController(); this.controller = controller;
    const timeout = this.schedule(() => controller.abort(), 3000);
    try {
      const r = await this.fetchImpl('./component-status.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!r.ok || r.redirected || !r.headers.get('content-type')?.startsWith('application/json')) throw Error('UNAVAILABLE');
      const text = await r.text(); if (text.length > 8192) throw Error('OVERSIZE');
      if (!this.running || generation !== this.generation) return;
      const p = JSON.parse(text); if (!this.store.accept(p) && p.sessionId !== this.store.sessionId) this.store.unavailable();
    } catch { if (this.running && generation === this.generation) this.store.unavailable(); }
    finally { this.cancel(timeout); if (this.running && generation === this.generation) this.timer = this.schedule(() => void this.poll(generation), 1000); }
  }
}
export const componentStatus = new ComponentStatusStore();
export const componentStatusClient = new ComponentStatusClient(componentStatus);
let unbind;
export function enableComponentStatus() {
  if (unbind) return;
  let active = true;
  const update = () => active && document.visibilityState !== 'hidden' ? componentStatusClient.start() : componentStatusClient.stop();
  const start = () => { componentStatusClient.stop(); active = true; update(); }, stop = () => { active = false; update(); };
  addEventListener('carscope-component-active', start); addEventListener('carscope-component-inactive', stop); document.addEventListener('visibilitychange', update);
  unbind = () => { removeEventListener('carscope-component-active', start); removeEventListener('carscope-component-inactive', stop); document.removeEventListener('visibilitychange', update); };
  update();
}
export function disposeComponentStatus() { unbind?.(); unbind = null; componentStatusClient.stop(); }
const labels = { 'safety.washer-fluid-warning': '워셔액 부족 경고 SDK 보고', 'safety.brake-fluid-level': '브레이크액 레벨 SDK 보고', 'ev-battery.soc': 'SoC 원시 Integer · 단위/범위 미검증', 'ev-battery.charge-switch': '충전 스위치 SDK 보고 · 충전 진행 여부 아님' };
export function componentStatusHtml(id) {
  return `<p class="note">PLEOS 관측은 USER_REPORTED 기록과 별개이며 모델의 형상 정확도를 검증하지 않습니다. API 지원/보고값은 차량 안전·정상 판정이 아닙니다.</p>${componentStatus.forPart(id).map(r =>
    `<section data-component-feature="${r.featureId}"><h3>${labels[r.featureId]}</h3><dl class="tire-status"><dt>데이터 출처</dt><dd>${r.source ?? '없음 · 미연동'}</dd><dt>Capability</dt><dd>${r.capabilityStatus}</dd><dt>Availability</dt><dd>${r.availabilityStatus}</dd><dt>SDK 보고값</dt><dd>${r.value === null ? '없음' : String(r.value)}</dd><dt>최근 관측 시각 · 앱 callback 수신</dt><dd>${r.observedAt === null ? '없음' : new Date(r.observedAt).toISOString()}</dd></dl></section>`).join('')}<p class="note">연결 ${componentStatus.state.connectionStatus} · 로컬 세션 ${componentStatus.state.sessionPhase} · 원격 연결/정리 완료 미검증</p>`;
}
