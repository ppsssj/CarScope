import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadAnatomy } from "../automotive/anatomy.mjs";

const out=resolve(process.argv[2]??".tools/p2-a311"),base=process.argv[3]??"http://127.0.0.1:8095/";
mkdirSync(out,{recursive:true});
const {home}=await loadAnatomy();
for(const name of ["before","after"]) {
  const actions=[
    ["until","window.__lab?.state.meshes.length > 0",20000],
    ["eval",`(() => {const j=window.__lab.state.gltf.parser.json; if(j.extras.vehicleGeometryProfile.profileId!=='manual-pleos-avd-envelope-v1') throw Error('wrong model'); return window.__lab.state.meshes.length})()`],
    ["eval","for(const id of ['panel','info','stats']) document.getElementById(id).style.display='none'"],
    ["eval","window.__lab.useView('left')"],["wait",300],["shot",join(out,`hood-${name}-side.png`),"body"],
    ["eval","(() => {const c=window.__lab.cam(),v=c.position.clone().sub(window.__lab.state.box.getCenter(c.position.clone())).normalize(); if(Math.abs(v.z+1)>1e-6) throw Error('wrong side'); return v.toArray()})()"],
  ];
  if(name==="after") actions.push(
    ["eval","window.__lab.useSvgCamera()"],["wait",300],["shot",join(out,"hood-after-glb.png"),"body"],
    ["eval","(() => {const m=window.__lab.state.meshes.find(x=>(x.userData?.partId??x.name).includes('suv.hood.loft')); if(!m) throw Error('missing loft: '+JSON.stringify(window.__lab.state.meshes.filter(x=>x.name.includes('hood')).map(x=>[x.name,x.userData]))); m.material.wireframe=true; window.__lab.state.dirty=true; return m.geometry.index.count/3})()"],
    ["wait",300],["shot",join(out,"hood-after-wireframe.png"),"body"]
  );
  const actionFile=join(out,`${name}-actions.json`);writeFileSync(actionFile,JSON.stringify(actions));
  const r=spawnSync(process.execPath,[join(home,"scripts","drive.mjs"),`${base}?model=/loft/${name}.glb&cam=svg&orthographic=1`,"--actions",actionFile,"--width","1100","--height","800"],{encoding:"utf8"});
  writeFileSync(join(out,`${name}-drive.log`),(r.stdout??"")+(r.stderr??""));
  console.log(r.stdout);
  if(r.status!==0||!r.stdout.includes("console: clean")) throw new Error(`${name} capture failed: ${r.stderr}`);
}
