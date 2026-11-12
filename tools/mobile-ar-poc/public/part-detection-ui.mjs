// P12-E: "AI로 부품 위치 찾기". One photo, one explicit consent, one request. It never reads or changes the inspection: the person looks and answers.
// The photo is redrawn smaller and re-encoded here, which also leaves out its location and camera data. Only the served page's own origin is called.
import { detectionForTask, initialDetection, offersDetection, PHASE, reduceDetection } from './part-detection.mjs';
import { METHOD_LABELS } from './part-capabilities.mjs';

const MAX_INPUT_BYTES = 15 * 1024 * 1024, MAX_SIDE = 1280, JPEG_QUALITY = 0.85;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const FAILURE = Object.freeze({
  BUDGET_EXHAUSTED: 'AI 위치 찾기의 오늘 또는 이번 달 사용 한도에 도달했어요. 직접 영역을 지정하거나 기존 점검을 이어가 주세요.',
  IN_PROGRESS: '이 QR에서 AI 요청을 처리하고 있어요. 잠시 기다리거나 직접 점검을 이어가 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  TOO_LARGE: '사진이 너무 커요. 다른 사진으로 시도해 주세요.',
  UNREADABLE: '이 사진을 읽지 못했어요. 다른 사진으로 시도해 주세요.',
  NOT_CONNECTED: '차량과 연결이 끊겨 AI 찾기를 쓸 수 없어요.',
  UNAVAILABLE: 'AI 서비스에 연결하지 못했어요.',
});

