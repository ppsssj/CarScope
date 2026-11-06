// SYNTHETIC: the real adapter and consumer run in Node with a scripted fetch and real wall-clock delays.
// This proves what the code does for a given delay or reply. It does not show which delay or reply the Pleos
// WebView produced in the observed failure, and it says nothing about real WebView timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAndroidNativeInspectionAdapter} from '../android-native-inspection-adapter.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {createBridgeDiagnostics,SLOW_RPC_MS} from '../native-bridge-diagnostics.mjs';
import {createMobileRequestNotifier,MOBILE_REQUEST_TEXT as TEXT} from '../inspection-toast.mjs';

const SESSION='SECRET-LOCAL-SESSION-ID';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(predicate,ms=4000)=>{const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw Error('timeout');await sleep(5);}};
// Blocks the event loop, as a stalled renderer main thread would: no timer or promise can run meanwhile.
const stall=ms=>{const end=performance.now()+ms;while(performance.now()<end);};
// Never answers; only the adapter's own AbortSignal ends it, exactly as a real fetch would.
const hang=signal=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
const idle={bindings:[],accepted:[],terminal:[],unavailable:null};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

async function harness(reply,run,{longTasks=null,sink}={}){
  const original=Object.fromEntries(['location','self','top','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const commands=[],lines=[];
  try{
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};globalThis.self=globalThis.top=globalThis;
    globalThis.fetch=async(url,options)=>{
      const command=JSON.parse(new URL(url,location.origin).searchParams.get('command'));commands.push(command);
      const value=await reply(command,options.signal,commands);
      return value instanceof Response?value:json(value);
    };
    const diagnostics=createBridgeDiagnostics({sink:sink??(r=>lines.push(r)),longTasks,visibility:()=>'visible'});
    const consumer=createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter({diagnostics})});
    const ops=name=>commands.filter(c=>c.op===name);
    const events=name=>lines.filter(l=>l.event===name);
    try{await run({consumer,commands,lines,ops,events});}finally{consumer.dispose();await sleep(20);}
  }finally{
    for(const [key,descriptor]of Object.entries(original))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
const healthy=c=>c.op==='poll'?idle:{ok:true};
const unavailable=consumer=>until(()=>consumer.snapshot.connection==='UNAVAILABLE');

test('normal open and request stay connected and write no anomaly',async()=>{
  await harness(healthy,async({consumer,commands,ops,events})=>{
    assert.equal(consumer.startSession(SESSION),true);
    await until(()=>ops('poll').length>=2);
    assert.equal(await consumer.request('washer-fluid'),'ACCEPTED');
    await sleep(300);assert.equal(ops('request').length,1);
    assert.equal(commands[0].op,'open');
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');assert.equal(consumer.snapshot.notice,null);
    assert.equal(events('RPC_ANOMALY').length,0);assert.equal(events('CHANNEL_FAILED').length,0);
    assert.equal(events('SESSION_OPEN').length,1,'healthy polls are not logged');
  });
});

test('first open timeout closes the channel, sends no poll and retries nothing',async()=>{
  await harness((c,signal)=>c.op==='open'?hang(signal):healthy(c),async({consumer,ops,events})=>{
    const begin=performance.now();consumer.startSession(SESSION);await unavailable(consumer);
    const took=performance.now()-begin;assert.ok(took>=1900&&took<2800,`the 2000 ms limit is unchanged, took ${took}`);
    const [failed]=events('CHANNEL_FAILED');assert.equal(failed.op,'open');assert.equal(failed.code,'TIMEOUT');assert.equal(failed.sinceLastOkMs,null);
    await sleep(400);assert.equal(ops('poll').length,0);assert.equal(ops('open').length,1,'no automatic reopen');
  });
});

test('one poll timeout reproduces the observed state: closed, no polling, request refused without any RPC',async()=>{
  let polls=0;
  await harness((c,signal)=>c.op==='poll'&&++polls===3?hang(signal):healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await unavailable(consumer);
    const [failed]=events('CHANNEL_FAILED');assert.equal(failed.op,'poll');assert.equal(failed.code,'TIMEOUT');assert.equal(typeof failed.sinceLastOkMs,'number');assert.ok(failed.rpcCount>=3);
    await sleep(400);assert.equal(ops('poll').length,3,'polling stopped');
    assert.equal(await consumer.request('washer-fluid'),'CHANNEL_CLOSED');
    assert.equal(ops('request').length,0,'the request never left the page');
    assert.equal(consumer.snapshot.notice,'NATIVE_NOT_CONNECTED');
  });
});

