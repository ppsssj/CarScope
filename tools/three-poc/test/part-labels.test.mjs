// P10 unified 3D UX: the PartLabel rules, the touch slop probes and the three highlight roles, without a GLB.
// The real-GLB page check is test/browser-part-ux-baseline.mjs (local); this file is the CI part.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {INSPECTION_PARTS,partById,partLabel} from '../inspection-parts.mjs';
import {STATES as S,EVENTS as E,initialState,transition} from '../inspection-flow.mjs';
import {
  LABELED_PARTS,LABEL_MIN_PX,LABEL_LIMIT,TOUCH_SLOP_PX,OVERVIEW_AREAS,LOCKED_RECEIVER_PHASES,SELECTION_COLOR,HINT_COLOR,
  SELECTION_RESULT_SHARE,SELECTION_INTENSITY,accentLuminance,areaEvent,hintTargets,labelPlan,layoutLabels,luminance,
  receiverLocked,selectionIntensity,touchProbes,chooseTouch,usesTouchSlop,isAreaWide,
} from '../part-labels.mjs';

const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const HOOD_MODELED=['washer-fluid-cap','coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box'];
const ctx={handoffConfigured:true,chargePortAvailable:true,wipersAvailable:true,lightsAvailable:true};
const go=(s,...events)=>events.reduce((x,e)=>transition(x,e,ctx),s);
const overview=()=>go(initialState(),{type:E.START});
const bay=()=>go(overview(),{type:E.SELECT_AREA,id:'hood'},{type:E.HOOD_OPENED});

test('labels exist only for parts with geometry, named from the registry',()=>{
  assert.deepEqual(LABELED_PARTS,INSPECTION_PARTS.filter(p=>p.geometrySource!=='NONE').map(p=>p.id));
  assert.ok(!LABELED_PARTS.includes('lcw-coolant-reservoir'),'NONE geometry gets no label and no stand-in position');
  assert.equal(LABELED_PARTS.length,18);
});

test('the hood list gives the five modeled bonnet parts one label each, with the same rule and event',()=>{
  const plan=labelPlan(bay());
  assert.equal(bay().name,S.COMPONENT_SELECTION);
  assert.deepEqual(plan.map(x=>x.id),HOOD_MODELED);
  for(const x of plan){
    assert.equal(x.text,partLabel(x.id));assert.equal(x.kind,'PART');assert.equal(x.selected,false);
    assert.deepEqual(x.event,{type:E.SELECT_COMPONENT,id:x.id});
    // The label event is the real flow event: it opens that part.
    const next=transition(bay(),x.event,ctx);
    assert.equal(next.component,x.id);
    assert.ok([S.COMPONENT_PREVIEW,S.WASHER_SELECTED].includes(next.name),x.id);
  }
});

test('a part without geometry stays reachable from the list but never gets a 3D label',()=>{
  const result=transition(bay(),{type:E.OPEN_RESULT,id:'lcw-coolant-reservoir'},ctx);
  assert.equal(result.name,S.PART_RESULT);
  assert.deepEqual(labelPlan(result),[]);
  assert.equal(partById('lcw-coolant-reservoir').geometrySource,'NONE');
});

test('in a preview the selected label comes first and sends nothing; the others select their part',()=>{
  const preview=transition(bay(),{type:E.SELECT_COMPONENT,id:'battery-12v'},ctx);
  const plan=labelPlan(preview);
  assert.equal(plan[0].id,'battery-12v');assert.equal(plan[0].selected,true);assert.equal(plan[0].event,null);
  assert.equal(plan.filter(x=>x.selected).length,1);
  for(const x of plan.slice(1))assert.equal(transition(preview,x.event,ctx).component,x.id);
});

