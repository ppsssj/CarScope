// P8-B1 browser checks. Default: DOM_ONLY with the real inspect.html styles and the demo provider, no 3D.
// With CARSCOPE_3D_TEST_URL: the real production page twice: unmodified (UNAVAILABLE, no request) and with this
// test context replacing the composition by the demo provider. Everything shown is synthetic and labelled 데모 데이터.
// No production API, issuer, Native or device path is exercised, and no result here is a real History read.
import {createRequire} from 'node:module';import {readFile,mkdir,writeFile} from 'node:fs/promises';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(new URL('../../mobile-ar-poc/package.json',import.meta.url)),{chromium}=require('playwright');
const out=process.env.CARSCOPE_EVIDENCE_DIR;if(!out||!path.isAbsolute(out)||!path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external CARSCOPE_EVIDENCE_DIR');await mkdir(out,{recursive:true});
const summary={scope:process.env.CARSCOPE_3D_TEST_URL?'REAL_REFERENCE_GLB_AND_DEMO_PROVIDER':'DOM_ONLY_DEMO_PROVIDER_NO_3D',productionHistoryRead:'NOT_RUN',nativeProvider:'BLOCKED',deviceE2E:'NOT_RUN',checks:[],errors:[]};
const pageSource=await readFile(new URL('../inspect.html',import.meta.url),'utf8'),styles=pageSource.match(/<style>([\s\S]*?)<\/style>/)[1];
const fixtureHtml=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}html,body{overflow:auto;height:auto}#panel{position:static;bottom:auto;transform:none!important;width:min(380px,100%);max-height:none;margin:0 auto}</style><body data-state="HISTORY_LIST"><h1 class="note">SYNTHETIC TEST ONLY · 데모 데이터</h1><aside id="panel" aria-live="polite"></aside><script type="module">
import {createInspectionHistoryStore} from '/inspection-history-store.mjs';import {historyPanelHtml,historyListResultsHtml,historyDetailResultsHtml,historyFilterHtml} from '/inspection-history-view.mjs';import {EMPTY_HISTORY_FILTERS} from '/inspection-history-contract.mjs';import {demoHistoryProvider,demoControl,demoQueue} from '/test/history-demo-provider.mjs';
const store=createInspectionHistoryStore({provider:demoHistoryProvider}),panel=document.getElementById('panel');let screen={name:'HISTORY_LIST'};
const paint=()=>{panel.innerHTML=historyPanelHtml(screen,store.snapshot,null);};
store.subscribe(()=>{const region=document.getElementById('historyResults');if(!region)return;region.innerHTML=screen.name==='HISTORY_DETAIL'?historyDetailResultsHtml(store.snapshot,null):historyListResultsHtml(store.snapshot,null);});
panel.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  if(a==='history-detail'){screen={name:'HISTORY_DETAIL'};paint();store.openDetail(b.dataset.record);}
  if(a==='back'&&screen.name==='HISTORY_DETAIL'){store.closeDetail();screen={name:'HISTORY_LIST'};paint();}
  if(a==='history-more')store.loadMore();if(a==='history-retry')store.retry();
  if(a==='history-reset-filters'){store.setFilters(EMPTY_HISTORY_FILTERS);panel.querySelector('.history-filters').outerHTML=historyFilterHtml(store.snapshot);}});
