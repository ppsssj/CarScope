import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STATES as S,EVENTS as E,initialState,transition,hoodTarget,cameraGoal,isHistoryState} from '../inspection-flow.mjs';
import {sessionActions,inspectionBack,productSummaryHtml} from '../inspection-product.mjs';
import {createInspectionHistoryStore} from '../inspection-history-store.mjs';
import {historyListResultsHtml,historyDetailResultsHtml,historyPanelHtml,historyEntryZoneHtml,historyFilterSummaryText,formatHistoryTime,HISTORY_STATUS_LABELS} from '../inspection-history-view.mjs';
import {HISTORY_STATUSES,EMPTY_HISTORY_FILTERS} from '../inspection-history-contract.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {createTireInspection,updateTireInspection,CHECKS} from '../tire-inspection.mjs';
import {projectInspectionResults} from '../inspection-results.mjs';
import {demoRows} from './history-demo-provider.mjs';

const rows=await demoRows(34),RECORD=rows[0].recordId;
const ev=(type,extra={})=>({type,...extra});
const start=()=>transition(initialState(),ev(E.START));
const dto=(r,detail)=>{const {originalResult,...f}=r;return {...f,source:'USER_REPORTED',method:'SELF',channel:'MOBILE',ownershipEvidence:'SESSION_CREATION_BINDING',sdkDataIncluded:false,...(detail?{responses:originalResult.responses??{},originalResult}:{})};};
const provider=(list,detail)=>({origin:'DEMO',list:async()=>list,detail:async()=>detail});
const listReply=(items,more=false)=>({status:200,body:{schemaVersion:1,items:items.map(r=>dto(r)),page:{limit:20,hasMore:more,nextCursor:more?'next':null}}});
const openStore=async(reply,detail)=>{const s=createInspectionHistoryStore({provider:provider(reply,detail)});await s.openList();return s;};
const native={...provider(listReply(rows.slice(0,1))),origin:'VERIFIED_NATIVE'};

test('History opens only from overview, summary and part result; Back restores that exact screen', ()=>{
  const part=transition(start(),ev(E.OPEN_RESULT,{id:'battery-12v'})),summary=transition(start(),ev(E.SHOW_SUMMARY));
  for(const from of [start(),summary,part]){
    const list=transition(from,ev(E.OPEN_HISTORY));
    assert.equal(list.name,S.HISTORY_LIST);assert.equal(list.area,from.area);assert.equal(list.component,from.component);
    assert.equal(hoodTarget(list),hoodTarget(from),'hood does not move');assert.equal(cameraGoal(list),cameraGoal(from),'camera does not move');
    assert.equal(transition(list,ev(E.OPEN_HISTORY)),list,'duplicate entry');
    const detail=transition(list,ev(E.OPEN_HISTORY_DETAIL,{recordId:RECORD}));
    assert.equal(detail.name,S.HISTORY_DETAIL);assert.equal(detail.recordId,RECORD);
    assert.equal(transition(detail,ev(E.OPEN_HISTORY_DETAIL,{recordId:rows[1].recordId})),detail,'no chained detail');
    const back=transition(detail,ev(E.BACK));assert.equal(back.name,S.HISTORY_LIST);assert.equal(back.recordId,null);
    assert.deepEqual(transition(back,ev(E.BACK)),from);
  }
  const idle=initialState();assert.equal(transition(idle,ev(E.OPEN_HISTORY)),idle);
  const opening=transition(start(),ev(E.SELECT_AREA,{id:'hood'}));assert.equal(transition(opening,ev(E.OPEN_HISTORY)),opening);
  const closing=transition(opening,ev(E.BACK));assert.equal(transition(closing,ev(E.OPEN_HISTORY)),closing);
});

test('History rejects an invalid record id and ignores unrelated or late model events', ()=>{
  const list=transition(start(),ev(E.OPEN_HISTORY));
  for(const recordId of [undefined,'','../x',RECORD.replace('-4000-','-5000-'),RECORD+'0'])assert.equal(transition(list,ev(E.OPEN_HISTORY_DETAIL,{recordId})),list);
  for(const event of [ev(E.SELECT_AREA,{id:'hood'}),ev(E.SELECT_TIRE,{id:'tire.front-left'}),ev(E.HOOD_OPENED),ev(E.HOOD_CLOSED),ev(E.SELECT_COMPONENT,{id:'battery-12v'}),ev(E.START)])assert.equal(transition(list,event),list);
});

