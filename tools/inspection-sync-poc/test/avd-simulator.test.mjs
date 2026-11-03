import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { AvdSimulatorCredentialStore, AVD_MODE, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';

const uri = process.env.PG_TEST_URL;
const host = 'https://carscope-avd-test.onrender.com';
function request(port, method, path, { bearer, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, method, path,
      headers: {
        Host: new URL(host).host,
        'X-Forwarded-Proto': 'https',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', x => chunks.push(x));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(raw); } catch { data = null; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    request.on('error', reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}

test('P6-D3 AVD operator registration / short-lived grant / revocation, real PostgreSQL and HTTP',
  { skip: !uri && 'PG_TEST_URL absent: PostgreSQL integration NOT_RUN', timeout: 90_000 },
  async t => {
    const hostname = new URL(uri).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) throw new Error('PG_TEST_URL_MUST_BE_LOCAL');
    const { Pool } = await import('pg');
    const adminPool = new Pool({connectionString:uri, max:3, connectionTimeoutMillis:5000});
    const httpPool = new Pool({connectionString:uri, max:3, connectionTimeoutMillis:5000});
    t.after(async () => { await adminPool.end(); });
    const registry = new AvdSimulatorCredentialStore({pool:adminPool});
    await registry.initialize();
    const app = await startRenderStateful({
      pool:httpPool, publicOrigin:host, enableAvdSimulation:true,
    });
    t.after(async () => { await app.stop(); });
    const port=app.server.address().port;
    const { enrollmentProof, registrationId, expiresAt } = await registry.register({
      label:'pleos-test-avd', ttlMs:2*60*60_000,
    });

    await t.test('health is explicitly simulation-only and defaults are not OEM assertions', async () => {
      const h=await request(port,'GET','/healthz');
      assert.equal(h.status,200);
      assert.equal(h.data.mode,'STATEFUL_AVD_SIMULATION');
      assert.equal(h.data.sessionCreation,'OPERATOR_APPROVED_AVD_ONLY');
      const bad=await request(port,'POST','/simulator/provision',{
        bearer:'a'.repeat(43), body:{apiOrigin:host,audience:AVD_AUDIENCE},
      });
      assert.equal(bad.status,401);
    });

    let credential, credentialId;
    await t.test('operator approval permits simulator-only provisioning over controlled ingress', async () => {
      const wrong=await request(port,'POST','/simulator/provision',{
        bearer:enrollmentProof,body:{apiOrigin:host,audience:'wrong'},
      });
      assert.equal(wrong.status,400);
      const ok=await request(port,'POST','/simulator/provision',{
        bearer:enrollmentProof,body:{apiOrigin:host,audience:AVD_AUDIENCE},
      });
      assert.equal(ok.status,200);
      assert.equal(ok.data.mode,AVD_MODE);
      assert.equal(ok.data.simulatorApproved,true);
      assert.equal(ok.data.realVehicleOwnershipVerified,false);
      assert.equal(ok.data.apiOrigin,host);
      assert.equal(ok.data.scope,'inspection:session:create');
      assert.equal(ok.data.expiresAt-ok.data.issuedAt,120_000);
      assert.equal(typeof ok.data.registrationId,'string');
      assert.equal(ok.data.registrationId,registrationId);
      assert.match(ok.data.credential,/^[a-zA-Z0-9_-]{43}$/);
      credential=ok.data.credential;
      credentialId=ok.data.credentialId;
      const r=await adminPool.query('SELECT enrollment_hash FROM cs_avd_registrations WHERE id=$1',[registrationId]);
      assert.notEqual(r.rows[0].enrollment_hash,enrollmentProof);
      const g=await adminPool.query('SELECT token_hash FROM cs_avd_creation_grants WHERE id=$1',[credentialId]);
      assert.equal(g.rows[0].token_hash,createHash('sha256').update(credential).digest('hex'));
      assert.notEqual(g.rows[0].token_hash,credential);
      assert.equal(await registry.authorize({token:credential,secure:false}),false);
      assert.equal(await registry.authorize({token:credential,secure:true}),true);
      assert.equal(await registry.authorize({token:credential,secure:true,now:()=>ok.data.expiresAt+1}),false);
      assert.equal(await registry.provision({enrollmentProof,now:()=>expiresAt+1}),null);
    });

    let created;
    await t.test('approved simulator credential alone can create session; invalid ingress refused', async () => {
      const body={taskId:'washer-fluid'};
      assert.equal((await request(port,'POST','/v1/sessions',{body})).status,403);
      assert.equal((await request(port,'POST','/v1/sessions',{body,bearer:enrollmentProof})).status,403);
      assert.equal((await request(port,'POST','/v1/sessions',{body,bearer:credential,
        headers:{'X-Forwarded-Proto':'http'}})).status,403);
      assert.equal((await request(port,'POST','/v1/sessions',{body,bearer:credential,
        headers:{Host:'bad.example'}})).status,403);
      const good=await request(port,'POST','/v1/sessions',{body,bearer:credential});
      assert.equal(good.status,201);
      created=good.data;
      assert.equal(created.taskId,'washer-fluid');
      assert.match(created.receiverToken,/^[a-zA-Z0-9_-]{43}$/);
      assert.match(created.inviteToken,/^[a-zA-Z0-9_-]{43}$/);
      const v=await request(port,'GET','/v1/sessions/'+created.sessionId,{bearer:created.receiverToken});
      assert.equal(v.status,200);
      assert.equal(v.data.sessionState,'CREATED');
    });
    await t.test('operator revocation blocks new grants and creation without altering old session history', async () => {
      assert.equal(await registry.revoke({registrationId}),true);
      assert.equal(await registry.authorize({token:credential,secure:true}),false);
      assert.equal((await request(port,'POST','/v1/sessions',{
        bearer:credential,body:{taskId:'washer-fluid'},
      })).status,403);
      assert.equal((await request(port,'POST','/simulator/provision',{
        bearer:enrollmentProof,body:{apiOrigin:host,audience:AVD_AUDIENCE},
      })).status,401);
      const v=await request(port,'GET','/v1/sessions/'+created.sessionId,{bearer:created.receiverToken});
      assert.equal(v.status,200, 'revocation affects future creation, existing sessions follow existing TTL/cancel policy');
      assert.equal(await registry.revoke({registrationId}),true);
    });
  });

test('P6-D3 remains disabled without operator opt-in, even with PostgreSQL available',
  { skip: !uri && 'PG_TEST_URL absent', timeout:90_000 },
  async t => {
    if (!['localhost','127.0.0.1','::1'].includes(new URL(uri).hostname)) throw new Error('LOCAL_DB_REQUIRED');
    const { Pool } = await import('pg');
    const pool=new Pool({connectionString:uri,max:2,connectionTimeoutMillis:5000});
    const app=await startRenderStateful({pool,publicOrigin:host});
    t.after(async () => { await app.stop(); });
    const port=app.server.address().port;
    const h=await request(port,'GET','/healthz');
    assert.equal(h.data.mode,'STATEFUL_DENY_DEFAULT');
    assert.equal(h.data.sessionCreation,'DENIED');
    assert.equal((await request(port,'POST','/simulator/provision',{
      bearer:'a'.repeat(43),body:{apiOrigin:host,audience:AVD_AUDIENCE}
    })).status,404);
  });
