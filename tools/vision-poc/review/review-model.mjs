// P12-G: the rules of a label review, shared by the page, the server and the evaluation. Pure: no file, no network, no clock.
// A person decides every status here. Nothing in this file turns a draft into a decision.
export const REVIEW_SCHEMA = 'carscope-label-review-v1';
export const STATUS = Object.freeze({ UNREVIEWED: 'UNREVIEWED', PRESENT: 'PRESENT', ABSENT: 'ABSENT', UNKNOWN: 'UNKNOWN', NEEDS_REFERENCE: 'NEEDS_REFERENCE' });
export const IMAGE_STATE = Object.freeze({ UNREVIEWED: 'UNREVIEWED', IN_PROGRESS: 'IN_PROGRESS', HUMAN_REVIEWED: 'HUMAN_REVIEWED', INVALIDATED: 'INVALIDATED' });
export const BOX_KIND = Object.freeze({ WHOLE: 'boxes', CAP: 'caps', IGNORE: 'ignore', HV: 'hv' });

// Dataset key, registry partId and model class. Battery is measured only and low-conductivity coolant has no class, so neither is offered to a driver.
export const REVIEW_PARTS = Object.freeze([
  Object.freeze({ key: 'washer', partId: 'washer-fluid-cap', name: '워셔액 주입구', modelClass: 'Windshield Wiper Fluid', caution: '워셔액 캡과 냉각수 캡을 구분해 주세요. 앞유리·분사 표시가 근거예요.' }),
  Object.freeze({ key: 'coolant', partId: 'coolant-reservoir', name: '냉각수 리저버', modelClass: 'Engine Coolant Reservoir', caution: '리저버 전체와 캡을 다른 유형으로 그려 주세요. 저전도 냉각수와 구분이 안 되면 근거 필요로 두세요.' }),
  Object.freeze({ key: 'brake', partId: 'brake-fluid-reservoir', name: '브레이크액 리저버', modelClass: 'Brake Fluid', caution: '인접한 부스터나 다른 통과 구분해 주세요. 클러치·파워 스티어링 통도 비슷해요.' }),
  Object.freeze({ key: 'fuse', partId: 'fuse-box', name: '모터룸 퓨즈박스', modelClass: 'Fuse Box', caution: '일반 전장 커버와 구분해 주세요. 뚜껑 표시나 퓨즈가 보일 때만 있음으로 판정해 주세요.' }),
  Object.freeze({ key: 'battery', partId: 'battery-12v', name: '12V 보조 배터리', modelClass: 'Battery', measuredOnly: true, caution: '12V 표시가 근거예요. 고전압 부품은 고전압 영역으로 따로 그려 주세요.' }),
  Object.freeze({ key: 'lcw', partId: 'lcw-coolant-reservoir', name: '저전도 냉각수 리저버', modelClass: null, caution: '모델에 대응 클래스가 없어요. 일반 냉각수와 구별할 근거가 없으면 근거 필요나 판단 불가로 두세요.' }),
]);
export const PART_KEYS = Object.freeze(REVIEW_PARTS.map(part => part.key));
export const partByKey = key => REVIEW_PARTS.find(part => part.key === key) ?? null;

// P12-F's preliminary observations. They point to what to look at. They are not answers.
export const REVIEW_CASES = Object.freeze([
  Object.freeze({ id: 'radiator-as-washer', title: 'new-08: 라디에이터 캡을 워셔액으로', images: ['new-08'], focus: 'washer' }),
  Object.freeze({ id: 'hyryder-mixup', title: 'commons-039: 냉각수·워셔액 혼동', images: ['commons-039'], focus: 'coolant' }),
  Object.freeze({ id: 'hose-as-coolant', title: 'commons-170: 호스 영역을 냉각수로', images: ['commons-170'], focus: 'coolant' }),
  Object.freeze({ id: 'beside-brake', title: 'commons-024: 브레이크액 옆 부품', images: ['commons-024'], focus: 'brake' }),
  Object.freeze({ id: 'brake-closeup', title: 'commons-066: 브레이크액 근접 미탐', images: ['commons-066'], focus: 'brake' }),
  Object.freeze({ id: 'fuse-closeup', title: 'new-06: 퓨즈박스 근접 미탐', images: ['new-06'], focus: 'fuse' }),
  Object.freeze({ id: 'leaf', title: 'Nissan Leaf: 여러 부품 미탐', images: ['new-00', 'new-04'], focus: 'battery' }),
  Object.freeze({ id: 'bolt', title: 'Chevrolet Bolt: 비교적 성공', images: ['commons-036', 'commons-037', 'new-05'], focus: 'brake' }),
]);

