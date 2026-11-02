import test from 'node:test';
import assert from 'node:assert/strict';
import { ComponentStatusStore, ComponentStatusClient, validateComponentStatus } from '../component-status.mjs';
import { chargeBlank, validateChargePortStatus, chargePortStatus, chargePortStatusHtml, enableChargePortStatus, disposeChargePortStatus } from '../ev-charge-status.mjs';
import { chargeFixture } from './ev-charge-status-fixture.mjs';
import { componentFixture } from './component-status-fixture.mjs';
const store = () => new ComponentStatusStore(validateChargePortStatus, chargeBlank);
test('independent charge v1 rejects component v1 and preserves nullable Boolean provenance', () => {
  const p = validateChargePortStatus(chargeFixture()); assert.equal(p.readings[0].value, false); assert.ok(Object.isFrozen(p.readings[0]));
  assert.throws(() => validateComponentStatus(p)); assert.throws(() => validateChargePortStatus(componentFixture()));
  const s = store(); assert.equal(s.state.readings.length, 1); assert.equal(s.state.readings[0].value, null);
});
test('charge strict row rejects unknown string numbers units IDs duplicates diagnostics and inconsistent states', () => {
  for (const edit of [p=>p.vin='private',p=>p.schemaVersion=2,p=>p.readings.push(p.readings[0]),p=>p.readings[0].featureId='ev-battery.soc',p=>p.readings[0].vehiclePartId='ev-charge.flap',p=>p.readings[0].value='UNKNOWN',p=>p.readings[0].value=0,p=>p.readings[0].observedAt=null,p=>p.readings[0].unit='deg',p=>p.readings[0].reason='private',p=>p.readings[0].capabilityStatus='UNSUPPORTED',p=>p.readings[0].source=null,p=>p.connectionStatus='STOPPED']) {
    const p=chargeFixture();edit(p);assert.throws(()=>validateChargePortStatus(p));
  }
  const p=chargeFixture();Object.assign(p.readings[0],{availabilityStatus:'UNAVAILABLE',value:null,observedAt:null});assert.equal(validateChargePortStatus(p).readings[0].value,null);
});
test('charge sequence owner and lifecycle reject replay without disturbing component store', () => {
  const a=store(),b=new ComponentStatusStore();b.accept(componentFixture());const previous=b.state;
  assert.ok(a.accept(chargeFixture()));assert.equal(a.accept(chargeFixture()),false);
  const p=chargeFixture();p.sequence=2;p.sessionId='00000000-0000-4000-8000-000000000002';assert.equal(a.accept(p),false);
  a.invalidate();assert.ok(a.accept(p));a.unavailable();assert.equal(a.state.readings[0].value,null);assert.equal(a.state.readings[0].source,'MOCK');assert.equal(b.state,previous);
});
test('charge transport uses only independent cache GET and stop ignores a late result', async () => {
  const s=store();let finish,calls=0;const c=new ComponentStatusClient(s,{endpoint:'./ev-charge-status.json',schedule:()=>1,cancel:()=>{},fetchImpl:(url,opts)=>{calls++;assert.equal(url,'./ev-charge-status.json');assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');return new Promise(r=>finish=r);}});
  c.start();c.start();assert.equal(calls,1);c.stop();finish(new Response(JSON.stringify(chargeFixture()),{headers:{'Content-Type':'application/json'}}));await new Promise(r=>setTimeout(r,0));assert.equal(s.state.connectionStatus,'STOPPED');assert.equal(s.state.readings[0].source,null);
});
test('charge errors and redirect never keep an old report or fall back to mock', async () => {
  for(const response of [new Response('{}',{status:403}),{ok:true,redirected:true},new Response('{"bad":1}',{headers:{'Content-Type':'application/json'}})]) {
    const s=store();s.accept(chargeFixture());const c=new ComponentStatusClient(s,{fetchImpl:async()=>response,schedule:()=>1,cancel:()=>{}});c.running=true;c.generation=1;await c.poll(1);assert.equal(s.state.connectionStatus,'UNAVAILABLE');assert.equal(s.state.readings[0].value,null);assert.equal(s.state.readings[0].source,'MOCK');
  }
});
test('charge panel reports SDK Boolean without charging safety angle or fabricated closure', () => {
  chargePortStatus.invalidate();assert.match(chargePortStatusHtml(),/미수신/);chargePortStatus.accept(chargeFixture());const html=chargePortStatusHtml();assert.match(html,/false/);assert.match(html,/Deprecated/);assert.match(html,/USER_REPORTED/);assert.match(html,/충전 중·완료·잠금·안전 판정이 아닙니다/);assert.doesNotMatch(html,/정상입니다|CLOSED|회전각/);chargePortStatus.invalidate();
});
test('charge pause hidden resume and disposal rotate ownership and stop polling', async () => {
  const previous={fetch:globalThis.fetch,document:globalThis.document,add:globalThis.addEventListener,remove:globalThis.removeEventListener};const events=new EventTarget();let calls=0;
  globalThis.addEventListener=events.addEventListener.bind(events);globalThis.removeEventListener=events.removeEventListener.bind(events);globalThis.document=new EventTarget();document.visibilityState='visible';
  globalThis.fetch=async()=>{calls++;const p=chargeFixture();if(calls>1)p.sessionId='00000000-0000-4000-8000-000000000002';return new Response(JSON.stringify(p),{headers:{'Content-Type':'application/json'}});};
  try {enableChargePortStatus();await new Promise(r=>setTimeout(r,0));events.dispatchEvent(new Event('carscope-component-inactive'));assert.equal(chargePortStatus.state.readings[0].source,null);events.dispatchEvent(new Event('carscope-component-active'));await new Promise(r=>setTimeout(r,0));assert.equal(chargePortStatus.sessionId,'00000000-0000-4000-8000-000000000002');document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));assert.equal(chargePortStatus.state.connectionStatus,'STOPPED');disposeChargePortStatus();const n=calls;events.dispatchEvent(new Event('carscope-component-active'));assert.equal(calls,n);}finally{disposeChargePortStatus();Object.assign(globalThis,{fetch:previous.fetch,document:previous.document,addEventListener:previous.add,removeEventListener:previous.remove});}
});
