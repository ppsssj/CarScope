// Served by the explicit same-origin dev/HTTPS service. Never copied by the AR-01 staging build.
import { takeMobileHandoff } from './mobile-handoff.mjs';
import { MobileSync, SYNC_TEXT } from './mobile-sync.mjs';
import { SyncClient } from './sync-client.mjs';
import { startInspectionPage,prepareInspectionPage } from '../../mobile-ar-poc/public/app.mjs';

const entry = takeMobileHandoff(location, history);
prepareInspectionPage(entry.handoff);
let sync = null;
if (entry.version === 2) {
  document.body.dataset.flow = 'qr';
  const connection = document.createElement('section'); connection.id = 'sync-connection';
  connection.setAttribute('aria-label', '차량 연결 상태');
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const claim = document.createElement('button'); claim.id = 'sync-claim'; claim.type = 'button'; claim.textContent = '차량 요청에 연결';
  const send = document.createElement('button'); send.id = 'sync-send'; send.type = 'button'; send.className = 'primary'; send.textContent = '결과 보내기'; send.disabled = true;
  const refresh = document.createElement('button'); refresh.id = 'sync-refresh'; refresh.type = 'button'; refresh.textContent = '상태 다시 확인'; refresh.hidden = true;
  claim.hidden = true; // Connecting needs no tap. The element carries the state that a failed claim leaves behind.
  connection.append(message, claim);
  document.getElementById('handoff-status').after(connection);
  const transport = document.getElementById('done-sync'); transport.classList.remove('card', 'muted'); transport.setAttribute('role', 'status'); transport.setAttribute('aria-live', 'polite');
  const timeline = document.createElement('ol'); timeline.id = 'sync-timeline'; timeline.setAttribute('aria-label', '전송 진행 상태');
  const stages = ['점검 완료', '결과 전송', '차량 확인'].map((text) => { const li = document.createElement('li'); li.textContent = text; timeline.append(li); return li; });
  // What is happening to the result comes first; the answers it carries follow.
  const doneTitle = document.getElementById('done-title'); doneTitle.after(timeline, transport, refresh);
  document.querySelector('.actions').append(send);
  const debugSync = document.createElement('p'); debugSync.id = 'debug-sync'; document.getElementById('debug-area').append(debugSync);
  const TITLE = { NOT_SENT: '결과를 차량으로 보내 주세요', SENDING: '결과를 보내고 있어요', SENT: '결과를 보냈어요', ACCEPTED: '차량에서 확인했어요', FAILED_NETWORK: '보내지 못했어요', FAILED_TIMEOUT: '보냈는지 확인하지 못했어요', RATE_LIMITED: '잠시 후 다시 시도해 주세요' };
  const RETRY = new Set(['FAILED_NETWORK', 'FAILED_TIMEOUT', 'RATE_LIMITED']);
  const stageClasses = (s) => {
    if (s.display === 'ACCEPTED') return ['done', 'done', 'done'];
    if (s.display === 'SENT') return ['done', 'done', 'current'];
    if (s.received) return ['done', 'done', 'failed']; // Received earlier, and the vehicle's decision could not be confirmed.
    if (s.display === 'NOT_SENT' || s.display === 'SENDING') return ['done', 'current', ''];
    return ['done', 'failed', ''];
  };
  const taskId=entry.handoff.task??'washer-fluid';
  sync = new MobileSync({ invite: entry.invite,taskId, client: new SyncClient({ baseUrl: location.origin,taskId }), onChange: (s) => {
    const ended = s.display !== 'NOT_SENT' && s.display !== 'SENDING' && s.display !== 'SENT' && !RETRY.has(s.display);
    const connecting = s.connection === 'INVITED' || s.connection === 'CLAIMING';
    const lost = ended && s.display !== 'ACCEPTED';
    message.textContent = lost ? s.message : s.needsNewQr ? '연결하지 못했어요. 차량에서 QR을 다시 만들어 스캔해 주세요.' : s.connectionMessage ?? s.message;
    connection.dataset.tone = lost || s.needsNewQr ? 'error' : connecting ? 'busy' : 'ok';
    claim.disabled = !s.canClaim;
    transport.textContent = s.message + (s.received && !['ACCEPTED', 'SENT'].includes(s.display) ? ' 결과는 이미 보냈지만 차량 확인 여부는 알 수 없어요.' : '');
    doneTitle.textContent = TITLE[s.display] ?? '이어서 진행할 수 없어요';
    stageClasses(s).forEach((name, index) => { stages[index].className = name; });
    send.disabled = !s.canSend; send.hidden = s.received || ended; refresh.disabled = !s.canRefresh; refresh.hidden = !s.canRefresh || !(s.received || RETRY.has(s.display));
    send.textContent = RETRY.has(s.display) ? '같은 결과 다시 보내기' : s.display === 'SENDING' ? '보내는 중…' : '결과 보내기';
    if (ended) document.body.dataset.syncEnd = 'true'; else delete document.body.dataset.syncEnd;
    transport.dataset.syncState = s.display; // status only, never token/credential/receipt
    debugSync.textContent = `connection=${s.connection} display=${s.display}`;
  } });
  entry.invite = null;
  // The invite stays one-time on the server. Only a page someone is looking at uses it, so a prerender or a background preview does not.
  const connect = () => { if (!document.hidden) void sync.claim(); };
  document.addEventListener('visibilitychange', connect);
  send.addEventListener('click', () => { void sync.send(); });
  refresh.addEventListener('click', () => { void sync.refresh(); });
  // Initial render contains no credentials.
  message.textContent = SYNC_TEXT.INVITED; connection.dataset.tone = 'busy'; transport.textContent = SYNC_TEXT.NOT_SENT; refresh.disabled = true; doneTitle.textContent = TITLE.NOT_SENT; stageClasses({ display: 'NOT_SENT' }).forEach((name, index) => { stages[index].className = name; });
  connect();
  addEventListener('pagehide', () => sync.close());
  addEventListener('pageshow', (e) => { if (e.persisted) sync.close(); });
  document.addEventListener('visibilitychange', () => document.hidden ? sync.pause() : sync.resume());
}
await startInspectionPage({ handoff: entry.handoff, onComplete: (record) => sync?.setResult(record), onRestart: () => sync?.close() });
if (entry.version === 2) document.getElementById('handoff-status').textContent = '';
