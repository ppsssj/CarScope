// Static schematic resting illustration only. CarScope cm, +X front / +Y left / +Z up.
import {sheet,panelStats} from './front-compartment.mjs';
import {rayDown} from './hood.mjs';
export const FRONT_WIPER_IDS=Object.freeze(['wiper.front.left','wiper.front.right']);
export const FRONT_WIPER_SOURCES=Object.freeze([
  'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf#page=16',
  'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-convenience-features.pdf#page=73',
]);
const freeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(o);};
export const FRONT_WIPER_LAYOUT=freeze([
  {id:FRONT_WIPER_IDS[0],blade:{a:[96.5,3],b:[96.5,59],width:1.6,steps:8,low:.45,high:.95},arm:{a:[107,43],b:[96.5,30],width:.8,steps:4,low:1.5,high:2.05}},
  {id:FRONT_WIPER_IDS[1],blade:{a:[96.5,-3],b:[96.5,-52],width:1.6,steps:8,low:.45,high:.95},arm:{a:[107,-37],b:[96.5,-27],width:.8,steps:4,low:1.5,high:2.05}},
]);
function xyRows(p){const dx=p.b[0]-p.a[0],dy=p.b[1]-p.a[1],len=Math.hypot(dx,dy),side=[-dy/len*p.width/2,dx/len*p.width/2];
  return Array.from({length:p.steps+1},(_,i)=>{const c=[p.a[0]+dx*i/p.steps,p.a[1]+dy*i/p.steps];return [-1,1].map(s=>c.map((x,k)=>x+s*side[k]));});}
const key=p=>p.map(x=>x.toFixed(8)).join(',');
const highest=(x,y,parts)=>{let z=null;for(const p of parts)for(let i=0;i<p.triangles.length;i+=9){const hit=rayDown(x,y,200,p.triangles.subarray(i,i+9));if(hit!==null&&(z===null||hit>z))z=hit;}return z;};
/** Surface samples belong to the external source at runtime, never baked into this module. */
export function measureFrontWiperSupport(sourceParts){
  if(!Array.isArray(sourceParts)||!sourceParts.length)throw Error('front wiper needs source meshes');
  for(const p of sourceParts)if(!p.triangles?.length||p.triangles.length%9||!p.triangles.every(Number.isFinite))throw Error('invalid source triangles');
  const glass=sourceParts.find(p=>p.name==='Body_Glass'),hood=sourceParts.find(p=>p.name==='Door_Front_0');
  if(!glass||!hood)throw Error('front wiper needs windshield and closed hood reference');
  const vertices=new Map();
  for(const p of FRONT_WIPER_LAYOUT)for(const kind of ['blade','arm'])for(const xy of xyRows(p[kind]).flat()){
    if(kind==='blade'&&highest(...xy,[glass])===null)throw Error('blade footprint outside front glass');
    const z=highest(...xy,sourceParts);if(z===null||z<90||z>140)throw Error('missing or inapplicable wiper support');vertices.set(key(xy),{xy,z});}
  return {vertices:[...vertices.values()],coordinateFrame:'CarScope cm (+X forward, +Y left, +Z up)',source:'runtime source surface samples; collision report still required'};
}
const reverse=T=>{const a=[...T];for(let i=0;i<a.length;i+=9)for(let k=0;k<3;k++)[a[i+3+k],a[i+6+k]]=[a[i+6+k],a[i+3+k]];return a;};
const bridge=(a,b)=>a.flatMap((p,i)=>{const j=(i+1)%a.length;return [...p,...a[j],...b[j],...p,...b[j],...b[i]];});
function ribbon(p,heights){
  const xy=xyRows(p),rows=height=>xy.map(row=>row.map(point=>{const z=heights.get(key(point));if(!Number.isFinite(z)||z<90||z>140)throw Error('incomplete measured wiper support');return [...point,z+height];}));
  const lo=rows(p.low),hi=rows(p.high),rim=r=>[...r.map(row=>row[0]),...r.map(row=>row[1]).reverse()];
  return Float64Array.from([...sheet(lo),...reverse(sheet(hi)),...bridge(rim(lo),rim(hi))]);
}
export function wiperBounds(parts){const stats=parts.map(panelStats),min=[0,1,2].map(k=>Math.min(...stats.map(s=>s.min[k]))),max=[0,1,2].map(k=>Math.max(...stats.map(s=>s.max[k])));return {min,max,center:min.map((v,k)=>(v+max[k])/2),size:min.map((v,k)=>max[k]-v),unit:'cm',coordinateFrame:'CarScope (+X front, +Y left, +Z up)'};}
/** Two compound static arm/blade envelopes. The omitted clamp gap is not an OEM assembly claim. */
export function buildFrontWiperGeometry({support}={}){
  if(!Array.isArray(support?.vertices))throw Error('buildFrontWiperGeometry needs measured support');
  const heights=new Map(support.vertices.map(p=>[key(p.xy),p.z]));
  const parts=FRONT_WIPER_LAYOUT.map(p=>{const blade=ribbon(p.blade,heights),arm=ribbon(p.arm,heights),triangles=Float64Array.from([...blade,...arm]),bounds=wiperBounds([{triangles}]);
    const meta={id:p.id,partId:p.id,inspectionTarget:'wiper.front',bounds,unit:'cm',coordinateFrame:bounds.coordinateFrame,geometryConfidence:'ESTIMATED_GEOMETRY',positionConfidence:'ESTIMATED_GEOMETRY',dimensionConfidence:'ESTIMATED',hingeConfidence:'UNVERIFIED',mountingConfidence:'UNVERIFIED',isSynthetic:true,source:[...FRONT_WIPER_SOURCES],pose:'STATIC_REST_ILLUSTRATION',representation:'COMPOUND_ARM_BLADE_ENVELOPES',
      note:'Authored lengths, placement, offsets and arm/blade gap, not OEM measurements. No actual pivot, clamp, linkage, sweep, service pose or wear state. Wiper ON/OFF/SERVICE must not animate this geometry or imply blade condition.'};
    return {id:p.id,name:p.id,label:p.id,group:'FrontWipers',moving:false,triangles,materials:Array(triangles.length/9).fill(p.id),palettes:Array(triangles.length/9).fill('trim'),bounds,geometryConfidence:meta.geometryConfidence,positionConfidence:meta.positionConfidence,source:[...meta.source],meta,
      components:[{kind:'blade',triangles:blade},{kind:'arm',triangles:arm}]};});
  return {parts,bounds:wiperBounds(parts),joints:[],layout:FRONT_WIPER_LAYOUT};
}
