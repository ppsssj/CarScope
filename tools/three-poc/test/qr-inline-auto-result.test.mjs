// PR #120: the inline QR slot report (one coordinate system, hidden whenever it is not fully visible) and the driver's
// wording for a phone result, which reads as applied only after this page staged the verified result.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTireInspection} from '../tire-inspection.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {partActionHtml,resultSummaryHtml,qrSlotReport,QR_SLOT_NONE} from '../inspection-results-view.mjs';
import {MOBILE_TARGETS,digestResult} from '../mobile-result-contract.mjs';
import {projectInspectionResults} from '../inspection-results.mjs';
import {receiverLocked} from '../part-labels.mjs';
import {testAuthority,wireResult} from './result-fixtures.mjs';

const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
// The recorded AVD page: CSS viewport 1224×880, the part panel on the right.
const VIEW={width:1224,height:880};
const PANEL=rect(822,72,384,762);

test('a fully visible slot is reported in CSS px with its viewport, so Native can convert once',()=>{
  assert.deepEqual({...qrSlotReport(rect(864.4,300.2,300,300),PANEL,VIEW)},{slot:'SHOWN',x:864,y:300,size:300,vw:1224,vh:880});
  assert.equal(qrSlotReport(null,PANEL,VIEW),QR_SLOT_NONE);
  assert.deepEqual({...QR_SLOT_NONE},{slot:'NONE',x:0,y:0,size:0,vw:0,vh:0});
});

test('a slot scrolled partly out of the panel, or out of the viewport, is HIDDEN and carries no position',()=>{
  const hidden={slot:'HIDDEN',x:0,y:0,size:0,vw:0,vh:0};
  for(const [name,slot,panel,view] of [
    ['above the panel top',rect(864,40,300,300),PANEL,VIEW],
    ['below the panel bottom',rect(864,600,300,300),PANEL,VIEW],
    ['left of the panel',rect(700,300,300,300),PANEL,VIEW],
    ['past the viewport while the panel overflows it',rect(864,700,300,300),rect(822,72,384,1000),VIEW],
    ['not laid out',rect(864,300,0,0),PANEL,VIEW],
    ['not square',rect(864,300,300,200),PANEL,VIEW],
  ])assert.deepEqual({...qrSlotReport(slot,panel,view)},hidden,name);
});

test('a sliding panel, a pinch zoom or an unknown viewport is HIDDEN, never a stale place',()=>{
  const slot=rect(864,300,300,300);
  assert.equal(qrSlotReport(slot,PANEL,{...VIEW,moving:true}).slot,'HIDDEN');
  assert.equal(qrSlotReport(slot,PANEL,{...VIEW,scale:1.5}).slot,'HIDDEN');
  assert.equal(qrSlotReport(slot,PANEL,{width:0,height:880}).slot,'HIDDEN');
  assert.equal(qrSlotReport(slot,null,VIEW).slot,'HIDDEN');
});

test('scrolling and resizing give a new report that follows the slot',()=>{
  const a=qrSlotReport(rect(864,300,300,300),PANEL,VIEW),b=qrSlotReport(rect(864,180,300,300),PANEL,VIEW);
  assert.equal(a.x,b.x);assert.equal(b.y,180);assert.notEqual(JSON.stringify(a),JSON.stringify(b));
  const small=qrSlotReport(rect(500,200,300,300),rect(10,100,1000,555),{width:1224,height:655});
  assert.deepEqual([small.slot,small.vh],['SHOWN',655]);
});

test('the report holds only geometry: no QR, invite or token can travel in it',()=>{
  const r=qrSlotReport(rect(864,300,300,300),PANEL,VIEW);
  assert.deepEqual(Object.keys(r).sort(),['size','slot','vh','vw','x','y']);
  assert.ok(Object.values(r).every(v=>typeof v==='number'||['SHOWN','HIDDEN','NONE'].includes(v)));
});

// ---- the driver's wording for a phone result ----
const WASHER=MOBILE_TARGETS[0];
const local=createTireInspection('local');
function setup(){let t=0;const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter,now:()=>t});c.startSession('local');return {a,c,advance:ms=>{t+=ms;}};}
const status=(phase,extra={})=>({taskId:WASHER.taskId,phase,retryAvailable:false,canCancel:false,...extra});
const action=c=>partActionHtml(local,c.snapshot,WASHER.partId);
const statusText=c=>action(c).match(/<p role="status">([^<]*)<\/p>/)?.[1]??'';
async function bindAndDeliver(a,c,{confirmation='AVD_SIMULATION_AUTO',tamper=false,syncSessionId='s1',bindingId='b1',expiresAt=600000}={}){
  const session=c.snapshot.localSessionId,generation=c.snapshot.generation,result=wireResult(WASHER.taskId,'FOUND');
  a.callbacks.onBinding({bindingId,localSessionId:session,generation,syncSessionId,taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt});
  a.patch({confirmation});
  const digest=await digestResult(result);
  return a.callbacks.onAccepted({bindingId,localSessionId:session,generation,syncSessionId,taskId:WASHER.taskId,inspectionId:result.inspectionId,resultDigest:tamper?'sha256:'+'0'.repeat(64):digest,result});
}

