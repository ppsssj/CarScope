// P10 PR #2: unified inspection panels. Navigation that follows the real entry path, one 17-part progress view, a summary
// that lists parts only, plain words for drivers, one Back label and an exit that says what it clears. No DOM, GLB or
// Native here: the browser check (test/browser-inspection-panels.mjs) covers the real page. AVD and phone: NOT_RUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STATES as S,EVENTS as E,BACK_DEPTH,initialState,transition,hoodTarget,cameraGoal,returnPoint} from '../inspection-flow.mjs';
import {productSummaryHtml,sessionActions,sessionDataScope,exitConfirmHtml,hoodGuideHtml,washerGuideHtml,backButtonHtml,BACK_LABEL,EXIT_SCOPE_TEXT,inspectionBack} from '../inspection-product.mjs';
import {partResultHtml,partActionHtml,resultSummaryHtml,areaResultText} from '../inspection-results-view.mjs';
import {progressCounts,progressText,stateLegendHtml} from '../inspection-state-view.mjs';
import {projectInspectionResults} from '../inspection-results.mjs';
import {summaryHtml,guideHtml} from '../tire-inspection-view.mjs';
import {historyPanelHtml} from '../inspection-history-view.mjs';
import {MOBILE_REQUEST_TEXT} from '../inspection-toast.mjs';
import {createTireInspection,updateTireInspection,CHECKS} from '../tire-inspection.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {MOBILE_TARGETS,digestResult} from '../mobile-result-contract.mjs';
import {testAuthority,wireResult} from './result-fixtures.mjs';

const go=(events,s=initialState())=>events.reduce((st,ev)=>transition(st,typeof ev==='string'?{type:ev}:ev),s);
const START=E.START,BACK=E.BACK,CLOSED=E.HOOD_CLOSED,OPENED=E.HOOD_OPENED;
const hood={type:E.SELECT_AREA,id:'hood'},result=id=>({type:E.OPEN_RESULT,id}),summary={type:E.SHOW_SUMMARY};
const settle=s=>s.name===S.HOOD_CLOSING?transition(s,{type:CLOSED}):s;
const screenOf=s=>({name:s.name,area:s.area,component:s.component});

// ---- navigation: Back follows the real entry path (P0-3) ---------------------------------------------------------------
test('a result opened from the hood list goes back to that list without closing the hood',()=>{
  const list=go([START,hood,OPENED]);
  const r=transition(list,result('lcw-coolant-reservoir'));
  assert.equal(r.name,S.PART_RESULT);assert.equal(hoodTarget(r),60);
  const back=transition(r,{type:BACK});
  assert.deepEqual(back,list);assert.equal(hoodTarget(back),60,'no close and reopen on the way back');assert.equal(cameraGoal(back),'bay');
});

test('a result opened from a part screen goes back to that part, with the same selection and camera goal',()=>{
  const preview=go([START,hood,OPENED,{type:E.SELECT_COMPONENT,id:'battery-12v'}]);
  const back=transition(transition(preview,result('lcw-coolant-reservoir')),{type:BACK});
  assert.deepEqual(back,preview);assert.equal(cameraGoal(back),'battery-12v');
  const tire=go([START,{type:E.SELECT_AREA,id:'tires'},{type:E.SELECT_TIRE,id:'tire.rear-left'}]);
  assert.deepEqual(transition(transition(tire,result('tire.rear-left')),{type:BACK}),tire);
});

test('the summary goes back to where it was opened, reopening the hood screen it closed',()=>{
  const washer=go([START,hood,OPENED,{type:E.SELECT_COMPONENT,id:'washer-fluid-cap'}]);
  const closing=transition(washer,summary);
  assert.equal(closing.name,S.HOOD_CLOSING);assert.equal(closing.afterClose,S.INSPECTION_SUMMARY);
  const sum=transition(closing,{type:CLOSED});assert.equal(sum.name,S.INSPECTION_SUMMARY);assert.equal(hoodTarget(sum),0);
  const back=transition(sum,{type:BACK});
  assert.deepEqual(back,washer);assert.equal(hoodTarget(back),60);assert.equal(cameraGoal(back),'washer-fluid-cap');
  const tire=go([START,{type:E.SELECT_AREA,id:'tires'},{type:E.SELECT_TIRE,id:'tire.front-right'}]);
  assert.deepEqual(go([summary,BACK],tire),tire);
});