const MIN_SIDE = 0.002;
const finite = (...values) => values.every(Number.isFinite);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const isBox = box => Array.isArray(box) && box.length === 4 && finite(...box) && box[0] >= 0 && box[1] >= 0 && box[2] >= MIN_SIDE && box[3] >= MIN_SIDE && box[0] + box[2] <= 1.0001 && box[1] + box[3] <= 1.0001;
export const iou = (a, b) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])), both = x * y;
  return both ? both / (a[2] * a[3] + b[2] * b[3] - both) : 0;
};

// ---- The view. Boxes stay fractions of the picture whatever the zoom; only these two functions know about screen pixels.
export const fitView = (image, frame) => { const scale = Math.min(frame.width / image.width, frame.height / image.height); return { scale, x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2 }; };
export const toScreen = ([nx, ny], image, view) => [view.x + nx * image.width * view.scale, view.y + ny * image.height * view.scale];
export const toNormalized = ([sx, sy], image, view) => [(sx - view.x) / (image.width * view.scale), (sy - view.y) / (image.height * view.scale)];
export const MIN_SCALE_FACTOR = 0.5;
export const MAX_SCALE_FACTOR = 12;
/** Zooms about a screen point, so what is under the pointer stays under it. */
export function zoomAt(view, factor, [sx, sy], fittedScale) {
  const scale = clamp(view.scale * factor, fittedScale * MIN_SCALE_FACTOR, fittedScale * MAX_SCALE_FACTOR), applied = scale / view.scale;
  return { scale, x: sx - (sx - view.x) * applied, y: sy - (sy - view.y) * applied };
}

// ---- Editing a box, in fractions of the picture.
export const boxFromCorners = ([ax, ay], [bx, by]) => {
  const left = clamp(Math.min(ax, bx), 0, 1), top = clamp(Math.min(ay, by), 0, 1), right = clamp(Math.max(ax, bx), 0, 1), bottom = clamp(Math.max(ay, by), 0, 1);
  return [left, top, right - left, bottom - top];
};
export const moveBox = ([x, y, w, h], dx, dy) => [clamp(x + dx, 0, 1 - w), clamp(y + dy, 0, 1 - h), w, h];
/** handle: any of n, s, e, w and their pairs. An edge cannot pass the opposite one. */
export function resizeBox([x, y, w, h], handle, dx, dy) {
  let left = x, top = y, right = x + w, bottom = y + h;
  if (handle.includes('w')) left = clamp(x + dx, 0, right - MIN_SIDE);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIDE, 1);
  if (handle.includes('n')) top = clamp(y + dy, 0, bottom - MIN_SIDE);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIDE, 1);
  return [left, top, right - left, bottom - top];
}
export const roundBox = box => box.map(value => Math.round(value * 10000) / 10000);

// ---- Predictions: fractions, as the model answered them. Never a label.
export function predictionsOf(answer) {
  const { width: W, height: H } = answer.image;
  return answer.predictions.map(p => ({ className: p.class, score: p.confidence, box: [(p.x - p.width / 2) / W, (p.y - p.height / 2) / H, p.width / W, p.height / H] })).sort((a, b) => b.score - a.score);
}

// ---- Drafts: what P12-F's single automated annotator wrote. Shown beside a review, and only ever copied by a person's click.
export function draftOf(image, key) {
  const label = image.parts?.[key];
  const hv = key === 'battery' ? image.parts?.hv ?? [] : [];
  if (!label) return { status: STATUS.UNKNOWN, boxes: [], caps: [], ignore: [], hv, labelled: false };
  return { status: label.boxes.length ? STATUS.PRESENT : STATUS.ABSENT, boxes: label.boxes, caps: label.caps ?? [], ignore: label.ignore ?? [], hv, labelled: true };
}
export const emptyPart = key => ({ partId: partByKey(key).partId, status: STATUS.UNREVIEWED, boxes: [], caps: [], ignore: [], hv: [], note: '', reference: '' });

