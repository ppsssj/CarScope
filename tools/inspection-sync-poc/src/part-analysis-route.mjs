// P13-A: POST /v1/part-analyses/:partId, a thin relay from the phone to a vision provider. Same shape and order as P12-E's detection relay:
// everything that can refuse does so before the body is read or anything is sent out. One cropped JPEG in memory per request, never
// written, logged or echoed. The provider's answer is checked against the result contract; anything else is refused, never repaired.
import { ANALYSIS_CONSENT, ANALYSIS_SERVICES, analysisProfile, buildAnalysisPrompt, offersAnalysis, REGION_SOURCE, regionAllowed, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { PART_DETECTION } from '../../mobile-ar-poc/public/part-detection.mjs';
import { ERRORS } from './protocol.mjs';
import { SyncError } from './sessions.mjs';
import { jpegSize, readImage, withTimeout } from './part-detection-route.mjs';

export const ANALYSIS_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxSide: 2048, minSide: 64, timeoutMs: 45_000, maxInFlight: 2 });
export const ANALYSIS_CODES = Object.freeze({ CONSENT: 'CONSENT_REQUIRED', UNSUPPORTED: 'PART_ANALYSIS_UNSUPPORTED', UNAVAILABLE: 'PART_ANALYSIS_UNAVAILABLE', INVALID: 'PART_ANALYSIS_INVALID_RESPONSE', IMAGE: 'IMAGE_INVALID', IN_PROGRESS: 'PART_ANALYSIS_IN_PROGRESS' });

/**
 * The provider interface (VehicleVisionProvider). Any service, the same input and the same checked output:
 *   { id: keyof ANALYSIS_SERVICES, model: string, analyzePart(input, { signal }): Promise<unknown> }
 *   input = { partId, image: Buffer (JPEG), imageSize: { width, height }, targetInCrop, regionSource, instructions, userText, schema, promptVersion }
 * The returned value is untrusted: the route validates it. A provider keeps its own key and never puts it in an error.
 */
export function assertVisionProvider(provider) {
  if (typeof provider?.analyzePart !== 'function' || !Object.hasOwn(ANALYSIS_SERVICES, provider.id) || typeof provider.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(provider.model)) throw new Error('PART_ANALYSIS_PROVIDER_REQUIRED');
  return provider;
}

/** "l,t,w,h" fractions with at most 6 decimals, a positive area, inside the image. */
export function parseTargetBox(header) {
  if (typeof header !== 'string' || !/^(0(\.\d{1,6})?|1(\.0{1,6})?)(,(0(\.\d{1,6})?|1(\.0{1,6})?)){3}$/.test(header)) return null;
  const box = header.split(',').map(Number);
  const [l, t, w, h] = box;
  return w > 0 && h > 0 && l + w <= 1 + 1e-6 && t + h <= 1 + 1e-6 ? box : null;
}

/**
 * allowDraft (P13-G): DRAFT profiles (never evaluated on real photos) are refused unless the host's operator approved them. Decided here,
 * by the host's own configuration: nothing a page sends, and no client capability state, can turn it on.
 */
export function createPartAnalysisRoute({ provider, limits = ANALYSIS_LIMITS, clock = () => new Date(), manualOnly = false, admission = null, allowDraft = false }) {
  if (typeof allowDraft !== 'boolean') throw new Error('PART_ANALYSIS_DRAFT_FLAG_INVALID');
  assertVisionProvider(provider);
  let inFlight = 0;
  const busy = new Set(); // phone credentials with an analysis under way: one at a time each
  return async function handle({ req, partId, token, service, limiter }) {
    if (req.headers['x-carscope-external-processing'] !== ANALYSIS_CONSENT) throw new SyncError(ANALYSIS_CODES.CONSENT, 428);
    if (!offersAnalysis(partId, { allowDraft })) throw new SyncError(ANALYSIS_CODES.UNSUPPORTED, 404);
    const targetInCrop = parseTargetBox(req.headers['x-carscope-target-box']);
    const regionSource = req.headers['x-carscope-region-source'];
    if (!targetInCrop || !Object.values(REGION_SOURCE).includes(regionSource)) throw new SyncError(ERRORS.BAD_REQUEST, 400);
    // P13-D: a part the detector does not support can only have been marked by the person. An AI_CANDIDATE claim for it is refused.
    if (!regionAllowed(partId, regionSource, { allowDraft }) || manualOnly && regionSource !== REGION_SOURCE.MANUAL) throw new SyncError(ERRORS.BAD_REQUEST, 400);
    const scope = await service.detectionScope(token);
    if (scope.taskId !== analysisTask(partId)) throw new SyncError(ERRORS.FORBIDDEN, 403);
    if (scope.sessionState !== 'CLAIMED') throw new SyncError(ERRORS.INVALID_STATE, 409);
    if (busy.has(token)) throw new SyncError(ANALYSIS_CODES.IN_PROGRESS, 409);
    const session = await limiter.check(token, 'analyze-session');
    if (!session.ok) throw new SyncError(ERRORS.RATE_LIMITED, 429);
    if (inFlight >= limits.maxInFlight) throw new SyncError(ERRORS.RATE_LIMITED, 429);
    inFlight++; busy.add(token);
    // A phone that cancels or leaves drops its connection. The provider is told, so an unneeded call can stop.
    const abort = new AbortController(), stop = () => abort.abort();
    let lease;
    req.socket?.once('close', stop);
    try {
      lease = await admission?.acquire(token);
      const image = await readImage(req, limits.maxBytes);
      const size = jpegSize(image);
      if (!size || size.width < limits.minSide || size.height < limits.minSide || size.width > limits.maxSide || size.height > limits.maxSide) throw new SyncError(ANALYSIS_CODES.IMAGE, 422);
      const prompt = buildAnalysisPrompt(partId, { targetInCrop, regionSource });
      const current = await service.detectionScope(token);
      if (current.taskId !== scope.taskId || current.sessionState !== 'CLAIMED' || abort.signal.aborted) throw new SyncError(ERRORS.INVALID_STATE, 409);
      let raw;
      // An upstream message could quote the request or the key, so no part of a failure leaves here.
      try { raw = await withTimeout(Promise.resolve(provider.analyzePart({ partId, image, imageSize: size, targetInCrop, regionSource, ...prompt }, { signal: abort.signal })), limits.timeoutMs); }
      catch (error) { if (error?.code === 'VISION_BUDGET_EXHAUSTED') throw new SyncError('VISION_BUDGET_EXHAUSTED', 429); throw new SyncError(ANALYSIS_CODES.UNAVAILABLE, 503); }
      const checked = validateAnalysisResult(partId, raw);
      if (!checked.ok) throw new SyncError(ANALYSIS_CODES.INVALID, 502);
      return {
        partId, profileStatus: analysisProfile(partId).status, result: checked.result,
        analysis: { provider: provider.id, model: provider.model, promptVersion: prompt.promptVersion, regionSource, targetInCrop, image: size, analyzedAt: clock().toISOString() },
      };
    } finally {
      abort.abort(); // Also stop a provider when the route's deadline wins.
      await lease?.release().catch(() => {}); // A DB outage leaves the bounded lease to expire; never logs a token.
      inFlight--; busy.delete(token);
      req.socket?.off('close', stop);
    }
  };
}

// The analysis belongs to the same inspection as the part. The detection table holds that mapping already.
const analysisTask = partId => (Object.hasOwn(PART_DETECTION, partId) ? PART_DETECTION[partId].taskId : null);