test('every area screen labels its own modeled parts and the label event works in that screen',()=>{
  const cases=[
    [go(overview(),{type:E.SELECT_AREA,id:'tires'}),['tire.front-left','tire.front-right','tire.rear-left','tire.rear-right']],
    [go(overview(),{type:E.SELECT_AREA,id:'ev-charge',partId:'ev-charge.port'}),['ev-charge.port','ev-charge.flap']],
    [go(overview(),{type:E.SELECT_AREA,id:'wipers',partId:'wiper.front.left'}),['wiper.front.left','wiper.front.right']],
    [go(overview(),{type:E.SELECT_AREA,id:'lights',partId:'light-high-beam-left-0'}),['light-high-beam-left-0','light-low-beam-left-0','light-low-beam-right-0','light-high-beam-right-0']],
  ];
  for(const [state,ids] of cases){
    const plan=labelPlan(state);
    assert.deepEqual(plan.map(x=>x.id),ids,state.name);
    assert.ok(plan.length<=LABEL_LIMIT);
    for(const x of plan.filter(x=>x.event))assert.equal(transition(state,x.event,ctx).component,x.id,`${state.name} ${x.id}`);
  }
  const battery=go(overview(),{type:E.SELECT_AREA,id:'ev-battery'});
  assert.deepEqual(labelPlan(battery).map(x=>[x.id,x.selected,x.event]),[['ev-battery.pack',true,null]]);
});

test('the overview names areas, anchored on modeled parts, and each label opens its area like a touch does',()=>{
  const plan=labelPlan(overview());
  assert.deepEqual(plan.map(x=>x.id),OVERVIEW_AREAS.map(a=>'area:'+a.area));
  assert.ok(plan.length<=LABEL_LIMIT);
  assert.deepEqual(plan.find(x=>x.area==='hood').anchors,['hood']);
  for(const x of plan){
    for(const anchor of x.anchors){
      const next=transition(overview(),areaEvent(x,anchor),ctx);
      assert.notEqual(next.name,S.INSPECTION_OVERVIEW,`${x.area} via ${anchor}`);
      if(['ev-charge','wipers','lights'].includes(x.area))assert.equal(next.component,anchor,'opens the anchored part');
    }
  }
  // An area whose geometry is unavailable has no label.
  assert.ok(!labelPlan(overview(),{modeled:id=>!id.startsWith('light')}).some(x=>x.area==='lights'));
});

test('while a QR or phone step is live only the selected label stays, and it sends nothing',()=>{
  for(const phase of LOCKED_RECEIVER_PHASES)assert.equal(receiverLocked({phase}),true,phase);
  for(const phase of ['NOT_CONFIGURED','AUTH_FAILED','QR_EXPIRED','COMPLETED','CANCELLED','EXPIRED','FAILED','CLOSED'])assert.equal(receiverLocked({phase}),false,phase);
  assert.equal(receiverLocked(null),false);
  const preview=transition(bay(),{type:E.SELECT_COMPONENT,id:'coolant-reservoir'},ctx);
  assert.deepEqual(labelPlan(preview,{locked:true}).map(x=>[x.id,x.event]),[['coolant-reservoir',null]]);
  assert.deepEqual(labelPlan(overview(),{locked:true}),[]);
  const qr=go(bay(),{type:E.SELECT_COMPONENT,id:'washer-fluid-cap'},{type:E.REQUEST_HANDOFF});
  assert.equal(qr.name,S.MOBILE_HANDOFF_READY);
  assert.deepEqual(labelPlan(qr).map(x=>[x.id,x.event]),[['washer-fluid-cap',null]],'the QR screen offers no way to another part');
});

test('screens without a part to point at have no labels',()=>{
  for(const state of [initialState(),go(overview(),{type:E.SELECT_AREA,id:'hood'})])assert.deepEqual(labelPlan(state),[],state.name);
});

// ---- layout ---------------------------------------------------------------------------------------------------------
const W=1000,H=700,item=(id,x,y,extra={})=>({id,anchor:{x,y,inFront:true},w:90,h:30,occluded:false,selected:false,...extra});
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

