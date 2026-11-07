// P12-B: photo → detector → candidate boxes → the user's own answer. Nothing leaves the page or reaches an inspection result.
import { MAX_CANDIDATES, STATUS, UNCALIBRATED_SCORE_THRESHOLD, USER_ANSWER, answerCandidate, classifyModel, interpretDetections, toBaselinePredictions } from '/contract/detection-contract.mjs';
import { detectCandidates } from '/baseline/detector.mjs';

const MAX_SIDE = 1600, BASELINE_WIDTH = 320, BASELINE_HEIGHT = 240; // The baseline sees frames of the size the mobile page gives it.
const $ = id => document.getElementById(id);
const TEXT = {
  [STATUS.MODEL_REQUIRED]: '학습된 모델이 없어 AI 탐지를 실행하지 않았어요.',
  [STATUS.MODEL_NOT_TARGET]: '이 모델은 워셔액 주입구로 학습되지 않아 후보를 표시하지 않아요.',
  [STATUS.MODEL_LOAD_FAILED]: '모델을 불러오지 못했어요. 탐지 결과가 없는 것과 달라요.',
  [STATUS.IMAGE_UNREADABLE]: '이 사진을 읽지 못했어요. 다른 사진을 골라 주세요.',
  [STATUS.INFERENCE_FAILED]: '탐지 중 오류가 났어요. 후보가 없다는 뜻이 아니에요.',
  [STATUS.NO_DETECTION]: '후보를 찾지 못했어요. 주입구가 없다는 뜻은 아니에요.',
  [STATUS.CANDIDATES]: '후보를 찾았어요. 워셔 기호와 사용설명서로 직접 확인해 주세요.',
};
const ANSWERS = [[USER_ANSWER.CONFIRMED, '맞아요'], [USER_ANSWER.REJECTED, '아니에요'], [USER_ANSWER.UNSURE, '모르겠어요']];
const ANSWER_NOTE = { [USER_ANSWER.CONFIRMED]: '내가 이 위치를 맞다고 표시함 · 점검 결과 아님', [USER_ANSWER.REJECTED]: '내가 이 후보를 아니라고 표시함', [USER_ANSWER.UNSURE]: '확인하기 어렵다고 표시함' };

let model = { usable: false, status: STATUS.MODEL_REQUIRED }, detectorPromise = null, generation = 0, candidates = [], answers = {}, baseline = [];

function setAi(status) {
  const element = $('ai-status');
  element.dataset.status = status;
  element.textContent = TEXT[status];
}

function drawBoxes() {
  const canvas = $('stage'), ctx = canvas.getContext('2d'), line = Math.max(2, canvas.width / 400), size = Math.max(14, canvas.width / 45);
  ctx.font = `bold ${size}px system-ui`;
  const stroke = ([x, y, w, h], color, dash, label) => {
    const left = x * canvas.width, top = y * canvas.height;
    ctx.lineWidth = line; ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.strokeRect(left, top, w * canvas.width, h * canvas.height); ctx.setLineDash([]);
    const textY = Math.max(size + 4, top - 6);
    ctx.fillStyle = '#17212b'; ctx.fillRect(left, textY - size - 2, ctx.measureText(label).width + 8, size + 6);
    ctx.fillStyle = color; ctx.fillText(label, left + 4, textY);
  };
  baseline.forEach((b, index) => stroke(b.box, '#ffd84d', [line * 4, line * 3], `색상 ${index + 1} · AI 아님`));
  candidates.forEach((c, index) => stroke(c.box, '#39e991', [], `후보 ${index + 1} · ${c.score.toFixed(2)}`));
}

function renderCandidates() {
  const list = $('ai-candidates');
  list.replaceChildren(...candidates.map((candidate, index) => {
    const item = document.createElement('li'); item.dataset.id = candidate.id;
    const title = document.createElement('strong'); title.textContent = `후보 ${index + 1} · 모델 점수 ${candidate.score.toFixed(2)}`;
    const detail = document.createElement('p'); detail.className = 'note'; detail.textContent = answers[candidate.id] ? ANSWER_NOTE[answers[candidate.id]] : '보정되지 않은 점수예요. 이 위치가 워셔액 주입구인가요?';
    const row = document.createElement('div'); row.className = 'answers';
    for (const [value, text] of ANSWERS) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.answer = value;
      button.setAttribute('aria-pressed', String(answers[candidate.id] === value));
      button.onclick = () => { answers = answerCandidate(answers, candidate.id, value); renderCandidates(); };
      row.append(button);
    }
    item.append(title, detail, row);
    return item;
  }));
}