test('summary → result → Back → Back walks the real path and never passes the summary twice',()=>{
  const tire=go([START,{type:E.SELECT_AREA,id:'tires'},{type:E.SELECT_TIRE,id:'tire.front-left'}]);
  const sum=transition(tire,summary),r=transition(sum,result('washer-fluid-cap'));
  const closing=transition(r,{type:BACK});
  assert.equal(closing.name,S.HOOD_CLOSING,'the hood closes before the summary');assert.equal(transition(closing,{type:OPENED}),closing);
  const back1=transition(closing,{type:CLOSED});assert.deepEqual(back1,sum);
  assert.deepEqual(transition(back1,{type:BACK}),tire);
});

test('moving between results replaces the result screen; a repeated open is ignored',()=>{
  const list=go([START,hood,OPENED]);
  let r=transition(list,result('lcw-coolant-reservoir'));
  assert.equal(transition(r,result('lcw-coolant-reservoir')),r,'same part: same object');
  for(const id of ['brake-fluid-reservoir','tire.front-left','wiper.front.left','washer-fluid-cap'])r=transition(r,result(id));
  assert.equal(r.component,'washer-fluid-cap');assert.deepEqual(transition(r,{type:BACK}),list);
});

test('History in between keeps where the result came from',()=>{
  const sum=go([START,summary]),r=transition(sum,result('tire.front-left'));
  const back=go([E.OPEN_HISTORY,BACK],r);
  assert.equal(back.name,S.PART_RESULT);assert.deepEqual(transition(back,{type:BACK}),sum);
});

test('the return chain is capped, and every step of it is a real screen',()=>{
  let s=go([START,{type:E.SELECT_AREA,id:'tires'}]);
  for(let i=0;i<40;i++)s=transition(transition(s,summary),result(MOBILE_TARGETS[i%17].partId));
  let depth=0;for(let x=s;x.back;x=x.back){depth++;assert.ok([S.PART_RESULT,S.INSPECTION_SUMMARY,S.TIRE_SELECTION,S.INSPECTION_OVERVIEW].includes(x.back.name),x.back.name);}
  assert.ok(depth<=BACK_DEPTH,`depth ${depth}`);
  for(let i=0;i<20&&s.name!==S.INSPECTION_OVERVIEW;i++)s=settle(transition(s,{type:BACK}));
  assert.ok([S.INSPECTION_OVERVIEW,S.TIRE_SELECTION,S.PART_RESULT,S.INSPECTION_SUMMARY].includes(s.name));
  assert.deepEqual(screenOf(returnPoint(go([START,hood]))),{name:S.INSPECTION_OVERVIEW,area:null,component:null},'an animation is not a return point');
});

test('ending from any screen reaches the same clean home state, with no navigation fields left',()=>{
  const sum=go([START,hood,OPENED,{type:E.SELECT_COMPONENT,id:'washer-fluid-cap'},summary]);
  for(const from of [sum,transition(settle(sum),result('battery-12v')),transition(go([START,summary]),result('tire.front-left'))]){
    assert.deepEqual(settle(transition(from,{type:E.EXIT})),initialState(),from.name);
  }
});

test('Android Back is the same single event as the panel and top-bar Back',()=>{
  let state=transition(go([START,hood,OPENED]),result('lcw-coolant-reservoir'));const calls=[];
  const api={get state(){return state;},dispatch:e=>{calls.push(e.type);state=transition(state,e);return true;}};
  inspectionBack(api,()=>assert.fail('never closes the screen away from home'));
  assert.deepEqual(calls,['BACK']);assert.equal(state.name,S.COMPONENT_SELECTION);
});

// ---- 17-part progress and summary -------------------------------------------------------------------------------------
const delivery=(b,r,digest)=>({bindingId:b.bindingId,localSessionId:b.localSessionId,generation:b.generation,syncSessionId:b.syncSessionId,taskId:b.taskId,inspectionId:r.inspectionId,resultDigest:digest,result:r});
function confirmed(local,id,answer){let s=local;for(const c of CHECKS)s=updateTireInspection(s,{type:'ANSWER',tireId:id,sessionId:s.sessionId,checkId:c.id,answer});return updateTireInspection(s,{type:'CONFIRM',tireId:id,sessionId:s.sessionId,at:1000});}