panel.addEventListener('change',e=>{const f=e.target.closest('#historyFilterForm');if(f)store.setFilters(Object.fromEntries(new FormData(f)));});
paint();store.openList();paint();window.fixtureTest={store,demoControl,demoQueue};
</script></html>`;
const server=http.createServer(async(req,res)=>{try{const url=req.url.split('?')[0];if(url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixtureHtml);return;}const base=new URL('../',import.meta.url),file=new URL(decodeURIComponent(url.slice(1)),base);if(!file.href.startsWith(base.href)||!file.pathname.endsWith('.mjs'))throw Error('Denied');res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${server.address().port}`;let browser;
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const status=(page,value)=>page.locator(`#historyResults [data-history-status="${value}"]`).waitFor();
try{
  browser=await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL??'chrome',headless:true});summary.browser=browser.version();
  for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>summary.errors.push(e.message));
    await page.goto(root);await page.locator('.history-card').first().waitFor();
    assert.equal(await page.locator('.history-card').count(),20);assert.match(await page.locator('#panel').textContent(),/데모 데이터/);assert.equal(await noOverflow(page),true);
    assert.ok((await page.locator('.history-card').first().boundingBox()).height>=44);
    await page.screenshot({path:path.join(out,`dom-list-${viewport.width}.png`),fullPage:true});
    // keyboard and paging
    await page.locator('[data-action=history-more]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===40);
    await page.locator('[data-action=history-more]').click();await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===45);
    assert.equal(await page.locator('[data-action=history-more]').count(),0);
    // filters reset the cursor
    await page.locator('.history-filters summary').click();
    await page.evaluate(()=>{fixtureTest.demoControl.calls.length=0;});
    await page.locator('select[name=taskId]').focus();await page.locator('select[name=taskId]').selectOption('brake-fluid');
    await page.waitForFunction(()=>{const c=[...document.querySelectorAll('.history-card')];return c.length&&c.every(x=>x.dataset.task==='brake-fluid'&&x.textContent.includes('브레이크액'));});
    assert.equal(await page.locator('select[name=taskId]').evaluate(e=>document.activeElement===e),true,'filter focus survives results refresh');
    assert.equal(await page.evaluate(()=>fixtureTest.demoControl.calls.at(-1).query.cursor),undefined);
    await page.locator('input[name=fromDate]').fill('2026-11-02');await page.locator('input[name=toDate]').fill('2026-11-01');await page.locator('input[name=toDate]').dispatchEvent('change');
    await status(page,'INVALID_QUERY');assert.equal(await page.locator('.history-card').count(),0);
    await page.locator('#historyResults [data-action=history-reset-filters]').click();await page.waitForFunction(()=>document.querySelectorAll('.history-card').length===20);
    // detail
    const washer=page.locator('.history-card[data-task="washer-fluid"]').first();await washer.click();await page.locator('.source-zone[data-source-zone=HISTORY]').waitFor();
    assert.match(await page.locator('#panel').textContent(),/질문별 응답 없이 하나의 선택으로 저장됩니다/);assert.equal(await noOverflow(page),true);
    await page.screenshot({path:path.join(out,`dom-detail-v1-${viewport.width}.png`),fullPage:true});
    await page.locator('#panel [data-action=back]').click();await page.locator('.history-card').first().waitFor();
    const tire=page.locator('.history-card[data-task="tire.front-left"]').first();await tire.click();await page.locator('.history-original').waitFor();
    assert.match(await page.locator('#panel').textContent(),/외관 손상/);await page.locator('.history-original summary').click();assert.equal(await noOverflow(page),true);
    await page.screenshot({path:path.join(out,`dom-detail-v2-${viewport.width}.png`),fullPage:true});
    await page.locator('#panel [data-action=back]').click();await page.locator('.history-card').first().waitFor();
    // every state screen is reachable and fits
    for(const [reply,want] of [[{status:403,body:{error:{code:'FORBIDDEN'}}},'AUTH_REQUIRED'],[{status:429,body:{error:{code:'RATE_LIMITED'}}},'RATE_LIMITED'],[{status:500,body:{error:{code:'INTERNAL'}}},'SERVER_ERROR'],[{status:200,body:{schemaVersion:1,items:[],page:{limit:20,hasMore:false,nextCursor:null}}},'EMPTY'],[{status:404,body:{error:{code:'NOT_FOUND'}}},'NOT_FOUND']]){
      await page.evaluate(r=>{fixtureTest.demoQueue(r);return fixtureTest.store.setFilters({});},reply);await status(page,want);assert.equal(await page.locator('.history-card').count(),0,want);assert.equal(await noOverflow(page),true,want);
      await page.screenshot({path:path.join(out,`dom-state-${want}-${viewport.width}.png`),fullPage:true});
    }
    await page.evaluate(()=>{fixtureTest.demoQueue({status:500,body:{}});return fixtureTest.store.setFilters({});});await status(page,'SERVER_ERROR');await page.locator('[data-action=history-retry]').click();await page.locator('.history-card').first().waitFor();
    summary.checks.push(`PASS ${viewport.width} DOM: list, paging, filter reset, v1/v2 detail, state screens, retry, no overflow`);await context.close();
  }
  if(process.env.CARSCOPE_3D_TEST_URL){
    const url=process.env.CARSCOPE_3D_TEST_URL,I='__inspect';
    const settled=(page,name)=>page.waitForFunction(n=>__inspect.state.name===n&&!__inspect.busy,name,{timeout:25000});
    const open=async page=>{await page.goto(url);await page.waitForFunction(()=>!!window.__inspectReady,null,{timeout:60000});await page.locator('#start').click();await settled(page,'INSPECTION_OVERVIEW');};
    // 1. The unmodified production page.
    const plain=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'}),prod=await plain.newPage();prod.on('pageerror',e=>summary.errors.push(e.message));
    const requests=[];prod.on('request',r=>requests.push(r.url()));
    await open(prod);await prod.locator('#panel [data-action=open-history]').click();await settled(prod,'HISTORY_LIST');
    await status(prod,'UNAVAILABLE');assert.equal(await prod.locator('.history-card').count(),0);assert.ok(!(await prod.locator('#panel').textContent()).includes('데모 데이터'));
    assert.ok(!requests.some(u=>/inspection-records|history-demo|\/test\//.test(u)),'production page requests no History API or demo module');
    assert.equal(await prod.evaluate(()=>__inspect.history().provider),'UNAVAILABLE');
    await prod.evaluate(()=>{for(const k of ['historyProvider','__historyProvider'])window[k]={origin:'VERIFIED_NATIVE',list(){throw Error('used');},detail(){throw Error('used');}};location.hash='historyProvider=demo';window.postMessage({historyProvider:'demo'},'*');});
    await prod.locator('#panel [data-action=back]').click();await settled(prod,'INSPECTION_OVERVIEW');assert.equal(await prod.evaluate(()=>document.activeElement.dataset.action),'open-history');
    await prod.locator('#panel [data-action=open-history]').click();await status(prod,'UNAVAILABLE');assert.equal(await prod.evaluate(()=>__inspect.history().origin),null,'no window, fragment or message can supply a provider');
    await prod.screenshot({path:path.join(out,'3d-production-unavailable-1440.png')});summary.checks.push('PASS real page without provider: UNAVAILABLE, not empty, no History or demo request, not injectable');await plain.close();
    // 2. Demo provider injected by this test context only.
    for(const viewport of [{width:1440,height:960},{width:430,height:900}]){
      const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>summary.errors.push(e.message));
      await page.route('**/inspect.js',async route=>{const response=await route.fetch(),source=await response.text();assert.ok(source.includes('createInspectionHistoryStore({provider:null})'));await route.fulfill({response,body:`import {demoHistoryProvider} from './test/history-demo-provider.mjs';\n`+source.replace('createInspectionHistoryStore({provider:null})','createInspectionHistoryStore({provider:demoHistoryProvider})')});});
      await open(page);
      await page.locator('[data-action=area][data-id=tires]').click();await page.locator('[data-action=tire][data-id="tire.front-left"]').first().click();
      for(const key of ['damage','debris','wear'])await page.locator(`input[data-check=${key}][value=FOUND]`).check();await page.locator('[data-action=confirm-tire]').click();
      const sessionBefore=await page.evaluate(()=>JSON.stringify([__inspect.userInspection(),__inspect.resultMap(),__inspect.resultPaint(),__inspect.nativeResults()])),sdkBefore=await page.evaluate(()=>JSON.stringify([__inspect.tireStatus(),__inspect.componentStatus(),__inspect.visibilityStatus()]));
      await page.locator('[data-action=product-summary]').click();await settled(page,'INSPECTION_SUMMARY');
      await page.locator('[data-action=result-detail][data-id="tire.front-left"]').click();await settled(page,'PART_RESULT');
      for(const kind of ['SESSION','HISTORY','SDK'])assert.equal(await page.locator(`#panel [data-source-zone=${kind}]`).count(),1,kind);
      await page.screenshot({path:path.join(out,`3d-part-zones-${viewport.width}.png`)});
      const pose=await page.evaluate(()=>__inspect.cameraPose());
      await page.locator('.source-zone[data-source-zone=HISTORY] [data-action=open-history]').click();await settled(page,'HISTORY_LIST');await page.locator('.history-card').first().waitFor();
      assert.deepEqual(await page.evaluate(()=>__inspect.cameraPose()),pose,'History keeps the camera');
      assert.equal(await page.locator('select[name=taskId]').inputValue(),'tire.front-left');assert.match(await page.locator('#historyFilterSummary').textContent(),/앞 왼쪽 타이어/);
      if(viewport.width===1440){const panelBox=await page.locator('#panel').boundingBox(),card=await page.locator('.history-card').first().boundingBox();assert.ok(card.y+44<panelBox.y+panelBox.height,'first record is on screen without scrolling');}
      assert.equal(await page.locator('#historyResults [data-source-zone=SESSION] .inspection-state').getAttribute('data-inspection-state'),'FINDINGS_REPORTED');
      assert.match(await page.locator('#panel').textContent(),/데모 데이터/);assert.equal(await noOverflow(page),true);await page.screenshot({path:path.join(out,`3d-list-${viewport.width}.png`)});
      await page.locator('.history-card').first().click();await settled(page,'HISTORY_DETAIL');await page.locator('.history-original').waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H2');assert.equal(await noOverflow(page),true);await page.screenshot({path:path.join(out,`3d-detail-${viewport.width}.png`)});
      assert.equal(await page.evaluate(()=>JSON.stringify([__inspect.userInspection(),__inspect.resultMap(),__inspect.resultPaint(),__inspect.nativeResults()])),sessionBefore,'opening a stored record changes no session data or paint');
      assert.equal(await page.evaluate(()=>JSON.stringify([__inspect.tireStatus(),__inspect.componentStatus(),__inspect.visibilityStatus()])),sdkBefore,'History reads no SDK state');
      const record=await page.evaluate(()=>__inspect.history().detail.recordId);
      // Android Back path: the shell's one step via the same dispatch; Escape uses it too.
      await page.keyboard.press('Escape');await settled(page,'HISTORY_LIST');assert.equal(await page.evaluate(()=>document.activeElement.dataset.record),record,'Back returns focus to the opened record');
      assert.equal(await page.evaluate(()=>__inspect.history().detail.record),null);
      // History follow-up: this session's result opened from History goes back to the same History screen, by every Back.
      const INTERNAL=/USER_REPORTED|taskId|partId|recordId|inspectionId|digest|NEEDS_REFILL|REVIEW_NEEDED|NO_FINDINGS_REPORTED|\bUNSURE\b|\bUNABLE\b|\bSELF\b|\bMOBILE\b/;
      const hist=()=>page.evaluate(()=>{const h=__inspect.history();return {filters:JSON.stringify(h.filters),items:h.list.items.map(r=>r.recordId).join(),status:h.list.status,detail:h.detail.recordId??null,state:__inspect.state.name,size:JSON.stringify(__inspect.state).length};});
      assert.doesNotMatch(await page.locator('#panel').innerText(),INTERNAL,'list in plain words');
      const listBefore=await hist();
      await page.locator('#panel').evaluate(p=>{p.scrollTop=Math.min(120,p.scrollHeight-p.clientHeight);});const listScroll=await page.locator('#panel').evaluate(p=>p.scrollTop);
      for(const [i,how] of ['panel','top bar','Escape'].entries()){
        await page.locator('#historyResults [data-action=history-session-part]').click();await settled(page,'PART_RESULT');
        assert.equal(await page.evaluate(()=>__inspect.state.component),'tire.front-left');
        assert.equal(await page.locator('#panel [data-source-zone=SESSION] .inspection-state').getAttribute('data-inspection-state'),'FINDINGS_REPORTED','this session\'s result, not a stored record');
        if(i===0)await page.locator('#panel .actions [data-action=back]').click();else if(i===1)await page.locator('#back').click();else await page.keyboard.press('Escape');
        await settled(page,'HISTORY_LIST');
        assert.deepEqual(await hist(),listBefore,`${how}: same filters and records, no reload, no growth`);
        assert.equal(await page.locator('#panel').evaluate(p=>p.scrollTop),listScroll,`${how}: reading position kept`);
        assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'history-session-part',`${how}: focus back on the control`);
      }
      const openFilters=()=>page.locator('.history-filters').evaluate(d=>{d.open=true;});
      // All parts with a second page, then a record's detail → this session's hood-part result → Back → Back.
      await openFilters();await page.locator('select[name=taskId]').selectOption('');await page.waitForFunction(()=>__inspect.history().list.status==='SUCCESS'&&__inspect.history().filters.taskId===null);
      if(await page.locator('[data-action=history-more]').count()){const n=await page.locator('.history-card').count();await page.locator('[data-action=history-more]').click();await page.waitForFunction(n=>document.querySelectorAll('.history-card').length>n,n);}
      const paged=await hist();assert.ok(paged.items.split(',').length>20,'two pages loaded');
      const card=page.locator('.history-card[data-task="brake-fluid"]').first();await card.scrollIntoViewIfNeeded();const pagedScroll=await page.locator('#panel').evaluate(p=>p.scrollTop);
      await card.click();await settled(page,'HISTORY_DETAIL');await page.locator('.history-original').waitFor();
      const detailBefore=await hist();assert.doesNotMatch(await page.locator('#panel').innerText(),INTERNAL,'detail in plain words');
      await page.locator('#historyResults [data-action=history-session-part]').click();await settled(page,'PART_RESULT');
      assert.equal(await page.evaluate(()=>__inspect.state.component),'brake-fluid-reservoir');assert.equal(await page.evaluate(()=>__inspect.hoodAngle),60);
      await page.keyboard.press('Escape');await settled(page,'HISTORY_DETAIL');
      assert.deepEqual(await hist(),detailBefore,'same record, still loaded, no reload');assert.equal(await page.evaluate(()=>__inspect.hoodAngle),0,'the hood closed for History');
      await page.locator('#panel .actions [data-action=back]').click();await settled(page,'HISTORY_LIST');
      const after=await hist();assert.equal(after.items,paged.items,'both pages kept');assert.equal(after.filters,paged.filters);
      assert.equal(await page.locator('#panel').evaluate(p=>p.scrollTop),pagedScroll,'list position kept');
      await openFilters();await page.locator('select[name=taskId]').selectOption('tire.front-left');await page.locator('.history-card').first().waitFor();
      // Paused or hidden screen drops records and reads fresh on return.
      await page.evaluate(()=>dispatchEvent(new Event('carscope-tire-inactive')));assert.equal(await page.evaluate(()=>__inspect.history().list.items.length),0);assert.equal(await page.locator('.history-card').count(),0);
      await page.evaluate(()=>dispatchEvent(new Event('carscope-tire-active')));await page.locator('.history-card').first().waitFor();
      await page.locator('#back').click();await settled(page,'PART_RESULT');assert.equal(await page.evaluate(()=>__inspect.state.component),'tire.front-left');assert.deepEqual(await page.evaluate(()=>__inspect.history().list.items.length),0,'leaving History keeps no records');
      // Existing flows after History: mobile request path, parts, summary, end.
      await page.locator('[data-action=request-mobile]').waitFor();assert.equal(await page.evaluate(()=>__inspect.nativeResults().connection),'INCOMPLETE_NATIVE');
      await page.locator('[data-action=product-summary]').click();await settled(page,'INSPECTION_SUMMARY');
      // The summary lists parts only (P10 PR #2): open a hood part from it, then end from the open-hood screen.
      await page.locator('[data-action=result-detail][data-id="washer-fluid-cap"]').click();await settled(page,'PART_RESULT');
      await page.locator('[data-action=exit]').click();if(await page.locator('#exitConfirm:not([hidden])').count())await page.locator('#exitConfirm [data-action=exit-confirm]').click();await settled(page,'IDLE');assert.equal(await page.evaluate(()=>__inspect.history().list.status),'IDLE');
      await page.locator('#start').click();await settled(page,'INSPECTION_OVERVIEW');await page.locator('#panel [data-action=open-history]').click();await page.locator('.history-card').first().waitFor();
      await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.evaluate(()=>__inspect.history().provider),'DISPOSED');assert.equal(await page.evaluate(()=>__inspect.history().list.items.length),0);
      summary.checks.push(`PASS ${viewport.width} real GLB: zones, camera kept, session/SDK unchanged, Back/focus, History→this session result→Back by panel/top bar/Escape (filters, pages, scroll, record kept, no growth), plain words, pause, leave, regressions, dispose`);await context.close();
    }
  }
  assert.deepEqual(summary.errors,[]);summary.status='PASS';
}catch(error){summary.status='FAIL';summary.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
