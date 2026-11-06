import { checkEnvelope, PROTOCOL, PROTOCOL_VERSION, receiptMatches } from '../src/protocol.mjs';
import { TRANSPORT } from './sync-client.mjs';

export const SYNC_TEXT = Object.freeze({
  INVITED: '차량에 연결하고 있어요',
  CLAIMING: '차량에 연결하고 있어요', CLAIMED: '차량과 연결됐어요',
  NOT_SENT: '아직 보내지 않았어요', SENDING: '결과를 보내고 있어요', SENT: '결과를 보냈어요. 차량 확인을 기다리고 있어요.',
  ACCEPTED: '차량에서 확인했어요. 점검 이력에 저장됐어요.', CANCELLED: '차량에서 점검을 취소했어요. 차량에서 QR을 다시 만들어 스캔해 주세요.',
  FAILED_NETWORK: '보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', FAILED_TIMEOUT: '응답이 늦어 보냈는지 확인하지 못했어요. 다시 시도해 주세요.',
  REJECTED_EXPIRED: '연결 시간이 지났어요. 차량에서 QR을 다시 만들어 스캔해 주세요.',
  REJECTED_CLOSED: '연결이 끝났어요. 차량에서 QR을 다시 만들어 스캔해 주세요.',
  REJECTED_CONFLICT: '이 연결로 이미 다른 결과를 보냈어요. 차량에서 QR을 다시 만들어 스캔해 주세요.',
  REJECTED_INVALID: '결과를 확인하지 못해 전송을 끝내지 못했어요. 차량에서 QR을 다시 만들어 주세요.',
  REJECTED_UNAUTHORIZED: '이미 쓴 QR이거나 확인할 수 없는 QR이에요. 차량에서 QR을 다시 만들어 스캔해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
});
const STOP = new Set(['ACCEPTED', 'CANCELLED', 'REJECTED_EXPIRED', 'REJECTED_CLOSED', 'REJECTED_UNAUTHORIZED', 'REJECTED_CONFLICT', 'REJECTED_INVALID']);
const RETRY = new Set(['FAILED_NETWORK', 'FAILED_TIMEOUT', 'RATE_LIMITED']);

// UI state has no bearer tokens. All credentials are private and die with this page instance.
export class MobileSync {
  #invite; #client; #result = null; #timer = null; #busy = false; #polling = false;
  #closed = false; #paused = false; #generation = 0; #errors = 0; #attempted = false;
  #connection = 'INVITED'; #display = 'NOT_SENT'; #received = false; #terminal = false;
  #task;
  constructor({ invite, client,taskId='washer-fluid', onChange = () => {}, schedule = setTimeout, unschedule = clearTimeout, intervalMs = 2000 }) {
    this.#task=taskId;
    this.#invite = invite; this.#client = client; this.onChange = onChange;
    this.schedule = (...args) => schedule(...args); this.unschedule = (...args) => unschedule(...args); this.intervalMs = intervalMs;
  }
  get snapshot() {
    return Object.freeze({ connection: this.#connection, display: this.#display, message: SYNC_TEXT[this.#display],
      connectionMessage: SYNC_TEXT[this.#connection], received: this.#received,
      canClaim: !this.#attempted && !this.#terminal && !this.#closed, canSend: Boolean(this.#result && this.#client.paired && !this.#busy && !this.#polling && !this.#received && !this.#terminal && !this.#closed),
      canRefresh: this.#client.paired && !this.#terminal && !this.#closed && !this.#busy && !this.#polling,
      needsNewQr: this.#attempted && !this.#busy && !this.#client.paired && this.#connection !== 'CLAIMED' });
  }
  #emit() { this.onChange(this.snapshot); }
  #stopTimer() { if (this.#timer !== null) this.unschedule(this.#timer); this.#timer = null; }
  #later() {
    this.#stopTimer();
    if (this.#closed || this.#paused || this.#terminal || !this.#client.paired || this.#errors >= 3) return;
    this.#timer = this.schedule(() => { this.#timer = null; void this.refresh(); }, Math.min(16000, this.intervalMs * 2 ** this.#errors));
  }
  #show(display) {
    this.#display = display;
    if (STOP.has(display)) { this.#terminal = true; this.#stopTimer(); this.#client.dispose(); }
    this.#emit();
  }
  async claim() {
    if (!this.snapshot.canClaim) return;
    this.#attempted = true; this.#busy = true; this.#connection = 'CLAIMING'; this.#emit();
    const generation = this.#generation;
    const token = this.#invite; this.#invite = null;
    const r = await this.#client.claim(token);
    if (generation !== this.#generation) return;
    this.#busy = false;
    this.#connection = r.ok ? 'CLAIMED' : (r.outcome ?? 'REJECTED_INVALID');
    if (!r.ok) this.#show(r.outcome ?? 'REJECTED_INVALID');
    else { this.#emit(); this.#later(); }
  }
  setResult(result) {
    if (this.#closed || this.#result) return; // one local completed record per connection
    if (checkEnvelope({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result }, this.#task).length) { this.#show('REJECTED_INVALID'); return; }
    this.#result = structuredClone(result); this.#emit();
  }
  async send() {
    if (!this.snapshot.canSend) return;
    const generation = this.#generation;
    this.#busy = true; this.#show('SENDING');
    const r = await this.#client.send(this.#result);
    if (generation !== this.#generation) return;
    this.#busy = false;
    if (r.transport === TRANSPORT.SENT) this.#received = true;
    this.#show(r.transport); this.#later();
  }
  async refresh() {
    if (!this.snapshot.canRefresh || this.#paused) return;
    const generation = this.#generation;
    this.#polling = true; this.#stopTimer();
    const r = await this.#client.status();
    if (generation !== this.#generation) return;
    this.#polling = false;
    if (!r.ok) { this.#errors++; this.#show(r.outcome ?? 'FAILED_NETWORK'); }
    else {
      this.#errors = 0;
      if (r.sessionState === 'CANCELLED') this.#show('CANCELLED');
      else if (r.sessionState === 'EXPIRED') this.#show('REJECTED_EXPIRED');
      else if (['ACCEPTED', 'RESULT_SUBMITTED'].includes(r.sessionState)) {
        const matches = this.#result && r.receipt?.sessionState === r.sessionState && await receiptMatches(r.receipt, this.#result);
        if (generation !== this.#generation) return;
        if (!matches) this.#show('REJECTED_INVALID');
        else { this.#received = true; this.#show(r.sessionState === 'ACCEPTED' ? 'ACCEPTED' : 'SENT'); }
      } else if (RETRY.has(this.#display)) this.#show(this.#received ? 'SENT' : 'NOT_SENT');
      else this.#emit();
    }
    this.#later();
  }
  pause() { this.#paused = true; this.#stopTimer(); }
  resume() { this.#paused = false; this.#errors = 0; this.#later(); }
  close() {
    this.#generation++; this.#closed = true; this.#invite = null; this.#result = null;
    this.#stopTimer(); this.#client.dispose(); this.#show('REJECTED_CLOSED');
  }
}
