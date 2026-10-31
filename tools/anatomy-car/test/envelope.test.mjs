import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ENVELOPE_SUV, envelopeParameters } from "../profiles/vehicle-profile.mjs";
import { buildEnvelopeModel } from "../envelope/model.mjs";
import { dimensionReport, DOOR_IDS } from "../envelope/artifacts.mjs";
import { buildModel } from "../automotive/model.mjs";
import { VIEW, svgScreenPath } from "../automotive/camera.mjs";
import { writeAsset } from "../automotive/asset.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { meshFailures, POLICY } from "../geometry-export/policy.mjs";
import { glbContractFailures, readGlb } from "../geometry-export/glb-contract.mjs";
import { angles, collider, surfaceOverlap, posePart, sweepDoors, collisionFailures } from "../geometry-export/collision.mjs";
import { prismMesh } from "../geometry-export/mesh.mjs";

const model=await buildEnvelopeModel(), bundle=generateGeometry(model);
const hash=(b)=>createHash("sha256").update(b).digest("hex");

test("profile preserves AAOS observations/units/provenance and separately marks every unknown/estimate",()=>{
  assert.equal(ENVELOPE_SUV.profileId,"manual-pleos-avd-envelope-v1");
  assert.equal(ENVELOPE_SUV.source,"AAOS_SIMULATED_METADATA");
  assert.equal(ENVELOPE_SUV.oemVisualMatch,"UNVERIFIED");
  assert.equal(ENVELOPE_SUV.metadata.actualVehicleIdentity,null);
  assert.deepEqual(Object.values(ENVELOPE_SUV.dimensions).map(d=>d.value),[1776,4950,2008,2140,2984,1665,1667,11800]);
  Object.values(ENVELOPE_SUV.dimensions).forEach((d,i)=>{assert.equal(d.unit,"mm");assert.equal(d.index,i);assert.equal(d.property,"INFO_EXTERIOR_DIMENSIONS");assert.equal(d.source,"AAOS_SIMULATED_METADATA");});
  assert.ok(Object.values(ENVELOPE_SUV.unknown).every(x=>x===null));
  assert.ok(Object.values(ENVELOPE_SUV.estimates).every(d=>d.source==="DESIGN_ESTIMATE"&&d.unit==="mm"&&d.basis));
});

test("mm to cm is explicit and invalid units/envelope relationships fail",()=>{
  const d=envelopeParameters();
  assert.equal(d.unit,"cm"); assert.equal(d.length,495); assert.equal(d.width,200.8); assert.equal(d.height,177.6);
  assert.equal(d.axleFront-d.axleRear,298.4);
  assert.ok(Math.abs(d.frontOverhang+d.rearOverhang+d.wheelbase-d.length)<1e-10);
  const p=structuredClone(ENVELOPE_SUV); p.dimensions.width.unit="cm";
  assert.throws(()=>envelopeParameters(p),/observed width/);
  p.dimensions.width.unit="mm"; p.dimensions.wheelbase.value=6000;
  assert.throws(()=>envelopeParameters(p),/relationships/);
});

test("actual assembled geometry meets all seven measurable observations, without claiming turning kinematics",()=>{
  const report=dimensionReport(bundle);
  for(const [key,d] of Object.entries(report.dimensions)) assert.ok(Math.abs(d.errorMm)<1e-6,`${key}: ${d.errorMm}`);
  for(const [key,d] of Object.entries(report.glbFloat32)) assert.ok(Math.abs(d.errorMm)<0.002,`${key} encoded: ${d.errorMm}`);
  assert.equal(report.turningDiameter.observedMm,11800);
  assert.equal(report.turningDiameter.actualMm,null);
  assert.equal(report.wheelCentersCm.length,4);
});

test("original Sedan GLB stays byte-identical after reusable dimension/exporter extensions",async()=>{
  const sedan=generateGeometry(await buildModel());
  assert.equal(hash(sedan.glb),"5c1bb7cfe0daeae700d3b857423d06d8a0a05042bb092a8e12786bf336709f00");
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../build");mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,"sedan-preservation-"));
  try {
    const m=sedan.model,asset=writeAsset(m.ctx,m.sc,m.halo,{file:join(dir,"car.parts"),rev:m.anatomy.rev});
    assert.equal(asset.sha256,"a6f19a53bf6b6453a2255a67de1ab15b976e68b07facf0e4a527558a3d7c2197");
  } finally { assert.equal(dirname(resolve(dir)),root);rmSync(dir,{recursive:true,force:true}); }
});

test("SUV meshes are watertight/outward with correct normals/winding; all four doors remain rigid",()=>{
  assert.deepEqual(meshFailures(bundle.report,DOOR_IDS),[]);
  assert.deepEqual(Object.keys(bundle.report.doorRigidity).sort(),[...DOOR_IDS].sort());
  for(const r of Object.values(bundle.report.doorRigidity)) assert.ok(r.comparedParts>0&&r.maxDeviation<POLICY.rigidityCm);
  const bad=structuredClone(bundle.report); delete bad.doorRigidity["door-rear-right"];
  assert.ok(meshFailures(bad,DOOR_IDS).some(x=>x.includes("door-rear-right")));
});

