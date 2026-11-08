// P12-E: POST /v1/part-detections/:partId, a thin relay. No model and no weights run in this process: `provider` calls a hosted API.
// One JPEG in memory per request, dropped when the request ends. Never written, logged or echoed. The API key lives inside the provider.
// Order matters: everything that can refuse does so before the body is read or anything is sent out.
import { candidatesFor, DETECTION_CONSENT, DETECTION_COORDINATES, DETECTION_MODEL_ID, offersDetection, PART_DETECTION } from '../../mobile-ar-poc/public/part-detection.mjs';
import { ERRORS } from './protocol.mjs';
import { SyncError } from './sessions.mjs';

export const DETECTION_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxSide: 2048, minSide: 64, timeoutMs: 10_000, maxInFlight: 2 });
const CODE = Object.freeze({ CONSENT: 'CONSENT_REQUIRED', UNSUPPORTED: 'PART_DETECTION_UNSUPPORTED', UNAVAILABLE: 'PART_DETECTION_UNAVAILABLE', IMAGE: 'IMAGE_INVALID', BUSY: ERRORS.RATE_LIMITED });

/** Width and height from a JPEG's frame header, or null. The bytes must really be a JPEG with sensible dimensions. */
export function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

export async function readImage(req, maxBytes) {
  if (!/^image\/jpeg$/i.test((req.headers['content-type'] ?? '').trim())) throw new SyncError(ERRORS.UNSUPPORTED_MEDIA_TYPE, 415);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new SyncError(ERRORS.PAYLOAD_TOO_LARGE, 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new SyncError(ERRORS.PAYLOAD_TOO_LARGE, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function withTimeout(work, ms) {
  let timer;
  return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]).finally(() => clearTimeout(timer));
}

export function createPartDetectionRoute({ provider, limits = DETECTION_LIMITS, clock = () => new Date() }) {
  if (typeof provider?.detect !== 'function') throw new Error('PART_DETECTION_PROVIDER_REQUIRED');
  let inFlight = 0;
  return async function handle({ req, partId, token, service, limiter }) {
    if (req.headers['x-carscope-external-processing'] !== DETECTION_CONSENT) throw new SyncError(CODE.CONSENT, 428);
    const entry = Object.hasOwn(PART_DETECTION, partId) ? PART_DETECTION[partId] : null;
    if (!offersDetection(entry)) throw new SyncError(CODE.UNSUPPORTED, 404);
    // The existing phone credential of this inspection: unknown tokens fail here, as they do for its other requests.
    const scope = await service.detectionScope(token);
    if (scope.taskId !== entry.taskId) throw new SyncError(ERRORS.FORBIDDEN, 403);
    if (scope.sessionState !== 'CLAIMED') throw new SyncError(ERRORS.INVALID_STATE, 409);
    const session = await limiter.check(token, 'detect-session');
    if (!session.ok) throw new SyncError(ERRORS.RATE_LIMITED, 429);
    if (inFlight >= limits.maxInFlight) throw new SyncError(CODE.BUSY, 429);
    inFlight++;
    const abort = new AbortController(), stop = () => abort.abort();
    req.socket?.once('close', stop);
    try {
      const image = await readImage(req, limits.maxBytes);
      const size = jpegSize(image);
      if (!size || size.width < limits.minSide || size.height < limits.minSide || size.width > limits.maxSide || size.height > limits.maxSide) throw new SyncError(CODE.IMAGE, 422);
      let parsed;
      // An upstream message could quote the request or the key, so no part of a failure leaves here.
      try { parsed = await withTimeout(provider.detect({ image }, { signal: abort.signal }), limits.timeoutMs); } catch { throw new SyncError(CODE.UNAVAILABLE, 503); }
      let candidates;
      try {
        candidates = candidatesFor(entry.partId, parsed);
        // The boxes are fractions of the size the model reports. A different shape means they do not describe this picture.
        if (Math.abs(parsed.imageWidth / parsed.imageHeight - size.width / size.height) > 0.02) throw new Error('DETECTION_SIZE_MISMATCH');
      } catch { throw new SyncError(CODE.UNAVAILABLE, 503); }
      // P12-F: one record a later step can track from: which model, which class, when, on what picture, and how to read the boxes.
      const detection = { modelId: DETECTION_MODEL_ID, modelClass: entry.modelClass, coordinates: DETECTION_COORDINATES, image: { width: size.width, height: size.height }, inferredAt: clock().toISOString() };
      return { partId: entry.partId, status: entry.status, candidates, detection };
    } finally { abort.abort(); req.socket?.off('close', stop); inFlight--; }
  };
}

/**
 * Wires in the hosted client and response parser of tools/vision-poc, passed in by an entrypoint. Today only tools/vision-poc/scripts/part-detection-local.mjs does.
 * Nothing here calls the network by itself, and the key stays in this closure.
 */
export function hostedDetectionProvider({ inferImage, parseResponse, apiKey, modelId = DETECTION_MODEL_ID, timeoutMs = DETECTION_LIMITS.timeoutMs }) {
  if (typeof inferImage !== 'function' || typeof parseResponse !== 'function' || !apiKey) throw new Error('PART_DETECTION_PROVIDER_CONFIG');
  return Object.freeze({
    async detect({ image }, { signal } = {}) {
      const answer = await inferImage({ modelId, apiKey, image, timeoutMs, signal });
      if (answer?.status !== 'OK') throw new Error('PROVIDER_REFUSED');
      return parseResponse(answer.body);
    },
  });
}
