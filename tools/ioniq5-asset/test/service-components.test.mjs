import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildServiceComponents, SERVICE_EVIDENCE, WASHER_GUIDANCE } from '../service-components.mjs';
import { buildFrontCompartment, panelStats, measureHoodSurface } from '../front-compartment.mjs';
import { HOOD_SAMPLE_GRID } from '../front-compartment-layout.mjs';
import { buildFrunk, frunkPose, signedVolume } from '../frunk.mjs';
import { glbParts } from '../anatomy-svg.mjs';
import { frunkGlb } from '../frunk-glb.mjs';
import { meshClearance, staticScene } from '../collision.mjs';

const shell=buildFrontCompartment({hoodSurface:{...HOOD_SAMPLE_GRID,z:HOOD_SAMPLE_GRID.y.map(()=>HOOD_SAMPLE_GRID.x.map(()=>105))}});
const services=buildServiceComponents(shell), f=buildFrunk(shell);
test('washer priority stage has stable cap/body ids; five other items are explicit reservations',()=>{
  assert.deepEqual(services.parts.map(p=>p.id),['washer-fluid-filler','washer-fluid-cap']);
  assert.equal(services.reservations.length,5);
  assert.equal(SERVICE_EVIDENCE.length,6);
  assert.ok(WASHER_GUIDANCE.includes('점검 대상'));
  for(const p of [...services.parts,...services.reservations]){
    assert.equal(p.meta.existenceConfidence,'CONFIRMED'); assert.equal(p.meta.variantPlacementConfidence,'UNVERIFIED');
    assert.equal(p.meta.positionConfidence,'ESTIMATED_GEOMETRY'); assert.ok(p.meta.source[0].includes('hyundai.co.uk'));
  }
  assert.ok(services.reservations.every(p=>p.reservation&&p.meta.shapeConfidence==='UNVERIFIED'&&p.meta.geometryConfidence==='SYNTHETIC_DEBUG_PLACEHOLDER'));
  assert.deepEqual(buildServiceComponents(shell),services);
  assert.throws(()=>buildServiceComponents(),/measured shell/);
});
test('washer material shells are closed/outward with no degenerate triangles; independent cap has gap',()=>{
  for(const p of services.parts){
    assert.equal(panelStats(p).degenerate,0); assert.ok(signedVolume(p.triangles)>0);
    const edges=new Map(), point=(i)=>Array.from(p.triangles.slice(i,i+3)).map(n=>n.toFixed(6)).join(',');
    for(let i=0;i<p.triangles.length;i+=9)for(let k=0;k<3;k++){const a=point(i+3*k),b=point(i+3*((k+1)%3)),key=[a,b].sort().join('|'),v=edges.get(key)??{n:0,d:0};v.n++;v.d+=a<b?1:-1;edges.set(key,v);}
    for(const v of edges.values())assert.deepEqual(v,{n:2,d:0});
  }
  const gap=meshClearance(services.parts[0].triangles,staticScene([services.parts[1]]),{cutoff:2});
  assert.equal(gap.intersectingPairs,0); assert.ok(Math.abs(gap.minDistanceCm-0.3)<1e-8);
});
test('service GLB round trip preserves stable id, units, source confidence, and stationary service geometry',()=>{
  for(const deg of [0,60]){
    const actual=glbParts(frunkGlb(shell,f,deg,services.parts));
    for(const p of [...services.parts,...frunkPose(f,deg)]){const T=actual.find(n=>n.name===p.id).triangles; assert.equal(T.length,p.triangles.length);for(let i=0;i<T.length;i++)assert.ok(Math.abs(T[i]-p.triangles[i])<0.0001);}
  }
});
test('service report refuses all repo outputs, including dot-dot-prefixed children',()=>{
  for(const out of ['tools/tmp-service','..service-output']){
    const r=spawnSync(process.execPath,['tools/ioniq5-asset/service-components-report.mjs','--glb=missing','--axes=missing','--out='+out],{encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/Refusing model-derived output/);
  }
});
test('real GLB: washer and reservations clear all original/shell/frunk meshes', {skip:!process.env.IONIQ5_GLB},()=>{
  const nodes=glbParts(readFileSync(process.env.IONIQ5_GLB)),hood=nodes.find(n=>n.name==='Door_Front_0');
  const s=buildFrontCompartment({hoodSurface:measureHoodSurface(hood.triangles)}),services=buildServiceComponents(s);
  const scene=staticScene([...nodes,...s.panels,...buildFrunk(s).parts]);
  for(const p of [...services.parts,...services.reservations])assert.equal(meshClearance(p.triangles,scene,{cutoff:2}).intersectingPairs,0,p.id);
});
