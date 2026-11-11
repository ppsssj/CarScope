// P10 PR #2: the unified inspection panels on the real inspect.html with the reference GLB, in real Chrome. Local only
// (the GLB is not in the repository). Needs a running serve.mjs:
//   CARSCOPE_3D_TEST_URL=http://127.0.0.1:8098/inspect.html?capture=1 CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p10/... node test/browser-inspection-panels.mjs
// CARSCOPE_PANELS_MODE=capture takes the same screenshots without checks, so an older page (Before) can be captured too.
// Mobile results come from the scripted test adapter in this test context only. AVD, Android WebView, real touch and a
// phone are NOT_RUN here.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';
import {wireResult} from './result-fixtures.mjs';

const require=createRequire(new URL('../../mobile-ar-poc/package.json',import.meta.url)),{chromium}=require('playwright');
const out=process.env.CARSCOPE_EVIDENCE_DIR,url=process.env.CARSCOPE_3D_TEST_URL,capture=process.env.CARSCOPE_PANELS_MODE==='capture';
if(!out||!path.isAbsolute(out)||!path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external CARSCOPE_EVIDENCE_DIR');
if(!url)throw Error('Set CARSCOPE_3D_TEST_URL: this check needs the real reference GLB');
await mkdir(out,{recursive:true});
const REAL='createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()})';
const VIEWPORTS=[{width:1600,height:1000},{width:1224,height:880},{width:1024,height:600},{width:420,height:860}];
const SHOT_VIEWPORTS=['1600x1000','420x860'];
const INTERNAL=/USER_REPORTED|ESTIMATED_GEOMETRY|\bNative\b|Capability|Availability|inspectionId|bindingId|digest|sessionPhase|\bMOBILE\b|UNVERIFIED|SUPPORTED|SOURCE_OCCLUDED|DETACHED/;
const summary={scope:capture?'CAPTURE_ONLY_REAL_REFERENCE_GLB':'REAL_REFERENCE_GLB_PAGE_SCRIPTED_ADAPTER',mode:capture?'capture':'check',url,avd:'NOT_RUN',androidWebView:'NOT_RUN',realTouch:'NOT_RUN',phone:'NOT_RUN',native:'NOT_RUN',checks:[],failures:[],errors:[],screens:{}};
const key=v=>`${v.width}x${v.height}`;
async function check(name,run){
  if(capture)return;
  try{await run();summary.checks.push(`PASS ${name}`);console.log(`PASS ${name}`);}
  catch(error){summary.failures.push(`FAIL ${name}: ${error.message}`);console.log(`FAIL ${name}: ${error.message}`);}
}

function tools(page){
  const settle=async()=>{await page.waitForFunction(()=>!window.__inspect.busy,null,{timeout:30000});await page.waitForTimeout(120);};
  const state=()=>page.evaluate(()=>{const s=window.__inspect.state;return {name:s.name,area:s.area??null,component:s.component??null};});
  const until=async name=>{await page.waitForFunction(n=>window.__inspect.state.name===n,name,{timeout:30000});await settle();};
  const dispatch=e=>page.evaluate(e=>window.__inspect.dispatch(e),e);
  const publish=(t,value,i)=>page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>f.publish(${JSON.stringify(wireResult(t.taskId,value,`${(i+1).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`))},${JSON.stringify(t.partId)}))`);
  const receiver=phase=>page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>f.receiver(${JSON.stringify({taskId:'washer-fluid',phase,canCancel:true,retryAvailable:false,...(phase==='QR_READY'?{inviteExpiresAt:Date.now()+600000}:{})})}))`);
  // What the driver sees in the panel now: closed <details> are not rendered, so innerText leaves them out.
  const facts=()=>page.evaluate(()=>{
    const panel=document.getElementById('panel'),root=document.documentElement;
    return {state:window.__inspect.state.name,text:panel.innerText,title:panel.querySelector('h2')?.textContent.trim()??null,
      backLabels:[...panel.querySelectorAll('[data-action="back"]')].map(b=>b.textContent.trim()),
      pageOverflow:root.scrollWidth>innerWidth,panelOverflow:panel.scrollWidth>panel.clientWidth+1,
      clipped:[...panel.querySelectorAll('button')].filter(b=>b.offsetParent&&b.scrollWidth>b.clientWidth+1).map(b=>b.textContent.trim().slice(0,40)),
      openDetails:[...panel.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent.trim()),
      progress:panel.querySelector('.progress-summary [role="status"]')?.textContent.trim()??null};
  });
  return {settle,state,until,dispatch,publish,receiver,facts};
}
async function openPage(browser,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(30000);page.on('pageerror',e=>summary.errors.push(`${key(viewport)}: ${e.message}`));
  // Network interception in this test context only. The committed page still composes the real adapter only.
  await page.route('**/inspect.js',async route=>{const response=await route.fetch(),source=await response.text();assert.ok(source.includes(REAL));
    await route.fulfill({response,body:`import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n`+source.replace(REAL,'createNativeInspectionResults({adapter:fixtureAdapter})')});});
  await page.goto(url);await page.waitForFunction(()=>window.__inspectReady===true,null,{timeout:90000});
  return {context,page,t:tools(page)};
}

