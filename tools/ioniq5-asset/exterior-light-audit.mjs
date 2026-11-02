// Read-only geometric inventory, not a sensor mapper or a new light model.
import {partIds} from './anatomy-svg.mjs';
import {panelStats} from './front-compartment.mjs';
export function auditExteriorLights(nodes){const {ids,problems}=partIds(nodes);if(problems.length)throw Error('source part ID mismatch: '+problems.join(', '));
  return nodes.filter(p=>/^Light_|^Lamp_Housings$/.test(p.name)).map(p=>{const s=panelStats(p),T=p.triangles;let normal=null,origin=null;
    for(let i=0;i<T.length&&!normal;i+=9){const a=[0,1,2].map(k=>T[i+3+k]-T[i+k]),b=[0,1,2].map(k=>T[i+6+k]-T[i+k]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...n);if(len>1e-8){normal=n.map(x=>x/len);origin=Array.from(T.slice(i,i+3));}}
    let planar=!!normal;for(let i=0;i<T.length&&planar;i+=3)if(Math.abs(normal.reduce((v,x,k)=>v+x*(T[i+k]-origin[k]),0))>1e-4)planar=false;
    return {sourceName:p.name,partId:ids.get(p.name),triangles:s.triangles,bounds:{min:s.min,max:s.max},materials:[...new Set(p.materials)],planar,geometryKind:s.triangles===2&&planar?'PLANAR_EMITTER_MARKER':'MODELLED_LIGHT_REGION',
      note:p.name==='Lamp_Housings'?'Combined housing/trim, not a per-bulb assembly':'Source label/region only; no OEM optics or left/right sensor claim'};});}
