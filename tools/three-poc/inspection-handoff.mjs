// P3-A4: QR handoff target for the mobile washer-fluid assist. Same contract as the QR-AR PoC
// (tools/mobile-ar-poc/public/handoff.mjs, PR #18): HTTPS root origin + `#v=1&task=washer-fluid`.
// The fragment is a task hint only: no VIN, account, token or live vehicle reading.
// The origin comes from CARSCOPE_QR_AR_BASE_URL at serve time; nothing is hard-coded here.

export const HANDOFF_FRAGMENT = '#v=1&task=washer-fluid';

/** Validated handoff URL, or `{ configured: false, reason }` when the base is missing or unsafe. */
export function handoffTarget(base) {
  if (!base) return { configured: false, url: null, reason: 'CARSCOPE_QR_AR_BASE_URL not set' };
  let url;
  try { url = new URL(base); } catch { return { configured: false, url: null, reason: 'invalid URL' }; }
  if (url.protocol !== 'https:') return { configured: false, url: null, reason: 'HTTPS origin required' };
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return { configured: false, url: null, reason: 'root origin only: no credentials, path, query or fragment' };
  if (/^(localhost|127\.|\[::1\])/.test(url.hostname)) return { configured: false, url: null, reason: 'loopback is not reachable from a phone' };
  url.hash = HANDOFF_FRAGMENT;
  return { configured: true, url: url.href, reason: null };
}