async function measure(browser,viewport){
  const {context,page,t}=await openPage(browser,viewport),dir=path.join(out,key(viewport));await mkdir(dir,{recursive:true});
  const shots=SHOT_VIEWPORTS.includes(key(viewport));
  const shot=async name=>{if(shots)await page.screenshot({path:path.join(dir,name+'.png')});};
  const screens={};
  const visit=async(name,events,expect)=>{
    for(const e of events){await t.dispatch(e);await page.waitForTimeout(40);await t.settle();}
    if(expect)await t.until(expect);
    await page.locator('#panel').evaluate(p=>{p.scrollTop=0;});await t.settle();
    screens[name]=await t.facts();await shot(name);
    return screens[name];
  };
  const home=async()=>{for(let i=0;i<8;i++){const s=await t.state();if(s.name==='INSPECTION_OVERVIEW')break;await t.dispatch({type:s.name==='IDLE'?'START':'BACK'});await page.waitForTimeout(40);await t.settle();}await t.until('INSPECTION_OVERVIEW');};

  await t.dispatch({type:'START'});await t.until('INSPECTION_OVERVIEW');
  await visit('overview-empty',[]);
  // One local tire and four phone results: the summary, overview counts and cards must agree with the result map.
  await t.dispatch({type:'SELECT_AREA',id:'tires'});await t.until('TIRE_SELECTION');await t.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});await t.settle();
  for(const k of ['damage','debris','wear'])await page.locator(`input[data-check=${k}][value=UNABLE]`).check();
  await page.locator('[data-action=confirm-tire]').click();await t.settle();
  await visit('tire-detail',[]);
  const picked=[1,6,9,13].map(i=>MOBILE_TARGETS[i]);
  for(const [i,tg] of picked.entries())assert.equal((await t.publish(tg,['FOUND','NOT_FOUND','UNABLE','FOUND'][i],i)).delivered,'STAGED');
  await t.settle();
  await home();const overview=await visit('overview-results',[]);
  const counts=await page.evaluate(()=>{const rows=window.__inspect.resultMap(),c={};for(const r of rows)c[r.status]=(c[r.status]||0)+1;return {rows:rows.length,c};});
  const cards=await page.evaluate(()=>[...document.querySelectorAll('#panel .area-card')].map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {id:b.dataset.id,h:Math.round(r.height),w:Math.round(r.width),border:s.borderTopWidth+' '+s.borderTopColor,radius:s.borderTopLeftRadius,tag:b.querySelector('.tag')?.textContent.trim(),disabled:b.disabled};}));
  const sum=await visit('summary',[{type:'SHOW_SUMMARY'}],'INSPECTION_SUMMARY');
  const summaryRows=await page.evaluate(()=>[...document.querySelectorAll('#allResults [data-action="result-detail"]')].map(b=>({id:b.dataset.id,status:b.querySelector('[data-inspection-state]')?.dataset.inspectionState})));
  const mapRows=await page.evaluate(()=>window.__inspect.resultMap().map(r=>({id:r.partId,status:r.status})));
  await page.locator('#panel').evaluate(p=>{p.scrollTop=p.scrollHeight;});await shot('summary-bottom');

  // Every part screen, through the same events a touch or a list row sends.
  await home();await visit('hood-list',[{type:'SELECT_AREA',id:'hood'}],'COMPONENT_SELECTION');
  await visit('washer-detail',[{type:'SELECT_COMPONENT',id:'washer-fluid-cap'}],'WASHER_SELECTED');
  await visit('brake-detail',[{type:'SELECT_COMPONENT',id:'brake-fluid-reservoir'}],'COMPONENT_PREVIEW');
  await home();await visit('tire-list',[{type:'SELECT_AREA',id:'tires'}],'TIRE_SELECTION');
  await visit('tire-summary',[{type:'SHOW_TIRE_SUMMARY'}],'TIRE_SUMMARY');
  await home();await visit('battery-detail',[{type:'SELECT_AREA',id:'ev-battery'}],'EV_BATTERY_PREVIEW');
  await home();await visit('charge-detail',[{type:'SELECT_AREA',id:'ev-charge',partId:'ev-charge.port'}],'CHARGE_PORT_PREVIEW');
  await home();await visit('wiper-detail',[{type:'SELECT_AREA',id:'wipers',partId:'wiper.front.left'}],'VISIBILITY_PREVIEW');
  await home();await visit('light-detail',[{type:'SELECT_AREA',id:'lights',partId:'light-low-beam-left-0'}],'VISIBILITY_PREVIEW');
  await home();await visit('result-brake',[{type:'SHOW_SUMMARY'},{type:'OPEN_RESULT',id:'brake-fluid-reservoir'}],'PART_RESULT');
  await home();await visit('result-lcw',[{type:'SHOW_SUMMARY'},{type:'OPEN_RESULT',id:'lcw-coolant-reservoir'}],'PART_RESULT');
  await home();
  if(capture){summary.screens[key(viewport)]=Object.fromEntries(Object.entries(screens).map(([k,v])=>[k,{title:v.title,backLabels:v.backLabels,progress:v.progress}]));await context.close();return;}

  const R={overview,counts,cards,sum,summaryRows,mapRows,screens,flows:{}};
  // ---- navigation on the real page: the panel button, the top bar and Escape send the same Back.
  const F=R.flows,pose=()=>page.evaluate(()=>window.__inspect.cameraPose());
  await t.dispatch({type:'SELECT_AREA',id:'hood'});await t.until('COMPONENT_SELECTION');
  const listPose=await pose();
  await page.locator('#panel [data-action="result-detail"][data-id="lcw-coolant-reservoir"]').click();await t.until('PART_RESULT');
  F.resultHood=await page.evaluate(()=>window.__inspect.hoodAngle);
  await page.locator('#panel [data-action="back"]').click();await t.settle();
  F.listBack={...(await t.state()),hood:await page.evaluate(()=>window.__inspect.hoodAngle),poseShift:Math.hypot(...(await pose()).target.map((v,i)=>v-listPose.target[i]))};
  await page.locator('#panel [data-action="component"][data-id="battery-12v"]').first().click();await t.until('COMPONENT_PREVIEW');
  await page.locator('#panel [data-action="product-summary"]').click();await t.until('INSPECTION_SUMMARY');
  await page.locator('#back').click();await t.until('COMPONENT_PREVIEW');F.summaryTopBack=await t.state();
  F.summaryTopBackHood=await page.evaluate(()=>window.__inspect.hoodAngle);
  await page.locator('#panel [data-action="product-summary"]').click();await t.until('INSPECTION_SUMMARY');
  await page.locator('#allResults [data-action="result-detail"][data-id="tire.rear-right"]').click();await t.until('PART_RESULT');
  await page.keyboard.press('Escape');await t.until('INSPECTION_SUMMARY');F.resultEscape=(await t.state()).name;
  await page.keyboard.press('Escape');await t.settle();F.summaryEscape=await t.state();
  // ---- leaving the session: asks first because this session holds answers and results; Back cancels the question.
  await home();
  await page.locator('#back').click();await page.waitForTimeout(150);
  F.backAsks={visible:await page.locator('#exitConfirm:not([hidden])').count(),state:(await t.state()).name,text:await page.locator('#exitConfirm').innerText()};
  await shot('exit-confirm');
  await page.keyboard.press('Escape');await page.waitForTimeout(100);
  F.escapeCancels={visible:await page.locator('#exitConfirm:not([hidden])').count(),state:(await t.state()).name};
  await t.receiver('QR_READY');await page.waitForTimeout(150);
  await page.locator('#panel [data-action="exit"]').click();await page.waitForTimeout(100);
  F.exitAsksDuringQr={visible:await page.locator('#exitConfirm:not([hidden])').count(),text:await page.locator('#exitConfirm').innerText(),state:(await t.state()).name};
  await page.locator('#exitConfirm [data-action="exit-cancel"]').click();await page.waitForTimeout(80);
  F.cancelKeeps={state:(await t.state()).name,records:await page.evaluate(()=>window.__inspect.nativeResults().records.length),focus:await page.evaluate(()=>document.activeElement?.dataset.action??null)};
  await t.receiver('CANCELLED');
  await page.locator('#panel [data-action="exit"]').click();await page.locator('#exitConfirm [data-action="exit-confirm"]').click();await t.until('IDLE');
  F.confirmEnds={records:await page.evaluate(()=>window.__inspect.nativeResults().records.length),answered:await page.evaluate(()=>Object.values(window.__inspect.userInspection().tires).filter(x=>Object.keys(x.responses).length).length)};
  // With nothing recorded, ending is immediate.
  await page.locator('#start').click();await t.until('INSPECTION_OVERVIEW');
  await page.locator('#panel [data-action="exit"]').click();await t.settle();F.emptyExit=(await t.state()).name;
  // Toast placement: on the free space beside a side panel.
  await page.locator('#start').click();await t.until('INSPECTION_OVERVIEW');
  F.toast=await page.evaluate(()=>{const t=document.getElementById('toast').getBoundingClientRect(),p=document.getElementById('panel').getBoundingClientRect(),side=p.width<innerWidth*.7;return {center:Math.round(t.left+t.width/2),free:Math.round(side?p.left/2:innerWidth/2)};});
  await context.close();
  return R;
}

