// P10-1: one part, one name, on every surface this repository has. Reads the phone and Native names and changes neither.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {INSPECTION_PARTS,partById,partLabel,partsInArea} from '../inspection-parts.mjs';
import {MOBILE_TARGETS,targetForPart,targetForTask} from '../mobile-result-contract.mjs';
import {INSPECTION_AREAS,areaOf} from '../inspection-flow.mjs';
import {TIRES} from '../inspection-tires.mjs';
import {LIGHT_PARTS,WIPER_PARTS} from '../visibility-parts.mjs';
import {ALL_PARTS} from './part-ux-metrics.mjs';
import {taskLabel} from '../../mobile-ar-poc/public/inspection-tasks.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('the registry lists the 19 baseline parts once, with every field a later step needs',()=>{
  assert.deepEqual(INSPECTION_PARTS.map(p=>p.id),[...ALL_PARTS]);
  assert.equal(new Set(INSPECTION_PARTS.map(p=>p.label)).size,19,'no two parts share a name');
  const areas=new Set(INSPECTION_AREAS.map(a=>a.id));
  for(const p of INSPECTION_PARTS){
    assert.ok(areas.has(p.area),p.id);
    assert.ok(['GLB_ORIGINAL','GLB_MARKER','ESTIMATED','NONE'].includes(p.geometrySource),p.id);
    assert.ok(['PART','MARKER','UNDERBODY','NONE'].includes(p.cameraClass),p.id);
    assert.ok(['available','preview','planned'].includes(p.status),p.id);
    assert.equal(p.cameraClass==='NONE',p.geometrySource==='NONE',p.id);
    assert.equal(Object.isFrozen(p),true);
  }
});

test('the registry only claims what the model holds',()=>{
  const by=source=>INSPECTION_PARTS.filter(p=>p.geometrySource===source).map(p=>p.id);
  assert.deepEqual(by('NONE'),['lcw-coolant-reservoir']);
  assert.deepEqual(by('GLB_ORIGINAL'),TIRES.map(t=>t.id));
  assert.deepEqual(by('GLB_MARKER'),LIGHT_PARTS.map(l=>l.id));
  assert.equal(by('ESTIMATED').length,10);
  assert.equal(partById('lcw-coolant-reservoir').status,'planned','no geometry means it stays out of 3D selection');
});

test('the result contract keeps its IDs, tasks and areas, and takes its names from the registry',()=>{
  assert.equal(MOBILE_TARGETS.length,17);
  const fromRegistry=INSPECTION_PARTS.filter(p=>p.taskId);
  assert.deepEqual(MOBILE_TARGETS.map(t=>t.partId).sort(),fromRegistry.map(p=>p.id).sort());
  for(const p of fromRegistry){
    const t=targetForPart(p.id);
    assert.equal(t.taskId,p.taskId,p.id);
    assert.equal(t.area,p.area,p.id);
    assert.equal(t.label,p.label,p.id);
    assert.equal(targetForTask(p.taskId),t);
  }
  // Stored records use these values. Changing one breaks every record already saved.
  assert.equal(targetForPart('washer-fluid-cap').taskId,'washer-fluid');
  assert.equal(targetForPart('brake-fluid-reservoir').taskId,'brake-fluid');
  assert.equal(targetForPart('ev-charge.flap'),undefined,'the flap has no result task');
  assert.equal(targetForPart('ev-battery.pack'),undefined,'the battery has no result task');
});

test('the flow lists each area from the registry, in its order, with the same selection status',()=>{
  for(const area of INSPECTION_AREAS){
    const expected=partsInArea(area.id);
    assert.deepEqual(area.components.map(c=>c.id),expected.map(p=>p.id),area.id);
    for(const c of area.components){
      const p=partById(c.id);
      assert.equal(c.label,p.label,c.id);
      assert.equal(c.status,p.status,c.id);
      assert.equal(c.location,p.location,c.id);
    }
  }
  assert.equal(areaOf({area:'hood'}).components.find(c=>c.id==='lcw-coolant-reservoir').status,'planned');
});

