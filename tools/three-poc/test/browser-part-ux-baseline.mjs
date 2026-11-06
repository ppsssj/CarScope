// P10-0: the 3D part UX on the real reference GLB in real Chrome, local only because the GLB is not in the repository.
// Reads the page through its existing test hooks and real pointer input. Changes no product behavior.
//   CARSCOPE_3D_TEST_URL=http://127.0.0.1:8098/inspect.html?capture=1 CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p10/... npm run test:part-ux-baseline
//   CARSCOPE_P10_WRITE_BASELINE=1 stores the measured numbers as the new baseline. Do that only for an intended change.
// Exit 1: a regression, an undeclared fix, a baseline drift or a page error. Open known issues never fail the run.
// Desktop Chrome. AVD, Android WebView, real touch and phone are NOT_RUN here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PART_UX_ISSUES} from './part-ux-known-issues.mjs';
import {ALL_PARTS,BATTERY_PART,CHARGE_PARTS,FRAMING_BANDS,HOOD_PARTS,LIGHT_PARTS,MIN_TOUCH_PX,POSE_TOLERANCE_M,TIRE_PARTS,VIEWPORTS,WIPER_PARTS,classifyIssue,compareBaseline,distanceBetween,framesInsideVehicle,internalWords,spread,withinBand} from './part-ux-metrics.mjs';

const require=createRequire(new URL('../../mobile-ar-poc/package.json',import.meta.url)),{chromium}=require('playwright');
const out=process.env.CARSCOPE_EVIDENCE_DIR,url=process.env.CARSCOPE_3D_TEST_URL;
if(!out||!path.isAbsolute(out)||!path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external CARSCOPE_EVIDENCE_DIR');
if(!url)throw Error('Set CARSCOPE_3D_TEST_URL: this check needs the real reference GLB');
await mkdir(out,{recursive:true});
const BASELINE=fileURLToPath(new URL('./part-ux-baseline.json',import.meta.url));
const REAL='createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()})';
const RESULT_PARTS=ALL_PARTS.filter(x=>x!==BATTERY_PART&&x!=='ev-charge.flap');
const round=(v,d=3)=>+v.toFixed(d);
const key=v=>`${v.width}x${v.height}`;

function pageTools(page){
  const settle=async()=>{await page.waitForFunction(()=>!window.__inspect.busy,null,{timeout:30000});await page.waitForTimeout(90);};
  const dispatch=e=>page.evaluate(e=>window.__inspect.dispatch(e),e);
  const state=()=>page.evaluate(()=>{const s=window.__inspect.state;return {name:s.name,component:s.component??null,area:s.area??null};});
  const until=name=>page.waitForFunction(n=>window.__inspect.state.name===n,name,{timeout:30000});
  const pose=()=>page.evaluate(()=>window.__inspect.cameraPose());
  const toOverview=async()=>{
    for(let i=0;i<8;i++){const s=await state();if(s.name==='INSPECTION_OVERVIEW')break;await dispatch({type:s.name==='IDLE'?'START':'BACK'});await page.waitForTimeout(30);await settle();}
    await until('INSPECTION_OVERVIEW');await settle();
  };
  return {settle,dispatch,state,until,pose,toOverview};
}

// What a touch at each cell of the part's screen box would select now, plus the pixels the page draws there.
const scanPart=(page,id,cells=15)=>page.evaluate(({id,cells})=>{
  const I=window.__inspect,pose=I.cameraPose(),view=I.view();
  const comp=I.componentInfo().find(c=>c.id===id),tire=I.tireInfo().find(t=>t.id===id),b=comp?.bounds??tire?.bounds;
  const panelBox=document.getElementById('panel').getBoundingClientRect();
  const out={distance:view.distance,azimuth:view.azimuthDeg,polar:view.polarDeg,position:pose.position,target:pose.target};
  if(!b||!Number.isFinite(b.min[0]))return {...out,bounds:null};
  const sub=(a,c)=>a.map((v,i)=>v-c[i]),dot=(a,c)=>a[0]*c[0]+a[1]*c[1]+a[2]*c[2],cross=(a,c)=>[a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0]],norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
  const f=norm(sub(pose.target,pose.position)),r=norm(cross(f,[0,1,0])),u=cross(r,f),T=Math.tan(35*Math.PI/360),W=innerWidth,H=innerHeight;
  const wide=panelBox.width<W*0.7,side=wide?panelBox.width+18:0,bottom=wide?0:Math.min(H*0.46,panelBox.height);
  const project=p=>{const v=sub(p,pose.position),z=dot(v,f);return {x:W/2+(dot(v,r)/(z*T))*(H/2)-side/2,y:H/2-(dot(v,u)/(z*T))*(H/2)-bottom/2};};
  const corners=[];for(const x of [b.min[0],b.max[0]])for(const y of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]])corners.push(project([x,y,z]));
  const left=Math.min(...corners.map(c=>c.x)),right=Math.max(...corners.map(c=>c.x)),top=Math.min(...corners.map(c=>c.y)),low=Math.max(...corners.map(c=>c.y));
  const usableW=W-side,usableH=H-bottom,cellW=(right-left)/cells,cellH=(low-top)/cells;
  const canvas=document.querySelector('#view canvas'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
  const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);const scale=canvas.width/W;
  const hits={};let mine=0,outside=0;const rows=new Map(),columns=new Map(),rgb=[0,0,0],hitCells=[];
  for(let i=0;i<cells;i++)for(let j=0;j<cells;j++){
    const x=left+cellW*(i+.5),y=top+cellH*(j+.5);
    if(x<0||y<0||x>usableW||y>usableH){outside++;continue;}
    const hit=I.hitAt(x,y),name=hit?(hit.id??hit.kind):'none';hits[name]=(hits[name]||0)+1;
    if(name===id||(id==='washer-fluid-cap'&&name==='washer')){
      mine++;rows.set(j,(rows.get(j)||0)+1);columns.set(i,(columns.get(i)||0)+1);hitCells.push([Math.round(x),Math.round(y)]);
      const d=ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data;for(let k=0;k<3;k++)rgb[k]+=d[k];
    }
  }
  const color=mine?rgb.map(v=>v/mine):null;
  return {...out,sizeCm:b.max.map((v,i)=>(v-b.min[i])*100),screenW:right-left,screenH:low-top,
    fillPercent:100*(right-left)*(low-top)/(usableW*usableH),centerOffset:[(left+right)/2-usableW/2,(top+low)/2-usableH/2],outsideCells:outside,hits,mineCells:mine,
    touchPx:[Math.max(0,...[...rows.values()])*cellW,Math.max(0,...[...columns.values()])*cellH],hitCells:hitCells.slice(0,40),
    color,meshes:comp?comp.meshes.length:tire.meshes.length,highlightedMeshes:comp?comp.meshes.filter(m=>m.highlighted).length:tire.meshes.filter(m=>m.highlighted).length,selectionIntensity:tire?tire.meshes[0]?.selectionIntensity??null:null};
},{id,cells});

