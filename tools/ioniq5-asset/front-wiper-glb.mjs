import {writeGlb,toGltf,dirToGltf} from '../anatomy-car/geometry-export/gltf.mjs';
export function frontWiperGlb(model){const nodes=model.parts.map(p=>{const positions=[],normals=[],indices=[],T=p.triangles;
  for(let i=0;i<T.length;i+=9){const v=[0,3,6].map(k=>Array.from(T.slice(i+k,i+k+3))),a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...n);
    for(const point of v){positions.push(toGltf(point));normals.push(dirToGltf(n.map(x=>x/len)));indices.push(indices.length);}}
  return {name:p.id,extras:p.meta,mesh:{primitives:[{positions,normals,indices,material:'wiper'}]}};});
  return writeGlb({nodes,roots:[0,1],materials:{wiper:{color:'#414b54',roughness:.8,metallic:.15}},extras:{pose:'STATIC_REST_ILLUSTRATION',geometryConfidence:'ESTIMATED_GEOMETRY',note:'Estimated front arm/blade envelopes only; no source geometry or SDK data.'}});
}
