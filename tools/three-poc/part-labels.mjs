// P10 unified 3D UX: one PartLabel rule for every modeled part. Pure, no Three.js and no DOM, so CI tests it directly.
// The page supplies what only the renderer knows (projected anchors, occlusion, element sizes, panel rectangles);
// this module decides which labels exist on a screen, which event a label sends, and where each one may be drawn.
//
// Names and IDs come from inspection-parts.mjs only. A part whose geometrySource is NONE never gets a 3D label or a
// substitute position: it stays reachable from the list. Area names come from the flow's own area list.
import {INSPECTION_PARTS,partById,partLabel} from './inspection-parts.mjs';
import {STATES as S,EVENTS as E,INSPECTION_AREAS} from './inspection-flow.mjs';

/** Smallest touch target, the same 44px the panel buttons already use. */
export const LABEL_MIN_PX=44;
/** Gap between the anchor point and the label box, kept for the leader line. */
export const LABEL_GAP_PX=14;
/** Space kept from the viewport edge and between two labels. */
export const LABEL_MARGIN_PX=8;
/** Most labels drawn on one screen. The list holds every part; the model shows a few at a time. */
export const LABEL_LIMIT=6;
/** A touch this close to a part that is really visible there still selects it. Same as the approved P10 touch rule. */
export const TOUCH_SLOP_PX=16;
/** Mobile phases while a QR or a phone inspection is live. Labels then become read-only and other parts disappear. */
export const LOCKED_RECEIVER_PHASES=Object.freeze(['AUTH_WAITING','CREATING','QR_READY','CONNECTED','RESULT_RECEIVED','AWAITING_CONFIRMATION']);
export const receiverLocked=receiver=>!!receiver&&LOCKED_RECEIVER_PHASES.includes(receiver.phase);

/** The parts that can carry a label: real geometry only, from the registry. */
export const LABELED_PARTS=Object.freeze(INSPECTION_PARTS.filter(p=>p.geometrySource!=='NONE').map(p=>p.id));
const modeledIn=area=>INSPECTION_PARTS.filter(p=>p.area===area&&p.geometrySource!=='NONE').map(p=>p.id);

// Overview labels name an area and are anchored on one of its modeled parts. The hood is the area's own surface.
export const OVERVIEW_AREAS=Object.freeze([
  Object.freeze({area:'hood',anchors:Object.freeze(['hood'])}),
  Object.freeze({area:'tires',anchors:Object.freeze(modeledIn('tires'))}),
  Object.freeze({area:'ev-charge',anchors:Object.freeze(modeledIn('ev-charge'))}),
  Object.freeze({area:'wipers',anchors:Object.freeze(modeledIn('wipers'))}),
  Object.freeze({area:'lights',anchors:Object.freeze(modeledIn('lights'))}),
]);
export const areaLabel=id=>INSPECTION_AREAS.find(a=>a.id===id)?.label.split(' · ')[0];

// Which event a part label sends from each screen: the same event a touch on that part's mesh sends there.
const PART_SCREENS=Object.freeze({
  [S.COMPONENT_SELECTION]:{area:'hood',event:E.SELECT_COMPONENT},
  [S.COMPONENT_PREVIEW]:{area:'hood',event:E.SELECT_COMPONENT},
  [S.WASHER_SELECTED]:{area:'hood',event:E.SELECT_COMPONENT},
  [S.MOBILE_HANDOFF_READY]:{area:'hood',event:null,selectedOnly:true},
  [S.TIRE_SELECTION]:{area:'tires',event:E.SELECT_TIRE},
  [S.TIRE_PREVIEW]:{area:'tires',event:E.SELECT_TIRE},
  [S.TIRE_SUMMARY]:{area:'tires',event:E.SELECT_TIRE},
  [S.CHARGE_PORT_PREVIEW]:{area:'ev-charge',event:E.SELECT_CHARGE_PART},
  [S.VISIBILITY_PREVIEW]:{area:null,event:E.SELECT_VISIBILITY_PART},
  [S.EV_BATTERY_PREVIEW]:{area:'ev-battery',event:null,selectedOnly:true},
  [S.PART_RESULT]:{area:null,event:null,selectedOnly:true},
});
const OVERVIEW_SCREENS=[S.INSPECTION_OVERVIEW,S.INSPECTION_SUMMARY];

