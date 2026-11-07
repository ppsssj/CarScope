// P12-E: "AI로 부품 위치 찾기". One photo, one explicit consent, one request. It never reads or changes the inspection: the person looks and answers.
// The photo is redrawn smaller and re-encoded here, which also leaves out its location and camera data. Only the served page's own origin is called.
import { detectionForTask, initialDetection, offersDetection, PHASE, reduceDetection } from './part-detection.mjs';

const MAX_INPUT_BYTES = 15 * 1024 * 1024, MAX_SIDE = 1280, JPEG_QUALITY = 0.85;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const FAILURE = Object.freeze({
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

/** Adds the entry rows for a part with a mapped class. A part without one gets nothing, and its picture guide stands alone. */
export function mountPartDetection({ taskId, detector, introBefore, locationAfter, onOpen = () => {} }) {
  const entry = detectionForTask(taskId);
  if (!offersDetection(entry) || !detector) return null;
  let state = initialDetection(entry.partId), source = null, historyPushed = false;

  const dialog = el('dialog', 'part-detect-dialog'); dialog.id = 'part-detect'; dialog.setAttribute('aria-labelledby', 'part-detect-title');
  const bar = el('div', 'part-guide-zoom-bar'), close = el('button', null, '점검으로 돌아가기'); close.id = 'part-detect-close'; close.type = 'button'; bar.append(close);
  const body = el('div', 'part-detect-body');
  body.append(Object.assign(el('h2', null, 'AI로 부품 위치 찾기 · 실험'), { id: 'part-detect-title' }));

  const consent = el('section'); consent.id = 'part-detect-consent';
  const agree = el('input'); agree.type = 'checkbox'; agree.id = 'part-detect-agree';
  const agreeLabel = el('label', 'safety'); agreeLabel.append(agree, el('span', null, '내용을 확인했고, 이 사진 한 장을 보내는 데 동의해요'));
  const take = el('button', 'primary-row', '사진 찍기'), gallery = el('button', null, '갤러리에서 고르기');
  take.id = 'part-detect-take'; take.type = 'button'; gallery.id = 'part-detect-gallery'; gallery.type = 'button';
  const camera = el('input'), library = el('input');
  for (const input of [camera, library]) { input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true; }
  camera.id = 'part-detect-camera-input'; camera.setAttribute('capture', 'environment'); library.id = 'part-detect-library-input';
  const row = el('div', 'row'); row.append(take, gallery);
  consent.append(
    el('p', 'lead', '엔진룸 사진 한 장에서 부품 후보를 찾아 표시해요. 후보일 뿐이고, 부품을 확정하지 않아요.'),
    el('p', 'card warn', '이 사진은 CarScope 서버를 거쳐 외부 AI 서비스(Roboflow)로 보내져요. CarScope는 사진을 저장하지 않아요. 외부 서비스의 처리·보관 조건은 아직 확인하지 못했어요. 번호판이나 사람이 나오지 않게 해 주세요.'),
    agreeLabel, row, camera, library);

  const busy = el('p', 'part-detect-status', '사진을 분석하고 있어요…'); busy.id = 'part-detect-busy'; busy.setAttribute('role', 'status');
  const result = el('section'); result.id = 'part-detect-result';
  const picture = el('canvas', 'part-detect-picture'); picture.id = 'part-detect-picture';
  const message = el('p', null); message.id = 'part-detect-message'; message.setAttribute('role', 'status');
  const caution = el('p', 'card warn', entry.caution); caution.id = 'part-detect-caution';
  const again = el('button', null, '다른 사진으로 다시 해 보기'); again.id = 'part-detect-again'; again.type = 'button';
  result.append(picture, message, caution, again);
  body.append(consent, busy, result);
  dialog.append(bar, body);
  document.body.append(dialog);

  function render() {
    consent.hidden = state.phase !== PHASE.CONSENT;
    busy.hidden = state.phase !== PHASE.ANALYZING;
    const done = [PHASE.CANDIDATES, PHASE.NONE_FOUND, PHASE.FAILED].includes(state.phase);
    result.hidden = !done;
    agree.checked = state.consented;
    take.disabled = gallery.disabled = !state.consented;
    picture.hidden = state.phase !== PHASE.CANDIDATES;
    caution.hidden = state.phase !== PHASE.CANDIDATES;
    picture.setAttribute('aria-label', `선택한 사진. 후보 ${state.candidates.length}개가 표시되어 있습니다.`);
    if (state.phase === PHASE.CANDIDATES) {
      drawCandidates(picture, source, state.candidates);
      message.textContent = `AI가 찾은 후보 ${state.candidates.length}개예요. 확정된 위치가 아니에요. 어느 것이 맞는지, 맞는 것이 있는지는 직접 확인해 주세요.`;
    } else if (state.phase === PHASE.NONE_FOUND) message.textContent = '이 사진에서는 후보를 찾지 못했어요. 부품이 없다는 뜻은 아니에요. 그림 안내와 차량 설명서로 찾아 주세요.';
    else if (state.phase === PHASE.FAILED) message.textContent = `${FAILURE[state.code] ?? FAILURE.UNAVAILABLE} 그림 안내와 차량 설명서로 찾아 주세요.`;
  }
  const dispatch = event => { state = reduceDetection(state, event); render(); };
  const release = () => { if (source) source.width = source.height = 0; source = null; picture.width = picture.height = 0; };

  async function analyze(file) {
    // Late or scripted file events cannot get around the consent or the single request.
    if (!file || state.phase !== PHASE.CONSENT || !state.consented) return;
    dispatch({ type: 'PHOTO' });
    const attempt = state.attempt;
    try {
      const shrunk = await shrink(file);
      if (attempt !== state.attempt) return;
      source = shrunk.canvas;
      const answer = await detector.detect(entry.partId, shrunk.blob);
      if (attempt !== state.attempt) return;
      if (answer.ok) dispatch({ type: 'ANSWER', attempt, candidates: answer.candidates });
      else dispatch({ type: 'FAIL', attempt, code: answer.code });
    } catch (error) {
      dispatch({ type: 'FAIL', attempt, code: error?.code ?? 'UNAVAILABLE' });
    }
  }
  agree.addEventListener('change', () => dispatch({ type: 'CONSENT', value: agree.checked }));
  take.addEventListener('click', () => { if (state.consented) camera.click(); });
  gallery.addEventListener('click', () => { if (state.consented) library.click(); });
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
  const button = location => { const b = el('button', `part-detect-entry ${location}`, 'AI로 부품 위치 찾기 · 실험'); b.type = 'button'; b.addEventListener('click', open); return b; };
  const first = button('part-detect-entry-intro'), later = button('part-detect-entry-location');
  first.id = 'part-detect-open'; later.id = 'part-detect-open-location';
  introBefore?.before(first);
  locationAfter?.after(later);
  render();
  // Test hook, read only. It exposes no photo and no credentials.
  window.__partDetection = Object.freeze({ get state() { return state; }, get entry() { return entry; } });
  return { get state() { return state; } };
}
