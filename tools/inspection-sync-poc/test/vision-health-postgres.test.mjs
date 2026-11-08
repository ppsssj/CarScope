import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startRenderVisionExperiment } from '../src/render-vision-experiment.mjs';
import { PostgreSQLVisionBudget } from '../src/vision-budget.mjs';
import { visionDatabase } from './vision-fixture.mjs';
import { createMockVisionProvider } from '../../vision-poc/src/mock-vision-provider.mjs';
const skip = !process.env.PG_TEST_URL && 'PG_TEST_URL absent: HTTP health deadline NOT_RUN';
test('actual Vision HTTP returns bounded 503 for a stalled query, keeps root responsive, and requires DB recovery for UP', { skip, timeout:20_000 }, async t => {
  const db=await visionDatabase(), pool=db.pool(), logs=[];
  const budget=new PostgreSQLVisionBudget({ pool,daily:1,monthly:1,expectedSchema:db.schema });
  const origin='https://vision-health-test.onrender.com';
  const app=await startRenderVisionExperiment({ pool,provider:createMockVisionProvider(),budget,expectedSchema:db.schema,publicOrigin:origin,healthLog:code=>logs.push(code) });
  const connect=pool.connect.bind(pool); let stalled=true, started=false, lateAnswer, discarded=0;
  pool.connect=function(...args) {
    if (typeof args[0] === 'function') return connect(...args);
    return connect(...args).then(client => ({
      on:client.on.bind(client), removeListener:client.removeListener.bind(client),
      release:error=>{ if(error) discarded++; client.release(error); },
      query:(query,...rest)=>{
        if(stalled && query?.text==='SELECT current_schema() AS name') {
          started=true; return new Promise(resolve=>{ lateAnswer=resolve; });
        }
        return client.query(query,...rest);
      },
    }));
  };
  t.after(async()=>{ pool.connect=connect; await app.stop(); await db.close(); });
  const request=path=>new Promise((resolve,reject)=>{
    const q=http.get({ host:'127.0.0.1',port:app.server.address().port,path,headers:{ Host:new URL(origin).host,'X-Forwarded-Proto':'https' } },res=>{
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve({ status:res.statusCode,text:Buffer.concat(chunks).toString() }));
    }); q.on('error',reject);
  });
  let done=false; const pending=request('/healthz').then(result=>{ done=true; return result; });
  for(let i=0;i<100 && !started;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(started,true);
  assert.equal((await request('/')).status,200); assert.equal(done,false,'root does not await the health database query');
  const failed=await pending; assert.equal(failed.status,503);
  assert.deepEqual(JSON.parse(failed.text),{ status:'DOWN',code:'DATABASE_TIMEOUT' }); assert.equal(discarded,1);
  lateAnswer({ rows:[{ name:db.schema }] }); stalled=false;
  const recovered=await request('/healthz'); assert.equal(recovered.status,200);
  assert.equal(JSON.parse(recovered.text).status,'UP'); assert.equal(discarded,1);
  assert.deepEqual(logs,['VISION_HEALTH_REQUEST','VISION_HEALTH_DATABASE_TIMEOUT','VISION_HEALTH_REQUEST','VISION_HEALTH_PASS']);
});
