// P12-B: the only file that touches MediaPipe. CPU by default: a GPU figure must come from a real phone, not a headless desktop.
import { FilesetResolver, ObjectDetector } from '/vendor/vision_bundle.mjs';

export async function createDetector({ scoreThreshold, maxResults, delegate = 'CPU' }) {
  const vision = await FilesetResolver.forVisionTasks('/vendor/wasm');
  const detector = await ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: '/model.tflite', delegate }, runningMode: 'IMAGE', scoreThreshold, maxResults });
  return { detect: image => detector.detect(image).detections, close: () => detector.close() };
}
