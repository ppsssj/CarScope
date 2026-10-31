// Local-only technical comparison; a screenshot is a 2D reference, never 3D ground truth.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvelopeModel } from "./model.mjs";
import { buildModel } from "../automotive/model.mjs";
import { kitMarkup, CAR_CSS } from "../automotive/materials.mjs";
import { VIEW, svgScreenMarkup } from "../automotive/camera.mjs";

const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=="--oem-screen")) throw new Error("usage: compare.mjs [--oem-screen local-2560x1440-png]");
const suv=await buildEnvelopeModel();
const sedan=await buildModel({projection:suv.P});
const out=join(dirname(fileURLToPath(import.meta.url)),"..","build","envelope");
mkdirSync(out,{recursive:true});
const content=(model)=>svgScreenMarkup(kitMarkup(model.ctx,model.halo)+model.sc.R.items.filter(it=>!model.sc.variantOf(it)||model.sc.variantOf(it).variant==="closed").map(it=>it.svg).join(""));
const figure=(model,label)=>model.ctx.k.figureSvg({width:VIEW.width,height:VIEW.height,label,body:content(model)});
const image=args.length?`<img alt="OEM vehicle crop from a local emulator screenshot; unverified model" src="data:image/png;base64,${readFileSync(resolve(args[1])).toString("base64")}">`:"<p>No local OEM screenshot supplied.<br>See the P2-A3-0 evidence index.</p>";
for(const theme of ["light","dark"]) {
  const body=`<style>${CAR_CSS}
  .comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.comparison article{border:1px solid #89929c;padding:16px;min-width:0}.comparison h2{font:16px system-ui}.comparison p{font:13px/1.6 system-ui;max-width:68ch}.comparison svg{width:100%;height:auto}.oem-frame{position:relative;width:100%;aspect-ratio:640/330;overflow:hidden;background:white}.oem-frame img{position:absolute;width:300%;max-width:none;left:0;top:-110%}.comparison h2,.comparison p{color:var(--iso-hi,currentColor)}
  @media(max-width:900px){.comparison{grid-template-columns:1fr}}
  </style><h1>Vehicle envelope reference · OEM match UNVERIFIED</h1><p>A/B use identical front-left 3/4 projection, pixel scale and origin (azimuth 56°, elevation 28°). C is an uncalibrated crop of a 2D emulator screenshot. No OEM asset extraction or model-name inference.</p>
  <div class="comparison"><article><h2>A · Original Generic Sedan</h2>${figure(sedan,"Unmodified Generic Sedan geometry")}<p>Original geometry and production output preserved. This comparison alone uses the SUV projection for a shared physical scale.</p></article>
  <article><h2>B · Envelope SUV</h2>${figure(suv,"Envelope SUV original procedural geometry")}<p>4950 × 2008 × 1776 mm; wheelbase 2984 mm. High shoulder, long crowned roof, steep hatch. Shape, wheels, hinges and construction are estimates.</p></article>
  <article><h2>C · OEM screen reference</h2><div class="oem-frame">${image}</div><p>Local P2-A3-0 screenshot crop. Camera/lens/model mapping unknown. Image similarity is not a geometric accuracy measurement.</p></article></div>`;
  writeFileSync(join(out,`comparison-${theme}.html`),suv.ctx.k.pageHtml({title:"Sedan / Envelope SUV / OEM screen",theme,body,width:1800}));
}
writeFileSync(join(out,"comparison-camera.json"),JSON.stringify({view:VIEW,projection:suv.P,sharedProjection:sedan.P===suv.P,sourceGeometryChanged:false,oemCamera:"UNKNOWN"},null,2));
console.log(`Comparison written to ${out}; C ${args.length?"uses supplied 2D screenshot":"NOT_RUN without screenshot"}.`);
