// Opt-in static estimated exterior overlay, not a cut into or replacement for the source body.
// CarScope cm (+X forward / +Y left / +Z up). No SDK dependency or opening animation.
import {panelStats} from './front-compartment.mjs';
export const EV_CHARGE_IDS=Object.freeze({port:'ev-charge.port',flap:'ev-charge.flap'});
export const EV_CHARGE_SOURCES=Object.freeze([
  'https://sweb-owners.hyundaiusa.com/content/dam/hyundai/us/myhyundai/manuals/erg/2022/ioniq-5/Ioniq5-erg.pdf#page=4',
  'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022.pdf#page=32',
]);
const freeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(o);};
const length=Math.hypot(1,0.25);
export const EV_CHARGE_LAYOUT=freeze({
  origin:[-190,-87,98],u:[1/length,-0.25/length,0],v:[0,0,1],normal:[-0.25/length,-1/length,0],
  // CCW in (u,v); broad top and tapered bottom are illustrative, not traced OEM dimensions.
  outline:[[-8,-10],[8,-10],[15,8],[13,10],[-15,10],[-17,8]],
  apertureScale:0.88,flapScale:0.84,frameDepth:[0.2,0.55],flapDepth:[0.45,0.85],
  confidence:'ESTIMATED_GEOMETRY',pose:'STATIC_CLOSED_ILLUSTRATION',
});
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0),sub=(a,b)=>a.map((x,k)=>x-b[k]);
const local=p=>{const q=sub(p,EV_CHARGE_LAYOUT.origin);return [dot(q,EV_CHARGE_LAYOUT.u),dot(q,EV_CHARGE_LAYOUT.v),dot(q,EV_CHARGE_LAYOUT.normal)];};
// Clip in u/v, interpolating depth. This measures the exact piecewise-linear source surface,
// not a vertex-only/grid approximation which could miss a triangle crossing the footprint.
function clip(poly,axis,bound,sign) {
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=sign*(a[axis]-bound),db=sign*(b[axis]-bound);
    if(da>=0)out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((x,k)=>x+t*(b[k]-x)));}
  }
  return out;
}
function clipEdge(poly,a,b) {
  const side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),out=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=side(p),dq=side(q);
    if(dp>=0)out.push(p);
    if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push(p.map((x,k)=>x+t*(q[k]-x)));}
  }
  return out;
}
/** Runtime reference alignment. Input is every source mesh in CarScope cm; never mutates it. */
export function measureEvChargePortSupport(sourceParts) {
  if(!Array.isArray(sourceParts)||!sourceParts.length)throw Error('charge port needs source meshes in CarScope cm');
  const limits=[[-17,15],[-10,10]];let distance=-Infinity,point=null,count=0;
  for(const part of sourceParts){const T=part.triangles;
    if(!T||T.length%9||!T.every(Number.isFinite))throw Error('invalid source triangles');
    for(let i=0;i<T.length;i+=9){let polygon=[0,3,6].map(k=>local(Array.from(T.slice(i+k,i+k+3))));
      for(let k=0;k<2;k++){polygon=clip(polygon,k,limits[k][0],1);polygon=clip(polygon,k,limits[k][1],-1);}
      for(let k=0;k<EV_CHARGE_LAYOUT.outline.length;k++)polygon=clipEdge(polygon,EV_CHARGE_LAYOUT.outline[k],EV_CHARGE_LAYOUT.outline[(k+1)%EV_CHARGE_LAYOUT.outline.length]);
      for(const q of polygon)if(q[2]>distance){distance=q[2];point=q;}
      if(polygon.length)count++;
    }
  }
  if(!point)throw Error('no source surface under charge port footprint');
  // Missing right-side model or wildly different reference must not produce a floating fallback.
  if(Math.abs(distance)>10)throw Error('charge port reference alignment outside estimated 10 cm applicability domain');
  return {distance,point,clippedTriangles:count,coordinateFrame:'CarScope cm (+X forward, +Y left, +Z up)'};
}
const world=(q,d)=>EV_CHARGE_LAYOUT.origin.map((x,k)=>x+q[0]*EV_CHARGE_LAYOUT.u[k]+q[1]*EV_CHARGE_LAYOUT.v[k]+d*EV_CHARGE_LAYOUT.normal[k]);
const bridge=(a,b)=>a.flatMap((p,i)=>{const j=(i+1)%a.length;return [...p,...a[j],...b[j],...p,...b[j],...b[i]];});
const cap=r=>r.slice(1,-1).flatMap((p,i)=>[...r[0],...p,...r[i+2]]);
const reverse=T=>{const r=[...T];for(let i=0;i<r.length;i+=9)for(let k=0;k<3;k++)[r[i+3+k],r[i+6+k]]=[r[i+6+k],r[i+3+k]];return r;};
const boundsOf=parts=>{const stats=parts.map(panelStats),min=[0,1,2].map(k=>Math.min(...stats.map(s=>s.min[k]))),max=[0,1,2].map(k=>Math.max(...stats.map(s=>s.max[k])));return {min,max,center:min.map((x,k)=>(x+max[k])/2),size:min.map((x,k)=>max[k]-x),unit:'cm',coordinateFrame:'CarScope (+X forward, +Y left, +Z up)'};};