let browser;
try{
  browser=await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL??'chrome',headless:true});summary.browser=browser.version();
  const runs={};
  for(const viewport of VIEWPORTS){console.log('viewport',key(viewport));runs[key(viewport)]=await measure(browser,viewport);}
  if(!capture){
    await writeFile(path.join(out,'measured.json'),JSON.stringify(runs,null,1));
    for(const [v,R] of Object.entries(runs)){
      await check(`${v} overview counts 17 parts and shows no tire-only legend`,()=>{
        assert.doesNotMatch(R.overview.text,/타이어 4개|3D 점검 상태/);
        const done=17-(R.counts.c.NOT_INSPECTED??0);assert.equal(R.counts.rows,17);
        assert.match(R.overview.progress,new RegExp(`점검 완료 ${done}/17`));
        assert.match(R.sum.progress,new RegExp(`점검 완료 ${done}/17 · 미점검 ${R.counts.c.NOT_INSPECTED} · 이상 징후 보고 ${R.counts.c.FINDINGS_REPORTED??0} · 확인 불가 ${R.counts.c.UNABLE??0} · 발견 사항 없음 ${R.counts.c.NO_FINDINGS_REPORTED??0}`));
      });
      await check(`${v} summary rows are the 17 parts with the result map's states`,()=>{
        assert.deepEqual([...R.summaryRows].sort((a,b)=>a.id.localeCompare(b.id)),[...R.mapRows].sort((a,b)=>a.id.localeCompare(b.id)));
        assert.doesNotMatch(R.sum.text,/네 타이어 · 로컬|워셔액 · 안내와|실제 SDK 관측과 별개/);
        assert.match(R.sum.text,/정상·안전·주행 가능 판정이 아닙니다/);
      });
      await check(`${v} area cards share one size, border and radius; EV battery is not tagged inspectable`,()=>{
        assert.equal(R.cards.length,6);
        assert.equal(new Set(R.cards.map(c=>c.w)).size,1,JSON.stringify(R.cards.map(c=>c.w)));
        assert.ok(Math.max(...R.cards.map(c=>c.h))-Math.min(...R.cards.map(c=>c.h))<=24,JSON.stringify(R.cards.map(c=>c.h)));
        assert.equal(new Set(R.cards.map(c=>c.border)).size,1);assert.equal(new Set(R.cards.map(c=>c.radius)).size,1);
        assert.equal(R.cards.find(c=>c.id==='ev-battery').tag,'형상 보기');
        assert.match(R.cards.find(c=>c.id==='tires').tag,/^결과 \d\/4$/);
      });
      await check(`${v} every screen: plain words, one Back label, no clipped button, no sideways scroll, nothing opened by default`,()=>{
        const bad=Object.entries(R.screens).flatMap(([name,f])=>[
          INTERNAL.test(f.text)?`${name}: ${f.text.match(INTERNAL)[0]}`:null,
          f.backLabels.some(l=>l!=='뒤로')?`${name}: back ${f.backLabels}`:null,
          f.pageOverflow||f.panelOverflow?`${name}: overflow`:null,
          f.clipped.length?`${name}: clipped ${f.clipped}`:null,
          f.openDetails.length?`${name}: open ${f.openDetails}`:null].filter(Boolean));
        assert.deepEqual(bad,[]);
      });
      await check(`${v} part screens keep the model notice and the safety text`,()=>{
        for(const name of ['washer-detail','brake-detail','tire-detail','battery-detail','charge-detail','wiper-detail','light-detail','result-brake'])assert.match(R.screens[name].text,/추정 모델|참조 모델|위치 표식/,name);
        assert.match(R.screens['washer-detail'].text,/부품을 만지거나 캡·덮개를 열지 마세요/);assert.match(R.screens['brake-detail'].text,/부품을 만지거나 캡·덮개를 열지 마세요/);
        assert.match(R.screens['light-detail'].text,/켜서 시험하거나 만지거나 분해하지 마세요/);
        assert.match(R.screens['result-lcw'].text,/3D 형상이 없거나/);
        assert.doesNotMatch(R.screens['brake-detail'].text,/아직 제공하지 않음/);
      });
      await check(`${v} Back follows the real entry path; panel, top bar and Escape agree`,()=>{
        const F=R.flows;
        assert.equal(F.listBack.name,'COMPONENT_SELECTION');assert.equal(F.listBack.component,null);assert.equal(F.listBack.hood,60);assert.equal(F.resultHood,60);
        assert.equal(F.summaryTopBack.name,'COMPONENT_PREVIEW');assert.equal(F.summaryTopBack.component,'battery-12v');assert.equal(F.summaryTopBackHood,60);
        assert.equal(F.resultEscape,'INSPECTION_SUMMARY');assert.equal(F.summaryEscape.name,'COMPONENT_PREVIEW');
      });
      await check(`${v} ending asks with the real scope, Back cancels it, a QR in progress is kept until confirmed`,()=>{
        const F=R.flows;
        assert.equal(F.backAsks.visible,1);assert.equal(F.backAsks.state,'INSPECTION_OVERVIEW');assert.match(F.backAsks.text,/타이어 1개/);assert.match(F.backAsks.text,/이 화면에 표시된 스마트폰 결과 4건/);assert.match(F.backAsks.text,/저장된 과거 점검 기록은 지워지지 않습니다/);
        assert.equal(F.escapeCancels.visible,0);assert.equal(F.escapeCancels.state,'INSPECTION_OVERVIEW');
        assert.equal(F.exitAsksDuringQr.visible,1);assert.match(F.exitAsksDuringQr.text,/진행 중인 스마트폰 점검 연결/);
        assert.equal(F.cancelKeeps.state,'INSPECTION_OVERVIEW');assert.equal(F.cancelKeeps.records,4);assert.equal(F.cancelKeeps.focus,'exit');
        assert.deepEqual(F.confirmEnds,{records:0,answered:0});assert.equal(F.emptyExit,'IDLE');
      });
      await check(`${v} the toast centers on the free space`,()=>assert.ok(Math.abs(R.flows.toast.center-R.flows.toast.free)<=4,JSON.stringify(R.flows.toast)));
    }
  }else for(const v of Object.keys(runs))if(!runs[v])delete runs[v];
  summary.status=summary.errors.length||summary.failures.length?'FAIL':'PASS';
}catch(error){summary.status='FAIL';summary.errors.push(error.stack??String(error));}
finally{await browser?.close();await writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({status:summary.status,mode:summary.mode,checks:summary.checks.length,failures:summary.failures,errors:summary.errors.slice(0,5),browser:summary.browser},null,2));}
if(summary.status!=='PASS')process.exitCode=1;
