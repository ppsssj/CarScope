// P10-2: runs in CI without the GLB. Part sizes and camera positions come from the stored real-GLB baseline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAMERA_MOVE_MS,FRAMING,cameraPath,framingDistance,framingMeasures,inflateBox,projectedBox} from '../inspection-camera.mjs';
import {INSPECTION_PARTS,partById} from '../inspection-parts.mjs';
import {STATES as S,cameraGoal} from '../inspection-flow.mjs';
import {VEHICLE_BOX,VIEWPORTS,framesInsideVehicle,withinBand} from './part-ux-metrics.mjs';

const baseline=JSON.parse(readFileSync(new URL('./part-ux-baseline.json',import.meta.url),'utf8'));
const panelFor=({width,height})=>width<700?{side:0,bottom:height*0.46}:{side:398,bottom:0};
const FOV=35;
const measured=id=>baseline.viewports['1600x1000'].preview[id];
const directionOf=p=>p.position.map((v,i)=>v-p.target[i]);
const RULE_OF={PART:'PART',MARKER:'MARKER',UNDERBODY:'UNDERBODY'};

test('every modeled part lands in its class band on all four screens',()=>{
  for(const part of INSPECTION_PARTS.filter(p=>p.cameraClass!=='NONE')){
    const m=measured(part.id),size=m.sizeCm.map(v=>Math.max(v,0.01)/100),direction=directionOf(m),rule=FRAMING[RULE_OF[part.cameraClass]];
    for(const v of VIEWPORTS){
      const panel=panelFor(v),d=framingDistance({size,direction,cameraClass:part.cameraClass,fovDeg:FOV,width:v.width,height:v.height,panel});
      const box=projectedBox(size,direction,FOV,v.height,d),usable={width:v.width-panel.side,height:v.height-panel.bottom},figures=framingMeasures(box,usable);
      assert.ok(withinBand(figures[rule.measure],rule.band),`${part.id} ${v.width}x${v.height}: ${rule.measure} ${figures[rule.measure].toFixed(1)}`);
      assert.ok(box.width<=usable.width&&box.height<=usable.height,`${part.id} ${v.width}x${v.height} fits the free screen`);
    }
  }
});

test('the same part, screen and direction always give the same distance, and a bigger part stands further back',()=>{
  const args={size:[0.18,0.164,0.18],direction:[1.2,2.8,0.55],cameraClass:'PART',fovDeg:FOV,width:1224,height:880,panel:{side:398,bottom:0}};
  assert.equal(framingDistance(args),framingDistance(args));
  assert.ok(framingDistance({...args,size:args.size.map(v=>v*2)})>framingDistance(args));
  assert.throws(()=>framingDistance({...args,cameraClass:'NONE'}),/Unknown camera class/);
});

test('an area fills its longer side, so a long group is framed without being cut off',()=>{
  const size=[3.4,0.75,1.9],direction=[0.22,0.25,-1];
  for(const v of VIEWPORTS){
    const panel=panelFor(v),d=framingDistance({size,direction,cameraClass:'AREA',fovDeg:FOV,width:v.width,height:v.height,panel});
    const m=framingMeasures(projectedBox(size,direction,FOV,v.height,d),{width:v.width-panel.side,height:v.height-panel.bottom});
    assert.ok(withinBand(m.span,FRAMING.AREA.band),`${v.width}x${v.height}: ${m.span.toFixed(1)}`);
  }
});

const OBSTACLE=inflateBox({min:[-2.3,0,-1],max:[2.3,1.62,1]},0.1);
const samples=(path,n=120)=>Array.from({length:n+1},(_,i)=>path(i/n));
const tirePositions=()=>INSPECTION_PARTS.filter(p=>p.area==='tires').map(p=>measured(p.id).position);

test('moving between any two tires never enters the vehicle box',()=>{
  const tires=tirePositions();
  assert.equal(tires.length,4);
  for(const a of tires)for(const b of tires){
    if(a===b)continue;
    assert.equal(framesInsideVehicle(samples(cameraPath(a,b,{obstacle:OBSTACLE}))),0,`${a} -> ${b}`);
  }
});

test('the check above can fail: the straight line between opposite tires does enter the box',()=>{
  const [frontLeft,frontRight]=tirePositions();
  const straight=e=>frontLeft.map((v,i)=>v+(frontRight[i]-v)*e);
  assert.ok(framesInsideVehicle(samples(straight))>0);
});

test('every move between two measured camera positions stays out of the vehicle, except next to a close-up',()=>{
  const v=baseline.viewports['1224x880'],positions=[...Object.values(v.preview),...Object.values(v.result)].filter(p=>p.position).map(p=>p.position);
  const inside=p=>p.every((x,i)=>x>VEHICLE_BOX.min[i]&&x<VEHICLE_BOX.max[i]),near=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]))<=1.05;
  for(const a of positions)for(const b of positions){
    for(const p of samples(cameraPath(a,b,{obstacle:OBSTACLE}),60))if(inside(p))assert.ok(near(p,a)||near(p,b),`${a} -> ${b} at ${p}`);
  }
});

test('both ends are exact, and a clear move stays a straight line',()=>{
  const tires=tirePositions();
  for(const a of tires)for(const b of tires){
    const path=cameraPath(a,b,{obstacle:OBSTACLE});
    assert.deepEqual(path(0),a);assert.deepEqual(path(1),b);
  }
  const from=[8,6,-4],to=[8,6,4],path=cameraPath(from,to,{obstacle:OBSTACLE});
  assert.deepEqual(path(0.5),[8,6,0]);
  assert.deepEqual(cameraPath(from,to)(0.25),[8,6,-2],'no vehicle loaded yet: straight');
});

test('a part has one camera goal on every screen, the washer included',()=>{
  for(const part of INSPECTION_PARTS.filter(p=>p.area==='hood'&&p.cameraClass!=='NONE')){
    const hoodStates=part.id==='washer-fluid-cap'?[S.WASHER_SELECTED,S.MOBILE_HANDOFF_READY]:[S.COMPONENT_PREVIEW];
    for(const name of [...hoodStates,S.PART_RESULT,S.HISTORY_LIST,S.HISTORY_DETAIL])assert.equal(cameraGoal({name,component:part.id,area:'hood'}),part.id,`${part.id} ${name}`);
  }
  assert.equal(cameraGoal({name:S.PART_RESULT,component:'lcw-coolant-reservoir',area:'hood'}),'bay','no geometry yet: the bay');
});

test('the page frames from the registry and has one move, with no washer exception left',()=>{
  const page=readFileSync(new URL('../inspect.js',import.meta.url),'utf8');
  assert.doesNotMatch(page,/name !== 'washer-fluid-cap'/);
  assert.doesNotMatch(page,/\n\s*washer: \[/,'no separate washer view');
  assert.doesNotMatch(page,/lerpVectors\(camTween\.fromPos/,'no straight-line camera position');
  assert.match(page,/partById\(name\)/);
  assert.equal(CAMERA_MOVE_MS,900);
  assert.equal(partById('light-low-beam-left-0').cameraClass,'MARKER');
});
