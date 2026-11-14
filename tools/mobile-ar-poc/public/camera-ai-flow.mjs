// P21: camera AI assist — one captured frame → hosted part detection → the person confirms a part (or drags its region)
// → automatic context crop → vision analysis. Pure and framework-free, so it runs in Node tests and in the page.
// This is a temporary UI work state for the photo aid only. The inspection itself stays in flowFor()
// (self-inspection / checklist-flow); nothing here reads or writes a checklist answer or a result record.
import { validateBox } from './context-crop.mjs';
import { MAX_CANDIDATES, MIN_CANDIDATE_SCORE } from './part-detection.mjs';

export const CAI = Object.freeze({
  IDLE: 'IDLE', CAMERA_READY: 'CAMERA_READY', CAPTURING: 'CAPTURING', DETECTING: 'DETECTING',
  CANDIDATE_FOUND: 'CANDIDATE_FOUND', NONE_FOUND: 'NONE_FOUND', MANUAL_REGION: 'MANUAL_REGION',
  CONFIRMING_PART: 'CONFIRMING_PART', CROPPING: 'CROPPING', ANALYZING: 'ANALYZING',
  RESULT: 'RESULT', ERROR: 'ERROR', CANCELLED: 'CANCELLED',
});
/** detect: the hosted detector proposes boxes. mark: no detector class, the person drags the region. */
export const CAI_PLAN = Object.freeze({ DETECT: 'DETECT', MARK: 'MARK' });
/** Phases with a request or a crop in flight. Leaving, hiding the page or a new capture cancels them. */
export const BUSY = Object.freeze([CAI.CAPTURING, CAI.DETECTING, CAI.CONFIRMING_PART, CAI.CROPPING, CAI.ANALYZING]);
const SELECTABLE = [CAI.CANDIDATE_FOUND, CAI.NONE_FOUND, CAI.MANUAL_REGION];

/** Detector upload: the same JPEG bound the server enforces (DETECTION_LIMITS: 4 MiB, sides 64..2048). */
export const CAPTURE_LIMITS = Object.freeze({ detectMaxSide: 1280, cropSourceMaxSide: 2048, minSide: 64, detectMaxBytes: 4 * 1024 * 1024 });
/** A dragged region must cover at least this share of each side and this many source pixels. Smaller is refused. */
export const REGION_MIN = Object.freeze({ fraction: 0.03, sourcePx: 24 });

const freezeConsent = (detect = false, analyze = false) => Object.freeze({ detect, analyze });
const base = (plan, attempt, live) => Object.freeze({
  phase: live ? CAI.CAMERA_READY : CAI.IDLE, plan, attempt, live,
  consent: freezeConsent(), candidates: Object.freeze([]), selected: -1, region: null, regionSource: null,
  code: null, result: null, provenance: null, regionError: null,
});
export const initialCameraAi = (plan, live = false) => base(plan, 0, live);

/**
 * Every async answer carries the attempt it was started under; a different attempt is a late answer from an earlier
 * capture, a cancelled request or a page that moved on, and it never changes the state.
 */