const panelFacts=page=>page.evaluate(()=>{
  const panel=document.getElementById('panel'),label=document.getElementById('capLabel'),h2=panel.querySelector('h2'),toast=document.getElementById('toast');
  const css=h2&&getComputedStyle(h2),box=panel.getBoundingClientRect(),toastBox=toast.getBoundingClientRect();
  return {text:panel.innerText,badge:panel.querySelector('.badge')?.textContent??null,
    backButtons:[...panel.querySelectorAll('[data-action="back"]')].map(b=>b.textContent.trim()),
    label:getComputedStyle(label).display!=='none'&&label.dataset.hidden===undefined,
    focusOutline:h2&&document.activeElement===h2?parseFloat(css.outlineWidth)>0&&css.outlineStyle!=='none':false,
    hasMobile:!!panel.querySelector('[data-action="request-mobile"]'),
    toastCenter:toastBox.left+toastBox.width/2,panelLeft:box.left,panelWidth:box.width};
});

const simplifyScan=s=>{
  if(s.bounds===null)return {distance:round(s.distance),polar:round(s.polar,1),azimuth:round(s.azimuth,1),position:s.position.map(v=>round(v)),target:s.target.map(v=>round(v)),bounds:null};
  return {distance:round(s.distance),azimuth:round(s.azimuth,1),polar:round(s.polar,1),position:s.position.map(v=>round(v)),target:s.target.map(v=>round(v)),sizeCm:s.sizeCm.map(v=>round(v,1)),
    screenPx:[Math.round(s.screenW),Math.round(s.screenH)],fillPercent:round(s.fillPercent,1),centerOffsetPx:s.centerOffset.map(v=>Math.round(v)),mineCells:s.mineCells,touchPx:s.touchPx.map(v=>Math.round(v)),
    meshes:s.meshes,highlightedMeshes:s.highlightedMeshes};
};

