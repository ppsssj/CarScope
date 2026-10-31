import { parseHandoff } from './handoff.mjs';
import { detectCandidates, containRect } from './detector.mjs';
import { CameraSession, cameraError } from './camera.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const frame = document.createElement('canvas'), frameContext = frame.getContext('2d', { willReadFrequently: true });
const handoff = parseHandoff(location.hash);
let timer = null, lastStatus = '', misses = 0, request = 0, lastVideoTime = -1, lastFrameAt = 0;
function status(message) {
  if (message !== lastStatus) { $('status').textContent = message; lastStatus = message; }
}
function clearOverlay() { ctx.clearRect(0, 0, overlay.width, overlay.height); }
function stop(message = '카메라 중지 · 수동 안내를 사용할 수 있습니다.') {
  request++;
  clearInterval(timer); timer = null;
  camera.stop(); clearOverlay();
  lastVideoTime = -1; lastFrameAt = 0;
  $('start').disabled = !handoff.valid; $('stop').disabled = true;
  $('placeholder').hidden = false;
  status(message);
}
const camera = new CameraSession(video, navigator.mediaDevices, () => stop('카메라 연결이 종료되었습니다. 수동 안내를 사용하세요.'));
$('handoff-status').textContent = !handoff.valid ? '지원하지 않는 QR 요청입니다. 카메라는 시작하지 않습니다. 수동 안내를 사용하세요.' :
  handoff.source === 'qr-task' ? 'QR 작업 수신: 워셔액 안내 · 차량·센서 연결 없음' : '직접 방문 · 차량·센서 연결 없음';
$('start').disabled = !handoff.valid;
addEventListener('hashchange', () => location.reload());

function scan() {
  // Never leave boxes from an older frame on an unavailable/stalled video.
  clearOverlay();
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    status('영상 대기 · 수동 안내를 사용할 수 있습니다.'); return;
  }
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime; lastFrameAt = performance.now();
  } else if (performance.now() - lastFrameAt > 2000) {
    stop('카메라 영상 갱신이 멈췄습니다. 수동 안내를 사용하세요.'); return;
  }
  try {
    const scale = Math.min(320 / video.videoWidth, 240 / video.videoHeight, 1);
    frame.width = Math.max(1, Math.round(video.videoWidth * scale));
    frame.height = Math.max(1, Math.round(video.videoHeight * scale));
    frameContext.drawImage(video, 0, 0, frame.width, frame.height);
    const candidates = detectCandidates(frameContext.getImageData(0, 0, frame.width, frame.height));
    const bounds = $('stage').getBoundingClientRect();
    overlay.width = Math.round(bounds.width * devicePixelRatio); overlay.height = Math.round(bounds.height * devicePixelRatio);
    const rect = containRect(video.videoWidth, video.videoHeight, overlay.width, overlay.height);
    ctx.strokeStyle = '#ffe16a'; ctx.fillStyle = '#ffe16a'; ctx.lineWidth = 3 * devicePixelRatio;
    ctx.font = `bold ${14 * devicePixelRatio}px system-ui`;
    ctx.setLineDash([7 * devicePixelRatio, 4 * devicePixelRatio]);
    for (const [index, box] of candidates.entries()) {
      const x = rect.x + box.x * rect.width, y = rect.y + box.y * rect.height;
      ctx.strokeRect(x, y, box.width * rect.width, box.height * rect.height);
      const labelY = Math.max(20 * devicePixelRatio, y - 5 * devicePixelRatio);
      ctx.fillStyle = '#18232f'; ctx.fillRect(x, labelY - 17 * devicePixelRatio, 155 * devicePixelRatio, 22 * devicePixelRatio);
      ctx.fillStyle = '#ffe16a'; ctx.fillText(`후보 ${index + 1} · 미검증`, x + 3 * devicePixelRatio, labelY);
    }
    if (candidates.length) { misses = 0; status(`파란색 후보 ${candidates.length}개 · 주입구 식별 아님. 워셔 표시를 직접 확인하세요.`); }
    else { misses++; status(misses >= 12 ? '후보를 찾지 못했습니다. 아래 수동 안내를 사용하세요.' : '후보 없음 · 조명과 촬영 각도를 바꾸거나 수동 안내를 사용하세요.'); }
  } catch { stop('영상 분석에 실패했습니다. 수동 안내를 사용하세요.'); }
}
$('start').addEventListener('click', async () => {
  if (!handoff.valid) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    stop('카메라 미지원 · 스마트폰에서는 신뢰하는 HTTPS 주소와 지원 브라우저가 필요합니다. 수동 안내를 사용하세요.'); return;
  }
  const current = ++request;
  $('start').disabled = true; $('stop').disabled = false; status('카메라 권한을 요청합니다…');
  try {
    if (!await camera.start() || current !== request) return;
    misses = 0; $('placeholder').hidden = true; scan();
    if (current === request) timer = setInterval(scan, 250);
  } catch (error) { if (current === request) stop(`${cameraError(error)} 수동 안내를 사용하세요.`); }
});
$('stop').addEventListener('click', () => stop());
$('manual').addEventListener('click', () => { stop('수동 안내 모드 · 카메라를 중지했습니다.'); $('guidance').focus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('화면이 숨겨져 카메라를 중지했습니다. 다시 시작하려면 버튼을 누르세요.'); });
addEventListener('pagehide', () => stop());
video.addEventListener('stalled', () => stop('카메라 영상이 정지했습니다. 수동 안내를 사용하세요.'));
video.addEventListener('error', () => stop('카메라 영상 오류 · 수동 안내를 사용하세요.'));
new ResizeObserver(() => { if (timer) scan(); else clearOverlay(); }).observe($('stage'));

try {
  const response = await fetch('/handoff.json');
  if (!response.ok) throw new Error('handoff unavailable');
  const config = await response.json();
  if (!config.configured) $('qr-status').textContent = 'QR 미설정 · 서버의 POC_BASE_URL에 스마트폰에서 접근 가능한 HTTPS 루트 주소를 설정하세요.';
  else {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || !parseHandoff(url.hash).valid) throw new Error('invalid handoff');
    const image = document.createElement('img'); image.src = '/qr.svg'; image.alt = '워셔액 안내 작업을 스마트폰으로 전달하는 QR 코드';
    image.addEventListener('error', () => { $('qr-status').textContent = 'QR 이미지를 표시하지 못했습니다. 아래 연결 주소를 사용하세요.'; });
    $('qr').replaceChildren(image);
    $('handoff-link').href = url.href; $('handoff-link').textContent = url.href; $('handoff-link').hidden = false;
    $('qr-status').textContent = '스마트폰에서 인증서를 신뢰하고 이 주소에 접근할 수 있어야 합니다.';
  }
} catch { $('qr-status').textContent = 'QR 설정을 읽지 못했습니다. 수동 안내를 사용할 수 있습니다.'; }
