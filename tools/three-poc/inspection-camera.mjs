// P10-2: one framing rule for every part, and camera moves that go around the vehicle. Pure math, no three.js or DOM.
// World axes are glTF metres. Directions point from the target towards the camera.
const norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export const CAMERA_MOVE_MS=900;
/** Screen share of the part's box. The checks read the bands; the distance aims at `aim`. */
export const FRAMING=Object.freeze({
  PART:Object.freeze({measure:'fill',aim:20,band:Object.freeze([15,30])}),
  UNDERBODY:Object.freeze({measure:'fill',aim:30,band:Object.freeze([20,40])}),
  MARKER:Object.freeze({measure:'width',aim:50,band:Object.freeze([40,60])}),
  AREA:Object.freeze({measure:'span',aim:70,band:Object.freeze([60,80])}),
});
const MIN_DISTANCE=0.45,MAX_FIT=0.9;

/** Size of the box on screen, in pixels, for a camera `distance` from its centre along `direction`. */
export function projectedBox(size,direction,fovDeg,height,distance){
  const d=norm(direction),forward=[-d[0],-d[1],-d[2]],right=norm(cross(forward,[0,1,0])),up=cross(right,forward),tan=Math.tan(fovDeg*Math.PI/360);
  let left=Infinity,rightEdge=-Infinity,low=Infinity,top=-Infinity;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
    const p=[size[0]/2*x,size[1]/2*y,size[2]/2*z],depth=distance-dot(p,d);
    const sx=dot(p,right)/(depth*tan)*height/2,sy=dot(p,up)/(depth*tan)*height/2;
    left=Math.min(left,sx);rightEdge=Math.max(rightEdge,sx);low=Math.min(low,sy);top=Math.max(top,sy);
  }
  return {width:rightEdge-left,height:top-low};
}
/** The figures the bands speak about. */
export function framingMeasures(box,usable){
  return {fill:100*box.width*box.height/(usable.width*usable.height),width:100*box.width/usable.width,span:100*Math.max(box.width/usable.width,box.height/usable.height)};
}

/** Camera distance that gives this class its share of the free screen and keeps the whole box visible. */
export function framingDistance({size,direction,cameraClass,fovDeg,width,height,panel}){
  const rule=FRAMING[cameraClass];
  if(!rule)throw Error('Unknown camera class');
  const usable={width:width-panel.side,height:height-panel.bottom};
  const fits=d=>{
    const box=projectedBox(size,direction,fovDeg,height,d);
    return framingMeasures(box,usable)[rule.measure]<=rule.aim&&box.width<=usable.width*MAX_FIT&&box.height<=usable.height*MAX_FIT;
  };
  let near=Math.max(MIN_DISTANCE,Math.hypot(...size)/2*1.1),far=200;
  if(fits(near))return near;
  for(let i=0;i<48;i++){const mid=(near+far)/2;if(fits(mid))far=mid;else near=mid;}
  return far;
}

/** Fit all eight AABB corners for an oblique overview, using the same usable viewport as close-ups. */
export function boxDistance(size, direction, fovDeg, width, height, panel) {
  const d = norm(direction), right = norm([d[2], 0, -d[0]]);
  const up = [d[1] * right[2], d[2] * right[0] - d[0] * right[2], -d[1] * right[0]];
  const tan = Math.tan(fovDeg * Math.PI / 360), horizontal = tan * (width - panel.side) / height, vertical = tan * (height - panel.bottom) / height;
  let distance = 1.3;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = size.map((v, i) => v / 2 * [x, y, z][i]);
    distance = Math.max(distance, dot(p, d) + Math.abs(dot(p, right)) / horizontal,
      dot(p, d) + Math.abs(dot(p, up)) / vertical);
  }
  return distance * 1.18;
}

const lerp=(a,b,t)=>a+(b-a)*t;
const inBox=(p,box)=>p.every((v,i)=>v>box.min[i]&&v<box.max[i]);
const gap=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// A close-up above the open bay may begin or end inside the vehicle's outer box. Only the stretch next to it is allowed.
const ENDPOINT_GRACE_M=1,SAMPLES=64;
function pathIsClear(at,from,to,box){
  const fromIn=inBox(from,box),toIn=inBox(to,box);
  for(let i=1;i<SAMPLES;i++){
    const p=at(i/SAMPLES);
    if(!inBox(p,box))continue;
    if((fromIn&&gap(p,from)<=ENDPOINT_GRACE_M)||(toIn&&gap(p,to)<=ENDPOINT_GRACE_M))continue;
    return false;
  }
  return true;
}
function aroundVehicle(from,to,box,turnsLong,bump,lift){
  const cx=(box.min[0]+box.max[0])/2,cz=(box.min[2]+box.max[2])/2;
  const a0=Math.atan2(from[2]-cz,from[0]-cx),a1=Math.atan2(to[2]-cz,to[0]-cx);
  let turn=a1-a0;
  if(turn>Math.PI)turn-=2*Math.PI;
  if(turn<-Math.PI)turn+=2*Math.PI;
  if(turnsLong)turn-=Math.sign(turn||1)*2*Math.PI;
  const r0=Math.hypot(from[0]-cx,from[2]-cz),r1=Math.hypot(to[0]-cx,to[2]-cz);
  return e=>{
    const swell=Math.sin(Math.PI*e),a=a0+turn*e,r=lerp(r0,r1,e)+bump*swell;
    return [cx+r*Math.cos(a),lerp(from[1],to[1],e)+lift*swell,cz+r*Math.sin(a)];
  };
}
/**
 * Position along a scripted move for eased progress e in 0..1. A straight line is kept when it stays out of `obstacle`.
 * Otherwise the camera goes around the vehicle on the first route whose samples stay clear. Both ends are always exact.
 * Sampled, so it is strong evidence and not a proof for the continuous path.
 */
export function cameraPath(from,to,{obstacle}={}){
  const straight=e=>e<=0?[...from]:e>=1?[...to]:from.map((v,i)=>lerp(v,to[i],e));
  if(!obstacle||pathIsClear(straight,from,to,obstacle))return straight;
  for(const lift of [0,0.4,0.8,1.2,1.6,2.4])for(const bump of [0,0.5,1,1.5,2,3])for(const turnsLong of [false,true]){
    const route=aroundVehicle(from,to,obstacle,turnsLong,bump,lift);
    if(pathIsClear(route,from,to,obstacle))return e=>e<=0?[...from]:e>=1?[...to]:route(e);
  }
  return straight;
}
export const inflateBox=(box,margin)=>({min:box.min.map(v=>v-margin),max:box.max.map(v=>v+margin)});
