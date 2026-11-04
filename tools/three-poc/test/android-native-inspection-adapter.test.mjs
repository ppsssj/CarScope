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
