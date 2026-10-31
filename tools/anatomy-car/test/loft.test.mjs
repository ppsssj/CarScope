import test from "node:test";
import assert from "node:assert/strict";
import { loftMesh } from "../geometry-export/loft.mjs";
import { checkMesh } from "../geometry-export/mesh.mjs";
import { buildEnvelopeModel } from "../envelope/model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { dimensionReport } from "../envelope/artifacts.mjs";
import { ENVELOPE_SUV } from "../profiles/vehicle-profile.mjs";

const sections=[
  {x:0,points:[[-2,5,2],[0,7,2],[2,5,2]]},
  {x:2,points:[[-2,6,2],[0,9,2],[2,6,2]]},
  {x:4,points:[[-2,5,2],[0,7,2],[2,5,2]]},
];

test("section loft interpolates actual XYZ vertices without overshoot and closes the surface",()=>{
  const result=loftMesh({sections,resolution:3}),c=checkMesh(result.mesh,{closed:true});
  assert.equal(result.top[0][0][2],5);
  assert.equal(result.top[3][3][2],9);
  assert.ok(result.top[1][3][2]>7 && result.top[1][3][2]<9);
  assert.ok(result.top[3][1][2]>6 && result.top[3][1][2]<9);
  assert.ok(result.top.flat().every(p=>p[2]>=5&&p[2]<=9));
  assert.equal(c.degenerate,0);assert.equal(c.flippedNormals,0);assert.equal(c.boundaryEdges,0);
  assert.equal(c.nonManifoldEdges,0);assert.equal(c.watertight,true);assert.equal(c.outward,true);
  assert.ok(result.mesh.positions.length<result.mesh.indices.length/2,"grid indices reuse top and bottom vertices");
  assert.equal(result.mesh.indices.length/3,4*(result.top.length-1)*(result.top[0].length-1)+4*(result.top.length-1)+4*(result.top[0].length-1));
});

test("loft rejects misaligned, nonfinite, inverted, and unsupported inputs",()=>{
  assert.throws(()=>loftMesh({sections,resolution:0}),/resolution/);
  assert.throws(()=>loftMesh({sections:[sections[0]]}),/at least two/);
  const bad=structuredClone(sections);bad[1].points.pop();
  assert.throws(()=>loftMesh({sections:bad}),/matching point count/);
  bad[1].points.push([3,6,2]);bad[1].points[0][0]=-3;
  assert.throws(()=>loftMesh({sections:bad}),/aligned increasing Y/);
  bad[1].points[0][0]=-2;bad[1].points[0][1]=Infinity;
  assert.throws(()=>loftMesh({sections:bad}),/finite top Z/);
});

test("SUV loft changes top vertices only; envelope, doors and shared SVG/GLB input stay valid",async()=>{
  assert.equal(ENVELOPE_SUV.estimates.hoodCrownRise.source,"DESIGN_ESTIMATE");
  assert.equal(ENVELOPE_SUV.estimates.hoodCrownRise.value,55);
  const before=generateGeometry(await buildEnvelopeModel({hoodLoft:false}));
  const after=generateGeometry(await buildEnvelopeModel());
  const old=before.parts.find(p=>p.item==="suv.hood"),hood=after.parts.find(p=>p.item==="suv.hood.loft");
  assert.ok(old&&hood&&hood.cls==="loft");
  const oldStation=Math.max(...old.mesh.positions.filter(p=>Math.abs(p[0]-140)<1e-9).map(p=>p[2]));
  const newStation=Math.max(...hood.mesh.positions.filter(p=>Math.abs(p[0]-140)<1e-9&&Math.abs(p[1])<1e-9).map(p=>p[2]));
  assert.ok(newStation>oldStation+2,"the crown raises actual centre vertices at the same X station");
  const paths=after.model.sc.R.items.find(i=>i.name==="suv.hood.loft").prims[0].paths;
  assert.equal(paths.geo.kind,"loft");
  const rebuilt=loftMesh(paths.geo);
  assert.deepEqual(hood.mesh.positions.slice(0,rebuilt.top.flat().length),rebuilt.top.flat(),"SVG and GLB use the same top XYZ grid");
  assert.ok(paths.loftFaces.length>0 && paths.loftFaces.every(f=>f.d.startsWith("M")));
  assert.equal(after.report.doorRigidity["door-front-left"].maxDeviation,before.report.doorRigidity["door-front-left"].maxDeviation);
  for(const x of Object.values(dimensionReport(after).dimensions)) assert.ok(Math.abs(x.errorMm)<1e-6);
  const c=after.report.checks.find(c=>c.cls==="loft");
  assert.equal(c.watertight,true);assert.equal(c.flippedNormals,0);assert.equal(c.degenerate,0);
  assert.ok(after.report.triangles>before.report.triangles);
});
