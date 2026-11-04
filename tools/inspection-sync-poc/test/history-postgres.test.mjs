import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { SessionService,DEFAULT_LIMITS } from '../src/sessions.mjs';
import { HistoryService, UNVERIFIED_AUTHORITY } from '../src/history.mjs';
import { SUPPORTED_TASKS,resultDigest } from '../src/protocol.mjs';
import { startSyncServer } from '../src/server.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { historyAuthFixture,historyResult,envelope } from './history-fixtures.mjs';
import { localPki,tlsFetch } from './https-helpers.mjs';
import http from 'node:http';

const uri=process.env.PG_TEST_URL;
test('history: actual PostgreSQL atomic acceptance, authenticated TLS reads, restart and independent retention',
  {skip:!uri&&'PG_TEST_URL absent: actual PostgreSQL history NOT_RUN',timeout:120_000},async t=>{
  if(!['127.0.0.1','localhost','[::1]','::1'].includes(new URL(uri).hostname))throw Error('HISTORY_TEST_DATABASE_MUST_BE_LOOPBACK');
  const {Pool}=await import('pg');
  const schema='cs_history_test_'+randomUUID().replaceAll('-','');
  if(!/^cs_history_test_[a-f0-9]{32}$/.test(schema))throw Error('INVALID_OWNED_SCHEMA');
  const admin=new Pool({connectionString:uri,max:2,connectionTimeoutMillis:5000});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pools=[];
  const pool=()=>{const p=new Pool({connectionString:uri,max:4,options:'-c search_path='+schema,connectionTimeoutMillis:5000});p.on('error',()=>{});pools.push(p);return p;};
  const a=pool(),b=pool();const store=await PostgreSQLSessionStore.open({pool:a}),other=await PostgreSQLSessionStore.open({pool:b});
  let now=Date.now(),app;const auth=historyAuthFixture({now:()=>now}),pki=localPki(),fetchTls=tlsFetch(pki.ca);
  const service=new SessionService({store,now:()=>now});
  const principal=()=>auth.read.resolve({token:auth.tokens.Aread,secure:true});
  const binding=owner=>auth.creation.resolveHistoryAuthority({token:auth.tokens[owner+'create'],secure:true});
  async function start(store){return startSyncServer({port:0,store,now:()=>now,authorizer:auth.creation,historyAuthorizer:auth.read,tlsCert:pki.tlsCert,tlsKey:pki.tlsKey,log:()=>{}});}
  async function call(method,path,{token=auth.tokens.Aread,body,headers={}}={}){
    const r=await fetchTls(app.url+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),headers:r.headers};
  }
  async function prepared(result,owner='A',authority){
    const s=await service.create({taskId:result.taskId},{historyBinding:authority??await binding(owner)});
    const claim=await service.claim(s.inviteToken);await service.submit(claim.submitToken,envelope(result));return s;
  }
  const count=async()=>Number((await a.query('SELECT count(*) AS n FROM cs_inspection_records')).rows[0].n);
  t.after(async()=>{await app?.stop();pki.cleanup();await Promise.allSettled(pools.map(p=>p.end()));await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  app=await start(store);
  const archived=[];
  await t.test('17 tasks: authenticated TLS create/claim/submit/explicit Accept produces one immutable record each',async()=>{
    for(let i=0;i<SUPPORTED_TASKS.length;i++){
      if(i>0&&i%8===0){await app.stop();app=await start(store);} // unchanged create rate limit, isolated server lifetimes
      const task=SUPPORTED_TASKS[i],result=historyResult(task,{completedAt:now-i*60_000,answer:i%2?'FOUND':'UNABLE'});
      const created=await call('POST','/v1/sessions',{token:auth.tokens.Acreate,body:{taskId:task,userId:'user-B',vehicleId:'vehicle-B',authorityNamespace:'spoof'}});assert.equal(created.status,201);
      const session=created.body;
      const claimed=await call('POST','/v1/claim',{token:session.inviteToken});assert.equal(claimed.status,200);
      const submitted=await call('POST','/v1/submissions',{token:claimed.body.submitToken,body:envelope(result)});assert.equal(submitted.status,201);
      assert.equal(await count(),i);
      const accepted=await call('POST',`/v1/sessions/${session.sessionId}/accept`,{token:session.receiverToken,body:{resultDigest:submitted.body.receipt.resultDigest}});assert.equal(accepted.status,200);assert.equal(accepted.body.sessionState,'ACCEPTED');
      const row=(await a.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1',[result.inspectionId])).rows[0];
      assert.deepEqual(row.original_result,result);assert.equal(row.result_digest,await resultDigest(result));assert.equal(row.user_id,'user-A');assert.equal(row.vehicle_id,'vehicle-A');assert.equal(row.authority_namespace,'VERIFIED_VEHICLE');
      assert.equal(row.schema_version,task==='washer-fluid'?1:2);
      for(const secret of [session.receiverToken,session.inviteToken,claimed.body.submitToken,auth.tokens.Acreate])assert.equal(JSON.stringify(row).includes(secret),false);
      const detail=await call('GET','/v1/inspection-records/'+row.record_id);assert.equal(detail.status,200);assert.deepEqual(detail.body.record.originalResult,result);assert.deepEqual(detail.body.record.responses,result.responses??{});assert.equal(detail.body.record.source,'USER_REPORTED');assert.equal(detail.body.record.sdkDataIncluded,false);
      archived.push({result,session,recordId:row.record_id});
    }
    assert.equal(await count(),17);
  });
  await t.test('owner-scoped latest lists, part/task/status/date filters, stable keyset pages and invalid filters',async()=>{
    const full=await call('GET','/v1/inspection-records?limit=100');assert.equal(full.status,200);assert.equal(full.body.items.length,17);
    assert.deepEqual(full.body.items.map(r=>r.inspectionId),archived.map(r=>r.result.inspectionId));assert.equal(full.body.page.hasMore,false);
    const task=archived[0].result.taskId,status=archived[0].result.status;
    for(const q of ['taskId='+task,'partId=washer-fluid-cap']){const r=await call('GET','/v1/inspection-records?'+q);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].taskId,task);}
    const filtered=await call('GET','/v1/inspection-records?status='+status);assert.ok(filtered.body.items.every(r=>r.inspectionStatus===status));
    const from=archived[3].result.completedAt,to=archived[0].result.completedAt;
    const date=await call('GET','/v1/inspection-records?'+new URLSearchParams({from,to}));assert.deepEqual(date.body.items.map(r=>r.inspectionId),archived.slice(1,4).map(r=>r.result.inspectionId));
    const ids=[];let cursor=null;do{const q=new URLSearchParams({limit:'3',...(cursor?{cursor}:{})}),page=await call('GET','/v1/inspection-records?'+q);assert.equal(page.status,200);ids.push(...page.body.items.map(r=>r.recordId));cursor=page.body.page.nextCursor;}while(cursor);
    assert.equal(new Set(ids).size,17);assert.deepEqual(ids,archived.map(r=>r.recordId));
    const page=await call('GET','/v1/inspection-records?limit=1');
    assert.equal((await call('GET','/v1/inspection-records?'+new URLSearchParams({limit:'1',taskId:'washer-fluid',cursor:page.body.page.nextCursor}))).status,400);
    for(const q of ['limit=101','limit=0','limit=1&limit=2','userId=user-B','vehicleId=vehicle-B','from=bad','taskId=coolant','status=SAFE'])assert.equal((await call('GET','/v1/inspection-records?'+q)).status,400);
  });
  await t.test('no credential, QR receiver, creation scope, wrong owner and forged identity cannot read history',async()=>{
    for(const token of [null,archived[0].session.receiverToken,auth.tokens.Acreate,'x'.repeat(43)])assert.equal((await call('GET','/v1/inspection-records',{token})).status,403);
    assert.equal((await call('GET','/v1/inspection-records/'+archived[0].recordId,{token:auth.tokens.Bread})).status,404);
    assert.equal((await call('GET','/v1/inspection-records/'+randomUUID(),{token:auth.tokens.Bread})).status,404);
    const bList=await call('GET','/v1/inspection-records',{token:auth.tokens.Bread});assert.equal(bList.body.items.length,0);
    const spoof=await call('GET','/v1/inspection-records',{headers:{'X-User-Id':'user-B','X-Vehicle-Id':'vehicle-B'}});assert.equal(spoof.body.items.length,17);
    auth.owners.A.ownershipVerified=false;assert.equal((await call('GET','/v1/inspection-records')).status,403);auth.owners.A.ownershipVerified=true;
    const grant=auth.grants.get(auth.tokens.Aread);grant.active=false;assert.equal((await call('GET','/v1/inspection-records')).status,403);grant.active=true;
  });
  await t.test('same-session and cross-session concurrent Accept retries are idempotent, differing digest is CONFLICT',async()=>{
    const result=historyResult('coolant-reservoir'),s=await prepared(result),digest=await resultDigest(result),before=await count();
    const svcB=new SessionService({store:other,now:()=>now});
    const out=await Promise.all(Array.from({length:12},(_,i)=>(i%2?service:svcB).accept(s.sessionId,s.receiverToken,digest)));assert.ok(out.every(r=>r.sessionState==='ACCEPTED'));assert.equal(await count(),before+1);
    const first=(await a.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1',[result.inspectionId])).rows[0];
    const duplicate=await prepared(result);await service.accept(duplicate.sessionId,duplicate.receiverToken,digest);assert.equal(await count(),before+1);
    assert.deepEqual((await a.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1',[result.inspectionId])).rows[0],first);
    const changed=historyResult(result.taskId,{inspectionId:result.inspectionId,completedAt:Date.parse(result.completedAt),answer:'FOUND'}),bad=await prepared(changed);
    const changedDigest=await resultDigest(changed);
    await assert.rejects(()=>service.accept(bad.sessionId,bad.receiverToken,changedDigest),{code:'CONFLICT'});
    assert.equal((await service.view(bad.sessionId,bad.receiverToken)).sessionState,'RESULT_SUBMITTED');assert.equal(await count(),before+1);
    const otherOwner=await prepared(result,'B');await assert.rejects(()=>service.accept(otherOwner.sessionId,otherOwner.receiverToken,digest),{code:'CONFLICT'});
    const concurrent=historyResult('light-low-beam-left-0'),one=await prepared(concurrent),two=await prepared(concurrent),concurrentDigest=await resultDigest(concurrent),beforeRace=await count();
    const equal=await Promise.all([service.accept(one.sessionId,one.receiverToken,concurrentDigest),svcB.accept(two.sessionId,two.receiverToken,concurrentDigest)]);
    assert.ok(equal.every(r=>r.sessionState==='ACCEPTED'));assert.equal(await count(),beforeRace+1);
    const conflict=historyResult('light-high-beam-left-0'),different=historyResult(conflict.taskId,{inspectionId:conflict.inspectionId,completedAt:Date.parse(conflict.completedAt),answer:'FOUND'});
    const left=await prepared(conflict),right=await prepared(different),leftDigest=await resultDigest(conflict),rightDigest=await resultDigest(different);
    const mixed=await Promise.allSettled([service.accept(left.sessionId,left.receiverToken,leftDigest),svcB.accept(right.sessionId,right.receiverToken,rightDigest)]);
    assert.equal(mixed.filter(r=>r.status==='fulfilled').length,1);assert.equal(mixed.find(r=>r.status==='rejected').reason.code,'CONFLICT');assert.equal(await count(),beforeRace+2);
  });
  await t.test('revocation or owner change during a database read prevents the response; another owner reads only their records',async()=>{
    const originalList=store.historyList.bind(store),grant=auth.grants.get(auth.tokens.Aread);
    try{
      store.historyList=async query=>{const rows=await originalList(query);grant.active=false;return rows;};
      assert.equal((await call('GET','/v1/inspection-records')).status,403);
      grant.active=true;
      store.historyList=async query=>{const rows=await originalList(query);auth.owners.A.vehicleId='vehicle-B';return rows;};
      assert.equal((await call('GET','/v1/inspection-records')).status,403);
    }finally{store.historyList=originalList;grant.active=true;auth.owners.A.vehicleId='vehicle-A';}
    const result=historyResult('brake-fluid'),session=await prepared(result,'B');
    await service.accept(session.sessionId,session.receiverToken,await resultDigest(result));
    const list=await call('GET','/v1/inspection-records',{token:auth.tokens.Bread});assert.equal(list.status,200);assert.equal(list.body.items.length,1);
    const recordId=list.body.items[0].recordId;
    assert.deepEqual((await call('GET','/v1/inspection-records/'+recordId,{token:auth.tokens.Bread})).body.record.originalResult,result);
    assert.equal((await call('GET','/v1/inspection-records/'+recordId)).status,404);
  });
  await t.test('actual DB archive failure rolls back ACCEPTED and token writes, recovery succeeds once',async()=>{
    const result=historyResult('battery-12v'),s=await prepared(result),digest=await resultDigest(result),before=await count();
    await a.query("CREATE FUNCTION fail_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned history test write failure'; END; $$");
    await a.query('CREATE TRIGGER fail_history_insert BEFORE INSERT ON cs_inspection_records FOR EACH ROW EXECUTE FUNCTION fail_history_insert()');
    try{await assert.rejects(()=>service.accept(s.sessionId,s.receiverToken,digest),/owned history test write failure/);assert.equal(await count(),before);const state=await service.view(s.sessionId,s.receiverToken);assert.equal(state.sessionState,'RESULT_SUBMITTED');assert.equal(state.acceptedAt,null);}
    finally{await a.query('DROP TRIGGER fail_history_insert ON cs_inspection_records');await a.query('DROP FUNCTION fail_history_insert()');}
    await service.accept(s.sessionId,s.receiverToken,digest);await service.accept(s.sessionId,s.receiverToken,digest);assert.equal(await count(),before+1);
  });
  await t.test('invalid stored schema/digest and non-accepted terminal states cannot archive',async()=>{
    for(const kind of ['schema','digest','cancel','expire']){
      const result=historyResult('fuse-box'),s=await prepared(result),digest=await resultDigest(result),before=await count();
      if(kind==='cancel'){await service.cancel(s.sessionId,s.receiverToken);await assert.rejects(()=>service.accept(s.sessionId,s.receiverToken,digest));}
      else if(kind==='expire'){const expired=new SessionService({store,now:()=>now+DEFAULT_LIMITS.sessionTtlMs+1});await assert.rejects(()=>expired.accept(s.sessionId,s.receiverToken,digest),{code:'SESSION_EXPIRED'});}
      else {const data=await store.get(s.sessionId);if(kind==='schema')data.result.schemaVersion=1;else data.resultDigest='sha256:'+'0'.repeat(64);await a.query('UPDATE cs_sessions SET data=$2::jsonb WHERE id=$1',[s.sessionId,JSON.stringify(data)]);await assert.rejects(()=>service.accept(s.sessionId,s.receiverToken,data.resultDigest));assert.equal((await store.get(s.sessionId)).state,'RESULT_SUBMITTED');}
      assert.equal(await count(),before);
    }
  });
  await t.test('Accept rechecks expiry after waiting for a row lock; no record wins after deadline',async()=>{
    const result=historyResult('wiper.front.left'),s=await prepared(result),digest=await resultDigest(result),before=await count();
    const lock=await b.connect();await lock.query('BEGIN');await lock.query('SELECT data FROM cs_sessions WHERE id=$1 FOR UPDATE',[s.sessionId]);
    let entered;const blocked=new Promise(r=>entered=r);
    const raceStore={get:store.get.bind(store),idByTokenHash:store.idByTokenHash.bind(store),update:(id,mutate)=>{entered();return store.update(id,mutate);}};
    const race=new SessionService({store:raceStore,now:()=>now});const accept=race.accept(s.sessionId,s.receiverToken,digest);
    await blocked;now=s.expiresAt+1;await lock.query('COMMIT');lock.release();
    await assert.rejects(()=>accept,{code:'SESSION_EXPIRED'});assert.equal(await count(),before);auth.refresh();
  });
  await t.test('AVD/unverified records are isolated and cannot be read as real vehicle history',async()=>{
    for(const authority of [UNVERIFIED_AUTHORITY,{...UNVERIFIED_AUTHORITY,authorityNamespace:'AVD_SIMULATOR',authorityIssuer:'carscope:avd-simulator',registrationId:randomUUID(),bindingVerifiedAt:now}]){
      const result=historyResult('brake-fluid'),s=await prepared(result,'A',authority);await service.accept(s.sessionId,s.receiverToken,await resultDigest(result));
      const row=(await a.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1',[result.inspectionId])).rows[0];assert.equal(row.authority_namespace,authority.authorityNamespace);assert.equal(row.user_id,null);assert.equal(row.vehicle_id,null);
      assert.equal((await call('GET','/v1/inspection-records/'+row.record_id)).status,404);
    }
  });
  await t.test('restart with new service/pool, session result purge and tombstone delete preserve authenticated record reads',async()=>{
    const record=archived[0];await app.stop();const restartedStore=await PostgreSQLSessionStore.open({pool:pool()});app=await start(restartedStore);
    assert.equal((await call('GET','/v1/inspection-records/'+record.recordId)).status,200);
    const original=await restartedStore.get(record.session.sessionId);assert.equal(original.inviteExpiresAt-original.createdAt,600000);assert.equal(original.expiresAt-original.createdAt,1800000);assert.equal(original.purgeResultAt-original.acceptedAt,600000);
    now=Math.max(now,original.acceptedAt+600001);auth.refresh();await app.service.sweep();assert.equal((await restartedStore.get(record.session.sessionId)).result,null);
    assert.deepEqual((await call('GET','/v1/inspection-records/'+record.recordId)).body.record.originalResult,record.result);
    now=Math.max(now,original.endedAt+DEFAULT_LIMITS.tombstoneMs+1);auth.refresh();await app.service.sweep();assert.equal(await restartedStore.get(record.session.sessionId),null);
    assert.deepEqual((await call('GET','/v1/inspection-records/'+record.recordId)).body.record.originalResult,record.result);
    await app.stop();app=await start(await PostgreSQLSessionStore.open({pool:pool()}));assert.equal((await call('GET','/v1/inspection-records/'+record.recordId)).status,200);
  });
  await t.test('Render public history remains DENY_DEFAULT and query permission is history-only',async()=>{
    const render=await startRenderStateful({pool:pool(),publicOrigin:'https://history-test.onrender.com'});
    try{const request=path=>new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port:render.server.address().port,path,headers:{Host:'history-test.onrender.com','X-Forwarded-Proto':'https',Authorization:'Bearer '+auth.tokens.Aread,'X-User-Id':'user-A'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.end();});
      assert.equal(await request('/v1/inspection-records?limit=1'),403);assert.equal(await request('/v1/inspection-records/'+archived[0].recordId),403);assert.equal(await request('/v1/sessions?limit=1'),400);
    }finally{await render.stop();}
  });
  await t.test('history schema is additive, repeatable and rejects unknown future versions without altering base version',async()=>{
    assert.equal(Number((await a.query('SELECT version FROM cs_schema_meta WHERE id=1')).rows[0].version),1);
    await Promise.all([store.initialize(),other.initialize()]);assert.equal(Number((await a.query('SELECT version FROM cs_history_schema_meta WHERE id=1')).rows[0].version),1);
    const before=await count();await a.query('UPDATE cs_history_schema_meta SET version=2 WHERE id=1');
    try{await assert.rejects(()=>store.initialize(),/UNSUPPORTED_HISTORY_SCHEMA/);assert.equal(await count(),before);}finally{await a.query('UPDATE cs_history_schema_meta SET version=1 WHERE id=1');}
  });
  await t.test('database outage fails closed; new pool recovers without a phantom ACCEPTED record',async()=>{
    const outagePool=pool(),outageStore=await PostgreSQLSessionStore.open({pool:outagePool});
    const result=historyResult('tire.rear-left'),session=await prepared(result),digest=await resultDigest(result),before=await count();
    await outagePool.end();const offline=new SessionService({store:outageStore,now:()=>now});
    await assert.rejects(()=>offline.accept(session.sessionId,session.receiverToken,digest));
    assert.equal((await service.view(session.sessionId,session.receiverToken)).sessionState,'RESULT_SUBMITTED');assert.equal(await count(),before);
    const recovered=new SessionService({store:await PostgreSQLSessionStore.open({pool:pool()}),now:()=>now});
    await recovered.accept(session.sessionId,session.receiverToken,digest);assert.equal(await count(),before+1);
  });
  await t.test('legacy valid pre-epoch completion timestamps remain queryable and corrupted stored digests never read as valid',async()=>{
    const result=historyResult('washer-fluid',{completedAt:Date.UTC(1960,0,1)}),session=await prepared(result),digest=await resultDigest(result);
    await service.accept(session.sessionId,session.receiverToken,digest);
    const row=(await a.query('SELECT record_id FROM cs_inspection_records WHERE inspection_id=$1',[result.inspectionId])).rows[0];
    const range=new URLSearchParams({from:'1959-01-01T00:00:00.000Z',to:'1961-01-01T00:00:00.000Z'});
    assert.equal((await call('GET','/v1/inspection-records?'+range)).body.items[0].completedAt,Date.UTC(1960,0,1));
    await a.query('UPDATE cs_inspection_records SET result_digest=$2 WHERE record_id=$1',[row.record_id,'sha256:'+'0'.repeat(64)]);
    try{assert.equal((await call('GET','/v1/inspection-records/'+row.record_id)).status,500);assert.equal((await call('GET','/v1/inspection-records?'+range)).status,500);}
    finally{await a.query('UPDATE cs_inspection_records SET result_digest=$2 WHERE record_id=$1',[row.record_id,digest]);}
  });
});

