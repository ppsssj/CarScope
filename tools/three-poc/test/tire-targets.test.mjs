import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TIRES, detachedTireInfo } from '../inspection-tires.mjs';
import { resolveTireTargets, tireCameraDirection } from '../tire-targets.mjs';
import { STATES as S, EVENTS as E, initialState, transition, cameraGoal, hoodTarget } from '../inspection-flow.mjs';
import { boxDistance } from '../inspection-camera.mjs';

function fixture() {
  const root = new THREE.Group();
  for (const t of TIRES) {
    const parent = new THREE.Group(); parent.name = t.node.replace('Wheel_', 'Grp_Wheel_Steering_Rotating_');
    const wheel = new THREE.Group(); wheel.name = t.node; parent.add(wheel); root.add(parent);
    wheel.position.set(t.front * 1.5, 0.376, -t.left * 0.773);
    const rubber = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 0.25, 32), new THREE.MeshStandardMaterial({ name: 'Tire' }));
    rubber.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.25, 32), new THREE.MeshStandardMaterial({ name: 'Rim_Black' }));
    rim.rotation.x = Math.PI / 2;
    wheel.add(rim, rubber); // deliberately not material/child index zero
  }
  return root;
}
test('four unique internal IDs map to one rubber primitive per exact wheel with correct signed bounds', () => {
  const root = fixture(), targets = resolveTireTargets(root);
  assert.equal(new Set(TIRES.map(t => t.id)).size, 4);
  assert.equal(new Set([...targets.values()].flatMap(t => t.meshes)).size, 4);
  for (const t of TIRES) {
    const target = targets.get(t.id), c = target.bounds.getCenter(new THREE.Vector3());
    assert.equal(target.meshes[0].material.name, 'Tire'); assert.equal(target.pickMeshes.length, 2);
    assert.ok(c.x * t.front > 0 && -c.z * t.left > 0);
    assert.equal(root.getObjectByName(t.node).parent.name, t.node.replace('Wheel_', 'Grp_Wheel_Steering_Rotating_'));
    const dir = tireCameraDirection(t.id); assert.ok(-dir[2] * t.left > 0);
  }
});
test('swapped left right or front rear, wrong hierarchy, missing duplicate or wrong-shaped tires fail closed', () => {
  for (const change of [
    root => { root.getObjectByName('Wheel_0_1').position.z *= -1; },
    root => { root.getObjectByName('Wheel_0_1').position.x *= -1; },
    root => { root.getObjectByName('Wheel_0_1').parent.name = 'wrong'; },
    root => { root.getObjectByName('Wheel_0_1').children.pop(); },
    root => { const w = root.getObjectByName('Wheel_0_1'); w.add(w.children[1].clone()); },
    root => { root.getObjectByName('Wheel_0_1').scale.setScalar(0.1); },
    root => { root.add(root.getObjectByName('Wheel_0_1').clone()); },
  ]) { const root = fixture(); change(root); assert.throws(() => resolveTireTargets(root)); }
});
test('real Three raycaster hits near rubber or rim and a body occluder wins over hidden targets', () => {
  const root = fixture(), targets = resolveTireTargets(root), t = targets.get('tire.front-left');
  const ray = new THREE.Raycaster(new THREE.Vector3(1.5, 0.376, -3), new THREE.Vector3(0, 0, 1));
  root.updateMatrixWorld(true);
  assert.ok(t.pickMeshes.includes(ray.intersectObject(root, true)[0].object));
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
  body.position.set(1.5, 0.376, -1.5); root.add(body); root.updateMatrixWorld(true);
  assert.equal(ray.intersectObject(root, true)[0].object, body);
});
test('tire selection, rapid switching, duplicate, back and exit never open hood or enter QR states', () => {
  const overview = transition(initialState(), { type: E.START });
  const list = transition(overview, { type: E.SELECT_AREA, id: 'tires' });
  assert.equal(list.name, S.TIRE_SELECTION); assert.equal(cameraGoal(list), 'tires');
  let s = list;
  for (const t of TIRES) {
    s = transition(s, { type: E.SELECT_TIRE, id: t.id });
    assert.equal(s.name, S.TIRE_PREVIEW); assert.equal(s.component, t.id); assert.equal(cameraGoal(s), t.id); assert.equal(hoodTarget(s), 0);
    for (const ev of [{ type: E.SELECT_TIRE, id: t.id }, { type: E.REQUEST_HANDOFF }, { type: E.HOOD_OPENED }, { type: E.SELECT_COMPONENT, id: 'washer-fluid-cap' }]) assert.equal(transition(s, ev, { handoffConfigured: true }), s);
  }
  assert.equal(transition(s, { type: E.SELECT_TIRE, id: 'unknown' }), s);
  const back = transition(s, { type: E.BACK }); assert.equal(back.name, S.TIRE_SELECTION); assert.equal(back.component, null);
  assert.equal(transition(back, { type: E.BACK }).name, S.INSPECTION_OVERVIEW);
  assert.deepEqual(transition(s, { type: E.EXIT }), initialState());
  assert.equal(transition(overview, { type: E.SELECT_TIRE, id: TIRES[0].id }).name, S.TIRE_PREVIEW);
});
test('detached panel never fabricates a PLEOS or MOCK observation or inferred value', () => {
  for (const t of TIRES) assert.deepEqual(detachedTireInfo(t.id), { vehiclePartId: t.id, label: t.label, source: null, capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', observedAt: null });
  assert.throws(() => detachedTireInfo('Wheel_0_1'));
});
test('tire cluster corners fit usable portrait landscape and wide viewports', () => {
  const size = [3.774, 0.752, 1.796], direction = new THREE.Vector3(0.22, 0.25, -1).normalize();
  for (const [width, height, panel] of [[420, 860, { side: 0, bottom: 396 }], [1600, 1000, { side: 398, bottom: 0 }], [1024, 600, { side: 398, bottom: 0 }]]) {
    const distance = boxDistance(size, direction.toArray(), 35, width, height, panel);
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 100);
    camera.position.copy(direction).multiplyScalar(distance); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const p = new THREE.Vector3(x * size[0] / 2, y * size[1] / 2, z * size[2] / 2).project(camera);
      assert.ok(Math.abs(p.x) < (width - panel.side) / width && Math.abs(p.y) < (height - panel.bottom) / height);
    }
  }
});
