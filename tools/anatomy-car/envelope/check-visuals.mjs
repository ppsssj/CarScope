// Purpose-built rendering checks through the pinned Anatomy headless driver. No OEM model access.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnatomy } from "../automotive/anatomy.mjs";
import { POSES } from "./artifacts.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const out=resolve(process.argv[2]??join(here,"../build/envelope/visual"));
const base=process.argv[3]??"http://127.0.0.1:8095/";
const {home}=await loadAnatomy();mkdirSync(out,{recursive:true});
const run=(name,args)=>{
  const r=spawnSync(process.execPath,[join(home,"scripts",name),...args],{encoding:"utf8"});
  writeFileSync(join(out,`${name}-${Math.random().toString(16).slice(2)}.log`),(r.stdout??"")+(r.stderr??""));
  console.log(r.stdout??"");
  if(r.status!==0) throw new Error(`${name}: exit ${r.status}\n${r.stderr}`);
};
for(const pose of Object.keys(POSES)) for(const theme of ["light","dark"]) {
  const page=join(here,`../build/envelope/suv-${pose}-${theme}.html`);
  for(const scale of [1,4]) run("capture.mjs",[page,"--out",join(out,`svg-${pose}-${theme}-x${scale}.png`),"--width","1100","--height","650","--scale",String(scale),"--wait","2000"]);
  run("lines.mjs",[page]);
}
for(const theme of ["light","dark"]) run("capture.mjs",[join(here,`../build/envelope/comparison-${theme}.html`),"--out",join(out,`comparison-${theme}.png`),"--width","1880","--height","900","--select",".iso-page","--scale","1","--wait","2000"]);
const actions=[["until","window.__lab?.state.meshes.length > 0",20000],
  ["eval","(() => { const j=window.__lab.state.gltf.parser.json; if(j.extras.vehicleGeometryProfile.profileId!=='manual-pleos-avd-envelope-v1'||Object.keys(window.__lab.state.doors).length!==4) throw Error('Wrong model/door inventory'); for(const id of ['fr-control','rr-control']) if(getComputedStyle(document.getElementById(id)).display==='none') throw Error('Missing right control'); return j.extras.vehicleGeometryProfile.profileId; })()"],
  ["shot",join(out,"glb-controls.png"),"body"],
  ["eval","for(const id of ['panel','info','stats']) document.getElementById(id).style.display='none'"],
  ["eval","window.__lab.useSvgCamera()"],["wait",100],["shot",join(out,"glb-front-three-quarter.png"),"body"]];
for(const view of ["front","left","rear","right","top"]) {
  const dir={front:[1,0,0],rear:[-1,0,0],left:[0,0,-1],right:[0,0,1],top:[0,1,0]}[view];
  actions.push(["eval",`window.__lab.useView(${JSON.stringify(view)})`],["wait",100],["shot",join(out,`glb-${view}.png`),"body"],
    ["eval",`(() => { const l=window.__lab,c=l.cam(),v=c.position.clone().sub(l.state.box.getCenter(c.position.clone())).normalize().toArray(); if(v.some((n,i)=>Math.abs(n-${JSON.stringify(dir)}[i])>1e-6)) throw Error('Incorrect ${view} direction'); return {view:${JSON.stringify(view)},direction:v}; })()`]);
}
actions.push(["eval","window.__lab.useSvgCamera(); for(const id of Object.keys(window.__lab.state.doors)) window.__lab.setDoor(id,1)"],["wait",100],["shot",join(out,"glb-four-open.png"),"body"],
  ["eval","for(const id of Object.keys(window.__lab.state.doors)) window.__lab.setDoor(id,0); window.__lab.useView('left')"]);
for(const deg of [5.5,30]) actions.push(["eval",`window.__lab.setDoor('door-rear-left',${deg}/58)`],["wait",100],["shot",join(out,`glb-rear-left-${deg}.png`),"body"]);
const file=join(out,"glb-actions.json");writeFileSync(file,JSON.stringify(actions));
run("drive.mjs",[`${base}?model=/envelope.glb&cam=svg&orthographic=1`,"--actions",file,"--width","1100","--height","800"]);
console.log("Captures complete; inspect images. Rendering success alone is not visual approval.");
