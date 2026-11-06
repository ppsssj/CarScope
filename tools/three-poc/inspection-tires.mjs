// Internal vehicle-part IDs only. No SDK area enum or raw mesh name is a data contract.
import { partLabel } from './inspection-parts.mjs';
export const TIRES = Object.freeze([
  { id: 'tire.front-left', node: 'Wheel_0_1', front: 1, left: 1 },
  { id: 'tire.front-right', node: 'Wheel_0_0', front: 1, left: -1 },
  { id: 'tire.rear-left', node: 'Wheel_1_1', front: -1, left: 1 },
  { id: 'tire.rear-right', node: 'Wheel_1_0', front: -1, left: -1 },
].map(t => Object.freeze({ ...t, label: partLabel(t.id), status: 'preview' })));

// A detached UI is neither PLEOS nor MOCK data. Do not manufacture a tire-v1 observation.
export function detachedTireInfo(id) {
  const tire = TIRES.find(t => t.id === id);
  if (!tire) throw new Error('Unknown tire ID');
  return Object.freeze({ vehiclePartId: id, label: tire.label, source: null,
    capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', observedAt: null });
}
