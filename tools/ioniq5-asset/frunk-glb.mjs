// External-only shell/frunk sidecar. Same geometry as SVG and browser; original GLB is never rewritten.
import { writeGlb, toGltf, dirToGltf } from '../anatomy-car/geometry-export/gltf.mjs';

export function frunkGlb(shell, frunk, deg = 0) {
  if (!Number.isFinite(deg) || deg < 0 || deg > 60) throw RangeError('frunk GLB angle 0..60');
  const point = frunk.axis.point;
  const nodeFor = (p) => {
    const positions = [], normals = [], indices = [], T = p.triangles;
    for (let i = 0; i < T.length; i += 9) {
      const vs = [0, 3, 6].map((k) => Array.from(T.slice(i+k, i+k+3)));
      const a = vs[1].map((v,k)=>v-vs[0][k]), b = vs[2].map((v,k)=>v-vs[0][k]);
      const n = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], len = Math.hypot(...n);
      for (const v of vs) { positions.push(toGltf(v.map((x,k)=>x-(p.moving ? point[k] : 0)))); normals.push(dirToGltf(n.map((x)=>x/len))); indices.push(indices.length); }
    }
    return { name: p.id, mesh: { primitives: [{ positions, normals, indices, material: p.palettes[0] }] }, extras: p.meta };
  };
  const fixed = [...shell.panels, ...frunk.parts.filter((p)=>!p.moving)].map(nodeFor);
  const moving = frunk.parts.filter((p)=>p.moving).map(nodeFor), pivotIndex = fixed.length;
  const rad = deg*Math.PI/180;
  const pivot = { name: 'frunk-cover-pivot', translation: toGltf(point), rotation: [0,0,Math.sin(rad/2),Math.cos(rad/2)], children: moving.map((_,i)=>pivotIndex+1+i), extras: { ...frunk.axis, angle: deg, angles: 'SIMULATION_ONLY', maximumAngle: 'UNVERIFIED' } };
  return writeGlb({ nodes: [...fixed, pivot, ...moving], roots: [...fixed.map((_,i)=>i), pivotIndex], materials: {
    trim: { color:'#2b2e33', roughness:0.88 }, doorInner: { color:'#4b5058', roughness:0.88 }, paint: { color:'#848b91', roughness:0.5 },
  }, extras: { note:'Estimated shell/frunk sidecar, align with the unchanged local IONIQ 5 GLB. Not Hyundai CAD; no source model geometry included.', cavityLitres:frunk.cavityLitres } });
}
