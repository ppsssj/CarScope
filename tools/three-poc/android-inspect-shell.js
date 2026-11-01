// P3-A5.2: Android host shell for the P3-A4 inspection page (inspect.html + inspect.js, unchanged UX).
// Loaded after inspect.js in the debug WebView only. Adds what the Pleos AVD needs and nothing else:
//  - close control (Back on a task root is consumed by the Pleos home) that releases GL first, then asks the
//    activity to finish through ./close (no JS bridge);
//  - zoom buttons (no wheel/pinch on the AVD);
//  - JSON event lines `CARSCOPE_INSPECT {...}` for logcat: flow transitions, on-screen targets for automation,
//    frame statistics per state, blocked external links, errors.
const I = () => window.__inspect;
const T0 = performance.now();
const report = (event, data = {}) => console.log(`CARSCOPE_INSPECT ${JSON.stringify({ event, t: Math.round(performance.now() - T0), ...data })}`);
addEventListener("error", (e) => report("js-error", { message: String(e.message), source: e.filename, line: e.lineno }));
addEventListener("unhandledrejection", (e) => report("js-error", { message: String(e.reason?.message ?? e.reason) }));

// ---------- Android controls ----------
const style = document.createElement("style");
style.textContent = `
  #androidClose{margin-left:12px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:14px}
  #androidZoom{position:fixed;left:18px;bottom:44px;display:flex;flex-direction:column;gap:8px;z-index:6}
  #androidZoom button{width:52px;height:52px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-size:26px}
  body[data-state="HOOD_OPENING"] #androidZoom,body[data-state="HOOD_CLOSING"] #androidZoom{opacity:.35;pointer-events:none}`;
document.head.appendChild(style);
const close = Object.assign(document.createElement("button"), { type: "button", id: "androidClose", textContent: "✕ 닫기" });
close.setAttribute("aria-label", "화면 닫기");
document.querySelector(".topbar").appendChild(close);
const zoomBox = document.createElement("div");
zoomBox.id = "androidZoom";
zoomBox.innerHTML = '<button type="button" id="androidZoomIn" aria-label="확대">+</button><button type="button" id="androidZoomOut" aria-label="축소">−</button>';
document.body.appendChild(zoomBox);
document.getElementById("androidZoomIn").addEventListener("click", () => I()?.zoom(0.8));
document.getElementById("androidZoomOut").addEventListener("click", () => I()?.zoom(1.25));

let closed = false;
function closeScreen(reason) {
  if (closed) return;
  closed = true;
  report("close-requested", { reason });
  // Release GL synchronously: the Pleos home removes the task within a few hundred ms of finish().
  const d = I()?.dispose(reason);
  report("disposed", d ?? { reason, skipped: true });
  location.href = "./close";
}
close.addEventListener("click", () => closeScreen("close-button"));
window.__androidShell = { closeScreen };

// External pages (manual PDF, the phone handoff link) must not open inside this WebView; the QR is the handoff.
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href]");
  if (!a) return;
  const url = new URL(a.getAttribute("href"), location.href);
  if (url.origin === location.origin) return;
  e.preventDefault();
  report("external-link-blocked", { href: url.href, id: a.id || null });
}, true);

// ---------- frame statistics per flow state ----------
let frames = [], lastFrame = 0, segStart = performance.now();
function frameLoop(now) {
  if (closed) return;
  if (lastFrame) frames.push(now - lastFrame);
  lastFrame = now;
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
function frameStats() {
  const d = frames; frames = [];
  const ms = Math.round(performance.now() - segStart); segStart = performance.now();
  if (!d.length) return { ms, frames: 0 };
  const s = [...d].sort((a, b) => a - b), at = (p) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
  return { ms, frames: d.length, meanFps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), medianMs: +at(0.5).toFixed(1), p95Ms: +at(0.95).toFixed(1), maxMs: +s.at(-1).toFixed(1) };
}

// ---------- screen targets for automation (CSS px; screen = window origin + css * devicePixelRatio) ----------
function rect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden]")) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
}
const pt = (p) => (p && p.inFront ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
function targets() {
  const q = (s) => rect(document.querySelector(s));
  const api = I();
  return {
    devicePixelRatio, viewport: [innerWidth, innerHeight],
    start: q("#start"), back: q("#back"), close: q("#androidClose"), zoomIn: q("#androidZoomIn"), zoomOut: q("#androidZoomOut"),
    areaHood: q('[data-action="area"][data-id="hood"]'), componentWasher: q('[data-action="component"][data-id="washer-fluid-cap"]'),
    handoff: q('[data-action="handoff"]'), panelBack: q('#panel [data-action="back"]'), exit: q('#panel [data-action="exit"]'),
    capLabel: q("#capButton"), qr: q(".qr img"), handoffLink: document.getElementById("handoffLink")?.getAttribute("href") ?? null,
    hood: api && window.__inspectReady ? pt(api.hoodPoint()) : null, cap: api && window.__inspectReady && api.state.name !== "IDLE" ? pt(api.capPoint()) : null,
    planned: [...document.querySelectorAll('#panel .item[aria-disabled="true"]')].length,
  };
}

// ---------- poll the page's own log and state ----------
let seen = 0, lastState = null, settledReported = null, readyReported = false;
setInterval(() => {
  if (closed) return;
  const log = window.__inspectLog ?? [];
  for (; seen < log.length; seen++) {
    const e = log[seen];
    if (e.tag === "transition") report("transition", { from: e.from, to: e.to, by: e.event, frameStats: frameStats() });
    else if (e.tag === "ignored") report("ignored", { state: e.state, by: e.event });
    else if (e.tag === "load-error") { report("model-error", { message: e.message }); const s = document.getElementById("status"); if (s) s.textContent = "차량 모델을 불러올 수 없습니다. 디버그 저장 공간에 IONIQ 5 GLB를 넣은 뒤 다시 여세요."; }
    else report(e.tag, e);
  }
  const api = I();
  if (!api) return;
  if (window.__inspectReady && !readyReported) {
    readyReported = true;
    const gl = document.querySelector("#view canvas")?.getContext("webgl2"), dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    report("ready", { msFromStart: Math.round(performance.now() - T0), webgl: gl ? gl.getParameter(gl.VERSION) : null, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, ...api.renderInfo, handoff: api.handoff, targets: targets() });
  }
  const name = api.state.name;
  if (name !== lastState) { lastState = name; settledReported = null; }
  // Once a state has settled (no hood/camera tween), publish where its controls are.
  if (readyReported && !api.busy && settledReported !== name) {
    settledReported = name;
    report("settled", { state: name, hoodAngle: +api.hoodAngle.toFixed(2), view: api.view(), ...api.renderInfo, targets: targets() });
  }
}, 200);
document.addEventListener("visibilitychange", () => report("visibility", { hidden: document.hidden }));
// After a touch gesture on the 3D view, publish the camera view so a drag (orbit) can be verified from logcat.
document.getElementById("view").addEventListener("pointerup", () => setTimeout(() => { const api = I(); if (api && !closed) report("view", { state: api.state.name, ...api.view() }); }, 350));
report("shell-ready");
