// P12-E: which bonnet part may ask the hosted model for a candidate, and what counts as one. Pure data and rules, shared by the page and the server.
// A class name alone proves nothing, so each row keeps why it has its status. The evidence is in docs/p12-e-bonnet-part-detection.md.
// Nothing here is VERIFIED: P12-F's 26 photos have labels no person reviewed. See docs/p12-f-real-part-detection.md.
import { aiSupport } from './part-capabilities.mjs';
export const DETECTION_STATUS = Object.freeze({ UNSUPPORTED: 'UNSUPPORTED', EXPERIMENTAL: 'EXPERIMENTAL', VERIFIED: 'VERIFIED' });
export const DETECTION_MODEL_ID = 'engine-bay-parts/1';
export const DETECTION_CONSENT = 'external-ai-v1';
// Boxes are [left, top, width, height] as fractions of the picture sent, origin top left. Later tracking reads this, not pixels.
export const DETECTION_COORDINATES = 'normalized-top-left-xywh';
// Not tuned: the value that removed the one false box in P12-C's 12 preliminary photos. P12-F kept it and reported other values beside it. To be set by an evaluation with reviewed labels.
export const MIN_CANDIDATE_SCORE = 0.4;
export const MAX_CANDIDATES = 3;

// The status comes from part-capabilities.mjs, the one table both screens read; this row keeps the class and the evidence.
const row = (partId, taskId, modelClass, reason, caution = null) => Object.freeze({ partId, taskId, status: aiSupport(partId).detection, modelClass, reason, caution });
export const PART_DETECTION = Object.freeze({
  'washer-fluid-cap': row('washer-fluid-cap', 'washer-fluid', 'Windshield Wiper Fluid',
    'P12-F real model, 16 photos, unreviewed labels, score 0.4: 6 of 14 caps found, 0 counted false. Boxes sit on the cap. A radiator cap was also marked on a photo not scored for this part.',
    '캡의 앞유리·분사 모양 표시를 직접 확인해 주세요. 색이나 AI 표시만으로 정하지 마세요.'),
  'coolant-reservoir': row('coolant-reservoir', 'coolant-reservoir', 'Engine Coolant Reservoir',
    'P12-F real model, 15 photos, unreviewed labels, score 0.4: 4 of 13 tanks found, 2 false. Weakest of the four. Boxes hold the whole tank. No low-conductivity class exists, so that tank may be marked as this.',
    '일반 냉각수인지 저전도 냉각수인지 AI가 구별하지 못해요. 설명서의 표기를 직접 확인해 주세요.'),
  'lcw-coolant-reservoir': row('lcw-coolant-reservoir', 'lcw-coolant-reservoir', null,
    'The model has no low-conductivity class. Nothing shows that Inverter or Secondary Coolant Reservoir mean this part, and some cars do not have it.'),
  'brake-fluid-reservoir': row('brake-fluid-reservoir', 'brake-fluid', 'Brake Fluid',
    'P12-F real model, 18 photos, unreviewed labels, score 0.4: 7 of 17 found, 1 false, on the part beside it. Close-ups were missed. Clutch and power steering tanks barely appear in the photos.',
    '다른 액체 통과 헷갈릴 수 있어요. 설명서의 표기와 MIN·MAX 표시를 직접 확인해 주세요.'),
  'battery-12v': row('battery-12v', 'battery-12v', null,
    'P12-F: Battery found 6 of 14 and put no box on 12 marked high voltage regions, but only 3 of 9 on electrified cars and no photo shows a high voltage battery. Nothing shows the class means 12V, and that mix-up matters most here.'),
  'fuse-box': row('fuse-box', 'fuse-box', 'Fuse Box',
    'P12-F real model: only 3 labelled photos, 1 found, and a close-up was missed. Boxes on black lidded boxes that could not be judged. Too few to say. Mix-ups with other electrical parts not measured.',
    '다른 전장 부품일 수 있어요. 설명서의 배치도와 덮개 표시를 직접 확인해 주세요.'),
  // P13-G: the eleven exterior parts. engine-bay-parts/1 is a bonnet model: no class exists for a tyre, wiper, lamp or charge port, and none
  // is substituted. These rows only record that, and carry the task each analysis belongs to; the person marks the region themself.
  ...Object.fromEntries([
    ...['front-left', 'front-right', 'rear-left', 'rear-right'].map(w => `tire.${w}`),
    'wiper.front.left', 'wiper.front.right',
    ...['low', 'high'].flatMap(b => ['left', 'right'].map(side => `light-${b}-beam-${side}-0`)),
    'ev-charge.port',
  ].map(id => [id, row(id, id, null, 'P13-G: an exterior part. The detection model engine-bay-parts/1 has bonnet classes only; no class is mapped or substituted.')])),
});
export const detectionForTask = taskId => Object.values(PART_DETECTION).find(entry => entry.taskId === taskId) ?? null;
/** Only a part with a mapped class offers the feature at all, so no button exists that cannot work. */
export const offersDetection = entry => Boolean(entry && entry.status !== DETECTION_STATUS.UNSUPPORTED && entry.modelClass);

