// P3-A2.1 front compartment shell check and captures. Start the server first (paths outside the repo):
//   $env:CARSCOPE_IONIQ5_GLB = '<converted .glb>'; $env:CARSCOPE_P3A1_DIR = '<P3-A1 report dir>'
//   $env:CARSCOPE_P3A21_DIR = '<front-compartment-report.mjs --out dir>'; node tools/three-poc/serve.mjs
//   node tools/three-poc/check-ioniq5-shell.mjs <outDir outside the repo> [url]
// Asserts: 0-degree hood identity, hood rotation unchanged with the shell shown (browser pivot == Node
// rotation), no new hood crossings with the shell for axes A and C at the sample angles. Captures the
// required views, shell on/off frame timing, toggle cost, SVG paint timing and a WebM.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
if (!process.argv[2]) { console.error("usage: node tools/three-poc/check-ioniq5-shell.mjs <outDir outside the repo> [url]"); process.exit(2); }
const out = resolve(process.argv[2]);
const rel = relative(repo, out);
if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`Refusing to write model-derived captures inside the repo: ${out}`);
mkdirSync(out, { recursive: true });
const url = process.argv[3] ?? "http://127.0.0.1:8095/ioniq5-hood.html";

const ev = (js) => ["eval", js];
const pose = (axis, deg, view, opts = {}) => ev(`(() => { const h = window.__hood; h.set(${JSON.stringify({ outline: true, xray: false, placeholder: false, ...(opts.set ?? {}) })}); h.setShell(${JSON.stringify({ shell: true, shellOpacity: 1, zones: false, part: null, ...(opts.shell ?? {}) })}); h.useAxis(${JSON.stringify(axis)}); h.setAngle(${deg}); h.useView(${JSON.stringify(view)}); return JSON.stringify(h.runCheck()); })()`);
const shot = (name) => [["wait", 450], ["shot", join(out, `${name}.png`), "body"]];
const samples = [0, 5, 15, 30, 45, 60];

