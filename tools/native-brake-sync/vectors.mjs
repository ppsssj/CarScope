// Actual shipped mobile constructor + server validator/canonical digest; synthetic user responses.
import assert from 'node:assert/strict';
import { startBrakeResult, answerBrake, noteBrakeAids, completeBrakeResult } from '../mobile-ar-poc/public/brake-result.mjs';
import { canonicalJson, resultDigest, checkEnvelope } from '../inspection-sync-poc/src/protocol.mjs';
for (const cameraUsed of [false,true]) for (const locationMarked of [false,true]) {
  for (const levelMarking of ['FOUND','NOT_FOUND','UNABLE']) for (const leakTrace of ['FOUND','NOT_FOUND','UNABLE']) for (const exteriorDamage of ['FOUND','NOT_FOUND','UNABLE']) {
    let result = startBrakeResult('brake-fluid', { now:()=>Date.parse('2026-11-03T00:00:00.000Z'), newId:()=> '12345678-1234-4123-8123-123456789abc' });
    for (const [key,value] of Object.entries({levelMarking,leakTrace,exteriorDamage})) result = answerBrake(result,key,value);
    result = noteBrakeAids(result,{cameraUsed,locationMarked});
    result = completeBrakeResult(result,{now:()=>Date.parse('2026-11-03T00:02:00.000Z')});
    assert.deepEqual(checkEnvelope({protocol:'inspection-sync',protocolVersion:1,result},'brake-fluid'),[]);
    console.log([JSON.stringify(result),canonicalJson(result),await resultDigest(result)].join('\t'));
  }
}
