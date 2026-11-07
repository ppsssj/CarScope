// P12-G: the review page. It shows, a person decides. Nothing here sets a status, a reviewer or a finished review on its own.
import { BOX_KIND, boxFromCorners, emptyPart, fitView, moveBox, partProblems, PART_KEYS, resizeBox, roundBox, STATUS, toNormalized, zoomAt, iou } from '/review-model.mjs';
import { importAssisted } from '/assisted-model.mjs';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const STATUS_TEXT = Object.freeze({ UNREVIEWED: '검수 전', PRESENT: '있음 (위치 확인)', ABSENT: '없음 (없다고 확인)', UNKNOWN: '판단 불가', NEEDS_REFERENCE: '외부 근거 필요' });
const SHORT_STATUS = Object.freeze({ UNREVIEWED: '검수 전', PRESENT: '있음', ABSENT: '없음', UNKNOWN: '판단 불가', NEEDS_REFERENCE: '근거 필요' });
const STATE_TEXT = Object.freeze({ UNREVIEWED: '검수 전', IN_PROGRESS: '진행 중', HUMAN_REVIEWED: '검수 완료', INVALIDATED: '무효: 사진 해시가 달라요' });
const KIND_TEXT = Object.freeze({ boxes: '부품 전체', caps: '캡', ignore: '제외 영역', hv: '고전압 영역' });
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const app = { data: null, index: 0, partKey: 'washer', tool: 'select', working: null, dirty: false, selected: null, view: null, fitted: 1, filterState: 'ALL', filterCase: 'ALL', drag: null };
const image = () => app.data.images[app.index];
const metaOf = key => app.data.parts.find(part => part.key === key);
const size = () => { const { width, height } = image(); return { width, height }; };
const threshold = () => Number($('ai-threshold').value);
const candidate = () => image().assisted?.parts[app.partKey];
const weakEvidence = item => !item.assisted || item.assisted.parts[app.partKey].status !== 'EVIDENCE_SUPPORTED' || item.assisted.parts[app.partKey].additionalReferenceNeeded;
const CATEGORY_TEXT = { DETECTION_SUCCESS_CANDIDATE: '탐지 성공 후보', MISSED_CANDIDATE: '미탐 후보', FALSE_POSITIVE_CANDIDATE: '오탐 후보', PART_CONFUSION_CANDIDATE: '부품 혼동 후보', UNDETERMINED: '판단 불가' };

