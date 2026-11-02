import * as THREE from 'three';
import { sourceWorldParts } from './charge-port-model.mjs';
import {WIPER_PARTS,LIGHT_PARTS} from './visibility-parts.mjs';
export {WIPER_PARTS,LIGHT_PARTS} from './visibility-parts.mjs';
// The audited source's visible smoked lens transmits the marker. Opaque body/housing still wins.
export function nearestInspectionHit(hits){
  return hits.find(h=>{if(!h.object.isMesh)return false;for(let n=h.object;n;n=n.parent)if(!n.visible)return false;
    const m=h.object.material;return !(m?.name==='Lens_Smoked'&&m.transparent===true&&m.opacity===0.25);
  });
}
export function lightSightline(root,target){
  const bounds=new THREE.Box3().setFromObject(root,true),center=target.bounds.getCenter(new THREE.Vector3()),ray=new THREE.Raycaster();
  const directions=[[2,.4,-target.side*.35],[1,0,-target.side*.1],[.5,-.3,-target.side],[.2,-.5,-target.side],[.8,-.7,-target.side],[.2,0,-target.side],[.2,.6,-target.side],[1,-.8,-target.side*.3],[1,1,-target.side*.3]];
  for(const d of directions){const direction=new THREE.Vector3(...d).normalize(),from=center.clone().addScaledVector(direction,.85);if(bounds.containsPoint(from))continue;ray.set(from,center.clone().sub(from).normalize());const hit=nearestInspectionHit(ray.intersectObject(root,true));if(hit&&target.meshes.includes(hit.object))return {direction:d,status:'EXTERIOR_SIGHTLINE'};}
  return {direction:directions[0],status:'SOURCE_OCCLUDED'};
}
/** Preserve all original triangles, grouped by their original GLB mesh node names for A's builder. */
export function sourcePartsByNode(root,nodeNames){
  const groups=new Map();
  for(const p of sourceWorldParts(root,mesh=>{for(let n=mesh;n;n=n.parent)if(nodeNames.has(n.name))return n.name;throw Error('UNVERIFIED_SOURCE_HIERARCHY');})){
    if(!groups.has(p.name))groups.set(p.name,[]);groups.get(p.name).push(p.triangles);
  }
  return [...groups].map(([name,arrays])=>{const triangles=new Float64Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){triangles.set(a,offset);offset+=a.length;}return {name,triangles};});
}
/** Original planar markers only. Never relabel the combined front/rear Lamp_Housings as one bulb. */
export function resolveFrontLightTargets(root){
  root.updateMatrixWorld(true);const targets=new Map(),used=new Set();
  for(const spec of LIGHT_PARTS){
    const nodes=[];root.traverse(o=>{if(o.name===spec.node)nodes.push(o);});if(nodes.length!==1)throw Error('AMBIGUOUS_LIGHT_NODE');
    const meshes=[];nodes[0].traverse(o=>{if(o.isMesh)meshes.push(o);});
    if(meshes.length!==1||used.has(meshes[0]))throw Error('AMBIGUOUS_LIGHT_MARKER');
    const mesh=meshes[0],g=mesh.geometry,count=g.index?.count??g.attributes.position?.count;
    const bounds=new THREE.Box3().setFromObject(mesh,true),c=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    if(count!==6||mesh.material.name!=='Lamp_Projector'||!mesh.material.emissive||!Number.isFinite(mesh.material.emissiveIntensity)||c.x<1.5||c.x>2.4||-c.z*spec.side<0.3||-c.z*spec.side>1||size.length()>0.6)throw Error('UNVERIFIED_LIGHT_MARKER_GEOMETRY');
    used.add(mesh);targets.set(spec.id,{...spec,meshes,bounds,geometryConfidence:'COMMUNITY_MARKER_UNVERIFIED_OEM_OPTICS'});
  }
  return targets;
}
export function visibilityFeaturesForPart(id){
  if(WIPER_PARTS.includes(id))return ['wiper.front.state'];const light=LIGHT_PARTS.find(p=>p.id===id);if(light)return [light.feature];throw Error('UNKNOWN_VISIBILITY_PART');
}
