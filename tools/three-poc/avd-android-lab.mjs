#!/usr/bin/env node
// P3-A5.1 AVD validation for the debug IONIQ 5 WebGL lab (Ioniq5LabActivity). Drives the installed DEBUG app
// with adb: cold launches per pixel-ratio condition, touch interactions (pick, zoom buttons, drag), pause and
// return, close/relaunch cycles with memory and renderer-process counts. Screenshots, logcat and results.json
// go to --out, which must be outside the repository (they show the third-party model).
//
//   node tools/three-poc/avd-android-lab.mjs --out=C:\CarScope-External\p3-a5-1\run1 [--serial=emulator-5554]
//        [--cold=3] [--cycles=5] [--sampleMs=10000] [--dprs=default,1,0.75,hide]
// Prerequisites: debug APK installed, lab assets built (build-android-lab.mjs), model pushed
// (push-android-lab-model.mjs). Touch points come from positions the page reports, mapped onto the window.
// logcat is streamed for the whole run: the AVD's ring buffer rotates the lab's lines out within seconds.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
if (!args.out) { console.error("usage: node tools/three-poc/avd-android-lab.mjs --out=<dir outside the repo>"); process.exit(2); }
const OUT = resolve(args.out);
{ const r = relative(REPO, OUT); if (r === "" || (!r.startsWith("..") && !isAbsolute(r))) throw new Error(`Refusing to write AVD captures inside the repo: ${OUT}`); }
mkdirSync(OUT, { recursive: true });
const SERIAL = args.serial ?? "emulator-5554";
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "adb";
const PKG = "io.carscope.app", ACT = `${PKG}/.lab.Ioniq5LabActivity`, TAG = "CarScopeIoniq5Lab";
const COLD = Number(args.cold ?? 3), CYCLES = Number(args.cycles ?? 5), SAMPLE_MS = Number(args.sampleMs ?? 10000);
// Conditions: "default" (page uses min(devicePixelRatio, 1.5)), a fixed pixel ratio, or "hide" (model loaded but not
// drawn: the frame ceiling of this WebView/AVD without the model's cost).
const DPRS = String(args.dprs ?? "default,1,0.75,hide").split(",");

const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const adbBin = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => { writeFileSync(join(OUT, `${name}.png`), adbBin("exec-out", "screencap", "-p")); return `${name}.png`; };

