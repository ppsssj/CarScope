// Reproducible P2-A3-1.1 before/after from the same geometry recorder and camera.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildEnvelopeModel } from "./model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { kitMarkup, CAR_CSS } from "../automotive/materials.mjs";
import { VIEW, svgScreenMarkup } from "../automotive/camera.mjs";

const out=join(dirname(fileURLToPath(import.meta.url)),"..","build","loft");mkdirSync(out,{recursive:true});
const captures=[];
for(const [name,enabled] of [["before",false],["after",true]]) {
  const t0=performance.now(),model=await buildEnvelopeModel({hoodLoft:enabled}),buildMs=performance.now()-t0;
  const t1=performance.now(),bundle=generateGeometry(model),exportMs=performance.now()-t1;
  writeFileSync(join(out,`${name}.glb`),bundle.glb);
  const body=model.sc.R.items.filter(it=>!model.sc.variantOf(it)||model.sc.variantOf(it).variant==="closed").map(it=>it.svg).join("");
  const svg=model.ctx.k.figureSvg({width:VIEW.width,height:VIEW.height,label:`SUV hood ${name}`,body:svgScreenMarkup(kitMarkup(model.ctx,model.halo)+body)});
  const plate=model.ctx.k.plateHtml({fig:"P2-A3-1.1",title:`SUV hood · ${name}`,hint:"same model, camera and scale",readout:enabled?"Loft surface":"P2-A3-1 prism",keys:[],caption:"Actual CarScope SVG from the common 3D geometry. OEM match unverified.",body:svg});
  writeFileSync(join(out,`${name}.html`),model.ctx.k.pageHtml({title:`SUV hood ${name}`,theme:"light",body:`<style>${CAR_CSS}</style>${plate}`,width:760}));
  captures.push({name,buildMs:Number(buildMs.toFixed(1)),exportMs:Number(exportMs.toFixed(1)),triangles:bundle.report.triangles,
    hoodTriangles:bundle.report.checks.find(c=>c.partId.startsWith(enabled?"suv.hood.loft/":"suv.hood/"))?.triangles,
    parts:bundle.report.parts,modelMaxZ:Math.max(...bundle.parts.flatMap(p=>p.mesh.positions.map(q=>q[2])))});
}
writeFileSync(join(out,"comparison.json"),JSON.stringify({headCamera:VIEW,measurements:captures},null,2));
console.log(JSON.stringify(captures,null,2));
