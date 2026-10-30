// Start serve.mjs (or provide the lab's URL) first. Captures debug views with the pinned Anatomy driver.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
const out = process.argv[3] ? resolve(process.argv[3]) : join(here, "build", "visual"); mkdirSync(out, { recursive: true });
const actions = [["until", "window.__lab?.state.meshes.length > 0", 20000]];
for (const view of ["front", "rear", "left", "right"]) {
  actions.push(["eval", `window.__lab.useView(${JSON.stringify(view)})`], ["wait", 100], ["shot", join(out, `${view}.png`), "body"]);
  const direction = { front: [1, 0], rear: [-1, 0], left: [0, -1], right: [0, 1] }[view];
  actions.push(["eval", `(() => { const l=window.__lab, c=l.state.box.getCenter(l.cam().position.clone()), p=l.cam().position.clone().sub(c).normalize(); if(Math.abs(p.x-(${direction[0]})/Math.hypot(1,.22))>1e-6 || Math.abs(p.z-(${direction[1]})/Math.hypot(1,.22))>1e-6) throw Error('View changed after capture/resize: ${view}'); return {view:${JSON.stringify(view)},direction:p.toArray()}; })()`]);
}
actions.push(["eval", "window.__lab.useSvgCamera()"], ["wait", 100], ["shot", join(out, "svg-camera.png"), "body"]);
actions.push(["eval", "window.__lab.setDoor('door-front-left', 1); window.__lab.setDoor('door-rear-left', 1)"], ["wait", 100], ["shot", join(out, "both-open.png"), "body"]);
actions.push(["eval", "window.__lab.setDoor('door-front-left', 0); window.__lab.useView('left')"]);
for (const deg of [0, 5, 5.5, 6, 15, 30, 58]) {
  actions.push(["eval", `window.__lab.setDoor('door-rear-left', ${deg}/58)`], ["wait", 100], ["shot", join(out, `rear-${deg}-degrees.png`), "body"]);
}
actions.push(["eval", "JSON.stringify({loaded:window.__labLog, doors:Object.fromEntries(Object.entries(window.__lab.state.doors).map(([k,d])=>[k,{position:d.node.position.toArray(),angle:d.node.quaternion.toArray()}]))})"]);
const script = join(out, "actions.json"); writeFileSync(script, JSON.stringify(actions));
const r = spawnSync(process.execPath, [join(anatomy, "scripts", "drive.mjs"), process.argv[2] ?? "http://127.0.0.1:8095/?cam=svg&landmarks=1", "--actions", script, "--width", "1100", "--height", "800"], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
