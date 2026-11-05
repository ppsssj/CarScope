// AR-01 washer-fluid self-inspection page. Steps come from self-inspection.mjs (pure), the record from
// inspection-result.mjs, and the shared InspectionCamera lifecycle. The blue color proposal remains unverified. The user's mark is a 2D screen point, not a 3D anchor. Nothing is uploaded or sent.
import { parseHandoff } from './handoff.mjs';
import { detectCandidates } from './detector.mjs';
import { InspectionCamera } from './inspection-camera.mjs';
import { reduce, initialState, allChecked, progressOf, CHECK_ITEMS } from './self-inspection.mjs';
import { validateResult, STATUS_TEXT } from './inspection-result.mjs';
import {isChecklistTask,parseInspectionHandoff,taskLinks,WASHER_TASK} from './inspection-tasks.mjs';
import {prepareChecklistPage,startChecklistPage} from './checklist-page.mjs';
import {renderSummary as summary,mountLocationGuide} from './inspection-ui.mjs';

export function prepareInspectionPage(handoff){if(handoff.valid&&isChecklistTask(handoff.task))prepareChecklistPage(handoff.task,{locked:handoff.source==='qr-sync'});}
export async function startInspectionPage(options={}){const handoff=options.handoff??parseInspectionHandoff(location.hash);
  if(handoff.valid&&isChecklistTask(handoff.task)){if(!document.body.dataset.checklist)prepareInspectionPage(handoff);return startChecklistPage({...options,handoff});}
  return startWasherInspectionPage({...options,handoff});
}