async function enterPreview(page,t,id){
  await t.toOverview();
  if(HOOD_PARTS.includes(id)){await t.dispatch({type:'SELECT_AREA',id:'hood'});await t.until('COMPONENT_SELECTION');await t.settle();return await t.dispatch({type:'SELECT_COMPONENT',id});}
  if(TIRE_PARTS.includes(id)){await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.settle();return await t.dispatch({type:'SELECT_TIRE',id});}
  if(id===BATTERY_PART)return await t.dispatch({type:'SELECT_AREA',id:'ev-battery'});
  if(CHARGE_PARTS.includes(id))return await t.dispatch({type:'SELECT_AREA',id:'ev-charge',partId:id});
  if(WIPER_PARTS.includes(id))return await t.dispatch({type:'SELECT_AREA',id:'wipers',partId:id});
  return await t.dispatch({type:'SELECT_AREA',id:'lights',partId:id});
}

/** Real pointer input on the first cell that resolves to this part. */
async function clickPart(page,t,scan,id){
  const cell=scan.hitCells?.[Math.floor((scan.hitCells.length-1)/2)];
  if(!cell)return {clickable:false,selected:false};
  await page.mouse.click(cell[0],cell[1]);await page.waitForTimeout(60);await t.settle();
  const s=await t.state();return {clickable:true,selected:s.component===id,state:s.name};
}

