import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildInspectionComponents,INSPECTION_LAYOUT} from '../inspection-components.mjs';
import {buildServiceComponents} from '../service-components.mjs';
import {buildFrontCompartment,measureHoodSurface,panelStats} from '../front-compartment.mjs';
import {HOOD_SAMPLE_GRID} from '../front-compartment-layout.mjs';
import {buildFrunk,frunkPose,signedVolume} from '../frunk.mjs';
import {frunkGlb} from '../frunk-glb.mjs';
import {glbParts} from '../anatomy-svg.mjs';
import {meshClearance,staticScene,trianglesIntersect} from '../collision.mjs';

const shell=buildFrontCompartment({hoodSurface:{...HOOD_SAMPLE_GRID,z:HOOD_SAMPLE_GRID.y.map(()=>HOOD_SAMPLE_GRID.x.map(()=>105))}});
const model=buildInspectionComponents(shell);
test('four ordered opt-in targets preserve washer/reservation builder and confidence boundaries',()=>{
  const old=buildServiceComponents(shell);
  assert.deepEqual(model.replacesReservations,['coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box']);
  assert.deepEqual(buildInspectionComponents(shell),model);
  assert.equal(model.parts.length,10);
  assert.deepEqual(buildServiceComponents(shell),old);
  assert.equal(old.reservations.length,5);
  assert.equal(old.reservations.filter(p=>!model.replacesReservations.includes(p.id))[0].id,'lcw-coolant-reservoir');
  for(const p of model.parts) {
    assert.ok(model.replacesReservations.includes(p.meta.inspectionTarget));
    assert.equal(p.meta.existenceConfidence,'CONFIRMED');assert.equal(p.meta.dimensionConfidence,'ESTIMATED');
    assert.equal(p.meta.geometryConfidence,'ESTIMATED_GEOMETRY');assert.equal(p.meta.variantPlacementConfidence,'UNVERIFIED');
    assert.equal(p.meta.mountingConfidence,'UNVERIFIED');assert.ok(p.meta.source[0].includes('hyundai.co.uk'));
    assert.equal(p.moving,false);
  }
  assert.throws(()=>buildInspectionComponents(),/measured shell/);
  const low={zones:shell.zones.map(z=>({...z,box:{...z.box,max:[z.box.max[0],z.box.max[1],75]}}))};
  assert.throws(()=>buildInspectionComponents(low),/outside measured service zone/);
});
test('closed outward manifolds, no degeneracy or nonadjacent self intersections',()=>{
  for(const p of model.parts) {
    assert.equal(panelStats(p).degenerate,0,p.id); assert.ok(signedVolume(p.triangles)>0,p.id);
    const edges=new Map(),tris=[],point=i=>Array.from(p.triangles.slice(i,i+3)),key=v=>v.map(n=>n.toFixed(6)).join(',');
    for(let i=0;i<p.triangles.length;i+=9) {
      const tri=[point(i),point(i+3),point(i+6)];tris.push(tri);
      for(let k=0;k<3;k++){const a=key(tri[k]),b=key(tri[(k+1)%3]),id=[a,b].sort().join('|'),v=edges.get(id)??{n:0,d:0};v.n++;v.d+=a<b?1:-1;edges.set(id,v);}
    }
    for(const v of edges.values()) assert.deepEqual(v,{n:2,d:0},p.id);
    for(let i=0;i<tris.length;i++) for(let j=i+1;j<tris.length;j++) {
      if(tris[i].some(a=>tris[j].some(b=>key(a)===key(b)))) continue;
      assert.equal(trianglesIntersect(tris[i],tris[j]),false,p.id+' nonadjacent self intersection');
    }
  }
});
test('distinct solids have disjoint bounds and positive seams: no hidden full containment',()=>{
  const all=[...model.parts,...buildServiceComponents(shell).parts],stats=all.map(panelStats);
  for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++) {
    assert.ok([0,1,2].some(k=>stats[i].max[k]<stats[j].min[k]||stats[j].max[k]<stats[i].min[k]),`${all[i].id}/${all[j].id}`);
    assert.equal(meshClearance(all[i].triangles,staticScene([all[j]]),{cutoff:1}).intersectingPairs,0);
  }
});
test('GLB cm/metre/axis round trip keeps fixed service parts and moving frunk independent',()=>{
  const f=buildFrunk(shell);
  for(const deg of [0,30,60]) {
    const actual=glbParts(frunkGlb(shell,f,deg,model.parts));
    for(const p of [...model.parts,...frunkPose(f,deg)]) {
      const T=actual.find(n=>n.name===p.id).triangles;assert.equal(T.length,p.triangles.length);
      for(let i=0;i<T.length;i++) assert.ok(Math.abs(T[i]-p.triangles[i])<0.0001,p.id);
    }
  }
});
test('report refuses model-derived output inside repo before opening source',()=>{
  for(const out of ['tools/tmp-inspection','..inspection-output']) {
    const r=spawnSync(process.execPath,['tools/ioniq5-asset/inspection-components-report.mjs','--glb=missing','--axes=missing','--out='+out],{encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/Refusing model-derived output/);
  }
});
test('real GLB: all four parts clear original closed hood/body, shell, frunk, washer and LCW', {skip:!process.env.IONIQ5_GLB},()=>{
  const nodes=glbParts(readFileSync(process.env.IONIQ5_GLB)),hood=nodes.find(n=>n.name==='Door_Front_0');
  const s=buildFrontCompartment({hoodSurface:measureHoodSurface(hood.triangles)}),old=buildServiceComponents(s),m=buildInspectionComponents(s);
  const scene=staticScene([...nodes,...s.panels,...buildFrunk(s).parts,...old.parts,...old.reservations.filter(p=>!m.replacesReservations.includes(p.id))]);
  for(const p of m.parts) assert.equal(meshClearance(p.triangles,scene,{cutoff:2}).intersectingPairs,0,p.id);
  for(const layout of INSPECTION_LAYOUT) assert.ok(m.parts.some(p=>p.id===layout.id));
});
