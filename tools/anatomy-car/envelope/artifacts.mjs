import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnvelopeModel } from "./model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { VIEW, svgScreenMarkup } from "../automotive/camera.mjs";
import { kitMarkup, CAR_CSS } from "../automotive/materials.mjs";
import { bounds, sweepDoors, collisionFailures } from "../geometry-export/collision.mjs";
import { meshFailures, requireValid, POLICY } from "../geometry-export/policy.mjs";
import { glbContractFailures, readGlb } from "../geometry-export/glb-contract.mjs";
import validator from "gltf-validator";

export const DOOR_IDS = ["door-front-left", "door-rear-left", "door-front-right", "door-rear-right"];
export const POSES = { closed: [], "fl-open": [DOOR_IDS[0]], "rl-open": [DOOR_IDS[1]], "left-open": DOOR_IDS.slice(0,2), "all-open": DOOR_IDS };

export function dimensionReport(bundle) {
  const { parts, model } = bundle;
  const all = bounds(parts.flatMap((p) => p.mesh.positions));
  const body = bounds(parts.filter((p) => p.measurementRole !== "mirror").flatMap((p) => p.mesh.positions));
  const centers = model.wheels.map((w) => {
    const p = parts.find((p) => p.partId === w.tyrePart), b = bounds(p.mesh.positions);
    return { ...w, actual: b[0].map((n,i)=>(n+b[1][i])/2) };
  });
  const at = (axle,side) => centers.find((w) => w.axle===axle && w.side===side).actual;
  const actualCm = { height: all[1][2]-all[0][2], length: all[1][0]-all[0][0], width: body[1][1]-body[0][1],
    widthWithMirrors: all[1][1]-all[0][1], wheelbase: at("front",1)[0]-at("rear",1)[0],
    frontTrack: at("front",1)[1]-at("front",-1)[1], rearTrack: at("rear",1)[1]-at("rear",-1)[1] };
  const dimensions = Object.fromEntries(Object.entries(actualCm).map(([key,n]) => [key,{ expectedMm:model.profile.dimensions[key].value, actualMm:n*10, errorMm:n*10-model.profile.dimensions[key].value }]));
  // Measure the encoded Float32 buffers independently too, after assembling closed node pivots.
  const {json,accessor}=readGlb(bundle.glb), decoded=[];
  const walk=(index,offset=[0,0,0])=>{
    const n=json.nodes[index],shift=offset.map((v,i)=>v+(n.translation?.[i]??0));
    if(n.mesh!==undefined) {
      const values=accessor(json.meshes[n.mesh].primitives[0].attributes.POSITION), points=[];
      for(let i=0;i<values.length;i+=3) points.push([(values[i]+shift[0])*1000,-(values[i+2]+shift[2])*1000,(values[i+1]+shift[1])*1000]);
      decoded.push({name:n.name,points,mirror:parts.find(p=>p.partId===n.name)?.measurementRole==="mirror"});
    }
    n.children?.forEach(i=>walk(i,shift));
  };
  json.scenes[json.scene??0].nodes.forEach(i=>walk(i));
  const gb=bounds(decoded.flatMap(p=>p.points)),bb=bounds(decoded.filter(p=>!p.mirror).flatMap(p=>p.points));
  const wc=(axle,side)=>{const w=model.wheels.find(w=>w.axle===axle&&w.side===side),b=bounds(decoded.find(p=>p.name===w.tyrePart).points);return b[0].map((v,i)=>(v+b[1][i])/2);};
  const glbActual={height:gb[1][2]-gb[0][2],length:gb[1][0]-gb[0][0],width:bb[1][1]-bb[0][1],widthWithMirrors:gb[1][1]-gb[0][1],wheelbase:wc("front",1)[0]-wc("rear",1)[0],frontTrack:wc("front",1)[1]-wc("front",-1)[1],rearTrack:wc("rear",1)[1]-wc("rear",-1)[1]};
  const glbDimensions=Object.fromEntries(Object.entries(glbActual).map(([key,n])=>[key,{actualMm:n,errorMm:n-model.profile.dimensions[key].value}]));
  return { units:"mm", scope:"closed complete geometry; width excludes mirror housing/arms only; height from tyre contact to roof crown",
    dimensions, glbFloat32:glbDimensions, wheelCentersCm:centers.map(({name,actual})=>({name,actual})),
    turningDiameter:{ observedMm:model.profile.dimensions.turningDiameter.value, actualMm:null, errorMm:null, reason:"No steering/turning kinematics implemented" } };
}