async function measureViewport(browser,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  const t=pageTools(page),shots=path.join(out,key(viewport));await mkdir(shots,{recursive:true});
  const shot=name=>page.screenshot({path:path.join(shots,name+'.png')});
  await page.goto(url);await page.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});await t.settle();
  const R={home:{},overview:{},preview:{},result:{},flows:{},geometry:{}};
  R.home.view=await page.evaluate(()=>window.__inspect.view());await shot('home');
  R.geometry.idle={charge:await page.evaluate(()=>window.__inspect.chargeGeometry().visible),wiperHits:(await scanPart(page,WIPER_PARTS[0],11)).mineCells};
  await t.dispatch({type:'START'});await t.until('INSPECTION_OVERVIEW');await t.settle();await shot('overview');
  R.home.overview=await page.evaluate(()=>window.__inspect.view());
  const overviewFacts=await panelFacts(page);R.overviewFacts={text:/강조된 부위/.test(overviewFacts.text),legendTires:/타이어 4개/.test(overviewFacts.text),toastCenter:Math.round(overviewFacts.toastCenter),usableCenter:Math.round(overviewFacts.panelLeft>viewport.width*.3?overviewFacts.panelLeft/2:viewport.width/2),
    batteryTag:await page.evaluate(()=>document.querySelector('[data-action="area"][data-id="ev-battery"] .tag')?.textContent??null)};
  R.geometry.overview={charge:await page.evaluate(()=>window.__inspect.chargeGeometry().visible),wiperHits:(await scanPart(page,WIPER_PARTS[0],11)).mineCells};
  for(const id of ALL_PARTS){const s=await scanPart(page,id,11);R.overview[id]={mineCells:s.mineCells??0,touchPx:(s.touchPx??[0,0]).map(v=>Math.round(v)),highlightedMeshes:s.highlightedMeshes??0};}
  await page.waitForTimeout(40);

  // ---- every part, list route and real pointer route, then Back
  for(const id of ALL_PARTS){
    const entered=await enterPreview(page,t,id);
    if(!entered||['COMPONENT_SELECTION'].includes((await t.state()).name)){R.preview[id]={selectable:false,state:(await t.state()).name};continue;}
    await t.settle();
    const scan=await scanPart(page,id),facts=await panelFacts(page),current=await t.state();
    await shot('preview-'+id);
    const entry={selectable:true,state:current.name,...simplifyScan(scan),color:scan.color?.map(v=>Math.round(v))??null,selectionIntensity:scan.selectionIntensity,
      label:facts.label,badge:facts.badge,backButtons:facts.backButtons,focusOutline:facts.focusOutline,hasMobile:facts.hasMobile,noProcedureText:/아직 제공하지 않음/.test(facts.text),internalWords:internalWords(facts.text)};
    const before=await t.pose();
    await t.dispatch({type:'BACK'});await page.waitForTimeout(30);await t.settle();
    entry.backTo=(await t.state()).name;entry.backPoseMoved=round(distanceBetween((await t.pose()).position,before.position));
    R.preview[id]=entry;
  }

  // ---- 3D selection from each part's natural parent view
  R.select3d={};
  for(const id of ALL_PARTS){
    await t.toOverview();
    if(HOOD_PARTS.includes(id)){await t.dispatch({type:'SELECT_AREA',id:'hood'});await t.until('COMPONENT_SELECTION');}
    else if(TIRE_PARTS.includes(id)){await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');}
    await t.settle();
    const scan=await scanPart(page,id,11);
    R.select3d[id]={...(await clickPart(page,t,scan,id)),touchPx:(scan.touchPx??[0,0]).map(v=>Math.round(v)),fromState:HOOD_PARTS.includes(id)?'COMPONENT_SELECTION':TIRE_PARTS.includes(id)?'TIRE_SELECTION':'INSPECTION_OVERVIEW'};
  }

  // ---- result route for the 17 result parts
  for(const id of RESULT_PARTS){
    await t.toOverview();await t.dispatch({type:'OPEN_RESULT',id});await t.until('PART_RESULT');await t.settle();await page.waitForTimeout(30);await t.settle();
    const scan=await scanPart(page,id);
    if(['washer-fluid-cap','lcw-coolant-reservoir','coolant-reservoir'].includes(id))await shot('result-'+id);
    const entry={...simplifyScan(scan),hood:round(await page.evaluate(()=>window.__inspect.hoodAngle),1)};
    await t.dispatch({type:'BACK'});await page.waitForTimeout(30);await t.settle();await page.waitForTimeout(30);await t.settle();
    entry.backTo=(await t.state()).name;R.result[id]=entry;
  }

  // ---- flows
  const F=R.flows;
  await t.toOverview();await t.dispatch({type:'SELECT_AREA',id:'hood'});await t.until('COMPONENT_SELECTION');await t.settle();await shot('bay');
  F.bayLabel=(await panelFacts(page)).label;
  await t.dispatch({type:'OPEN_RESULT',id:'lcw-coolant-reservoir'});await t.until('PART_RESULT');await t.settle();await t.dispatch({type:'BACK'});await page.waitForTimeout(30);await t.settle();await page.waitForTimeout(30);await t.settle();
  F.resultBackFromList=(await t.state()).name;

  // Tire list reached two ways
  await t.toOverview();const overviewPose=await t.pose();
  await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.settle();
  const direct=await page.evaluate(()=>window.__inspect.view());
  R.geometry.tires={charge:await page.evaluate(()=>window.__inspect.chargeGeometry().visible)};
  await t.toOverview();await t.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});await t.settle();await t.dispatch({type:'BACK'});await t.until('TIRE_SELECTION');await t.settle();
  const viaTire=await page.evaluate(()=>window.__inspect.view());
  F.tireList={directDistance:round(direct.distance),viaTireDistance:round(viaTire.distance),viaTireAtOverviewPose:distanceBetween((await t.pose()).position,overviewPose.position)<POSE_TOLERANCE_M};

  // Cross-area touch from a tire preview
  await t.toOverview();await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.settle();await t.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});await t.settle();
  F.crossArea=await page.evaluate(()=>{
    const I=window.__inspect,W=innerWidth,H=innerHeight,panel=document.getElementById('panel').getBoundingClientRect(),right=panel.width<W*.7?panel.left:W,low=panel.width<W*.7?H:panel.top;
    for(let x=20;x<right-20;x+=18)for(let y=70;y<low-20;y+=18){const h=I.hitAt(x,y);if(h&&['hood','visibility','charge','component'].includes(h.kind))return {x,y,kind:h.kind};}
    return null;});
  if(F.crossArea){await page.mouse.click(F.crossArea.x,F.crossArea.y);await page.waitForTimeout(60);await t.settle();const s=await t.state();F.crossArea={kind:F.crossArea.kind,changed:s.component!=='tire.front-left'||s.name!=='TIRE_PREVIEW'};}

  // Empty and non-selectable touch, drag and input during a camera move, in today's form (all keep the screen)
  const emptyCell=()=>page.evaluate(()=>{
    const I=window.__inspect,W=innerWidth,H=innerHeight,panel=document.getElementById('panel').getBoundingClientRect(),right=panel.width<W*.7?panel.left:W,low=panel.width<W*.7?H:panel.top,found={};
    for(let x=24;x<right-24;x+=24)for(let y=80;y<low-24;y+=24){const h=I.hitAt(x,y),k=h?h.kind:'none';if((k==='none'||k==='other')&&!found[k])found[k]={x,y};}
    return found;});
  const previewStates=[['COMPONENT_PREVIEW','coolant-reservoir'],['WASHER_SELECTED','washer-fluid-cap'],['TIRE_PREVIEW','tire.front-left'],['CHARGE_PORT_PREVIEW','ev-charge.flap'],['VISIBILITY_PREVIEW','wiper.front.left'],['VISIBILITY_PREVIEW','light-low-beam-left-0'],['EV_BATTERY_PREVIEW',BATTERY_PART]];
  F.emptyTouch={};
  for(const [name,id] of previewStates){
    await enterPreview(page,t,id);await t.settle();
    const cells=await emptyCell(),seen={};
    for(const kind of ['none','other']){
      if(!cells[kind]){seen[kind]='NO_SUCH_AREA';continue;}
      await page.mouse.click(cells[kind].x,cells[kind].y);await page.waitForTimeout(40);
      const s=await t.state();seen[kind]=s.name===name&&s.component===id?'KEPT':'LEFT:'+s.name;
    }
    const from=await t.pose();
    const box=await page.evaluate(()=>{const p=document.getElementById('panel').getBoundingClientRect();return p.width<innerWidth*.7?[p.left/2,innerHeight/2]:[innerWidth/2,p.top/2];});
    await page.mouse.move(box[0],box[1]);await page.mouse.down();await page.mouse.move(box[0]+60,box[1]+10,{steps:4});await page.mouse.up();await page.waitForTimeout(200);
    const s=await t.state();seen.drag=s.name===name&&s.component===id?'KEPT':'LEFT:'+s.name;seen.dragRotated=distanceBetween((await t.pose()).position,from.position)>POSE_TOLERANCE_M;
    F.emptyTouch[`${name}:${id}`]=seen;
  }
  F.backLabels=[...new Set(Object.values(R.preview).flatMap(p=>p.backButtons??[]))].sort();
  F.pinch='NOT_RUN: desktop pointer input only';F.realTouch='NOT_RUN: desktop pointer input only';
  R.errors=errors;
  await context.close();
  return R;
}