test('a label is hidden with its reason when its anchor is behind, outside, under the panel or occluded',()=>{
  const panel={x:700,y:0,w:300,h:700};
  const out=layoutLabels([
    item('behind',100,100,{anchor:{x:100,y:100,inFront:false}}),item('none',0,0,{anchor:null}),
    item('left-out',-5,300),item('below',300,720),item('panel',800,300),item('occluded',300,300,{occluded:true}),
  ],{width:W,height:H,obstacles:[panel]});
  assert.deepEqual(out.map(x=>[x.id,x.shown,x.reason]),[['behind',false,'BEHIND'],['none',false,'NO_ANCHOR'],['left-out',false,'OFFSCREEN'],['below',false,'OFFSCREEN'],['panel',false,'COVERED'],['occluded',false,'OCCLUDED']]);
});

test('a selected part hidden by another mesh keeps its label, marked as occluded',()=>{
  const [x]=layoutLabels([item('sel',300,300,{occluded:true,selected:true})],{width:W,height:H});
  assert.equal(x.shown,true);assert.equal(x.occluded,true);
});

test('labels keep the 44px touch size, stay in the view, off controls, apart, and off their own part',()=>{
  const panel={x:700,y:0,w:300,h:700},top={x:0,y:0,w:1000,h:60};
  const items=[item('sel',400,300,{selected:true,w:20,h:10,box:{x:350,y:260,w:100,h:80}}),...Array.from({length:12},(_,i)=>item('p'+i,80+i*45,90+(i%4)*120,{box:{x:60+i*45,y:70+(i%4)*120,w:40,h:40}}))];
  const out=layoutLabels(items,{width:W,height:H,obstacles:[panel,top]});
  const shown=out.filter(x=>x.shown);
  assert.ok(shown.length<=LABEL_LIMIT);
  assert.equal(out[0].shown,true,'the selected label is placed first');
  assert.ok(!overlap(out[0].rect,items[0].box),'the selected label does not hide its own part');
  for(const x of shown){
    assert.ok(x.rect.w>=LABEL_MIN_PX&&x.rect.h>=LABEL_MIN_PX,x.id);
    assert.ok(x.rect.x>=0&&x.rect.y>=0&&x.rect.x+x.rect.w<=W&&x.rect.y+x.rect.h<=H,x.id);
    for(const o of [panel,top])assert.ok(!overlap(x.rect,o),x.id);
    for(const y of shown)if(y!==x)assert.ok(!overlap(x.rect,y.rect),`${x.id} ${y.id}`);
  }
  assert.ok(out.filter(x=>!x.shown).every(x=>['NO_SPACE','LIMIT','COVERED'].includes(x.reason)));
});

test('two parts at the same point get one label each or a stated reason, never two boxes on top of each other',()=>{
  const out=layoutLabels([item('a',300,300),item('b',300,300),item('c',300,300),item('d',300,300),item('e',300,300)],{width:W,height:H});
  const shown=out.filter(x=>x.shown);
  for(const x of shown)for(const y of shown)if(x!==y)assert.ok(!overlap(x.rect,y.rect));
  assert.ok(out.every(x=>x.shown||x.reason==='NO_SPACE'));
});

test('a narrow viewport still places the selected label inside the screen',()=>{
  const [x]=layoutLabels([item('sel',410,200,{selected:true,w:160,h:44})],{width:420,height:860,obstacles:[{x:0,y:464,w:420,h:396}]});
  assert.equal(x.shown,true);
  assert.ok(x.rect.x>=0&&x.rect.x+x.rect.w<=420);
});

// ---- touch ----------------------------------------------------------------------------------------------------------
test('touch probes start at the touch and widen to the 16px slop, nearest first',()=>{
  const p=touchProbes(100,200);
  assert.equal(TOUCH_SLOP_PX,16);
  assert.deepEqual(p[0],{x:100,y:200,r:0});
  for(let i=1;i<p.length;i++)assert.ok(p[i].r>=p[i-1].r);
  assert.ok(p.every(q=>Math.hypot(q.x-100,q.y-200)<=TOUCH_SLOP_PX+1e-9));
  // 16px of slop around even a 12px mesh gives a 44px target.
  assert.ok(12+2*TOUCH_SLOP_PX>=LABEL_MIN_PX);
});

