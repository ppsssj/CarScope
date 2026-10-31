// P3-A2.2. Our estimated geometry, not Hyundai CAD. CarScope cm, +X forward/+Y left/+Z up.
// No model surface samples: the caller supplies the shell measured from its local GLB at run time.
import { sheet, boxTriangles } from './front-compartment.mjs';
import { rotatePoints } from './hood.mjs';

export const FRUNK_SOURCES = Object.freeze([
  'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-convenience-features.pdf#page=48',
  'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf#page=3',
  'https://www.hyundaimotorgroup.com/en/story/CONT0000000000002758',
]);
export const FRUNK_LAYOUT = Object.freeze({
  top: { x0: 131, x1: 191, halfY: 23, chamfer: 3, z: 84 },
  bottom: { x0: 138, x1: 184, halfY: 18, chamfer: 3 },
  targetLitres: 57, wall: 1.2, floor: 2,
  lid: { x0: 129, x1: 193, halfY: 25, chamfer: 4, z0: 85.5, z1: 87.5 },
});
export const FRUNK_AXIS = Object.freeze({ point: [129, 0, 85.5], direction: [0, -1, 0], evidence: 'UNVERIFIED', source: 'estimated transverse rear pivot; not measured on a vehicle' });
export const FRUNK_MAX_ANGLE = 60; // SIMULATION_ONLY
export const FRUNK_MIN_HOOD = 45; // PoC sequence constraint; not an OEM interlock or safe operating instruction

// CCW chamfered rectangular ring, viewed from +Z. Distinct vertices (no seam duplication).
export function frunkRing({ x0, x1, halfY: y, chamfer: c }, z) {
  return [[x0 + c, -y, z], [x1 - c, -y, z], [x1, -y + c, z], [x1, y - c, z], [x1 - c, y, z], [x0 + c, y, z], [x0, y - c, z], [x0, -y + c, z]];
}
const reverse = (T) => { const a = [...T]; for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) [a[i + 3 + k], a[i + 6 + k]] = [a[i + 6 + k], a[i + 3 + k]]; return a; };
const bridge = (a, b) => sheet([[...a, a[0]], [...b, b[0]]]);
const cap = (ring) => ring.slice(1, -1).flatMap((p, i) => [...ring[0], ...p, ...ring[i + 2]]);
const area = (r) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** Signed closed-mesh volume, cm³. Also used independently by tests on the cavity cap. */
export function signedVolume(T) {
  let v = 0;
  for (let i = 0; i < T.length; i += 9) v += (T[i] * (T[i + 4] * T[i + 8] - T[i + 5] * T[i + 7]) + T[i + 1] * (T[i + 5] * T[i + 6] - T[i + 3] * T[i + 8]) + T[i + 2] * (T[i + 3] * T[i + 7] - T[i + 4] * T[i + 6])) / 6;
  return v;
}

const meta = (id, name, moving) => ({ id, name, geometryConfidence: 'ESTIMATED_GEOMETRY', positionConfidence: 'ESTIMATED_GEOMETRY',
  source: [...FRUNK_SOURCES], vehicleVariant: '2022 Hyundai IONIQ 5 Long Range RWD (non-NA 57 L target)', coordinateFrame: 'CarScope cm (+X forward, +Y left, +Z up)',
  isSynthetic: true, visibility: 'visible-when-hood-open', futureInteraction: moving ? 'frunk cover simulation' : 'storage cavity',
  hingeConfidence: moving ? 'UNVERIFIED' : null, note: 'Existence and nominal capacity from Hyundai; all dimensions, thicknesses, chamfers, mounting and hinge are estimates. Calculated cavity volume is not a VDA measurement.' });
function node(id, label, T, moving, palette = 'trim') {
  return { id, name: id, label, group: 'Frunk', triangles: Float64Array.from(T), materials: Array(T.length / 9).fill(id), palettes: Array(T.length / 9).fill(palette), meta: meta(id, label, moving), moving };
}

