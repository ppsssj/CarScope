import test from 'node:test';
import assert from 'node:assert/strict';
import { visionEnvironment } from '../src/render-vision-experiment.mjs';
import { experimentVisionProvider, approvedDetectionProvider } from '../src/vision-providers.mjs';
import { budgetedCall, PostgreSQLVisionBudget } from '../src/vision-budget.mjs';
import { visionExperimentGate, environmentGate, partAnalysisGate, partDetectionGate, importGraph } from '../preflight/static-gates.mjs';
import { buildAnalysisPrompt, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { mockAnswer } from '../../vision-poc/src/mock-vision-provider.mjs';
import { startSyncServer } from '../src/server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { ReceiverClient } from '../bin/receiver.mjs';
import { candidatesFor } from '../../mobile-ar-poc/public/part-detection.mjs';
import { probeDeployment } from '../preflight/probe.mjs';

const env = { CARSCOPE_DB_SCHEMA: 'cs_vision_test', CARSCOPE_VISION_APPROVAL: 'OPERATOR_APPROVED', OPENAI_API_KEY: 'synthetic-key-not-real', OPENAI_VISION_MODEL: 'synthetic-model', CARSCOPE_VISION_DAILY_CALL_LIMIT: '2', CARSCOPE_VISION_MONTHLY_CALL_LIMIT: '5' };
test('preflight reports the experiment without changing default readiness or probing a paid route', async () => {
  for (const [extra, expected] of [[{},null],[{ vision:'EXPERIMENT',detection:'OFF' },'MANUAL'],[{ vision:'EXPERIMENT',detection:'EXPERIMENT' },'FAIL']]) {
    let calls = 0;
    const rows = await probeDeployment({ origin:'https://vision-test.example', request:async (_origin, route) => {
      assert.equal(route,'/healthz'); calls++;
      return { status:200,body:JSON.stringify({ status:'UP',mode:'STATEFUL_DENY_DEFAULT',sessionCreation:'DENIED',...extra }) };
    } });
    assert.equal(rows.find(r => r.id === 'RENDER_VISION_EXPERIMENT')?.status ?? null,expected); assert.equal(calls,1);
  }
});
test('separate bootstrap requires explicit operator configuration and limits; default gates remain OFF', () => {
  assert.deepEqual(visionEnvironment(env), { daily: 2, monthly: 5 });
  for (const key of Object.keys(env)) assert.throws(() => visionEnvironment({ ...env, [key]: '' }), /CONFIGURATION_REQUIRED|SCHEMA_NOT_PRIVATE/);
  for (const bad of ['0', '-1', '1e3', ' 2', '1000001']) assert.throws(() => visionEnvironment({ ...env, CARSCOPE_VISION_DAILY_CALL_LIMIT: bad }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => new PostgreSQLVisionBudget({ pool: {}, daily: 1, monthly: 1 }), /BUDGET_REQUIRED/);
  for (const gate of [visionExperimentGate, environmentGate, partAnalysisGate, partDetectionGate]) assert.equal(gate().status, 'PASS', gate().detail);
  assert.ok(!importGraph().some(file => /vision-providers|vision-budget|render-vision/.test(file)));
});

test('existing OpenAI adapter carries each profile, crop and schema, counts before dispatch, and never retries', async () => {
  let count = 0, mode = 'answer', network = 0;
  const budget = { reserve: async id => { assert.equal(id, 'openai'); count++; } };
  const provider = experimentVisionProvider({ env, budget, fetchImpl: async (url, options) => {
    network++; assert.equal(count, network); assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.OPENAI_API_KEY); assert.equal(options.redirect, 'error');
    if (mode === 'error') return new Response('upstream secret', { status: 429 });
    const request = JSON.parse(options.body), partId = request.text.format.schema.properties.partId.enum[0];
    assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
    assert.match(request.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(mockAnswer(partId, 'indeterminate')) }] }] });
  } });
  for (const partId of ['washer-fluid-cap','coolant-reservoir','brake-fluid-reservoir','fuse-box','battery-12v','lcw-coolant-reservoir']) {
    const input = { partId, image: Buffer.from('crop'), ...buildAnalysisPrompt(partId, { regionSource: 'MANUAL', targetInCrop: [0,0,1,1] }) };
    assert.equal(validateAnalysisResult(partId, await provider.analyzePart(input)).ok, true);
  }
  mode = 'error'; const before = network;
  await assert.rejects(provider.analyzePart({ image: Buffer.from('x'), instructions: 'x', userText: 'x', schema: {} }), /OPENAI_HTTP_429/);
  assert.equal(network, before + 1);
  const cancelled = AbortSignal.abort();
  await assert.rejects(provider.analyzePart({ image: Buffer.from('x'), instructions: 'x', userText: 'x', schema: {} }, { signal: cancelled }));
  assert.equal(network, before + 1, 'already cancelled requests do not reserve or dispatch');
});

