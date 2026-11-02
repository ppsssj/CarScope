#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {glbParts,buildIoniqSvg} from './anatomy-svg.mjs';
import {readGlb} from './analyze.mjs';
import {measureEvChargePortSupport,buildEvChargePort} from './ev-charge-port.mjs';
import {evChargePortGlb} from './ev-charge-port-glb.mjs';
import {panelStats,buildFrontCompartment,measureHoodSurface} from './front-compartment.mjs';
import {buildFrunk,frunkPose} from './frunk.mjs';
import {buildServiceComponents} from './service-components.mjs';
import {buildInspectionComponents} from './inspection-components.mjs';
import {buildEvBatteryPack} from './ev-battery.mjs';
import {meshClearance,staticScene} from './collision.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function main(argv) {
  const args=Object.fromEntries(argv.map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
  if(!args.glb||!args.out)throw Error('usage: ev-charge-port-report.mjs --glb=<source> --out=<external dir>');
  const out=resolve(args.out),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,out);
  if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Refusing model-derived output inside the CarScope repo');
  const bytes=readFileSync(args.glb),nodes=glbParts(bytes),{json}=readGlb(bytes);
  assert.equal(nodes.length,44,'review different reference model before placement');assert.ok(!json.nodes.some(n=>/charg|port|flap/i.test(n.name)),'review potential duplicate first');
  const support=measureEvChargePortSupport(nodes),model=buildEvChargePort({support});
  const shell=buildFrontCompartment({hoodSurface:measureHoodSurface(nodes.find(n=>n.name==='Door_Front_0').triangles)}),frunk=buildFrunk(shell);
  const service=buildServiceComponents(shell);
  const scenes=[['entire source',nodes],['battery / shell / service / inspection',[...buildEvBatteryPack().parts,...shell.panels,...service.parts,...service.reservations,...buildInspectionComponents(shell).parts]],
    ...[0,30,60].map(deg=>['frunk '+deg,frunkPose(frunk,deg)])];
  const checks=[];
  for(const [label,parts]of scenes){const scene=staticScene(parts);for(const p of model.parts){const c=meshClearance(p.triangles,scene,{cutoff:5});
    assert.equal(c.intersectingPairs,0,p.id+'/'+label);
    if(label==='entire source')assert.ok(c.minDistanceCm>=0.19,p.id+' exterior stand-off');
    checks.push({part:p.id,against:label,method:c.method,crossings:c.intersectingPairs,minCm:c.minDistanceCm,cutoffCm:5,contactPairs:Object.values(c.byRegion).reduce((s,r)=>s+r.contactPairs,0)});}}
  const between=meshClearance(model.parts[0].triangles,staticScene([model.parts[1]]),{cutoff:5});assert.equal(between.intersectingPairs,0);assert.ok(between.minDistanceCm>0);
  const glb=evChargePortGlb(model),validator=createRequire(import.meta.url)('../anatomy-car/node_modules/gltf-validator'),v=await validator.validateBytes(new Uint8Array(glb),{});
  assert.equal(v.issues.numErrors+v.issues.numWarnings,0);const actual=glbParts(glb);let delta=0;
  for(const p of model.parts){assert.equal(panelStats(p).degenerate,0);const T=actual.find(n=>n.name===p.id).triangles;assert.equal(T.length,p.triangles.length);p.triangles.forEach((x,k)=>delta=Math.max(delta,Math.abs(x-T[k])));}
  assert.ok(delta<0.0001);const svg=await buildIoniqSvg(bytes,{nodes:model.parts});
  const report={sourceSha256:sha(bytes),hierarchy:json.nodes.map(n=>({name:n.name,mesh:n.mesh,children:n.children})),sourceMeshes:nodes.map(n=>({name:n.name,...panelStats(n),sha256:sha(Buffer.from(n.triangles.buffer))})),
    support,model:{bounds:model.bounds,layout:model.layout,parts:model.parts.map(p=>({id:p.id,bounds:p.bounds,meta:p.meta,...panelStats(p)}))},checks,
    pair:{crossings:between.intersectingPairs,minCm:between.minDistanceCm},
    contactPolicy:'The source support plane is a tangent reference, not a physical mount. Visible overlays start 0.2 cm outward to avoid z-fighting. No collision exemptions; crossings forbidden. A nested aperture/flap gap prevents solid containment. No body cut or socket cavity.',
    glb:{sha256:sha(glb),errors:v.issues.numErrors,warnings:v.issues.numWarnings,maxVertexDeltaCm:delta},svg:{sha256:sha(svg.svg)},failures:0,
    note:'Original source unmodified. Static CLOSED illustration only. Three frunk angle samples are not continuous collision proof. null min means outside 5 cm cutoff. OEM geometry, actual hinge and SDK runtime NOT_RUN.'};
  assert.equal(sha(readFileSync(args.glb)),report.sourceSha256);
  mkdirSync(out,{recursive:true});writeFileSync(join(out,'ev-charge-port.glb'),glb);writeFileSync(join(out,'ev-charge-port.svg'),svg.svg);writeFileSync(join(out,'ev-charge-port.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({support,bounds:model.bounds,checks,glb:report.glb,failures:0}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