// ---- Camera path: normal motion, so the frames the user would see are sampled.
async function measurePaths(browser,viewport){
  const context=await browser.newContext({viewport}),page=await context.newPage(),t=pageTools(page),shots=path.join(out,key(viewport));
  await mkdir(shots,{recursive:true});
  await page.goto(url);await page.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});await t.settle();
  const sample=async(event,shotName)=>{
    await page.evaluate(()=>{window.__p=[];window.__on=true;const f=()=>{if(!window.__on)return;window.__p.push(window.__inspect.cameraPose().position);requestAnimationFrame(f);};requestAnimationFrame(f);});
    await t.dispatch(event);
    if(shotName){await page.waitForTimeout(520);await page.screenshot({path:path.join(shots,shotName+'.png')});}
    await page.waitForTimeout(120);await t.settle();
    const p=await page.evaluate(()=>{window.__on=false;return window.__p;});
    return {frames:p.length,inside:framesInsideVehicle(p),belowFloor:p.filter(x=>x[1]<0.05).length};
  };
  const R={tires:{},other:{}};
  await t.dispatch({type:'START'});await t.until('INSPECTION_OVERVIEW');await t.settle();
  await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.settle();
  await t.dispatch({type:'SELECT_TIRE',id:TIRE_PARTS[0]});await t.settle();
  for(const from of TIRE_PARTS)for(const to of TIRE_PARTS){
    if(from===to)continue;
    if((await t.state()).component!==from){await t.dispatch({type:'SELECT_TIRE',id:from});await t.settle();}
    R.tires[`${from}>${to}`]=await sample({type:'SELECT_TIRE',id:to},from==='tire.rear-left'&&to==='tire.rear-right'?'path-tire-rear-left-to-right':null);
  }
  await t.toOverview();
  R.other['overview>ev-charge']=await sample({type:'SELECT_AREA',id:'ev-charge',partId:'ev-charge.port'});await t.toOverview();
  R.other['overview>ev-battery']=await sample({type:'SELECT_AREA',id:'ev-battery'},'path-battery');await t.toOverview();
  R.other['overview>light']=await sample({type:'SELECT_AREA',id:'lights',partId:LIGHT_PARTS[3]});await t.toOverview();
  await t.dispatch({type:'SELECT_AREA',id:'hood'});await t.until('COMPONENT_SELECTION');await t.settle();
  R.other['bay>coolant']=await sample({type:'SELECT_COMPONENT',id:'coolant-reservoir'});
  R.other['coolant>battery-12v']=await sample({type:'SELECT_COMPONENT',id:'battery-12v'});
  R.other['battery-12v>washer']=await sample({type:'SELECT_COMPONENT',id:'washer-fluid-cap'});
  await context.close();
  return R;
}

