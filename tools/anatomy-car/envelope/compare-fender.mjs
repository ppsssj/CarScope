// Rebuild the preserved P2-A3-1.1 front quarter and the P2-A3-1.2 fender
// from one builder, one SVG projection and the same GLB camera metadata.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildEnvelopeModel } from "./model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { kitMarkup, CAR_CSS } from "../automotive/materials.mjs";
import { VIEW, svgScreenMarkup } from "../automotive/camera.mjs";

const out=join(dirname(fileURLToPath(import.meta.url)),"..","build","fender");
mkdirSync(out,{recursive:true});
const results=[];
for(const [name,enabled] of [["before",false],["after",true]]) {
  const start=performance.now(),model=await buildEnvelopeModel({fenderSurface:enabled});
  const buildMs=performance.now()-start,exportStart=performance.now(),bundle=generateGeometry(model);
  writeFileSync(join(out,`${name}.glb`),bundle.glb);
  const body=model.sc.R.items.filter(it=>!model.sc.variantOf(it)||model.sc.variantOf(it).variant==="closed")
    .map(it=>it.svg).join("");
  const svg=model.ctx.k.figureSvg({width:VIEW.width,height:VIEW.height,label:`SUV fender ${name}`,
    body:svgScreenMarkup(kitMarkup(model.ctx,model.halo)+body)});
  const plate=model.ctx.k.plateHtml({fig:"P2-A3-1.2",title:`SUV front fender · ${name}`,
    hint:"same model, camera and scale",readout:enabled?"Curved front fender":"Original planar front quarter",
    keys:[],caption:"Actual CarScope geometry; AAOS AVD reference envelope, OEM shape unverified.",body:svg});
  writeFileSync(join(out,`${name}.html`),model.ctx.k.pageHtml({title:`SUV front fender ${name}`,
    theme:"light",body:`<style>${CAR_CSS}</style>${plate}`,width:760}));
  results.push({name,buildMs:Number(buildMs.toFixed(1)),exportMs:Number((performance.now()-exportStart).toFixed(1)),
    parts:bundle.report.parts,triangles:bundle.report.triangles,
    frontFenderTriangles:bundle.report.checks.filter(c=>enabled?c.cls==="fender":c.partId.startsWith("suv.front-quarter.")).reduce((n,c)=>n+c.triangles,0),
    frontArchTrimTriangles:bundle.report.checks.filter(c=>c.cls==="trimShell").reduce((n,c)=>n+c.triangles,0)});
}
writeFileSync(join(out,"comparison.json"),JSON.stringify({camera:VIEW,results},null,2));
console.log(JSON.stringify(results,null,2));
