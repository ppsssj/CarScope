import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import{spawnSync}from'node:child_process';
import {measureFrontWiperSupport,buildFrontWiperGeometry,FRONT_WIPER_IDS} from '../front-wiper.mjs';
import {frontWiperGlb} from '../front-wiper-glb.mjs';import {auditExteriorLights} from '../exterior-light-audit.mjs';
import {panelStats} from '../front-compartment.mjs';import{signedVolume}from'../frunk.mjs';
import{glbParts}from'../anatomy-svg.mjs';import{readGlb}from'../analyze.mjs';import{meshClearance,staticScene,trianglesIntersect}from'../collision.mjs';
const plane=(x,y)=>[x,y,170-.55*x],glass={name:'Body_Glass',triangles:Float64Array.from([[80,-80],[112,-80],[112,80],[80,-80],[112,80],[80,80]].flatMap(([x,y])=>plane(x,y)))};
const hood={name:'Door_Front_0',triangles:Float64Array.from([120,-60,100,220,-60,100,220,60,100])},source=[glass,hood],support=measureFrontWiperSupport(source),model=buildFrontWiperGeometry({support});
test('requires measured full glass/cowl support; malformed/missing reference fails explicitly',()=>{
  assert.throws(()=>buildFrontWiperGeometry(),/measured/);assert.throws(()=>measureFrontWiperSupport([]),/source meshes/);
  assert.throws(()=>measureFrontWiperSupport([hood]),/windshield/);assert.throws(()=>measureFrontWiperSupport([{triangles:[NaN]}]),/invalid/);
  assert.throws(()=>buildFrontWiperGeometry({support:{vertices:[]}}),/incomplete/);
  assert.throws(()=>measureFrontWiperSupport([{...glass,triangles:Float64Array.from([0,0,110,1,0,110,0,1,110])},hood]),/outside front glass/);
});
test('two stable physical-side IDs, shared inspection target and static estimated contract',()=>{
  assert.deepEqual(model.parts.map(p=>p.id),FRONT_WIPER_IDS);assert.deepEqual(model.joints,[]);
  for(const [i,p]of model.parts.entries()){assert.equal(p.meta.partId,p.id);assert.equal(p.meta.inspectionTarget,'wiper.front');assert.equal(p.moving,false);
    assert.equal(p.meta.geometryConfidence,'ESTIMATED_GEOMETRY');assert.equal(p.meta.hingeConfidence,'UNVERIFIED');assert.equal(p.meta.pose,'STATIC_REST_ILLUSTRATION');assert.equal(p.source.length,2);
    assert.deepEqual(p.bounds.min,panelStats(p).min);assert.deepEqual(p.bounds.max,panelStats(p).max);assert.equal(p.bounds.unit,'cm');
    assert.ok(i===0?p.bounds.min[1]>0:p.bounds.max[1]<0);assert.equal(p.components.length,2);}
  const copy=buildFrontWiperGeometry({support});copy.parts[0].triangles[0]=999;copy.bounds.min[0]=999;assert.deepEqual(buildFrontWiperGeometry({support}),model);
});
test('arm/blade are separately watertight outward envelopes, no degeneracy or intersections',()=>{
  for(const p of model.parts)for(const comp of p.components){const T=comp.triangles,edges=new Map(),tris=[],key=v=>v.map(x=>x.toFixed(7)).join(',');assert.equal(panelStats(comp).degenerate,0);assert.ok(signedVolume(T)>0);
    for(let i=0;i<T.length;i+=9){const t=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3)));tris.push(t);for(let j=0;j<3;j++){const a=key(t[j]),b=key(t[(j+1)%3]),id=[a,b].sort().join('|'),e=edges.get(id)??{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(id,e);}}
    for(const e of edges.values())assert.deepEqual(e,{n:2,d:0});
    for(let i=0;i<tris.length;i++)for(let j=i+1;j<tris.length;j++){if(tris[i].some(a=>tris[j].some(b=>key(a)===key(b))))continue;assert.equal(trianglesIntersect(tris[i],tris[j]),false);}}
  const all=model.parts.flatMap(p=>p.components);for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)assert.equal(meshClearance(all[i].triangles,staticScene([all[j]]),{cutoff:3}).intersectingPairs,0);
});
test('GLB Khronos 0/0, deterministic cm-m-axis round trip, winding and normals',async()=>{
  const bytes=frontWiperGlb(model),v=await createRequire(import.meta.url)('../../anatomy-car/node_modules/gltf-validator').validateBytes(new Uint8Array(bytes),{});assert.equal(v.issues.numErrors+v.issues.numWarnings,0);assert.deepEqual(frontWiperGlb(model),bytes);
  const decoded=glbParts(bytes),{json,accessor}=readGlb(bytes);
  for(const p of model.parts){const d=decoded.find(n=>n.name===p.id);p.triangles.forEach((x,k)=>assert.ok(Math.abs(x-d.triangles[k])<.0001));assert.ok(signedVolume(d.triangles)>0);const n=json.nodes.find(n=>n.name===p.id);assert.deepEqual(n.extras,p.meta);
    const prim=json.meshes[n.mesh].primitives[0],pos=accessor(prim.attributes.POSITION),nor=accessor(prim.attributes.NORMAL);
    for(let i=0;i<pos.length;i+=9){const a=[0,1,2].map(k=>pos[i+3+k]-pos[i+k]),b=[0,1,2].map(k=>pos[i+6+k]-pos[i+k]),c=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];assert.ok(c.reduce((s,x,k)=>s+x*nor[i+k],0)>0);assert.ok(Math.abs(Math.hypot(...nor.slice(i,i+3))-1)<1e-6);}}
});
test('lighting audit preserves source IDs and distinguishes flat emitter marker from housing region',()=>{
  const rows=auditExteriorLights([{name:'Light_Low_Beam_Left_0',triangles:Float64Array.from([200,40,80,200,50,80,200,50,85,200,40,80,200,50,85,200,40,85]),materials:['Lamp_Projector','Lamp_Projector']}]);
  assert.equal(rows[0].partId,'light-low-beam-left-0');assert.equal(rows[0].geometryKind,'PLANAR_EMITTER_MARKER');assert.equal(rows[0].triangles,2);
  const tilted=auditExteriorLights([{name:'Light_License_Plate_0',triangles:Float64Array.from([200,40,80,201,50,80,202,50,85,200,40,80,202,50,85,201,40,85]),materials:['Lamp_White','Lamp_White']}]);assert.equal(tilted[0].geometryKind,'PLANAR_EMITTER_MARKER');
});
test('report refuses repository output before reading missing source',()=>{const r=spawnSync(process.execPath,['tools/ioniq5-asset/front-wiper-report.mjs','--glb=missing','--out=tools/tmp-wiper'],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/Refusing model-derived output/);});
test('real GLB: entire source clear, side IDs disjoint, lights retained, bytes unchanged',{skip:!process.env.IONIQ5_GLB},()=>{
  const b=readFileSync(process.env.IONIQ5_GLB),nodes=glbParts(b);assert.equal(nodes.length,44);assert.ok(!nodes.some(p=>/wiper|blade/i.test(p.name)));
  const m=buildFrontWiperGeometry({support:measureFrontWiperSupport(nodes)}),scene=staticScene(nodes);
  for(const p of m.parts){const c=meshClearance(p.triangles,scene,{cutoff:3});assert.equal(c.intersectingPairs,0);assert.ok(c.minDistanceCm>=.2);}
  const rows=auditExteriorLights(nodes).filter(p=>/Light_(Low|High)_Beam/.test(p.sourceName));assert.equal(rows.length,4);assert.ok(rows.every(p=>p.geometryKind==='PLANAR_EMITTER_MARKER'));
  assert.deepEqual(readFileSync(process.env.IONIQ5_GLB),b);
});
