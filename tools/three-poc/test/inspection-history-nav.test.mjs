// P10 History follow-up: a current-session result opened from History goes back to that History screen, and History
// shows plain words while keeping every raw value. Pure rules, no DOM, GLB or Native (AVD and phone: NOT_RUN).
// The real page is covered by test/browser-inspection-history.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {STATES as S,EVENTS as E,BACK_DEPTH,initialState,transition,hoodTarget,cameraGoal,isHistoryState,historyHeld} from '../inspection-flow.mjs';
import {inspectionBack} from '../inspection-product.mjs';
import {createInspectionHistoryStore} from '../inspection-history-store.mjs';
import {historyListResultsHtml,historyDetailResultsHtml,historyPanelHtml,historySessionZoneHtml,HISTORY_STATUS_LABELS} from '../inspection-history-view.mjs';
import {HISTORY_STATUSES} from '../inspection-history-contract.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {createTireInspection,updateTireInspection,CHECKS} from '../tire-inspection.mjs';
import {projectInspectionResults} from '../inspection-results.mjs';
import {demoRows} from './history-demo-provider.mjs';

const rows=await demoRows(34),RECORD=rows[0].recordId;
const ev=(type,extra={})=>({type,...extra});
const go=(events,s=initialState())=>events.reduce((st,e)=>transition(st,typeof e==='string'?{type:e}:e),s);
const settle=s=>s.name===S.HOOD_CLOSING?transition(s,ev(E.HOOD_CLOSED)):s;
const history=from=>transition(from,ev(E.OPEN_HISTORY));
const sessionPart=(s,id)=>transition(s,ev(E.OPEN_RESULT,{id}));

// ---- History → current-session result → Back ---------------------------------------------------------------------
test('list → this session\'s part result → Back returns to the same list, then to the entry screen',()=>{
  const entry=go([E.START]),list=history(entry);
  const result=sessionPart(list,'tire.front-left');
  assert.equal(result.name,S.PART_RESULT);assert.equal(result.component,'tire.front-left');assert.equal(historyHeld(result),true);
  const back=transition(result,ev(E.BACK));
  assert.deepEqual(back,{...list,afterClose:null});assert.equal(isHistoryState(back),true);
  assert.deepEqual(transition(back,ev(E.BACK)),entry,'one more Back leaves History for where it was opened');
});

test('detail → this session\'s part result → Back returns to the same record\'s detail, then the list, then the entry',()=>{
  const entry=go([E.START]),list=history(entry),detail=transition(list,ev(E.OPEN_HISTORY_DETAIL,{recordId:RECORD}));
  const back=transition(sessionPart(detail,'brake-fluid-reservoir'),ev(E.BACK));
  assert.equal(back.name,S.HOOD_CLOSING,'the brake result opened the hood; it closes on the way back');
  assert.equal(historyHeld(back),true,'History is still held while the hood closes');
  const returned=transition(back,ev(E.HOOD_CLOSED));
  assert.equal(returned.name,S.HISTORY_DETAIL);assert.equal(returned.recordId,RECORD);
  const toList=transition(returned,ev(E.BACK));assert.equal(toList.name,S.HISTORY_LIST);assert.equal(toList.recordId,null);
  assert.deepEqual(transition(toList,ev(E.BACK)),entry);
});

test('the entry screen\'s own path survives: summary → History → result → Back → Back → summary → Back → its origin',()=>{
  const tire=go([E.START,ev(E.SELECT_AREA,{id:'tires'}),ev(E.SELECT_TIRE,{id:'tire.rear-left'})]);
  const summary=transition(tire,ev(E.SHOW_SUMMARY)),list=history(summary);
  const back=go([ev(E.OPEN_RESULT,{id:'wiper.front.left'}),E.BACK,E.BACK],list);
  assert.deepEqual(back,summary);assert.deepEqual(transition(back,ev(E.BACK)),tire);
});

test('History and results visited many times: no growth, no cycle, the same return point each time',()=>{
  let s=history(go([E.START,ev(E.SHOW_SUMMARY)]));const sizes=new Set();
  for(let i=0;i<40;i++){
    s=sessionPart(s,MOBILE_TARGETS[i%17].partId);
    if(i%3===0)s=sessionPart(s,MOBILE_TARGETS[(i+5)%17].partId);       // moving between results replaces the screen
    s=settle(transition(s,ev(i%4===0?E.OPEN_HISTORY:E.BACK)));         // History again from that result goes back to it
    assert.equal(isHistoryState(s),true,`step ${i}: ${s.name}`);
    if(i%5===0)s=transition(transition(s,ev(E.OPEN_HISTORY_DETAIL,{recordId:rows[i%rows.length].recordId})),ev(E.BACK));
    sizes.add(JSON.stringify(s).length);
  }
  assert.equal(sizes.size,1,'the History state never grows');
  let depth=0;for(let x=sessionPart(s,'washer-fluid-cap');x.back;x=x.back)depth++;
  assert.ok(depth<=BACK_DEPTH,`depth ${depth}`);
});

test('opening History again from such a result goes back to the same History instead of nesting a new one',()=>{
  const list=history(go([E.START])),result=sessionPart(list,'tire.front-left');
  assert.deepEqual(transition(result,ev(E.OPEN_HISTORY)),{...list,afterClose:null});
  const hood=sessionPart(list,'battery-12v'),closing=transition(hood,ev(E.OPEN_HISTORY));
  assert.equal(closing.name,S.HOOD_CLOSING);assert.equal(transition(closing,ev(E.HOOD_CLOSED)).name,S.HISTORY_LIST);
});

