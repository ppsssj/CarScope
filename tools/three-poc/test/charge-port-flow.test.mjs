import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sourceWorldParts } from '../charge-port-model.mjs';
import { measureEvChargePortSupport, buildEvChargePort, EV_CHARGE_IDS } from '../../ioniq5-asset/ev-charge-port.mjs';
import { STATES as S, EVENTS as E, initialState, transition, hoodTarget, cameraGoal } from '../inspection-flow.mjs';
const start = () => transition(initialState(), { type:E.START });
const open = () => transition(start(), { type:E.SELECT_AREA,id:'ev-charge' }, { chargePortAvailable:true });
test('charge entry fails closed without measured support, has distinct part identities and no hood state', () => {
  const s=start();assert.equal(transition(s,{type:E.SELECT_AREA,id:'ev-charge'}),s);assert.equal(transition(s,{type:E.SELECT_AREA,id:'ev-charge'},{chargePortAvailable:false}),s);
  let st=open();assert.equal(st.name,S.CHARGE_PORT_PREVIEW);assert.equal(st.component,EV_CHARGE_IDS.flap);assert.equal(hoodTarget(st),0);
  assert.equal(transition(st,{type:E.SELECT_CHARGE_PART,id:EV_CHARGE_IDS.flap}),st);
  st=transition(st,{type:E.SELECT_CHARGE_PART,id:EV_CHARGE_IDS.port});assert.equal(cameraGoal(st),EV_CHARGE_IDS.port);
  for(const type of [E.HOOD_OPENED,E.HOOD_CLOSED,E.REQUEST_HANDOFF])assert.equal(transition(st,{type}),st);
  assert.equal(transition(st,{type:E.SELECT_CHARGE_PART,id:'battery-12v'}),st);
});
test('charge Back summary end and fresh entry restore product state without inventing records', () => {
  assert.deepEqual(transition(open(),{type:E.BACK}),start());assert.deepEqual(transition(open(),{type:E.EXIT}),initialState());
  const summary=transition(open(),{type:E.SHOW_SUMMARY});assert.equal(summary.name,S.INSPECTION_SUMMARY);assert.equal(summary.component,null);assert.equal(hoodTarget(summary),0);
  assert.equal(transition(summary,{type:E.SELECT_AREA,id:'tires'}).name,S.TIRE_SELECTION);
  assert.equal(transition(summary,{type:E.SELECT_AREA,id:'ev-battery'}).name,S.EV_BATTERY_PREVIEW);
  assert.equal(transition(summary,{type:E.SELECT_AREA,id:'hood'}).name,S.HOOD_OPENING);
});
test('source adapter includes indexed and nonindexed meshes with exact nested world transforms without mutation', () => {
  const root=new THREE.Group();root.position.set(1,2,3);root.rotation.y=0.2;
  const group=new THREE.Group();group.scale.set(2,3,4);group.position.set(-1,0.5,0);root.add(group);
  const a=new THREE.BufferGeometry();a.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));a.setIndex([2,0,1]);
  const b=a.toNonIndexed();group.add(new THREE.Mesh(a),new THREE.Mesh(b));root.updateMatrixWorld(true);
  const snapshot=()=>JSON.stringify({positions:[...a.attributes.position.array],index:[...a.index.array],root:root.matrix.toArray(),group:group.matrix.toArray(),world:group.matrixWorld.toArray()});
  const before=snapshot(),parts=sourceWorldParts(root);assert.equal(parts.length,2);assert.deepEqual(parts[0].triangles,parts[1].triangles);
  const point=new THREE.Vector3(0,1,0).applyMatrix4(group.matrixWorld);assert.deepEqual([...parts[0].triangles.slice(0,3)],[point.x*100,-point.z*100,point.y*100]);assert.equal(snapshot(),before);
  assert.throws(()=>measureEvChargePortSupport(parts));assert.throws(()=>buildEvChargePort());
});
test('invalid or unsupported original source never yields a fallback model', () => {
  assert.throws(()=>sourceWorldParts(new THREE.Group()));
  const root=new THREE.Group(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0],3));root.add(new THREE.Mesh(g));assert.throws(()=>sourceWorldParts(root));
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));root.children[0].isSkinnedMesh=true;assert.throws(()=>sourceWorldParts(root));
});
