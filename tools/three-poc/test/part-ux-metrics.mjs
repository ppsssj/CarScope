// P10-0: pure rules of the part UX baseline, tested in CI. The browser check only supplies the numbers.
export const VIEWPORTS=Object.freeze([{width:1600,height:1000},{width:1224,height:880},{width:1024,height:600},{width:420,height:860}]);
export const HOOD_PARTS=Object.freeze(['washer-fluid-cap','coolant-reservoir','lcw-coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box']);
export const TIRE_PARTS=Object.freeze(['tire.front-left','tire.front-right','tire.rear-left','tire.rear-right']);
export const CHARGE_PARTS=Object.freeze(['ev-charge.port','ev-charge.flap']);
export const WIPER_PARTS=Object.freeze(['wiper.front.left','wiper.front.right']);
export const LIGHT_PARTS=Object.freeze(['light-low-beam-left-0','light-low-beam-right-0','light-high-beam-left-0','light-high-beam-right-0']);
export const BATTERY_PART='ev-battery.pack';
export const ALL_PARTS=Object.freeze([...HOOD_PARTS,...TIRE_PARTS,BATTERY_PART,...CHARGE_PARTS,...WIPER_PARTS,...LIGHT_PARTS]);

// Approximate world box of the reference vehicle in glTF metres, from the wheels and the hood. The roof tapers, so a
// frame inside it is strong evidence, not proof, of the camera being inside the body.
export const VEHICLE_BOX=Object.freeze({min:Object.freeze([-2.2,0.2,-0.9]),max:Object.freeze([2.2,1.45,0.9])});
export const insideVehicleBox=(p,box=VEHICLE_BOX)=>p.every((v,i)=>v>box.min[i]&&v<box.max[i]);
export const framesInsideVehicle=(path,box=VEHICLE_BOX)=>path.filter(p=>insideVehicleBox(p,box)).length;

export const POSE_TOLERANCE_M=0.01;
export const distanceBetween=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

/**
 * A known issue that is still open is expected and blocks nothing. A condition that starts holding without the registry
 * saying so also fails: the fix must be declared, so it cannot silently come back. A FIXED one that stops holding fails.
 */
export function classifyIssue(issue,result){
  if(!result||result.met===null||result.met===undefined)return {outcome:'NOT_MEASURED',blocking:false};
  if(issue.status==='FIXED')return result.met?{outcome:'FIXED',blocking:false}:{outcome:'REGRESSION',blocking:true};
  return result.met?{outcome:'FIXED_UNDECLARED',blocking:true}:{outcome:'KNOWN_ISSUE',blocking:false};
}

/** Compares a run with the stored baseline. Numbers within tolerance match; anything else is reported, never adjusted. */
export function compareBaseline(baseline,current,{tolerance=0.02}={},path=''){
  if(typeof baseline==='number'&&typeof current==='number')return Math.abs(baseline-current)<=tolerance?[]:[{path,baseline,current}];
  if(baseline===null||current===null||typeof baseline!=='object'||typeof current!=='object')return Object.is(baseline,current)?[]:[{path,baseline,current}];
  const keys=new Set([...Object.keys(baseline),...Object.keys(current)]),out=[];
  for(const key of keys){
    const next=path?path+'.'+key:key;
    if(!(key in baseline)||!(key in current))out.push({path:next,baseline:baseline[key],current:current[key]});
    else out.push(...compareBaseline(baseline[key],current[key],{tolerance},next));
  }
  return out;
}

export const withinBand=(value,[low,high])=>value>=low&&value<=high;
export const spread=values=>values.length?Math.max(...values)-Math.min(...values):0;
const UNIT_WORDS=/\b(?:ESTIMATED_GEOMETRY|USER_REPORTED|UNVERIFIED|DETACHED|SOURCE_OCCLUDED|COMMUNITY_MARKER[A-Z_]*)\b/g;
export const internalWords=text=>[...new Set(String(text).match(UNIT_WORDS)??[])].sort();
/** Smallest touch target the project already uses for buttons. */
export const MIN_TOUCH_PX=44;