// Both entries use the same AR-01 flow; only the isolated development entry supplies sync callbacks.
async function startWasherInspectionPage({ handoff = parseHandoff(location.hash), onComplete = () => {}, onRestart = () => {} } = {}) {
const $ = id => document.getElementById(id);
if(handoff.source!=='qr-sync'){const nav=document.createElement('nav');nav.className='task-links';nav.setAttribute('aria-label','다른 부품 점검');for(const t of taskLinks()){const a=document.createElement('a');a.href=t.href;a.textContent=t.label;nav.append(a);}$('step-intro').append(nav);}
const video = $('video');
mountLocationGuide(WASHER_TASK,$('camera'));
const frame = document.createElement('canvas'), frameContext = frame.getContext('2d', { willReadFrequently: true });
let state = initialState();
let lastStatus = '', misses = 0, candidates = [], camera;
const DONE_GUARD_MS = 1000;
let doneGuardUntil = 0;
let guideOpen = false, guide = null; // Experimental 3D guide; the 2D camera may never run while it is open.
const canCamera = () => !guideOpen && handoff.valid && state.mode === 'camera' && ['locate', 'check'].includes(state.step);
function status(message) {
  if (message !== lastStatus) { $('status').textContent = message; lastStatus = message; }
  if (camera) updateChip();
}
camera = new InspectionCamera({
  video, overlay: $('overlay'), stage: $('stage'), start: $('start'), stop: $('stop'),
  clear: $('clear-mark'), placeholder: $('placeholder'), canRun: canCamera, targetLabel: '워셔액 주입구',
  onStatus: status,
  onAids: aids => dispatch({ type: 'NOTE_AIDS', ...aids }),
  onReset: () => { candidates = []; misses = 0; },
  onFrame: () => {
    const scale = Math.min(320 / video.videoWidth, 240 / video.videoHeight, 1);
    frame.width = Math.max(1, Math.round(video.videoWidth * scale));
    frame.height = Math.max(1, Math.round(video.videoHeight * scale));
    frameContext.drawImage(video, 0, 0, frame.width, frame.height);
    candidates = detectCandidates(frameContext.getImageData(0, 0, frame.width, frame.height));
    updateChip();
    if (candidates.length) { misses = 0; return `파란색 후보 ${candidates.length}개 · 주입구 식별 아님. 워셔 표시를 직접 확인하고 화면을 탭해 위치를 지정하세요.`; }
    misses++;
    return misses >= 12 ? '후보를 찾지 못했습니다. 화면을 탭해 직접 지정하거나 수동 안내를 사용하세요.' : '후보 없음 · 조명과 촬영 각도를 바꾸거나 화면을 탭해 직접 지정하세요.';
  },
  drawGuide: (ctx, rect, dpr) => {
    ctx.strokeStyle = '#ffe16a'; ctx.fillStyle = '#ffe16a'; ctx.lineWidth = 3 * dpr;
    ctx.font = `bold ${14 * dpr}px system-ui`; ctx.setLineDash([7 * dpr, 4 * dpr]);
    for (const [index, box] of candidates.entries()) {
      const x = rect.x + box.x * rect.width, y = rect.y + box.y * rect.height;
      ctx.strokeRect(x, y, box.width * rect.width, box.height * rect.height);
      if (camera.mark) continue;
      const labelY = Math.max(20 * dpr, y - 5 * dpr);
      ctx.fillStyle = '#18232f'; ctx.fillRect(x, labelY - 17 * dpr, 130 * dpr, 22 * dpr);
      ctx.fillStyle = '#ffe16a'; ctx.fillText(`후보 ${index + 1} · 미검증`, x + 3 * dpr, labelY);
    }
  }
});
const stop = message => { camera.stop(message); updateChip(); };
const startCamera = () => camera.start();
function updateChip() {
  const chip = $('stage-chip');
  if (!camera.timer) { chip.textContent = ''; return; }
  chip.textContent = state.step === 'check' ? '3/4 셀프 점검 · 아래 항목을 직접 확인하세요'
    : camera.mark ? '2/4 위치 지정됨 · 다시 탭하면 옮겨집니다' : '2/4 위치 찾기 · 주입구를 찾으면 화면을 탭하세요';
}

// ---------- flow ----------
function dispatch(event) {
  const prev = state, next = reduce(state, event);
  if (next === prev) return false;
  state = next;
  // Arm the guard before rendering, so the done step's button is drawn disabled.
  if (prev.step !== 'done' && state.step === 'done') { doneGuardUntil = Date.now() + DONE_GUARD_MS; setTimeout(render, DONE_GUARD_MS + 20); }
  // Camera only on the locate/check steps in camera mode.
  if (prev.step !== state.step) camera.clearMark();
  if (!canCamera()) stop(state.step === 'intro' ? '카메라 중지' : '다음 단계로 이동해 카메라를 중지했습니다.');
  render();
  if (prev.step !== 'done' && state.step === 'done') onComplete(state.record);
  if (prev.step === 'done' && state.step === 'intro') onRestart();
  if (prev.step !== state.step) {
    scrollTo(0, 0); // each step starts at the top (camera stage under the header, actions at the bottom)
    // Move focus to the new step's heading only when the step changes (not on every checkbox toggle).
    if (['check', 'result', 'confirm', 'done'].includes(state.step)) $(`step-${state.step}`).querySelector('h2')?.focus({ preventScroll: true });
  }
  return true;
}

const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' });

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
  guide?.refresh();
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
$('back').addEventListener('click', () => dispatch({ type: 'BACK' }));
$('cancel').addEventListener('click', () => { stop('취소 확인 중 카메라를 중지했습니다.'); $('cancel-confirm').hidden = false; $('cancel-no').focus(); });
$('cancel-no').addEventListener('click', () => { $('cancel-confirm').hidden = true; });
$('cancel-yes').addEventListener('click', () => { stop('점검을 취소했습니다.'); dispatch({ type: 'CANCEL' }); });
$('manual').addEventListener('click', () => { stop('수동 안내 모드 · 카메라를 중지했습니다.'); $('guidance').focus(); });
addEventListener('hashchange', () => location.reload());

$('handoff-status').textContent = !handoff.valid ? '지원하지 않는 QR 요청입니다. 점검을 시작할 수 없습니다. 아래 수동 안내를 사용하세요.' :
  handoff.source === 'qr-task' ? 'QR 작업 수신: 워셔액 점검 · 차량·센서 연결 없음' : '직접 방문 · 차량·센서 연결 없음';
$('start').disabled = !handoff.valid;
render();
// Test hook (read-only view of the flow; the page itself never sends this anywhere).
window.__selfInspection = { get state() { return state; }, get mark() { return camera.mark; } };

// P9-XR-C: only a host that enabled the experiment marks the page, and only that host serves these files.
// The guide sends nothing and never changes the record: each choice below is the same event the page's own buttons use.
if (handoff.valid && document.body.dataset.webxrGuide === 'enabled') {
  const GUIDE_STEPS = { intro: 'manual-start', locate: 'locate-manual', check: 'unsure-check' };
  const focusChecklist = () => { scrollTo(0, 0); $('step-check').querySelector('h2').focus({ preventScroll: true }); };
  import('./webxr/webxr-guide.mjs').then(({ mountWebXrGuide }) => {
    const mounting = mountWebXrGuide({
      task: { position: WASHER_TASK.position, items: CHECK_ITEMS },
      canOffer: () => state.step in GUIDE_STEPS,
      anchorFor: () => $(GUIDE_STEPS[state.step]),
      onOpen: () => { guideOpen = true; stop('3D AR 안내를 위해 2D 카메라를 중지했습니다.'); },
      onClose: () => { guideOpen = false; stop('3D AR 안내를 마쳤습니다. 2D 카메라는 직접 시작하세요.'); },
      onChecklist: () => {
        if (state.step === 'intro') dispatch({ type: 'START', camera: false });
        else if (state.step === 'locate') dispatch({ type: 'TO_CHECK', manual: true });
        else focusChecklist();
      },
      onCamera: () => {
        if (state.step === 'intro') dispatch({ type: 'START', camera: true });
        else if (state.step === 'check') dispatch({ type: 'USE_CAMERA' });
        startCamera();
      },
    });
    return mounting.then(mounted => { guide = mounted; });
  }).catch(() => { /* The experiment failed to load: the 2D and manual methods are untouched. */ });
}

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

return { get state() { return state; } };
}
