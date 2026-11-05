// P9-XR-C: experimental 3D location guide, run inside the existing washer inspection document.
// Staying in the document is what keeps the checklist and the QR v2 credentials: they live in this page's memory and
// nothing here navigates, stores, sends or receives them. The guide only ever hands the page a user's choice.
import { createWebXrController } from './webxr-controller.mjs';
import { probeWebXr } from './webxr-capability.mjs';
import { createWebXrView } from './webxr-view.mjs';
import { canPlace, inSession, noticeText, reasonText, statusCopy } from './webxr-state.mjs';

const SUPPORT = { true: '지원', false: '미지원' };
const PANEL_ACTIONS = new Set(['UNSUPPORTED', 'ENDED', 'FAILED']);

const GUIDE_HTML = `<div id="xr-guide-page">
  <header class="bar"><div class="bar-row"><p class="brand">CarScope <span>3D AR 위치 안내 · 실험</span></p></div></header>
  <main>
    <h1 id="xr-guide-title" tabindex="-1">워셔액 주입구에 3D 표시 남기기</h1>
    <p>주입구를 직접 찾아 3D 화살표를 남겨 두면, 휴대폰을 움직여도 표시가 실제 공간의 그 자리에 머물도록 시도합니다.</p>
    <p class="notice"><strong>부품을 인식하지 않습니다.</strong> AI가 위치를 찾아 주는 기능이 아니며 위치는 직접 지정합니다. 표시 위치의 오차를 측정하지 않았습니다. 이 안내는 점검 결과를 바꾸거나 전송하지 않으며, 진행 중인 점검은 그대로 유지됩니다.</p>
    <p id="xr-checking" role="status">3D 표시 모듈을 불러오는 중…</p>
    <button id="xr-start" type="button" class="primary xr-start" hidden>AR 시작</button>
    <section id="xr-fallback" class="card warn" hidden aria-labelledby="xr-fallback-title">
      <h2 id="xr-fallback-title">3D AR을 사용할 수 없습니다</h2>
      <p id="xr-fallback-reason" role="alert"></p>
      <p>2D 카메라 안내나 체크리스트로 점검을 계속할 수 있습니다.</p>
    </section>
    <section id="xr-ended" class="card" hidden aria-labelledby="xr-ended-title">
      <h2 id="xr-ended-title">3D AR을 종료했습니다</h2>
      <p>세션이 끝나면 3D 표시는 사라집니다. 저장되지 않으므로 다시 시작하면 위치를 새로 지정해야 합니다. 다음 방법을 직접 선택하세요.</p>
    </section>
    <div id="xr-choices" class="xr-choices" hidden>
      <button id="xr-to-checklist" type="button">체크리스트로</button>
      <button id="xr-to-camera" type="button">2D 카메라로</button>
    </div>
    <button id="xr-leave" type="button" class="link-button">이전 점검 화면으로 돌아가기</button>
    <dl class="xr-support" aria-label="이 기기의 지원 상태">
      <div><dt>카메라 AR</dt><dd id="xr-support-ar">확인 중</dd></div>
      <div><dt>표면 찾기 (Hit Test)</dt><dd id="xr-support-hit">확인 중</dd></div>
      <div><dt>공간 앵커 (Anchor)</dt><dd id="xr-support-anchor">확인 중</dd></div>
    </dl>
    <p class="fine">브라우저가 제공하는 기능 기준입니다. 세션을 시작할 때 기기가 거부할 수 있습니다.</p>
    <h2>시작 전에</h2>
    <ul class="tight">
      <li>안전한 곳에 정차하고 차량 전원을 끈 뒤, 차량 설명서에 따라 보닛을 여세요.</li>
      <li>움직이는 부품, 뜨거운 부품, 주황색 고전압 케이블에 손대지 마세요.</li>
      <li>휴대폰을 펼친 상태로 사용하세요. 카메라 영상은 AR 추적에만 쓰이며 이 화면이 저장·업로드하지 않습니다.</li>
    </ul>
    <h2>워셔액 주입구 찾기</h2>
    <p id="xr-position"></p>
    <details>
      <summary>표시한 뒤 직접 확인할 항목</summary>
      <ol id="xr-check-items" class="tight"></ol>
      <p class="fine">3D 표시를 남겨도 이 항목이 확인된 것으로 기록되지 않습니다. 체크리스트에서 직접 확인하고 표시하세요.</p>
    </details>
  </main>
</div>
<div id="xr-overlay" hidden>
  <div class="xr-top"><p id="xr-status" role="status" aria-live="polite" data-tone="muted"></p></div>
  <div id="xr-controls" class="xr-panel">
    <p id="xr-hint"></p>
    <p id="xr-notice" role="alert" hidden></p>
    <div class="xr-actions">
      <button id="xr-place" type="button" class="primary" disabled>여기에 표시</button>
      <button id="xr-reposition" type="button" hidden>위치 다시 지정</button>
      <button id="xr-cancel-reposition" type="button" hidden>다시 지정 취소</button>
      <button id="xr-remove" type="button" hidden>표시 제거</button>
    </div>
    <div class="xr-actions">
      <button id="xr-return" type="button">체크리스트로</button>
      <button id="xr-exit" type="button">AR 종료</button>
    </div>
  </div>
</div>`;

