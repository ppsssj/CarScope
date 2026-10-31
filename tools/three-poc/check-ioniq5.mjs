// P2-A6 IONIQ 5 PoC check. Start the server first:
//   CARSCOPE_IONIQ5_GLB=<converted .glb> node tools/three-poc/serve.mjs
//   node tools/three-poc/check-ioniq5.mjs [url] [outDir]
// Picks parts through the real ray caster (screen point -> raycast), not by name lookup.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
const out = process.argv[3] ? resolve(process.argv[3]) : join(here, "build", "ioniq5"); mkdirSync(out, { recursive: true });
const pick = (view, name) => ["eval", `(() => { const l=window.__ioniq; l.useView(${JSON.stringify(view)}); l.state.gltf.scene.updateMatrixWorld(true); const p=l.screenOf(${JSON.stringify(name)}); const hit=l.pickAt(p[0],p[1]); if(!hit || hit.name!==${JSON.stringify(name)}) throw Error('pick ${view}: expected ${name}, got '+(hit&&hit.name)); return {view:${JSON.stringify(view)}, picked:hit.name, category:hit.category, minCm:hit.minCm, maxCm:hit.maxCm}; })()`];
const actions = [
  ["until", "window.__labLog?.some(e => e.tag === 'loaded' || e.tag === 'load-error')", 30000],
  ["eval", "(() => { const e=window.__labLog.find(e=>e.tag==='loaded'); if(!e) throw Error('GLB failed to load: '+JSON.stringify(window.__labLog)); if(e.parts!==44||e.triangles!==37350) throw Error('unexpected inventory '+JSON.stringify(e)); return e; })()"],
];
for (const view of ["iso", "front", "rear", "left", "right", "top"]) actions.push(["eval", `window.__ioniq.useView(${JSON.stringify(view)})`], ["wait", 150], ["shot", join(out, `${view}.png`), "body"]);
actions.push(pick("left", "Door_Left_0"), pick("left", "Door_Left_1"), pick("right", "Door_Right_0"), pick("front", "Door_Front_0"), pick("rear", "Door_Rear_0"), pick("left", "Wheel_1_1"), pick("right", "Wheel_0_0"));
actions.push(["eval", "window.__ioniq.useView('left'); window.__ioniq.select('Door_Left_0'); 'selected'"], ["wait", 150], ["shot", join(out, "selected-door-front-left.png"), "body"]);
actions.push(["eval", "window.__ioniq.select(null); window.__ioniq.hideShell(true); window.__ioniq.useView('iso'); 'shell hidden'"], ["wait", 150], ["shot", join(out, "shell-hidden.png"), "body"]);
actions.push(pick("iso", "Interior_Static"));
actions.push(["eval", "JSON.stringify(window.__labLog)"]);
const script = join(out, "actions.json");
writeFileSync(script, JSON.stringify(actions));
const r = spawnSync(process.execPath, [join(anatomy, "scripts", "drive.mjs"), process.argv[2] ?? "http://127.0.0.1:8095/ioniq5.html", "--actions", script, "--width", "1100", "--height", "800"], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