test('main-thread stall across an empty poll closes the channel as LATE_RESPONSE and is attributed to the stall',async()=>{
  let polls=0;
  const longTasks={within:(from,to)=>[{start:from,duration:to-from}]};
  await harness(c=>{if(c.op==='poll'&&++polls===2)stall(2100);return c.op==='poll'?idle:{ok:true};},async({consumer,events})=>{
    consumer.startSession(SESSION);await unavailable(consumer);
    const [failed]=events('CHANNEL_FAILED');assert.equal(failed.code,'LATE_RESPONSE');assert.equal(failed.op,'poll');
    assert.ok(failed.longTask.maxMs>=2000,'the record separates a stall from a slow Native reply');
    assert.ok(failed.recent.some(r=>r.code==='LATE_RESPONSE'&&r.runMs>=2000));
  },{longTasks});
});

test('a slow poll under the limit stays connected and leaves a near-miss record',async()=>{
  let polls=0;
  await harness(async c=>{if(c.op==='poll'&&++polls===1)await sleep(SLOW_RPC_MS+200);return c.op==='poll'?idle:{ok:true};},async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=2);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
    const [slow]=events('RPC_ANOMALY');assert.equal(slow.code,'OK');assert.equal(slow.op,'poll');assert.ok(slow.runMs>=SLOW_RPC_MS);
    assert.equal(events('CHANNEL_FAILED').length,0);
  });
});

test('Promise queue wait does not count toward the RPC limit and is recorded separately',async()=>{
  let polls=0;
  await harness(async c=>{
    if(c.op==='poll'&&++polls===1)await sleep(1500);
    if(c.op==='request')await sleep(1200);
    return c.op==='poll'?idle:{ok:true};
  },async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length===1);await sleep(50);
    const queued=performance.now();assert.equal(await consumer.request('washer-fluid'),'ACCEPTED');
    await until(()=>events('RPC_ANOMALY').some(l=>l.op==='request'));
    assert.ok(performance.now()-queued>=2000,'queue wait plus run exceeded 2000 ms in total');
    const request=events('RPC_ANOMALY').find(l=>l.op==='request');
    assert.equal(request.code,'OK');assert.ok(request.queueWaitMs>=1000);assert.ok(request.runMs<2000);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');assert.equal(consumer.snapshot.notice,null);
  });
});

test('Native request REJECTED is a request failure: the channel stays open and nothing is re-sent',async()=>{
  await harness(c=>c.op==='request'?{error:'REJECTED'}:healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=1);
    assert.equal(await consumer.request('washer-fluid'),'REJECTED');assert.equal(consumer.snapshot.notice,'REQUEST_REJECTED');
    const polled=ops('poll').length;await sleep(600);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED','not the observed UNAVAILABLE state');
    assert.ok(ops('poll').length>polled,'polling continues');assert.equal(ops('request').length,1,'no automatic re-send');
    assert.equal(events('RPC_ANOMALY').find(l=>l.op==='request').code,'NATIVE_REJECTED');assert.equal(events('CHANNEL_FAILED').length,0);
  });
});

test('request timeout is a request failure and is not re-sent',async()=>{
  await harness((c,signal)=>c.op==='request'?hang(signal):healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=1);
    assert.equal(await consumer.request('washer-fluid'),'FAILED');assert.equal(consumer.snapshot.notice,'REQUEST_FAILED');await sleep(300);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');assert.equal(ops('request').length,1);
    assert.equal(events('RPC_ANOMALY').find(l=>l.op==='request').code,'TIMEOUT');
  });
});

