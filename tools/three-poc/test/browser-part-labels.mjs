// P10 unified 3D UX: the PartLabel system on the real reference GLB in real Chrome. Local only (the GLB is not in the
// repository). Complements browser-part-ux-baseline.mjs, which judges the P10-0 known issues.
//   CARSCOPE_3D_TEST_URL=http://127.0.0.1:8199/inspect.html?capture=1 CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p10/... node test/browser-part-labels.mjs
// Checks, per viewport: the five bonnet labels, bounds/panel/overlap/44px, real clicks, camera rotation with a separate
// occlusion ray, the overview area labels, the no-geometry fallback, the QR lock and (420x860) touch taps with slop.
// Desktop Chrome with Playwright touch emulation. AVD, Android WebView, a real finger and a phone are NOT_RUN.
// Rotation is sampled at a few poses: it is not a proof for every angle.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {LABEL_MIN_PX} from '../part-labels.mjs';
import {VIEWPORTS} from './part-ux-metrics.mjs';

const require=createRequire(new URL('../../mobile-ar-poc/package.json',import.meta.url)),{chromium}=require('playwright');
const out=process.env.CARSCOPE_EVIDENCE_DIR,url=process.env.CARSCOPE_3D_TEST_URL;
if(!out||!path.isAbsolute(out)||!path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external CARSCOPE_EVIDENCE_DIR');
if(!url)throw Error('Set CARSCOPE_3D_TEST_URL: this check needs the real reference GLB');
await mkdir(out,{recursive:true});
const REAL='createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()})';
const HOOD=['washer-fluid-cap','coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box'];
const summary={scope:'REAL_REFERENCE_GLB_PAGE_DESKTOP_CHROME_SCRIPTED_ADAPTER',avd:'NOT_RUN',androidWebView:'NOT_RUN',realFinger:'NOT_RUN',phone:'NOT_RUN',checks:[],notRun:[],failures:[],errors:[],viewports:{}};
const key=v=>`${v.width}x${v.height}`;

async function open(browser,viewport,touch=false){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',...(touch?{hasTouch:true,isMobile:true}:{})}),page=await context.newPage();
  page.setDefaultTimeout(30000);page.on('pageerror',e=>summary.errors.push(`${key(viewport)}: ${e.message}`));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))summary.errors.push(`${key(viewport)}: ${m.text()}`);});
  await page.route('**/inspect.js',async route=>{
    const response=await route.fetch(),source=await response.text();assert.ok(source.includes(REAL));
    await route.fulfill({response,body:`import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n`+source.replace(REAL,'createNativeInspectionResults({adapter:fixtureAdapter})')});
  });
  await page.goto(url);await page.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});
  const settle=async()=>{await page.waitForFunction(()=>!window.__inspect.busy,null,{timeout:30000});await page.waitForTimeout(250);};
  const dispatch=e=>page.evaluate(e=>window.__inspect.dispatch(e),e);
  const until=name=>page.waitForFunction(n=>window.__inspect.state.name===n,name,{timeout:30000});
  const state=()=>page.evaluate(()=>({name:window.__inspect.state.name,component:window.__inspect.state.component}));
  const toOverview=async()=>{for(let i=0;i<8;i++){const s=await state();if(s.name==='INSPECTION_OVERVIEW')break;await dispatch({type:s.name==='IDLE'?'START':'BACK'});await page.waitForTimeout(30);await settle();}await until('INSPECTION_OVERVIEW');await settle();};
  const shot=name=>page.screenshot({path:path.join(out,key(viewport),name+'.png')});
  await mkdir(path.join(out,key(viewport)),{recursive:true});
  return {context,page,settle,dispatch,until,state,toOverview,shot};
}