test('tires and visibility parts keep their model bindings and take their names from the registry',()=>{
  assert.deepEqual(TIRES.map(t=>[t.id,t.node,t.front,t.left]),[['tire.front-left','Wheel_0_1',1,1],['tire.front-right','Wheel_0_0',1,-1],['tire.rear-left','Wheel_1_1',-1,1],['tire.rear-right','Wheel_1_0',-1,-1]]);
  for(const t of TIRES)assert.equal(t.label,partLabel(t.id));
  assert.deepEqual(LIGHT_PARTS.map(l=>[l.id,l.node,l.feature,l.side]),[['light-low-beam-left-0','Light_Low_Beam_Left_0','light.low-beam',1],['light-low-beam-right-0','Light_Low_Beam_Right_0','light.low-beam',-1],['light-high-beam-left-0','Light_High_Beam_Left_0','light.high-beam',1],['light-high-beam-right-0','Light_High_Beam_Right_0','light.high-beam',-1]]);
  for(const l of LIGHT_PARTS)assert.equal(l.label,partLabel(l.id));
  assert.deepEqual([...WIPER_PARTS],['wiper.front.left','wiper.front.right']);
});

// P11 (PR #121): the phone and Native dropped "외관" from the four light names, so every result part now reads the same on
// all screens. The difference reported in docs/p10-1-part-registry.md is resolved; no exception remains.
const expectedElsewhere=p=>p.label;

test('the phone uses the same name for every result part',()=>{
  for(const p of INSPECTION_PARTS.filter(x=>x.taskId))assert.equal(taskLabel(p.taskId),expectedElsewhere(p),p.id);
});

test('Native uses the same name for every result part',()=>{
  const contract=read('../../../app/src/debug/java/io/carscope/app/sync/SyncReceiverContract.kt'),checklist=read('../../../app/src/debug/java/io/carscope/app/sync/SyncChecklistInspection.kt');
  const direct=[...(/val labels = listOf\(([^)]*)\)/.exec(contract)?.[1].matchAll(/"([^"]+)"/g)??[])].map(m=>m[1]);
  const native=new Map(['washer-fluid','tire.front-left','tire.front-right','tire.rear-left','tire.rear-right','ev-charge.port'].map((task,i)=>[task,direct[i]]));
  for(const m of checklist.matchAll(/"([a-z0-9.-]+)" to SyncChecklistProfile\("([^"]+)"/g))native.set(m[1],m[2]);
  assert.equal(native.size,17);
  for(const p of INSPECTION_PARTS.filter(x=>x.taskId))assert.equal(native.get(p.taskId),expectedElsewhere(p),p.id);
});

test('the page takes part names from the registry instead of writing them again',()=>{
  const page=read('../inspect.js'),flow=read('../inspection-flow.mjs');
  for(const old of ['충전구 외곽','차량 좌측 전면','차량 우측 전면','브레이크액 리저버','하향등 표식','상향등 표식'])for(const source of [page,flow,read('../visibility-parts.mjs')])assert.ok(!source.includes(old),old);
  assert.ok(!page.includes('<h2>워셔액 점검</h2>'));
  assert.match(page,/partLabel\('washer-fluid-cap'\)/);
  // 3D labels take their text from the registry too (part-labels.mjs); no label text is written in the page.
  assert.doesNotMatch(read('../inspect.html'),/capButton|>워셔액</,'no static label button');
  assert.match(read('../part-labels.mjs'),/text:partLabel\(id\)/);
});

test('dropping "marker" from a light name does not drop the warning that it is only a marker',()=>{
  const page=read('../inspect.js');
  // P10 PR #2 rewords the warning in plain Korean; the claim it carries is unchanged.
  assert.match(page,/GLB_MARKER: '위치 표식'/,'a light is badged as a marker, not as the part');
  assert.match(page,/참조 모델의 위치 표식입니다\. 실제 전구·밝기·광축이나 고장 여부를 나타내지 않습니다/);
  assert.match(page,/좌우는 운전자가 앞을 보는 기준입니다/,'the side reference that "vehicle left" used to give');
});
