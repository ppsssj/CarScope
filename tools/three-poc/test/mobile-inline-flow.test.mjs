// The part panel's mobile flow: status from Native, no QR material in the page, newest verified result shown.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTireInspection} from '../tire-inspection.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {partResultHtml} from '../inspection-results-view.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {testAuthority,wireResult} from './result-fixtures.mjs';
import {digestResult} from '../mobile-result-contract.mjs';

const WASHER=MOBILE_TARGETS[0];
const local=createTireInspection('local');
function setup(){const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter});c.startSession('local');return {a,c};}
const status=(phase,extra={})=>({taskId:WASHER.taskId,phase,retryAvailable:false,canCancel:false,...extra});
const html=(c)=>partResultHtml(local,c.snapshot,WASHER.partId);

test('the empty QR slot appears only when Native says a QR is showing, and the request button only when nothing is active',()=>{
  const {a,c}=setup();
  assert.match(html(c),/data-action="request-mobile"/);assert.doesNotMatch(html(c),/mobileQrSlot/);
  for(const phase of ['AUTH_WAITING','AUTH_FAILED','CREATING','CONNECTED','RESULT_RECEIVED','QR_EXPIRED']){
    a.callbacks.onReceiver(status(phase));
    assert.doesNotMatch(html(c),/data-action="request-mobile"/,phase);assert.doesNotMatch(html(c),/mobileQrSlot/,phase);
  }
  a.callbacks.onReceiver(status('QR_READY',{canCancel:true,inviteExpiresAt:1000}));
  assert.match(html(c),/id="mobileQrSlot"/);assert.match(html(c),/data-action="mobile-cancel"/);
  for(const phase of ['COMPLETED','CANCELLED','EXPIRED','FAILED','CLOSED']){a.callbacks.onReceiver(status(phase));assert.match(html(c),/data-action="request-mobile"/,phase);}
  c.dispose();
});

test('a failure keeps its guidance and its retry',()=>{
  const {a,c}=setup();
  a.callbacks.onReceiver(status('CONNECTED',{failure:'NETWORK',retryAvailable:true}));
  assert.match(html(c),/네트워크/);assert.match(html(c),/data-action="mobile-refresh"/);
  c.dispose();
});

test('a part must not start while another part is active, and that request stays cancellable',()=>{
  const {a,c}=setup();a.callbacks.onReceiver({...status('QR_READY',{canCancel:true}),taskId:MOBILE_TARGETS[1].taskId});
  assert.doesNotMatch(html(c),/data-action="request-mobile"/);assert.doesNotMatch(html(c),/mobileQrSlot/);assert.match(html(c),/다른 부품/);assert.match(html(c),/data-action="mobile-cancel"/);
  c.dispose();
});

test('a status with an unknown field is dropped whole, so a QR or token cannot arrive this way',()=>{
  const {a,c}=setup();
  for(const bad of [{...status('QR_READY'),invite:'secret'},{...status('QR_READY'),qr:'data:image/png'},{...status('QR_READY'),failure:'<img>'},{...status('NOPE')},{...status('QR_READY'),taskId:'unknown'}]){
    a.callbacks.onReceiver(bad);assert.equal(c.snapshot.receiver,null);assert.doesNotMatch(JSON.stringify(c.snapshot),/secret|data:image/);
  }
  c.dispose();
});

test('the management controls are out of the default flow, inside the Debug area',()=>{
  const {c}=setup();const page=html(c);
  assert.ok(page.indexOf('class="debug-admin"')<page.indexOf('data-action="mobile-admin"'));
  assert.doesNotMatch(page,/이 결과 수락|서비스 연결 확인<\/button>|점검 요청 생성/);assert.doesNotMatch(page,/표시할 기록을 직접 선택/);
  c.dispose();
});

test('a received result is shown in the panel, and an automatic one never reads as the owner\'s approval',async()=>{
  const {a,c}=setup(),session=c.snapshot.localSessionId,generation=c.snapshot.generation,result=wireResult(WASHER.taskId,'FOUND');
  const binding={bindingId:'b',localSessionId:session,generation,syncSessionId:'s',taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt:1e12};
  a.callbacks.onBinding(binding);a.patch({confirmation:'AVD_SIMULATION_AUTO'});
  const delivery={bindingId:'b',localSessionId:session,generation,syncSessionId:'s',taskId:WASHER.taskId,inspectionId:result.inspectionId,resultDigest:await digestResult(result),result};
  assert.equal(await a.callbacks.onAccepted(delivery),'STAGED');
  assert.match(html(c),/보충 필요로 보고/);assert.match(html(c),/차량 소유자 승인 아님/);assert.doesNotMatch(html(c),/사용자 선택/);
  c.dispose();
});

test('an unknown confirmation is refused, so a proof cannot name a stronger approval',async()=>{
  const {a,c}=setup(),session=c.snapshot.localSessionId,generation=c.snapshot.generation,result=wireResult(WASHER.taskId,'FOUND');
  a.callbacks.onBinding({bindingId:'b',localSessionId:session,generation,syncSessionId:'s',taskId:WASHER.taskId,partId:WASHER.partId,serverNow:1000,expiresAt:1e12});
  a.patch({confirmation:'OWNER_APPROVED'});
  const delivery={bindingId:'b',localSessionId:session,generation,syncSessionId:'s',taskId:WASHER.taskId,inspectionId:result.inspectionId,resultDigest:await digestResult(result),result};
  assert.equal(await a.callbacks.onAccepted(delivery),'INVALID_ACCEPTED_PROOF');assert.equal(c.snapshot.records.length,0);
  c.dispose();
});
