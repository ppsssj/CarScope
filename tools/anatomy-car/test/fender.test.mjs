import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ENVELOPE_SUV } from "../profiles/vehicle-profile.mjs";
import { buildEnvelopeModel } from "../envelope/model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { fenderMesh } from "../geometry-export/fender.mjs";
import { loftMesh } from "../geometry-export/loft.mjs";
import { checkMesh, vec } from "../geometry-export/mesh.mjs";
import { collider, surfaceOverlap } from "../geometry-export/collision.mjs";

const legacy=structuredClone(ENVELOPE_SUV);
delete legacy.estimates.fenderShoulderDrop;
const before=generateGeometry(await buildEnvelopeModel({profile:legacy,fenderSurface:false}));
const after=generateGeometry(await buildEnvelopeModel());
const fender=(side)=>after.parts.find(p=>p.item===`suv.front-fender.${side}`);

test("preserved pre-surface SUV GLB remains byte identical to P2-A3-1.1",()=>{
  assert.equal(createHash("sha256").update(before.glb).digest("hex"),
    "b4b5786bc2aae87925051b9c1869f586ce8b5c642cb2836bb809dc046629a9e8");
  assert.equal(before.report.triangles,11340);
});

test("both front fenders are genuinely curved, mirrored, closed and share SVG/GLB vertices",()=>{
  const left=fender(1),right=fender(-1);
  for(const p of [left,right]) {
    assert.equal(p.cls,"fender");
    const generated=fenderMesh(p.geo);
    assert.deepEqual(p.mesh.positions,generated.mesh.positions);
    assert.equal(after.model.sc.R.items.find(it=>it.name===p.item).prims[0].paths.geo,p.geo);
    const check=checkMesh(p.mesh,{closed:true});
    assert.equal(check.degenerate,0);assert.equal(check.flippedNormals,0);
    assert.equal(check.boundaryEdges,0);assert.equal(check.nonManifoldEdges,0);
    assert.equal(check.watertight,true);assert.equal(check.outward,true);
    assert.ok(generated.rings.some(r=>new Set(r.slice(1,6).map(v=>v[1].toFixed(3))).size>=4),"actual Y displacement across the side skin");
  }
  const key=(p)=>p.map(v=>v.toFixed(4)).join(",");
  const l=new Set(left.mesh.positions.map(p=>key([p[0],-p[1],p[2]])));
  const r=new Set(right.mesh.positions.map(key));
  assert.deepEqual(l,r);
  const sample={side:1,xs:[1,2],innerY:95.4,halfWidth:100.4,bottomZ:[23,23],topZ:[110,110],shoulderDrop:2.2};
  assert.throws(()=>fenderMesh({...sample,xs:[2,1]}),/ordered sections/);
  assert.throws(()=>fenderMesh({...sample,bottomZ:[23]}),/matching finite bounds/);
  assert.throws(()=>fenderMesh({...sample,side:0}),/ordered sections/);
});

test("hood edge has a constant 2 mm panel seam and aligned surface directions, without penetration",()=>{
  const f=fenderMesh(fender(1).geo),h=loftMesh(after.parts.find(p=>p.item==="suv.hood.loft").geo);
  for(const p of h.top.map(row=>row.at(-1))) {
    const i=f.rings.findIndex(r=>Math.abs(r[0][0]-p[0])<1e-5);
    assert.ok(i>=0,`missing hood knot ${p[0]}`);
    const q=f.rings[i][7];
    assert.ok(Math.abs(q[1]-p[1]-0.2)<1e-8,"2 mm intentional panel gap");
    assert.ok(Math.abs(q[2]-p[2])<1e-8,"no height step at the hood edge");
  }
  let worst=0,count=0;
  for(let i=0;i<f.rings.length-1;i++) {
    const x=(f.rings[i][0][0]+f.rings[i+1][0][0])/2;
    if(x<h.top[0][0][0]||x>h.top.at(-1)[0][0]) continue;
    let j=h.top.findIndex(row=>row[0][0]>=x);if(j<1)j=1;
    const [a,b,c]=[f.rings[i][6],f.rings[i][7],f.rings[i+1][7]];
    const fn=vec.unit(vec.cross(vec.sub(b,a),vec.sub(c,a)));
    const [u,v,w]=[h.top[j-1].at(-2),h.top[j].at(-2),h.top[j].at(-1)];
    const hn=vec.unit(vec.cross(vec.sub(v,u),vec.sub(w,u)));
    worst=Math.max(worst,Math.acos(Math.max(-1,Math.min(1,vec.dot(fn,hn))))*180/Math.PI);count++;
  }
  assert.ok(count>30);assert.ok(worst<10,`visual normal offset ${worst}°`);
  const left=collider(fender(1));
  for(const p of after.parts.filter(p=>p.item==="suv.hood.loft"||p.item.startsWith("suv.front-fascia"))) {
    const s=surfaceOverlap(left,collider(p));
    assert.equal(Math.max(s.aIntoB.depth,s.bIntoA.depth),0,`${p.item} penetration`);
  }
});