test('progress always counts 17 parts; the state counts add up to 17 and done is 17 minus not inspected',()=>{
  const answers=['FOUND','UNABLE','NOT_FOUND'];
  for(let mask=0;mask<81;mask++){
    let local=createTireInspection('local');
    ['tire.front-left','tire.front-right','tire.rear-left','tire.rear-right'].forEach((id,i)=>{const a=Math.floor(mask/3**i)%3;if(a<3&&mask%(i+2))local=confirmed(local,id,answers[a]);});
    const p=progressCounts(projectInspectionResults(local,null));
    assert.equal(p.total,17);assert.equal(Object.values(p.counts).reduce((a,b)=>a+b,0),17);assert.equal(p.done,17-p.counts.NOT_INSPECTED);
    assert.ok(resultSummaryHtml(local,null).includes(progressText(p)));
  }
});

test('the summary lists each of the 17 parts once, grouped by area, each opening its result screen',()=>{
  const html=resultSummaryHtml(createTireInspection('local'),null);
  for(const t of MOBILE_TARGETS)assert.equal(html.split(`data-action="result-detail" data-id="${t.partId}"`).length-1,1,t.partId);
  assert.equal((html.match(/data-action="result-detail"/g)??[]).length,17);
  for(const area of ['보닛','타이어','EV 충전구','전면 와이퍼','전조등'])assert.match(html,new RegExp(`<h3 class="result-group">${area} <small>0/\\d+</small>`));
  assert.doesNotMatch(html,/EV 배터리/,'an area with no result part has no group');
  const page=productSummaryHtml(createTireInspection('local'),null);
  assert.match(page,/정상·안전·주행 가능 판정이 아닙니다/);assert.match(page,/data-action="back">뒤로</);
  assert.doesNotMatch(page,/data-result-source|tire-map|네 타이어|워셔액 ·|SDK 관측과 별개|메모리에만/,'the side sections are gone');
});

test('a received phone result moves the summary, the area count and the part card together',async()=>{
  const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter});c.startSession('local');
  const local=createTireInspection('local'),t=MOBILE_TARGETS.find(x=>x.taskId==='brake-fluid');
  const before=resultSummaryHtml(local,c.snapshot);
  assert.match(before,/점검 완료 0\/17/);assert.equal(areaResultText(projectInspectionResults(local,c.snapshot),'hood'),'결과 0/6');
  const b={bindingId:'b',localSessionId:c.snapshot.localSessionId,generation:c.snapshot.generation,syncSessionId:'s',taskId:t.taskId,partId:t.partId,serverNow:1000,expiresAt:1e12};
  assert.equal(a.callbacks.onBinding(b),'BOUND');
  const r=wireResult(t.taskId,'FOUND');
  assert.equal(await a.callbacks.onAccepted(delivery(b,r,await digestResult(r))),'STAGED');
  const after=resultSummaryHtml(local,c.snapshot),rows=projectInspectionResults(local,c.snapshot);
  assert.match(after,/점검 완료 1\/17 · 미점검 16 · 이상 징후 보고 1/);assert.equal(areaResultText(rows,'hood'),'결과 1/6');
  assert.match(after,new RegExp(`data-id="${t.partId}"><span class="row-name">[^<]+</span><span class="inspection-state" data-inspection-state="FINDINGS_REPORTED">[^<]+</span><small>스마트폰 점검</small>`));
  assert.match(partResultHtml(local,c.snapshot,t.partId),/스마트폰 점검 · <time datetime="2026-11-04T01:02:03.000Z">/);
  assert.match(stateLegendHtml(local,c.snapshot),/점검 완료 1\/17/);
  c.endSession();assert.match(resultSummaryHtml(local,c.snapshot),/점검 완료 0\/17/,'ending the session clears the shown results');
  c.dispose();
});

// ---- plain words, with the raw values kept for developers ----------------------------------------------------------
const INTERNAL=/USER_REPORTED|ESTIMATED_GEOMETRY|\bNative\b|Capability|Availability|inspectionId|bindingId|digest|sessionPhase|\bMOBILE\b|UNVERIFIED|SUPPORTED|THIS_3D_PAGE|schema v/;
const visible=html=>html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g,'').replace(/<[^>]+>/g,' ');

