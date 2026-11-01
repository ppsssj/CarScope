#!/usr/bin/env node
// Geometry-only P3-A6 report. Original model and existing UI are never rewritten.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {glbParts,buildIoniqSvg} from './anatomy-svg.mjs';
import {fitMeshProjection} from '../anatomy-car/mesh-svg/mesh-svg.mjs';
import {buildFrontCompartment,measureHoodSurface,panelStats} from './front-compartment.mjs';
import {buildFrunk,frunkPose} from './frunk.mjs';
import {frunkGlb} from './frunk-glb.mjs';
import {buildServiceComponents,SERVICE_EVIDENCE} from './service-components.mjs';
import {buildInspectionComponents,INSPECTION_LAYOUT} from './inspection-components.mjs';
import {meshClearance,staticScene} from './collision.mjs';
import {HOOD_NODE,rotatePoints,axisCandidates} from './hood.mjs';
import {hoodHierarchy} from './hood-feasibility.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function main(argv) {
  const args=Object.fromEntries(argv.map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
  if(!args.glb||!args.axes||!args.out) throw Error('usage: inspection-components-report.mjs --glb=<local GLB> --axes=<P3-A1 JSON> --out=<external dir>');
  const out=resolve(args.out),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,out);
  if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))) throw Error('Refusing model-derived output inside the CarScope repo');
  const bytes=readFileSync(args.glb),nodes=glbParts(bytes),hood=nodes.find(n=>n.name===HOOD_NODE).triangles;
  const prior=JSON.parse(readFileSync(args.axes,'utf8')); assert.equal(prior.glbSha256,sha(bytes));
  const hierarchy=hoodHierarchy(bytes),A=axisCandidates({hoodTriangles:hood,groupOriginCm:hierarchy.group.originCm,groupLateralCm:hierarchy.lateralAxisCar}).candidates.find(a=>a.id==='A');
  const C=prior.candidates.find(a=>a.id==='C'); assert.ok(C);
  const shell=buildFrontCompartment({hoodSurface:measureHoodSurface(hood)}),frunk=buildFrunk(shell),legacy=buildServiceComponents(shell),inspection=buildInspectionComponents(shell);
  const parts=[...legacy.parts,...inspection.parts],reservations=legacy.reservations.filter(p=>!inspection.replacesReservations.includes(p.id)),all=[...parts,...reservations];
  const checks=[],check=(label,T,scene,extra={})=>{
    const c=meshClearance(T,scene,{cutoff:5});
    checks.push({label,...extra,method:c.method,crossings:c.intersectingPairs,minCm:c.minDistanceCm!==null&&c.minDistanceCm<=5?c.minDistanceCm:null,distanceBoundCm:5});
  };
  const scenes={source:staticScene(nodes.filter(n=>n.name!==HOOD_NODE)),shell:staticScene(shell.panels),frunk:staticScene(frunk.parts)};
  for(const p of all) for(const [against,scene]of Object.entries(scenes)) check(p.id,p.triangles,scene,{against});
  for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++) check(all[i].id,all[i].triangles,staticScene([all[j]]),{against:all[j].id});
  const scene=staticScene(all);
  for(const a of [A,C]) for(let deg=0;deg<=60;deg++) check('hood vs inspection',rotatePoints(hood,a,deg),scene,{axis:a.id,deg});
  for(let deg=0;deg<=60;deg++) for(const p of frunkPose(frunk,deg).filter(p=>p.moving)) check(p.id,p.triangles,scene,{deg});
  const stats=all.map(panelStats),failures=checks.filter(c=>c.crossings).length+stats.filter(s=>s.degenerate).length;
  console.log(JSON.stringify({checks:checks.length,failures,failed:checks.filter(c=>c.crossings).slice(0,12)}));
  mkdirSync(join(out,'svg'),{recursive:true});
  const validator=createRequire(import.meta.url)('../anatomy-car/node_modules/gltf-validator'),glbs=[];
  for(const deg of [0,60]) {
    const glb=frunkGlb(shell,frunk,deg,parts),v=await validator.validateBytes(new Uint8Array(glb),{maxIssues:100});
    assert.equal(v.issues.numErrors+v.issues.numWarnings,0);
    const actual=glbParts(glb);let delta=0;
    for(const p of [...shell.panels,...frunkPose(frunk,deg),...parts]) {
      const T=actual.find(n=>n.name===p.id).triangles; assert.equal(T.length,p.triangles.length);
      for(let i=0;i<T.length;i++) delta=Math.max(delta,Math.abs(T[i]-p.triangles[i]));
    }
    assert.ok(delta<0.0001); const file=`inspection-${deg}.glb`;writeFileSync(join(out,file),glb);
    glbs.push({file,sha256:sha(glb),errors:v.issues.numErrors,warnings:v.issues.numWarnings,maxVertexDeltaCm:delta});
  }
  // Same common triangles feed SVG, GLB and the browser preview.
  const reference=await buildIoniqSvg(bytes),projection=fitMeshProjection([...nodes,{triangles:rotatePoints(hood,A,60)},...frunkPose(frunk,60)],reference.anatomy.k),frames=[],svgs={};
  for(const [label,h,c,include]of [['closed-baseline',0,0,false],['closed-inspection',0,0,true],['hood45-cover0',45,0,true],['hood60-cover60',60,60,true]]) {
    const ns=[...nodes.map(n=>n.name===HOOD_NODE?{...n,triangles:rotatePoints(n.triangles,A,h)}:n),...shell.panels,...frunkPose(frunk,c),...legacy.parts,...(include?inspection.parts:[])];
    const opts={nodes:ns,...(h?{projection}:{})},b=await buildIoniqSvg(bytes,opts);svgs[label]=b.svg;writeFileSync(join(out,'svg',label+'.svg'),b.svg);
    frames.push({label,sha256:sha(b.svg),visibleIds:[...new Set(b.result.fills.map(f=>f.id))].filter(id=>parts.some(p=>p.id===id))});
    if(h===45) assert.equal((await buildIoniqSvg(bytes,opts)).svg,b.svg);
  }
  const report={glbSha256:sha(bytes),axesFileSha256:sha(readFileSync(args.axes)),axes:[A,C],layout:INSPECTION_LAYOUT,evidence:SERVICE_EVIDENCE,stats,meta:parts.map(p=>p.meta),checks,failures,glbs,
    svg:{frames,closedIdentical:svgs['closed-baseline']===svgs['closed-inspection'],originalClosedIdentical:svgs['closed-inspection']===reference.svg,deterministic:true},
    note:'All new dimensions ESTIMATED. LCW reservation only. No OEM dimensions or variant-side verification. Integer 1 degree samples are not continuous collision proof. minCm=null means >=distanceBoundCm. No mounts, hoses or electrical simulation.'};
  writeFileSync(join(out,'inspection-components.json'),JSON.stringify(report,null,2)+'\n');
  assert.equal(sha(readFileSync(args.glb)),report.glbSha256,'source GLB unchanged');
  assert.equal(failures,0);assert.ok(report.svg.closedIdentical);assert.ok(report.svg.originalClosedIdentical);
  for(const p of INSPECTION_LAYOUT) assert.ok(frames.some(f=>f.visibleIds.includes(p.id)),p.id+' visible in open SVG');
  console.log(`PASS ${checks.length} exact triangle checks; closed SVG identical; GLB 0/0`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
