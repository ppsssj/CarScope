#!/usr/bin/env node
// P2-A8 AVD runtime validation for the debug visual-profile screen. Drives the installed DEBUG app with
// adb, captures screenshots and the CarScopeProfile log, and writes results.json. All output (screens
// of the model-derived drawing included) goes to --out, which must be outside the repository.
//
//   node tools/ioniq5-asset/avd-validate.mjs --out=C:\CarScope-External\p2-a8\run [--serial=emulator-5554]
//        [--parts=C:\CarScope-External\ioniq5-svg\ioniq5.parts] [--repeat=20] [--cold=5] [--switches=10]
// Prerequisites: debug APK installed; the IONIQ 5 asset pushed with push-debug-asset.ps1 (or --parts).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
if (!args.out) { console.error("usage: node tools/ioniq5-asset/avd-validate.mjs --out=<dir outside the repo> [--serial=..] [--parts=..]"); process.exit(2); }
const OUT = resolve(args.out);
{ const r = relative(REPO, OUT); if (r === "" || (!r.startsWith("..") && !isAbsolute(r))) throw new Error(`Refusing to write AVD captures inside the repo: ${OUT}`); }
mkdirSync(OUT, { recursive: true });
const SERIAL = args.serial ?? "emulator-5554";
const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "adb";
const PKG = "io.carscope.app", ACT = `${PKG}/.profile.VisualProfileActivity`, IONIQ = "hyundai-ioniq5-2022", REF = "pleos-avd-reference";
const REPEAT = Number(args.repeat ?? 20), COLD = Number(args.cold ?? 5), SWITCHES = Number(args.switches ?? 10);

const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const adbBin = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const user = adb("shell", "am get-current-user").trim();
const runAs = (cmd) => adb("shell", `run-as ${PKG} --user ${user} ${cmd}`);
const shot = (name) => { writeFileSync(join(OUT, `${name}.png`), adbBin("exec-out", "screencap", "-p")); return `${name}.png`; };
const events = () => adb("logcat", "-d", "-s", "CarScopeProfile").split("\n").filter((l) => l.includes("{\"event\"")).map((l) => JSON.parse(l.slice(l.indexOf("{"))));
const clear = () => adb("logcat", "-c");
async function until(test, ms = 30000, label = "condition") {
  const end = Date.now() + ms;
  for (;;) { const v = test(); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(300); }
}
const start = (profile, extra = []) => adb("shell", "am", "start", "-W", "-n", ACT, "--es", "profile", profile, ...extra);
const totalTime = (out) => Number(/TotalTime: (\d+)/.exec(out)?.[1] ?? NaN);
function tapText(text) {
  // uiautomator sometimes exits non-zero after a successful dump: judge by the file, retry a few times.
  let xml = "";
  for (let attempt = 0; attempt < 3 && !xml.includes(`text="${text}"`); attempt++) {
    try { adb("shell", "uiautomator dump /data/local/tmp/carscope-ui.xml"); } catch { /* checked below */ }
    try { xml = adb("shell", "cat /data/local/tmp/carscope-ui.xml"); } catch { xml = ""; }
  }
  const node = [...xml.matchAll(/<node [^>]*>/g)].map((m) => m[0]).find((n) => n.includes(`text="${text}"`));
  if (!node) throw new Error(`button not found: ${text}`);
  const [, x0, y0, x1, y1] = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node).map(Number);
  adb("shell", "input", "tap", String((x0 + x1) >> 1), String((y0 + y1) >> 1));
}
// On AAOS the app runs as user ${user}; querying by package name reports the (absent) user-0 process, so use the PID.
const memory = () => {
  const pid = adb("shell", `pidof ${PKG}`).trim();
  const text = adb("shell", `dumpsys meminfo ${pid}`);
  const kb = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1]);
  return { pid, totalPssKb: kb("TOTAL PSS"), javaHeapKb: kb("Java Heap"), nativeHeapKb: kb("Native Heap") };
};
const q = (values) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); const at = (p) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; return s.length ? { n: s.length, p50: at(0.5), p95: at(0.95), max: s.at(-1) } : null; };

const results = { serial: SERIAL, user, build: adb("shell", "getprop ro.build.display.id").trim(), webview: adb("shell", "dumpsys webviewupdate").match(/Current WebView package \(name, version\): \(([^)]*)\)/)?.[1], profiles: {} };
if (args.parts) execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(REPO, "tools", "ioniq5-asset", "push-debug-asset.ps1"), "-Parts", resolve(args.parts), "-Serial", SERIAL], { stdio: "inherit" });