const ENTRY_HTML = `<button id="xr-entry-open" type="button" hidden>3D AR로 위치 찾기 · 실험</button>
<p id="xr-entry-help" class="fine" hidden>2D 표시는 공간에 고정되지 않지만, 이 실험 기능은 직접 지정한 위치에 3D 화살표가 머물도록 시도합니다. AI가 부품을 찾아 주지 않으며 점검 결과에 기록되지 않습니다.</p>
<p id="xr-entry-unavailable" class="fine" role="status" hidden></p>`;

/**
 * @param o.task      { position, items }, read only.
 * @param o.canOffer  () => whether this step may offer the guide. Decided by the page, never by the guide.
 * @param o.anchorFor () => the element the entry sits in front of on the current step.
 * @param o.onOpen    Must release the 2D camera before returning; it runs before any XR request can exist.
 * @param o.onClose   Runs once the guide is closed. Must not start a camera: the user picks one explicitly.
 * @param o.onChecklist, o.onCamera  The user's explicit choice after onClose.
 */
export async function mountWebXrGuide({ task, canOffer, anchorFor, onOpen, onClose, onChecklist, onCamera }) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./webxr.css', import.meta.url).href;
  document.head.append(stylesheet);

  const entry = document.createElement('div');
  entry.id = 'xr-entry';
  entry.innerHTML = ENTRY_HTML;
  const root = document.createElement('section');
  root.id = 'xr-guide';
  root.hidden = true;
  root.setAttribute('aria-label', '3D AR 위치 안내');
  root.innerHTML = GUIDE_HTML;
  document.body.append(root);
  const $ = id => root.querySelector(`#${id}`) ?? entry.querySelector(`#${id}`);

  $('xr-position').textContent = task.position;
  for (const item of task.items) {
    const li = document.createElement('li');
    li.textContent = item.label;
    $('xr-check-items').append(li);
  }

  let capability = null, controller = null, threeLoad = null, ignoredPops = 0, returnScroll = 0;
  const loadThree = () => (threeLoad ??= import('./three.module.min.js').catch(error => { threeLoad = null; throw error; }));
  let three = null;

  function refresh() {
    const offer = canOffer();
    entry.hidden = !offer;
    if (!offer) return;
    const anchor = anchorFor();
    if (anchor && entry.nextElementSibling !== anchor) anchor.before(entry);
    const available = capability?.canStart === true;
    $('xr-entry-open').hidden = !available;
    $('xr-entry-help').hidden = !available;
    // Unavailable: the page's own 2D and manual methods are all that is offered, so one quiet line on the first step.
    const unavailable = Boolean(capability) && !available && anchor?.id === 'manual-start';
    $('xr-entry-unavailable').hidden = !unavailable;
    $('xr-entry-unavailable').textContent = unavailable ? `3D AR 위치 안내를 쓸 수 없습니다. ${reasonText(capability.reason)} 2D 카메라나 카메라 없는 점검을 사용하세요.` : '';
  }

  function render(state) {
    const active = inSession(state) || state.phase === 'STARTING';
    document.body.classList.toggle('in-xr', active);
    root.dataset.phase = state.phase;
    $('xr-overlay').hidden = !active;
    $('xr-guide-page').hidden = active;

    if (state.capability) {
      $('xr-support-ar').textContent = SUPPORT[state.capability.immersiveAr];
      $('xr-support-hit').textContent = SUPPORT[state.capability.hitTest];
      $('xr-support-anchor').textContent = state.capability.anchors ? '지원' : '미지원 (표면 좌표로만 표시)';
    }
    const stopped = state.phase === 'UNSUPPORTED' || state.phase === 'FAILED';
    $('xr-start').hidden = !['READY', 'ENDED', 'FAILED'].includes(state.phase);
    $('xr-start').textContent = state.phase === 'READY' ? 'AR 시작' : 'AR 다시 시작';
    $('xr-checking').hidden = state.phase !== 'CHECKING';
    $('xr-fallback').hidden = !stopped;
    $('xr-fallback-reason').textContent = stopped ? reasonText(state.reason) : '';
    $('xr-ended').hidden = state.phase !== 'ENDED';
    $('xr-choices').hidden = !PANEL_ACTIONS.has(state.phase);

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

  function open() {
    if (controller || capability?.canStart !== true || !canOffer()) return;
    onOpen();
    // Back closes the guide rather than leaving the page, which would discard a QR v2 connection for good.
    // Same URL by construction: the QR fragment was removed before this page ever ran.
    // Scrolling stays manual, or returning through history would undo the page's own scroll to the checklist's top.
    returnScroll = scrollY;
    history.scrollRestoration = 'manual';
    history.pushState({ carscopeWebXrGuide: true }, '');
    root.hidden = false;
    document.body.classList.add('xr-guide-open');
    const current = createWebXrController({
      xr: navigator.xr,
      overlayRoot: $('xr-overlay'),
      createView: () => createWebXrView(three),
      onState: state => { if (controller === current) render(state); },
    });
    controller = current;
    render(current.state);
    scrollTo(0, 0);
    $('xr-guide-title').focus({ preventScroll: true });
    // Loaded before the AR tap: an import inside the click handler could use up the gesture requestSession needs.
    loadThree().then(module => {
      three = module;
      if (controller === current) current.probed(capability);
    }, () => {
      if (controller === current) current.probed({ ...capability, canStart: false, reason: 'ASSET_LOAD_FAILED' });
    });
  }

  function close(choice, { keepHistory = false } = {}) {
    if (!controller) return;
    const closing = controller;
    controller = null;
    void closing.dispose(); // Ends a live session, and any session still being requested when it arrives.
    root.hidden = true;
    delete root.dataset.phase;
    document.body.classList.remove('xr-guide-open', 'in-xr');
    if (!keepHistory) { ignoredPops++; history.back(); }
    onClose();
    if (choice === 'checklist') onChecklist();
    else if (choice === 'camera') onCamera();
    else { $('xr-entry-open').focus({ preventScroll: true }); scrollTo(0, returnScroll); }
    refresh();
  }

  // Taps on the controls must not also place a marker in the scene behind them.
  $('xr-controls').addEventListener('beforexrselect', event => event.preventDefault());
  $('xr-entry-open').addEventListener('click', open);
  $('xr-start').addEventListener('click', () => { void controller?.start(); });
  $('xr-leave').addEventListener('click', () => close(null));
  $('xr-to-checklist').addEventListener('click', () => close('checklist'));
  $('xr-to-camera').addEventListener('click', () => close('camera'));
  $('xr-place').addEventListener('click', () => controller?.requestPlace());
  $('xr-reposition').addEventListener('click', () => controller?.reposition());
  $('xr-cancel-reposition').addEventListener('click', () => controller?.cancelReposition());
  $('xr-remove').addEventListener('click', () => controller?.remove());
  $('xr-return').addEventListener('click', () => close('checklist'));
  $('xr-exit').addEventListener('click', () => {
    if (controller?.state.phase === 'STARTING') close(null); // No session to end yet, so this is a cancel.
    else void controller?.stop();
  });
  addEventListener('popstate', () => {
    if (ignoredPops > 0) { ignoredPops--; return; }
    close(null, { keepHistory: true });
  });
  addEventListener('pagehide', () => close(null, { keepHistory: true }));

  // Test hook, read only, as the page's own __selfInspection. It exposes no controller and no credentials.
  window.__webXrGuide = Object.freeze({
    get open() { return Boolean(controller); },
    get state() { return controller?.state ?? null; },
    get capability() { return capability; },
  });

  refresh();
  capability = await probeWebXr({
    xr: navigator.xr, secureContext: globalThis.isSecureContext,
    XRSession: globalThis.XRSession, XRFrame: globalThis.XRFrame, XRHitTestResult: globalThis.XRHitTestResult,
  });
  refresh();
  return { refresh };
}