test('leaving History closes an opened hood first and keeps no History fields', ()=>{
  const hoodPart=transition(start(),ev(E.OPEN_RESULT,{id:'battery-12v'}));
  assert.equal(hoodTarget(hoodPart),60);
  const list=transition(hoodPart,ev(E.OPEN_HISTORY));
  const closing=transition(list,ev(E.SHOW_SUMMARY));assert.equal(closing.name,S.HOOD_CLOSING);assert.equal(closing.afterClose,S.INSPECTION_SUMMARY);assert.ok(!('historyReturn' in closing));
  assert.equal(transition(closing,ev(E.HOOD_CLOSED)).name,S.INSPECTION_SUMMARY);
  const exit=transition(list,ev(E.EXIT));assert.equal(exit.name,S.HOOD_CLOSING);assert.equal(exit.afterClose,S.IDLE);assert.deepEqual(transition(exit,ev(E.HOOD_CLOSED)).name,S.IDLE);
  const overviewList=transition(start(),ev(E.OPEN_HISTORY));
  assert.deepEqual(transition(overviewList,ev(E.EXIT)),initialState());
  assert.deepEqual(transition(overviewList,ev(E.SHOW_SUMMARY)),{name:S.INSPECTION_SUMMARY,area:null,component:null,afterClose:null});
  const toResult=transition(overviewList,ev(E.OPEN_RESULT,{id:'brake-fluid-reservoir'}));
  // History follow-up: a result opened from History remembers that History screen (and only its entry chain).
  const {back,...result}=toResult;
  assert.deepEqual(result,{name:S.PART_RESULT,component:'brake-fluid-reservoir',area:'hood',afterClose:null});
  assert.deepEqual(back,{...overviewList,afterClose:null});assert.equal(transition(toResult,ev(E.BACK)).name,S.HOOD_CLOSING,'the hood closes before History');
  assert.equal(transition(overviewList,ev(E.OPEN_RESULT,{id:'nope'})),overviewList);
});

test('Android Back takes one step through History and never closes the screen', ()=>{
  let state=transition(transition(start(),ev(E.OPEN_HISTORY)),ev(E.OPEN_HISTORY_DETAIL,{recordId:RECORD}));
  const closes=[],api={get state(){return state;},dispatch(e){state=transition(state,e);return true;}};
  assert.equal(inspectionBack(api,x=>closes.push(x)),true);assert.equal(state.name,S.HISTORY_LIST);
  assert.equal(inspectionBack(api,x=>closes.push(x)),true);assert.equal(state.name,S.INSPECTION_OVERVIEW);
  assert.equal(closes.length,0);
  assert.equal(inspectionBack(api,x=>closes.push(x)),true);assert.equal(state.name,S.IDLE);assert.equal(closes.length,0);
  inspectionBack(api,x=>closes.push(x));assert.equal(closes.length,1,'only home closes');
});

test('entry appears where History can open, and ending a session states stored records stay', ()=>{
  for(const name of Object.values(S)){
    const html=sessionActions({name}),entry=[S.INSPECTION_OVERVIEW,S.INSPECTION_SUMMARY,S.PART_RESULT].includes(name);
    assert.equal(html.includes('data-action="open-history"'),entry,name);
    // P10 PR #2: every screen, History included, says what ending clears and that stored records stay.
    if(name!==S.IDLE){assert.ok(html.includes('이번 점검의 응답'),name);assert.ok(html.includes('저장된 과거 점검 기록은 그대로 남습니다'),name);}
    if(isHistoryState({name}))assert.ok(html.includes('이번 점검 전체 점검 요약'),'History names the current session explicitly');
  }
});