test('the phone check reads in four plain steps on the AVD path, and success only after the result is staged',async()=>{
  const {a,c}=setup();
  a.callbacks.onReceiver(status('CONNECTED'));assert.equal(statusText(c),'스마트폰 점검 진행 중');
  a.callbacks.onReceiver(status('RESULT_RECEIVED'));assert.equal(statusText(c),'결과 수신 중');
  assert.doesNotMatch(action(c),/반영되었습니다/);
  a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(c),'결과를 반영하지 못했습니다 · 다시 확인','no binding: Native never bound this session, so it cannot have applied');
  c.dispose();

  const s=setup();
  s.a.callbacks.onBinding({bindingId:'b1',localSessionId:s.c.snapshot.localSessionId,generation:s.c.snapshot.generation,syncSessionId:'s1',taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt:600000});
  s.a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(s.c),'결과 수신 중','the server accepted; this page has not staged it yet');
  s.c.dispose();

  const d=setup();
  assert.equal(await bindAndDeliver(d.a,d.c),'STAGED');d.a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(d.c),'점검 결과가 반영되었습니다');
  assert.doesNotMatch(action(d.c).split('<details class="dev-info')[0],/수락|<button[^>]*data-action="(?!request-mobile)/,'the driver sees no Accept or other vehicle button');
  d.c.dispose();
});

test('an automatic result counts once in the 17-part summary and is never worded as the owner\'s approval',async()=>{
  const {a,c}=setup();
  assert.equal(await bindAndDeliver(a,c),'STAGED');a.callbacks.onReceiver(status('COMPLETED'));
  const rows=projectInspectionResults(local,c.snapshot);
  assert.equal(rows.length,17);assert.equal(rows.filter(r=>r.status!=='NOT_INSPECTED').length,1);
  assert.equal(rows.find(r=>r.partId===WASHER.partId).proof.confirmation,'AVD_SIMULATION_AUTO');
  assert.match(resultSummaryHtml(local,c.snapshot),/점검 완료 1<small>\/17<\/small>/);
  assert.doesNotMatch(action(c)+resultSummaryHtml(local,c.snapshot),/소유자 승인(?! 아님)|소유자가 승인/);
  // The same delivery again (a repeated poll) is a duplicate and the count stays at one.
  const session=c.snapshot.localSessionId,generation=c.snapshot.generation,result=wireResult(WASHER.taskId,'FOUND');
  assert.equal(await a.callbacks.onAccepted({bindingId:'b1',localSessionId:session,generation,syncSessionId:'s1',taskId:WASHER.taskId,inspectionId:result.inspectionId,resultDigest:await digestResult(result),result}),'DUPLICATE');
  assert.equal(c.snapshot.records.length,1);assert.match(resultSummaryHtml(local,c.snapshot),/점검 완료 1<small>\/17<\/small>/);
  c.dispose();
});

test('a refused, expired or disconnected delivery reads as not applied and counts nothing',async()=>{
  const m=setup();assert.equal(await bindAndDeliver(m.a,m.c,{tamper:true}),'DIGEST_MISMATCH');m.a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(m.c),'결과를 반영하지 못했습니다 · 다시 확인');assert.equal(m.c.snapshot.records.length,0);
  assert.match(resultSummaryHtml(local,m.c.snapshot),/점검 완료 0<small>\/17<\/small>/);m.c.dispose();

  const p=setup();assert.equal(await bindAndDeliver(p.a,p.c,{confirmation:'OWNER_APPROVED'}),'INVALID_ACCEPTED_PROOF');p.a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(p.c),'결과를 반영하지 못했습니다 · 다시 확인');p.c.dispose();

  const e=setup();
  e.a.callbacks.onBinding({bindingId:'b1',localSessionId:e.c.snapshot.localSessionId,generation:e.c.snapshot.generation,syncSessionId:'s1',taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt:2000});
  e.advance(5000);e.c.tick();e.a.callbacks.onReceiver(status('COMPLETED'));
  assert.equal(statusText(e.c),'결과를 반영하지 못했습니다 · 다시 확인','the session time ran out before the result arrived');e.c.dispose();

  const u=setup();
  u.a.callbacks.onBinding({bindingId:'b1',localSessionId:u.c.snapshot.localSessionId,generation:u.c.snapshot.generation,syncSessionId:'s1',taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt:600000});
  u.a.callbacks.onReceiver(status('COMPLETED'));u.a.callbacks.onUnavailable('SERVER_CLOCK_UNAVAILABLE');
  assert.equal(statusText(u.c),'결과를 반영하지 못했습니다 · 다시 확인');u.c.dispose();
});

test('when automatic confirmation ran out the driver gets the retry, not a silent wait',()=>{
  const {a,c}=setup();
  a.callbacks.onReceiver(status('RESULT_RECEIVED',{retryAvailable:true}));
  assert.equal(statusText(c),'결과를 반영하지 못했습니다 · 다시 확인');
  assert.match(action(c),/data-action="mobile-refresh"/);
  a.callbacks.onReceiver(status('RESULT_RECEIVED',{retryAvailable:true,failure:'UNAUTHORIZED'}));
  assert.match(action(c),/결과를 반영하지 못했습니다 · 다시 확인 권한이 거부되었습니다/);
  c.dispose();
});

test('the explicit path says the vehicle panel must accept, and never that it was applied',()=>{
  const {a,c}=setup();
  a.callbacks.onReceiver(status('AWAITING_CONFIRMATION',{canCancel:true}));
  assert.equal(c.snapshot.receiver.phase,'AWAITING_CONFIRMATION');
  assert.match(statusText(c),/수락해야 반영됩니다/);assert.doesNotMatch(action(c),/반영되었습니다|data-action="request-mobile"/);
  assert.match(action(c),/data-action="mobile-cancel"/);
  assert.equal(receiverLocked({phase:'AWAITING_CONFIRMATION'}),true,'a part waiting for Accept keeps the other part labels locked');
  c.dispose();
});