test('nothing a driver sees by default carries an internal value, while the developer details still do',async()=>{
  const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter});c.startSession('local');
  let local=confirmed(createTireInspection('local'),'tire.front-left','UNABLE');
  local=updateTireInspection(local,{type:'ANSWER',tireId:'tire.rear-left',sessionId:'local',checkId:'damage',answer:'FOUND'});
  for(const t of MOBILE_TARGETS.slice(5,9)){
    const b={bindingId:'b-'+t.taskId,localSessionId:c.snapshot.localSessionId,generation:c.snapshot.generation,syncSessionId:'s',taskId:t.taskId,partId:t.partId,serverNow:1000,expiresAt:1e12};
    a.callbacks.onBinding(b);const r=wireResult(t.taskId,'UNABLE',`${MOBILE_TARGETS.indexOf(t)}1111111-1111-4111-8111-111111111111`);await a.callbacks.onAccepted(delivery(b,r,await digestResult(r)));
  }
  a.callbacks.onReceiver({taskId:'washer-fluid',phase:'QR_READY',retryAvailable:false,canCancel:true,inviteExpiresAt:Date.now()+60000});
  const screens={summary:productSummaryHtml(local,c.snapshot),tireSummary:summaryHtml(local,c.snapshot),guide:guideHtml(local,'tire.rear-left'),hood:hoodGuideHtml(),washer:washerGuideHtml('https://manual.invalid/'),exit:exitConfirmHtml(sessionDataScope(local,c.snapshot))};
  for(const t of MOBILE_TARGETS){screens['result:'+t.partId]=partResultHtml(local,c.snapshot,t.partId);screens['action:'+t.partId]=partActionHtml(local,c.snapshot,t.partId);}
  for(const name of Object.values(S))screens['nav:'+name]=sessionActions({name});
  for(const [name,html] of Object.entries(screens))assert.doesNotMatch(visible(html),INTERNAL,name);
  for(const text of Object.values(MOBILE_REQUEST_TEXT))assert.doesNotMatch(text,INTERNAL,text);
  const dev=partActionHtml(local,c.snapshot,MOBILE_TARGETS[5].partId);
  assert.match(dev,/<details class="dev-info debug-admin"><summary>개발자 정보<\/summary>/);
  for(const raw of ['inspectionId','bindingId','digest','MOBILE / USER_REPORTED','data-action="mobile-admin"'])assert.ok(dev.includes(raw),raw);
  assert.match(partActionHtml(local,c.snapshot,'tire.front-left'),/출처 코드<\/dt><dd>USER_REPORTED/);
  c.dispose();
});

test('the page wraps vehicle data and diagnostics in collapsed developer details, never open by default',()=>{
  const page=readFileSync(new URL('../inspect.js',import.meta.url),'utf8');
  assert.doesNotMatch(page,/<details[^>]*\bopen\b/,'no details starts open');
  assert.match(page,/<details class="sdk-details dev-info"><summary>차량 연동 상태 · 개발자 정보<\/summary>/);
  for(const raw of ['Capability','Availability','sessionPhase'])assert.equal(page.split(raw).length-1>0,true,raw+' is still available to developers');
  assert.doesNotMatch(page,/ESTIMATED_GEOMETRY/);assert.doesNotMatch(page,/육안 셀프 점검 · USER_REPORTED/);
  assert.match(readFileSync(new URL('../inspect.html',import.meta.url),'utf8'),/<div id="dev" hidden><\/div>/,'the Debug overlay stays');
});

