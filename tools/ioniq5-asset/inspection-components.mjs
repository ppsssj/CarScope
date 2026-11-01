// P3-A6 opt-in geometry only. Does not change the P3-A2.3 builder or inspection UI.
// All dimensions below are authored ESTIMATES in CarScope cm, never OEM measurements.
import { sheet, panelStats } from './front-compartment.mjs';
import { frunkRing } from './frunk.mjs';
import { radialSolid, SERVICE_EVIDENCE, SERVICE_MANUAL } from './service-components.mjs';
import { COORDINATE_FRAME, VEHICLE_VARIANT } from './front-compartment-layout.mjs';

export const INSPECTION_LAYOUT = Object.freeze([
  { id:'coolant-reservoir', center:[149,-43.5], size:[18,18,14], bottom:69, chamfer:3, capRadius:3.2, page:'9-12', figure:'ONE1091002', shape:'tapered chamfered tank, shoulder, separate pressure-cap silhouette' },
  { id:'brake-fluid-reservoir', center:[131,43], size:[12,14,10], bottom:73, chamfer:2, capRadius:2.6, page:'9-13', figure:'ONE1091004', shape:'small chamfered tank with upper shoulder and separate circular cap' },
  { id:'battery-12v', center:[167,44], size:[24,18,19], bottom:62, chamfer:0.8, page:'9-20', figure:'ONE1091009', shape:'rectangular case, raised lid and two separated terminal silhouettes; polarity UNVERIFIED' },
  { id:'fuse-box', center:[146,44], size:[12,18,14], bottom:69, chamfer:1.5, page:'9-32', figure:'ONE1091034', shape:'chamfered case with stepped separate cover; internal fuses omitted' },
].map(p=>Object.freeze({...p,center:Object.freeze(p.center),size:Object.freeze(p.size)})));

const reverse = T => { const a=[...T]; for(let i=0;i<a.length;i+=9) for(let k=0;k<3;k++) [a[i+3+k],a[i+6+k]]=[a[i+6+k],a[i+3+k]]; return a; };
const cap = r => r.slice(1,-1).flatMap((p,i)=>[...r[0],...p,...r[i+2]]);
// Closed, connected, outward material envelope; no concatenated intersecting boxes.
function profiledSolid(p, levels) {
  const rings=levels.map(([z,scale])=>frunkRing({x0:p.center[0]-p.size[0]*scale/2,x1:p.center[0]+p.size[0]*scale/2,halfY:p.size[1]*scale/2,chamfer:p.chamfer*scale},z).map(v=>[v[0],v[1]+p.center[1],v[2]]));
  return Float64Array.from([...reverse(cap(rings[0])),...rings.slice(1).flatMap((r,i)=>sheet([[...rings[i],rings[i][0]],[...r,r[0]]])),...cap(rings.at(-1))]);
}
function node(p,id,T,palette) {
  const evidence=SERVICE_EVIDENCE.find(e=>e.id===p.id);
  return {id,name:id,label:evidence.name+(id===p.id?'':` (${id.slice(p.id.length+1)})`),group:'InspectionComponents',triangles:T,
    materials:Array(T.length/9).fill(id),palettes:Array(T.length/9).fill(palette),moving:false,
    meta:{id,inspectionTarget:p.id,geometryConfidence:'ESTIMATED_GEOMETRY',positionConfidence:'ESTIMATED_GEOMETRY',shapeConfidence:'ESTIMATED',dimensionConfidence:'ESTIMATED',existenceConfidence:'CONFIRMED',variantPlacementConfidence:'UNVERIFIED',mountingConfidence:'UNVERIFIED',
      source:[`${SERVICE_MANUAL} (2022 UK, 9-3 ONE1091001 item ${evidence.figure}; ${p.page} ${p.figure})`],coordinateFrame:COORDINATE_FRAME,vehicleVariant:VEHICLE_VARIANT,isSynthetic:true,representation:'ESTIMATED_INSPECTION_PART',visibility:'visible-when-hood-open',
      note:'Illustrative exterior only. Authored dimensions; no OEM scale, fluid volume, live level, electrical state, polarity, mounting, hose or wiring claim. Cap/lid gaps are illustrative seams, not real assembly clearances.'}};
}

/** Add returned parts alongside existing washer parts; do not display duplicate reservations. */
export function buildInspectionComponents(shell) {
  if(!shell?.zones?.length) throw Error('inspection components need the measured shell');
  const parts=[];
  // Ordered delivery: coolant, brake fluid, 12V battery, fuse box.
  for(const p of INSPECTION_LAYOUT) {
    const z=p.bottom, top=z+p.size[2], tank=p.capRadius!==undefined;
    parts.push(node(p,p.id,profiledSolid(p,tank?[[z,0.8],[z+2,1],[top-3,1],[top,0.65]]:[[z,0.94],[z+1,1],[top,1]]),tank?'paint':'trim'));
    if(tank) parts.push(node(p,p.id+'-cap',radialSolid(...p.center,[[top+0.3,p.capRadius*0.9],[top+0.7,p.capRadius],[top+2,p.capRadius],[top+2.4,p.capRadius*0.85]],16),'trim'));
    else {
      parts.push(node(p,p.id+'-lid',profiledSolid(p,[[top+0.3,1],[top+1.2,1],[top+1.8,0.94]]),'doorInner'));
      if(p.id==='battery-12v') for(const [index,dx] of [[1,-8],[2,8]]) parts.push(node(p,`${p.id}-terminal-${index}`,radialSolid(p.center[0]+dx,p.center[1],[[top+2.1,1],[top+3.2,1]],12),'paint'));
    }
  }
  for(const part of parts) {
    const zone=shell.zones.find(z=>z.id===(part.triangles[1]<0?'zone-service-right':'zone-service-left'));
    if(!zone) throw Error('inspection components need both measured service zones');
    const stats=panelStats(part);
    for(let k=0;k<3;k++) if(stats.min[k]<zone.box.min[k]||stats.max[k]>zone.box.max[k]) throw Error(`${part.id} outside measured service zone`);
  }
  return {parts,replacesReservations:INSPECTION_LAYOUT.map(p=>p.id),joints:[],layout:INSPECTION_LAYOUT};
}