/** Requires measured support; no silent default model or guessed body placement. */
export function buildEvChargePort({support}={}) {
  if(!support||!Number.isFinite(support.distance)||Math.abs(support.distance)>10||!support.clippedTriangles)throw Error('buildEvChargePort needs measured charge port support');
  const l=EV_CHARGE_LAYOUT,ring=(scale,d)=>l.outline.map(q=>world(q.map(x=>x*scale),support.distance+d));
  const [a,b]=l.frameDepth.map(d=>ring(1,d)),[c,d]=l.frameDepth.map(z=>ring(l.apertureScale,z));
  const [e,f]=l.flapDepth.map(z=>ring(l.flapScale,z));
  const node=(id,T,palette)=>{
    const triangles=Float64Array.from(T),bounds=boundsOf([{triangles}]);
    const meta={id,partId:id,inspectionTarget:EV_CHARGE_IDS.port,bounds,unit:'cm',coordinateFrame:bounds.coordinateFrame,
      geometryConfidence:'ESTIMATED_GEOMETRY',positionConfidence:'ESTIMATED_GEOMETRY',dimensionConfidence:'ESTIMATED',
      existenceConfidence:'CONFIRMED',hingeConfidence:'UNVERIFIED',variantPlacementConfidence:'UNVERIFIED',
      source:[...EV_CHARGE_SOURCES],isSynthetic:true,pose:l.pose,
      meaning:id===EV_CHARGE_IDS.flap?'external charging door; Boolean open status may describe this closure, not an angle':'exterior charge-port surround, not a connector or charging-state indicator',
      representation:'STATIC_SURFACE_OVERLAY',visibility:'rear-right exterior; flap normally visible, surround partly occluded',
      note:'All outline, size, alignment, thickness and stand-off estimates. No OEM fit, hinge axis, socket standard, cable, pinout, electrical/safety status or opening motion. Source body remains opaque and uncut; hiding flap is inspection-only, not OPEN.'};
    return {id,name:id,label:id,group:'EvChargePort',moving:false,triangles,materials:Array(T.length/9).fill(id),palettes:Array(T.length/9).fill(palette),bounds,
      geometryConfidence:meta.geometryConfidence,positionConfidence:meta.positionConfidence,source:[...meta.source],meta};
  };
  const parts=[node(EV_CHARGE_IDS.port,[...bridge(a,b),...reverse(bridge(c,d)),...bridge(b,d),...reverse(bridge(a,c))],'trim'),
    node(EV_CHARGE_IDS.flap,[...bridge(e,f),...reverse(cap(e)),...cap(f)],'paint')];
  return {parts,bounds:boundsOf(parts),joints:[],layout:EV_CHARGE_LAYOUT};
}