test('unavailable, unauthorized, error and empty screens are visibly different and show no rows', async()=>{
  const none=createInspectionHistoryStore({provider:null});await none.openList();
  const html=historyListResultsHtml(none.snapshot);
  assert.ok(html.includes('data-history-status="UNAVAILABLE"'));assert.ok(html.includes('저장된 기록이 없다는 뜻이 아닙니다'));assert.ok(!html.includes('data-action="history-retry"'));
  const seen={};
  for(const [status,want] of [[403,'AUTH_REQUIRED'],[404,'NOT_FOUND'],[400,'INVALID_QUERY'],[429,'RATE_LIMITED'],[500,'SERVER_ERROR']]){
    const s=await openStore({status,body:{error:{code:'x'}}}),out=historyListResultsHtml(s.snapshot);
    assert.ok(out.includes(`data-history-status="${want}"`),want);assert.ok(!out.includes('data-record'));assert.ok(!out.includes('저장된 기록이 없습니다'),want);assert.ok(out.includes('role="alert"'));seen[want]=out;
  }
  assert.equal(new Set(Object.values(seen)).size,5);
  assert.ok(seen.AUTH_REQUIRED.includes('기록이 없다는 뜻이 아니며'));assert.ok(seen.INVALID_QUERY.includes('data-action="history-reset-filters"'));assert.ok(seen.RATE_LIMITED.includes('data-action="history-retry"'));assert.ok(!seen.NOT_FOUND.includes('data-action="history-retry"'));
  const empty=await openStore(listReply([]));
  assert.ok(historyListResultsHtml(empty.snapshot).includes('data-history-status="EMPTY"'));
  const net=createInspectionHistoryStore({provider:{origin:'DEMO',list:async()=>{throw Error('x');},detail:async()=>{throw Error('x');}}});await net.openList();
  const netHtml=historyListResultsHtml(net.snapshot);assert.ok(netHtml.includes('NETWORK_ERROR'));assert.ok(netHtml.includes('history-retry'));
  const loading=createInspectionHistoryStore({provider:{origin:'DEMO',list:()=>new Promise(()=>{}),detail:()=>new Promise(()=>{})}});loading.openList();
  assert.ok(historyListResultsHtml(loading.snapshot).includes('aria-busy="true"'));loading.dispose();
});

test('list cards carry the required fields; every part renders; no status becomes "normal" or "safe"', async()=>{
  const items=rows.slice(0,20),s=await openStore(listReply(items,true)),html=historyListResultsHtml(s.snapshot);
  for(const r of items){
    // History follow-up: the card names the part in words; the task id stays on the card as data, not as text.
    assert.ok(html.includes(`data-record="${r.recordId}"`));assert.ok(html.includes(`data-task="${r.taskId}"`));assert.ok(!html.includes(`taskId ${r.taskId}`));
    assert.ok(html.includes(`datetime="${new Date(r.completedAt).toISOString()}"`));
  }
  assert.ok(html.includes('data-source="USER_REPORTED"'));assert.ok(html.includes('스마트폰으로 사용자가 직접 보고'));assert.ok(html.includes('data-action="history-more"'));assert.ok(html.includes('전체 개수는 제공되지 않습니다'));
  assert.ok(html.includes('불러온 기록 20건'));assert.ok(!/전체 \d+건|총 \d+건/.test(html));
  const all=await openStore(listReply(rows.slice(0,17)));
  const allHtml=historyListResultsHtml(all.snapshot);for(const t of MOBILE_TARGETS)assert.ok(allHtml.includes(t.label),t.label);
  assert.ok(!/정상|안전|양호/.test(allHtml),'list never turns a report into a verdict');
  assert.ok(!/정상|안전|양호/.test(Object.values(HISTORY_STATUS_LABELS).join()));
  assert.deepEqual(Object.keys(HISTORY_STATUS_LABELS).sort(),[...HISTORY_STATUSES].sort());
});