// ---- highlight roles ------------------------------------------------------------------------------------------------
test('selection is cyan, the hint is neutral, and they are different colors',()=>{
  assert.equal(SELECTION_COLOR,0x3ec6e0);
  const rgb=h=>[(h>>16)&255,(h>>8)&255,h&255];
  const [r,g,b]=rgb(HINT_COLOR);
  assert.notEqual(HINT_COLOR,SELECTION_COLOR);
  assert.ok(Math.max(r,g,b)-Math.min(r,g,b)<=24,'the hint is close to grey, not a second accent');
});

test('the selection strength is scaled per material, and a result color keeps the larger share',()=>{
  const dark=selectionIntensity([0.03,0.03,0.03]),light=selectionIntensity([0.55,0.5,0.4]);
  assert.ok(dark>light,'dark materials get more glow, light ones less');
  for(const v of [dark,light])assert.ok(v>=SELECTION_INTENSITY.min&&v<=SELECTION_INTENSITY.max);
  for(const rgb of [[0.863,0.319,0.136],[0.223,0.474,0.723],[0.693,0.509,0.168],[0.12,0.13,0.15]]){
    const k=selectionIntensity(rgb,{hasResult:true});
    assert.ok(k*accentLuminance<=SELECTION_RESULT_SHARE*luminance(rgb)+1e-9||k===SELECTION_INTENSITY.min,String(rgb));
  }
});

test('the hint marks what a touch can select on the overview and lists, and nothing on a preview',()=>{
  const ids=hintTargets(overview());
  for(const id of ['hood','tire.front-left','wiper.front.left','light-low-beam-left-0','ev-charge.port'])assert.ok(ids.includes(id),id);
  assert.deepEqual(hintTargets(bay()),HOOD_MODELED);
  assert.deepEqual(hintTargets(transition(bay(),{type:E.SELECT_COMPONENT,id:'fuse-box'},ctx)),[]);
  assert.ok(!hintTargets(overview()).includes('lcw-coolant-reservoir'));
});

