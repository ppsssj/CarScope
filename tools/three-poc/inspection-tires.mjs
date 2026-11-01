// Internal vehicle-part IDs only. No SDK area enum or raw mesh name is a data contract.
export const TIRES = Object.freeze([
  { id: 'tire.front-left', label: '앞 왼쪽 타이어', node: 'Wheel_0_1', front: 1, left: 1 },
  { id: 'tire.front-right', label: '앞 오른쪽 타이어', node: 'Wheel_0_0', front: 1, left: -1 },
  { id: 'tire.rear-left', label: '뒤 왼쪽 타이어', node: 'Wheel_1_1', front: -1, left: 1 },
  { id: 'tire.rear-right', label: '뒤 오른쪽 타이어', node: 'Wheel_1_0', front: -1, left: -1 },
].map(t => Object.freeze({ ...t, status: 'preview' })));

// A detached UI is neither PLEOS nor MOCK data. Do not manufacture a tire-v1 observation.
export function detachedTireInfo(id) {
  const tire = TIRES.find(t => t.id === id);
  if (!tire) throw new Error('Unknown tire ID');
  return Object.freeze({ vehiclePartId: id, label: tire.label, source: null,
    capabilityStatus: 'UNVERIFIED', availabilityStatus: 'UNVERIFIED', observedAt: null });
}
