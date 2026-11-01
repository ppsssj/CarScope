// Status-only native contract. SDK values, units and exception text are deliberately not accepted.
import { TIRES } from './inspection-tires.mjs';
export const TIRE_FEATURES = Object.freeze(['tire.pressure', 'tire.low-pressure']);
const statuses = ['SUPPORTED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'UNVERIFIED', 'ERROR', 'STALE'];
const phases = ['IDLE', 'ACTIVE', 'STOPPING', 'UNRESOLVED', 'CLOSED', 'UNVERIFIED'];
const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const blankRows = () => TIRE_FEATURES.flatMap(featureId => TIRES.map(t => ({ featureId, vehiclePartId: t.id,
  capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', observedAt: null, source: null })));

export function validateTireStatus(payload) {
  if (!exact(payload, ['schemaVersion', 'sessionId', 'sequence', 'connectionStatus', 'sessionPhase', 'readings'])
    || payload.schemaVersion !== 1 || typeof payload.sessionId !== 'string'
    || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(payload.sessionId)
    || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
    || !['ATTACHED', 'STOPPED', 'SUPERSEDED'].includes(payload.connectionStatus) || !phases.includes(payload.sessionPhase)
    || !Array.isArray(payload.readings) || payload.readings.length !== 8) throw Error('Invalid tire status envelope');
  const keys = new Set(), sources = new Set();
  const rows = payload.readings.map(r => {
    if (!exact(r, ['featureId', 'vehiclePartId', 'capabilityStatus', 'availabilityStatus', 'observedAt', 'source'])
      || !TIRE_FEATURES.includes(r.featureId) || !TIRES.some(t => t.id === r.vehiclePartId)
      || !statuses.includes(r.capabilityStatus) || r.capabilityStatus === 'STALE' || !statuses.includes(r.availabilityStatus)
      || ![null, 'PLEOS', 'MOCK'].includes(r.source)
      || !(r.observedAt === null || (Number.isSafeInteger(r.observedAt) && r.observedAt >= 0 && r.observedAt <= 8_640_000_000_000_000))) throw Error('Invalid tire status row');
    const key = r.featureId + ':' + r.vehiclePartId;
    if (keys.has(key)) throw Error('Duplicate tire status row');
    keys.add(key); sources.add(r.source);
    if (r.availabilityStatus === 'STALE' && r.observedAt === null) throw Error('Stale observation has no timestamp');
    if (r.observedAt !== null && (r.capabilityStatus !== 'SUPPORTED' || !['SUPPORTED', 'UNVERIFIED', 'STALE'].includes(r.availabilityStatus))) throw Error('Invalid observation metadata');
    if (payload.connectionStatus !== 'ATTACHED' && (r.source !== null || r.observedAt !== null || r.capabilityStatus !== 'UNVERIFIED' || r.availabilityStatus !== 'UNVERIFIED')) throw Error('Stopped owner retained data');
    if (payload.connectionStatus === 'ATTACHED' && r.source === null) throw Error('Attached data has no origin');
    return { ...r };
  });
  if (sources.size !== 1) throw Error('Mixed data origins');
  return freeze({ ...payload, readings: rows });
}

export class TireStatusStore {
  constructor() { this.listeners = new Set(); this.invalidate('DETACHED'); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const f of this.listeners) f(); }
  invalidate(connectionStatus = 'STOPPED') {
    this.sessionId = null; this.sequence = 0;
    this.state = freeze({ connectionStatus, sessionPhase: 'IDLE', readings: blankRows() }); this.emit();
  }
  accept(payload) {
    const next = validateTireStatus(payload);
    if ((this.sessionId !== null && next.sessionId !== this.sessionId) || next.sequence <= this.sequence) return false;
    this.sessionId = next.sessionId; this.sequence = next.sequence;
    const view = { connectionStatus: next.connectionStatus, sessionPhase: next.sessionPhase, readings: next.readings };
    const changed = JSON.stringify(view) !== JSON.stringify(this.state);
    this.state = freeze(view); if (changed) this.emit(); return true;
  }
  unavailable() {
    this.state = freeze({ connectionStatus: 'UNAVAILABLE', sessionPhase: 'UNVERIFIED',
      readings: this.state.readings.map(r => ({ ...r, availabilityStatus: 'ERROR', observedAt: null })) }); this.emit();
  }
  forTire(id) {
    const t = TIRES.find(t => t.id === id); if (!t) throw Error('Unknown tire ID');
    const features = TIRE_FEATURES.map(f => this.state.readings.find(r => r.featureId === f && r.vehiclePartId === id));
    return freeze({ label: t.label, vehiclePartId: id, source: features[0].source,
      connectionStatus: this.state.connectionStatus, sessionPhase: this.state.sessionPhase, features });
  }
}

/** One in-flight same-origin cache fetch. Polls never request a new SDK read or session. */
export class TireStatusClient {
  constructor(store, { fetchImpl = (...args) => fetch(...args), schedule = (f, ms) => setTimeout(f, ms), cancel = id => clearTimeout(id) } = {}) {
    Object.assign(this, { store, fetchImpl, schedule, cancel, running: false, generation: 0 });
  }
  start() { if (this.running) return; this.running = true; this.generation++; this.store.invalidate('DETACHED'); void this.poll(this.generation); }
  stop() {
    this.running = false; this.generation++; this.cancel(this.timer); this.controller?.abort();
    this.store.invalidate('STOPPED');
  }
  async poll(generation) {
    const controller = new AbortController(); this.controller = controller;
    const timeout = this.schedule(() => controller.abort(), 3000);
    try {
      const response = await this.fetchImpl('./tire-status.json', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.startsWith('application/json')) throw Error('Status transport unavailable');
      const text = await response.text(); if (text.length > 8192) throw Error('Status payload too large');
      if (!this.running || generation !== this.generation) return;
      const packet = JSON.parse(text);
      const accepted = this.store.accept(packet);
      if (!accepted && packet.sessionId !== this.store.sessionId) this.store.unavailable();
    } catch (_) { if (this.running && generation === this.generation) this.store.unavailable(); }
    finally {
      this.cancel(timeout);
      if (this.running && generation === this.generation) this.timer = this.schedule(() => void this.poll(generation), 1000);
    }
  }
}

export const tireStatus = new TireStatusStore();
export const tireStatusClient = new TireStatusClient(tireStatus);

let unbind;
export function enableTireStatus() {
  if (unbind) return;
  let active = true;
  const update = () => active && document.visibilityState !== 'hidden' ? tireStatusClient.start() : tireStatusClient.stop();
  const resume = () => { active = true; update(); };
  const stop = () => { active = false; update(); };
  addEventListener('carscope-tire-active', resume); addEventListener('carscope-tire-inactive', stop);
  document.addEventListener('visibilitychange', update);
  unbind = () => { removeEventListener('carscope-tire-active', resume); removeEventListener('carscope-tire-inactive', stop); document.removeEventListener('visibilitychange', update); };
  update();
}
export function disposeTireStatus() { unbind?.(); unbind = null; tireStatusClient.stop(); }
