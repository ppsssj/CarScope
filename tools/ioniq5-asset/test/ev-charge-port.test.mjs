import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {buildEvChargePort,measureEvChargePortSupport,EV_CHARGE_IDS,EV_CHARGE_LAYOUT as L} from '../ev-charge-port.mjs';
import {evChargePortGlb} from '../ev-charge-port-glb.mjs';
import {panelStats} from '../front-compartment.mjs';
import {signedVolume} from '../frunk.mjs';
import {trianglesIntersect,meshClearance,staticScene} from '../collision.mjs';
import {glbParts} from '../anatomy-svg.mjs';
import {readGlb} from '../analyze.mjs';
const world=(u,v,d=0)=>L.origin.map((x,k)=>x+u*L.u[k]+v*L.v[k]+d*L.normal[k]);
// Both huge triangles have all vertices OUTSIDE the footprint. Clipping must still find the plane.
const ground=[{name:'synthetic-plane',triangles:Float64Array.from([[-40,-40],[40,-40],[40,40],[-40,-40],[40,40],[-40,40]].flatMap(([u,v])=>world(u,v)))}];
const support=measureEvChargePortSupport(ground),model=buildEvChargePort({support});
test('measures crossing triangles, refuses missing/bad reference, requires explicit support',()=>{
  assert.ok(Math.abs(support.distance)<1e-12);assert.equal(support.clippedTriangles,2);
  assert.throws(()=>measureEvChargePortSupport([]),/source meshes/);
  assert.throws(()=>measureEvChargePortSupport([{triangles:[NaN,0,0]}]),/invalid source/);
  assert.throws(()=>measureEvChargePortSupport([{triangles:Float64Array.from([[100,100],[110,100],[100,110]].flatMap(([u,v])=>world(u,v)))}]),/no source surface/);
  assert.throws(()=>measureEvChargePortSupport([{triangles:Float64Array.from(Array.from(ground[0].triangles,(x,k)=>x-50*L.normal[k%3]))}]),/applicability/);
  assert.throws(()=>buildEvChargePort(),/measured/);assert.throws(()=>buildEvChargePort({support:{distance:Infinity}}),/measured/);
});
test('stable IDs, static semantic contract, fresh bounds and triangles',()=>{
  assert.deepEqual(model.parts.map(p=>p.id),['ev-charge.port','ev-charge.flap']);assert.deepEqual(model.joints,[]);
  for(const p of model.parts){const s=panelStats(p);assert.equal(p.meta.partId,p.id);assert.equal(p.meta.inspectionTarget,EV_CHARGE_IDS.port);
    assert.equal(p.meta.geometryConfidence,'ESTIMATED_GEOMETRY');assert.equal(p.meta.positionConfidence,'ESTIMATED_GEOMETRY');
    assert.equal(p.geometryConfidence,p.meta.geometryConfidence);assert.equal(p.positionConfidence,p.meta.positionConfidence);assert.deepEqual(p.source,p.meta.source);
    assert.equal(p.meta.hingeConfidence,'UNVERIFIED');assert.equal(p.moving,false);assert.equal(p.meta.pose,'STATIC_CLOSED_ILLUSTRATION');
    assert.deepEqual(p.bounds.min,s.min);assert.deepEqual(p.bounds.max,s.max);assert.equal(p.meta.bounds,p.bounds);assert.equal(p.bounds.unit,'cm');assert.equal(p.meta.source.length,2);
    assert.ok(p.bounds.size.every(v=>v>0));assert.ok(p.bounds.max[0]<0&&p.bounds.max[1]<0);}
  const copy=buildEvChargePort({support});copy.parts[0].triangles[0]=999;copy.bounds.min[0]=999;assert.deepEqual(buildEvChargePort({support}),model);
});
test('both closed outward manifolds, no degeneracy/self intersections or frame/flap overlap',()=>{
  for(const p of model.parts){const T=p.triangles,edges=new Map(),tris=[],key=p=>p.map(x=>x.toFixed(7)).join(',');
    assert.equal(panelStats(p).degenerate,0);assert.ok(signedVolume(T)>0);
    for(let i=0;i<T.length;i+=9){const t=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3)));tris.push(t);
      for(let j=0;j<3;j++){const a=key(t[j]),b=key(t[(j+1)%3]),id=[a,b].sort().join('|'),e=edges.get(id)??{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(id,e);}}
    for(const e of edges.values())assert.deepEqual(e,{n:2,d:0});
    for(let i=0;i<tris.length;i++)for(let j=i+1;j<tris.length;j++){
      if(tris[i].some(a=>tris[j].some(b=>key(a)===key(b))))continue;assert.equal(trianglesIntersect(tris[i],tris[j]),false);}
  }
  const c=meshClearance(model.parts[0].triangles,staticScene([model.parts[1]]),{cutoff:2});assert.equal(c.intersectingPairs,0);assert.ok(c.minDistanceCm>0);
  // Nested homothetic outlines with a strict aperture gap: flap is in the hole, not inside frame material.
  assert.ok(L.flapScale<L.apertureScale&&L.apertureScale<1);
  for(const p of model.parts)assert.equal(meshClearance(p.triangles,staticScene(ground),{cutoff:2}).intersectingPairs,0);
});
test('GLB Khronos 0/0, winding/normals, cm-m axes and metadata survive round trip',async()=>{
  const bytes=evChargePortGlb(model),validator=createRequire(import.meta.url)('../../anatomy-car/node_modules/gltf-validator'),v=await validator.validateBytes(new Uint8Array(bytes),{});
  assert.equal(v.issues.numErrors+v.issues.numWarnings,0);assert.deepEqual(evChargePortGlb(model),bytes);
  const decoded=glbParts(bytes),{json,accessor}=readGlb(bytes);
  for(const p of model.parts){const t=decoded.find(n=>n.name===p.id).triangles;p.triangles.forEach((x,k)=>assert.ok(Math.abs(x-t[k])<0.0001));assert.ok(signedVolume(t)>0);
    const n=json.nodes.find(n=>n.name===p.id);assert.deepEqual(n.extras,p.meta);
    const prim=json.meshes[n.mesh].primitives[0],pos=accessor(prim.attributes.POSITION),nor=accessor(prim.attributes.NORMAL);
    for(let i=0;i<pos.length;i+=9){const a=[0,1,2].map(k=>pos[i+3+k]-pos[i+k]),b=[0,1,2].map(k=>pos[i+6+k]-pos[i+k]),cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      assert.ok(cross.reduce((s,x,k)=>s+x*nor[i+k],0)>0);assert.ok(Math.abs(Math.hypot(...nor.slice(i,i+3))-1)<1e-6);}}
});
test('report refuses repository output before opening missing input',()=>{
  const r=spawnSync(process.execPath,['tools/ioniq5-asset/ev-charge-port-report.mjs','--glb=missing','--out=tools/tmp-charge'],{encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/Refusing model-derived output/);
});
test('real source: no independent charge node, no crossings, source immutable',{skip:!process.env.IONIQ5_GLB},()=>{
  const bytes=readFileSync(process.env.IONIQ5_GLB),nodes=glbParts(bytes),before=nodes.map(p=>Array.from(p.triangles));assert.equal(nodes.length,44);
  assert.ok(!nodes.some(p=>/charg|port|flap/i.test(p.name)));
  const m=buildEvChargePort({support:measureEvChargePortSupport(nodes)}),scene=staticScene(nodes);
  for(const p of m.parts){const c=meshClearance(p.triangles,scene,{cutoff:5});assert.equal(c.intersectingPairs,0);assert.ok(c.minDistanceCm>=0.19);}
  assert.deepEqual(nodes.map(p=>Array.from(p.triangles)),before);assert.deepEqual(readFileSync(process.env.IONIQ5_GLB),bytes);
});