// Geometry of every shown label against the view, the panel, the top bar, the other labels and the 44px size; then
// each claim against a separate ray at its anchor.
const audit=page=>page.evaluate(min=>{
  const I=window.__inspect,info=I.labelInfo(),W=innerWidth,H=innerHeight,ov=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
  const panel=I.state.name==='IDLE'?null:rect(document.getElementById('panel')),bar=[...document.querySelectorAll('.topbar>*')].map(rect).filter(r=>r.w&&r.h);
  const idOf=h=>!h?null:h.kind==='hood'?'hood':h.kind==='washer'?'washer-fluid-cap':h.id??null;
  const shown=info.filter(l=>l.shown),problems=[];
  for(const l of shown){
    const b=l.button;
    if(!b){problems.push(`${l.id}: no button box`);continue;}
    if(b.w<min||b.h<min)problems.push(`${l.id}: ${Math.round(b.w)}x${Math.round(b.h)} under ${min}px`);
    if(b.x<0||b.y<0||b.x+b.w>W||b.y+b.h>H)problems.push(`${l.id}: outside the view`);
    if(panel&&ov(b,panel))problems.push(`${l.id}: over the panel`);
    if(bar.some(r=>ov(b,r)))problems.push(`${l.id}: over the top bar`);
    for(const o of shown)if(o!==l&&o.button&&o.id<l.id&&ov(b,o.button))problems.push(`${l.id}/${o.id}: overlap`);
    const onPart=idOf(I.hitAt(l.anchor.x,l.anchor.y))===l.anchorPart;
    if(onPart!==!l.occluded)problems.push(`${l.id}: ${l.occluded?'marked occluded but visible':'shown but covered'}`);
  }
  for(const l of info.filter(l=>l.reason==='OCCLUDED'))if(idOf(I.hitAt(l.anchor.x,l.anchor.y))===l.anchorPart)problems.push(`${l.id}: hidden as occluded but visible`);
  return {shown:shown.map(l=>l.id),hidden:Object.fromEntries(info.filter(l=>!l.shown).map(l=>[l.id,l.reason])),anchors:Object.fromEntries(shown.map(l=>[l.id,[Math.round(l.anchor.x),Math.round(l.anchor.y)]])),problems};
},LABEL_MIN_PX);

async function check(name,fn){
  // A check that could not run on this setup returns a NOT_RUN reason and is never counted as PASS.
  try{const v=await fn();if(typeof v==='string'&&/^(NOT_SHOWN|HANDOFF_NOT_CONFIGURED)$/.test(v)){summary.notRun.push(`${name}: ${v}`);return null;}summary.checks.push(`PASS ${name}`);return v;}
  catch(e){summary.failures.push(`${name}: ${e.message.split('\n')[0]}`);return null;}
}