/**
 * The labels of one screen, in priority order. `modeled(id)` says whether the page really has visible geometry for an
 * anchor now (charge port, wipers and lights can be unavailable). `locked` is true while a QR or phone step is live:
 * only the selected part keeps a label and no label sends anything, so a stray touch cannot leave that step.
 */
export function labelPlan(state,{modeled=()=>true,locked=false}={}){
  const selected=state?.component??null;
  if(OVERVIEW_SCREENS.includes(state?.name)){
    if(locked)return [];
    return OVERVIEW_AREAS.map(({area,anchors})=>({id:'area:'+area,kind:'AREA',area,anchors:anchors.filter(modeled),text:areaLabel(area),selected:false}))
      .filter(x=>x.anchors.length&&x.text)
      .map(x=>Object.freeze({...x,anchors:Object.freeze(x.anchors),event:Object.freeze({type:E.SELECT_AREA,id:x.area})}));
  }
  const screen=PART_SCREENS[state?.name];
  if(!screen)return [];
  const area=screen.area??partById(selected)?.area;
  let ids=screen.selectedOnly||locked?[selected]:INSPECTION_PARTS.filter(p=>p.area===area).map(p=>p.id);
  ids=ids.filter(id=>LABELED_PARTS.includes(id)&&modeled(id));
  return ids.map(id=>{
    const isSelected=id===selected,event=!isSelected&&!locked&&screen.event?Object.freeze({type:screen.event,id}):null;
    return Object.freeze({id,kind:'PART',area:partById(id).area,anchors:Object.freeze([id]),text:partLabel(id),selected:isSelected,event});
  }).sort((a,b)=>Number(b.selected)-Number(a.selected));
}

/** The event of an area label once its anchor is known. Parts with their own preview open there, as a touch does. */
export function areaEvent(item,anchor){
  if(item.kind!=='AREA')return item.event;
  return ['ev-charge','wipers','lights'].includes(item.area)?Object.freeze({type:E.SELECT_AREA,id:item.area,partId:anchor}):item.event;
}

