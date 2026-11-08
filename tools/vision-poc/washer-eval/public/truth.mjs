// P13-B truth page. Starts empty for every photo: no region, no answer. A person chooses, looks at both crops, answers, and saves.
import { cropWithContext } from '/mobile-ar-poc/public/context-crop.mjs';
import { emptyTruth, expectedOf, IDENTIFICATION, JUDGEABLE, PERSONAL_DATA, REGION_SOURCE, YES_NO } from '/washer-eval/washer-eval-model.mjs';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
const WORDS = {
  WASHER_CAP: '예, 워셔액 캡', NOT_WASHER_CAP: '아니요, 다른 것', UNKNOWN: 'UNKNOWN', YES: '예', NO: '아니요',
  JUDGEABLE: '판단 가능', NOT_JUDGEABLE: '판단 불가', NONE_VISIBLE: '안 보임', VISIBLE: '보임',
};
const CHOICES = { identification: IDENTIFICATION, capMissing: YES_NO, capOpen: YES_NO, capDamage: YES_NO, judgeable: JUDGEABLE, personalData: PERSONAL_DATA };
const STATE_WORDS = { UNREVIEWED: '검수 전', IN_PROGRESS: '임시 저장', HUMAN_REVIEWED: '검수 완료', INVALIDATED: '사진 변경됨' };

// regionChosen: a fresh photo shows no region as chosen, not even "none", until the person picks one.
let data = null, current = null, bitmap = null, truth = null, cropRects = null, dirty = false, drawing = null, cropTurn = 0, regionChosen = false;

function renderList() {
  const list = $('list');
  list.replaceChildren(...data.images.map(image => {
    const li = el('li'), b = el('button'); b.type = 'button'; b.dataset.id = image.id;
    b.append(el('span', image.id), el('small', `${STATE_WORDS[image.state]} · 탐지 ${image.detections.length}`));
    b.setAttribute('aria-current', String(current?.id === image.id));
    b.addEventListener('click', () => { if (dirty && !confirm('저장하지 않은 변경이 있어요. 이동할까요?')) return; open(image.id); });
    li.append(b); return li;
  }));
  const p = data.progress;
  $('progress').textContent = `검수 완료 ${p.HUMAN_REVIEWED} / ${data.images.length} · 임시 ${p.IN_PROGRESS} · 사진 변경 ${p.INVALIDATED}`;
}

function drawPhoto() {
  const c = $('photo'); c.width = bitmap.width; c.height = bitmap.height;
  const g = c.getContext('2d'), unit = Math.max(2, Math.round(Math.max(c.width, c.height) / 400));
  g.drawImage(bitmap, 0, 0);
  const box = ([x, y, w, h], color, dash, label) => {
    g.lineWidth = 2 * unit; g.strokeStyle = color; g.setLineDash(dash ? [6 * unit, 4 * unit] : []);
    g.strokeRect(x * c.width, y * c.height, w * c.width, h * c.height); g.setLineDash([]);
    if (label) { g.font = `bold ${10 * unit}px system-ui`; g.fillStyle = '#000a'; g.fillRect(x * c.width, Math.max(0, y * c.height - 13 * unit), g.measureText(label).width + 6 * unit, 13 * unit); g.fillStyle = color; g.fillText(label, x * c.width + 3 * unit, Math.max(10 * unit, y * c.height - 3 * unit)); }
  };
  current.detections.forEach((d, i) => box(d.box, '#ffe16a', true, `AI ${i + 1}`));
  (current.humanBoxes?.boxes ?? []).forEach(b => box(b, '#5dff8a', false, 'P12-G'));
  if (truth.region.box) box(truth.region.box, '#7ee0ff', false, '선택');
  if (drawing?.box) box(drawing.box, '#7ee0ff', true, null);
}

function renderRegions() {
  const wrap = $('region-buttons');
  const pressed = (source, index = null) => regionChosen && truth.region.source === source && (index === null || truth.region.detectionIndex === index);
  const make = (text, active, onClick) => { const b = el('button', text); b.type = 'button'; b.setAttribute('aria-pressed', String(active)); b.addEventListener('click', onClick); return b; };
  const buttons = current.detections.map((d, i) => make(`AI 탐지 ${i + 1} 사용`, pressed(REGION_SOURCE.DETECTION, i), () => setRegion({ source: REGION_SOURCE.DETECTION, box: d.box, detectionIndex: i })));
  (current.humanBoxes?.boxes ?? []).forEach((b, i) => buttons.push(make(`P12-G 사람 박스 ${i + 1} 사용`, pressed(REGION_SOURCE.HUMAN) && JSON.stringify(truth.region.box) === JSON.stringify(b), () => setRegion({ source: REGION_SOURCE.HUMAN, box: b, detectionIndex: null }))));
  buttons.push(make('영역 없음 (캡이 안 보임)', pressed(REGION_SOURCE.NONE), () => setRegion({ source: REGION_SOURCE.NONE, box: null, detectionIndex: null })));
  wrap.replaceChildren(...buttons);
}

async function renderCrops() {
  const turn = ++cropTurn;
  cropRects = null;
  for (const margin of data.margins) {
    const key = data.marginKeys[margin], canvas = $(`crop-${key}`), caption = $(`cap-${key}`);
    if (!truth.region.box) { canvas.width = canvas.height = 0; caption.textContent = '영역을 고르면 보여요.'; continue; }
    const { plan, canvas: made } = await cropWithContext(bitmap, truth.region.box, { ...data.cropBase, margin, encode: false });
    if (turn !== cropTurn) return;
    canvas.width = made.width; canvas.height = made.height;
    const g = canvas.getContext('2d'); g.drawImage(made, 0, 0);
    const [x, y, w, h] = plan.targetInCrop; g.lineWidth = 2; g.strokeStyle = '#7ee0ff'; g.strokeRect(x * made.width, y * made.height, w * made.width, h * made.height);
    caption.textContent = `여백 ${margin * 100}% · 원본 ${plan.rect.width}×${plan.rect.height} 영역 → 보내는 크기 ${plan.output.width}×${plan.output.height}`;
    cropRects = { ...(cropRects ?? {}), [key]: plan.rect };
  }
}

