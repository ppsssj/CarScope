// P9-XR-B: files of the isolated WebXR PoC. Deliberately separate from MOBILE_MODULES, the allow-list behind
// local, staging and same-origin sync hosting, so the default product hosts never serve this page.
const JS = 'text/javascript; charset=utf-8';
export const WEBXR_POC_FILES = Object.freeze([
  ['webxr/index.html', 'public/webxr/index.html', 'text/html; charset=utf-8'],
  ['webxr/webxr.css', 'public/webxr/webxr.css', 'text/css; charset=utf-8'],
  ['webxr/webxr-entry.mjs', 'public/webxr/webxr-entry.mjs', JS],
  ['webxr/webxr-state.mjs', 'public/webxr/webxr-state.mjs', JS],
  ['webxr/webxr-capability.mjs', 'public/webxr/webxr-capability.mjs', JS],
  ['webxr/webxr-controller.mjs', 'public/webxr/webxr-controller.mjs', JS],
  ['webxr/webxr-view.mjs', 'public/webxr/webxr-view.mjs', JS],
  ['webxr/three.module.min.js', 'node_modules/three/build/three.module.min.js', JS],
].map(Object.freeze));
export const webxrPocEnabled = (env, argv = []) => env.POC_WEBXR_POC === '1' || argv.includes('--webxr-poc');
