// P12-C: reads a Roboflow prediction and maps one source class onto the CarScope target. Nothing else counts as the target.
// The source class is named for wiper fluid. Whether its boxes cover the cap or the whole reservoir is unknown until the model runs,
// so the mapping alone does not claim the two mean the same thing: see the auxiliary measure in exploratory.mjs.
import { TARGET_CLASS, interpretDetections } from './detection-contract.mjs';

export const ROBOFLOW_MODEL_ID = 'engine-bay-parts/1';
export const SOURCE_TO_TARGET = Object.freeze({ 'Windshield Wiper Fluid': TARGET_CLASS });
const UNMAPPED = 'unmapped:'; // A source class can never collide with the target name, even if it is spelled the same.

const finite = (...values) => values.every(Number.isFinite);

// Fields from Roboflow Inference's ObjectDetectionPrediction: x and y are the box centre, all in pixels of the reported image.
export function parseRoboflowResponse(body) {
  const fail = message => { throw new Error(`ROBOFLOW_RESPONSE_INVALID: ${message}`); };
  const { image, predictions } = body ?? {};
  if (!finite(image?.width, image?.height) || image.width <= 0 || image.height <= 0) fail('image size');
  if (!Array.isArray(predictions)) fail('predictions');
  return {
    imageWidth: image.width,
    imageHeight: image.height,
    predictions: predictions.map(p => {
      if (!finite(p?.x, p?.y, p?.width, p?.height, p?.confidence) || p.width <= 0 || p.height <= 0 || p.confidence < 0 || p.confidence > 1 || typeof p.class !== 'string' || !p.class) fail('prediction fields');
      return { className: p.class, score: p.confidence, x: p.x, y: p.y, width: p.width, height: p.height };
    }),
  };
}

export const mapSourceClass = name => (Object.hasOwn(SOURCE_TO_TARGET, name) ? SOURCE_TO_TARGET[name] : `${UNMAPPED}${name}`);

// Same shape MediaPipe gives, so one contract decides what may become a candidate for both.
export const toDetections = parsed => parsed.predictions.map(p => ({
  categories: [{ categoryName: mapSourceClass(p.className), score: p.score }],
  boundingBox: { originX: p.x - p.width / 2, originY: p.y - p.height / 2, width: p.width, height: p.height },
}));

export function interpretRoboflow(parsed, { scoreThreshold, maxCandidates = Infinity }) {
  const result = interpretDetections({ detections: toDetections(parsed), imageWidth: parsed.imageWidth, imageHeight: parsed.imageHeight, scoreThreshold, maxCandidates });
  return { ...result, candidates: result.candidates.map(c => ({ ...c, source: `roboflow:${ROBOFLOW_MODEL_ID}` })) };
}

// Other classes are kept for failure analysis only. They are never scored as the target.
export const otherClasses = parsed => parsed.predictions
  .filter(p => !Object.hasOwn(SOURCE_TO_TARGET, p.className))
  .map(p => ({ className: p.className, score: p.score, box: [(p.x - p.width / 2) / parsed.imageWidth, (p.y - p.height / 2) / parsed.imageHeight, p.width / parsed.imageWidth, p.height / parsed.imageHeight] }));