async function runViewport(browser,viewport){
  const T=await open(browser,viewport),{page,settle,dispatch,until,state,toOverview,shot}=T,V=key(viewport),R={};
  await dispatch({type:'START'});await until('INSPECTION_OVERVIEW');await settle();
  R.overview=await audit(page);await shot('after-overview');
  await check(`${V} overview: area labels are consistent and inside free space`,()=>{assert.deepEqual(R.overview.problems,[]);assert.ok(R.overview.shown.length>=1);});
  await check(`${V} overview: the hood label opens the hood`,async()=>{
    if(!R.overview.shown.includes('area:hood'))return 'NOT_SHOWN';
    await page.locator('.part-label[data-part-label="area:hood"] button').click();await page.waitForTimeout(60);
    assert.ok(['HOOD_OPENING','COMPONENT_SELECTION'].includes((await state()).name));
  });
  await toOverview();await dispatch({type:'SELECT_AREA',id:'hood'});await until('COMPONENT_SELECTION');await settle();
  R.bay=await audit(page);await shot('after-bay');
  await check(`${V} bay: five modeled bonnet parts have a label, LCW has none`,async()=>{
    const ids=await page.evaluate(()=>window.__inspect.labelInfo().map(l=>l.id));
    assert.deepEqual([...ids].sort(),[...HOOD].sort());
    assert.deepEqual(R.bay.problems,[]);
  });
  R.bayShown=R.bay.shown.length;
  for(const id of R.bay.shown){
    await check(`${V} bay: clicking the ${id} label selects it`,async()=>{
      await page.locator(`.part-label[data-part-label="${id}"][data-shown="true"] button`).click();await page.waitForTimeout(60);await settle();
      const s=await state();assert.equal(s.component,id);
      const sel=await page.evaluate(id=>window.__inspect.labelInfo().find(l=>l.id===id),id);assert.ok(sel.shown&&sel.selected);
      await dispatch({type:'BACK'});await until('COMPONENT_SELECTION');await settle();
    });
  }
  // Rotation: drag the model, then audit again at each pose.
  R.rotation=[];
  for(let i=0;i<4;i++){
    const box=await page.evaluate(()=>{const p=document.getElementById('panel').getBoundingClientRect();return p.width<innerWidth*.7?[Math.max(60,p.left/2),innerHeight/2]:[innerWidth/2,Math.max(90,p.top/2)];});
    await page.mouse.move(box[0],box[1]);await page.mouse.down();await page.mouse.move(box[0]+(i%2?-140:160),box[1]+(i===2?40:0),{steps:6});await page.mouse.up();
    await page.waitForTimeout(700);
    const a=await audit(page);R.rotation.push({shown:a.shown,hidden:a.hidden,problems:a.problems});
    if(i===1)await shot('after-bay-rotated');
  }
  await check(`${V} bay: after four drags every label claim matches a separate ray`,()=>assert.deepEqual(R.rotation.flatMap(x=>x.problems),[]));
  await check(`${V} no geometry: LCW opens from the list with no label and no stand-in position`,async()=>{
    await toOverview();await dispatch({type:'SELECT_AREA',id:'hood'});await until('COMPONENT_SELECTION');await settle();
    await page.locator('#panel [data-id="lcw-coolant-reservoir"]').click();await until('PART_RESULT');await settle();
    assert.equal(await page.evaluate(()=>window.__inspect.labelInfo().length),0);
    assert.equal(await page.locator('.part-label').count(),0);
    await shot('after-lcw-result');
  });
  // Tire list and a tire preview with rotation.
  await toOverview();await dispatch({type:'SELECT_AREA',id:'tires'});await until('TIRE_SELECTION');await settle();
  R.tires=await audit(page);await shot('after-tires');
  await check(`${V} tires: labels consistent`,()=>assert.deepEqual(R.tires.problems,[]));
  for(const [area,partId,shotName] of [['lights','light-high-beam-left-0','after-lights'],['ev-charge','ev-charge.port','after-charge'],['wipers','wiper.front.left','after-wipers']]){
    await toOverview();await dispatch({type:'SELECT_AREA',id:area,partId});await settle();
    const a=await audit(page);R[area]=a;await shot(shotName);
    await check(`${V} ${area}: selected label shown and every claim consistent`,()=>{assert.ok(a.shown.includes(partId));assert.deepEqual(a.problems,[]);});
  }
  // QR lock with the scripted receiver: only the selected label stays and it sends nothing.
  await toOverview();await dispatch({type:'SELECT_AREA',id:'tires'});await until('TIRE_SELECTION');await settle();await dispatch({type:'SELECT_TIRE',id:'tire.front-left'});await settle();
  await check(`${V} QR live: other labels go, the selected one sends nothing, and they return afterwards`,async()=>{
    const before=await page.evaluate(()=>window.__inspect.labelInfo().length);
    await page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>f.receiver({taskId:'tire.front-left',phase:'QR_READY',canCancel:true,inviteExpiresAt:Date.now()+600000}))`);
    await page.waitForTimeout(300);
    const locked=await page.evaluate(()=>window.__inspect.labelInfo().map(l=>({id:l.id,actionable:l.actionable,event:l.event})));
    assert.deepEqual(locked,[{id:'tire.front-left',actionable:false,event:null}]);
    await shot('after-qr-locked');
    const label=page.locator('.part-label[data-part-label="tire.front-left"][data-shown="true"] button');
    if(await label.count()){await label.click({force:true});await page.waitForTimeout(80);} // force: the locked label is aria-disabled on purpose
    assert.deepEqual(await state(),{name:'TIRE_PREVIEW',component:'tire.front-left'});
    await page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>f.receiver({taskId:'tire.front-left',phase:'CLOSED',canCancel:false}))`);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>window.__inspect.labelInfo().length),before);
  });
  await check(`${V} washer QR screen: only the washer label, read-only`,async()=>{
    await toOverview();await dispatch({type:'SELECT_AREA',id:'hood'});await until('COMPONENT_SELECTION');await settle();
    await dispatch({type:'SELECT_COMPONENT',id:'washer-fluid-cap'});await until('WASHER_SELECTED');await settle();
    if(!(await page.evaluate(()=>window.__inspect.handoff.configured)))return 'HANDOFF_NOT_CONFIGURED';
    await dispatch({type:'REQUEST_HANDOFF'});await until('MOBILE_HANDOFF_READY');await settle();
    assert.deepEqual(await page.evaluate(()=>window.__inspect.labelInfo().map(l=>[l.id,l.actionable])),[['washer-fluid-cap',false]]);
  });
  await T.context.close();
  return R;
}

