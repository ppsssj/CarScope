#!/usr/bin/env node
// External evidence only, using the unchanged source and existing collision implementation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {glbParts,buildIoniqSvg} from './anatomy-svg.mjs';
import {buildEvBatteryPack} from './ev-battery.mjs';
import {evBatteryGlb} from './ev-battery-glb.mjs';
import {panelStats,buildFrontCompartment,measureHoodSurface} from './front-compartment.mjs';
import {buildFrunk,frunkPose} from './frunk.mjs';
import {buildServiceComponents} from './service-components.mjs';
import {buildInspectionComponents} from './inspection-components.mjs';
import {staticScene,meshClearance} from './collision.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function main(argv) {
  const args=Object.fromEntries(argv.map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
  if(!args.glb||!args.out) throw Error('usage: ev-battery-report.mjs --glb=<source GLB> --out=<external directory>');
  const out=resolve(args.out),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,out);
  if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))) throw Error('Refusing model-derived output inside the CarScope repo');
  const bytes=readFileSync(args.glb),nodes=glbParts(bytes),model=buildEvBatteryPack(),pack=model.parts[0];
  assert.ok(!nodes.some(n=>/batter|hv_|cell|pack/i.test(n.name)),'separate battery already present; review duplicate before adding');
  const shell=buildFrontCompartment({hoodSurface:measureHoodSurface(nodes.find(n=>n.name==='Door_Front_0').triangles)});
  const frunk=buildFrunk(shell),service=buildServiceComponents(shell),inspection=buildInspectionComponents(shell);
  const checks=[];
  const check=(label,parts)=>{
    const result=meshClearance(pack.triangles,staticScene(parts),{cutoff:5});
    // In addition to surface intersections, disjoint AABBs exclude full containment.
    const separated=parts.every(p=>{const s=panelStats(p);return [0,1,2].some(k=>s.max[k]<model.bounds.min[k]||s.min[k]>model.bounds.max[k]);});
    assert.equal(result.intersectingPairs,0,label);assert.ok(separated,label+' AABB separation');
    checks.push({label,method:result.method,intersectingPairs:result.intersectingPairs,minCm:result.minDistanceCm,cutoffCm:5,aabbSeparated:separated});
  };
  check('all 44 source meshes, including closed hood and four wheels',nodes);
  check('estimated shell / service / inspection / reservations',[...shell.panels,...service.parts,...service.reservations,...inspection.parts]);
  for(const deg of [0,30,60]) check('frunk '+deg,frunkPose(frunk,deg));
  const glb=evBatteryGlb(),validator=createRequire(import.meta.url)('../anatomy-car/node_modules/gltf-validator');
  const validation=await validator.validateBytes(new Uint8Array(glb),{maxIssues:100});
  assert.equal(validation.issues.numErrors+validation.issues.numWarnings,0);
  const roundtrip=glbParts(glb)[0];let delta=0;
  pack.triangles.forEach((v,k)=>delta=Math.max(delta,Math.abs(v-roundtrip.triangles[k])));assert.ok(delta<0.0001);
  const svg=await buildIoniqSvg(bytes,{nodes:model.parts});
  assert.equal(sha(readFileSync(args.glb)),sha(bytes),'source unchanged');
  const report={sourceSha256:sha(bytes),sourceMeshes:nodes.map(n=>({name:n.name,...panelStats(n),trianglesSha256:sha(Buffer.from(n.triangles.buffer))})),
    model:{bounds:model.bounds,layout:model.layout,meta:pack.meta,stats:panelStats(pack)},checks,
    glb:{sha256:sha(glb),errors:validation.issues.numErrors,warnings:validation.issues.numWarnings,maxVertexDeltaCm:delta},
    svg:{sha256:sha(svg.svg)},failures:0,note:'Static reference only. Frunk 0/30/60 degree samples are not continuous collision proof. null minimum means no pair within cutoff. No OEM geometry or runtime SDK validation.'};
  mkdirSync(out,{recursive:true});writeFileSync(join(out,'ev-battery.glb'),glb);writeFileSync(join(out,'ev-battery.svg'),svg.svg);
  writeFileSync(join(out,'ev-battery.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
