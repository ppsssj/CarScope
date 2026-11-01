#!/usr/bin/env node
// P3-A5.2 AVD validation of the debug inspection screen (InspectionActivity): the P3-A4 flow driven with real touch
// input. Taps come from screen positions the page reports (android-inspect-shell.js `settled` events), mapped onto
// the activity window. Screenshots, logcat and results.json go to --out, outside the repository (they show the
// third-party model). logcat is streamed for the whole run; every adb call has a timeout (the AVD can stall).
//
//   node tools/three-poc/avd-android-inspection.mjs --out=C:\CarScope-External\p3-a5-2\run1 [--serial=emulator-5554]
//        [--cycles=3] [--expectQr=https://<origin>/#v=1&task=washer-fluid]
// Prerequisites: debug APK with build-android-inspection.mjs assets installed; model pushed (push-android-lab-model.mjs).
// QR decoding uses pngjs + jsqr from tools/mobile-ar-poc/node_modules (npm ci there).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
if (!args.out) { console.error("usage: node tools/three-poc/avd-android-inspection.mjs --out=<dir outside the repo>"); process.exit(2); }
const OUT = resolve(args.out);
{ const r = relative(REPO, OUT); if (r === "" || (!r.startsWith("..") && !isAbsolute(r))) throw new Error(`Refusing to write AVD captures inside the repo: ${OUT}`); }
mkdirSync(OUT, { recursive: true });
const SERIAL = args.serial ?? "emulator-5554";
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "adb";
const PKG = "io.carscope.app", ACT = `${PKG}/.lab.InspectionActivity`, TAG = "CarScopeInspection";
const CYCLES = Number(args.cycles ?? 3), EXPECT_QR = args.expectQr ?? null;
const req = createRequire(join(REPO, "tools", "mobile-ar-poc", "package.json"));

