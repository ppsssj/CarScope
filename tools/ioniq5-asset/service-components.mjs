// P3-A2.3: estimated inspection geometry, not OEM CAD. No model-derived samples are stored here.
import { sheet, boxTriangles } from './front-compartment.mjs';
import { COORDINATE_FRAME, VEHICLE_VARIANT } from './front-compartment-layout.mjs';

export const SERVICE_MANUAL = 'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf';
export const SERVICE_EVIDENCE = Object.freeze([
  { id: 'washer-fluid-cap', name: '워셔액 주입구 캡', figure: 4, page: '9-14', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer left, rear/outboard', note: 'Washer fluid inspection/filler, not the complete hidden reservoir or pump.' },
  { id: 'coolant-reservoir', name: '냉각수 리저버', figure: 1, page: '9-12', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer left, middle/inboard' },
  { id: 'lcw-coolant-reservoir', name: '저전도 냉각수 리저버', figure: 2, page: '9-12', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer left, front/inboard' },
  { id: 'brake-fluid-reservoir', name: '브레이크액 리저버', figure: 3, page: '9-13', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer right, rear/inboard' },
  { id: 'battery-12v', name: '12V 배터리', figure: 8, page: '9-19', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer right, front/inboard' },
  { id: 'fuse-box', name: '퓨즈박스', figure: 5, page: '9-32', existence: 'CONFIRMED', placement: 'UNVERIFIED', figurePlacement:'viewer right, middle/outboard' },
]);
export const WASHER_GUIDANCE = '점검 대상: 워셔액 수위를 확인하세요. 부족하면 해당 차량·기후에 맞는 워셔액을 사용하세요. 냉각계용 냉각수·부동액을 넣지 마세요. 이 화면의 위치·형상은 추정이며 실제 차량의 캡 표기와 사용설명서를 확인하세요.';

const reverse = (T) => { const a = [...T]; for (let i=0;i<a.length;i+=9) for(let k=0;k<3;k++) [a[i+3+k],a[i+6+k]]=[a[i+6+k],a[i+3+k]]; return a; };
const cap = (r) => r.slice(1,-1).flatMap((p,i)=>[...r[0],...p,...r[i+2]]);
const bridge = (a,b) => sheet([[...a,a[0]],[...b,b[0]]]);
export function radialSolid(x,y,levels,segments=24) {
  const rings = levels.map(([z,r])=>Array.from({length:segments},(_,i)=>{const t=i/segments*2*Math.PI;return [x+r*Math.cos(t),y+r*Math.sin(t),z];}));
  return Float64Array.from([...rings.slice(1).flatMap((r,i)=>bridge(rings[i],r)),...reverse(cap(rings[0])),...cap(rings.at(-1))]);
}
function filler(x,y) {
  const levels = [[72,2.7],[84,2.7],[87.5,4.1]];
  const rings = levels.map(([z,r])=>Array.from({length:24},(_,i)=>{const t=i/24*2*Math.PI;return [x+r*Math.cos(t),y+r*Math.sin(t),z];}));
  const inner = levels.map(([z,r])=>Array.from({length:24},(_,i)=>{const t=i/24*2*Math.PI;return [x+(r-0.4)*Math.cos(t),y+(r-0.4)*Math.sin(t),z];}));
  return Float64Array.from([...rings.slice(1).flatMap((r,i)=>bridge(rings[i],r)),...inner.slice(1).flatMap((r,i)=>reverse(bridge(inner[i],r))),...bridge(rings.at(-1),inner.at(-1)),...bridge(inner[0],rings[0])]);
}
function node(id, label, T, evidence, palette='doorInner', kind='ESTIMATED') {
  return { id, name:id, label, triangles:Float64Array.from(T), materials:Array(T.length/9).fill(id), palettes:Array(T.length/9).fill(palette), meta:{
    id, name:label, geometryConfidence:kind==='UNVERIFIED'?'SYNTHETIC_DEBUG_PLACEHOLDER':'ESTIMATED_GEOMETRY', positionConfidence:'ESTIMATED_GEOMETRY', shapeConfidence:kind, existenceConfidence:evidence.existence, variantPlacementConfidence:evidence.placement,
    source:[`${SERVICE_MANUAL} (2022 UK, ONE1091001 item ${evidence.figure}; ${evidence.page})`], vehicleVariant:VEHICLE_VARIANT, coordinateFrame:COORDINATE_FRAME,
    isSynthetic:true, representation:kind==='UNVERIFIED'?'RESERVATION_ONLY':'ESTIMATED_INSPECTION_PART', evidenceContext:'2022 UK manual; exact target market/steering variant UNVERIFIED', visibility:'visible-when-hood-open', futureInteraction:'inspection target (no vehicle control)',
    note:'Dimensions/coordinates are estimates; market/steering-side match UNVERIFIED. No measured OEM shape or mounting hardware.',
  }};
}

// Stage 1 is the washer filler. Other service items remain explicit reservation geometry until researched.
export function buildServiceComponents(shell, { includeReservations=false }={}) {
  const zones = shell?.zones;
  if (!zones?.find((z)=>z.id==='zone-service-right')) throw Error('service components need the measured shell');
  const evidence=SERVICE_EVIDENCE[0], x=130,y=-48;
  const parts = [node('washer-fluid-filler','워셔액 주입구 몸체',filler(x,y),evidence),
    node('washer-fluid-cap',evidence.name,radialSolid(x,y,[[87.8,4.5],[88.4,4.8],[89.5,4.8],[90.1,4.1]]),evidence,'glass')];
  const reservations = SERVICE_EVIDENCE.slice(1).map((e,i)=>{
    const positions=[[148,-42],[170,-42],[132,42],[172,42],[152,44]], [cx,cy]=positions[i];
    const min=[cx-7,cy-7,70], max=[cx+7,cy+7,82];
    return {...node(e.id,e.name+' (예약)',boxTriangles(min,max),e,'doorInner','UNVERIFIED'),box:{min,max},reservation:true};
  });
  for (const p of [...parts,...reservations]) {
    const zone=zones.find((z)=>z.id===(p.triangles[1]<0?'zone-service-right':'zone-service-left'));
    for(let i=0;i<p.triangles.length;i++) if(p.triangles[i]<zone.box.min[i%3]||p.triangles[i]>zone.box.max[i%3]) throw Error(p.id+' outside measured service reservation');
  }
  return { parts, reservations, displayed:includeReservations?[...parts,...reservations]:parts, joints:[], guidance:WASHER_GUIDANCE };
}
