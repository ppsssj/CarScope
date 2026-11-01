// AR-01 washer-fluid self-inspection page. Steps come from self-inspection.mjs (pure), the record from
// inspection-result.mjs, the camera lifecycle and blue-candidate overlay from the QR-AR PoC (camera.mjs,
// detector.mjs, unchanged). The user's mark is a 2D screen point, not a 3D anchor. Nothing is uploaded or sent.
import { parseHandoff } from './handoff.mjs';
import { detectCandidates, containRect } from './detector.mjs';
import { CameraSession, cameraError } from './camera.mjs';
import { reduce, initialState, allChecked, progressOf, CHECK_ITEMS } from './self-inspection.mjs';
import { validateResult, STATUS_TEXT } from './inspection-result.mjs';
import { tapToVideoPoint, videoPointToStage, drawMarker } from './marker.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const frame = document.createElement('canvas'), frameContext = frame.getContext('2d', { willReadFrequently: true });
const handoff = parseHandoff(location.hash);
let state = initialState();
let timer = null, lastStatus = '', misses = 0, request = 0, lastVideoTime = -1, lastFrameAt = 0;
let candidates = [], mark = null, markVideoSize = null;
// The "새 점검 시작" button sits where "점검 완료" was: ignore it briefly so a double tap cannot skip the result.
const DONE_GUARD_MS = 1000;
let doneGuardUntil = 0;

// ---------- camera (QR-AR PoC lifecycle) ----------
function status(message) {
  if (message !== lastStatus) { $('status').textContent = message; lastStatus = message; }
}
function clearOverlay() { ctx.clearRect(0, 0, overlay.width, overlay.height); }
const cameraRunning = () => Boolean(timer);
function clearMark(notice) {
  const had = Boolean(mark);
  mark = null; markVideoSize = null;
  $('clear-mark').disabled = true;
  $('stage').removeAttribute('data-marked');
  if (had && notice) status(notice);
  updateChip();
}
function stop(message = '카메라 중지 · 수동 안내를 사용할 수 있습니다.') {
  request++;
  clearInterval(timer); timer = null;
  camera.stop(); clearOverlay(); candidates = [];
  lastVideoTime = -1; lastFrameAt = 0;
  $('start').disabled = !handoff.valid; $('stop').disabled = true;
  $('placeholder').hidden = false;
  clearMark();
  status(message);
  updateChip();
}
const camera = new CameraSession(video, navigator.mediaDevices, () => stop('카메라 연결이 종료되었습니다. 수동 안내를 사용하세요.'));

function draw() {
  clearOverlay();
  if (!video.videoWidth || !video.videoHeight) return;
  const bounds = $('stage').getBoundingClientRect(), dpr = devicePixelRatio;
  overlay.width = Math.round(bounds.width * dpr); overlay.height = Math.round(bounds.height * dpr);
  const rect = containRect(video.videoWidth, video.videoHeight, overlay.width, overlay.height);
  ctx.strokeStyle = '#ffe16a'; ctx.fillStyle = '#ffe16a'; ctx.lineWidth = 3 * dpr;
  ctx.font = `bold ${14 * dpr}px system-ui`;
  ctx.setLineDash([7 * dpr, 4 * dpr]);
  for (const [index, box] of candidates.entries()) {
    const x = rect.x + box.x * rect.width, y = rect.y + box.y * rect.height;
    ctx.strokeRect(x, y, box.width * rect.width, box.height * rect.height);
    if (mark) continue; // once the user has marked a spot, their label is the one that matters
    const labelY = Math.max(20 * dpr, y - 5 * dpr);
    ctx.fillStyle = '#18232f'; ctx.fillRect(x, labelY - 17 * dpr, 130 * dpr, 22 * dpr);
    ctx.fillStyle = '#ffe16a'; ctx.fillText(`후보 ${index + 1} · 미검증`, x + 3 * dpr, labelY);
  }
  if (mark) drawMarker(ctx, videoPointToStage(mark, video.videoWidth, video.videoHeight, overlay.width, overlay.height), dpr);
}

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
  // The mark is a point in the video frame; a new frame shape (rotation, other camera) makes it meaningless.
  if (mark && (markVideoSize[0] !== video.videoWidth || markVideoSize[1] !== video.videoHeight)) {
    clearMark('화면 방향이나 영상 크기가 바뀌어 지정한 위치를 해제했습니다. 필요하면 다시 탭해 지정하세요.');
  }
  try {
    const scale = Math.min(320 / video.videoWidth, 240 / video.videoHeight, 1);
    frame.width = Math.max(1, Math.round(video.videoWidth * scale));
    frame.height = Math.max(1, Math.round(video.videoHeight * scale));
    frameContext.drawImage(video, 0, 0, frame.width, frame.height);
    candidates = detectCandidates(frameContext.getImageData(0, 0, frame.width, frame.height));
    draw();
    if (mark) status('위치 지정됨 · 휴대폰을 움직이면 표시가 실제 위치와 어긋날 수 있습니다. 다시 탭하면 옮겨집니다.');
    else if (candidates.length) { misses = 0; status(`파란색 후보 ${candidates.length}개 · 주입구 식별 아님. 워셔 표시를 직접 확인하고 화면을 탭해 위치를 지정하세요.`); }
    else { misses++; status(misses >= 12 ? '후보를 찾지 못했습니다. 화면을 탭해 직접 지정하거나 수동 안내를 사용하세요.' : '후보 없음 · 조명과 촬영 각도를 바꾸거나 화면을 탭해 직접 지정하세요.'); }
  } catch { stop('영상 분석에 실패했습니다. 수동 안내를 사용하세요.'); }
}