test('demo origin is labeled 데모 데이터 on list and detail; a verified provider never is', async()=>{
  const r=rows[1],s=createInspectionHistoryStore({provider:provider(listReply(rows.slice(0,3)),{status:200,body:{schemaVersion:1,record:dto(r,true)}})});await s.openList();
  const list=historyListResultsHtml(s.snapshot);assert.ok(list.includes('데모 데이터'));assert.equal((list.match(/history-demo-chip/g)??[]).length,3);
  await s.openDetail(r.recordId);assert.ok(historyDetailResultsHtml(s.snapshot).includes('데모 데이터'));
  const empty=await openStore({status:403,body:{}});assert.ok(historyListResultsHtml(empty.snapshot).includes('데모 데이터'),'state screens too');
  const real=createInspectionHistoryStore({provider:native});await real.openList();assert.ok(!historyListResultsHtml(real.snapshot).includes('데모 데이터'));
});

test('detail v2 shows task-labelled answers, separate times and provenance, without changing the original', async()=>{
  const r=rows.find(x=>x.schemaVersion===2),s=await openStore(listReply([r]),{status:200,body:{schemaVersion:1,record:dto(r,true)}});await s.openDetail(r.recordId);
  const before=JSON.stringify(s.snapshot.detail.record),html=historyDetailResultsHtml(s.snapshot);
  for(const part of ['USER_REPORTED','서버 수락','사용자 기기 보고 시각','포함하지 않음','점검 상세 설명','질문별 사용자 응답',r.taskId,r.partId,r.resultDigest,r.originalResult.completedAt,r.originalResult.startedAt])assert.ok(html.includes(part),part);
  assert.ok(html.includes(`datetime="${new Date(r.acceptedAt).toISOString()}"`));
  assert.ok(html.includes('외관 손상')||html.includes('충전구')||html.includes('외부 액면'));
  assert.ok(!html.includes('undefined'));assert.ok(!html.includes('<input'),'read only');assert.ok(!/data-action="select-result"|data-action="request-mobile"/.test(html));
  assert.equal(JSON.stringify(s.snapshot.detail.record),before);
});

test('schema v1 washer detail shows the user choice and treats missing answers as expected', async()=>{
  const r=rows.find(x=>x.schemaVersion===1),s=await openStore(listReply([r]),{status:200,body:{schemaVersion:1,record:dto(r,true)}});await s.openDetail(r.recordId);
  const html=historyDetailResultsHtml(s.snapshot);
  assert.ok(html.includes('질문별 응답 없이 하나의 선택으로 저장됩니다'));assert.ok(html.includes('오류가 아닙니다'));assert.ok(html.includes(r.inspectionStatus),'the raw status stays in the original-record details');
  assert.ok(html.includes(`사용자 선택: ${HISTORY_STATUS_LABELS[r.inspectionStatus]}</p>`),'the choice in words, without its code beside it');
  assert.ok(!html.includes('data-history-status'),'not an error state');
});

test('detail failures and loading render distinct states with no record content', async()=>{
  const r=rows[0];
  for(const [status,want] of [[404,'NOT_FOUND'],[403,'AUTH_REQUIRED'],[500,'SERVER_ERROR'],[429,'RATE_LIMITED']]){
    const s=await openStore(listReply([r]),{status,body:{}});await s.openDetail(r.recordId);
    const html=historyDetailResultsHtml(s.snapshot);assert.ok(html.includes(`data-history-status="${want}"`));assert.ok(!html.includes(r.resultDigest));
  }
  const bad=await openStore(listReply([r]),{status:200,body:{schemaVersion:1,record:{...dto(r,true),resultDigest:'sha256:'+'0'.repeat(64)}}});await bad.openDetail(r.recordId);
  assert.ok(historyDetailResultsHtml(bad.snapshot).includes('INVALID_RESPONSE'));
});

