// P3-A1 hood PoC check and captures. Start the server first (paths outside the repo):
//   $env:CARSCOPE_IONIQ5_GLB = '<converted .glb>'; $env:CARSCOPE_P3A1_DIR = '<hood-feasibility.mjs --out dir>'; node tools/three-poc/serve.mjs
//   node tools/three-poc/check-ioniq5-hood.mjs <outDir outside the repo> [url]
// Asserts: inventory, 0-degree identity, browser pivot == Node rotation, browser collision == Node report
// at the sample angles for every axis. Captures screenshots, frame timing, SVG paint timing and a WebM.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
if (!process.argv[2]) { console.error("usage: node tools/three-poc/check-ioniq5-hood.mjs <outDir outside the repo> [url]"); process.exit(2); }
const out = resolve(process.argv[2]);
const rel = relative(repo, out);
if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`Refusing to write model-derived captures inside the repo: ${out}`);
mkdirSync(out, { recursive: true });
const url = process.argv[3] ?? "http://127.0.0.1:8095/ioniq5-hood.html";
const report = JSON.parse(readFileSync(join(process.env.CARSCOPE_P3A1_DIR ?? join(out, "..", "report"), "hood-feasibility.json"), "utf8"));

const ev = (js) => ["eval", js];
const pose = (axis, deg, view, opts = {}) => ev(`(() => { const h = window.__hood; h.set(${JSON.stringify({ outline: true, xray: false, placeholder: false, ...opts })}); h.useAxis(${JSON.stringify(axis)}); h.setAngle(${deg}); h.useView(${JSON.stringify(view)}); return JSON.stringify(h.runCheck()); })()`);
const shot = (name) => [["wait", 400], ["shot", join(out, `${name}.png`), "body"]];
const sample = [0, 5, 15, 30, 45, 60];
const expected = Object.fromEntries(Object.entries(report.sweeps).map(([id, rows]) => [id, Object.fromEntries(rows.filter((r) => sample.includes(r.deg)).map((r) => [r.deg, { newPairs: r.newIntersectingPairs, minNew: r.minNewClearanceCm }]))]));

const actions = [
  ["until", "window.__labLog?.some(e => e.tag === 'loaded' || e.tag === 'load-error')", 60000],
  ev("(() => { const e = window.__labLog.find(e => e.tag === 'loaded'); if (!e) throw Error('GLB failed: ' + JSON.stringify(window.__labLog)); if (e.parts !== 44 || e.hoodTriangles !== 1592 || e.identification.length) throw Error('inventory ' + JSON.stringify(e)); if (e.zeroDegree.hoodWorldMatrixMaxDelta !== 0 || !e.zeroDegree.hoodLocalMatrixUnchanged) throw Error('0 degree pose changed ' + JSON.stringify(e.zeroDegree)); return JSON.stringify(e); })()"),
  // Browser pivot against the Node rotation, and browser collision against the Node report.
  ev(`(() => { const h = window.__hood, exp = ${JSON.stringify(expected)}, rows = [];
    for (const id of Object.keys(exp)) { h.useAxis(id); for (const deg of ${JSON.stringify(sample)}) {
      const v = h.compareWithNode(deg); const c = h.runCheck(); const e = exp[id][deg];
      const minOk = typeof e.minNew === 'number' ? Math.abs(c.minNewCm - e.minNew) < 1e-3 : c.minNewCm === null;
      if (v.maxVertexDeltaCm > 1e-6 || c.newPairs !== e.newPairs || !minOk) throw Error('mismatch ' + JSON.stringify({ id, deg, v, c, e }));
      rows.push({ id, deg, vertexDeltaCm: v.maxVertexDeltaCm, newPairs: c.newPairs, minNewCm: c.minNewCm, verdict: c.verdict }); } }
    return JSON.stringify(rows); })()`),
  // Required evidence.
  pose("A", 0, "iso"), ...shot("01-closed-iso"),
  pose("A", 0, "side"), ...shot("01b-closed-side"),
  pose("A", 30, "iso"), ...shot("02-open-30-iso-axisA"),
  pose("A", 60, "iso"), ...shot("03-open-60-iso-axisA"),
  pose("A", 45, "side"), ...shot("04-open-45-side-axisA"),
  pose("A", 45, "top"), ...shot("05-open-45-top-axisA"),
  pose("A", 45, "bay"), ...shot("05b-open-45-bay-axisA"),
  pose("A", 45, "bay", { placeholder: true }), ...shot("05c-open-45-bay-placeholder"),
  pose("A", 45, "bay", { xray: true }), ...shot("05d-open-45-bay-xray"),
  pose("A", 45, "front"), ...shot("06-open-45-front-axisA"),
  pose("C", 45, "iso"), ...shot("07-open-45-iso-axisC"),
  pose("C", 45, "side"), ...shot("07b-open-45-side-axisC"),
  pose("B", 30, "side"), ...shot("08-open-30-side-axisB-interference"),
  pose("B", 45, "bay", { outline: true }), ...shot("08b-open-45-bay-axisB-interference"),
  pose("A", 0, "iso"),
  ev("window.__hood.perf(2).then(r => JSON.stringify(r))"),
  ev(`window.__hood.svgTiming(${JSON.stringify(report.svg.frames.flatMap((f) => [f.svg.file, f.highlighted.file]).map((f) => f.replace(/^svg\//, "")))}).then(r => JSON.stringify(r))`),
  ev("(() => { const h = window.__hood; h.useAxis('A'); h.setAngle(0); h.useView('iso'); return 'reset'; })()"),
  ev("window.__hood.record(45, 1600).then(r => 'WEBM:' + r.base64)"),
];
const script = join(out, "actions.json");
writeFileSync(script, JSON.stringify(actions));
const r = spawnSync(process.execPath, ["--experimental-websocket", join(anatomy, "scripts", "drive.mjs"), url, "--actions", script, "--width", "1280", "--height", "800"], { encoding: "utf8", maxBuffer: 256 << 20 });
const lines = (r.stdout ?? "").split("\n");
const evals = lines.filter((l) => l.startsWith("eval: ")).map((l) => JSON.parse(l.slice(6)));
const webm = evals.find((e) => typeof e === "string" && e.startsWith("WEBM:"));
if (webm) writeFileSync(join(out, "hood-open-close-axisA.webm"), Buffer.from(webm.slice(5), "base64"));
const parsed = evals.filter((e) => e !== webm).map((e) => { try { return JSON.parse(e); } catch { return e; } });
writeFileSync(join(out, "check-results.json"), JSON.stringify({ url, loaded: parsed[0], agreement: parsed[1], perf: parsed.find((e) => e?.frameMs), svgTiming: parsed.find((e) => Array.isArray(e) && e[0]?.decodeMs !== undefined), webmBytes: webm ? Buffer.from(webm.slice(5), "base64").length : 0, console: lines.filter((l) => l.startsWith("console")) }, null, 2) + "\n");
process.stdout.write(lines.filter((l) => !l.startsWith("eval: \"WEBM:")).map((l) => l.slice(0, 400)).join("\n") + "\n");
if (r.stderr) process.stderr.write(r.stderr);
process.exitCode = r.status ?? 1;
