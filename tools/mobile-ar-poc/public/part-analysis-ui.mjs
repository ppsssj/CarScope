// P13-A: "부품 상태 AI 분석". Shown under a finished part search: choose a region, see the crop, agree to one send, read what the AI saw.
// It never reads or changes the inspection. The person reads the result, confirms they will check the part themselves, and goes back.
// Only the cropped picture is sent, never the whole photo. Every text from the AI is set with textContent after the contract check.
import { boxAroundPoint, cropWithContext } from './context-crop.mjs';
import { analysisProfile, ANALYSIS_SERVICES, APHASE, ASSESSMENT, initialAnalysis, ISSUE_LABELS, offersAnalysis, PART_MATCH, reduceAnalysis, REGION_SOURCE, validateAnalysisResult } from './part-analysis.mjs';

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (id, text, className) => { const b = el('button', className, text); b.id = id; b.type = 'button'; return b; };
const FAILURE = Object.freeze({
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  BUSY: '이미 분석 중인 요청이 있어요. 잠시 후 다시 시도해 주세요.',
  TOO_LARGE: '이 사진을 보내지 못했어요. 다시 촬영해 주세요.',
  UNREADABLE: '이 사진을 보내지 못했어요. 다시 촬영해 주세요.',
  NOT_CONNECTED: '차량과 연결이 끊겨 AI 분석을 쓸 수 없어요.',
  INVALID_RESPONSE: 'AI 응답을 확인할 수 없어 결과를 표시하지 않았어요.',
  CROP_FAILED: '사진을 자르지 못했어요. 다시 촬영해 주세요.',
  UNAVAILABLE: 'AI 분석 서비스에 연결하지 못했어요.',
});
export const HEADLINE = Object.freeze({
  [ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED]: ['사진에서 보이는 이상 징후를 찾지 못했어요', '부품이나 차량이 정상이라는 뜻은 아니에요. 사진에 보이지 않는 부분은 살피지 않았어요.'],
  [ASSESSMENT.SUSPECTED_ISSUE]: ['사진에서 이상이 의심되는 부분이 있어요', '의심일 뿐이에요. 아래 근거를 보고 부품을 직접 확인해 주세요.'],
  [ASSESSMENT.INDETERMINATE]: ['이 사진으로는 판단할 수 없어요', '아래 이유를 보고 다시 촬영하거나 직접 확인해 주세요.'],
  [ASSESSMENT.WRONG_PART]: ['선택한 부품이 아닌 것 같아요', '다른 후보를 고르거나 영역을 직접 지정해 주세요.'],
  [ASSESSMENT.UNSUPPORTED]: ['이 부품은 AI 상태 분석을 지원하지 않아요', '그림 안내와 차량 설명서로 직접 확인해 주세요.'],
});
const MATCH = Object.freeze({ [PART_MATCH.LIKELY_MATCH]: '선택한 부품으로 보여요.', [PART_MATCH.UNCERTAIN]: '선택한 부품인지 분명하지 않아요.', [PART_MATCH.NOT_MATCH]: '다른 부품으로 보여요.' });
const SHOWN = new Set(['CANDIDATES', 'NONE_FOUND', 'FAILED']);