export function reduceCameraAi(s, e) {
  const to = (patch) => Object.freeze({ ...s, ...patch });
  const stale = e.attempt !== undefined && e.attempt !== s.attempt;
  if (stale) return s;
  switch (e.type) {
    case 'CAMERA': // the live picture came or went; only the waiting phases follow it
      if (s.phase === CAI.IDLE && e.live) return to({ phase: CAI.CAMERA_READY, live: true });
      if (s.phase === CAI.CAMERA_READY && !e.live) return to({ phase: CAI.IDLE, live: false });
      return to({ live: !!e.live });
    case 'CONSENT': {
      if (s.phase !== CAI.CAMERA_READY && s.phase !== CAI.IDLE && !retryable(s)) return s;
      if (e.kind !== 'detect' && e.kind !== 'analyze') return s;
      if (e.kind === 'detect' && (s.plan !== CAI_PLAN.DETECT || retryable(s))) return s;
      return to({ consent: freezeConsent(e.kind === 'detect' ? e.value === true : s.consent.detect, e.kind === 'analyze' ? e.value === true : s.consent.analyze) });
    }
    case 'CAPTURE': // both sends were agreed to for this capture before anything is taken
      if (s.phase !== CAI.CAMERA_READY || !s.live || !canCapture(s)) return s;
      return to({ phase: CAI.CAPTURING, attempt: s.attempt + 1, candidates: Object.freeze([]), selected: -1, region: null, regionSource: null, code: null, result: null, provenance: null, regionError: null });
    case 'CAPTURED': // the frame exists; the detector consent is used up by this one upload
      if (s.phase !== CAI.CAPTURING) return s;
      return s.plan === CAI_PLAN.DETECT ? to({ phase: CAI.DETECTING, consent: freezeConsent(false, s.consent.analyze) }) : to({ phase: CAI.MANUAL_REGION });
    case 'DETECTED':
      if (s.phase !== CAI.DETECTING) return s;
      return e.candidates.length
        ? to({ phase: CAI.CANDIDATE_FOUND, candidates: Object.freeze(e.candidates.map(Object.freeze)), selected: 0, provenance: e.provenance ?? null })
        : to({ phase: CAI.NONE_FOUND, provenance: e.provenance ?? null });
    case 'SELECT':
      if (s.phase !== CAI.CANDIDATE_FOUND || !Number.isInteger(e.index) || e.index < 0 || e.index >= s.candidates.length) return s;
      return to({ selected: e.index });
    case 'MANUAL': // same photo, the person drags the region instead
      if (s.phase !== CAI.CANDIDATE_FOUND && s.phase !== CAI.NONE_FOUND) return s;
      return to({ phase: CAI.MANUAL_REGION, region: null, regionError: null });
    case 'REGION':
      if (s.phase !== CAI.MANUAL_REGION) return s;
      return e.box ? to({ region: Object.freeze([...e.box]), regionError: null }) : to({ region: null, regionError: e.error ?? null });
    case 'CONFIRM': { // the explicit "this is the part"; only now may analysis start, and only with its consent
      if (!SELECTABLE.includes(s.phase) || !s.consent.analyze) return s;
      const fromCandidate = s.phase === CAI.CANDIDATE_FOUND;
      const box = fromCandidate ? s.candidates[s.selected]?.box : s.region;
      if (!box) return s;
      try { validateBox(box); } catch { return s; }
      return to({ phase: CAI.CONFIRMING_PART, attempt: s.attempt + 1, region: Object.freeze([...box]), regionSource: fromCandidate ? 'AI_CANDIDATE' : 'MANUAL', code: null });
    }
    case 'CROP_START': return s.phase === CAI.CONFIRMING_PART ? to({ phase: CAI.CROPPING }) : s;
    case 'CROPPED': // the analysis consent is used up by this one upload
      return s.phase === CAI.CROPPING ? to({ phase: CAI.ANALYZING, consent: freezeConsent(false, false) }) : s;
    case 'ANALYZED': return s.phase === CAI.ANALYZING ? to({ phase: CAI.RESULT, result: e.result, provenance: e.provenance ?? s.provenance }) : s;
    case 'FAIL': return BUSY.includes(s.phase) ? to({ phase: CAI.ERROR, code: e.code ?? 'UNAVAILABLE', consent: freezeConsent(false, false) }) : s;
    case 'CANCEL': // new attempt, so whatever was in flight lands on nothing
      return BUSY.includes(s.phase) ? to({ phase: CAI.CANCELLED, attempt: s.attempt + 1, consent: freezeConsent(false, false) }) : s;
    case 'RETRY_ANALYSIS': // same confirmed region, a fresh explicit consent, a new attempt
      if (!retryable(s) || !s.region || !s.consent.analyze) return s;
      return to({ phase: CAI.CONFIRMING_PART, attempt: s.attempt + 1, code: null });
    case 'RESET': // new capture or "다시 찾기": every consent is asked again
      return base(s.plan, s.attempt + 1, s.live);
    default: return s;
  }
}
const retryable = (s) => (s.phase === CAI.ERROR || s.phase === CAI.CANCELLED) && !!s.region;
export const canCapture = (s) => s.consent.analyze && (s.plan !== CAI_PLAN.DETECT || s.consent.detect);

// ---- Geometry. Boxes are [left, top, width, height] as fractions of the captured frame, origin top left, the detection contract's.