function renderAnswers() {
  for (const q of document.querySelectorAll('.q')) {
    const key = q.dataset.key;
    q.querySelectorAll('label').forEach(n => n.remove());
    for (const value of Object.values(CHOICES[key])) {
      const label = el('label'), input = el('input'); input.type = 'radio'; input.name = key; input.value = value; input.checked = truth[key] === value;
      input.addEventListener('change', () => { truth[key] = value; dirty = true; renderExpected(); });
      label.append(input, ` ${WORDS[value]}`); q.append(label);
    }
  }
  $('note').value = truth.note;
}

function renderExpected() {
  if (!regionChosen) { $('expected').textContent = '이 답의 기대 결과: 영역을 먼저 골라 주세요.'; return; }
  if (truth.region.source !== REGION_SOURCE.NONE && Object.keys(CHOICES).some(key => truth[key] === null)) { $('expected').textContent = '이 답의 기대 결과: 모든 질문에 답하면 보여요.'; return; }
  const e = expectedOf(truth);
  const words = { NO_REGION: '영역이 없어 보내지 않아요.', IDENTIFICATION_UNKNOWN: '부품 식별을 모르니 일치 여부는 채점하지 않아요.', NOT_THE_CAP: '분석은 WRONG_PART(다른 부품)를 내야 해요.', NOT_JUDGEABLE: '분석은 INDETERMINATE(판단 불가)를 내야 해요.', DECIDED: `분석은 ${e.state}를 내야 해요.`, STATE_UNKNOWN: '상태 답에 UNKNOWN이 있어 상태는 채점하지 않아요. 아니요라고 답한 항목의 의심은 근거 없는 의심으로 세요.' };
  $('expected').textContent = `이 답의 기대 결과: ${words[e.reason]}`;
}

async function setRegion(region) {
  truth.region = region; dirty = true; regionChosen = true;
  renderRegions(); drawPhoto(); renderExpected();
  await renderCrops();
}

async function open(id) {
  current = data.images.find(image => image.id === id);
  const blob = await (await fetch(`/images/${encodeURIComponent(id)}`)).blob();
  bitmap?.close?.();
  bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  truth = current.record ? structuredClone(current.record.truth) : emptyTruth();
  dirty = false; drawing = null; regionChosen = Boolean(current.record);
  $('work').hidden = false;
  $('title').textContent = `${current.id} · ${current.vehicle ?? ''} · ${STATE_WORDS[current.state]}`;
  $('credit').replaceChildren(`${current.attribution} · ${current.license} · `, Object.assign(el('a', '출처'), { href: current.source, target: '_blank', rel: 'noopener noreferrer' }));
  $('message').textContent = '';
  renderList(); renderRegions(); drawPhoto(); renderAnswers(); renderExpected();
  await renderCrops();
  window.__washerTruth = Object.freeze({ id, get truth() { return structuredClone(truth); }, get cropRects() { return cropRects; } });
}

async function save(complete) {
  const reviewer = $('reviewer').value.trim();
  const message = $('message');
  if (!reviewer) { message.textContent = '검수자를 입력해 주세요.'; message.className = 'error'; return; }
  if (complete && !regionChosen) { message.textContent = '영역을 고르거나 "영역 없음"을 직접 눌러 주세요.'; message.className = 'error'; return; }
  truth.note = $('note').value;
  const response = await fetch(`/api/truth/${encodeURIComponent(current.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CarScope-Review': 'washer-v1' },
    body: JSON.stringify({ reviewer, complete, expectedRevision: current.record?.revision ?? 0, truth, cropRects: truth.region.box ? cropRects : null }),
  });
  const body = await response.json();
  if (!response.ok) { message.textContent = `저장하지 않았어요: ${body.problems?.join(', ') ?? body.error}`; message.className = 'error'; return; }
  Object.assign(current, { record: body.record, state: body.state, expected: body.expected });
  data.progress = body.progress; dirty = false;
  message.textContent = complete ? '검수 완료로 저장했어요.' : '임시 저장했어요.'; message.className = '';
  $('title').textContent = `${current.id} · ${current.vehicle ?? ''} · ${STATE_WORDS[current.state]}`;
  renderList();
}

const point = event => { const r = $('photo').getBoundingClientRect(); return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))]; };
$('photo').addEventListener('pointerdown', event => { if (!bitmap) return; drawing = { from: point(event), box: null }; $('photo').setPointerCapture(event.pointerId); });
$('photo').addEventListener('pointermove', event => { if (!drawing) return; const [ax, ay] = drawing.from, [bx, by] = point(event); drawing.box = [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)]; drawPhoto(); });
$('photo').addEventListener('pointerup', () => {
  const box = drawing?.box; drawing = null;
  if (box && box[2] > 0.005 && box[3] > 0.005) void setRegion({ source: REGION_SOURCE.HUMAN, box: box.map(n => Math.round(n * 1e6) / 1e6), detectionIndex: null });
  else drawPhoto();
});
$('note').addEventListener('input', () => { dirty = true; });
$('save-draft').addEventListener('click', () => { void save(false); });
$('save-complete').addEventListener('click', () => { void save(true); });
addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });

data = await (await fetch('/api/state')).json();
$('synthetic').hidden = !data.synthetic;
renderList();