test('Roboflow wiring needs explicit rights approval and its own budget; errors do not retry', async () => {
  assert.throws(() => approvedDetectionProvider({ apiKey: 'test' }), /RIGHTS_APPROVAL_REQUIRED/);
  let calls = 0;
  const detector = approvedDetectionProvider({ rightsApproved: true, apiKey: 'test-only', budget: { reserve: async id => { assert.equal(id, 'roboflow'); } }, fetchImpl: async () => { calls++; return new Response('no credit', { status: 429 }); } });
  await assert.rejects(detector.detect({ image: Buffer.from('photo') }), /PROVIDER_REFUSED/); assert.equal(calls, 1);
  const dispatch = budgetedCall({ budget: { reserve: async () => { throw new Error('db unavailable'); } }, provider: 'openai', call: () => { throw new Error('must not run'); } });
  await assert.rejects(dispatch('unused'), /db unavailable/);
  const classes = ['Windshield Wiper Fluid','Engine Coolant Reservoir','Brake Fluid','Fuse Box'];
  const supported = ['washer-fluid-cap','coolant-reservoir','brake-fluid-reservoir','fuse-box'];
  const prepared = approvedDetectionProvider({ rightsApproved:true, apiKey:'synthetic', budget:{ reserve:async () => {} },
    fetchImpl:async () => Response.json({ image:{ width:400,height:400 },predictions:classes.map(name => ({ x:200,y:200,width:40,height:40,confidence:0.9,class:name,class_id:1 })) }) });
  const detections = await prepared.detect({ image:Buffer.from('synthetic') });
  for (const part of supported) assert.equal(candidatesFor(part,detections).length,1,part);
});

test('analysis-only HTTP entry rejects AI candidates, missing consent and credentials for all six tasks', async t => {
  const { createMockVisionProvider } = await import('../../vision-poc/src/mock-vision-provider.mjs');
  const provider = createMockVisionProvider(); let now = Date.now();
  const app = await startSyncServer({ port: 0, now: () => now, authorizer: new LocalTestSessionCreationAuthorizer(), log: () => {}, partAnalysis: { provider } });
  t.after(() => app.stop());
  const tasks = { 'washer-fluid-cap':'washer-fluid', 'coolant-reservoir':'coolant-reservoir', 'brake-fluid-reservoir':'brake-fluid', 'fuse-box':'fuse-box', 'battery-12v':'battery-12v', 'lcw-coolant-reservoir':'lcw-coolant-reservoir' };
  for (const [part, task] of Object.entries(tasks)) {
    now += 61_000;
    const session = await new ReceiverClient({ baseUrl: app.url }).create(task);
    const { submitToken } = await (await fetch(app.url + '/v1/claim', { method:'POST', headers:{ Authorization:'Bearer ' + session.fragment.split('invite=')[1] } })).json();
    const post = headers => fetch(app.url + '/v1/part-analyses/' + part, { method:'POST', headers:{ Authorization:'Bearer ' + submitToken, 'Content-Type':'image/jpeg', 'X-CarScope-External-Processing':'part-analysis-v1', 'X-CarScope-Region-Source':'AI_CANDIDATE', 'X-CarScope-Target-Box':'0,0,1,1', ...headers }, body:'not read' });
    assert.equal((await post({ 'X-CarScope-External-Processing':'part-analysis-v1' })).status, 428); // wrong consent is refused first
    const { ANALYSIS_CONSENT } = await import('../../mobile-ar-poc/public/part-analysis.mjs');
    assert.equal((await post({ 'X-CarScope-External-Processing':ANALYSIS_CONSENT })).status, 400, part);
    assert.equal((await post({ Authorization:'Bearer wrong', 'X-CarScope-External-Processing':ANALYSIS_CONSENT, 'X-CarScope-Region-Source':'MANUAL' })).status, 401);
  }
  assert.equal(provider.calls.length, 0);
});
