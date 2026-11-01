// AR-02A debug page: pairs through a QR v2 invite and sends a completed AR-01 record. Debug only, same-origin only.
import { SyncClient, TRANSPORT, takeInviteFromLocation } from './sync-client.mjs';
import { startInspection, completeInspection } from '../mobile-ar-poc/public/inspection-result.mjs';

const $ = (id) => document.getElementById(id);
const invite = takeInviteFromLocation(); // the token leaves the address bar immediately
const client = new SyncClient({ baseUrl: location.origin });
let record = null;

$('pairing').textContent = invite.valid ? `QR v2 초대 수신 · 작업: ${invite.task} · 주소창에서 초대 토큰을 지웠습니다.` : 'QR v2 초대가 없거나 형식이 맞지 않습니다. 페어링할 수 없습니다.';
$('claim').disabled = !invite.valid;

const render = () => {
  $('transport').textContent = client.transport;
  $('send').disabled = !(client.paired && record && client.transport !== TRANSPORT.SENT && client.transport !== TRANSPORT.SENDING);
  $('status').disabled = !client.paired;
  $('record').textContent = record ? JSON.stringify(record, null, 2) : '아직 완료된 결과가 없습니다.';
};

$('claim').addEventListener('click', async () => {
  $('claim').disabled = true;
  const r = await client.claim(invite.invite);
  $('claim-status').textContent = r.ok ? '페어링됨 · 이 휴대폰만 결과를 보낼 수 있습니다.' : `페어링 실패: ${r.outcome}`;
  if (!r.ok) $('claim').disabled = false;
  render();
});

$('complete').addEventListener('click', () => {
  if (record) return; // one completed record per attempt
  const status = document.querySelector('input[name="status"]:checked').value;
  record = completeInspection(startInspection(), status);
  $('complete').disabled = true;
  render();
});

$('send').addEventListener('click', async () => {
  $('send').disabled = true;
  $('transport').textContent = TRANSPORT.SENDING;
  const r = await client.send(record);
  $('send-detail').textContent = r.transport === TRANSPORT.SENT ? `서버 수신 확인 · ${new Date(r.receipt.receivedAt).toLocaleString('ko-KR')} · 차량 수락 전` : `전송되지 않음: ${r.transport}${r.error ? ` (${r.error})` : ''}`;
  render();
});

$('status').addEventListener('click', async () => {
  const s = await client.status();
  $('session-state').textContent = s.ok ? `세션 상태: ${s.sessionState}` : `확인 실패: ${s.outcome}`;
});

render();
window.__syncDebug = { get transport() { return client.transport; }, get receipt() { return client.receipt; }, get record() { return record; } };
