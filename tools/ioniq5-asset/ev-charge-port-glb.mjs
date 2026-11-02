// PR #44 sidecar pattern: common cm triangles -> proper rotation/metres + rotated unit normals.
import {writeGlb,toGltf,dirToGltf} from '../anatomy-car/geometry-export/gltf.mjs';
export function evChargePortGlb(model) {
  const nodes=model.parts.map(p=>{
    const positions=[],normals=[],indices=[],T=p.triangles;
    for(let i=0;i<T.length;i+=9){const v=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3))),a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...n);
      for(const point of v){positions.push(toGltf(point));normals.push(dirToGltf(n.map(x=>x/len)));indices.push(indices.length);}}
    return {name:p.id,extras:p.meta,mesh:{primitives:[{positions,normals,indices,material:p.id}]}};
  });
  return writeGlb({nodes,roots:nodes.map((_,i)=>i),materials:{'ev-charge.port':{color:'#26343d',roughness:0.8},'ev-charge.flap':{color:'#82949f',roughness:0.6,metallic:0.2}},extras:{geometryConfidence:'ESTIMATED_GEOMETRY',pose:'STATIC_CLOSED_ILLUSTRATION',note:'Exterior surround and static closed flap only. Source body uncut. No socket, hinge, SDK state or opening motion.'}});
}