// Touch emulation on the narrow screen: a tap on a label, and a tap beside a thin part (within the slop) selects it.
async function runTouch(browser){
  const viewport={width:420,height:860},T=await open(browser,viewport,true),{page,settle,dispatch,until,state,toOverview,shot}=T,R={};
  await dispatch({type:'START'});await until('INSPECTION_OVERVIEW');await settle();await dispatch({type:'SELECT_AREA',id:'hood'});await until('COMPONENT_SELECTION');await settle();
  const first=await page.evaluate(()=>window.__inspect.labelInfo().find(l=>l.shown));
  await check('420x860 touch: a tap on a label selects its part',async()=>{
    assert.ok(first,'a label is shown');await page.locator(`.part-label[data-part-label="${first.id}"] button`).tap();await page.waitForTimeout(80);await settle();
    assert.equal((await state()).component,first.id);
  });
  await toOverview();await dispatch({type:'SELECT_AREA',id:'wipers',partId:'wiper.front.left'});await settle();
  R.slop=await check('420x860 touch: a tap just beside the other wiper (not on it) selects it through the slop',async()=>{
    const spot=await page.evaluate(()=>{
      const I=window.__inspect,mine=(x,y)=>I.hitAt(x,y)?.id==='wiper.front.right';
      for(let y=80;y<innerHeight*.5;y+=3)for(let x=10;x<innerWidth-10;x+=3)if(mine(x,y))for(const [dx,dy] of [[0,-12],[0,12],[-12,0],[12,0]])
        if(!mine(x+dx,y+dy)&&I.pickAt(x+dx,y+dy)?.id==='wiper.front.right'&&!['visibility','charge','tire','component','washer','hood'].includes(I.hitAt(x+dx,y+dy)?.kind))return {x:x+dx,y:y+dy};
      return null;});
    assert.ok(spot,'a point beside the wiper exists');
    await page.touchscreen.tap(spot.x,spot.y);await page.waitForTimeout(80);await settle();
    assert.equal((await state()).component,'wiper.front.right');await shot('after-touch-slop');
    return spot;
  });
  await T.context.close();
  return R;
}

let browser;
try{
  browser=await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL??'chrome',headless:true});summary.browser=browser.version();
  for(const viewport of VIEWPORTS){console.log('labels',key(viewport));summary.viewports[key(viewport)]=await runViewport(browser,viewport);}
  summary.touch=await runTouch(browser);
}catch(error){summary.errors.push(error.stack??String(error));}
finally{await browser?.close();}
summary.status=summary.errors.length||summary.failures.length?'FAIL':'PASS';
await writeFile(path.join(out,'labels.json'),JSON.stringify(summary,null,1));
console.log(JSON.stringify({status:summary.status,pass:summary.checks.length,notRun:summary.notRun,failures:summary.failures,errors:summary.errors.slice(0,5),bayShown:Object.fromEntries(Object.entries(summary.viewports).map(([k,v])=>[k,v.bayShown])),browser:summary.browser},null,2));
if(summary.status!=='PASS')process.exitCode=1;
