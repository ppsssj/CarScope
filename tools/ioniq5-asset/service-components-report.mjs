#!/usr/bin/env node
// node tools/ioniq5-asset/service-components-report.mjs --glb=<local GLB> --axes=<P3-A1 JSON> --out=<external dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve,relative,isAbsolute,dirname,join,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { glbParts, buildIoniqSvg } from './anatomy-svg.mjs';
import { fitMeshProjection } from '../anatomy-car/mesh-svg/mesh-svg.mjs';
import { buildFrontCompartment, measureHoodSurface, panelStats } from './front-compartment.mjs';
import { buildFrunk,frunkPose } from './frunk.mjs';
import { frunkGlb } from './frunk-glb.mjs';
import { buildServiceComponents,SERVICE_EVIDENCE } from './service-components.mjs';
import { meshClearance,staticScene } from './collision.mjs';
import { HOOD_NODE,rotatePoints,axisCandidates } from './hood.mjs';
import { hoodHierarchy } from './hood-feasibility.mjs';

const sha=(b)=>createHash('sha256').update(b).digest('hex');
export async function main(argv){
  const args=Object.fromEntries(argv.map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
  if(!args.glb||!args.axes||!args.out)throw Error('usage: service-components-report.mjs --glb=<local GLB> --axes=<P3-A1 JSON> --out=<external dir>');
  const out=resolve(args.out),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,out);
  if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Refusing model-derived output inside the CarScope repo');
  const bytes=readFileSync(args.glb), nodes=glbParts(bytes),hood=nodes.find(n=>n.name===HOOD_NODE).triangles;
  const prior=JSON.parse(readFileSync(args.axes,'utf8'));assert.equal(prior.glbSha256,sha(bytes));
  const hierarchy=hoodHierarchy(bytes),A=axisCandidates({hoodTriangles:hood,groupOriginCm:hierarchy.group.originCm,groupLateralCm:hierarchy.lateralAxisCar}).candidates.find(a=>a.id==='A');
  const C=prior.candidates.find(a=>a.id==='C');assert.ok(C);
  const shell=buildFrontCompartment({hoodSurface:measureHoodSurface(hood)}),frunk=buildFrunk(shell),s=buildServiceComponents(shell),all=[...s.parts,...s.reservations];
  const checks=[], check=(label,T,scene,extra={})=>{
    const c=meshClearance(T,scene,{cutoff:10}),within=c.minDistanceCm!==null&&c.minDistanceCm<=10;
    const r={label,...extra,method:c.method,crossings:c.intersectingPairs,minCm:within?c.minDistanceCm:null,distanceBoundCm:10,closest:within?c.closest?.mesh:null};checks.push(r);return r;
  };
  const scenes={source:staticScene(nodes.filter(n=>n.name!==HOOD_NODE)),shell:staticScene(shell.panels),frunk:staticScene(frunk.parts)};
  for(const p of all)for(const [against,scene]of Object.entries(scenes))check(p.id,p.triangles,scene,{against});
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)check(all[i].id,all[i].triangles,staticScene([all[j]]),{against:all[j].id});
  const ss=staticScene(all);
  for(const a of [A,C])for(let d=0;d<=60;d++)check('hood vs services',rotatePoints(hood,a,d),ss,{axis:a.id,deg:d});
  for(let d=0;d<=60;d++)for(const p of frunkPose(frunk,d).filter(p=>p.moving))check(p.id+' vs services',p.triangles,ss,{deg:d});
  const stats=all.map(panelStats),failures=checks.filter(c=>c.crossings).length+stats.filter(s=>s.degenerate).length;
  console.log(JSON.stringify({phase:'triangles',checks:checks.length,failures,failed:checks.filter(c=>c.crossings).slice(0,8)}));
  mkdirSync(join(out,'svg'),{recursive:true});
  const validator=createRequire(import.meta.url)('../anatomy-car/node_modules/gltf-validator'),glbs=[];
  for(const deg of [0,60]){
    const glb=frunkGlb(shell,frunk,deg,s.parts),v=await validator.validateBytes(new Uint8Array(glb),{maxIssues:100});
    assert.equal(v.issues.numErrors+v.issues.numWarnings,0);
    const actual=glbParts(glb);let delta=0;
    for(const p of [...shell.panels,...frunkPose(frunk,deg),...s.parts]){const T=actual.find(n=>n.name===p.id).triangles;assert.equal(T.length,p.triangles.length);for(let i=0;i<T.length;i++)delta=Math.max(delta,Math.abs(T[i]-p.triangles[i]));}
    assert.ok(delta<0.0001);const file=`shell-frunk-services-${deg}.glb`;writeFileSync(join(out,file),glb);glbs.push({file,sha256:sha(glb),errors:v.issues.numErrors,warnings:v.issues.numWarnings,maxVertexDeltaCm:delta});
  }
  const reference=await buildIoniqSvg(bytes),projection=fitMeshProjection([...nodes,{triangles:rotatePoints(hood,A,60)},...frunkPose(frunk,60)],reference.anatomy.k);
  const frames=[],svgs={};
  for(const [label,h,c,include,debug]of [['closed-baseline',0,0,false,false],['closed-services',0,0,true,false],['hood45-cover0',45,0,true,false],['hood60-cover60',60,60,true,false],['reservations-debug',60,0,true,true]]){
    const ns=[...nodes.map(n=>n.name===HOOD_NODE?{...n,triangles:rotatePoints(n.triangles,A,h)}:n),...shell.panels,...frunkPose(frunk,c),...(include?s.parts:[]),...(debug?s.reservations:[])];
    const opts={nodes:ns,...(h?{projection}:{})},b=await buildIoniqSvg(bytes,opts);svgs[label]=b.svg;writeFileSync(join(out,'svg',label+'.svg'),b.svg);
    frames.push({label,bytes:Buffer.byteLength(b.svg),sha256:sha(b.svg),visibleServiceIds:[...new Set(b.result.fills.map(f=>f.id))].filter(id=>all.some(p=>p.id===id))});
    if(label==='hood45-cover0')assert.equal((await buildIoniqSvg(bytes,opts)).svg,b.svg);
  }
  const report={glbSha256:sha(bytes),evidence:SERVICE_EVIDENCE,stats,meta:all.map(p=>p.meta),checks,failures,glbs,svg:{frames,closedIdentical:svgs['closed-baseline']===svgs['closed-services'],originalClosedIdentical:svgs['closed-services']===reference.svg,deterministic:true},note:'Reservations are not real parts. Integer 1 degree samples are not a continuous collision proof. minCm=null means >=distanceBoundCm. Model-derived surface data stays external.'};
  writeFileSync(join(out,'service-components.json'),JSON.stringify(report,null,2)+'\n');
  assert.equal(failures,0);assert.ok(report.svg.closedIdentical);assert.ok(report.svg.originalClosedIdentical);assert.ok(frames.find(f=>f.label==='hood45-cover0').visibleServiceIds.includes('washer-fluid-cap'));
  console.log(`PASS ${checks.length} triangle checks; closed SVG identical; GLB 0/0`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
