import * as THREE from 'three';
import { TIRES } from './inspection-tires.mjs';

/** Reuse the original rubber primitives. Validate geometry as well as names; fail closed. */
export function resolveTireTargets(root) {
  root.updateMatrixWorld(true);
  const targets = new Map(), used = new Set();
  for (const tire of TIRES) {
    const nodes = [];
    root.traverse(o => { if (o.name === tire.node) nodes.push(o); });
    if (nodes.length !== 1) throw new Error(`Ambiguous/missing wheel ${tire.id}`);
    const wheel = nodes[0], meshes = [], pickMeshes = [];
    if (wheel.parent?.name !== tire.node.replace('Wheel_', 'Grp_Wheel_Steering_Rotating_')) throw new Error(`Wheel hierarchy mismatch ${tire.id}`);
    wheel.traverse(o => {
      if (!o.isMesh) return;
      meshes.push(o);
      if (!Array.isArray(o.material) && o.material.name === 'Tire') pickMeshes.push(o);
    });
    if (pickMeshes.length !== 1 || used.has(pickMeshes[0])) throw new Error(`Ambiguous/missing rubber ${tire.id}`);
    const mesh = pickMeshes[0], bounds = new THREE.Box3().setFromObject(mesh, true);
    const c = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    // glTF +X forward, -Z left, Y up. World-space rubber diameter ~75cm; axle width ~25cm.
    if (!(c.x * tire.front > 1 && -c.z * tire.left > 0.5 && c.y > 0.2 && c.y < 0.6
      && size.x > 0.65 && size.x < 0.85 && size.y > 0.65 && size.y < 0.85
      && size.z > 0.18 && size.z < 0.35)) throw new Error(`Wheel position/shape mismatch ${tire.id}`);
    used.add(mesh);
    // Rubber highlights alone; visible rim surfaces also select this same wheel, never the far wheel.
    targets.set(tire.id, { ...tire, meshes: pickMeshes, pickMeshes: meshes, bounds });
  }
  return targets;
}

/** Approach from the vehicle's exterior side and slightly above, avoiding the body/fender. */
export function tireCameraDirection(id) {
  const t = TIRES.find(t => t.id === id);
  if (!t) throw new Error('Unknown tire ID');
  return [t.front * 0.18, 0.32, -t.left];
}