export function writeEnvelopePreviews(model, out) {
  const { k } = model.ctx;
  for (const [name, open] of Object.entries(POSES)) for (const theme of ["light","dark"]) {
    const body = model.sc.R.items.filter((it) => {
      const v=model.sc.variantOf(it); return !v || (v.variant==="open")===open.includes(v.door);
    }).map((it)=>`<g data-part="${it.name}">${it.svg}</g>`).join("");
    const svg=k.figureSvg({width:VIEW.width,height:VIEW.height,label:`Envelope crossover ${name}; OEM match unverified`,body:svgScreenMarkup(kitMarkup(model.ctx,model.halo)+body)});
    const plate=k.plateHtml({fig:"P2-A3-1",title:"Envelope SUV",hint:"AAOS simulated envelope · original reference geometry",readout:`${name} · OEM match UNVERIFIED`,keys:[],caption:"4950 × 2008 × 1776 mm · wheelbase 2984 mm. Wheel size, roofline, apertures and surface form are design estimates.",body:svg});
    writeFileSync(join(out,`suv-${name}-${theme}.html`),k.pageHtml({title:`Envelope SUV ${name}`,theme,body:`<style>${CAR_CSS}</style>${plate}`,width:760}));
  }
}

export async function generateEnvelope(out) {
  const model=await buildEnvelopeModel(), bundle=generateGeometry(model);
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,"car.glb"),bundle.glb);
  writeFileSync(join(out,"ir.json"),JSON.stringify(bundle.ir));
  writeFileSync(join(out,"report.json"),JSON.stringify(bundle.report,null,2));
  writeFileSync(join(out,"profile.json"),JSON.stringify(model.profile,null,2));
  writeFileSync(join(out,"dimensions.json"),JSON.stringify(dimensionReport(bundle),null,2));
  writeEnvelopePreviews(model,out);
  return bundle;
}

export async function verifyEnvelope(out) {
  const verification=join(out,"verification.json");
  writeFileSync(verification,JSON.stringify({status:"FAIL",failures:["Verification incomplete"]},null,2));
  try {
    const bundle=generateGeometry(await buildEnvelopeModel());
    const files=[["car.glb",bundle.glb],["ir.json",JSON.stringify(bundle.ir)],["report.json",JSON.stringify(bundle.report,null,2)],
      ["profile.json",JSON.stringify(bundle.model.profile,null,2)],["dimensions.json",JSON.stringify(dimensionReport(bundle),null,2)]];
    const failures=meshFailures(bundle.report,DOOR_IDS);
    for(const [file,value] of files) if(!readFileSync(join(out,file)).equals(Buffer.from(value))) failures.push(`${file}: stale or corrupted`);
    const bytes=readFileSync(join(out,"car.glb"));
    failures.push(...glbContractFailures(bytes,bundle.parts,bundle.doorDefs,VIEW));
    const {json}=readGlb(bytes);
    if(JSON.stringify(json.extras.vehicleGeometryProfile)!==JSON.stringify(bundle.model.profile)) failures.push("GLB profile provenance mismatch");
    const metrics=dimensionReport(bundle);
    for(const [key,metric] of Object.entries(metrics.dimensions)) if(Math.abs(metric.errorMm)>1e-6) failures.push(`${key}: ${metric.errorMm} mm deviation`);
    for(const [key,metric] of Object.entries(metrics.glbFloat32)) if(Math.abs(metric.errorMm)>2*POLICY.glbPositionMetres*1000) failures.push(`${key}: encoded GLB ${metric.errorMm} mm deviation`);
    const result=await validator.validateBytes(new Uint8Array(bytes),{uri:"car.glb",maxIssues:1000});
    if(result.issues.numErrors||result.issues.numWarnings) failures.push(`Khronos ${result.issues.numErrors} errors / ${result.issues.numWarnings} warnings`);
    requireValid(failures);
    // Actual Anatomy recorder: exact prism/lathe inputs, no envelope proxy for the curved parts.
    const audit=bundle.model.anatomy.A.auditOrExit(bundle.model.sc.R,bundle.model.P,{argv:["--audit"]});
    requireValid(bundle.model.anatomy.A.failures(audit) ? ["Anatomy audit failed"] : []);
    const sweep=sweepDoors(bundle), collisions=collisionFailures(sweep);
    const report={status:collisions.length?"FAIL":"PASS",policy:POLICY,anatomyAudit:{failures:bundle.model.anatomy.A.failures(audit)},dimensions:metrics,gltf:result.issues,sweep,failures:collisions};
    writeFileSync(verification,JSON.stringify(report,null,2));
    requireValid(collisions);
    console.log(`Envelope PASS: ${bundle.report.parts} parts / ${bundle.report.triangles} triangles; four rigid doors, observed envelope, GLB, audit and sampled collision checks.`);
    return report;
  } catch(error) {
    writeFileSync(verification,JSON.stringify({status:"FAIL",failures:[error.message]},null,2));
    throw error;
  }
}