export function buildFrunk(shell) {
  const zone = shell?.zones?.find((z) => z.id === 'zone-frunk');
  if (!zone) throw Error('buildFrunk needs the measured front compartment and zone-frunk');
  const p = FRUNK_LAYOUT, t = frunkRing(p.top, p.top.z), b0 = frunkRing(p.bottom, 0);
  const mid = t.map((v, i) => [(v[0] + b0[i][0]) / 2, (v[1] + b0[i][1]) / 2, 0]);
  const depth = p.targetLitres * 1000 / ((area(t) + 4 * area(mid) + area(b0)) / 6);
  const bottomZ = p.top.z - depth, b = frunkRing(p.bottom, bottomZ);
  const outer = (r) => ({ ...r, x0: r.x0 - p.wall, x1: r.x1 + p.wall, halfY: r.halfY + p.wall });
  const ot = frunkRing(outer(p.top), p.top.z), ob = frunkRing(outer(p.bottom), bottomZ - p.floor);
  // Outer walls outward, inner walls inward, rim upward, two separate bottom surfaces.
  const tub = [...bridge(ob, ot), ...reverse(bridge(b, t)), ...bridge(ot, t), ...reverse(cap(ob)), ...cap(b)];
  const lo = frunkRing(p.lid, p.lid.z0), hi = frunkRing(p.lid, p.lid.z1);
  const lid = [...bridge(lo, hi), ...reverse(cap(lo)), ...cap(hi)];
  // A small lever at the front edge. Its feet meet the lid surface without penetrating it.
  const handle = boxTriangles([186, -5, p.lid.z1], [190, 5, p.lid.z1 + 1.2]);
  const parts = [node('frunk-tub', 'Estimated 57 L storage tub', tub, false, 'doorInner'), node('frunk-cover', 'Estimated separate cover', lid, true), node('frunk-lever', 'Estimated front release lever', handle, true, 'doorInner')];
  for (const n of parts) for (let i = 0; i < n.triangles.length; i++) {
    const k = i % 3, v = n.triangles[i];
    if (v < zone.box.min[k] || v > zone.box.max[k]) throw Error(`${n.id} outside FrunkZone`);
  }
  const cavity = Float64Array.from([...bridge(b, t), ...reverse(cap(b)), ...cap(t)]);
  return { parts, axis: FRUNK_AXIS, bottomZ, depth, cavity, cavityLitres: signedVolume(cavity) / 1000,
    // No inferred contact with the shell: mounting hardware is unmodelled. Only the lever/lid seam.
    joints: [{ part: 'frunk-lever', with: 'frunk-cover', min: [186, -5, 87.5], max: [190, 5, 87.5], why: 'lever foot on cover (estimated)' }] };
}

export function frunkPose(frunk, deg) {
  if (!Number.isFinite(deg) || deg < 0 || deg > FRUNK_MAX_ANGLE) throw RangeError('frunk angle must be 0..60 SIMULATION_ONLY degrees');
  return frunk.parts.map((p) => ({ ...p, triangles: p.moving ? rotatePoints(p.triangles, frunk.axis, deg) : Float64Array.from(p.triangles) }));
}

/** Pure sequence guard used by sliders, buttons, animations and automation. Reject, never silently move another part. */
export function frunkTransition(state, next) {
  const s = { ...state, ...next };
  if (![s.hood, s.cover].every(Number.isFinite) || s.hood < 0 || s.hood > 60 || s.cover < 0 || s.cover > FRUNK_MAX_ANGLE) return { accepted: false, reason: 'ANGLE_OUT_OF_RANGE', state };
  if (s.cover > 0 && s.hood < FRUNK_MIN_HOOD) return { accepted: false, reason: 'Close the frunk cover before lowering the hood below 45° (simulation constraint)', state };
  return { accepted: true, reason: 'SIMULATION_ONLY', state: s };
}