const actions = [
  ["until", "window.__labLog?.some(e => e.tag === 'loaded' || e.tag === 'load-error')", 60000],
  ev("(() => { const e = window.__labLog.find(e => e.tag === 'loaded'); if (!e) throw Error('GLB failed: ' + JSON.stringify(window.__labLog)); if (e.parts !== 44 || e.hoodTriangles !== 1592 || e.zeroDegree.hoodWorldMatrixMaxDelta !== 0 || !e.zeroDegree.hoodLocalMatrixUnchanged) throw Error('baseline ' + JSON.stringify(e)); if (!e.shell || e.shell.panels !== 9) throw Error('shell ' + JSON.stringify(e.shell)); return JSON.stringify(e); })()"),
  // With the shell shown: hood motion unchanged, and no new crossings against model + shell.
  ev(`(() => { const h = window.__hood, rows = []; h.setShell({ shell: true });
    for (const id of ['A', 'C']) { h.useAxis(id); for (const deg of ${JSON.stringify(samples)}) {
      const v = h.compareWithNode(deg), c = h.runCheck();
      if (v.maxVertexDeltaCm > 1e-6 || c.newPairs !== 0) throw Error('shell check ' + JSON.stringify({ id, deg, v, c }));
      rows.push({ id, deg, vertexDeltaCm: v.maxVertexDeltaCm, newPairs: c.newPairs, minNewCm: c.minNewCm, closest: c.closest }); } }
    h.setShell({ shell: false }); h.useAxis('A'); h.setAngle(0); return JSON.stringify(rows); })()`),
  // Required evidence (angles SIMULATION_ONLY).
  pose("A", 0, "iso"), ...shot("01-closed-full-shell"),
  pose("A", 45, "iso"), ...shot("02-open45-full-shell-axisA"),
  pose("A", 45, "bayiso"), ...shot("03-interior-iso-shell"),
  pose("A", 60, "baytop"), ...shot("04-interior-top-shell-60"),
  pose("A", 45, "bay"), ...shot("05-interior-bay-shell"),
  pose("A", 45, "bay", { shell: { shell: false } }), ...shot("06a-compare-bay-original"),
  pose("A", 45, "bay"), ...shot("06b-compare-bay-shell"),
  pose("A", 45, "bayiso", { shell: { shell: false } }), ...shot("06c-compare-iso-original"),
  pose("A", 45, "bayiso"), ...shot("06d-compare-iso-shell"),
  pose("A", 45, "bayiso", { shell: { shellOpacity: 0.35 } }), ...shot("07-shell-translucent"),
  pose("A", 45, "bay", { shell: { zones: true } }), ...shot("08-frunk-and-service-zones"),
  pose("A", 60, "baytop", { shell: { zones: true } }), ...shot("08b-zones-top-60"),
  pose("A", 45, "bayside", { set: { xray: true } }), ...shot("09a-hood-shell-axisA-side"),
  pose("C", 45, "bayside", { set: { xray: true } }), ...shot("09b-hood-shell-axisC-side"),
  pose("A", 30, "bayside", { set: { xray: true } }), ...shot("09c-hood-shell-axisA-side-30"),
  pose("C", 30, "bayside", { set: { xray: true } }), ...shot("09d-hood-shell-axisC-side-30"),
  pose("A", 45, "bay", { shell: { part: "fc-front-upper-support" } }), ...shot("10-part-selected"),
  // Performance: same page, shell hidden vs shown.
  pose("A", 0, "iso", { shell: { shell: false } }),
  ev("window.__hood.perf(2).then(r => JSON.stringify(r))"),
  ev("window.__hood.shellToggleCost(true).then(r => JSON.stringify(r))"),
  ev("window.__hood.perf(2).then(r => JSON.stringify(r))"),
  ev("window.__hood.shellToggleCost(false).then(r => JSON.stringify(r))"),
  ev(`(() => { const h = window.__hood, t = []; for (const on of [false, true]) { h.setShell({ shell: on }); h.setAngle(30); const a = performance.now(); for (let i = 0; i < 5; i++) h.runCheck(); t.push({ shell: on, collisionCheckMs: +((performance.now() - a) / 5).toFixed(1) }); } h.setAngle(0); return JSON.stringify(t); })()`),
  ev(`window.__hood.svgTiming(["closed-no-shell.svg", "closed-shell.svg", "open45-no-shell.svg", "open45-shell.svg", "open45-shell-frunkzone.svg"], "./external/p3-a2-1/svg/").then(r => JSON.stringify(r))`),
  pose("A", 0, "bay"),
  ev("window.__hood.record(45, 1600).then(r => 'WEBM:' + r.base64)"),
];
const script = join(out, "actions.json");
writeFileSync(script, JSON.stringify(actions));
const r = spawnSync(process.execPath, ["--experimental-websocket", join(anatomy, "scripts", "drive.mjs"), url, "--actions", script, "--width", "1280", "--height", "800"], { encoding: "utf8", maxBuffer: 256 << 20 });
const lines = (r.stdout ?? "").split("\n");
const evals = lines.filter((l) => l.startsWith("eval: ")).map((l) => JSON.parse(l.slice(6)));
const webm = evals.find((e) => typeof e === "string" && e.startsWith("WEBM:"));
if (webm) writeFileSync(join(out, "hood-open-close-shell-axisA.webm"), Buffer.from(webm.slice(5), "base64"));
const parsed = evals.filter((e) => e !== webm).map((e) => { try { return JSON.parse(e); } catch { return e; } });
const perfs = parsed.filter((e) => e?.frameMs);
writeFileSync(join(out, "check-results.json"), JSON.stringify({ url, loaded: parsed[0], shellChecks: parsed[1], perfShellOff: perfs[0], perfShellOn: perfs[1], toggle: parsed.filter((e) => e?.msToSecondFrame !== undefined), collision: parsed.find((e) => Array.isArray(e) && e[0]?.collisionCheckMs !== undefined),
  svgTiming: parsed.find((e) => Array.isArray(e) && e[0]?.decodeMs !== undefined), webmBytes: webm ? Buffer.from(webm.slice(5), "base64").length : 0, console: lines.filter((l) => l.startsWith("console")) }, null, 2) + "\n");
process.stdout.write(lines.filter((l) => !l.startsWith("eval: \"WEBM:")).map((l) => l.slice(0, 300)).join("\n") + "\n");
if (r.stderr) process.stderr.write(r.stderr);
process.exitCode = r.status ?? 1;
