// Served only by the loopback-only dev server. Never copied by the AR-01 staging build.
import { takeMobileHandoff } from './mobile-handoff.mjs';
import { MobileSync, SYNC_TEXT } from './mobile-sync.mjs';
import { SyncClient } from './sync-client.mjs';
import { startInspectionPage } from '../../mobile-ar-poc/public/app.mjs';

const entry = takeMobileHandoff(location, history);
let sync = null;
if (entry.version === 2) {
  const connection = document.createElement('section'); connection.className = 'card';
  connection.setAttribute('aria-label', '차량 점검 요청 연결');
  const title = document.createElement('strong'); title.textContent = '차량 점검 요청';
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const claim = document.createElement('button'); claim.id = 'sync-claim'; claim.type = 'button'; claim.textContent = '차량 요청에 연결';
  const send = document.createElement('button'); send.id = 'sync-send'; send.type = 'button'; send.textContent = '결과 전송'; send.disabled = true;
  const refresh = document.createElement('button'); refresh.id = 'sync-refresh'; refresh.type = 'button'; refresh.textContent = '처리 상태 다시 확인';
  const info = document.createElement('p'); info.className = 'fine'; info.textContent = '사용자 보고 결과만 전송합니다. 실제 차량 센서 진단이 아닙니다. 새로고침하면 연결을 복구할 수 없습니다.';
  connection.append(title, message, claim, info);
  document.getElementById('handoff-status').after(connection);
  const transport = document.getElementById('done-sync'); transport.setAttribute('role', 'status'); transport.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'row'; actions.append(send, refresh); transport.after(actions);
  sync = new MobileSync({ invite: entry.invite, client: new SyncClient({ baseUrl: location.origin }), onChange: (s) => {
    message.textContent = (s.display === 'NOT_SENT' ? s.connectionMessage : s.message) + (s.needsNewQr ? ' 연결 응답을 복구할 수 없습니다. 차량에서 새 QR을 요청하세요.' : '');
    claim.disabled = !s.canClaim;
    transport.textContent = s.message + (s.received && s.display !== 'ACCEPTED' && s.display !== 'SENT' ? ' 앞서 서버 수신을 확인했지만 차량의 최종 처리는 확인하지 못했습니다.' : '');
    send.disabled = !s.canSend; refresh.disabled = !s.canRefresh;
    send.textContent = ['FAILED_NETWORK', 'FAILED_TIMEOUT', 'RATE_LIMITED'].includes(s.display) ? '같은 결과 다시 전송' : '결과 전송';
    transport.dataset.syncState = s.display; // status only, never token/credential/receipt
  } });
  entry.invite = null;
  claim.addEventListener('click', () => { void sync.claim(); });
  send.addEventListener('click', () => { void sync.send(); });
  refresh.addEventListener('click', () => { void sync.refresh(); });
  // Initial render contains no credentials.
  message.textContent = SYNC_TEXT.INVITED; transport.textContent = SYNC_TEXT.NOT_SENT; refresh.disabled = true;
  addEventListener('pagehide', () => sync.close());
  addEventListener('pageshow', (e) => { if (e.persisted) sync.close(); });
  document.addEventListener('visibilitychange', () => document.hidden ? sync.pause() : sync.resume());
}
await startInspectionPage({ handoff: entry.handoff, onComplete: (record) => sync?.setResult(record), onRestart: () => sync?.close() });
if (entry.version === 2) document.getElementById('handoff-status').textContent = 'QR v2 점검 요청 · 사용자 보고 결과 전송';