// The script mirrors NativeInspectionBridge's pendingTask rule; NativeInspectionBridgeTest covers the real rule.
const pendingNative=()=>{let pending=null;return c=>{
  if(c.op!=='request')return healthy(c);
  if(pending===null||pending===c.taskId){pending=c.taskId;return {ok:true};}
  return {error:'REJECTED'};
};};
test('duplicate requests for one part: one is sent while waiting, the next reaches Native afterwards, and the channel stays open',async()=>{
  await harness(pendingNative(),async({consumer,ops})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=1);
    const first=consumer.request('washer-fluid');
    assert.equal(await consumer.request('washer-fluid'),'IN_FLIGHT');assert.equal(await first,'ACCEPTED');
    assert.equal(ops('request').length,1,'the click made while waiting sent nothing');
    assert.equal(await consumer.request('washer-fluid'),'ACCEPTED');assert.equal(ops('request').length,2);await sleep(50);
    assert.equal(consumer.snapshot.notice,null);assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
  });
});
test('simultaneous requests for different parts: the second is held back while waiting, and once sent only it is refused',async()=>{
  await harness(pendingNative(),async({consumer,ops})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=1);
    const first=consumer.request('washer-fluid');
    assert.equal(await consumer.request('brake-fluid'),'IN_FLIGHT');assert.equal(await first,'ACCEPTED');
    assert.equal(ops('request').length,1);
    assert.equal(await consumer.request('brake-fluid'),'REJECTED');assert.equal(consumer.snapshot.notice,'REQUEST_REJECTED');
    assert.deepEqual(ops('request').map(c=>c.taskId),['washer-fluid','brake-fluid']);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
  });
});

test('Activity pause and stop: inactive then cleared Native replies close the channel with distinct codes',async()=>{
  for(const [error,code]of [['UNAVAILABLE','NATIVE_UNAVAILABLE'],['REJECTED','NATIVE_REJECTED']]){
    let polls=0;
    await harness(c=>c.op==='poll'&&++polls===2?{error}:healthy(c),async({consumer,ops,events})=>{
      consumer.startSession(SESSION);await unavailable(consumer);
      assert.equal(events('CHANNEL_FAILED')[0].code,code);
      await sleep(350);assert.equal(ops('poll').length,2);assert.equal(ops('open').length,1,'resume never reopens on its own');
    });
  }
});

test('a response that arrives after the session ended cannot deliver or close anything',async()=>{
  let release;const held=new Promise(r=>{release=r;});let polls=0;let callbacks=0;
  await harness(async c=>{
    if(c.op==='poll'&&++polls===1){await held;return {bindings:[{bindingId:'late'}],accepted:[],terminal:[],unavailable:'SERVER_CLOCK_UNAVAILABLE'};}
    return c.op==='poll'?idle:{ok:true};
  },async({consumer,ops,events})=>{
    consumer.subscribe(()=>callbacks++);
    consumer.startSession(SESSION);await until(()=>ops('poll').length===1);
    consumer.endSession();const seen=callbacks;release();await sleep(100);
    assert.equal(consumer.snapshot.connection,'INCOMPLETE_NATIVE');assert.equal(callbacks,seen);assert.equal(events('CHANNEL_FAILED').length,0);
  });
});

test('a late failure of the old generation cannot close the new session',async()=>{
  let release;const held=new Promise(r=>{release=r;});let polls=0;
  await harness(async c=>{
    if(c.op==='poll'&&++polls===1){await held;return {error:'REJECTED'};}
    return c.op==='poll'?idle:{ok:true};
  },async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length===1);
    consumer.startSession('second-session');release();
    await until(()=>ops('poll').some(c=>c.localSessionId==='second-session'));
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');assert.equal(events('CHANNEL_FAILED').length,0);
  });
});

test('generation change: requests after a restart carry only the new session and generation',async()=>{
  await harness(healthy,async({consumer,ops})=>{
    consumer.startSession(SESSION);const first=consumer.snapshot.generation;
    await until(()=>ops('poll').length>=1);
    consumer.startSession('second-session');assert.ok(consumer.snapshot.generation>first);
    await until(()=>ops('poll').some(c=>c.generation===consumer.snapshot.generation));
    assert.equal(await consumer.request('washer-fluid'),'ACCEPTED');assert.equal(ops('request').length,1);
    assert.equal(ops('request')[0].generation,consumer.snapshot.generation);assert.equal(ops('request')[0].localSessionId,'second-session');
  });
});