test("GLB binary preserves physical front/rear/left/right, units, four pivots, open signs and profile",()=>{
  assert.deepEqual(glbContractFailures(bundle.glb,bundle.parts,bundle.doorDefs,VIEW),[]);
  const {json}=readGlb(bundle.glb);
  assert.equal(json.extras.vehicleGeometryProfile.profileId,ENVELOPE_SUV.profileId);
  assert.equal(json.extras.vehicleGeometryProfile.oemVisualMatch,"UNVERIFIED");
  for(const id of DOOR_IDS) {
    const n=json.nodes.find(n=>n.name===id), side=id.endsWith("left")?1:-1;
    assert.ok(n.translation[2]*side<0,"physical left is glTF -Z");
    assert.ok(n.extras.states.open*side<0,"opposite door rotation signs");
    const p=bundle.parts.find(p=>p.parent===id), opened=posePart(p,5);
    const meanY=m=>m.positions.reduce((a,p)=>a+p[1],0)/m.positions.length;
    assert.ok(side*(meanY(opened.mesh)-meanY(p.mesh))>0,"each door moves physically outward");
  }
});

test("sampled roof curvature retains shared SVG/GLB input, MLZ compatibility and reusable greenhouse parameters",async()=>{
  const p=bundle.parts.find(p=>p.item==="suv.crowned-roof");
  assert.equal(p.geo.kind,"prism");
  assert.ok(p.geo.poly.length>=12,"curve retains multiple sampled stations, not a flat roof slab");
  assert.equal(Math.max(...p.geo.poly.map(v=>v[1])),177.6);
  const svg=model.sc.R.items.find(it=>it.name==="suv.crowned-roof").prims[0].paths;
  assert.doesNotThrow(()=>svgScreenPath(svg.fill));
  assert.equal(/[QCA]/.test(svg.fill),false,"no SVG-only smoothing hidden from exporter");
  assert.throws(()=>svgScreenPath("M0 0 Q2 3 4 5"),/Unsupported Anatomy path/);
  for(const q of p.geo.poly) assert.ok(p.mesh.positions.some(v=>Math.abs(v[1]-q[0])<1e-9&&Math.abs(v[2]-q[1])<1e-9));
  const profile=structuredClone(ENVELOPE_SUV);
  profile.estimates.roofHalfWidth.value+=20;
  profile.estimates.roofFrontX.value+=10;
  profile.estimates.windshieldBaseX.value+=10;
  const other=generateGeometry(await buildEnvelopeModel({profile}));
  const roof=other.parts.find(p=>p.item==="suv.crowned-roof").geo;
  assert.equal(roof.s1,model.parameters.roofFrontX+1);
  assert.equal(Math.max(...roof.poly.map(p=>p[0])),model.parameters.roofHalfWidth+2);
  const glass=other.parts.find(p=>p.item==="suv.windshield").geo;
  assert.equal(glass.F.o[0],model.parameters.windshieldBaseX+1);
});

test("actual projected geometry fits the SVG viewBox with all four doors closed or open",()=>{
  for(const part of bundle.parts) for(const p of [part, ...(part.pivot?[posePart(part,bundle.doorDefs[part.parent].open)]:[])]) {
    for(const vertex of p.mesh.positions) {
      const [x,y]=model.ctx.at(vertex);
      assert.ok(x>=0 && x<=VIEW.width && y>=0 && y<=VIEW.height,`${part.partId}: ${x},${y}`);
    }
  }
});

test("frozen initial mirror/A-pillar defect fails the 3mm envelope; relocated mirror clears the actual pillar",()=>{
  const fixture=JSON.parse(readFileSync(new URL("./fixtures/envelope-mirror-interference.json",import.meta.url),"utf8"));
  const old=collider({geo:fixture.arm,mesh:prismMesh(fixture.arm)}), pillar=collider({geo:fixture.pillar,mesh:prismMesh(fixture.pillar)});
  const before=surfaceOverlap(old,pillar);
  assert.ok(Math.max(before.aIntoB.depth,before.bIntoA.depth)>0.9);
  const current=collider(bundle.parts.find(p=>p.partId==="door-front-left/4"));
  const after=surfaceOverlap(current,pillar);
  assert.equal(Math.max(after.aIntoB.depth,after.bIntoA.depth),0);
});

test("four complete hinge sweeps and all six independent door pairs preserve the original 3mm policy",()=>{
  assert.equal(POLICY.penetrationCm,0.3);
  const report=sweepDoors(bundle);
  assert.deepEqual(collisionFailures(report),[]);
  const counts=Object.values(bundle.doorDefs).map(d=>angles(d.open).length);
  let expected=0; for(let i=0;i<counts.length;i++) for(let j=i+1;j<counts.length;j++) expected+=counts[i]*counts[j];
  assert.equal(report.bothDoors.poses,expected);
  for(const def of Object.values(bundle.doorDefs)) {
    const rows=report.doors[def.id].results;
    assert.equal(rows[0].deg,0);assert.equal(rows.at(-1).deg,def.open);
    for(let n=40;n<=70;n++) assert.ok(rows.some(x=>x.deg===n/10));
  }
});

test("stale envelope artifacts exit nonzero and replace an earlier PASS",()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../build");mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,"envelope-reject-"));
  try {
    writeFileSync(join(dir,"verification.json"),JSON.stringify({status:"PASS"}));
    // Empty IR is deliberately not a valid current artifact; no audit/collision bypass allowed.
    writeFileSync(join(dir,"car.glb"),bundle.glb);writeFileSync(join(dir,"ir.json"),"{}");
    const cli=resolve(root,"../envelope/build.mjs");
    const run=spawnSync(process.execPath,[cli,"--verify","--artifacts",dir],{encoding:"utf8"});
    assert.notEqual(run.status,0);
    assert.equal(JSON.parse(readFileSync(join(dir,"verification.json"),"utf8")).status,"FAIL");
  } finally {
    assert.equal(dirname(resolve(dir)),root,"cleanup stays inside the intended build directory");
    rmSync(dir,{recursive:true,force:true});
  }
});
