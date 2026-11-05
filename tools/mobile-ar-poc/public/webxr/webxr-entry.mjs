// P9-XR-B entry. Isolated page: no sync client, no storage, no network calls and no inspection record.
// It only reads the existing washer task text and links back to the existing checklist page.
import { createWebXrController } from './webxr-controller.mjs';
import { probeWebXr } from './webxr-capability.mjs';
import { createWebXrView } from './webxr-view.mjs';
import { canPlace, inSession, noticeText, reasonText, statusCopy } from './webxr-state.mjs';
import { CHECK_ITEMS } from '../self-inspection.mjs';
import { WASHER_TASK } from '../inspection-tasks.mjs';

const $ = id => document.getElementById(id);
const CHECKLIST_URL = '/#v=1&task=washer-fluid';
const SUPPORT = { true: '지원', false: '미지원' };

$('washer-position').textContent = WASHER_TASK.position;
for (const item of CHECK_ITEMS) {
  const li = document.createElement('li');
  li.textContent = item.label;
  $('check-items').append(li);
}

let THREE = null;
const controller = createWebXrController({
  xr: navigator.xr,
  overlayRoot: $('xr-overlay'),
  createView: () => createWebXrView(THREE),
  onState: render,
});

function setSupport(capability) {
  $('support-ar').textContent = SUPPORT[capability.immersiveAr];
  $('support-hit').textContent = SUPPORT[capability.hitTest];
  $('support-anchor').textContent = capability.anchors ? '지원' : '미지원 (표면 좌표로만 표시)';
}

function render(state) {
  const active = inSession(state) || state.phase === 'STARTING';
  document.body.classList.toggle('in-xr', active);
  document.body.dataset.phase = state.phase;
  $('xr-overlay').hidden = !active;
  $('page').hidden = active;
  if (state.capability) setSupport(state.capability);

  const stopped = state.phase === 'UNSUPPORTED' || state.phase === 'FAILED';
  $('start-ar').hidden = !['READY', 'ENDED', 'FAILED'].includes(state.phase);
  $('start-ar').textContent = state.phase === 'READY' ? 'AR 시작' : 'AR 다시 시작';
  $('checking').hidden = state.phase !== 'CHECKING';
  $('fallback').hidden = !stopped;
  $('fallback-reason').textContent = stopped ? reasonText(state.reason) : '';
  $('ended').hidden = state.phase !== 'ENDED';

  const status = statusCopy(state);
  $('xr-status').textContent = status.title;
  $('xr-status').dataset.tone = status.tone;
  $('xr-hint').textContent = status.hint;
  const notice = noticeText(state.notice);
  $('xr-notice').textContent = notice ?? '';
  $('xr-notice').hidden = !notice;

  const hasMarker = state.phase === 'PLACED' || state.phase === 'REPOSITIONING';
  $('xr-place').disabled = !canPlace(state);
  $('xr-place').hidden = state.phase === 'PLACED';
  $('xr-reposition').hidden = state.phase !== 'PLACED';
  $('xr-cancel-reposition').hidden = state.phase !== 'REPOSITIONING';
  $('xr-remove').hidden = !hasMarker;
}

// Taps on the controls must not also place a marker in the scene behind them.
$('xr-controls').addEventListener('beforexrselect', event => event.preventDefault());
$('start-ar').addEventListener('click', () => { controller.start(); });
$('xr-place').addEventListener('click', () => controller.requestPlace());
$('xr-reposition').addEventListener('click', () => controller.reposition());
$('xr-cancel-reposition').addEventListener('click', () => controller.cancelReposition());
$('xr-remove').addEventListener('click', () => controller.remove());
$('xr-exit').addEventListener('click', () => controller.stop());
$('xr-return').addEventListener('click', async () => {
  await Promise.race([controller.stop(), new Promise(resolve => setTimeout(resolve, 1500))]);
  location.assign(CHECKLIST_URL);
});
addEventListener('pagehide', () => { controller.dispose(); });
addEventListener('pageshow', event => { if (event.persisted) location.reload(); }); // The disposed controller cannot be reused.

window.__webXrPoc = Object.freeze({ get state() { return controller.state; } });

render(controller.state);
const capability = await probeWebXr({
  xr: navigator.xr, secureContext: globalThis.isSecureContext,
  XRSession: globalThis.XRSession, XRFrame: globalThis.XRFrame, XRHitTestResult: globalThis.XRHitTestResult,
});
if (capability.canStart) {
  // Loaded before the tap: an import inside the click handler could use up the gesture requestSession needs.
  try {
    THREE = await import('./three.module.min.js');
    controller.probed(capability);
  } catch {
    controller.probed({ ...capability, canStart: false, reason: 'ASSET_LOAD_FAILED' });
  }
} else {
  controller.probed(capability);
}