test('session, stored history and SDK stay separate sources; opening a record changes no session data', async()=>{
  let session=createTireInspection('session');
  for(const c of CHECKS)session=updateTireInspection(session,{type:'ANSWER',sessionId:'session',tireId:'tire.front-left',checkId:c.id,answer:'FOUND'});
  session=updateTireInspection(session,{type:'CONFIRM',sessionId:'session',tireId:'tire.front-left',at:100});
  const rowsBefore=JSON.stringify(projectInspectionResults(session,null)),sessionRef=session;
  const past=rows.find(x=>x.taskId==='tire.front-left'&&x.inspectionStatus==='NO_FINDINGS_REPORTED')??rows.find(x=>x.taskId==='tire.front-left');
  const s=await openStore(listReply([past]),{status:200,body:{schemaVersion:1,record:dto(past,true)}});await s.openDetail(past.recordId);
  const current=projectInspectionResults(session,null).find(r=>r.partId==='tire.front-left'),html=historyDetailResultsHtml(s.snapshot,current);
  const zones=[...html.matchAll(/data-source-zone="(\w+)"/g)].map(m=>m[1]);
  assert.deepEqual(zones,['HISTORY','SESSION']);
  const [historyPart,sessionPart]=html.split('data-source-zone="SESSION"');
  assert.ok(sessionPart.includes('이상 징후 보고'),'current session keeps its own status');assert.ok(!sessionPart.includes(past.resultDigest));
  assert.ok(historyPart.includes('USER_REPORTED'));assert.ok(!historyPart.includes('2026-11-04'));
  assert.equal(session,sessionRef);assert.equal(JSON.stringify(projectInspectionResults(session,null)),rowsBefore);assert.equal(session.tires['tire.front-left'].completedAt,100);
  assert.ok(html.includes('Pleos 실시간 상태와 별개'));assert.ok(!/PLEOS|observedAt|Capability|STALE/.test(html),'no SDK observation is mixed in');
  assert.ok(historyEntryZoneHtml('왼쪽').includes('data-source-zone="HISTORY"'));
});

test('filter form lists 17 parts and six exact statuses, keeps values, and lives outside the live region', async()=>{
  const s=createInspectionHistoryStore({provider:provider(listReply([]))});await s.openList({taskId:'brake-fluid',status:'UNABLE',fromDate:'2026-10-01',toDate:'2026-10-02'});
  const html=historyPanelHtml({name:S.HISTORY_LIST},s.snapshot,null);
  for(const t of MOBILE_TARGETS)assert.ok(html.includes(`value="${t.taskId}"`));for(const v of HISTORY_STATUSES)assert.ok(html.includes(`value="${v}"`));
  assert.ok(html.includes('value="brake-fluid" selected'));assert.ok(html.includes('value="UNABLE" selected'));assert.ok(html.includes('value="2026-10-01"'));
  assert.ok(html.includes('<details class="history-filters"><summary'),'the form stays collapsed so rows stay on screen');
  assert.equal(historyFilterSummaryText(s.snapshot.filters),'필터 · 브레이크액 · 확인 불가 · 2026-10-01 ~ 2026-10-02');assert.equal(historyFilterSummaryText(EMPTY_HISTORY_FILTERS),'필터 · 부품·결과·날짜');
  assert.ok(html.indexOf('id="historyFilterForm"')<html.indexOf('id="historyResults"'));assert.ok(historyListResultsHtml(s.snapshot).indexOf('historyFilterForm')<0);
  for(const bad of ['"><img src=x onerror=1>']){const x=createInspectionHistoryStore({provider:provider(listReply([]))});await x.openList({fromDate:bad});assert.ok(!historyPanelHtml({name:S.HISTORY_LIST},x.snapshot,null).includes('<img'));assert.equal(x.snapshot.list.status,'INVALID_QUERY');}
});

test('times render as a timezone-labelled local value with the exact instant kept in datetime', ()=>{
  const at=Date.UTC(2026,10,3,15,30,0),html=formatHistoryTime(at,{timeZone:'Asia/Seoul'});
  assert.ok(html.includes('datetime="2026-11-03T15:30:00.000Z"'));assert.ok(html.includes('2026. 11. 04.'),html);assert.ok(html.includes('00:30'),html);assert.ok(html.includes('GMT+9'),html);
  assert.ok(formatHistoryTime(-5000,{timeZone:'UTC'}).includes('1969-12-31T23:59:55.000Z'));
});

test('product summary and session state stay as they were before History', ()=>{
  const html=productSummaryHtml(createTireInspection('s'),null);assert.ok(html.includes('전체 점검 요약'));assert.ok(!html.includes('data-record'));
  assert.ok(readFileSync(new URL('../inspect.js',import.meta.url),'utf8').includes('createInspectionHistoryStore({provider:null})'),'production composition has no provider');
});
