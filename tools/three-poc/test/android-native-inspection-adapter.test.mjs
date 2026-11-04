import test from 'node:test';
import assert from 'node:assert/strict';
import {createAndroidNativeInspectionAdapter} from '../android-native-inspection-adapter.mjs';

test('fixed Android adapter refuses desktop remote origins other pages and subframes',()=>{
  const originals=Object.fromEntries(['location','self','top'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  try{
    globalThis.self=globalThis.top=globalThis;
    for(const origin of ['http://carscope-inspection.invalid','https://evil.invalid','https://carscope-inspection.invalid:444']){
      globalThis.location={origin,pathname:'/index.html'};assert.equal(createAndroidNativeInspectionAdapter(),null);
    }
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/other.html'};
    assert.equal(createAndroidNativeInspectionAdapter(),null);
    location.pathname='/index.html';globalThis.top={};assert.equal(createAndroidNativeInspectionAdapter(),null);
  }finally{
    for(const [key,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('detached pending open response cannot poll deliver or revive old session',async()=>{
  const original=Object.fromEntries(['location','self','top','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let resolveOpen;const commands=[];let callbacks=0;
  try{
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};globalThis.self=globalThis.top=globalThis;
    globalThis.fetch=async url=>{
      const command=JSON.parse(new URL(url,location.origin).searchParams.get('command'));commands.push(command);
      if(command.op==='open')await new Promise(resolve=>{resolveOpen=resolve;});
      return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    };
    const adapter=createAndroidNativeInspectionAdapter();
    const stop=adapter.open({localSessionId:'local',generation:1,onBinding:()=>callbacks++,onAccepted:()=>callbacks++,onTerminal:()=>callbacks++,onUnavailable:()=>callbacks++});
    await new Promise(resolve=>setImmediate(resolve));stop();resolveOpen();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.deepEqual(commands.map(c=>c.op),['open','close']);assert.equal(callbacks,0);
    assert.throws(()=>adapter.requestTask({localSessionId:'local',generation:1,taskId:'washer-fluid',partId:'washer-fluid-cap'}));
    assert.ok(commands.every(c=>!('result' in c)&&!('proof' in c)));
  }finally{
    for(const [key,descriptor]of Object.entries(original))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

// Scripted Native replies exercise the fixed adapter + real C1 consumer. The script is not an authority:
// it can only answer RPCs the adapter sends, and verify replies decide whether a proof exists.
async function withScriptedNative(reply,run){
  const original=Object.fromEntries(['location','self','top','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const commands=[];
  try{
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};globalThis.self=globalThis.top=globalThis;
    globalThis.fetch=async url=>{const command=JSON.parse(new URL(url,location.origin).searchParams.get('command'));commands.push(command);
      return new Response(JSON.stringify(await reply(command)),{headers:{'Content-Type':'application/json'}});};
    const {createNativeInspectionResults}=await import('../native-inspection-results.mjs');
    const consumer=createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()});
    try{await run(consumer,commands);}finally{consumer.dispose();await new Promise(r=>setTimeout(r,20));}
  }finally{
    for(const [key,descriptor]of Object.entries(original))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
const until=async(predicate,ms=2000)=>{const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}};

test('Native server-clock block reaches 3D as UNAVAILABLE, stops polling and never reflects unknown reasons',async()=>{
  for(const [reason,expected]of [['SERVER_CLOCK_UNAVAILABLE','SERVER_CLOCK_UNAVAILABLE'],['BINDING_DELIVERY_TIMEOUT','BINDING_DELIVERY_TIMEOUT'],['<img src=x>',null]]){
    await withScriptedNative(c=>c.op==='poll'?{bindings:[],accepted:[],terminal:[],unavailable:reason}:{ok:true},async(consumer,commands)=>{
      consumer.startSession('local');
      await until(()=>consumer.snapshot.connection==='UNAVAILABLE');
      assert.equal(consumer.snapshot.notice,expected);assert.equal(consumer.snapshot.records.length,0);
      const polls=commands.filter(c=>c.op==='poll').length;await new Promise(r=>setTimeout(r,400));
      assert.equal(commands.filter(c=>c.op==='poll').length,polls,'no further polling after UNAVAILABLE');
      assert.equal(consumer.request('washer-fluid'),false,'no new Native request after UNAVAILABLE');
    });
  }
});

test('JSON trusted/ACCEPTED fields and an unverified delivery never create a 3D record',async()=>{
  const {wireResult}=await import('./result-fixtures.mjs');const {digestResult}=await import('../mobile-result-contract.mjs');
  const result=wireResult('washer-fluid','FOUND'),resultDigest=await digestResult(result);
  for(const variant of ['trusted-field','verify-rejected','verify-echo']){
    await withScriptedNative(c=>{
      const binding={bindingId:'b1',localSessionId:c.localSessionId,generation:c.generation,syncSessionId:'s1',taskId:'washer-fluid',partId:'washer-fluid-cap',serverNow:1000,expiresAt:601000};
      const delivery={bindingId:'b1',localSessionId:c.localSessionId,generation:c.generation,syncSessionId:'s1',taskId:'washer-fluid',inspectionId:result.inspectionId,resultDigest,result,
        ...(variant==='trusted-field'?{trusted:true,sessionState:'ACCEPTED'}:{})};
      if(c.op==='poll')return {bindings:[binding],accepted:[delivery],terminal:[],unavailable:null};
      if(c.op==='verify')return variant==='verify-rejected'?{error:'REJECTED'}:{proof:{...c,trusted:true,sessionState:'ACCEPTED'}};
      return {ok:true};
    },async(consumer,commands)=>{
      consumer.startSession('local');
      await until(()=>consumer.snapshot.notice!==null);
      assert.equal(consumer.snapshot.records.length,0,variant);
      assert.equal(consumer.snapshot.notice,{'trusted-field':'INVALID_RESULT','verify-rejected':'VERIFICATION_FAILED','verify-echo':'INVALID_ACCEPTED_PROOF'}[variant]);
      assert.ok(commands.every(c=>!('result' in c)&&!('proof' in c)&&!('trusted' in c)),'RPC never carries results or proofs to Native');
    });
  }
});
