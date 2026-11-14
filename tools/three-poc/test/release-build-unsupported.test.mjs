// Release submission: the Release InspectionActivity answers a phone request with the fixed BUILD_UNSUPPORTED status
// (app/src/release/java/io/carscope/app/lab/InspectionActivity.kt). The page must say so plainly, never wait, lock the
// other parts, show a QR slot, or offer retry/cancel that the build cannot honour.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTireInspection} from '../tire-inspection.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {partActionHtml} from '../inspection-results-view.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {receiverLocked} from '../part-labels.mjs';
import {testAuthority} from './result-fixtures.mjs';

const WASHER=MOBILE_TARGETS[0];
// Exactly the keys and values Release InspectionActivity.unsupported(taskId) sends.
const RELEASE_STATUS={taskId:WASHER.taskId,phase:'BUILD_UNSUPPORTED',failure:null,retryAvailable:false,canCancel:false,inviteExpiresAt:null};

function setup(){const a=testAuthority(),c=createNativeInspectionResults({adapter:a.adapter,now:()=>0});c.startSession('local');return {a,c};}

test('the Release status is accepted and shown as an unsupported build, not as a missing operator setup',()=>{
  const {a,c}=setup();
  a.callbacks.onReceiver(RELEASE_STATUS);
  assert.equal(c.snapshot.receiver.phase,'BUILD_UNSUPPORTED');
  const html=partActionHtml(createTireInspection('local'),c.snapshot,WASHER.partId);
  const text=html.match(/<p role="status">([^<]*)<\/p>/)?.[1]??'';
  assert.match(text,/Release/);
  assert.match(text,/스마트폰 점검 연동이 들어 있지 않습니다/);
  assert.doesNotMatch(text,/운영자 설정이 필요합니다/);
  assert.doesNotMatch(html,/mobileQrSlot/,'no QR slot is reserved');
  assert.doesNotMatch(html,/data-action="mobile-refresh"|data-action="mobile-cancel"/,'no retry or cancel');
});

test('an unsupported build never locks the other part labels',()=>{
  assert.equal(receiverLocked({phase:'BUILD_UNSUPPORTED'}),false);
});

test('the Kotlin Release status keys match the page contract exactly',()=>{
  const source=readFileSync(new URL('../../../app/src/release/java/io/carscope/app/lab/InspectionActivity.kt',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('fun unsupported('));
  const keys=[...body.slice(0,body.indexOf('\n    }')).matchAll(/"(\w+)" to/g)].map(m=>m[1]);
  assert.deepEqual(keys.sort(),Object.keys(RELEASE_STATUS).sort());
  assert.match(body,/"phase" to "BUILD_UNSUPPORTED"/);
  assert.match(body,/"retryAvailable" to false/);
  assert.match(body,/"canCancel" to false/);
});

test('a Release request answer says the build has no phone sync, never that a QR is coming',async()=>{
  const {createMobileRequestNotifier,MOBILE_REQUEST_TEXT}=await import('../inspection-toast.mjs');
  const {a,c}=setup();
  a.reply(()=>({ok:true,buildUnsupported:true}));
  const shown=[];
  const click=createMobileRequestNotifier({request:t=>c.request(t),show:m=>shown.push(m),screen:()=>'part'});
  assert.equal(await click(WASHER.taskId),'BUILD_UNSUPPORTED');
  assert.deepEqual(shown,[MOBILE_REQUEST_TEXT.SENDING,MOBILE_REQUEST_TEXT.BUILD_UNSUPPORTED]);
  assert.doesNotMatch(shown.join(' '),/QR이 표시되면/);
  // Debug keeps its plain ok answer and its existing wording.
  a.reply(()=>({ok:true}));
  assert.equal(await c.request(WASHER.taskId),'ACCEPTED');
});

test('the Kotlin bridge adds buildUnsupported only when the Release screen asks for it',()=>{
  const bridge=readFileSync(new URL('../../../app/src/inspection/java/io/carscope/app/sync/NativeInspectionBridge.kt',import.meta.url),'utf8');
  assert.match(bridge,/private val buildUnsupported: Boolean = false/);
  assert.match(bridge,/if \(buildUnsupported\) mapOf\("ok" to true, "buildUnsupported" to true\) else mapOf\("ok" to true\)/);
  const release=readFileSync(new URL('../../../app/src/release/java/io/carscope/app/lab/InspectionActivity.kt',import.meta.url),'utf8');
  assert.match(release,/buildUnsupported = true/);
  const debug=readFileSync(new URL('../../../app/src/debug/java/io/carscope/app/lab/InspectionActivity.kt',import.meta.url),'utf8');
  assert.doesNotMatch(debug,/buildUnsupported/);
});
