// P9-XR-C: files of the experimental WebXR guide. Deliberately separate from MOBILE_MODULES, the allow-list behind
// local, staging and same-origin sync hosting: a host serves these, and marks its page, only when it was told to.
// Reads no environment, because the Render import closure reaches this file through mobile-page.mjs.
const JS = 'text/javascript; charset=utf-8';
export const WEBXR_GUIDE_FILES = Object.freeze([
  ['webxr-guide.mjs', 'public/webxr/webxr-guide.mjs', JS],
  ['webxr.css', 'public/webxr/webxr.css', 'text/css; charset=utf-8'],
  ['webxr-state.mjs', 'public/webxr/webxr-state.mjs', JS],
  ['webxr-capability.mjs', 'public/webxr/webxr-capability.mjs', JS],
  ['webxr-controller.mjs', 'public/webxr/webxr-controller.mjs', JS],
  ['webxr-view.mjs', 'public/webxr/webxr-view.mjs', JS],
  ['three.module.min.js', 'node_modules/three/build/three.module.min.js', JS],
].map(Object.freeze));
export const WEBXR_PERMISSION = ', xr-spatial-tracking=(self)';

const BODY_OFF = '<body data-step="intro">', BODY_ON = '<body data-step="intro" data-webxr-guide="enabled">';
/** The page learns about the experiment only from its own host. No URL, storage or client switch can turn it on. */
export function markWebXrGuidePage(html) {
  if (!html.includes(BODY_OFF)) throw new Error('WEBXR_GUIDE_PAGE_MARKER_MISSING');
  return html.replace(BODY_OFF, BODY_ON);
}