function runBaseline(canvas) {
  const scale = Math.min(BASELINE_WIDTH / canvas.width, BASELINE_HEIGHT / canvas.height, 1);
  const frame = document.createElement('canvas'); frame.width = Math.max(1, Math.round(canvas.width * scale)); frame.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = frame.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0, frame.width, frame.height);
  baseline = toBaselinePredictions(detectCandidates(ctx.getImageData(0, 0, frame.width, frame.height)));
  const status = $('baseline-status'); status.dataset.count = String(baseline.length);
  status.textContent = baseline.length ? `파란색 영역 ${baseline.length}개 · 색만 본 표시예요.` : '파란색 영역을 찾지 못했어요.';
}

async function runAi(canvas, current) {
  if (!model.usable) { setAi(model.status); return; }
  let detector;
  try {
    detectorPromise ??= import('/detector-runtime.mjs').then(runtime => runtime.createDetector({ scoreThreshold: UNCALIBRATED_SCORE_THRESHOLD, maxResults: MAX_CANDIDATES }));
    detector = await detectorPromise;
  } catch { detectorPromise = null; if (current === generation) setAi(STATUS.MODEL_LOAD_FAILED); return; }
  if (current !== generation) return;
  let result;
  const started = performance.now();
  try { result = interpretDetections({ detections: await detector.detect(canvas), imageWidth: canvas.width, imageHeight: canvas.height }); }
  catch { result = { status: STATUS.INFERENCE_FAILED, candidates: [] }; }
  if (current !== generation) return;
  $('ai-time').textContent = result.status === STATUS.INFERENCE_FAILED ? '' : `추론 ${Math.round(performance.now() - started)} ms · 이 기기에서 이번 1회`;
  candidates = result.candidates;
  setAi(result.status);
  renderCandidates();
}

async function choose(file) {
  const current = ++generation;
  candidates = []; answers = {}; baseline = []; renderCandidates(); $('ai-time').textContent = '';
  const baselineStatus = $('baseline-status'); baselineStatus.dataset.count = '0'; baselineStatus.textContent = '실행하고 있어요.';
  const canvas = $('stage');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    if (current !== generation) return;
    $('figure').hidden = true; setAi(STATUS.IMAGE_UNREADABLE); baselineStatus.textContent = '사진을 읽지 못해 실행하지 않았어요.';
    document.body.dataset.analyzed = String(current);
    return;
  }
  if (current !== generation) { bitmap.close(); return; }
  const scale = Math.min(MAX_SIDE / Math.max(bitmap.width, bitmap.height), 1);
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  // The detector and the baseline read clean pixels. Boxes go on a copy of the photo afterwards.
  const clean = document.createElement('canvas'); clean.width = canvas.width; clean.height = canvas.height; clean.getContext('2d').drawImage(canvas, 0, 0);
  $('figure').hidden = false;
  runBaseline(clean);
  await runAi(clean, current);
  if (current !== generation) return;
  ctx.drawImage(clean, 0, 0);
  drawBoxes();
  document.body.dataset.analyzed = String(current);
}

async function loadModel() {
  try {
    const response = await fetch('/model.json');
    if (response.status === 404) model = classifyModel(null);
    else if (!response.ok) model = { usable: false, status: STATUS.MODEL_LOAD_FAILED };
    else model = classifyModel(await response.json());
  } catch { model = { usable: false, status: STATUS.MODEL_LOAD_FAILED }; }
  if (generation) return;
  if (!model.usable) { setAi(model.status); return; }
  const element = $('ai-status'); element.dataset.status = 'MODEL_READY'; element.textContent = '모델이 준비됐어요. 사진을 골라 주세요.';
}

$('photo').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) void choose(file); });
await loadModel();
document.body.dataset.ready = 'true';