async function startCamera() {
  if (!handoff.valid) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    stop('카메라 미지원 · 스마트폰에서는 신뢰하는 HTTPS 주소와 지원 브라우저가 필요합니다. 수동 안내를 사용하세요.'); return;
  }
  const current = ++request;
  clearMark();
  $('start').disabled = true; $('stop').disabled = false; status('카메라 권한을 요청합니다…');
  try {
    if (!await camera.start() || current !== request) return;
    misses = 0; $('placeholder').hidden = true;
    dispatch({ type: 'NOTE_AIDS', cameraUsed: true });
    scan();
    if (current === request) timer = setInterval(scan, 250);
    updateChip();
  } catch (error) { if (current === request) stop(`${cameraError(error)} 수동 안내를 사용하세요.`); }
}

// ---------- user's mark (2D, tap on the camera view) ----------
let downAt = null;
$('stage').addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
$('stage').addEventListener('pointerup', (e) => {
  const tapped = downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 12;
  downAt = null;
  if (!tapped || !cameraRunning() || !['locate', 'check'].includes(state.step)) return;
  const b = $('stage').getBoundingClientRect();
  const p = tapToVideoPoint(e.clientX - b.left, e.clientY - b.top, video.videoWidth, video.videoHeight, b.width, b.height);
  if (!p) { status('영상 바깥을 눌렀습니다. 영상 안의 주입구를 탭하세요.'); return; }
  mark = p; markVideoSize = [video.videoWidth, video.videoHeight];
  $('clear-mark').disabled = false;
  $('stage').setAttribute('data-marked', `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
  dispatch({ type: 'NOTE_AIDS', locationMarked: true });
  draw();
  status('위치 지정됨 · 사용자가 지정한 2D 표시입니다. 휴대폰을 움직이면 실제 위치와 어긋날 수 있습니다.');
  updateChip();
});
$('clear-mark').addEventListener('click', () => { clearMark('지정한 위치를 해제했습니다.'); draw(); });

function updateChip() {
  const chip = $('stage-chip');
  if (!cameraRunning()) { chip.textContent = ''; return; }
  chip.textContent = state.step === 'check' ? '3/4 셀프 점검 · 아래 항목을 직접 확인하세요'
    : mark ? '2/4 위치 지정됨 · 다시 탭하면 옮겨집니다' : '2/4 위치 찾기 · 주입구를 찾으면 화면을 탭하세요';
}

// ---------- flow ----------
function dispatch(event) {
  const prev = state, next = reduce(state, event);
  if (next === prev) return false;
  state = next;
  // Arm the guard before rendering, so the done step's button is drawn disabled.
  if (prev.step !== 'done' && state.step === 'done') { doneGuardUntil = Date.now() + DONE_GUARD_MS; setTimeout(render, DONE_GUARD_MS + 20); }
  // Camera only on the locate/check steps in camera mode.
  const cameraStep = (state.step === 'locate' || state.step === 'check') && state.mode === 'camera';
  if (!cameraStep && (cameraRunning() || camera.stream)) stop(state.step === 'intro' ? '카메라 중지' : '다음 단계로 이동해 카메라를 중지했습니다.');
  render();
  if (prev.step !== state.step) {
    scrollTo(0, 0); // each step starts at the top (camera stage under the header, actions at the bottom)
    // Move focus to the new step's heading only when the step changes (not on every checkbox toggle).
    if (['check', 'result', 'confirm', 'done'].includes(state.step)) $(`step-${state.step}`).querySelector('h2')?.focus({ preventScroll: true });
  }
  return true;
}

const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' });
function summary(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([k, v, cls]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; if (cls) dd.className = cls;
    return [dt, dd];
  }));
}

const PRIMARY = {
  intro: ['카메라로 점검 시작', () => true],
  locate: ['다음: 셀프 점검', () => true],
  check: ['다음: 결과 선택', () => allChecked(state)],
  result: ['다음: 결과 확인', () => Boolean(state.choice)],
  confirm: ['이 결과로 점검 완료', () => true],
  done: ['새 점검 시작', () => Date.now() >= doneGuardUntil],
};

function render() {
  document.body.dataset.step = state.step;
  document.body.dataset.mode = state.mode ?? '';
  const p = progressOf(state.step);
  for (const li of $('progress').children) {
    const n = Number(li.dataset.n);
    li.className = n < p || state.step === 'done' ? 'done' : n === p ? 'current' : '';
    if (n === p) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
  $('cancel').hidden = state.step === 'intro' || state.step === 'done';
  $('cancel-confirm').hidden = true;
  const [label, enabled] = PRIMARY[state.step];
  $('primary').textContent = label;
  $('primary').disabled = !enabled() || (state.step === 'intro' && !handoff.valid);
  $('manual-start').disabled = !handoff.valid;
  for (const box of $('checklist').querySelectorAll('input')) box.checked = state.checks[box.value];
  for (const b of $('choices').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.status === state.choice));
  $('confirm-unsure').hidden = !(state.step === 'confirm' && state.unsureFrom);
  if (state.step === 'confirm') {
    summary($('confirm-summary'), [['점검 항목', '워셔액'], ['선택한 결과', STATUS_TEXT[state.choice].label, `status-${state.choice}`], ['점검 방식', '셀프 점검 (SELF)'],
      ['확인 근거', state.unsureFrom ? '사용자 보고 · 확인하지 못함' : '사용자 직접 확인']]);
  }
  if (state.step === 'done') {
    const r = state.record, problems = validateResult(r);
    if (problems.length) { $('done-follow').textContent = `결과 데이터를 만들지 못했습니다 (${problems.join(', ')}). 새 점검을 시작하세요.`; return; }
    summary($('done-summary'), [['점검 항목', '워셔액'], ['사용자 확인 결과', STATUS_TEXT[r.status].label, `status-${r.status}`], ['점검 시각', fmt(r.completedAt)], ['점검 방식', 'SELF · 셀프 점검'], ['확인 근거', 'USER_REPORTED · 사용자 보고']]);
    $('done-follow').textContent = STATUS_TEXT[r.status].followUp;
    $('result-json').textContent = JSON.stringify(r, null, 2);
  }
  updateChip();
}

// Checklist and choices are built once; state decides what is checked.
for (const item of CHECK_ITEMS) {
  const label = document.createElement('label'), box = document.createElement('input'), text = document.createElement('span');
  box.type = 'checkbox'; box.value = item.id; text.textContent = item.label;
  box.addEventListener('change', () => dispatch({ type: 'TOGGLE', id: item.id, value: box.checked }));
  label.append(box, text); $('checklist').appendChild(label);
}
for (const b of $('choices').querySelectorAll('button')) b.addEventListener('click', () => dispatch({ type: 'SELECT', status: b.dataset.status }));
for (const h of document.querySelectorAll('.step h2')) h.tabIndex = -1;

$('primary').addEventListener('click', () => {
  switch (state.step) {
    case 'intro': if (dispatch({ type: 'START', camera: true })) startCamera(); break; // same tap -> permission prompt
    case 'locate': dispatch({ type: 'TO_CHECK' }); break;
    case 'check': dispatch({ type: 'TO_RESULT' }); break;
    case 'result': dispatch({ type: 'TO_CONFIRM' }); break;
    case 'confirm': $('primary').disabled = true; dispatch({ type: 'CONFIRM' }); break; // one record per attempt
    case 'done': dispatch({ type: 'RESTART' }); break;
  }
});
$('manual-start').addEventListener('click', () => dispatch({ type: 'START', camera: false }));
$('locate-manual').addEventListener('click', () => dispatch({ type: 'TO_CHECK', manual: true }));
// "확인할 수 없음": straight to confirming UNSURE; the checklist is left exactly as the user marked it.
for (const id of ['unsure-locate', 'unsure-check']) $(id).addEventListener('click', () => dispatch({ type: 'CANNOT_CONFIRM' }));
$('start').addEventListener('click', () => startCamera());
$('stop').addEventListener('click', () => stop());
$('back').addEventListener('click', () => dispatch({ type: 'BACK' }));
$('cancel').addEventListener('click', () => { $('cancel-confirm').hidden = false; $('cancel-no').focus(); });
$('cancel-no').addEventListener('click', () => { $('cancel-confirm').hidden = true; });
$('cancel-yes').addEventListener('click', () => { stop('점검을 취소했습니다.'); dispatch({ type: 'CANCEL' }); });
$('manual').addEventListener('click', () => { stop('수동 안내 모드 · 카메라를 중지했습니다.'); $('guidance').focus(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('화면이 숨겨져 카메라를 중지했습니다. 다시 시작하려면 카메라 시작을 누르세요.'); });
addEventListener('pagehide', () => stop());
video.addEventListener('stalled', () => stop('카메라 영상이 정지했습니다. 수동 안내를 사용하세요.'));
video.addEventListener('error', () => stop('카메라 영상 오류 · 수동 안내를 사용하세요.'));
new ResizeObserver(() => { if (timer) draw(); else clearOverlay(); }).observe($('stage'));
addEventListener('hashchange', () => location.reload());

$('handoff-status').textContent = !handoff.valid ? '지원하지 않는 QR 요청입니다. 점검을 시작할 수 없습니다. 아래 수동 안내를 사용하세요.' :
  handoff.source === 'qr-task' ? 'QR 작업 수신: 워셔액 점검 · 차량·센서 연결 없음' : '직접 방문 · 차량·센서 연결 없음';
$('start').disabled = !handoff.valid;
render();
// Test hook (read-only view of the flow; the page itself never sends this anywhere).
window.__selfInspection = { get state() { return state; }, get mark() { return mark; } };

try {
  const response = await fetch('/handoff.json');
  if (!response.ok) throw new Error('handoff unavailable');
  const config = await response.json();
  if (!config.configured) $('qr-status').textContent = 'QR 미설정 · 서버의 POC_BASE_URL에 스마트폰에서 접근 가능한 HTTPS 루트 주소를 설정하세요.';
  else {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || !parseHandoff(url.hash).valid) throw new Error('invalid handoff');
    const image = document.createElement('img'); image.src = '/qr.svg'; image.alt = '워셔액 점검 작업을 스마트폰으로 전달하는 QR 코드';
    image.addEventListener('error', () => { $('qr-status').textContent = 'QR 이미지를 표시하지 못했습니다. 아래 연결 주소를 사용하세요.'; });
    $('qr').replaceChildren(image);
    $('handoff-link').href = url.href; $('handoff-link').textContent = url.href; $('handoff-link').hidden = false;
    $('qr-status').textContent = '스마트폰에서 인증서를 신뢰하고 이 주소에 접근할 수 있어야 합니다.';
  }
} catch { $('qr-status').textContent = 'QR 설정을 읽지 못했습니다. 수동 안내를 사용할 수 있습니다.'; }