// ---- one Back, one style per role ---------------------------------------------------------------------------------------
test('every Back control has the label 뒤로 and the BACK event; old labels are gone',()=>{
  assert.equal(BACK_LABEL,'뒤로');assert.equal(backButtonHtml(),'<button type="button" class="secondary" data-action="back">뒤로</button>');
  const sources=['../inspect.js','../inspection-product.mjs','../inspection-history-view.mjs'].map(f=>readFileSync(new URL(f,import.meta.url),'utf8')).join('\n');
  for(const old of ['점검 부위로','점검 항목으로','점검 목록과 이전 시점으로','선택 해제 · 이전 시점으로','뒤로 · 차량 전체 보기','전체 점검 요약으로','계속 점검하기','타이어 목록으로','점검 방법으로','기록 목록으로','이전 화면으로'])assert.ok(!sources.includes(old),old);
  for(const m of sources.matchAll(/data-action="back"[^>]*>([^<]*)</g))assert.ok(['뒤로','${BACK_LABEL}'].includes(m[1]),m[1]);
  const history=historyPanelHtml({name:S.HISTORY_DETAIL},{origin:'NATIVE',detail:{status:'LOADING'},filters:{}},null);
  assert.match(history,/data-action="back">뒤로</);
});

test('the phone check is the primary action, disabled with a reason when this device cannot reach it',()=>{
  const local=createTireInspection('local'),off=createNativeInspectionResults();off.startSession('local');
  const html=partActionHtml(local,off.snapshot,'brake-fluid-reservoir');
  assert.match(html,/<button type="button" class="primary" data-action="request-mobile" data-task="brake-fluid" disabled>스마트폰으로 점검하기<\/button>/);
  assert.match(html,/이 기기에서는 스마트폰 점검을 연결할 수 없습니다/);
  const a=testAuthority(),on=createNativeInspectionResults({adapter:a.adapter});on.startSession('local');
  assert.match(partActionHtml(local,on.snapshot,'brake-fluid-reservoir'),/class="primary" data-action="request-mobile" data-task="brake-fluid">/);
  assert.doesNotMatch(partActionHtml(local,on.snapshot,'brake-fluid-reservoir'),/연결할 수 없습니다/);
  off.dispose();on.dispose();
});

// ---- ending the session ------------------------------------------------------------------------------------------------
test('ending asks only when something would be lost, and says exactly what and that stored history stays',()=>{
  const fresh=createTireInspection('local');
  assert.equal(sessionDataScope(fresh,null).any,false,'nothing to lose: end at once');
  const draft=updateTireInspection(fresh,{type:'ANSWER',tireId:'tire.front-left',sessionId:'local',checkId:'damage',answer:'FOUND'});
  assert.deepEqual({...sessionDataScope(draft,null)},{answered:1,results:0,active:false,any:true},'an unconfirmed answer counts');
  const active={records:[],receiver:{taskId:'washer-fluid',phase:'CONNECTED'}};
  assert.equal(sessionDataScope(fresh,active).active,true);assert.equal(sessionDataScope(fresh,{records:[],receiver:{phase:'COMPLETED'}}).any,false);
  const html=exitConfirmHtml(sessionDataScope(draft,{records:[{},{}],receiver:{phase:'QR_READY'}}));
  assert.match(html,/직접 입력한 타이어 응답 \(타이어 1개\)/);assert.match(html,/이 화면에 표시된 스마트폰 결과 2건/);assert.match(html,/진행 중인 스마트폰 점검 연결/);
  assert.match(html,/저장된 과거 점검 기록은 지워지지 않습니다/);assert.match(html,/data-action="exit-cancel">계속 점검</);assert.match(html,/data-action="exit-confirm">점검 종료</);
  assert.doesNotMatch(exitConfirmHtml(sessionDataScope(draft,null)),/스마트폰/,'only what this session holds is listed');
  assert.match(EXIT_SCOPE_TEXT,/저장된 과거 점검 기록은 그대로 남습니다/);
});

test('the page routes every way out of the session through one confirmation',()=>{
  const page=readFileSync(new URL('../inspect.js',import.meta.url),'utf8');
  const dispatch=page.slice(page.indexOf('function dispatch(event)'),page.indexOf('// Hood and camera are target-driven tweens'));
  assert.match(dispatch,/\[EVENTS\.BACK, EVENTS\.EXIT\]\.includes\(event\.type\) && !event\.confirmed && leavesSession\(prev, next\)/);
  assert.match(dispatch,/if \(exitScope && event\.type === EVENTS\.BACK\) \{ closeExit\(\)/,'Back while asking cancels the question');
  assert.match(page,/dispatch\(\{ type: EVENTS\.EXIT, confirmed: true \}\)/);
  assert.equal((page.match(/confirmed: true/g)??[]).length,1,'only the dialog confirms');
});