const intersects=(a,b,pad=0)=>a.x<b.x+b.w+pad&&b.x<a.x+a.w+pad&&a.y<b.y+b.h+pad&&b.y<a.y+a.h+pad;
const inside=(p,r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
const within=(r,b)=>r.x>=b.x&&r.y>=b.y&&r.x+r.w<=b.x+b.w&&r.y+r.h<=b.y+b.h;

/**
 * Places labels without overlap, inside the viewport and off the panel and other controls.
 * items: [{id, parts?, anchor:{x,y,inFront}|null, box?:{x,y,w,h}, occluded, selected, w, h}] in priority order (selected
 * first). `box` is the part's own screen rectangle; a place outside it is preferred. `targets` are the screen boxes
 * ({id, box}) of every part a touch can select on this screen; a label never covers one that is not its own (`parts`).
 * Returns one entry per item: shown or the reason it is not. Reasons:
 *   NO_ANCHOR   no geometry to point at          BEHIND    the anchor is behind the camera
 *   OFFSCREEN   the anchor is outside the view   COVERED   the anchor is under the panel or a control
 *   OCCLUDED    another mesh hides the part      NO_SPACE  no free place for the box
 *   LIMIT       more labels than one screen shows
 * A selected part that is hidden by another mesh keeps its label, marked occluded, so the user still learns where it is.
 */
export function layoutLabels(items,{width,height,obstacles=[],targets=[],limit=LABEL_LIMIT,gap=LABEL_GAP_PX,margin=LABEL_MARGIN_PX}={}){
  const view={x:margin,y:margin,w:width-2*margin,h:height-2*margin},placed=[],out=[];
  for(const item of items){
    const w=Math.max(LABEL_MIN_PX,Math.ceil(item.w??0)),h=Math.max(LABEL_MIN_PX,Math.ceil(item.h??0)),a=item.anchor;
    const hide=reason=>out.push({id:item.id,shown:false,reason,anchor:a?{x:a.x,y:a.y}:null,occluded:!!item.occluded,selected:!!item.selected});
    if(!a){hide('NO_ANCHOR');continue;}
    if(a.inFront===false){hide('BEHIND');continue;}
    if(!inside(a,view)){hide('OFFSCREEN');continue;}
    if(obstacles.some(o=>inside(a,o))){hide('COVERED');continue;}
    if(item.occluded&&!item.selected){hide('OCCLUDED');continue;}
    if(placed.length>=limit){hide('LIMIT');continue;}
    const clampX=x=>Math.min(Math.max(x,view.x),view.x+view.w-w),clampY=y=>Math.min(Math.max(y,view.y),view.y+view.h-h);
    // First outside the part's own screen box, so the label never hides the part it names; then next to the anchor.
    const box=item.box;
    const outside=box?[
      ['top',{x:clampX(a.x-w/2),y:box.y-gap-h}],['bottom',{x:clampX(a.x-w/2),y:box.y+box.h+gap}],
      ['right',{x:box.x+box.w+gap,y:clampY(a.y-h/2)}],['left',{x:box.x-gap-w,y:clampY(a.y-h/2)}],
    ]:[];
    const options=[...outside,
      ['top',{x:a.x-w/2,y:a.y-gap-h}],['bottom',{x:a.x-w/2,y:a.y+gap}],
      ['right',{x:a.x+gap,y:a.y-h/2}],['left',{x:a.x-gap-w,y:a.y-h/2}],
      ['top',{x:clampX(a.x-w/2),y:a.y-gap-h}],['bottom',{x:clampX(a.x-w/2),y:a.y+gap}],
      ['right',{x:a.x+gap,y:clampY(a.y-h/2)}],['left',{x:a.x-gap-w,y:clampY(a.y-h/2)}],
      ...(box?[['top',{x:clampX(box.x+box.w-w),y:box.y-gap-h}],['top',{x:clampX(box.x),y:box.y-gap-h}],['bottom',{x:clampX(box.x+box.w-w),y:box.y+box.h+gap}],['bottom',{x:clampX(box.x),y:box.y+box.h+gap}],
        ['right',{x:box.x+box.w+gap,y:clampY(box.y)}],['right',{x:box.x+box.w+gap,y:clampY(box.y+box.h-h)}],['left',{x:box.x-gap-w,y:clampY(box.y)}],['left',{x:box.x-gap-w,y:clampY(box.y+box.h-h)}]]:[]),
    ];
    // A label is a DOM button over the canvas: over another selectable part it would take that part's touch. So it may
    // not cover another part's screen box; only the selected label may, when nothing else fits.
    const own=new Set(item.parts??[item.id]),others=targets.filter(t=>!own.has(t.id)).map(t=>t.box);
    let best=null;
    for(const strict of item.selected?[true,false]:[true]){
      for(const [placement,p] of options){
        const r={x:p.x,y:p.y,w,h};
        // The box must not cover its own anchor, another label, another shown anchor or a control.
        if(!within(r,view)||inside(a,r)||obstacles.some(o=>intersects(r,o))||placed.some(q=>intersects(r,q.rect,4)||inside(q.anchor,r)))continue;
        if(strict&&others.some(o=>intersects(r,o)))continue;
        best={placement,rect:r,coversPart:!strict};break;
      }
      if(best)break;
    }
    if(!best){hide('NO_SPACE');continue;}
    const entry={id:item.id,shown:true,reason:null,anchor:{x:a.x,y:a.y},rect:best.rect,placement:best.placement,coversPart:best.coversPart,occluded:!!item.occluded,selected:!!item.selected};
    placed.push(entry);out.push(entry);
  }
  return out;
}

/**
 * Touch points to try around a touch, nearest first: the point itself, then rings up to TOUCH_SLOP_PX. Each is a real
 * ray, so a covered part is never chosen through another mesh. chooseTouch decides from the results.
 */
export function touchProbes(x,y,slop=TOUCH_SLOP_PX){
  const out=[{x,y,r:0}];
  for(const [r,n] of [[slop/3,8],[slop*2/3,12],[slop,16]])for(let k=0;k<n;k++){const t=2*Math.PI*k/n;out.push({x:x+r*Math.cos(t),y:y+r*Math.sin(t),r});}
  return out;
}

/** The part a touch event points at: its partId (area events opened from a part) or its id. */
export const touchTargetId=ev=>ev?.partId??ev?.id??null;
/** An area-wide target such as the hood (SELECT_AREA without a part): a large surface, never reached by slop. */
export const isAreaWide=ev=>ev?.type===E.SELECT_AREA&&!ev.partId;
export const TOUCH_INPUT='touch';
/** Slop applies to finger input only. A mouse (and a pen) keeps the exact point. */
export const usesTouchSlop=pointerType=>pointerType===TOUCH_INPUT;

/**
 * Decides a touch from what the exact point and the probes around it would select. `exact` is the event at the touch
 * point (null when it selects nothing); `found` lists {r, event} for the probes within TOUCH_SLOP_PX.
 *   1. Something selectable at the exact point always wins: slop never overrides it.
 *   2. Slop reaches a part only if it is the only selectable thing within reach. Anything else in reach (another part,
 *      or an area-wide surface such as the hood) makes the intent unclear and nothing is selected; the part's 3D label
 *      or the list stays the way to choose it. A tap aimed at a lamp marker beside the hood or a tire selects neither.
 *   3. An area-wide surface alone is never reached by slop: only an exact touch opens the hood.
 * Returns {event, reason}; reason is EXACT, SLOP, AMBIGUOUS, AREA_ONLY or NONE.
 */
export function chooseTouch(exact,found=[]){
  if(exact)return {event:exact,reason:'EXACT'};
  const hits=found.filter(f=>f.event);
  if(!hits.length)return {event:null,reason:'NONE'};
  if(new Set(hits.map(f=>touchTargetId(f.event))).size>1)return {event:null,reason:'AMBIGUOUS'};
  if(isAreaWide(hits[0].event))return {event:null,reason:'AREA_ONLY'};
  return {event:hits.reduce((a,b)=>b.r<a.r?b:a).event,reason:'SLOP'};
}

// ---- Highlight roles --------------------------------------------------------------------------------------------------
// Three separate roles, so a selection never paints over a result and a hint never looks like a selection:
//   result     the material's base color (inspection-state-map colors; NOT_INSPECTED keeps the original material)
//   selection  cyan emissive scaled per material plus a cyan edge outline, only on the selected part
//   hint       a neutral, low emissive on parts that can be selected on this screen (never cyan)
export const SELECTION_COLOR=0x3ec6e0;
export const HINT_COLOR=0xd9e2ec;
/** Target luminance a selected surface reaches with its emissive, whatever its own color. Linear units. */
export const SELECTION_TARGET_LUMINANCE=0.4;
export const SELECTION_INTENSITY=Object.freeze({min:0.1,max:1});
/** At most this share of a result-colored surface may come from the selection emissive, so the result still reads. */
export const SELECTION_RESULT_SHARE=0.5;
export const luminance=([r,g,b])=>0.2126*r+0.7152*g+0.0722*b;
const ACCENT_LINEAR=Object.freeze([0x3e,0xc6,0xe0].map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}));
export const accentLuminance=luminance(ACCENT_LINEAR);

