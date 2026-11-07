// P12-B: what the PoC may conclude from a detector. Runs in Node and the browser, no DOM and no model.
// A model only counts when it was trained for this class. A COCO model can never produce a washer-cap candidate here.
export const TARGET_CLASS = 'washer-fluid-cap';

export const STATUS = Object.freeze({
  MODEL_REQUIRED: 'MODEL_REQUIRED', // No trained model is configured.
  MODEL_NOT_TARGET: 'MODEL_NOT_TARGET', // A model is configured but it was not trained for the target class.
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  IMAGE_UNREADABLE: 'IMAGE_UNREADABLE',
  INFERENCE_FAILED: 'INFERENCE_FAILED', // An error is never reported as NO_DETECTION.
  NO_DETECTION: 'NO_DETECTION',
  CANDIDATES: 'CANDIDATES',
});

export const USER_ANSWER = Object.freeze({ CONFIRMED: 'CONFIRMED', REJECTED: 'REJECTED', UNSURE: 'UNSURE' });

// Not calibrated: no labelled data exists to choose it. Evaluation must report precision and recall at this value.
export const UNCALIBRATED_SCORE_THRESHOLD = 0.5;
export const MAX_CANDIDATES = 3;

export function classifyModel(manifest) {
  if (!manifest) return { usable: false, status: STATUS.MODEL_REQUIRED };
  const labels = Array.isArray(manifest.labels) ? manifest.labels : [];
  if (manifest.role !== 'TARGET_CANDIDATE' || !labels.includes(TARGET_CLASS)) return { usable: false, status: STATUS.MODEL_NOT_TARGET };
  return { usable: true, status: null };
}

// raw: MediaPipe detections, [{ categories: [{ categoryName, score }], boundingBox: { originX, originY, width, height } }] in pixels.
export function interpretDetections({ detections, imageWidth, imageHeight, scoreThreshold = UNCALIBRATED_SCORE_THRESHOLD, maxCandidates = MAX_CANDIDATES }) {
  if (!Array.isArray(detections) || !(imageWidth > 0) || !(imageHeight > 0)) return { status: STATUS.INFERENCE_FAILED, candidates: [] };
  const found = [];
  for (const detection of detections) {
    const category = detection?.categories?.find(c => c?.categoryName === TARGET_CLASS);
    const box = detection?.boundingBox;
    if (!category || !box || !Number.isFinite(category.score) || category.score < scoreThreshold || category.score > 1) continue;
    if (![box.originX, box.originY, box.width, box.height].every(Number.isFinite)) continue;
    const left = Math.max(0, box.originX), top = Math.max(0, box.originY);
    const right = Math.min(imageWidth, box.originX + box.width), bottom = Math.min(imageHeight, box.originY + box.height);
    if (right <= left || bottom <= top) continue;
    found.push({ box: [left / imageWidth, top / imageHeight, (right - left) / imageWidth, (bottom - top) / imageHeight], score: category.score });
  }
  found.sort((a, b) => b.score - a.score);
  const candidates = found.slice(0, maxCandidates).map((c, index) => ({ ...c, id: `ai-${index + 1}`, label: TARGET_CLASS, source: 'ai-object-detector', verified: false }));
  return { status: candidates.length ? STATUS.CANDIDATES : STATUS.NO_DETECTION, candidates };
}

// The existing blue heuristic stays a separate source: it has no class and no probability.
export const toBaselinePredictions = candidates => candidates.map(c => ({ box: [c.x, c.y, c.width, c.height], score: null, source: c.source, verified: false }));

// An answer describes the on-screen box only. It is not an inspection result and has no route into the result contract.
export function answerCandidate(answers, id, answer) {
  if (!Object.values(USER_ANSWER).includes(answer)) throw new Error(`Unknown answer ${answer}`);
  return { ...answers, [id]: answer };
}
