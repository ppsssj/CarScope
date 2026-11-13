import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountServer } from '../serve.mjs';
import { parseVehicleParam, inspectHref, withoutVehicleParam, createSelectionController, SELECTION } from '../web/lib/vehicle-selection.mjs';
import { referenceNotice } from '../web/lib/reference-model.mjs';
import { recordLinkEligibility, vehicleInspectionStatus } from '../web/lib/inspection-link-policy.mjs';
import { createVehicleRepository } from '../web/lib/vehicle-repository.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
test('selection URL contains only UUID; invalid, duplicate and foreign-format input rejected', () => {
  assert.equal(inspectHref(ID), '/inspect/inspect.html?vehicle=' + ID);
  assert.deepEqual(parseVehicleParam(''), { present: false });
  for (const search of ['?vehicle=', '?vehicle=x', `?vehicle=${ID}&vehicle=${ID}`, '?vehicle=../account']) assert.equal(parseVehicleParam(search).valid, false);
  assert.equal(parseVehicleParam('?vehicle=' + ID).id, ID);
  assert.equal(withoutVehicleParam('https://test.invalid/inspect/inspect.html?vehicle=x&dev=1#keep'), '/inspect/inspect.html?dev=1#keep');
});
function harness(get) {
  let listener, state = { status: 'SIGNED_IN', epoch: 0 };
  const changes = [];
  const session = { get epoch() { return state.epoch; }, snapshot: () => state, subscribe(fn) { listener = fn; return () => { listener = null; }; } };
  const controller = createSelectionController({ id: ID, session, repo: { get }, onChange: (s,v) => changes.push([s,v]) });
  return { controller, changes, event(type, s) { state = { ...state, ...s }; listener?.(type, state); } };
}
test('restored identity can select a vehicle and revalidation rejects deleted/foreign UUID identically', async () => {
  let result = { ok: true, vehicle: { id: ID } };
  const h = harness(async () => result);
  await h.controller.verify(); assert.equal(h.controller.state, SELECTION.SELECTED);
  result = { ok: false, error: 'NOT_FOUND' };
  await h.controller.verify(); assert.equal(h.controller.state, SELECTION.NOT_FOUND); assert.equal(h.controller.vehicle, null);
});
for (const reason of ['ACCOUNT_SWITCHED', 'USER_SIGNED_OUT']) test(`late lookup cannot resurrect selection after ${reason}`, async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  const checking = h.controller.verify();
  h.event('clear', { status: 'SIGNED_OUT', reason, epoch: 1 });
  assert.equal(h.controller.vehicle, null);
  resolve({ ok: true, vehicle: { id: ID } }); await checking;
  assert.equal(h.controller.state, reason === 'ACCOUNT_SWITCHED' ? SELECTION.ACCOUNT_CHANGED : SELECTION.SIGNED_OUT);
});
test('unconfirmed identity never queries and failed lookup hides previously selected vehicle', async () => {
  let calls = 0;
  const h = harness(async () => (++calls === 1 ? { ok:true, vehicle:{id:ID} } : { ok:false, error:'NETWORK' }));
  h.event('state', { status:'AUTH_UNAVAILABLE' }); await h.controller.verify(); assert.equal(calls, 0);
  h.event('state', { status:'SIGNED_IN' }); await h.controller.verify();
  await h.controller.verify(); assert.equal(h.controller.vehicle, null); assert.equal(h.controller.state, SELECTION.UNCONFIRMED);
});
test('deletion and stop discard a pending lookup', async () => {
  for (const action of ['removed','stop']) {
    let resolve;
    const h = harness(() => new Promise(r => { resolve=r; })); const p = h.controller.verify();
    h.controller[action](ID); const count = h.changes.length;
    resolve({ok:true, vehicle:{id:ID}}); await p; assert.equal(h.changes.length, count);
  }
});
test('single vehicle repository read uses id filter and same identity guard', async () => {
  const steps = []; let complete;
  const chain = { select(v) { steps.push(['select',v]); return this; }, eq(k,v) { steps.push([k,v]); return this; }, maybeSingle() { return new Promise(r => { complete=r; }); } };
  const session = { epoch:0 };
  const repo = createVehicleRepository({ client:{ schema:() => ({ from:() => chain }) }, session });
  const p = repo.get(ID); session.epoch++; complete({data:{id:ID}});
  assert.equal((await p).error,'STALE_IDENTITY'); assert.deepEqual(steps[1],['id',ID]);
  const missing=repo.get(ID); complete({data:null}); assert.equal((await missing).error,'NOT_FOUND');
});
test('model notice never represents reference geometry as the registered vehicle', () => {
  assert.match(referenceNotice({manufacturer:'기아',model:'EV6'}).text,/다른 차종/);
  assert.match(referenceNotice({manufacturer:'Hyundai',model:'IONIQ 5',modelYear:2024}).text,/연식.*다릅니다/);
  assert.match(referenceNotice({manufacturer:'현대',model:'아이오닉 5',modelYear:2022}).text,/실제 형상.*반영하지 않습니다/);
});
test('session/AVD records cannot acquire verified history linkage; no new write path', () => {
  for (const record of [{kind:'SESSION_RESULT'}, {kind:'HISTORY_RECORD',recordId:'r',authorityNamespace:'AVD_SIMULATOR'}, {kind:'HISTORY_RECORD',recordId:'r',authorityNamespace:'VERIFIED_VEHICLE',ownershipEvidence:'OWNER_VERIFIED_RECORD'}]) {
    assert.equal(recordLinkEligibility({vehicle:{verification:'SELF_REPORTED_UNVERIFIED'},record}).linkable,false);
  }
  assert.equal(vehicleInspectionStatus({verification:'SELF_REPORTED_UNVERIFIED'},99).state,'NOT_LINKABLE');
});
test('mounted 3D serves reviewed runtime only, strict CSP, no model override or path escape', async t => {
  const {server} = createAccountServer({env:{}}); await new Promise(r => server.listen(0,'127.0.0.1',r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await fetch(base+'/inspect/inspect.html');
  assert.equal(html.status,200); assert.match(await html.text(),/account\/inspection-page.mjs/);
  const csp = html.headers.get('content-security-policy'); assert.match(csp,/script-src 'self' 'sha256-/); assert.doesNotMatch(csp,/script-src[^;]*unsafe/);
  for (const path of ['/inspect/inspect.js','/inspect/vendor/three/build/three.module.js','/mobile-ar-poc/public/part-capabilities.mjs','/inspect/inspection-handoff.json']) assert.equal((await fetch(base+path)).status,200,path);
  for (const path of ['/inspect/serve.mjs','/inspect/test/browser-inspection-results.mjs','/inspect/node_modules/qrcode/package.json','/inspect/..%5cpackage.json','/inspect/external/ioniq5-svg/index.html']) assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base+'/inspect/inspect.html?model=https://attacker.invalid/model.glb')).status,400);
});