test('a request from an old generation is refused by the adapter before any RPC',async()=>{
  const original=Object.fromEntries(['location','self','top','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const commands=[];
  try{
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};globalThis.self=globalThis.top=globalThis;
    globalThis.fetch=async url=>{commands.push(JSON.parse(new URL(url,location.origin).searchParams.get('command')));return json(idle);};
    const adapter=createAndroidNativeInspectionAdapter({diagnostics:createBridgeDiagnostics({sink:()=>{},longTasks:null})});
    const callbacks={onBinding(){},onAccepted(){},onTerminal(){},onUnavailable(){}};
    const stop=adapter.open({localSessionId:'local',generation:2,...callbacks});
    assert.throws(()=>adapter.requestTask({localSessionId:'local',generation:1,taskId:'washer-fluid',partId:'washer-fluid-cap'}),/Old session/);
    assert.throws(()=>adapter.requestTask({localSessionId:'other',generation:2,taskId:'washer-fluid',partId:'washer-fluid-cap'}),/Old session/);
    stop();await sleep(20);
    assert.ok(commands.every(c=>c.op!=='request'));
  }finally{
    for(const [key,descriptor]of Object.entries(original))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('after UNAVAILABLE only a new session reconnects, with a higher generation and a recorded previous close',async()=>{
  let failing=true;
  await harness((c,signal)=>c.op==='poll'&&failing?hang(signal):healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await unavailable(consumer);
    const failedGeneration=ops('open')[0].generation;
    failing=false;await sleep(400);
    assert.equal(consumer.snapshot.connection,'UNAVAILABLE','Native recovering does not reopen the channel');
    assert.equal(ops('open').length,1);
    consumer.endSession();consumer.startSession('second-session');
    await until(()=>ops('poll').some(c=>c.localSessionId==='second-session'));
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
    assert.ok(ops('open')[1].generation>failedGeneration);assert.equal(await consumer.request('washer-fluid'),'ACCEPTED');
    assert.equal(consumer.snapshot.records.length,0,'no result survives the restart');
    failing=true;await unavailable(consumer);
    assert.equal(events('CHANNEL_FAILED').at(-1).previousClose,'OK');
  });
});

const clickOn=consumer=>{const shown=[];return {shown,click:createMobileRequestNotifier({request:id=>consumer.request(id),show:text=>shown.push(text),screen:()=>'part'})};};
test('failure guidance tells the user to reopen the screen; other refusals keep their own text',async()=>{
  await harness((c,signal)=>c.op==='poll'?hang(signal):healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await unavailable(consumer);
    const {shown,click}=clickOn(consumer);
    assert.equal(await click('washer-fluid'),'CHANNEL_CLOSED');
    assert.match(shown.at(-1),/연결이 종료되었습니다/);assert.match(shown.at(-1),/닫고 새로 열어 주세요/);
    assert.equal(ops('request').length,0);assert.equal(events('CHANNEL_FAILED')[0].code,'TIMEOUT','the diagnostic record is kept beside the guidance');
  });
  const never=createNativeInspectionResults();never.startSession(SESSION);
  const disposed=createNativeInspectionResults();disposed.dispose();
  for(const consumer of [never,disposed]){
    const {shown,click}=clickOn(consumer);
    assert.equal(await click('washer-fluid'),'NOT_CONNECTED');assert.match(shown.at(-1),/시작할 수 없습니다/);
  }
  assert.match(TEXT.ACCEPTED,/준비/);
});

// Both PRs meet here: the toast follows the confirmed answer, and the anomaly record keeps the code the adapter saw.
for(const [name,reply,outcome,text,code]of [
  ['refusal',{error:'REJECTED'},'REJECTED',TEXT.REJECTED,'NATIVE_REJECTED'],
  ['inactive bridge',{error:'UNAVAILABLE'},'FAILED',TEXT.FAILED,'NATIVE_UNAVAILABLE'],
])test(`${name}: the toast and the diagnostic code each report it, and the channel stays open`,async()=>{
  await harness(c=>c.op==='request'?reply:healthy(c),async({consumer,ops,events})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=1);
    const {shown,click}=clickOn(consumer);
    assert.equal(await click('washer-fluid'),outcome);
    assert.deepEqual(shown,[TEXT.SENDING,text]);
    assert.equal(events('RPC_ANOMALY').find(l=>l.op==='request').code,code);
    assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');assert.equal(events('CHANNEL_FAILED').length,0);
  });
});