// ---- Validation. A file or request that breaks a rule is refused whole, so nothing half-valid is scored.
/** Problems with one part's record, as codes. `complete` asks whether it can stand in a finished image. */
export function partProblems(key, part, { complete = false } = {}) {
  const meta = partByKey(key), problems = [];
  if (!meta) return [`unknown part ${key}`];
  if (!part || typeof part !== 'object') return [`${key}: not a record`];
  if (part.partId !== meta.partId) problems.push(`${key}: partId must be ${meta.partId}`);
  if (!Object.values(STATUS).includes(part.status)) problems.push(`${key}: unknown status`);
  for (const kind of Object.values(BOX_KIND)) {
    if (!Array.isArray(part[kind]) || !part[kind].every(isBox)) problems.push(`${key}: ${kind} holds an invalid box`);
  }
  if (problems.length) return problems;
  if (typeof part.note !== 'string' || typeof part.reference !== 'string' || part.note.length > 2000 || part.reference.length > 500) problems.push(`${key}: note or reference invalid`);
  if (part.hv.length && key !== 'battery') problems.push(`${key}: high voltage regions belong to the battery review`);
  const located = part.boxes.length + part.caps.length;
  if (part.status === STATUS.PRESENT && !located) problems.push(`${key}: PRESENT needs a box`);
  // A box may be drawn before the decision. A decision of no part cannot keep one.
  if (part.status !== STATUS.PRESENT && part.status !== STATUS.UNREVIEWED && located) problems.push(`${key}: only PRESENT can hold a part box`);
  if (part.status === STATUS.NEEDS_REFERENCE && !part.note.trim() && !part.reference.trim()) problems.push(`${key}: NEEDS_REFERENCE needs a note saying what to check`);
  if (complete && part.status === STATUS.UNREVIEWED) problems.push(`${key}: not decided`);
  return problems;
}

/** The body of a save. Time and revision come from the server. The reviewer is whatever the person typed: nothing here supplies one. */
export function saveProblems(body, image) {
  if (!body || typeof body !== 'object') return ['not a record'];
  const problems = [];
  if (body.imageSha256 !== image.sha256) problems.push('imageSha256 does not match the photo');
  if (typeof body.complete !== 'boolean') problems.push('complete must be true or false');
  if (typeof body.reviewer !== 'string' || !body.reviewer.trim() || body.reviewer.length > 80) problems.push('reviewer is required');
  const keys = Object.keys(body.parts ?? {});
  if (keys.length !== PART_KEYS.length || !PART_KEYS.every(key => keys.includes(key))) return [...problems, 'all six parts are required'];
  for (const key of PART_KEYS) problems.push(...partProblems(key, body.parts[key], { complete: body.complete === true }));
  return problems;
}

/** A whole review file. Throws nothing: returns problems. A photo whose hash changed is not a problem here: the record stays but counts for nothing. */
export function reviewFileProblems(file, images) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return ['not an object'];
  const problems = [];
  if (file.schema !== REVIEW_SCHEMA) problems.push(`schema must be ${REVIEW_SCHEMA}`);
  if (typeof file.synthetic !== 'boolean') problems.push('synthetic must be true or false');
  if (typeof file.sourceLabelsSha256 !== 'string') problems.push('sourceLabelsSha256 is required');
  if (!file.images || typeof file.images !== 'object' || Array.isArray(file.images)) return [...problems, 'images must be an object'];
  const known = new Set(images.map(image => image.id));
  for (const [id, record] of Object.entries(file.images)) {
    if (!known.has(id)) { problems.push(`${id}: not in the evaluation set`); continue; }
    if (!record || typeof record !== 'object') { problems.push(`${id}: not a record`); continue; }
    if (typeof record.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.imageSha256)) problems.push(`${id}: imageSha256 invalid`);
    if (typeof record.complete !== 'boolean') problems.push(`${id}: complete must be true or false`);
    if (record.complete && (typeof record.reviewer !== 'string' || !record.reviewer.trim())) problems.push(`${id}: a finished review needs a reviewer`);
    if (record.complete && !record.completedAt) problems.push(`${id}: a finished review needs completedAt`);
    if (!Number.isInteger(record.revision) || record.revision < 1) problems.push(`${id}: revision invalid`);
    for (const key of PART_KEYS) problems.push(...partProblems(key, record.parts?.[key], { complete: record.complete === true }).map(text => `${id}: ${text}`));
    for (const key of Object.keys(record.parts ?? {})) if (!PART_KEYS.includes(key)) problems.push(`${id}: unknown part ${key}`);
  }
  return problems;
}

/** Where one photo stands. A record made for other bytes is invalid, whatever it says. */
export function imageState(image, record) {
  if (!record) return IMAGE_STATE.UNREVIEWED;
  if (record.imageSha256 !== image.sha256) return IMAGE_STATE.INVALIDATED;
  return record.complete ? IMAGE_STATE.HUMAN_REVIEWED : IMAGE_STATE.IN_PROGRESS;
}
export function progressOf(images, review) {
  const count = { total: images.length, reviewed: 0, inProgress: 0, invalidated: 0, unreviewed: 0 };
  for (const image of images) {
    const state = imageState(image, review?.images?.[image.id]);
    if (state === IMAGE_STATE.HUMAN_REVIEWED) count.reviewed++;
    else if (state === IMAGE_STATE.IN_PROGRESS) count.inProgress++;
    else if (state === IMAGE_STATE.INVALIDATED) count.invalidated++;
    else count.unreviewed++;
  }
  count.needed = count.total - count.reviewed;
  return count;
}