const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 90000 });
const adbBin = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { maxBuffer: 64 << 20, timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = {};
const shot = (name) => { const png = adbBin("exec-out", "screencap", "-p"); writeFileSync(join(OUT, `${name}.png`), png); shots[name] = png; return `${name}.png`; };
const load = () => { try { return adb("shell", "cat", "/proc/loadavg").trim().split(" ").slice(0, 3).map(Number); } catch { return null; } };

adb("logcat", "-c");
const logcat = spawn(ADB, ["-s", SERIAL, "logcat", "-v", "time", `${TAG}:*`, "chromium:E", "AndroidRuntime:E", "HOME_SCREEN:D", "*:S"]);
let logText = "", mark = 0;
logcat.stdout.on("data", (d) => { logText += d; });
const allLines = () => logText.split(/\r?\n/).filter(Boolean);
const tagLines = () => allLines().filter((l) => l.includes(`/${TAG}(`));
const lines = () => tagLines().slice(mark);
const clear = () => { mark = tagLines().length; };
const events = () => lines().filter((l) => l.includes("CARSCOPE_INSPECT ")).map((l) => JSON.parse(l.slice(l.indexOf("CARSCOPE_INSPECT ") + 17)));
const lifecycle = () => lines().filter((l) => l.includes("): lifecycle ")).map((l) => l.slice(l.indexOf("): lifecycle ") + 13).trim());
async function until(test, ms, label) {
  const end = Date.now() + ms;
  for (;;) { const v = test(); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(400); }
}
const since = (n, pred) => () => events().slice(n).find(pred);
const settled = (n, state, ms = 60000) => until(since(n, (e) => e.event === "settled" && e.state === state), ms, `settled ${state}`);
const start = () => adb("shell", "am", "start", "-n", ACT);
const pidOf = () => { try { return adb("shell", "pidof", PKG).trim().split(/\s+/)[0] || null; } catch { return null; } };
const renderers = () => adb("shell", "ps", "-A", "-o", "NAME").split("\n").filter((l) => /sandboxed_process/.test(l)).length;

function windowFrame() {
  const block = adb("shell", "dumpsys", "window", "windows").split(/Window #\d+/).find((b) => b.includes("InspectionActivity}"));
  const m = /frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(block ?? "");
  if (!m) throw new Error("inspection window frame not found");
  return m.slice(1).map(Number);
}
let W = null, DPR = 1;
const screen = (p) => { if (!p) throw new Error("target not on screen"); return [Math.round(W[0] + p.x * DPR), Math.round(W[1] + p.y * DPR)]; };
const tap = (p) => adb("shell", "input", "tap", ...screen(p).map(String));
const swipe = (a, b, ms = 700) => adb("shell", "input", "swipe", ...screen(a).map(String), ...screen(b).map(String), String(ms));

/** Decode the QR from a screenshot region (CSS rect of the QR image, mapped to screen pixels). */
function decodeQr(png, r) {
  const { PNG } = req("pngjs"), jsQR = req("jsqr");
  const img = PNG.sync.read(png), pad = 12;
  const x0 = Math.max(0, Math.round(W[0] + (r.x - r.w / 2) * DPR) - pad), y0 = Math.max(0, Math.round(W[1] + (r.y - r.h / 2) * DPR) - pad);
  const w = Math.min(img.width - x0, Math.round(r.w * DPR) + 2 * pad), h = Math.min(img.height - y0, Math.round(r.h * DPR) + 2 * pad);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return jsQR(data, w, h)?.data ?? null;
}

const results = { startedAt: new Date().toISOString(), serial: SERIAL, loadAvgStart: load(), checks: {}, steps: [], cycles: [], errors: [] };
const check = (name, ok, data = {}) => { results.checks[name] = { pass: Boolean(ok), ...data }; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(data).slice(0, 240)}`); };
results.device = {
  release: adb("shell", "getprop", "ro.build.version.release").trim(), build: adb("shell", "getprop", "ro.build.version.incremental").trim(),
  webview: /Current WebView package \(name, version\): \(([^)]*)\)/.exec(adb("shell", "dumpsys", "webviewupdate"))?.[1] ?? "unknown",
};
console.log("device", JSON.stringify(results.device), "load", results.loadAvgStart);

try {
  // 1. Home
  adb("shell", "am", "force-stop", PKG); await sleep(1500); clear();
  const t0 = Date.now(); start();
  const ready = await until(since(0, (e) => e.event === "ready"), 180000, "ready");
  let s = await settled(0, "IDLE");
  results.readyMs = Date.now() - t0; results.ready = ready;
  W = windowFrame(); DPR = s.targets.devicePixelRatio;
  check("home-ready", ready.calls > 0 && ready.webgl, { msFromStart: ready.msFromStart, calls: ready.calls, triangles: ready.triangles, handoff: ready.handoff?.configured, window: W, dpr: DPR });
  await sleep(1500); shot("01-home");

  // 2. Orbit (drag) and zoom buttons on the home view
  let n = events().length;
  const v0 = s.view;
  swipe({ x: s.targets.viewport[0] * 0.3, y: s.targets.viewport[1] * 0.45 }, { x: s.targets.viewport[0] * 0.6, y: s.targets.viewport[1] * 0.4 });
  const v1 = await until(since(n, (e) => e.event === "view"), 20000, "view after drag");
  check("orbit-drag", Math.abs(v1.azimuthDeg - v0.azimuthDeg) > 5, { before: v0.azimuthDeg, after: v1.azimuthDeg });
  await sleep(1200); shot("02-home-orbit");
  n = events().length;
  tap(s.targets.zoomIn); await until(since(n, (e) => e.event === "zoom"), 15000, "zoom in");
  n = events().length; tap(s.targets.zoomIn); const zin = await until(since(n, (e) => e.event === "zoom"), 15000, "zoom in 2");
  await sleep(1000); shot("03-home-zoom-in");
  n = events().length; tap(s.targets.zoomOut); await until(since(n, (e) => e.event === "zoom"), 15000, "zoom out");
  n = events().length; tap(s.targets.zoomOut); const zout = await until(since(n, (e) => e.event === "zoom"), 15000, "zoom out 2");
  check("zoom-buttons", zin.distance < v1.distance && zout.distance > zin.distance, { home: v1.distance, zoomedIn: zin.distance, zoomedOut: zout.distance });

  // 3. 차량 점검 -> overview (hood highlighted)
  n = events().length; tap(s.targets.start);
  s = await settled(n, "INSPECTION_OVERVIEW");
  check("overview", s.hoodAngle === 0 && s.targets.areaHood && s.targets.hood, { hood: s.targets.hood });
  await sleep(1500); shot("04-overview-hood-highlight");

  // 4. Hood pick on the 3D model, double tap: exactly one transition; then cancel mid-animation with the header back
  n = events().length;
  tap(s.targets.hood); tap(s.targets.hood);
  await until(since(n, (e) => e.event === "transition" && e.to === "HOOD_OPENING"), 20000, "hood opening");
  await sleep(500);
  const opening = events().slice(n).filter((e) => e.event === "transition" && e.to === "HOOD_OPENING").length;
  check("hood-pick-once", opening === 1, { openingTransitions: opening });
  shot("05-hood-opening");
  const backTarget = s.targets.back;
  n = events().length; tap(backTarget);
  await until(since(n, (e) => e.event === "transition" && e.to === "HOOD_CLOSING"), 20000, "cancel -> closing");
  s = await settled(n, "INSPECTION_OVERVIEW");
  check("cancel-mid-animation", s.hoodAngle === 0, { hoodAngle: s.hoodAngle });

  // 5. Open through the panel button: camera to the bay, hood 60 deg, washer cap highlighted
  n = events().length; tap(s.targets.areaHood);
  s = await settled(n, "COMPONENT_SELECTION", 90000);
  const tr = events().slice(n).find((e) => e.event === "transition" && e.from === "HOOD_OPENING");
  check("hood-open", s.hoodAngle === 60 && s.targets.cap && s.targets.planned === 5, { hoodAngle: s.hoodAngle, plannedItems: s.targets.planned, openingFrameStats: tr?.frameStats });
  await sleep(1500); shot("06-hood-open-components");

  // 6. Washer cap pick -> detail panel
  n = events().length; tap(s.targets.cap);
  s = await settled(n, "WASHER_SELECTED");
  check("washer-selected", Boolean(s.targets.handoff), { cap: s.targets.cap });
  await sleep(1500); shot("07-washer-detail");

  // 7. QR: screen shows a QR that decodes to the handoff contract; the direct link is blocked inside the WebView
  n = events().length; tap(s.targets.handoff);
  s = await settled(n, "MOBILE_HANDOFF_READY");
  await sleep(2500);
  const png = adbBin("exec-out", "screencap", "-p"); writeFileSync(join(OUT, "08-qr.png"), png);
  const decoded = s.targets.qr ? decodeQr(png, s.targets.qr) : null;
  const okQr = decoded && /^https:\/\/[^/]+\/#v=1&task=washer-fluid$/.test(decoded) && (!EXPECT_QR || decoded === EXPECT_QR) && decoded === s.targets.handoffLink;
  check("qr-contract", okQr, { decoded, link: s.targets.handoffLink });
  results.handoffLinkTarget = s.targets.handoffLink;

  // 8. Back step by step, then 점검 종료 from the overview
  n = events().length; tap(s.targets.panelBack); s = await settled(n, "WASHER_SELECTED");
  n = events().length; tap(s.targets.back); s = await settled(n, "COMPONENT_SELECTION");
  n = events().length; tap(s.targets.back); s = await settled(n, "INSPECTION_OVERVIEW", 90000);
  check("back-steps", s.hoodAngle === 0, { hoodAngle: s.hoodAngle });
  n = events().length; tap(s.targets.exit); s = await settled(n, "IDLE");
  check("exit-from-overview", s.hoodAngle === 0);
  // Exit from deep in the flow closes the hood and returns home
  n = events().length; tap(s.targets.start); s = await settled(n, "INSPECTION_OVERVIEW");
  n = events().length; tap(s.targets.areaHood); s = await settled(n, "COMPONENT_SELECTION", 90000);
  n = events().length; tap(s.targets.componentWasher); s = await settled(n, "WASHER_SELECTED");
  n = events().length; tap(s.targets.panelBack); s = await settled(n, "COMPONENT_SELECTION");
  n = events().length; tap(s.targets.exit); s = await settled(n, "IDLE", 90000);
  check("exit-from-components", s.hoodAngle === 0, { hoodAngle: s.hoodAngle });
  await sleep(1000); shot("09-home-after-exit");

  // 9. Pause and return (Settings in the same panel, then the screen again): state and rendering kept
  {
    const l = lifecycle().length; n = events().length;
    adb("shell", "am", "start", "-a", "android.settings.SETTINGS"); await sleep(5000);
    start(); await sleep(5000);
    const lc = lifecycle().slice(l);
    n = events().length; tap(s.targets.start); const s2 = await settled(n, "INSPECTION_OVERVIEW");
    check("pause-resume", lc.includes("pause finishing=false") && lc.includes("resume") && !lc.some((x) => x.startsWith("create")), { lifecycle: lc });
    n = events().length; tap(s2.targets.exit); s = await settled(n, "IDLE");
  }

  // 10. Close and relaunch: GL released before finish, process/renderers gone, fresh first frame
  for (let i = 0; i < CYCLES; i++) {
    const l = lifecycle().length; n = events().length;
    tap(s.targets.close);
    await until(() => lifecycle().slice(l).includes("destroy"), 30000, `destroy #${i + 1}`);
    await sleep(3000);
    const row = { cycle: i + 1, lifecycle: lifecycle().slice(l), disposed: events().slice(n).find((e) => e.event === "disposed") ?? null, pidAfterClose: pidOf(), renderersAfterClose: renderers() };
    clear(); const t1 = Date.now(); start();
    const r = await until(since(0, (e) => e.event === "ready"), 180000, `ready relaunch #${i + 1}`);
    s = await settled(0, "IDLE");
    row.relaunch = { readyMs: Date.now() - t1, msFromStart: r.msFromStart, calls: r.calls, renderers: renderers() };
    results.cycles.push(row);
    console.log(`cycle ${i + 1}: ${row.lifecycle.join(" > ")} | disposed=${Boolean(row.disposed && !row.disposed.skipped)} | pid after close ${row.pidAfterClose} renderers ${row.renderersAfterClose} | relaunch ready ${row.relaunch.msFromStart} ms`);
  }
  check("close-relaunch", results.cycles.every((c) => c.disposed && !c.disposed.skipped && c.pidAfterClose === null && c.renderersAfterClose === 0 && c.relaunch.calls > 0), { cycles: results.cycles.length });

  // 11. System-initiated recreation (configuration change)
  {
    const l = lifecycle().length; n = events().length;
    adb("shell", "cmd", "uimode", "night", "yes");
    await until(since(n, (e) => e.event === "ready"), 180000, "ready after recreate");
    const n2 = events().length;
    adb("shell", "cmd", "uimode", "night", "no");
    await until(since(n2, (e) => e.event === "ready"), 180000, "ready after recreate 2");
    const lc = lifecycle().slice(l);
    check("config-recreate", lc.filter((x) => x === "destroy").length >= 2 && lc.filter((x) => x.startsWith("create")).length >= 2, { lifecycle: lc });
    await sleep(2000); shot("10-after-recreate");
  }
} catch (e) {
  results.fatal = String(e?.message ?? e);
  console.error("FATAL", results.fatal);
  try { shot("zz-at-failure"); } catch {}
} finally {
  results.loadAvgEnd = load();
  results.jsErrors = allLines().filter((l) => /"event":"(js-error|model-error)"/.test(l));
  results.errors = allLines().filter((l) => /^\S+ \S+ [EF]\//.test(l));
  results.events = tagLines().filter((l) => l.includes("CARSCOPE_INSPECT ")).map((l) => JSON.parse(l.slice(l.indexOf("CARSCOPE_INSPECT ") + 17)));
  results.pass = !results.fatal && Object.values(results.checks).every((c) => c.pass);
  results.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT, "logcat.txt"), logText);
  logcat.kill();
  console.log(`${results.pass ? "PASS" : "NOT PASS"} -> ${join(OUT, "results.json")}`);
}
