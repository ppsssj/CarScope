// Separate generated sidecar; never copies or rewrites the source vehicle GLB.
import { writeGlb, toGltf, dirToGltf } from '../anatomy-car/geometry-export/gltf.mjs';
import { buildEvBatteryPack } from './ev-battery.mjs';

export function evBatteryGlb() {
  const nodes=buildEvBatteryPack().parts.map(p=>{
    const positions=[],normals=[],indices=[],T=p.triangles;
    for(let i=0;i<T.length;i+=9) {
      const v=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3)));
      const a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...n);
      for(const point of v) {positions.push(toGltf(point));normals.push(dirToGltf(n.map(x=>x/len)));indices.push(indices.length);}
    }
    return {name:p.id,extras:p.meta,mesh:{primitives:[{positions,normals,indices,material:'housing'}]}};
  });
  return writeGlb({nodes,roots:[0],materials:{housing:{color:'#63717c',metallic:0.25,roughness:0.7}},extras:{geometryConfidence:'ESTIMATED_GEOMETRY',note:'Opt-in estimated battery housing sidecar; no source mesh or SDK data.'}});
}