test('diagnostic records hold no identifier, digest, proof, result or raw error text',async()=>{
  const secrets=[SESSION,'SECRET-BINDING','SECRET-SYNC','SECRET-DIGEST','SECRET-PROOF','SECRET-RESULT','SECRET-INSPECTION','SECRET-URL'];
  const replies=[
    c=>{throw Error(`failed https://carscope-inspection.invalid/native-inspection-v1?command=${c.localSessionId}&SECRET-URL`);},
    ()=>({error:'SECRET-RESULT'}),
    ()=>new Response('SECRET-PROOF not json',{headers:{'Content-Type':'application/json'}}),
    ()=>new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}),
    ()=>new Response('SECRET-RESULT',{headers:{'Content-Type':'text/plain'}}),
    ()=>({...idle,unavailable:'SECRET-DIGEST'}),
    ()=>({...idle,bindings:[{bindingId:'SECRET-BINDING',syncSessionId:'SECRET-SYNC'}],accepted:[{bindingId:'SECRET-BINDING',inspectionId:'SECRET-INSPECTION',resultDigest:'SECRET-DIGEST',result:{secret:'SECRET-RESULT'}}]}),
  ];
  const expected=['FETCH_FAILED','NATIVE_ERROR','BAD_JSON','HTTP_503','BAD_CONTENT_TYPE','NATIVE_NOTICE',null];
  for(const [i,reply]of replies.entries()){
    await harness(c=>c.op==='poll'?reply(c):{ok:true},async({consumer,lines,events})=>{
      consumer.startSession(SESSION);
      if(expected[i])await unavailable(consumer);else await until(()=>consumer.snapshot.notice!==null||consumer.snapshot.connection==='UNAVAILABLE');
      await sleep(10);
      if(expected[i])assert.equal(events('CHANNEL_FAILED')[0].code,expected[i]);
      if(expected[i]==='NATIVE_NOTICE')assert.equal(events('CHANNEL_FAILED')[0].notice,'OTHER');
      const text=JSON.stringify(lines);
      for(const secret of secrets)assert.ok(!text.includes(secret),`${secret} leaked in reply ${i}`);
      assert.ok(!/localSessionId|bindingId|digest|proof|https?:/i.test(text),`field or URL in reply ${i}`);
    });
  }
});

test('a failing diagnostic sink or long-task source cannot change the bridge outcome',async()=>{
  const longTasks={within:()=>{throw Error('broken');}};
  await harness((c,signal)=>c.op==='poll'?hang(signal):healthy(c),async({consumer})=>{
    consumer.startSession(SESSION);await unavailable(consumer);
    assert.equal(consumer.snapshot.connection,'UNAVAILABLE');
  },{longTasks,sink:()=>{throw Error('broken sink');}});
  await harness(healthy,async({consumer,ops})=>{
    consumer.startSession(SESSION);await until(()=>ops('poll').length>=2);assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
  },{sink:()=>{throw Error('broken sink');}});
});

test('unknown operations and codes are replaced before they reach the sink',()=>{
  const lines=[];const d=createBridgeDiagnostics({sink:r=>lines.push(r),longTasks:null,now:()=>100,visibility:()=>'hidden'});
  d.sessionOpened();d.rpc('secret-op',{queuedAt:0,started:1,ended:2,code:'secret-code'});d.failed('secret-op','secret-code',{notice:'secret-notice'});
  const anomaly=lines.find(l=>l.event==='RPC_ANOMALY');assert.equal(anomaly.op,'other');assert.equal(anomaly.code,'OTHER');
  const failed=lines.find(l=>l.event==='CHANNEL_FAILED');assert.equal(failed.op,'other');assert.equal(failed.code,'OTHER');assert.equal(failed.notice,'OTHER');assert.equal(failed.visibility,'hidden');assert.equal(failed.longTask,null);
  assert.ok(!JSON.stringify(lines).includes('secret'));
});

test('the ring buffer keeps only the most recent RPCs so the failure line stays short',()=>{
  const lines=[];const d=createBridgeDiagnostics({sink:r=>lines.push(r),longTasks:null,now:()=>0,capacity:4});
  d.sessionOpened();for(let i=0;i<50;i++)d.rpc('poll',{queuedAt:0,started:0,ended:1,code:'OK'});
  d.failed('poll','TIMEOUT');const failed=lines.at(-1);assert.equal(failed.recent.length,4);assert.equal(failed.rpcCount,50);
  assert.ok(JSON.stringify(failed).length<1000);
});
