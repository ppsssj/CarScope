import test from 'node:test';
import assert from 'node:assert/strict';
import { createTireInspection, updateTireInspection, CHECKS, ANSWERS } from '../tire-inspection.mjs';
import { inspectionStateMap, inspectionCounts, INSPECTION_TARGETS } from '../inspection-state-map.mjs';
import { stateLegendHtml } from '../inspection-state-view.mjs';
import { summaryHtml } from '../tire-inspection-view.mjs';
import { partResultHtml } from '../inspection-results-view.mjs';
// P10 PR #2: the tire screen shows one result card (the 17-part projection) instead of a separate local record card.
const stateRecordHtml=(s,partId)=>partResultHtml(s,null,partId);
const visible=html=>html.replace(/<details[^>]*>[\s\S]*?<\/details>/g,'').replace(/<[^>]+>/g,' ');
const id='tire.front-left';
const answer=(s,key,value)=>updateTireInspection(s,{type:'ANSWER',sessionId:s.sessionId,tireId:id,checkId:key,answer:value});
function complete(values) {let s=createTireInspection('local');CHECKS.forEach((c,i)=>s=answer(s,c.id,values[i]));return updateTireInspection(s,{type:'CONFIRM',sessionId:s.sessionId,tireId:id,at:123456});}
const first=s=>inspectionStateMap(s)[0];

test('registered parts start uninspected; projection is immutable and neither guidance nor foreign packets count',()=>{
  const s=createTireInspection('local'),before=JSON.stringify(s),map=inspectionStateMap(s);
  assert.deepEqual(map.map(r=>r.partId),INSPECTION_TARGETS.map(t=>t.partId));
  assert.ok(map.every(r=>r.status==='NOT_INSPECTED'&&r.source===null&&r.completedAt===null));
  assert.deepEqual(inspectionCounts(s),{NOT_INSPECTED:4,FINDINGS_REPORTED:0,UNABLE:0,NO_FINDINGS_REPORTED:0});
  for(const packet of [null,{}, {source:'PLEOS',readings:[{vehiclePartId:id,value:true}]},
    {schemaVersion:2,taskId:id,source:'MOBILE',state:'COMPLETED',confirmation:'USER_REPORTED',responses:{damage:'FOUND',debris:'UNABLE',wear:'NOT_FOUND'}}]) {
    assert.ok(inspectionStateMap(packet).every(r=>r.status==='NOT_INSPECTED'));
  }
  assert.equal(JSON.stringify(s),before);assert.ok(Object.isFrozen(map)&&Object.isFrozen(map[0])&&Object.isFrozen(map[0].responses));
});

test('all 27 confirmed combinations preserve finding precedence, unknowns, original time and local provenance',()=>{
  for(const a of Object.keys(ANSWERS))for(const b of Object.keys(ANSWERS))for(const c of Object.keys(ANSWERS)){
    const values=[a,b,c],s=complete(values),r=first(s);
    assert.equal(r.status,values.includes('FOUND')?'FINDINGS_REPORTED':values.includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED');
    assert.equal(r.source,'USER_REPORTED');assert.equal(r.origin,'THIS_3D_PAGE');assert.equal(r.completedAt,123456);
    assert.deepEqual(Object.values(r.responses),values);assert.deepEqual(inspectionStateMap(s),inspectionStateMap(s));
    assert.equal(inspectionStateMap(s).filter(x=>x.status==='NOT_INSPECTED').length,3);
  }
});

test('partial, all-answered-unconfirmed and edited records stay uninspected until reconfirmed',()=>{
  let s=createTireInspection('local');
  for(const c of CHECKS){s=answer(s,c.id,'FOUND');assert.equal(first(s).status,'NOT_INSPECTED');assert.equal(first(s).draft,true);assert.equal(first(s).completedAt,null);}
  s=updateTireInspection(s,{type:'CONFIRM',sessionId:'local',tireId:id,at:100});assert.equal(first(s).status,'FINDINGS_REPORTED');
  s=answer(s,'damage','UNABLE');assert.equal(first(s).status,'NOT_INSPECTED');assert.equal(first(s).completedAt,null);
  assert.match(stateRecordHtml(s,id),/확정하기 전에는 결과로 표시하지 않습니다/);assert.match(summaryHtml(s),/응답 중 · 아직 확정하지 않음/);
});

test('wrong session/identity/source, partial or malformed completion cannot tint a part as a result',()=>{
  const s=complete(['NOT_FOUND','NOT_FOUND','NOT_FOUND']),row=s.tires[id];
  for(const patch of [{sessionId:'previous'},{tireId:'tire.front-right'},{source:'PLEOS'},{source:'MOBILE'},
    {completedAt:null},{completedAt:NaN},{completedAt:-1},{completedAt:8640000000000001},{completedAt:'123456'},
    {responses:{damage:'NOT_FOUND'}},{responses:{...row.responses,wear:['NOT_FOUND']}},
    {responses:{...row.responses,pressure:'FOUND'}},{status:'ACCEPTED'},{schemaVersion:2}]) {
    const invalid={...s,tires:{...s.tires,[id]:{...row,...patch}}};
    assert.equal(first(invalid).status,'NOT_INSPECTED',JSON.stringify(patch));assert.equal(first(invalid).source,null);
  }
  assert.equal(first({...s,sessionId:'new'}).status,'NOT_INSPECTED');
  assert.equal(first(createTireInspection('new')).completedAt,null);
});

test('summary/detail use one projection and distinguish record time/source from SDK and mobile receipt',()=>{
  const s=complete(['NOT_FOUND','UNABLE','FOUND']);
  for(const html of [summaryHtml(s),stateRecordHtml(s,id)]){
    // Provenance in words for the driver, the original instant in the datetime attribute. The contract value is not shown.
    assert.match(html,/이상 징후 보고/);assert.match(html,/이 화면에서 직접 입력/);assert.match(html,/datetime="1970-01-01T00:02:03.456Z"/);
    assert.doesNotMatch(visible(html),/USER_REPORTED/);
    assert.ok(!/정상 판정|안전함|source="PLEOS"|source="MOBILE"/.test(html));
  }
  const legend=stateLegendHtml(s);for(const label of ['미점검','이상 징후 보고','확인 불가','발견 사항 없음'])assert.ok(legend.includes(label));
  assert.match(legend,/점검 완료 1\/17/,'the state key counts the 17 result parts, tires and received results alike');
  assert.ok(stateRecordHtml(s,'washer-fluid-cap').includes('data-inspection-state="NOT_INSPECTED"'),'a part without a record reads as not inspected');
});

test('compact tire summary has no developer scope block, and the record time keeps the original instant',()=>{
  const s=complete(['FOUND','UNABLE','NOT_FOUND']),summary=summaryHtml(s),record=stateRecordHtml(s,id);
  assert.ok(!summary.includes('record-scope'));assert.ok(!summary.includes('USER_REPORTED'));
  assert.match(record,/<time datetime="1970-01-01T00:02:03.456Z">[^<]+<\/time>/);
  assert.equal(new Date(record.match(/datetime="([^"]+)"/)[1]).getTime(),123456,'the shown time is the record time, not a render time');
});