const iou = (a, b) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])), both = x * y;
  return both / (a[2] * a[3] + b[2] * b[3] - both);
};
/**
 * Boxes for this part only, as fractions of the picture, best first. An exact class match: a number or any other part never counts.
 * @param parsed { imageWidth, imageHeight, predictions: [{ className, score, x, y, width, height }] } x and y are the box centre.
 */
export function candidatesFor(partId, parsed) {
  const entry = PART_DETECTION[partId];
  if (!offersDetection(entry)) return [];
  const { imageWidth: W, imageHeight: H, predictions } = parsed ?? {};
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0 && Array.isArray(predictions))) throw new Error('DETECTION_RESPONSE_INVALID');
  const boxes = [];
  for (const p of predictions) {
    if (p?.className !== entry.modelClass || !Number.isFinite(p.score) || p.score < MIN_CANDIDATE_SCORE || p.score > 1) continue;
    if (![p.x, p.y, p.width, p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0) continue;
    const left = Math.max(0, p.x - p.width / 2), top = Math.max(0, p.y - p.height / 2), right = Math.min(W, p.x + p.width / 2), bottom = Math.min(H, p.y + p.height / 2);
    if (right <= left || bottom <= top) continue;
    boxes.push({ score: p.score, box: [left / W, top / H, (right - left) / W, (bottom - top) / H] });
  }
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of boxes) if (!kept.some(other => iou(other.box, box.box) > 0.5)) kept.push(box);
  return kept.slice(0, MAX_CANDIDATES);
}

// ---- The panel's states. A late answer from an earlier photo, or from before the part changed, is dropped by its attempt number.
// LOCAL_ONLY (P13-D): a part with no detector. The photo is prepared on the phone and the person marks the region; nothing goes to the hosted detector.
export const PHASE = Object.freeze({ CLOSED: 'CLOSED', CONSENT: 'CONSENT', ANALYZING: 'ANALYZING', CANDIDATES: 'CANDIDATES', NONE_FOUND: 'NONE_FOUND', FAILED: 'FAILED', LOCAL_ONLY: 'LOCAL_ONLY' });
const fresh = (partId, attempt) => Object.freeze({ phase: PHASE.CLOSED, partId, consented: false, attempt, candidates: Object.freeze([]), detection: null, code: null, local: false });
export const initialDetection = (partId = null) => fresh(partId, 0);
export function reduceDetection(state, event) {
  const to = patch => Object.freeze({ ...state, ...patch });
  switch (event.type) {
    case 'OPEN': return state.phase === PHASE.CLOSED ? to({ phase: PHASE.CONSENT, consented: false, candidates: Object.freeze([]), code: null }) : state;
    case 'CONSENT': return state.phase === PHASE.CONSENT ? to({ consented: event.value === true }) : state;
    case 'PHOTO': return state.phase === PHASE.CONSENT && state.consented ? to({ phase: PHASE.ANALYZING, attempt: state.attempt + 1, candidates: Object.freeze([]), detection: null, code: null }) : state;
    // No detector consent is asked or needed: this photo is not sent anywhere at this step.
    case 'LOCAL_PHOTO': return state.phase === PHASE.CONSENT ? to({ phase: PHASE.ANALYZING, attempt: state.attempt + 1, candidates: Object.freeze([]), detection: null, code: null, local: true }) : state;
    case 'LOCAL_READY': return state.phase === PHASE.ANALYZING && state.local && event.attempt === state.attempt ? to({ phase: PHASE.LOCAL_ONLY }) : state;
    case 'ANSWER':
      if (state.phase !== PHASE.ANALYZING || state.local || event.attempt !== state.attempt) return state;
      return event.candidates.length ? to({ phase: PHASE.CANDIDATES, candidates: Object.freeze([...event.candidates]), detection: event.detection ?? null }) : to({ phase: PHASE.NONE_FOUND, detection: event.detection ?? null });
    case 'FAIL': return state.phase === PHASE.ANALYZING && event.attempt === state.attempt ? to({ phase: PHASE.FAILED, code: event.code }) : state;
    case 'AGAIN': return [PHASE.CANDIDATES, PHASE.NONE_FOUND, PHASE.FAILED, PHASE.LOCAL_ONLY].includes(state.phase) ? to({ phase: PHASE.CONSENT, consented: false, candidates: Object.freeze([]), detection: null, code: null, local: false }) : state;
    case 'SELECT_PART': return state.partId === event.partId ? state : fresh(event.partId, state.attempt + 1);
    case 'CLOSE': return fresh(state.partId, state.attempt + 1);
    default: return state;
  }
}