adb("logcat", "-c");
const logcat = spawn(ADB, ["-s", SERIAL, "logcat", "-v", "time", `${TAG}:*`, "chromium:E", "cr_*:E", "AndroidRuntime:E", "HOME_SCREEN:D", "*:S"]);
let logText = "", mark = 0;
logcat.stdout.on("data", (d) => { logText += d; });
const allLines = () => logText.split(/\r?\n/).filter(Boolean);
const labLines = () => allLines().filter((l) => l.includes(`/${TAG}(`));
// Lab lines since the last clear(); earlier phases stay in logText for logcat.txt.
const logLines = () => labLines().slice(mark);
const clear = () => { mark = labLines().length; };
const events = () => logLines().filter((l) => l.includes("CARSCOPE_LAB ")).map((l) => JSON.parse(l.slice(l.indexOf("CARSCOPE_LAB ") + 13)));
const lifecycle = () => logLines().filter((l) => l.includes("): lifecycle ")).map((l) => l.slice(l.indexOf("): lifecycle ") + 13).trim());
const errorLines = () => allLines().filter((l) => /^\S+ \S+ [EF]\//.test(l));

// pidof exits 1 once the process is gone (the Pleos home removes the task and the system kills the process).
const pidOf = () => { try { return adb("shell", "pidof", PKG).trim().split(/\s+/)[0] || null; } catch { return null; } };
const meminfo = (pid) => (pid ? adb("shell", "dumpsys", "meminfo", pid) : "");
const pss = (pid) => { const t = meminfo(pid); const m = /TOTAL PSS:\s+(\d+)/.exec(t) ?? /TOTAL\s+(\d+)/.exec(t); return m ? Number(m[1]) : null; };
const graphics = (pid) => { const t = meminfo(pid); if (!t) return null; const g = (k) => { const m = new RegExp(`${k}\\s+(\\d+)`).exec(t); return m ? Number(m[1]) : null; }; return { glMtrackKb: g("GL mtrack"), eglMtrackKb: g("EGL mtrack"), graphicsKb: g("Graphics:") }; };
const renderers = () => adb("shell", "ps", "-A", "-o", "PID,NAME").split("\n").filter((l) => /sandboxed_process/.test(l)).map((l) => l.trim());
async function until(test, ms, label) {
  const end = Date.now() + ms;
  for (;;) { const v = test(); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(400); }
}
const ev = (name) => () => events().find((e) => e.event === name);
// adb shell joins its arguments into one device-shell command: quote the query or "&" ends the command there.
const start = (query) => adb("shell", "am", "start", "-W", "-n", ACT, "--es", "query", `'${query}'`);
const totalTime = (out) => Number(/TotalTime: (\d+)/.exec(out)?.[1] ?? NaN);

function windowFrame() {
  const block = adb("shell", "dumpsys", "window", "windows").split(/Window #\d+/).find((b) => b.includes("Ioniq5LabActivity}"));
  const m = /frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(block ?? "");
  if (!m) throw new Error("lab window frame not found");
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return { x0, y0, x1, y1, at: (fx, fy) => [Math.round(x0 + (x1 - x0) * fx), Math.round(y0 + (y1 - y0) * fy)] };
}
const tap = ([x, y]) => adb("shell", "input", "tap", String(x), String(y));
const swipe = ([x0, y0], [x1, y1], ms = 600) => adb("shell", "input", "swipe", String(x0), String(y0), String(x1), String(y1), String(ms));
const key = (k) => adb("shell", "input", "keyevent", String(k));

const results = { startedAt: new Date().toISOString(), serial: SERIAL, sampleMs: SAMPLE_MS, cold: [], interaction: {}, platformBack: {}, pauseResume: {}, cycles: [], errors: [] };
results.device = {
  release: adb("shell", "getprop", "ro.build.version.release").trim(), sdk: adb("shell", "getprop", "ro.build.version.sdk").trim(),
  build: adb("shell", "getprop", "ro.build.version.incremental").trim(), display: adb("shell", "wm", "size").trim(), density: adb("shell", "wm", "density").trim(),
  webview: /Current WebView package \(name, version\): \(([^)]*)\)/.exec(adb("shell", "dumpsys", "webviewupdate"))?.[1] ?? "unknown", user: adb("shell", "am", "get-current-user").trim(),
};
console.log("device", JSON.stringify(results.device));

try {
  // 1. Cold launches per condition: load, first frame, frame sample while the car turns (autoRotate).
  for (const dpr of DPRS) {
    for (let i = 0; i < COLD; i++) {
      adb("shell", "am", "force-stop", PKG); await sleep(1500); clear();
      const q = `sampleMs=${SAMPLE_MS}${dpr === "default" ? "" : dpr === "hide" ? "&hide=1" : `&dpr=${dpr}`}`;
      const launchMs = totalTime(start(q));
      const sample = await until(ev("frame-sample"), SAMPLE_MS + 60000, `frame-sample ${dpr}`);
      const all = events(), webgl = all.find((e) => e.event === "webgl");
      // The query must actually reach the page: a fixed ratio shows up as the renderer's pixel ratio.
      if (dpr !== "default" && dpr !== "hide" && Math.abs(webgl.dpr - Number(dpr)) > 1e-6) throw new Error(`dpr ${dpr} not applied (page reports ${webgl.dpr})`);
      const row = { condition: dpr, run: i + 1, query: q, launchTotalTimeMs: launchMs, webgl, model: all.find((e) => e.event === "model-loaded"), firstFrame: all.find((e) => e.event === "first-frame"), sample, jsErrors: all.filter((e) => /error|lost/.test(e.event)), pssKb: pss(pidOf()) };
      if (i === 0) row.screenshot = shot(`cold-${dpr}`);
      results.cold.push(row);
      console.log(`cold ${dpr} #${i + 1}: canvas ${webgl.canvas} dpr ${webgl.dpr}, load ${row.model?.loadMs} ms, first frame ${row.firstFrame?.msFromStart} ms, ${sample.meanFps} fps (1% low ${sample.low1Fps}), ${sample.calls} calls, ${sample.triangles} tri`);
    }
  }

  // 2. Interactions on a fresh launch without auto-rotation: pick part, pick background, zoom buttons, drag.
  adb("shell", "am", "force-stop", PKG); await sleep(1500); clear();
  start("sample=0");
  const ff0 = await until(ev("first-frame"), 60000, "first-frame (interaction)");
  await sleep(1500);
  const w = windowFrame();
  // The page reports CSS-pixel centres of its controls and projected parts; screen = window origin + css * dpr.
  const T = ff0.targets, onScreen = (p) => [Math.round(w.x0 + p.x * T.devicePixelRatio), Math.round(w.y0 + p.y * T.devicePixelRatio)];
  Object.assign(results.interaction, { targets: T, window: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } });
  shot("interact-0-start");
  const afterTap = async (point, eventName, label) => { const n = events().length; tap(point); return await until(() => events().slice(n).find((e) => e.event === eventName), 8000, label); };
  results.interaction.pickHood = await afterTap(onScreen(T.hood), "pick", "pick hood");
  await sleep(600); shot("interact-1-pick-hood");
  results.interaction.pickWheel = await afterTap(onScreen(T.wheel), "pick", "pick wheel");
  await sleep(600); shot("interact-2-pick-wheel");
  results.interaction.pickBackground = await afterTap(w.at(0.12, 0.2), "pick", "pick background");
  results.interaction.zoomIn = [await afterTap(onScreen(T.zoomIn), "zoom", "zoom in"), await afterTap(onScreen(T.zoomIn), "zoom", "zoom in 2")];
  await sleep(600); shot("interact-3-zoomed-in");
  results.interaction.zoomOut = [await afterTap(onScreen(T.zoomOut), "zoom", "zoom out"), await afterTap(onScreen(T.zoomOut), "zoom", "zoom out 2")];
  {
    const n = events().length;
    swipe(w.at(0.35, 0.5), w.at(0.7, 0.45), 700);
    results.interaction.drag = await until(() => events().slice(n).find((e) => e.event === "orbit"), 8000, "orbit after drag");
    await sleep(1200); shot("interact-4-after-drag");
    const n2 = events().length;
    swipe(w.at(0.7, 0.45), w.at(0.3, 0.55), 700);
    results.interaction.drag2 = await until(() => events().slice(n2).find((e) => e.event === "orbit"), 8000, "orbit after drag 2");
    await sleep(1200); shot("interact-5-after-drag-2");
  }
  const I = results.interaction;
  I.checks = {
    pickHood: I.pickHood?.part === "Door_Front_0", pickWheel: /^Wheel_/.test(I.pickWheel?.part ?? ""), pickBackgroundNone: I.pickBackground?.part === null,
    zoomInCloser: I.zoomIn[1].distance < I.zoomIn[0].distance, zoomOutFarther: I.zoomOut[1].distance > I.zoomIn[1].distance,
    dragTurned: Math.abs(I.drag.azimuthDeg - I.drag2.azimuthDeg) > 5,
  };
  I.pass = Object.values(I.checks).every(Boolean);
  console.log("interaction", JSON.stringify({ checks: I.checks, hood: I.pickHood?.part, wheel: I.pickWheel?.part, zoom: [...I.zoomIn, ...I.zoomOut].map((z) => z.distance), drag: [I.drag.azimuthDeg, I.drag2.azimuthDeg] }));

  // Platform Back on the task root: recorded, not required (the Pleos home keeps the task).
  {
    const l = lifecycle().length;
    key(4); await sleep(2500);
    const lc = lifecycle().slice(l);
    results.platformBack = { lifecycle: lc, finished: lc.includes("destroy"), homeScreenLog: allLines().filter((x) => x.includes("onBackPressedOnTaskRoot")).slice(-2) };
    console.log("platform back", JSON.stringify({ finished: results.platformBack.finished, lifecycle: lc, home: results.platformBack.homeScreenLog.length }));
  }

  // 3. Pause and return without finishing: Settings opens in the same panel, then the lab is brought back.
  {
    const n = events().length, l = lifecycle().length;
    adb("shell", "am", "start", "-W", "-a", "android.settings.SETTINGS"); await sleep(3000);
    shot("pause-settings");
    start("sample=0"); await sleep(3000);
    const later = events().slice(n), lc = lifecycle().slice(l);
    const n3 = events().length; tap(onScreen(T.hood));
    const pickAfter = await until(() => events().slice(n3).find((e) => e.event === "pick"), 8000, "pick after resume");
    shot("pause-resumed");
    results.pauseResume = { lifecycle: lc, visibility: later.filter((e) => e.event === "visibility"), recreated: lc.some((s) => s.startsWith("create")), pickAfterResume: pickAfter };
    results.pauseResume.pass = lc.includes("pause finishing=false") && lc.includes("resume") && !results.pauseResume.recreated && Boolean(pickAfter?.part);
    console.log("pause/resume", JSON.stringify({ pass: results.pauseResume.pass, lifecycle: lc, recreated: results.pauseResume.recreated, pick: pickAfter?.part }));
  }

  // 4. Close and relaunch cycles: teardown log, process/renderer state after each close, then a fresh first frame.
  for (let i = 0; i < CYCLES; i++) {
    const l = lifecycle().length, n = events().length;
    // close button -> ./close -> finish(): onPause(finishing) -> JS dispose -> onDestroy -> WebView.destroy()
    tap(onScreen(T.close));
    await until(() => lifecycle().slice(l).includes("destroy"), 15000, `destroy #${i + 1}`);
    await sleep(3000);
    const pid = pidOf();
    const row = { cycle: i + 1, lifecycle: lifecycle().slice(l), disposed: events().slice(n).find((e) => e.event === "disposed") ?? null, contextReleased: events().slice(n).some((e) => e.event === "context-released"),
      afterClose: { pid, pssKb: pss(pid), graphics: graphics(pid), renderers: renderers() } };
    clear();
    start("sample=0");
    const ff = await until(ev("first-frame"), 60000, `first-frame relaunch #${i + 1}`);
    await sleep(2000);
    const pid2 = pidOf();
    row.relaunch = { firstFrameMs: ff.msFromStart, calls: ff.calls, triangles: ff.triangles, pid: pid2, pssKb: pss(pid2), graphics: graphics(pid2), renderers: renderers() };
    if (i === CYCLES - 1) row.screenshot = shot("cycle-last-relaunch");
    results.cycles.push(row);
    console.log(`cycle ${i + 1}: ${row.lifecycle.join(" > ")} | disposed=${Boolean(row.disposed)} released=${row.contextReleased} | after close pid=${pid} renderers=${row.afterClose.renderers.length} | relaunch first frame ${ff.msFromStart} ms, pss ${row.relaunch.pssKb} KB, renderers=${row.relaunch.renderers.length}`);
  }
  tap(onScreen(T.close)); await sleep(3000);
} finally {
  results.errors = errorLines();
  results.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT, "logcat.txt"), logText);
  logcat.kill();
  console.log(`results -> ${join(OUT, "results.json")}`);
}