// ---- Scripted adapter on the real page: QR and mobile phases, and finishing with data in progress.
async function measureMobileProtection(browser){
  const context=await browser.newContext({viewport:{width:1224,height:880},reducedMotion:'reduce'}),page=await context.newPage(),t=pageTools(page),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/inspect.js',async route=>{
    const response=await route.fetch(),source=await response.text();assert.ok(source.includes(REAL));
    await route.fulfill({response,body:`import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n`+source.replace(REAL,'createNativeInspectionResults({adapter:fixtureAdapter})')});
  });
  await page.goto(url);await page.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});await t.settle();
  const receiver=(phase)=>page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>f.receiver(${JSON.stringify({taskId:'tire.front-left',phase,canCancel:true,...(phase==='QR_READY'?{inviteExpiresAt:Date.now()+600000}:{})})}))`);
  const R={phases:{},exit:null};
  await t.dispatch({type:'START'});await t.until('INSPECTION_OVERVIEW');await t.settle();
  await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.settle();await t.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});await t.settle();
  const point=await page.evaluate(()=>{const I=window.__inspect,p=document.getElementById('panel').getBoundingClientRect();for(let x=24;x<p.left-24;x+=24)for(let y=80;y<innerHeight-24;y+=24){const h=I.hitAt(x,y);if(!h||h.kind==='other')return {x,y};}return null;});
  for(const phase of ['AUTH_WAITING','AUTH_FAILED','CREATING','QR_READY','QR_EXPIRED','CONNECTED','RESULT_RECEIVED']){
    await receiver(phase);await page.waitForTimeout(40);
    await page.mouse.click(point.x,point.y);await page.waitForTimeout(40);
    const s=await t.state();R.phases[phase]=s.name==='TIRE_PREVIEW'?'KEPT':'LEFT:'+s.name;
  }
  // What "finish inspection" asks today while a QR is showing
  await receiver('QR_READY');await page.waitForTimeout(40);
  await page.locator('#panel [data-action="exit"]').first().click();await page.waitForTimeout(80);await t.settle();
  R.exit={askedFirst:(await t.state()).name!=='IDLE',state:(await t.state()).name};
  R.errors=errors;
  await context.close();
  return R;
}

// ---- The conditions that mean "fixed". null: nothing measured this run.
function evaluateIssues(runs,paths,mobile){
  const views=Object.keys(runs),allPreview=(fn)=>views.every(v=>fn(runs[v].preview,runs[v]));
  const anyView=runs[views[0]];
  const tireFrames=Object.values(paths).flatMap(p=>Object.values(p.tires).map(x=>x.inside));
  const fills=v=>ALL_PARTS.filter(id=>runs[v].preview[id]?.fillPercent!==undefined&&id!==BATTERY_PART&&!LIGHT_PARTS.includes(id)&&!WIPER_PARTS.includes(id)).map(id=>runs[v].preview[id].fillPercent);
  const colors=views.flatMap(v=>[...HOOD_PARTS,...TIRE_PARTS,BATTERY_PART].map(id=>runs[v].preview[id]?.color).filter(Boolean)).map(c=>(0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255);
  const visibleModeled=ALL_PARTS.filter(id=>runs[views[0]].preview[id]?.selectable);
  return {
    'P0-1':{met:views.every(v=>distanceBetween(runs[v].result['washer-fluid-cap'].position,runs[v].preview['washer-fluid-cap'].position)<=POSE_TOLERANCE_M),value:Object.fromEntries(views.map(v=>[v,{resultDistance:runs[v].result['washer-fluid-cap'].distance,previewDistance:runs[v].preview['washer-fluid-cap'].distance,resultFill:runs[v].result['washer-fluid-cap'].fillPercent,previewFill:runs[v].preview['washer-fluid-cap'].fillPercent}]))},
    'P0-2':{met:tireFrames.every(x=>x===0),value:{transitions:tireFrames.length,withFramesInside:tireFrames.filter(x=>x>0).length,maxFramesInside:Math.max(...tireFrames)}},
    'P0-3':{met:views.every(v=>runs[v].flows.resultBackFromList==='COMPONENT_SELECTION'),value:Object.fromEntries(views.map(v=>[v,runs[v].flows.resultBackFromList]))},
    'P0-4':{met:views.every(v=>TIRE_PARTS.concat(WIPER_PARTS).filter(id=>runs[v].overview[id].mineCells>0).every(id=>runs[v].overview[id].highlightedMeshes>0)),value:Object.fromEntries(views.map(v=>[v,{textClaimsHighlight:runs[v].overviewFacts.text,visibleUnhinted:TIRE_PARTS.concat(WIPER_PARTS).filter(id=>runs[v].overview[id].mineCells>0&&runs[v].overview[id].highlightedMeshes===0)}]))},
    'P1-1':{met:views.every(v=>fills(v).every(x=>withinBand(x,FRAMING_BANDS.part))),value:Object.fromEntries(views.map(v=>[v,{min:Math.min(...fills(v)),max:Math.max(...fills(v))}]))},
    'P1-2':{met:null,value:'VISUAL: preview captures of hood parts'},
    'P1-3':{met:allPreview(p=>visibleModeled.every(id=>p[id].label)),value:Object.fromEntries(views.map(v=>[v,visibleModeled.filter(id=>runs[v].preview[id]?.label)]))},
    'P1-4':{met:spread(colors)<=0.25,value:{luminanceSpread:round(spread(colors)),min:round(Math.min(...colors)),max:round(Math.max(...colors)),note:'Mean of the rendered pixels of the selected part. Also depends on lighting and view.'}},
    'P1-5':{met:null,value:'NEEDS_P10: the page exposes selection emissive only for tires'},
    'P1-6':{met:anyView.paint.tiresTinted===false,value:anyView.paint},
    'P1-7':{met:views.every(v=>!runs[v].overviewFacts.legendTires),value:Object.fromEntries(views.map(v=>[v,runs[v].overviewFacts.legendTires]))},
    'P1-8':{met:views.every(v=>runs[v].flows.crossArea?.changed===true),value:Object.fromEntries(views.map(v=>[v,runs[v].flows.crossArea]))},
    'P1-9':{met:views.every(v=>Math.abs(runs[v].flows.tireList.directDistance-runs[v].flows.tireList.viaTireDistance)<=POSE_TOLERANCE_M),value:Object.fromEntries(views.map(v=>[v,runs[v].flows.tireList]))},
    'P1-10':{met:views.every(v=>runs[v].overviewFacts.batteryTag!=='점검 가능'),value:Object.fromEntries(views.map(v=>[v,runs[v].overviewFacts.batteryTag]))},
    'P1-11':{met:anyView.lcwListClass?.preview===true,value:anyView.lcwListClass},
    'P1-12':{met:allPreview(p=>HOOD_PARTS.filter(id=>p[id]?.selectable).every(id=>!(p[id].noProcedureText&&p[id].hasMobile))),value:Object.fromEntries(HOOD_PARTS.filter(id=>anyView.preview[id]?.selectable).map(id=>[id,{noProcedureText:anyView.preview[id].noProcedureText,hasMobile:anyView.preview[id].hasMobile}]))},
    'P1-13':{met:views.every(v=>[...WIPER_PARTS,...LIGHT_PARTS,...CHARGE_PARTS,...HOOD_PARTS].filter(id=>runs[v].select3d[id]?.clickable).every(id=>Math.min(...runs[v].select3d[id].touchPx)>=MIN_TOUCH_PX)),value:Object.fromEntries(views.map(v=>[v,Object.fromEntries([...WIPER_PARTS,...LIGHT_PARTS,...CHARGE_PARTS,...HOOD_PARTS].map(id=>[id,runs[v].select3d[id]?.touchPx]))]))},
    'P2-1':{met:views.every(v=>runs[v].geometry.idle.charge===runs[v].geometry.overview.charge&&runs[v].geometry.tires.charge===runs[v].geometry.overview.charge),value:Object.fromEntries(views.map(v=>[v,runs[v].geometry]))},
    'P2-2':{met:views.every(v=>runs[v].flows.backLabels.length<=1),value:anyView.flows.backLabels},
    'P2-3':{met:allPreview(p=>Object.values(p).every(x=>!x.internalWords?.length)),value:Object.fromEntries(ALL_PARTS.filter(id=>anyView.preview[id]?.internalWords?.length).map(id=>[id,anyView.preview[id].internalWords]))},
    'P2-4':{met:views.every(v=>LIGHT_PARTS.every(id=>Math.abs(runs[v].result[id].polar-runs[v].preview[id].polar)<=0.5)),value:Object.fromEntries(LIGHT_PARTS.map(id=>[id,{preview:anyView.preview[id].polar,result:anyView.result[id].polar}]))},
    'P2-5':{met:views.every(v=>Math.abs(runs[v].overviewFacts.toastCenter-runs[v].overviewFacts.usableCenter)<=4),value:Object.fromEntries(views.map(v=>[v,{toastCenter:runs[v].overviewFacts.toastCenter,usableCenter:runs[v].overviewFacts.usableCenter}]))},
    'P2-6':{met:null,value:'NEEDS_P10: the page exposes no label occlusion value'},
    'P2-7':{met:allPreview(p=>Object.values(p).every(x=>!x.focusOutline)),value:{note:'Script input. Whether a finger shows it is NOT_RUN.',parts:ALL_PARTS.filter(id=>anyView.preview[id]?.focusOutline).length}},
    'P2-8':{met:null,value:'VISUAL: preview-ev-battery.pack capture'},
    'P2-9':{met:null,value:'NODE: test/part-ux-known-issues.test.mjs'},
    mobile:mobile,
  };
}

const paint=(page)=>page.evaluate(()=>{const I=window.__inspect;const rows=I.resultPaint();const tire=rows.filter(r=>r.partId.startsWith('tire.')),other=rows.filter(r=>!r.partId.startsWith('tire.'));
  const same=r=>r.colors.every((c,i)=>c===r.baseColors[i]);return {tiresTinted:tire.some(r=>!same(r)),othersKeepMaterial:other.every(same),legendCounts:tire.length};});

let browser;const summary={scope:'REAL_REFERENCE_GLB_PAGE_DESKTOP_CHROME',avd:'NOT_RUN',androidWebView:'NOT_RUN',realTouch:'NOT_RUN',phone:'NOT_RUN',production:'NOT_RUN',viewports:VIEWPORTS.map(key),issues:{},blocking:[],errors:[]};
try{
  browser=await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL??'chrome',headless:true});summary.browser=browser.version();
  const runs={},paths={};
  for(const viewport of VIEWPORTS){
    console.log('measuring',key(viewport));
    const r=await measureViewport(browser,viewport);
    const extra=await browser.newContext({viewport,reducedMotion:'reduce'}),p=await extra.newPage(),tt=pageTools(p);
    await p.goto(url);await p.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});await tt.settle();await tt.dispatch({type:'START'});await tt.until('INSPECTION_OVERVIEW');await tt.settle();
    r.paint=await paint(p);
    await tt.dispatch({type:'SELECT_AREA',id:'hood'});await tt.until('COMPONENT_SELECTION');await tt.settle();
    r.lcwListClass=await p.evaluate(()=>{const b=document.querySelector('[data-id="lcw-coolant-reservoir"]');return {preview:b?.classList.contains('preview')??null,available:b?.classList.contains('available')??null};});
    await extra.close();
    summary.errors.push(...r.errors.map(e=>`${key(viewport)}: ${e}`));delete r.errors;
    runs[key(viewport)]=r;
    paths[key(viewport)]=await measurePaths(browser,viewport);
  }
  const mobile=await measureMobileProtection(browser);summary.errors.push(...mobile.errors.map(e=>`mobile: ${e}`));delete mobile.errors;
  const evaluated=evaluateIssues(runs,paths,mobile);
  for(const issue of PART_UX_ISSUES){
    const result=evaluated[issue.id],{outcome,blocking}=classifyIssue(issue,result);
    summary.issues[issue.id]={severity:issue.severity,title:issue.title,fixIn:issue.fixIn,measure:issue.measure,outcome,value:result?.value??null};
    if(blocking)summary.blocking.push(`${issue.id}: ${outcome}`);
  }
  // Frame counts depend on machine speed, so the stored baseline keeps only whether a transition entered the body.
  const crossesBody=Object.fromEntries(Object.entries(paths).map(([v,p])=>[v,Object.fromEntries([...Object.entries(p.tires),...Object.entries(p.other)].map(([k,x])=>[k,x.inside>0]))]));
  const measured={viewports:runs,mobile,crossesBody};
  await writeFile(path.join(out,'measured.json'),JSON.stringify({...measured,cameraPaths:paths},null,1));
  if(process.env.CARSCOPE_P10_WRITE_BASELINE==='1'){
    await writeFile(BASELINE,JSON.stringify(measured,null,1)+'\n');summary.baseline='WRITTEN';
  }else{
    const stored=JSON.parse(await readFile(BASELINE,'utf8')),drift=compareBaseline(stored,measured).filter(d=>!/\.color\./.test(d.path));
    summary.baseline=drift.length?'DRIFT':'MATCH';summary.baselineDrift=drift.slice(0,40);summary.baselineDriftCount=drift.length;
    if(drift.length)summary.blocking.push(`baseline drift: ${drift.length} values, first ${drift[0].path}`);
  }
}catch(error){summary.errors.push(error.stack??String(error));}
finally{await browser?.close();}
summary.status=summary.errors.length||summary.blocking.length?'FAIL':'PASS';
await writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2));
const counts={};for(const x of Object.values(summary.issues))counts[x.outcome]=(counts[x.outcome]||0)+1;
console.log(JSON.stringify({status:summary.status,baseline:summary.baseline,outcomes:counts,blocking:summary.blocking,errors:summary.errors.slice(0,5),browser:summary.browser},null,2));
if(summary.status!=='PASS')process.exitCode=1;