async function api(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

// ---- Working copy: a fresh record for this photo, or what was saved. A record for other bytes is shown as invalid and not continued from.
function loadWorking() {
  const current = image(), record = current.state === 'INVALIDATED' ? null : current.record;
  app.working = { revision: current.record?.revision ?? 0, parts: {} };
  for (const key of PART_KEYS) {
    const saved = record?.parts[key];
    app.working.parts[key] = saved ? { partId: saved.partId, status: saved.status, boxes: saved.boxes.map(b => [...b]), caps: saved.caps.map(b => [...b]), ignore: saved.ignore.map(b => [...b]), hv: saved.hv.map(b => [...b]), note: saved.note, reference: saved.reference } : emptyPart(key);
  }
  app.selected = null;
  setDirty(false);
}
function setDirty(value) { app.dirty = value; $('dirty').hidden = !value; document.body.dataset.dirty = String(value); }
const edited = () => { setDirty(true); $('save-problem').hidden = true; };
addEventListener('beforeunload', event => { if (app.dirty) { event.preventDefault(); event.returnValue = ''; } });
const mayLeave = () => !app.dirty || confirm('저장하지 않은 수정이 사라져요. 그래도 이동할까요?');

// ---- View
function frameSize() { const r = $('frame').getBoundingClientRect(); return { width: r.width, height: r.height }; }
function fit() { const view = fitView(size(), frameSize()); app.fitted = view.scale; app.view = view; applyView(); }
function applyView() {
  const { width, height } = size(), stage = $('stage');
  stage.style.width = `${width * app.view.scale}px`; stage.style.height = `${height * app.view.scale}px`;
  stage.style.transform = `translate(${app.view.x}px, ${app.view.y}px)`;
  $('zoom-level').textContent = `${Math.round((app.view.scale / app.fitted) * 100)}%`;
}
const pointerAt = event => { const r = $('frame').getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
const pointerNorm = event => toNormalized(pointerAt(event), size(), app.view);
function zoomBy(factor, at = [frameSize().width / 2, frameSize().height / 2]) { app.view = zoomAt(app.view, factor, at, app.fitted); applyView(); }

// ---- Overlay: boxes are percentages of the stage, so a zoom cannot move them off the picture.
function place(node, box) { node.style.left = `${box[0] * 100}%`; node.style.top = `${box[1] * 100}%`; node.style.width = `${box[2] * 100}%`; node.style.height = `${box[3] * 100}%`; }
function tag(node, text) { const t = el('span', 'tag', text); node.append(t); }
function drawOverlay() {
  const overlay = $('overlay'); overlay.replaceChildren();
  const partKeys = $('show-all-parts').checked ? PART_KEYS : [app.partKey];
  if ($('show-assisted').checked) for (const key of partKeys) {
    const part = image().assisted?.parts[key];
    if (!part) continue;
    for (const kind of ['boxes', 'caps']) for (const box of part[kind]) {
      const node = el('div', 'box assisted'); node.dataset.layer = 'assisted'; node.dataset.part = key;
      place(node, box); tag(node, `Codex 후보 ${metaOf(key).name} ${KIND_TEXT[kind]}`); overlay.append(node);
    }
  }
  if ($('show-draft').checked) for (const key of partKeys) {
    const draft = image().draft[key];
    for (const kind of Object.values(BOX_KIND)) for (const box of draft[kind] ?? []) { const node = el('div', `box draft ${kind}`); node.dataset.layer = 'draft'; node.dataset.part = key; place(node, box); tag(node, `초안 ${metaOf(key).name} ${KIND_TEXT[kind]}`); overlay.append(node); }
  }
  if ($('show-ai').checked) for (const prediction of image().predictions) {
    const owner = app.data.parts.find(part => part.modelClass === prediction.className);
    if (prediction.score < threshold()) continue;
    if (owner ? !partKeys.includes(owner.key) : !$('show-other').checked) continue;
    const node = el('div', `box ai ${owner ? `part-${owner.key}` : 'other'}`); node.dataset.layer = 'ai'; node.dataset.part = owner?.key ?? 'other'; node.dataset.score = prediction.score; place(node, prediction.box); tag(node, `AI ${prediction.className} ${prediction.score.toFixed(2)}`); overlay.append(node);
  }
  if ($('show-labels').checked) for (const key of partKeys) {
    const part = app.working.parts[key];
    for (const kind of Object.values(BOX_KIND)) part[kind].forEach((box, index) => {
      const selected = app.selected?.key === key && app.selected.kind === kind && app.selected.index === index;
      const node = el('div', `box label ${kind} part-${key}${selected ? ' selected' : ''}`);
      Object.assign(node.dataset, { layer: 'label', part: key, kind, index });
      place(node, box); tag(node, `${metaOf(key).name} ${KIND_TEXT[kind]}`);
      if (selected) for (const handle of HANDLES) { const h = el('span', `handle ${handle}`); h.dataset.handle = handle; node.append(h); }
      overlay.append(node);
    });
  }
  if (app.drag?.type === 'draw' && app.drag.box) { const node = el('div', `box label ${app.tool} part-${app.partKey} drawing`); place(node, app.drag.box); overlay.append(node); }
}

// ---- Pointer
function onPointerDown(event) {
  if (event.button !== 0) return;
  $('frame').focus({ preventScroll: true });
  const at = pointerNorm(event), target = event.target;
  $('frame').setPointerCapture(event.pointerId);
  if (app.tool !== 'select') { app.drag = { type: 'draw', from: at, box: null }; return; }
  const handle = target.dataset?.handle, boxNode = target.closest?.('.box.label');
  if (boxNode && boxNode.dataset.part === app.partKey) {
    const ref = { key: boxNode.dataset.part, kind: boxNode.dataset.kind, index: Number(boxNode.dataset.index) };
    app.selected = ref;
    app.drag = { type: handle ? 'resize' : 'move', handle, ref, from: at, start: [...app.working.parts[ref.key][ref.kind][ref.index]] };
    render(); return;
  }
  if (app.selected) { app.selected = null; render(); }
  app.drag = { type: 'pan', from: pointerAt(event), start: { ...app.view } };
}
function onPointerMove(event) {
  const drag = app.drag; if (!drag) return;
  if (drag.type === 'pan') { const [x, y] = pointerAt(event); app.view = { ...drag.start, x: drag.start.x + x - drag.from[0], y: drag.start.y + y - drag.from[1] }; applyView(); return; }
  const at = pointerNorm(event);
  if (drag.type === 'draw') { drag.box = boxFromCorners(drag.from, at); drawOverlay(); return; }
  const dx = at[0] - drag.from[0], dy = at[1] - drag.from[1], list = app.working.parts[drag.ref.key][drag.ref.kind];
  list[drag.ref.index] = roundBox(drag.type === 'move' ? moveBox(drag.start, dx, dy) : resizeBox(drag.start, drag.handle, dx, dy));
  drag.changed = true;
  drawOverlay();
}
function onPointerUp() {
  const drag = app.drag; app.drag = null; if (!drag) return;
  if (drag.type === 'draw') {
    if (drag.box && drag.box[2] > 0.004 && drag.box[3] > 0.004) {
      const part = app.working.parts[app.partKey], kind = app.tool;
      part[kind].push(roundBox(drag.box));
      app.selected = { key: app.partKey, kind, index: part[kind].length - 1 };
      edited();
    }
    setTool('select');
    render();
  } else if (drag.changed) { edited(); render(); }
}
function deleteSelected() {
  if (!app.selected) return;
  app.working.parts[app.selected.key][app.selected.kind].splice(app.selected.index, 1);
  app.selected = null; edited(); render();
}
function setTool(tool) { app.tool = tool; document.body.dataset.activeTool = tool; for (const b of document.querySelectorAll('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); }

// ---- Panels
const visibleImages = () => {
  const chosenCase = app.data.cases.find(item => item.id === app.filterCase);
  return app.data.images.map((item, index) => ({ item, index })).filter(({ item }) => item.dataset === $('filter-dataset').value && (!$('filter-evidence').checked || weakEvidence(item)) && (app.filterState === 'ALL' || item.state === app.filterState) && (!chosenCase || chosenCase.images.includes(item.id)));
};
function renderProgress() {
  const p = app.data.progress, node = $('progress');
  node.replaceChildren(el('span', null, `P12-F 전체 ${p.total}장`), el('span', null, `사람 검수 완료 ${p.reviewed}장`), el('span', null, `검수 필요 ${p.needed}장`), ...(p.inProgress ? [el('span', null, `진행 중 ${p.inProgress}장`)] : []), ...(p.invalidated ? [el('span', 'bad', `무효 ${p.invalidated}장`)] : []));
  const e = app.data.evaluation;
  $('review-state').textContent = e.reviewState; $('metric-state').textContent = e.metricState;
}
function renderList() {
  const list = $('image-list'); list.replaceChildren();
  for (const { item, index } of visibleImages()) {
    const row = el('li'), button = el('button', `image-row state-${item.state}`);
    button.type = 'button'; button.dataset.id = item.id; button.setAttribute('aria-current', String(index === app.index));
    button.append(el('span', 'mark', { UNREVIEWED: '○', IN_PROGRESS: '◐', HUMAN_REVIEWED: '●', INVALIDATED: '✕' }[item.state]), el('span', 'row-id', item.id), el('span', 'row-sub', item.vehicle));
    button.setAttribute('aria-label', `${item.id} ${item.vehicle}, ${STATE_TEXT[item.state]}`);
    button.addEventListener('click', () => { if (index !== app.index && mayLeave()) openImage(index); });
    row.append(button); list.append(row);
  }
  if (!list.children.length) list.append(el('li', 'muted small', '조건에 맞는 사진이 없어요.'));
}
function renderHead() {
  const current = image();
  $('photo-id').textContent = current.id; $('photo-vehicle').textContent = current.vehicle + (current.electrified ? ' · 전동화' : '');
  $('photo-state').textContent = STATE_TEXT[current.state] + (current.record?.reviewer ? ` · ${current.record.reviewer}` : ''); $('photo-state').dataset.state = current.state;
  $('photo-license').textContent = `${current.license}${current.attribution ? ` · ${current.attribution}` : ''}`; $('photo-source').href = current.source;
  const reference = current.dataset === 'IONIQ5_REFERENCE';
  $('reference-only').hidden = !reference;
  $('save-draft').disabled = $('save-complete').disabled = reference;
}
function renderTabs() {
  const tabs = $('part-tabs'); tabs.replaceChildren();
  for (const part of app.data.parts) {
    const status = app.working.parts[part.key].status, tab = el('button', `part-tab part-${part.key}`);
    tab.type = 'button'; tab.role = 'tab'; tab.dataset.part = part.key; tab.setAttribute('aria-selected', String(part.key === app.partKey));
    tab.append(el('span', 'swatch'), el('span', null, part.name), el('span', `tab-status s-${status}`, SHORT_STATUS[status]));
    tab.addEventListener('click', () => { app.partKey = part.key; app.selected = null; setTool('select'); render(); });
    tabs.append(tab);
  }
}
const describeDraft = draft => (!draft.labelled ? '초안 없음 (P12-F에서 판단하지 않음)' : draft.status === STATUS.ABSENT ? '초안: 없음' : `초안: 있음 · 전체 ${draft.boxes.length}, 캡 ${draft.caps.length}, 제외 ${draft.ignore.length}`);
function renderPart() {
  const meta = metaOf(app.partKey), part = app.working.parts[app.partKey], draft = image().draft[app.partKey];
  $('part-name').textContent = meta.name;
  $('part-id').textContent = `${meta.partId}${meta.measuredOnly ? ' · 측정만, 운전자에게 제공 안 함' : ''}`;
  $('part-caution').textContent = meta.caution;
  const assisted = candidate();
  $('assisted-info').textContent = assisted ? `PROVISIONAL_AI_ASSISTED · ${assisted.status}` : `후보 ${app.data.assisted.status}: ${app.data.assisted.problems.join('; ')}`;
  $('assisted-evidence').textContent = assisted?.evidence ?? '';
  $('assisted-uncertainty').textContent = assisted ? `${image().assisted.vehicleIdentityBasis} · 연식 ${image().assisted.vehicleYear ?? '미확인'} · ${assisted.uncertainty} · 추가 자료 ${assisted.additionalReferenceNeeded ? '필요' : '불필요'}` : '';
  const sources = $('assisted-sources'); sources.replaceChildren();
  for (const ref of assisted?.references ?? []) {
    const li = el('li'), a = el('a', null, `${ref.official ? '제조사 공식 문서' : '사진 근거'}: ${ref.title} · ${ref.locator}`);
    a.href = ref.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a, el('p', 'muted', ref.applicability)); sources.append(li);
  }
  if (assisted && !assisted.references.length) sources.append(el('li', 'muted', '확인한 독립 자료 없음. 차종·연식·시장·파워트레인에 맞는 설명서나 부품 표기 근접 사진이 필요해요.'));
  $('use-assisted').disabled = !assisted || !(assisted.boxes.length + assisted.caps.length);
  const comparisons = image().comparison?.results.filter(r => r.key === app.partKey) ?? [];
  $('assisted-comparison').textContent = image().dataset === 'IONIQ5_REFERENCE' ? '저장된 모델 추론 없음 · 비교/평가 제외' : `예비 비교 (신뢰도 0.4, IoU 0.5; 정식 성능 아님): ${comparisons.map(r => CATEGORY_TEXT[r.category]).join(', ') || '판단 불가'}`;
  $('tool-hv').hidden = app.partKey !== 'battery';
  const statuses = $('statuses'); statuses.replaceChildren();
  for (const status of Object.values(STATUS)) {
    if (status === STATUS.UNREVIEWED && part.status !== STATUS.UNREVIEWED) continue;
    const label = el('label', 'check'), input = el('input');
    input.type = 'radio'; input.name = 'part-status'; input.value = status; input.checked = part.status === status; input.disabled = status === STATUS.UNREVIEWED;
    input.addEventListener('change', () => { part.status = status; edited(); render(); }); // Drawn boxes stay: a misclick must not erase work. A save explains the conflict.
    label.append(input, ` ${STATUS_TEXT[status]}`); statuses.append(label);
  }
  const problems = partProblems(app.partKey, part).filter(text => !/invalid/.test(text));
  $('part-problem').hidden = !problems.length; $('part-problem').textContent = problems.map(explain).join(' ');
  const rows = $('box-list'); rows.replaceChildren();
  for (const kind of Object.values(BOX_KIND)) part[kind].forEach((box, index) => {
    const row = el('li', app.selected?.kind === kind && app.selected.index === index ? 'selected' : ''), pick = el('button', 'link', `${KIND_TEXT[kind]} ${index + 1}`), remove = el('button', 'link danger', '삭제');
    pick.type = remove.type = 'button'; remove.dataset.removeKind = kind; remove.dataset.removeIndex = index;
    pick.addEventListener('click', () => { app.selected = { key: app.partKey, kind, index }; render(); });
    remove.addEventListener('click', () => { app.selected = { key: app.partKey, kind, index }; deleteSelected(); });
    row.append(pick, el('span', 'muted small', box.map(v => v.toFixed(3)).join(', ')), remove); rows.append(row);
  });
  if (!rows.children.length) rows.append(el('li', 'muted small', '아직 없어요. 위 도구로 그려 주세요.'));
  $('draft-info').textContent = describeDraft(draft);
  $('use-draft').disabled = !(draft.boxes.length + draft.caps.length + draft.ignore.length + draft.hv.length);
  $('ai-class').textContent = meta.modelClass ? `(${meta.modelClass})` : '(대응 클래스 없음)';
  const ai = $('ai-list'); ai.replaceChildren();
  const predictions = image().predictions.filter(p => p.className === meta.modelClass);
  for (const prediction of predictions) {
    const whole = [...part.boxes, ...part.caps], best = whole.length ? Math.max(...whole.map(box => iou(prediction.box, box))) : null;
    const judge = part.status === STATUS.PRESENT ? (best >= 0.5 ? `정답 박스와 일치 (IoU ${best.toFixed(2)})` : `정답 박스와 불일치${best === null ? '' : ` (IoU ${best.toFixed(2)})`}`) : part.status === STATUS.ABSENT ? '부품 없음으로 판정: 오탐' : '판정 전이라 정답 여부 없음';
    const row = el('li', prediction.score < 0.4 ? 'below' : '');
    row.append(el('span', null, prediction.score.toFixed(3)), el('span', 'small', judge), ...(prediction.score < 0.4 ? [el('span', 'muted small', '기준 0.4 미만')] : []));
    ai.append(row);
  }
  if (!ai.children.length) ai.append(el('li', 'muted small', meta.modelClass ? '이 클래스의 예측이 없어요.' : '평가할 수 없어요.'));
  $('part-note').value = part.note; $('part-reference').value = part.reference;
}
function explain(text) {
  if (/PRESENT needs/.test(text)) return '있음이면 부품이나 캡의 박스가 필요해요.';
  if (/only PRESENT/.test(text)) return '있음이 아니면 부품 박스를 둘 수 없어요.';
  if (/NEEDS_REFERENCE/.test(text)) return '외부 근거 필요로 두려면 무엇을 확인할지 메모해 주세요.';
  if (/not decided/.test(text)) return `${metaOf(text.split(':')[0])?.name ?? ''}: 아직 판정하지 않았어요.`;
  return text;
}
const fmt = value => (value === null || value === undefined ? '–' : value);
function renderEvaluation() {
  const e = app.data.evaluation, box = $('evaluation'); box.replaceChildren();
  const stateText = { HUMAN_REVIEW_PENDING: '사람 검수 전이라 검수 후 수치가 없어요. 아래는 P12-F 초안 기준 예비 수치예요.', PARTIALLY_REVIEWED: `일부만 검수했어요(${e.progress.reviewed}/${e.progress.total}장). 전체 성능이 아니에요.`, HUMAN_REVIEWED: '모든 사진의 검수가 끝났어요. 완료 기준 수치예요.', SYNTHETIC_NOT_A_REVIEW: '합성 시험 데이터예요. 실제 성능이 아니에요.' };
  box.append(el('p', 'small', stateText[e.metricState]), el('p', 'small muted', `기준: 신뢰도 ${e.rule.primaryThreshold}, IoU ${e.rule.iou}. 기존 라벨과 달라진 항목 ${e.changedParts}개.`));
  const table = el('table', 'metrics'), head = el('tr');
  for (const text of ['부품', '라벨', 'TP', 'FP', 'FN', 'P', 'R', 'F1', 'IoU']) head.append(el('th', null, text));
  table.append(head);
  const row = (name, kind, m) => { const tr = el('tr'); tr.dataset.row = kind; for (const value of [name, kind, m.tp, m.fp, m.fn, fmt(m.precision), fmt(m.recall), fmt(m.f1), fmt(m.iouMedian)]) tr.append(el('td', null, String(value))); return tr; };
  for (const part of app.data.parts) {
    const entry = e.parts[part.key];
    if (entry.reviewed === 'NO_MODEL_CLASS') { const tr = el('tr'), td = el('td', 'muted', `${part.name}: 모델 클래스 없음`); td.colSpan = 9; tr.append(td); table.append(tr); continue; }
    const scored = typeof entry.reviewed === 'object' && entry.reviewed.photos > 0; // A part left UNKNOWN everywhere has no figure, not a row of zeros.
    if (scored) { const r = row(part.name, '검수', entry.reviewed); r.dataset.part = part.key; table.append(r); table.append(row('', '같은 범위 초안', entry.p12fDraftSamePairs)); }
    table.append(row(scored ? '' : part.name, '초안 전체', entry.p12fDraftAllPhotos));
  }
  box.append(table);
}
function render() {
  renderProgress(); renderList(); renderHead(); renderTabs(); renderPart(); drawOverlay(); renderEvaluation();
}
function openImage(index) {
  app.index = index; loadWorking();
  $('photo').src = `/images/${encodeURIComponent(image().id)}`;
  $('photo').alt = `${image().id} ${image().vehicle} 엔진룸 사진`;
  fit(); render();
}
function move(step) {
  const list = visibleImages(), at = list.findIndex(({ index }) => index === app.index), next = list[at + step] ?? (at < 0 ? list[0] : null);
  if (next && mayLeave()) openImage(next.index);
}

async function save(complete) {
  if (image().dataset !== 'P12F') return;
  const reviewer = $('reviewer').value.trim(), problem = $('save-problem');
  problem.hidden = true;
  const fail = text => { problem.textContent = text; problem.hidden = false; };
  if (!reviewer) { $('reviewer').focus(); return fail('검수자를 직접 입력해 주세요.'); }
  if (complete) {
    const open = PART_KEYS.flatMap(key => partProblems(key, app.working.parts[key], { complete: true }));
    if (open.length) return fail(open.map(explain).join(' '));
  }
  const current = image();
  const answer = await api(`/api/reviews/${encodeURIComponent(current.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CarScope-Review': 'v1' }, body: JSON.stringify({ imageSha256: current.sha256, complete, reviewer, expectedRevision: app.working.revision, parts: app.working.parts }) });
  if (!answer.ok) return fail(answer.status === 409 ? '다른 창에서 먼저 저장됐어요. 새로고침해 주세요.' : answer.body.problems?.map(explain).join(' ') ?? '저장하지 못했어요. 수정 내용은 아직 이 창에 있어요.');
  current.record = answer.body.record; current.state = answer.body.state; app.data.progress = answer.body.progress; app.data.evaluation = answer.body.evaluation;
  app.working.revision = answer.body.record.revision;
  setDirty(false);
  render();
}

function wire() {
  const frame = $('frame');
  frame.addEventListener('pointerdown', onPointerDown); frame.addEventListener('pointermove', onPointerMove); frame.addEventListener('pointerup', onPointerUp); frame.addEventListener('pointercancel', onPointerUp);
  frame.addEventListener('wheel', event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2, pointerAt(event)); }, { passive: false });
  frame.addEventListener('keydown', event => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); } });
  $('zoom-in').addEventListener('click', () => zoomBy(1.25)); $('zoom-out').addEventListener('click', () => zoomBy(0.8)); $('zoom-fit').addEventListener('click', fit);
  for (const b of document.querySelectorAll('button[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  for (const id of ['show-labels', 'show-draft', 'show-assisted', 'show-ai', 'show-all-parts', 'show-other', 'ai-threshold']) $(id).addEventListener('change', drawOverlay);
  $('filter-evidence').addEventListener('change', renderList);
  $('filter-dataset').addEventListener('change', () => {
    if (!mayLeave()) { $('filter-dataset').value = image().dataset; return; }
    app.filterCase = 'ALL'; $('filter-case').value = 'ALL'; $('case-note').hidden = true;
    app.filterState = 'ALL'; $('filter-state').value = 'ALL';
    const first = visibleImages()[0]; if (first) openImage(first.index); else renderList();
  });
  $('use-assisted').addEventListener('click', () => {
    const part = candidate(); if (!part) return;
    app.working.parts[app.partKey] = importAssisted(app.partKey, part);
    app.selected = null; edited(); render();
  });
  $('filter-state').addEventListener('change', event => { app.filterState = event.target.value; renderList(); });
  $('filter-case').addEventListener('change', event => {
    app.filterCase = event.target.value; $('case-note').hidden = app.filterCase === 'ALL';
    const chosen = app.data.cases.find(item => item.id === app.filterCase);
    if (chosen) { app.partKey = chosen.focus; const first = app.data.images.findIndex(item => item.id === chosen.images[0]); if (first !== app.index && mayLeave()) { $('filter-dataset').value = 'P12F'; openImage(first); } else render(); } else renderList();
  });
  $('use-draft').addEventListener('click', () => { // Copies boxes only. The decision stays with the person.
    const draft = image().draft[app.partKey], part = app.working.parts[app.partKey];
    part.boxes = draft.boxes.map(b => [...b]); part.caps = draft.caps.map(b => [...b]); part.ignore = draft.ignore.map(b => [...b]); part.hv = draft.hv.map(b => [...b]);
    edited(); render();
  });
  $('part-note').addEventListener('input', event => { app.working.parts[app.partKey].note = event.target.value; edited(); });
  $('part-reference').addEventListener('input', event => { app.working.parts[app.partKey].reference = event.target.value; edited(); });
  $('save-draft').addEventListener('click', () => save(false)); $('save-complete').addEventListener('click', () => save(true));
  $('prev').addEventListener('click', () => move(-1)); $('next').addEventListener('click', () => move(1));
  addEventListener('resize', fit);
}

const start = await api('/api/state');
if (!start.ok) { document.body.textContent = '검수 데이터를 불러오지 못했어요.'; throw new Error('state'); }
app.data = start.body;
app.data.images.push(...app.data.referenceImages);
$('filter-dataset').querySelector('[value="IONIQ5_REFERENCE"]').disabled = !app.data.referenceImages.length;
$('synthetic').hidden = !app.data.synthetic; $('labels-changed').hidden = !app.data.sourceLabelsChanged;
for (const item of app.data.cases) { const option = el('option', null, item.title); option.value = item.id; $('filter-case').append(option); }
wire();
const first = app.data.images.findIndex(item => item.dataset === 'P12F' && item.state !== 'HUMAN_REVIEWED');
openImage(first < 0 ? 0 : first);
document.body.dataset.ready = 'true';
// Read-only test hook: coordinates only, no way to change anything.
window.__review = Object.freeze({ get view() { return app.view; }, get working() { return app.working; }, get dirty() { return app.dirty; }, get selected() { return app.selected; }, get id() { return image().id; } });