async function shrink(file) {
  if (file.size > MAX_INPUT_BYTES) throw Object.assign(new Error('input'), { code: 'TOO_LARGE' });
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw Object.assign(new Error('decode'), { code: 'UNREADABLE' }); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw Object.assign(new Error('encode'), { code: 'UNREADABLE' });
  return { canvas, blob };
}
function drawCandidates(target, source, candidates) {
  target.width = source.width; target.height = source.height;
  const ctx = target.getContext('2d'), unit = Math.max(2, Math.round(Math.max(target.width, target.height) / 320));
  ctx.drawImage(source, 0, 0);
  candidates.forEach(({ box }, index) => {
    const [x, y, w, h] = [box[0] * target.width, box[1] * target.height, box[2] * target.width, box[3] * target.height];
    ctx.lineWidth = 2 * unit; ctx.strokeStyle = '#ffe16a'; ctx.setLineDash([6 * unit, 4 * unit]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    const label = `후보 ${index + 1}`; ctx.font = `bold ${10 * unit}px system-ui,sans-serif`;
    const top = Math.max(0, y - 13 * unit);
    ctx.fillStyle = '#18232f'; ctx.fillRect(x, top, ctx.measureText(label).width + 6 * unit, 13 * unit);
    ctx.fillStyle = '#ffe16a'; ctx.fillText(label, x + 3 * unit, top + 10 * unit);
  });
}

/**
 * Adds the entry rows for a part with a mapped class. A part without one gets nothing, and its picture guide stands alone.
 * `analysis` (P13-A, optional) builds a section shown under a finished search. It receives the chosen photo in memory and never changes this flow.
 * `analysisOffered` (P13-D): the analysis module's word that this part may be analysed. A part with no detector then opens in manual mode:
 * the photo stays on the phone, no Roboflow consent is asked and no detection request is made, and the person marks the region.
 */
export function mountPartDetection({ taskId, detector, introBefore, locationAfter, onOpen = () => {}, analysis = null, analysisOffered = false, detectionEnabled = true }) {
  const entry = detectionForTask(taskId);
  if (!entry || !detector) return null;
  const manualOnly = !detectionEnabled || !offersDetection(entry);
  let localChoice = manualOnly;
  if (manualOnly && !(analysis && analysisOffered)) return null;
  let state = initialDetection(entry.partId), source = null, original = null, historyPushed = false, controller = null;
  // P11: the entry reads as the method the part card names. A part with no detector starts by marking the part, never by "finding" it.
  const withAnalysis = Boolean(analysis && analysisOffered), entryLabel = manualOnly ? METHOD_LABELS.mark : withAnalysis ? METHOD_LABELS.analyze : METHOD_LABELS.detectOnly;
  const manualTitle = METHOD_LABELS.analyze;

  const dialog = el('dialog', 'part-detect-dialog'); dialog.id = 'part-detect'; dialog.setAttribute('aria-labelledby', 'part-detect-title');
  const bar = el('div', 'part-guide-zoom-bar'), close = el('button', null, '점검으로 돌아가기'); close.id = 'part-detect-close'; close.type = 'button'; bar.append(close);
  const body = el('div', 'part-detect-body');
  body.append(Object.assign(el('h2', null, manualOnly ? manualTitle : 'AI로 부품 위치 찾기 · 실험'), { id: 'part-detect-title' }));

  const consent = el('section'); consent.id = 'part-detect-consent';
  const agree = el('input'); agree.type = 'checkbox'; agree.id = 'part-detect-agree';
  const agreeLabel = el('label', 'safety'); agreeLabel.append(agree, el('span', null, '내용을 확인했고, 이 사진 한 장을 보내는 데 동의해요'));
  const take = el('button', 'primary-row', '사진 찍기'), gallery = el('button', null, '갤러리에서 고르기');
  take.id = 'part-detect-take'; take.type = 'button'; gallery.id = 'part-detect-gallery'; gallery.type = 'button';
  const camera = el('input'), library = el('input');
  for (const input of [camera, library]) { input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true; }
  camera.id = 'part-detect-camera-input'; camera.setAttribute('capture', 'environment'); library.id = 'part-detect-library-input';
  const row = el('div', 'row'); row.append(take, gallery);
  if (manualOnly) consent.append(
    el('p', 'lead', 'AI 위치 찾기 없이 분석해요. 사진을 고른 뒤 부품이 있는 곳을 직접 눌러 주세요.'),
    el('p', 'card', '사진을 고르는 것만으로는 어디에도 보내지 않아요. 상태 분석을 시작할 때 따로 동의를 받고, 직접 지정한 부분만 잘라서 보내요.'),
    row, camera, library);
  const detectionInfo = el('div');
  const direct = el('button', null, '탐지 없이 직접 영역 지정'); direct.type = 'button'; direct.id = 'part-detect-manual';
  const localNote = el('p', 'card', '사진을 고르는 것만으로는 어디에도 보내지 않아요. 직접 지정한 영역의 Crop을 확인하고 분석 동의 후에만 보내요.');
  if (!manualOnly) { detectionInfo.append(
    el('p', 'lead', '엔진룸 사진 한 장에서 부품 후보를 찾아 표시해요. 후보일 뿐이고, 부품을 확정하지 않아요.'),
    el('p', 'card warn', '이 사진은 CarScope 서버를 거쳐 외부 AI 서비스(Roboflow)로 보내져요. CarScope는 사진을 저장하지 않아요. 외부 서비스에는 계정별 처리·보관 및 데이터 이용 조건이 적용돼요. 번호판이나 사람이 나오지 않게 해 주세요.'),
    el('p', 'fine', '위치 찾기 모델: Stephens Workspace · engine-bay-parts/1 · 공개 데이터셋 MIT. 후보는 사용자가 직접 확인해 주세요.'),
    agreeLabel); consent.append(detectionInfo, direct, localNote, row, camera, library); }

  const busy = el('p', 'part-detect-status', manualOnly ? '사진을 준비하고 있어요…' : '사진을 분석하고 있어요…'); busy.id = 'part-detect-busy'; busy.setAttribute('role', 'status');
  const result = el('section'); result.id = 'part-detect-result';
  const picture = el('canvas', 'part-detect-picture'); picture.id = 'part-detect-picture';
  const message = el('p', null); message.id = 'part-detect-message'; message.setAttribute('role', 'status');
  const caution = el('p', 'card warn', entry.caution); caution.id = 'part-detect-caution';
  const again = el('button', null, '다른 사진으로 다시 해 보기'); again.id = 'part-detect-again'; again.type = 'button';
  const slot = el('div'); slot.id = 'part-analysis-slot';
  result.append(picture, message, caution, slot, again);
  body.append(consent, busy, result);
  dialog.append(bar, body);
  document.body.append(dialog);
  let extension = null;

  function render() {
    body.querySelector('#part-detect-title').textContent = localChoice ? manualTitle : 'AI로 부품 위치 찾기 · 실험';
    busy.textContent = localChoice ? '사진을 준비하고 있어요…' : '사진을 분석하고 있어요…';
    consent.hidden = state.phase !== PHASE.CONSENT;
    busy.hidden = state.phase !== PHASE.ANALYZING;
    const done = [PHASE.CANDIDATES, PHASE.NONE_FOUND, PHASE.FAILED, PHASE.LOCAL_ONLY].includes(state.phase);
    result.hidden = !done;
    agree.checked = state.consented;
    take.disabled = gallery.disabled = !localChoice && !state.consented;
    detectionInfo.hidden = localChoice; direct.hidden = localChoice || !analysisOffered; localNote.hidden = !localChoice;
    picture.hidden = state.phase !== PHASE.CANDIDATES;
    caution.hidden = state.phase !== PHASE.CANDIDATES;
    picture.setAttribute('aria-label', `선택한 사진. 후보 ${state.candidates.length}개가 표시되어 있습니다.`);
    if (state.phase === PHASE.CANDIDATES) {
      drawCandidates(picture, source, state.candidates);
      message.textContent = `AI가 찾은 후보 ${state.candidates.length}개예요. 확정된 위치가 아니에요. 어느 것이 맞는지, 맞는 것이 있는지는 직접 확인해 주세요.`;
    } else if (state.phase === PHASE.NONE_FOUND) message.textContent = '이 사진에서는 후보를 찾지 못했어요. 부품이 없다는 뜻은 아니에요. 그림 안내와 차량 설명서로 찾아 주세요.';
    else if (state.phase === PHASE.FAILED) message.textContent = `${FAILURE[state.code] ?? FAILURE.UNAVAILABLE} 그림 안내와 차량 설명서로 찾아 주세요.`;
    else if (state.phase === PHASE.LOCAL_ONLY) message.textContent = '아래 사진에서 부품이 있는 곳을 직접 눌러 주세요. 직접 지정한 영역만 분석해요.';
    extension?.show({ phase: state.phase, candidates: state.candidates, source, file: original });
  }
  const dispatch = event => { state = reduceDetection(state, event); render(); };
  // The photo lives only in memory: the file reference and the small canvas. Both go when the search ends, restarts or closes.
  const release = () => { controller?.abort(); controller = null; extension?.reset(); if (source) source.width = source.height = 0; source = null; original = null; picture.width = picture.height = 0; };

  async function analyze(file) {
    if (localChoice) return prepareLocal(file);
    // Late or scripted file events cannot get around the consent or the single request.
    if (!file || state.phase !== PHASE.CONSENT || !state.consented) return;
    dispatch({ type: 'PHOTO' });
    const attempt = state.attempt;
    try {
      const shrunk = await shrink(file);
      if (attempt !== state.attempt) return;
      source = shrunk.canvas; original = file;
      controller = new AbortController();
      const answer = await detector.detect(entry.partId, shrunk.blob, { signal: controller.signal });
      if (attempt !== state.attempt) return;
      if (answer.ok) dispatch({ type: 'ANSWER', attempt, candidates: answer.candidates, detection: answer.detection });
      else dispatch({ type: 'FAIL', attempt, code: answer.code });
    } catch (error) {
      dispatch({ type: 'FAIL', attempt, code: error?.code ?? 'UNAVAILABLE' });
    }
  }
  /** Manual mode: decode and shrink on the phone for the picker. No request of any kind. */
  async function prepareLocal(file) {
    if (!file || state.phase !== PHASE.CONSENT) return;
    dispatch({ type: 'LOCAL_PHOTO' });
    const attempt = state.attempt;
    try {
      const shrunk = await shrink(file);
      if (attempt !== state.attempt) return;
      source = shrunk.canvas; original = file;
      dispatch({ type: 'LOCAL_READY', attempt });
    } catch (error) { dispatch({ type: 'FAIL', attempt, code: error?.code ?? 'UNREADABLE' }); }
  }
  agree.addEventListener('change', () => dispatch({ type: 'CONSENT', value: agree.checked }));
  direct.addEventListener('click', () => { localChoice = true; render(); take.focus(); });
  take.addEventListener('click', () => { if (localChoice || state.consented) camera.click(); });
  gallery.addEventListener('click', () => { if (localChoice || state.consented) library.click(); });
  for (const input of [camera, library]) input.addEventListener('change', () => { const [file] = input.files; input.value = ''; void analyze(file); });
  again.addEventListener('click', () => { release(); dispatch({ type: 'AGAIN' }); });
  close.addEventListener('click', () => dialog.close());
  // Back closes this rather than leaving the page, which would discard a QR connection for good. Same URL by construction.
  dialog.addEventListener('close', () => { release(); dispatch({ type: 'CLOSE' }); if (historyPushed) { historyPushed = false; history.back(); } });
  addEventListener('popstate', () => { if (dialog.open) { historyPushed = false; dialog.close(); } });
  function open() {
    if (dialog.open) return;
    onOpen();
    dispatch({ type: 'OPEN' });
    dialog.showModal();
    history.scrollRestoration = 'manual';
    history.pushState({ carscopePartDetection: true }, '');
    historyPushed = true;
    body.scrollTop = 0;
  }
  const button = location => { const b = el('button', `part-detect-entry ${location}`, entryLabel); b.type = 'button'; b.addEventListener('click', open); return b; };
  const first = button('part-detect-entry-intro'), later = button('part-detect-entry-location');
  first.id = 'part-detect-open'; later.id = 'part-detect-open-location';
  introBefore?.before(first);
  locationAfter?.after(later);
  const retake = () => { release(); dispatch({ type: 'AGAIN' }); };
  if (analysis) { try { extension = analysis({ slot, entry, retake, close: () => dialog.close() }); } catch { extension = null; } }
  render();
  // Test hook, read only. It exposes no photo and no credentials.
  window.__partDetection = Object.freeze({ get state() { return state; }, get entry() { return entry; }, manualOnly });
  return { get state() { return state; } };
}
