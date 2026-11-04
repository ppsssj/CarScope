// Executed by NativeInspectionBridgeTest: stdout/stdin connects to the actual compiled Kotlin vault.
// No JS accepted-proof authority exists here. This is contract integration, not device/HTTPS E2E.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {createAndroidNativeInspectionAdapter} from '../android-native-inspection-adapter.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {createTireInspection} from '../tire-inspection.mjs';
import {projectInspectionResults,resultCounts} from '../inspection-results.mjs';
const timeout=setTimeout(()=>{console.error('Native RPC timeout');process.exit(1);},12000);
const lines=readline.createInterface({input:process.stdin});const replies=[];
lines.on('line',line=>replies.shift()?.(JSON.parse(line)));
globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};
globalThis.self=globalThis.top=globalThis;
globalThis.fetch=async url=>{
  const command=new URL(url,location.origin).searchParams.get('command');
  const result=await new Promise(resolve=>{replies.push(resolve);process.stdout.write(JSON.stringify({command})+'\n');});
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
};
const adapter=createAndroidNativeInspectionAdapter(),consumer=createNativeInspectionResults({adapter});
consumer.startSession('native-contract');
if(process.argv[2]==='blocked'){
  // Current Sync server: creation has no serverNow, so the Kotlin bridge refuses to bind.
  while(consumer.snapshot.connection==='ADAPTER_CONNECTED')await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(consumer.snapshot.connection,'UNAVAILABLE');assert.equal(consumer.snapshot.notice,'SERVER_CLOCK_UNAVAILABLE');
  assert.equal(consumer.snapshot.records.length,0);assert.equal(consumer.snapshot.bindings.length,0);
  consumer.dispose();clearTimeout(timeout);lines.close();
  process.stdout.write(JSON.stringify({done:true,records:0,notice:'SERVER_CLOCK_UNAVAILABLE'})+'\n');
  process.exit(0);
}
const local=createTireInspection('native-contract'),original=JSON.stringify(local);
const sdk=Object.freeze({source:'SDK',observedAt:123,value:false}),sdkOriginal=JSON.stringify(sdk);
while(consumer.snapshot.records.length<17){
  assert.equal(consumer.snapshot.connection,'ADAPTER_CONNECTED');
  await new Promise(resolve=>setTimeout(resolve,10));
}
assert.equal(projectInspectionResults(local,consumer.snapshot).filter(r=>r.status==='NOT_INSPECTED').length,17);
for(const target of MOBILE_TARGETS){
  const record=consumer.snapshot.records.find(r=>r.taskId===target.taskId);
  assert.equal(record.partId,target.partId);assert.equal(record.proof.sessionState,'ACCEPTED');
  assert.equal(record.proof.receivedAt,105000);assert.equal(record.proof.acceptedAt,106000);
  assert.equal(consumer.select(target.taskId,record.inspectionId),true);
}
const rows=projectInspectionResults(local,consumer.snapshot);
assert.equal(rows.filter(r=>r.source==='MOBILE'&&r.confirmation==='USER_REPORTED').length,17);
assert.equal(resultCounts(rows).NOT_INSPECTED,0);
assert.equal(JSON.stringify(local),original);assert.equal(JSON.stringify(sdk),sdkOriginal);
consumer.endSession();assert.equal(consumer.snapshot.records.length,0);
consumer.dispose();clearTimeout(timeout);lines.close();
process.stdout.write(JSON.stringify({done:true,records:17})+'\n');
process.exit(0);
