// Shared allow-list for the loopback dev server and the HTTPS same-origin service.
import { access, readFile } from 'node:fs/promises';
import {MOBILE_ASSETS,MOBILE_MODULES as mobileFiles,MOBILE_PAGES} from '../../mobile-ar-poc/public-modules.mjs';
import {WEBXR_GUIDE_FILES, WEBXR_PERMISSION, markWebXrGuidePage} from '../../mobile-ar-poc/webxr-modules.mjs';
import {PART_DETECTION_FILES, markPartDetectionPage} from '../../mobile-ar-poc/part-detection-modules.mjs';
// Experimental guide, off unless an entry passes webxrGuide. On Render only render-webxr-experiment.mjs does: see WEBXR_EXPERIMENT_ENTRY_ONLY.
const guideFiles = new Map(WEBXR_GUIDE_FILES.map(([name, source, type]) => [`/mobile-ar-poc/public/webxr/${name}`, [new URL(`../../mobile-ar-poc/${source}`, import.meta.url), type]]));
/** A deployment with the guide on but three.js not installed would offer a button that can only fail, so it does not start. */
export async function assertWebXrGuideFiles() {
  try { await Promise.all([...guideFiles.values()].map(([source]) => access(source))); } catch { throw new Error('WEBXR_GUIDE_ASSET_MISSING'); }
}
const detectionFiles = new Map(PART_DETECTION_FILES.map((name) => [`/mobile-ar-poc/public/${name}`, new URL(`../../mobile-ar-poc/public/${name}`, import.meta.url)]));
const syncFiles = ['mobile-dev-entry.mjs', 'mobile-handoff.mjs', 'mobile-sync.mjs', 'sync-client.mjs'];
const files = new Map([
  ...[...mobileFiles,...MOBILE_ASSETS,...MOBILE_PAGES].map((s) => [`/mobile-ar-poc/public/${s}`, new URL(`../../mobile-ar-poc/public/${s}`, import.meta.url)]),
  ...syncFiles.map((s) => [`/public/${s}`, new URL(`../public/${s}`, import.meta.url)]),
  ['/src/protocol.mjs', new URL('./protocol.mjs', import.meta.url)],
  ['/style.css', new URL('../../mobile-ar-poc/public/style.css', import.meta.url)],
  ['/favicon.svg', new URL('../../mobile-ar-poc/public/favicon.svg', import.meta.url)],
]);
export const MOBILE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
});
export async function serveMobilePage(req, res, { tls = false, webxrGuide = false, partDetection = false } = {}) {
  const headers = { ...MOBILE_HEADERS, ...(tls ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    ...(webxrGuide ? { 'Permissions-Policy': MOBILE_HEADERS['Permissions-Policy'] + WEBXR_PERMISSION } : {}) };
  const url = new URL(req.url, 'http://localhost');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
  if (url.search) { res.writeHead(400, headers); res.end(); return; }
  let body, type = 'text/javascript; charset=utf-8';
  if (url.pathname === '/') {
    body = (await readFile(new URL('../../mobile-ar-poc/public/index.html', import.meta.url), 'utf8')).replace('src="/app-entry.mjs"', 'src="/public/mobile-dev-entry.mjs"');
    if (webxrGuide) body = markWebXrGuidePage(body);
    if (partDetection) body = markPartDetectionPage(body);
    type = 'text/html; charset=utf-8';
  } else if (url.pathname === '/handoff.json') { body = '{"configured":false,"url":null}'; type = 'application/json'; }
  else if (webxrGuide && guideFiles.has(url.pathname)) {
    const [source, mime] = guideFiles.get(url.pathname);
    body = await readFile(source); type = mime;
  }
  else if (partDetection && detectionFiles.has(url.pathname)) body = await readFile(detectionFiles.get(url.pathname));
  else if (files.has(url.pathname)) {
    body = await readFile(files.get(url.pathname));
    if (url.pathname.endsWith('.css')) type = 'text/css; charset=utf-8';
    if (url.pathname.endsWith('.svg')) type = 'image/svg+xml';
    if (url.pathname.endsWith('.html')) type = 'text/html; charset=utf-8';
  } else { res.writeHead(404, headers); res.end(); return; }
  res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : body);
}