/** Integer size of a frame scaled to fit `maxSide`, never up. Keeps the aspect within the server's 0.02 check. */
export function scaledSize(width, height, maxSide) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && maxSide > 0)) throw new Error('CAPTURE_SIZE_INVALID');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
/** A capture the services accept: real video dimensions and sides inside the detection bounds once scaled. */
export function captureProblem(videoWidth, videoHeight) {
  if (!(Number.isInteger(videoWidth) && Number.isInteger(videoHeight) && videoWidth > 0 && videoHeight > 0)) return 'NO_VIDEO_FRAME';
  const d = scaledSize(videoWidth, videoHeight, CAPTURE_LIMITS.detectMaxSide);
  if (d.width < CAPTURE_LIMITS.minSide || d.height < CAPTURE_LIMITS.minSide) return 'FRAME_TOO_SMALL';
  return null;
}
/** The upload itself: JPEG only, inside the byte bound. */
export function uploadProblem(blob, maxBytes = CAPTURE_LIMITS.detectMaxBytes) {
  if (!blob || blob.type !== 'image/jpeg') return 'UNREADABLE';
  if (!(blob.size > 0)) return 'UNREADABLE';
  return blob.size > maxBytes ? 'TOO_LARGE' : null;
}

/** Where an image of w×h sits inside an element of ew×eh with object-fit: contain (letterboxed, centred). */
export function containBox(w, h, ew, eh) {
  const scale = Math.min(ew / w, eh / h), width = w * scale, height = h * scale;
  return { x: (ew - width) / 2, y: (eh - height) / 2, width, height };
}
/**
 * A pointer position in the element (CSS px from its top-left) → fractions of the source image, clamped to the image.
 * Works for any element size and aspect (rotation, zoom), because it is recomputed from the current layout every time.
 */
export function elementToImagePoint(px, py, elementWidth, elementHeight, imageWidth, imageHeight) {
  if (![px, py, elementWidth, elementHeight, imageWidth, imageHeight].every(Number.isFinite) || elementWidth <= 0 || elementHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
  const r = containBox(imageWidth, imageHeight, elementWidth, elementHeight);
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return [clamp((px - r.x) / r.width), clamp((py - r.y) / r.height)];
}
/** The inverse, for drawing: a normalized box → CSS px inside the element. */
export function imageBoxToElement(box, elementWidth, elementHeight, imageWidth, imageHeight) {
  const r = containBox(imageWidth, imageHeight, elementWidth, elementHeight);
  return { left: r.x + box[0] * r.width, top: r.y + box[1] * r.height, width: box[2] * r.width, height: box[3] * r.height };
}

/** Too small for an analysis to mean anything: refused, and the person is asked to drag again. */
export function regionProblem(box, imageWidth, imageHeight) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return 'REGION_INVALID';
  const [, , w, h] = box;
  // Size first: a tap or a thin line is "too small" to the person, not "invalid".
  if (w >= 0 && h >= 0 && (w < REGION_MIN.fraction || h < REGION_MIN.fraction || w * imageWidth < REGION_MIN.sourcePx || h * imageHeight < REGION_MIN.sourcePx)) return 'REGION_TOO_SMALL';
  try { validateBox(box); } catch { return 'REGION_INVALID'; }
  return null;
}
/** Two points of a drag, in any direction, → a box clamped to the image, or the reason it is refused. */
export function dragToBox(start, end, imageWidth, imageHeight) {
  if (!start || !end || ![...start, ...end].every(Number.isFinite)) return { error: 'REGION_INVALID' };
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const [x0, y0, x1, y1] = [clamp(start[0]), clamp(start[1]), clamp(end[0]), clamp(end[1])];
  const box = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
  const error = regionProblem(box, imageWidth, imageHeight);
  return error ? { error } : { box };
}
/** Keyboard alternative: a centred starting region, then move or resize by steps, always inside the image and above the minimum. */
export const keyboardStartBox = () => [0.3, 0.3, 0.4, 0.4];
export function nudgeBox(box, { dx = 0, dy = 0, dw = 0, dh = 0 } = {}) {
  let [l, t, w, h] = box;
  w = Math.min(1, Math.max(REGION_MIN.fraction, w + dw));
  h = Math.min(1, Math.max(REGION_MIN.fraction, h + dh));
  l = Math.min(1 - w, Math.max(0, l + dx));
  t = Math.min(1 - h, Math.max(0, t + dy));
  return [l, t, w, h];
}

/** The detector's candidates as the page accepts them: at most three, valid boxes, scores in range. Anything else is refused whole. */
export function acceptCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) throw new Error('INVALID_RESPONSE');
  return candidates.map((c) => {
    if (!Number.isFinite(c?.score) || c.score < MIN_CANDIDATE_SCORE || c.score > 1) throw new Error('INVALID_RESPONSE');
    try { return { box: validateBox(c.box), score: c.score }; } catch { throw new Error('INVALID_RESPONSE'); }
  });
}