for (const profile of [REF, IONIQ]) {
  const r = (results.profiles[profile] = {});
  // Cold starts: process killed each time; createToVisible = activity creation to WebView visual-state callback.
  const cold = [];
  for (let i = 0; i < COLD; i++) {
    adb("shell", "am", "force-stop", PKG); clear();
    const t = totalTime(start(profile));
    const e = await until(() => events().find((x) => x.event === "visible"), 30000, `${profile} first visible`);
    const resolveEvent = events().find((x) => x.event === "resolve");
    cold.push({ amStartTotalMs: t, createToVisibleMs: e.createToVisibleMs, loadToVisibleMs: e.loadToVisibleMs, renderMs: e.renderMs, readParseMs: resolveEvent.readParseMs, outcome: resolveEvent.outcome, reason: resolveEvent.reason, sha256: resolveEvent.sha256 });
    await sleep(500);
  }
  r.cold = cold;
  r.coldStats = { amStartTotalMs: q(cold.map((c) => c.amStartTotalMs)), createToVisibleMs: q(cold.map((c) => c.createToVisibleMs)), firstLoadToVisibleMs: q(cold.map((c) => c.loadToVisibleMs)), firstRenderMs: q(cold.map((c) => c.renderMs)), readParseMs: q(cold.map((c) => c.readParseMs)) };
  // Warm repaints of the same SVG and off-thread render/parse benchmark.
  clear();
  start(profile, ["--ei", "repaint", String(REPEAT)]);
  await until(() => events().filter((x) => x.event === "visible").length >= REPEAT + 1, 120000, `${profile} repaints`);
  const vis = events().filter((x) => x.event === "visible");
  r.repaintLoadToVisibleMs = q(vis.slice(1).map((v) => v.loadToVisibleMs));
  await sleep(2000); clear();
  start(profile, ["--ei", "bench", "50"]); // same activity (singleTop): benchmark alone, no repaint loop
  r.bench = await until(() => events().find((x) => x.event === "bench"), 180000, `${profile} bench`);
  await sleep(1500);
  r.memory = memory();
  // States on screen (mock scenarios; STALE after > 5 s without a new reading).
  r.screens = {};
  tapText("모의: 모두 닫힘"); await sleep(1500); r.screens.closed = shot(`${profile}-closed`);
  tapText("모의: 앞 왼쪽 열림"); await sleep(1500); r.screens.open = shot(`${profile}-open`);
  tapText("모의: 조회 불가"); await sleep(1500); r.screens.unavailable = shot(`${profile}-unavailable`);
  tapText("모의: 모두 닫힘"); await sleep(6500); r.screens.stale = shot(`${profile}-stale`);
}

// Profile switching on the running activity (singleTop -> onNewIntent): previous drawing replaced.
adb("shell", "am", "force-stop", PKG); clear(); start(IONIQ); await until(() => events().some((x) => x.event === "visible"));
const switches = [];
for (let i = 0; i < SWITCHES; i++) {
  const to = i % 2 ? IONIQ : REF;
  clear(); start(to);
  const e = await until(() => events().find((x) => x.event === "visible" && x.switchToVisibleMs !== undefined), 20000, "switch");
  switches.push({ to, switchToVisibleMs: e.switchToVisibleMs, drawnProfile: e.profile });
  await sleep(400);
}
results.switching = { runs: switches, wrongProfile: switches.filter((s) => s.drawnProfile !== s.to).length, ...Object.fromEntries([REF, IONIQ].map((p) => [p, q(switches.filter((s) => s.to === p).map((s) => s.switchToVisibleMs))])) };

// Activity recreation by a configuration change (night mode toggle), IONIQ profile kept by the intent.
const recreate = [];
for (let i = 0; i < 4; i++) {
  clear(); adb("shell", "cmd", "uimode", "night", i % 2 ? "no" : "yes");
  const e = await until(() => events().find((x) => x.event === "visible" && x.createToVisibleMs !== undefined), 20000, "recreate");
  recreate.push({ createToVisibleMs: e.createToVisibleMs, profile: e.profile });
  await sleep(800);
}
adb("shell", "cmd", "uimode", "night", "no");
results.recreate = { runs: recreate, stats: q(recreate.map((x) => x.createToVisibleMs)), allIoniq: recreate.every((x) => x.profile === IONIQ) };
await sleep(800); results.recreateScreen = shot("ioniq-after-recreate");

// Screen density change (zoom): drawing scales with the viewBox.
clear(); adb("shell", "wm", "density", "120");
results.densityVisible = await until(() => events().find((x) => x.event === "visible" && x.createToVisibleMs !== undefined), 20000, "density recreate");
await sleep(1000); results.densityScreen = shot("ioniq-density-120");
clear(); adb("shell", "wm", "density", "reset");
await until(() => events().find((x) => x.event === "visible" && x.createToVisibleMs !== undefined), 20000, "density reset");

// Invalid asset: replaced in place, must fall back to the reference with ASSET_INVALID, then restored.
const good = `files/debug-visual-assets/${IONIQ}.parts`;
runAs(`cp ${good} ${good}.bak`);
adb("shell", `echo '#carscope-anatomy-car 1' | run-as ${PKG} --user ${user} sh -c 'cat > ${good}'`);
adb("shell", "am", "force-stop", PKG); clear(); start(IONIQ);
results.invalidAsset = await until(() => events().find((x) => x.event === "resolve"), 20000, "invalid resolve");
await until(() => events().some((x) => x.event === "visible" && x.createToVisibleMs !== undefined), 30000, "invalid visible"); await sleep(2500);
results.invalidScreen = shot("ioniq-invalid-fallback");
runAs(`mv ${good}.bak ${good}`);
adb("shell", "am", "force-stop", PKG); clear(); start(IONIQ);
results.restoredAsset = await until(() => events().find((x) => x.event === "resolve"), 20000, "restored resolve");

const crashes = adb("logcat", "-d", "-b", "crash");
results.crashLog = crashes.includes(PKG) ? crashes : "";
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ cold: Object.fromEntries(Object.entries(results.profiles).map(([p, r]) => [p, r.coldStats.createToVisibleMs])), switching: results.switching, recreate: results.recreate.stats, invalid: results.invalidAsset.reason, restored: results.restoredAsset.outcome, crash: Boolean(results.crashLog) }, null, 1));
