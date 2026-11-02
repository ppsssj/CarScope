// Opt-in schematic only. CarScope cm: +X forward, +Y left, +Z up.
// Authored dimensions and placement, NOT Hyundai CAD or measured pack dimensions.
import { sheet, panelStats } from './front-compartment.mjs';
import { frunkRing } from './frunk.mjs';

export const EV_BATTERY_ID = 'ev-battery.pack';
export const EV_BATTERY_SOURCES = Object.freeze([
  'https://www.hyundai.com/worldwide/en/newsroom/detail/0000000812',
  'https://www.hyundai.news/uk/models/electrified/ioniq-5/press-kit/hyundai-ioniq-5-redefines-electric-mobility-lifestyle.html',
]);
// Fit below the reference model floor and inside both wheel envelopes.
// These are illustration parameters, not OEM dimensions or clearance specifications.
export const EV_BATTERY_LAYOUT = Object.freeze({ x0:-115, x1:90, halfY:58, z0:12, z1:22, chamfer:4 });

/** One closed outward housing envelope. No invented modules, connectors or service access. */
export function buildEvBatteryPack() {
  const p=EV_BATTERY_LAYOUT, lo=frunkRing(p,p.z0), hi=frunkRing(p,p.z1);
  const cap=r=>r.slice(1,-1).flatMap((v,i)=>[...r[0],...v,...r[i+2]]);
  const bottom=cap(lo);
  for(let i=0;i<bottom.length;i+=9) for(let k=0;k<3;k++) [bottom[i+3+k],bottom[i+6+k]]=[bottom[i+6+k],bottom[i+3+k]];
  const triangles=Float64Array.from([...bottom,...sheet([[...lo,lo[0]],[...hi,hi[0]]]),...cap(hi)]);
  const {min,max}=panelStats({triangles});
  const bounds={min,max,center:min.map((v,k)=>(v+max[k])/2),size:min.map((v,k)=>max[k]-v),unit:'cm',coordinateFrame:'CarScope (+X forward, +Y left, +Z up)'};
  const meta={id:EV_BATTERY_ID,partId:EV_BATTERY_ID,inspectionTarget:EV_BATTERY_ID,
    geometryConfidence:'ESTIMATED_GEOMETRY',positionConfidence:'ESTIMATED_GEOMETRY',dimensionConfidence:'ESTIMATED',
    existenceConfidence:'CONFIRMED',variantPlacementConfidence:'UNVERIFIED',mountingConfidence:'UNVERIFIED',
    isSynthetic:true,representation:'SCHEMATIC_HOUSING_ENVELOPE',vehicleVariant:'OpenX 2022 IONIQ 5 Long Range RWD reference; exact battery variant UNVERIFIED',
    coordinateFrame:bounds.coordinateFrame,unit:'cm',bounds,source:[...EV_BATTERY_SOURCES],
    visibility:'underfloor; normally occluded by opaque body',
    note:'Only underfloor / between-axles arrangement is supported by Hyundai sources. All dimensions, chamfers, placement and gaps are authored estimates. No OEM fit, cell count, capacity, voltage, state of charge, safety status, mounting or service procedure claim.'};
  const part={id:EV_BATTERY_ID,name:EV_BATTERY_ID,label:'EV high-voltage battery pack (estimated)',group:'EvBattery',moving:false,triangles,
    materials:Array(triangles.length/9).fill(EV_BATTERY_ID),palettes:Array(triangles.length/9).fill('doorInner'),meta};
  return {parts:[part],joints:[],bounds,layout:EV_BATTERY_LAYOUT};
}