/**
 * Emissive intensity for a selected surface whose linear base color is `rgb`. Dark materials receive more and light ones
 * less, so the selected look is close on every material. A surface carrying a result color is capped so the selection
 * adds at most SELECTION_RESULT_SHARE of the result color's own luminance.
 */
export function selectionIntensity(rgb,{hasResult=false}={}){
  const base=luminance(rgb);
  let k=(SELECTION_TARGET_LUMINANCE-base)/accentLuminance;
  if(hasResult)k=Math.min(k,SELECTION_RESULT_SHARE*base/accentLuminance);
  return Math.min(SELECTION_INTENSITY.max,Math.max(SELECTION_INTENSITY.min,k));
}

/** Parts (and the hood) that carry the neutral hint on this screen: the ones a touch on the model can select here. */
export function hintTargets(state,{modeled=()=>true}={}){
  if(OVERVIEW_SCREENS.includes(state?.name))return OVERVIEW_AREAS.flatMap(x=>x.anchors).filter(id=>id==='hood'||modeled(id));
  if(state?.name===S.COMPONENT_SELECTION)return LABELED_PARTS.filter(id=>partById(id).area==='hood'&&modeled(id));
  if(state?.name===S.TIRE_SELECTION||state?.name===S.TIRE_SUMMARY)return LABELED_PARTS.filter(id=>partById(id).area==='tires'&&modeled(id));
  return [];
}
