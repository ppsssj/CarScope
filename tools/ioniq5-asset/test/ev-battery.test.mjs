import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildEvBatteryPack,EV_BATTERY_ID} from '../ev-battery.mjs';
import {evBatteryGlb} from '../ev-battery-glb.mjs';
import {panelStats} from '../front-compartment.mjs';
import {signedVolume} from '../frunk.mjs';
import {trianglesIntersect,meshClearance,staticScene} from '../collision.mjs';
import {readGlb} from '../analyze.mjs';
import {glbParts} from '../anatomy-svg.mjs';
const validator=createRequire(import.meta.url)('../../anatomy-car/node_modules/gltf-validator');

test('opt-in single stable ID, estimated provenance and independent fresh bounds',()=>{
  const m=buildEvBatteryPack(),p=m.parts[0],s=panelStats(p);
  assert.equal(EV_BATTERY_ID,'ev-battery.pack');assert.equal(m.parts.length,1);assert.equal(p.id,EV_BATTERY_ID);
  assert.deepEqual(m.joints,[]);assert.equal(p.moving,false);
  assert.deepEqual(m.bounds.min,[-115,-58,12]);assert.deepEqual(m.bounds.max,[90,58,22]);
  assert.deepEqual(m.bounds.min,s.min);assert.deepEqual(m.bounds.max,s.max);
  assert.deepEqual(m.bounds.center,[-12.5,0,17]);assert.deepEqual(m.bounds.size,[205,116,10]);
  assert.equal(p.meta.partId,p.id);assert.equal(p.meta.inspectionTarget,p.id);assert.equal(p.meta.geometryConfidence,'ESTIMATED_GEOMETRY');
  assert.equal(p.meta.positionConfidence,'ESTIMATED_GEOMETRY');assert.equal(p.meta.dimensionConfidence,'ESTIMATED');
  assert.equal(p.meta.mountingConfidence,'UNVERIFIED');assert.equal(p.meta.bounds,m.bounds);assert.equal(p.meta.unit,'cm');
  assert.equal(p.meta.source.length,2);assert.match(p.meta.note,/No OEM fit/);
  assert.deepEqual(buildEvBatteryPack(),m);m.bounds.min[0]=999;p.triangles[0]=999;
  assert.deepEqual(buildEvBatteryPack().bounds.min,[-115,-58,12]);
});

test('housing is a positive-volume outward watertight manifold without self intersections',()=>{
  const p=buildEvBatteryPack().parts[0],T=p.triangles,edges=new Map(),tris=[],key=v=>v.join(',');
  assert.equal(panelStats(p).degenerate,0);assert.equal(T.length/9,28);assert.ok(signedVolume(T)>0);
  for(let i=0;i<T.length;i+=9){const t=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3)));tris.push(t);
    for(let j=0;j<3;j++){const a=key(t[j]),b=key(t[(j+1)%3]),id=[a,b].sort().join('|'),e=edges.get(id)??{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(id,e);}}
  for(const e of edges.values())assert.deepEqual(e,{n:2,d:0});
  for(let i=0;i<tris.length;i++)for(let j=i+1;j<tris.length;j++){
    if(tris[i].some(a=>tris[j].some(b=>key(a)===key(b))))continue;
    assert.equal(trianglesIntersect(tris[i],tris[j]),false);
  }
  assert.ok(Math.abs(signedVolume(T)-(205*116-2*4*4)*10)<1e-7);
});

test('GLB validates and preserves coordinates, winding, normals and identification metadata',async()=>{
  const bytes=evBatteryGlb(),v=await validator.validateBytes(new Uint8Array(bytes),{});
  assert.equal(v.issues.numErrors,0);assert.equal(v.issues.numWarnings,0);assert.deepEqual(evBatteryGlb(),bytes);
  const p=buildEvBatteryPack().parts[0],r=glbParts(bytes)[0];assert.equal(r.name,p.id);
  p.triangles.forEach((x,k)=>assert.ok(Math.abs(x-r.triangles[k])<0.0001));assert.ok(signedVolume(r.triangles)>0);
  const {json,accessor}=readGlb(bytes),node=json.nodes[0];assert.deepEqual(node.extras,p.meta);
  const prim=json.meshes[0].primitives[0],pos=accessor(prim.attributes.POSITION),normal=accessor(prim.attributes.NORMAL);
  assert.deepEqual(json.accessors[prim.attributes.POSITION].min,[-1.15,0.12,-0.58]);
  assert.deepEqual(json.accessors[prim.attributes.POSITION].max,[0.9,0.22,0.58]);
  for(let i=0;i<pos.length;i+=9){const a=[0,1,2].map(k=>pos[i+3+k]-pos[i+k]),b=[0,1,2].map(k=>pos[i+6+k]-pos[i+k]);
    const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    assert.ok(cross.reduce((sum,x,k)=>sum+x*normal[i+k],0)>0);assert.ok(Math.abs(Math.hypot(...normal.slice(i,i+3))-1)<1e-6);}
});

test('report rejects repository output before reading source',()=>{
  const r=spawnSync(process.execPath,['tools/ioniq5-asset/ev-battery-report.mjs','--glb=missing','--out=tools/tmp-battery'],{encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/Refusing model-derived output/);
});

test('real GLB: no duplicate pack; entire source, hood and wheels untouched and separate',{skip:!process.env.IONIQ5_GLB},()=>{
  const bytes=readFileSync(process.env.IONIQ5_GLB),nodes=glbParts(bytes),before=nodes.map(n=>Array.from(n.triangles));
  assert.equal(nodes.length,44);assert.ok(!nodes.some(n=>/batter|hv_|cell|pack/i.test(n.name)));
  const m=buildEvBatteryPack(),b=m.bounds;
  for(const n of nodes){const s=panelStats(n);assert.ok([0,1,2].some(k=>s.min[k]>b.max[k]||s.max[k]<b.min[k]),n.name+' containment');}
  assert.equal(meshClearance(m.parts[0].triangles,staticScene(nodes),{cutoff:5}).intersectingPairs,0);
  assert.deepEqual(nodes.map(n=>Array.from(n.triangles)),before);assert.deepEqual(readFileSync(process.env.IONIQ5_GLB),bytes);
});
