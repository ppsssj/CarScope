// Captures real CarScope SVG pages and the corresponding Three.js GLB renders.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadAnatomy } from "../automotive/anatomy.mjs";

const out=resolve(process.argv[2]??".tools/p2-a312"),base=process.argv[3]??"http://127.0.0.1:8095/";
mkdirSync(out,{recursive:true});
const {home}=await loadAnatomy();
const run=(script,args,label)=>{
  const r=spawnSync(process.execPath,[join(home,"scripts",script),...args],{encoding:"utf8"});
  writeFileSync(join(out,`${label}.log`),(r.stdout??"")+(r.stderr??""));
  if(r.status!==0 || script==="drive.mjs"&&!r.stdout.includes("console: clean"))
    throw new Error(`${label} failed: ${r.stdout}\n${r.stderr}`);
  console.log(`${label}: PASS`);
};
for(const name of ["before","after"]) {
  const page=resolve(`tools/anatomy-car/build/fender/${name}.html`);
  for(const [suffix,scale] of [["front-3q",1],["x4",4]])
    run("capture.mjs",[page,"--out",join(out,`fender-${name}-${suffix}.png`),"--width","1100","--height","650","--scale",String(scale),"--wait","2000"],`${name}-svg-${suffix}`);
  const actions=[
    ["until","window.__lab?.state.meshes.length > 0",20000],
    ["eval",`(() => {const j=window.__lab.state.gltf.parser.json; if(j.extras.vehicleGeometryProfile.profileId!=='manual-pleos-avd-envelope-v1') throw Error('wrong model'); return window.__lab.state.meshes.length})()`],
    ["eval","for(const id of ['panel','info','stats']) document.getElementById(id).style.display='none'"],
    ["eval","window.__lab.useView('left')"],["wait",300],["shot",join(out,`fender-${name}-side.png`),"body"],
    ["eval","(() => {const l=window.__lab,v=l.cam().position.clone().sub(l.state.box.getCenter(l.cam().position.clone())).normalize();if(Math.abs(v.z+1)>1e-6)throw Error('wrong left camera');return v.toArray()})()"],
  ];
  if(name==="after") {
    for(const [view,axis] of [["front","x"],["top","y"]]) actions.push(
      ["eval",`window.__lab.useView('${view}')`],["wait",300],["shot",join(out,`fender-after-${view}.png`),"body"],
      ["eval",`(() => {const l=window.__lab,v=l.cam().position.clone().sub(l.state.box.getCenter(l.cam().position.clone())).normalize();if(Math.abs(v.${axis}-1)>1e-6)throw Error('wrong ${view} camera');return v.toArray()})()`]);
    actions.push(["eval","window.__lab.useSvgCamera()"],["wait",300],["shot",join(out,"fender-after-glb.png"),"body"],
      ["eval","(() => {const f=window.__lab.state.meshes.filter(x=>(x.userData?.partId??x.name).includes('suv.front-fender.')); if(f.length!==2) throw Error('expected two fenders, got '+f.length); for(const m of f) m.material.wireframe=true; window.__lab.state.dirty=true; return f.map(m=>m.geometry.index.count/3)})()"],
      ["wait",300],["shot",join(out,"fender-after-wireframe.png"),"body"]);
  }
  const file=join(out,`${name}-actions.json`);writeFileSync(file,JSON.stringify(actions));
  run("drive.mjs",[`${base}?model=/fender/${name}.glb&cam=svg&orthographic=1`,"--actions",file,"--width","1100","--height","800"],`${name}-glb`);
}