// ---- page wiring ----------------------------------------------------------------------------------------------------
test('the page has one label system and no washer-only label left',()=>{
  const html=read('../inspect.html'),page=read('../inspect.js');
  assert.doesNotMatch(html,/capLabel|capButton/);
  assert.doesNotMatch(page,/capLabel|capButton|washerHint/);
  assert.match(html,/id="partLabels"/);
  assert.match(page,/labelPlan\(state/);
  assert.match(page,/const slop = usesTouchSlop\(e\.pointerType\), ev = pickTarget\(e\.clientX, e\.clientY, \{ slop \}\)/,'only a finger uses the slop');
  assert.match(page,/return chooseTouch\(null, found\)/,'the page decides with the tested rule');
});

test('the list border is neutral; cyan only marks the selected row',()=>{
  const css=read('../inspect.html');
  assert.doesNotMatch(css,/\.item\.available\{border-color/);
  assert.doesNotMatch(css,/\.item\.preview/,'preview is no longer a warning color');
  assert.doesNotMatch(css,/\.item\.available \.tag\{[^}]*accent/);
  assert.match(css,/\.item\[aria-pressed="true"\]\{[^}]*border-color:var\(--accent\)/);
});

test('NOT_INSPECTED keeps the original material on every part, tires included',()=>{
  const page=read('../inspect.js');
  const sync=page.slice(page.indexOf('function syncInspectionMap()'),page.indexOf('// Local and mobile changes end here'));
  assert.doesNotMatch(sync,/M\.tires\.has/);
  assert.match(sync,/row\.status==='NOT_INSPECTED'\?resultBaseColors\.get/);
});

test('a label never covers another selectable part, so it cannot take that part\'s touch; only the selected one may when nothing else fits',()=>{
  const other={id:'other',box:{x:0,y:0,w:W,h:H}};// another part fills the screen
  const [plain]=layoutLabels([item('a',300,300,{box:{x:280,y:280,w:40,h:40}})],{width:W,height:H,targets:[other]});
  assert.equal(plain.shown,false);assert.equal(plain.reason,'NO_SPACE');
  const [sel]=layoutLabels([item('a',300,300,{selected:true})],{width:W,height:H,targets:[other]});
  assert.equal(sel.shown,true);assert.equal(sel.coversPart,true);
  const near={id:'near',box:{x:250,y:180,w:100,h:100}};
  const [x]=layoutLabels([item('a',300,300,{box:{x:280,y:290,w:40,h:20}})],{width:W,height:H,targets:[near,{id:'a',box:{x:280,y:290,w:40,h:20}}]});
  assert.equal(x.shown,true);assert.ok(!overlap(x.rect,near.box),'placed off the neighbour');assert.equal(x.coversPart,false);
});

// ---- touch decision (PR #117 review) ---------------------------------------------------------------------------------
const hood={type:E.SELECT_AREA,id:'hood'},lightArea=id=>({type:E.SELECT_AREA,id:'lights',partId:id}),tire={type:E.SELECT_TIRE,id:'tire.front-left'};
test('slop is for fingers only: mouse and pen keep the exact point',()=>{
  assert.equal(usesTouchSlop('touch'),true);
  for(const t of ['mouse','pen','',undefined])assert.equal(usesTouchSlop(t),false,String(t));
});
test('a selectable exact point always wins over anything the slop could reach',()=>{
  assert.deepEqual(chooseTouch(tire,[{r:5,event:lightArea('light-low-beam-left-0')}]),{event:tire,reason:'EXACT'});
  assert.deepEqual(chooseTouch(hood,[]),{event:hood,reason:'EXACT'},'a tap on the hood itself still opens it');
});
test('the four lamp taps that opened the hood: slop never reaches an area-wide surface',()=>{
  // P10 review: a tap beside a lamp marker hit nothing exactly; the old slop took the hood within 16px.
  assert.equal(isAreaWide(hood),true);assert.equal(isAreaWide(lightArea('light-low-beam-right-0')),false);
  assert.deepEqual(chooseTouch(null,[{r:5.3,event:hood},{r:16,event:hood}]),{event:null,reason:'AREA_ONLY'});
  // A lamp with the hood also in reach: unclear, so neither (the lamp's label or list stays the way to choose it).
  assert.deepEqual(chooseTouch(null,[{r:16,event:hood},{r:10.7,event:lightArea('light-low-beam-right-0')}]),{event:null,reason:'AMBIGUOUS'});
  // The 420x860 case: a tap aimed at a lamp with a tire and the hood in reach selects no tire.
  assert.deepEqual(chooseTouch(null,[{r:5.3,event:tire},{r:16,event:hood}]),{event:null,reason:'AMBIGUOUS'});
  assert.deepEqual(chooseTouch(null,[{r:10.7,event:lightArea('light-low-beam-right-0')}]),{event:lightArea('light-low-beam-right-0'),reason:'SLOP'},'a lamp alone in reach is selected');
});
test('two different parts within reach: nothing is chosen, the label or list decides',()=>{
  const l={type:E.SELECT_VISIBILITY_PART,id:'wiper.front.left'},r={type:E.SELECT_VISIBILITY_PART,id:'wiper.front.right'};
  assert.deepEqual(chooseTouch(null,[{r:5.3,event:l},{r:16,event:r}]),{event:null,reason:'AMBIGUOUS'});
  assert.deepEqual(chooseTouch(null,[{r:16,event:l},{r:5.3,event:l}]),{event:l,reason:'SLOP'},'one part, nearest probe');
  assert.deepEqual(chooseTouch(null,[]),{event:null,reason:'NONE'});
});