test('camera and hood follow the screen: History restores its entry view after the result',()=>{
  const preview=go([E.START,ev(E.SELECT_AREA,{id:'tires'}),ev(E.SELECT_TIRE,{id:'tire.front-right'}),ev(E.SHOW_SUMMARY)]);
  const list=history(preview),result=sessionPart(list,'lcw-coolant-reservoir');
  assert.equal(hoodTarget(result),60);assert.equal(cameraGoal(result),'bay');
  const back=settle(transition(result,ev(E.BACK)));
  assert.equal(hoodTarget(back),hoodTarget(list));assert.equal(cameraGoal(back),cameraGoal(list));
});

test('leaving to anything else releases History; Android Back uses the same single step',()=>{
  const list=history(go([E.START])),result=sessionPart(list,'tire.front-left');
  for(const next of [transition(result,ev(E.SHOW_SUMMARY)),transition(result,ev(E.EXIT)),transition(result,ev(E.SELECT_TIRE,{id:'tire.front-left'}))])assert.equal(historyHeld(next),false,next.name);
  let state=result;const calls=[];
  const api={get state(){return state;},dispatch:e=>{calls.push(e.type);state=transition(state,e);return true;}};
  inspectionBack(api,()=>assert.fail('never closes away from home'));
  assert.deepEqual(calls,['BACK']);assert.equal(state.name,S.HISTORY_LIST);
});

test('opening this session\'s result from History changes neither the session nor the stored records',async()=>{
  let local=createTireInspection('local');
  for(const c of CHECKS)local=updateTireInspection(local,{type:'ANSWER',tireId:'tire.front-left',sessionId:'local',checkId:c.id,answer:'UNABLE'});
  local=updateTireInspection(local,{type:'CONFIRM',tireId:'tire.front-left',sessionId:'local',at:100});
  const s=await store(rows.slice(0,5)),before=[JSON.stringify(local),JSON.stringify(s.snapshot)];
  const row=projectInspectionResults(local,null).find(r=>r.partId==='tire.front-left');
  const zone=historySessionZoneHtml(row);
  assert.match(zone,/data-action="history-session-part" data-id="tire.front-left">이번 점검의 이 부품 결과 보기/);
  assert.match(zone,/data-inspection-state="UNABLE"/,'the session\'s own result, not the stored one');
  go([E.START,E.OPEN_HISTORY,ev(E.OPEN_RESULT,{id:'tire.front-left'}),E.BACK]);
  assert.deepEqual([JSON.stringify(local),JSON.stringify(s.snapshot)],before);
});

// ---- plain words, raw values kept ---------------------------------------------------------------------------------
const dto=(r,detail)=>{const {originalResult,...f}=r;return {...f,source:'USER_REPORTED',method:'SELF',channel:'MOBILE',ownershipEvidence:'SESSION_CREATION_BINDING',sdkDataIncluded:false,...(detail?{responses:originalResult.responses??{},originalResult}:{})};};
const reply=items=>({status:200,body:{schemaVersion:1,items:items.map(r=>dto(r)),page:{limit:20,hasMore:items.length===20,nextCursor:items.length===20?'next':null}}});
async function store(items,detail){const s=createInspectionHistoryStore({provider:{origin:'VERIFIED_NATIVE',list:async()=>reply(items),detail:async()=>detail}});await s.openList();return s;}
const visible=html=>html.replace(/<details[^>]*>[\s\S]*?<\/details>/g,'').replace(/<[^>]+>/g,' ');
const INTERNAL=new RegExp(`USER_REPORTED|taskId|partId|recordId|inspectionId|digest|schema v|\\b(?:${[...HISTORY_STATUSES,'SELF','MOBILE'].join('|')})\\b`);

test('History list, filters, detail and the session zone read in plain words',async()=>{
  const s=await store(rows.slice(0,20));
  const listPanel=historyPanelHtml({name:S.HISTORY_LIST},s.snapshot,projectInspectionResults(createTireInspection('local'),null)[1]);
  assert.doesNotMatch(visible(listPanel),INTERNAL);
  for(const status of HISTORY_STATUSES)assert.match(listPanel,new RegExp(`<option value="${status}">${HISTORY_STATUS_LABELS[status]}</option>`),'status filter in words, value unchanged');
  for(const v of [1,2]){
    const r=rows.find(x=>x.schemaVersion===v),d=await store([r],{status:200,body:{schemaVersion:1,record:dto(r,true)}});await d.openDetail(r.recordId);
    const html=historyDetailResultsHtml(d.snapshot,projectInspectionResults(createTireInspection('local'),null)[0]);
    assert.doesNotMatch(visible(html),INTERNAL,`v${v}`);
    assert.match(visible(html),/점검 부품/);assert.match(visible(html),/결과 출처\s+스마트폰으로 사용자가 직접 보고/);assert.match(visible(html),/점검 완료/);
    for(const raw of [r.taskId,r.partId,r.inspectionStatus,'USER_REPORTED / SELF / MOBILE',r.recordId,r.inspectionId,r.resultDigest])assert.ok(html.includes(raw),`raw ${raw} kept in the developer details`);
    assert.match(html,/<details class="history-original"><summary>개발자 정보 · 원본 기록과 무결성<\/summary>/);
  }
});

test('the washer card names its own answer, since its badge is shared',async()=>{
  const washer=rows.filter(r=>r.schemaVersion===1);assert.ok(washer.length>0);
  const html=historyListResultsHtml((await store(washer)).snapshot);
  for(const r of washer)assert.ok(html.includes(`data-status="${r.inspectionStatus}"`)&&html.includes(HISTORY_STATUS_LABELS[r.inspectionStatus]),r.inspectionStatus);
  assert.doesNotMatch(visible(html),INTERNAL);
});