function outline(ctx, box, width, height, label) {
  const unit = Math.max(2, Math.round(Math.max(width, height) / 320));
  const [x, y, w, h] = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
  ctx.lineWidth = 2 * unit; ctx.strokeStyle = '#7ee0ff'; ctx.setLineDash([6 * unit, 4 * unit]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  if (label) { ctx.font = `bold ${10 * unit}px system-ui,sans-serif`; const top = Math.max(0, y - 13 * unit); ctx.fillStyle = '#18232f'; ctx.fillRect(x, top, ctx.measureText(label).width + 6 * unit, 13 * unit); ctx.fillStyle = '#7ee0ff'; ctx.fillText(label, x + 3 * unit, top + 10 * unit); }
}
function fillList(list, items, render = item => item) {
  list.replaceChildren(...items.map(item => { const li = el('li'); const value = render(item); if (typeof value === 'string') li.textContent = value; else li.append(...value); return li; }));
  list.closest('.part-analysis-group').hidden = items.length === 0;
}
const group = (id, title) => { const box = el('div', 'part-analysis-group'); const list = el('ul'); list.id = id; box.append(el('h5', null, title), list); return [box, list]; };

/**
 * @param o.slot     element inside the part search result
 * @param o.entry    the part's detection row
 * @param o.analyzer { analyze(partId, blob, { targetInCrop, regionSource, signal }) } -> { ok, result, analysis } | { ok:false, code }
 * @param o.serviceId provider id the host marked on the page; it names the outside service in the consent text
 */
export function createPartAnalysis({ slot, entry, analyzer, serviceId, retake, close }) {
  const service = Object.hasOwn(ANALYSIS_SERVICES, serviceId) ? ANALYSIS_SERVICES[serviceId] : null;
  if (!offersAnalysis(entry?.partId) || typeof analyzer?.analyze !== 'function' || !service) return null;
  const profile = analysisProfile(entry.partId);
  let state = initialAnalysis(), ctx = { phase: null, candidates: [], source: null, file: null }, crop = null, controller = null, sentAt = -Infinity;

  const section = el('section', 'part-analysis'); section.id = 'part-analysis'; section.setAttribute('aria-labelledby', 'part-analysis-title');
  const title = el('h3', null, `부품 상태 AI 분석 · 실험 · ${profile.label}`); title.id = 'part-analysis-title';
  const lead = el('p', 'fine', '위치 찾기와 따로 진행해요. 분석할 영역을 고르면 주변까지 잘라서 먼저 보여 드려요.');

  const region = el('div', 'part-analysis-region'); region.id = 'part-analysis-choose';
  const choices = el('div', 'row'); choices.id = 'part-analysis-choices';
  const manual = button('part-analysis-manual', '직접 영역 지정');
  const pickerHelp = el('p', 'fine', '사진에서 부품이 있는 곳을 눌러 주세요. 직접 지정한 영역은 AI가 찾은 위치가 아니에요.'); pickerHelp.id = 'part-analysis-picker-help';
  const picker = el('canvas', 'part-analysis-picker'); picker.id = 'part-analysis-picker'; picker.setAttribute('aria-label', '영역을 직접 지정할 사진');
  region.append(choices, manual, pickerHelp, picker);

  const preview = el('div', 'part-analysis-preview'); preview.id = 'part-analysis-preview';
  const cropView = el('canvas', 'part-analysis-crop'); cropView.id = 'part-analysis-crop'; cropView.setAttribute('aria-label', '분석에 보낼 잘라낸 사진');
  const regionNote = el('p', 'fine'); regionNote.id = 'part-analysis-region-note';
  const cropBusy = el('p', 'part-detect-status', '분석할 영역을 자르고 있어요…'); cropBusy.id = 'part-analysis-cropping';
  const consentCard = el('p', 'card warn', `잘라낸 이 사진 한 장만 CarScope 서버를 거쳐 외부 AI 서비스(${service})로 보내져요. 위치 찾기에 쓴 서비스(Roboflow)와 다른 곳이에요. 처음 고른 사진 전체는 보내지 않아요. CarScope는 사진과 분석 결과를 저장하지 않아요. ${service}의 처리·보관 조건은 CarScope가 확인하지 못했어요. 번호판이나 사람이 나오지 않게 해 주세요.`);
  consentCard.id = 'part-analysis-consent-text';
  const agree = el('input'); agree.type = 'checkbox'; agree.id = 'part-analysis-agree';
  const agreeLabel = el('label', 'safety'); agreeLabel.append(agree, el('span', null, '내용을 확인했고, 잘라낸 사진 한 장을 보내는 데 동의해요'));
  const start = button('part-analysis-start', '상태 분석 시작', 'primary-row');
  const reselect = button('part-analysis-reselect', '후보 다시 선택');
  preview.append(el('h4', null, '분석에 보낼 사진'), cropBusy, cropView, regionNote, consentCard, agreeLabel, start, reselect);

  const busy = el('div'); busy.id = 'part-analysis-busy';
  const busyText = el('p', 'part-detect-status', 'AI가 사진을 살펴보고 있어요…'); busyText.setAttribute('role', 'status');
  const cancel = button('part-analysis-cancel', '분석 취소');
  busy.append(busyText, cancel);

  const result = el('div', 'part-analysis-result'); result.id = 'part-analysis-result';
  const headline = el('h4'); headline.id = 'part-analysis-headline'; headline.setAttribute('role', 'status');
  const note = el('p', 'card warn'); note.id = 'part-analysis-note';
  const match = el('p'); match.id = 'part-analysis-match';
  const [obsBox, observations] = group('part-analysis-observations', 'AI가 사진에서 본 것');
  const [issueBox, issues] = group('part-analysis-issues', '의심되는 부분과 근거');
  const [limitBox, limitations] = group('part-analysis-limitations', '판단하지 못한 이유');
  const [retakeBox, retakes] = group('part-analysis-retake-tips', '다시 찍는 방법');
  const reference = el('p', 'fine', 'AI 관찰 결과는 참고용이에요. 점검 답변으로 자동 입력되거나 차량으로 보내지지 않아요. 답은 부품을 직접 보고 골라 주세요.');
  const ack = el('input'); ack.type = 'checkbox'; ack.id = 'part-analysis-ack';
  const ackLabel = el('label', 'safety'); ackLabel.append(ack, el('span', null, 'AI 결과는 참고용이고, 부품은 직접 확인할게요'));
  const continueButton = button('part-analysis-continue', '기존 점검 계속하기', 'primary-row');
  const retakeButton = button('part-analysis-retake', '다시 촬영하기');
  const other = button('part-analysis-other', '다른 영역으로 다시 분석');
  result.append(headline, note, match, obsBox, issueBox, limitBox, retakeBox, reference, ackLabel, continueButton, retakeButton, other);

  const failed = el('div'); failed.id = 'part-analysis-failed';
  const failText = el('p', 'card warn'); failText.id = 'part-analysis-error'; failText.setAttribute('role', 'status');
  const retry = button('part-analysis-retry', '다시 시도');
  const failRetake = button('part-analysis-fail-retake', '다시 촬영하기');
  failed.append(failText, retry, failRetake);

  section.append(title, lead, region, preview, busy, result, failed);
  slot.append(section);

  const releaseCrop = () => { if (crop) crop.canvas.width = crop.canvas.height = 0; crop = null; cropView.width = cropView.height = 0; };
  const abort = () => { controller?.abort(); controller = null; };
  function drawPicker() {
    const { source } = ctx;
    if (!source) { picker.width = picker.height = 0; return; }
    picker.width = source.width; picker.height = source.height;
    const c = picker.getContext('2d'); c.drawImage(source, 0, 0);
    if (state.region?.source === REGION_SOURCE.MANUAL) outline(c, state.region.box, picker.width, picker.height, '직접 지정');
  }
  function drawCrop() {
    if (!crop) { cropView.width = cropView.height = 0; return; }
    cropView.width = crop.canvas.width; cropView.height = crop.canvas.height;
    const c = cropView.getContext('2d'); c.drawImage(crop.canvas, 0, 0);
    // The outline is drawn on this preview only. The picture sent has no marks.
    outline(c, crop.plan.targetInCrop, cropView.width, cropView.height, state.region.source === REGION_SOURCE.MANUAL ? '직접 지정' : `후보 ${state.region.index + 1}`);
  }
  function render() {
    const visible = state.phase !== APHASE.IDLE;
    section.hidden = !visible;
    if (!visible) return;
    region.hidden = ![APHASE.REGION, APHASE.PREVIEW, APHASE.FAILED].includes(state.phase);
    choices.replaceChildren(...ctx.candidates.map((candidate, index) => {
      const b = button(`part-analysis-candidate-${index + 1}`, `후보 ${index + 1} 분석하기`);
      b.setAttribute('aria-pressed', String(state.region?.source === REGION_SOURCE.AI_CANDIDATE && state.region.index === index));
      b.addEventListener('click', () => select({ type: 'SELECT_CANDIDATE', index, box: candidate.box }));
      return b;
    }));
    choices.hidden = ctx.candidates.length === 0;
    pickerHelp.hidden = picker.hidden = !state.manual;
    if (state.manual) drawPicker();
    // While analysing, the crop stays in view with its controls off; the status and cancel take the start button's place.
    const sending = state.phase === APHASE.ANALYZING;
    preview.hidden = !(state.phase === APHASE.PREVIEW || sending);
    agree.disabled = sending; start.hidden = reselect.hidden = sending;
    cropBusy.hidden = state.cropReady || state.code === 'CROP_FAILED';
    cropView.hidden = !state.cropReady;
    if (state.phase === APHASE.PREVIEW && state.region) regionNote.textContent = state.region.source === REGION_SOURCE.MANUAL
      ? '직접 지정한 영역이에요. AI 위치 찾기 결과가 아니에요.'
      : `AI가 찾은 후보 ${state.region.index + 1}이에요. 맞는 부품인지는 직접 확인해 주세요.`;
    if (state.phase === APHASE.PREVIEW && crop) regionNote.textContent += ` 원본 ${crop.plan.source.width}×${crop.plan.source.height} 중 ${crop.plan.rect.width}×${crop.plan.rect.height} 영역, 보내는 크기 ${crop.plan.output.width}×${crop.plan.output.height}.`;
    agree.checked = state.consented;
    start.disabled = !(state.consented && state.cropReady);
    reselect.textContent = ctx.candidates.length ? '후보 다시 선택' : '영역 다시 지정';
    busy.hidden = state.phase !== APHASE.ANALYZING;
    result.hidden = state.phase !== APHASE.RESULT;
    if (state.phase === APHASE.RESULT) {
      const r = state.result, [head, sub] = HEADLINE[r.assessment];
      headline.textContent = head; note.textContent = sub; match.textContent = MATCH[r.partMatch];
      fillList(observations, r.observations);
      fillList(issues, r.suspectedIssues, issue => [el('strong', null, ISSUE_LABELS[issue.code] ?? issue.code), el('span', null, ` ${issue.description}`), el('span', 'fine', ` 근거: ${issue.evidence}`)]);
      fillList(limitations, r.limitations);
      fillList(retakes, r.retakeInstructions);
      ack.checked = state.acknowledged;
      continueButton.disabled = !state.acknowledged;
    }
    failed.hidden = !(state.phase === APHASE.FAILED || (state.phase === APHASE.PREVIEW && state.code === 'CROP_FAILED'));
    failText.textContent = `${FAILURE[state.code] ?? FAILURE.UNAVAILABLE} 직접 확인하는 기존 점검은 그대로 이어 갈 수 있어요.`;
    retry.hidden = state.phase !== APHASE.FAILED;
  }
  // Each new step comes into view: the picture above is tall, and a preview or a result below it is easy to miss.
  const STEP_VIEW = { [APHASE.PREVIEW]: preview, [APHASE.RESULT]: result, [APHASE.FAILED]: failed };
  const dispatch = event => {
    const before = state.phase, wasManual = state.manual;
    state = reduceAnalysis(state, event); render();
    const back = before === APHASE.ANALYZING && state.phase === APHASE.PREVIEW; // after a cancel the view stays where it is
    const target = state.phase !== before && !back ? STEP_VIEW[state.phase] : state.manual && !wasManual ? picker : null;
    if (target && section.isConnected) target.scrollIntoView({ block: 'start' });
  };

  async function select(event) {
    abort(); releaseCrop();
    dispatch(event);
    if (state.phase !== APHASE.PREVIEW) return;
    const attempt = state.attempt, file = ctx.file;
    try {
      const made = await cropWithContext(file, state.region.box, profile.crop);
      if (attempt !== state.attempt) { made.canvas.width = made.canvas.height = 0; return; }
      crop = made; drawCrop();
      dispatch({ type: 'CROPPED', attempt, ok: true });
    } catch { if (attempt === state.attempt) dispatch({ type: 'CROPPED', attempt, ok: false }); }
  }
  async function analyze() {
    if (!(state.phase === APHASE.PREVIEW && state.consented && state.cropReady && crop?.blob)) return;
    dispatch({ type: 'ANALYZE' });
    sentAt = performance.now();
    const attempt = state.attempt;
    controller = new AbortController();
    const { signal } = controller;
    let answer;
    try { answer = await analyzer.analyze(entry.partId, crop.blob, { targetInCrop: [...crop.plan.targetInCrop], regionSource: state.region.source, signal }); }
    catch { answer = { ok: false, code: 'UNAVAILABLE' }; }
    if (attempt !== state.attempt || signal.aborted) return; // cancelled, a new region, a new photo or a closed screen
    controller = null;
    if (!answer?.ok) { dispatch({ type: 'FAIL', attempt, code: answer?.code ?? 'UNAVAILABLE' }); return; }
    // The same contract the server applied, again here: the page shows nothing it would not accept itself.
    const checked = validateAnalysisResult(entry.partId, answer.result);
    if (checked.ok) dispatch({ type: 'ANSWER', attempt, result: checked.result, meta: answer.analysis ?? null });
    else dispatch({ type: 'FAIL', attempt, code: 'INVALID_RESPONSE' });
  }

  manual.addEventListener('click', () => { abort(); releaseCrop(); dispatch({ type: 'MANUAL' }); });
  picker.addEventListener('click', event => {
    if (!state.manual || !ctx.source) return;
    const rect = picker.getBoundingClientRect();
    const point = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height].map(n => Math.min(1, Math.max(0, n)));
    void select({ type: 'MANUAL_PICK', box: boxAroundPoint({ width: ctx.source.width, height: ctx.source.height }, point) });
  });
  agree.addEventListener('change', () => dispatch({ type: 'CONSENT', value: agree.checked }));
  start.addEventListener('click', () => { void analyze(); });
  // The cancel button appears where the start button was. A double tap on start must not cancel what it just sent.
  cancel.addEventListener('click', () => { if (performance.now() - sentAt < 600) return; abort(); dispatch({ type: 'CANCEL' }); });
  const chooseAgain = () => { abort(); releaseCrop(); dispatch({ type: 'RESET' }); dispatch({ type: 'START', manual: ctx.candidates.length === 0 }); };
  reselect.addEventListener('click', chooseAgain);
  other.addEventListener('click', chooseAgain);
  retry.addEventListener('click', () => dispatch({ type: 'RETRY' }));
  ack.addEventListener('change', () => dispatch({ type: 'ACKNOWLEDGE', value: ack.checked }));
  continueButton.addEventListener('click', () => { if (state.acknowledged) close(); });
  for (const b of [retakeButton, failRetake]) b.addEventListener('click', () => retake());

  // Test hook, read only. No picture, no token.
  window.__partAnalysis = Object.freeze({ get state() { return state; }, get plan() { return crop?.plan ?? null; } });
  render();
  return {
    /** Called on every render of the part search. A new photo, a restart or a closed screen resets this section. */
    show(next) {
      const usable = SHOWN.has(next.phase) && next.source && next.file;
      if (!usable) { if (state.phase !== APHASE.IDLE) this.reset(); return; }
      ctx = { phase: next.phase, candidates: next.candidates ?? [], source: next.source, file: next.file };
      if (state.phase === APHASE.IDLE) dispatch({ type: 'START', manual: ctx.candidates.length === 0 });
      else render();
    },
    reset() { abort(); releaseCrop(); ctx = { phase: null, candidates: [], source: null, file: null }; picker.width = picker.height = 0; dispatch({ type: 'RESET' }); },
  };
}
