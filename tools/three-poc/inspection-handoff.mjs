// P3-A4: QR handoff target for the inspection UI (Node side: serve.mjs and tests only).
// The contract and its validation live in tools/mobile-ar-poc/public/handoff.mjs (QR-AR, PR #18):
// HTTPS root origin + `#v=1&task=washer-fluid`, a task hint only (no VIN, account, token or
// vehicle reading). This adapter only adds the "not configured" result and the loopback rule that
// the QR-AR staging build applies. The origin comes from CARSCOPE_QR_AR_BASE_URL at serve time.
import { HANDOFF, handoffURL, isLoopbackHost } from '../mobile-ar-poc/public/handoff.mjs';

export const HANDOFF_FRAGMENT = HANDOFF;

/** Validated handoff URL, or `{ configured: false, reason }` when the base is missing or unsafe. */
export function handoffTarget(base) {
  if (!base) return { configured: false, url: null, reason: 'CARSCOPE_QR_AR_BASE_URL not set' };
  let url;
  try { url = handoffURL(base); } catch (e) { return { configured: false, url: null, reason: e instanceof TypeError ? 'invalid URL' : e.message }; }
  if (isLoopbackHost(new URL(url).hostname)) return { configured: false, url: null, reason: 'loopback is not reachable from a phone' };
  return { configured: true, url, reason: null };
}
