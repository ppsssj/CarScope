// Pure DOM CI + optional real-GLB page test. Synthetic authority ONLY; real Native acceptance NOT_RUN.
import {createRequire} from 'node:module';import {readFile,mkdir,writeFile} from 'node:fs/promises';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';
import {MOBILE_TARGETS} from '../mobile-result-contract.mjs';import {wireResult} from './result-fixtures.mjs';
const require=createRequire(new URL('../../mobile-ar-poc/package.json',import.meta.url)),{chromium}=require('playwright');
const out=process.env.CARSCOPE_EVIDENCE_DIR;if(!out||!path.isAbsolute(out)||!path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external CARSCOPE_EVIDENCE_DIR');await mkdir(out,{recursive:true});
const summary={scope:process.env.CARSCOPE_3D_TEST_URL?'REAL_REFERENCE_GLB_AND_SYNTHETIC_AUTHORITY':'DOM_ONLY_SYNTHETIC_AUTHORITY_NO_3D',nativeAcceptedTo3d:'NOT_RUN',checks:[],errors:[]};
const fixtureHtml=`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;background:#171b21;color:#eee;margin:12px}button{min-height:44px;max-width:100%;white-space:normal;overflow-wrap:anywhere}ul{padding:0;list-style:none}.item{display:grid;width:100%;text-align:left}.record-picker{display:grid;gap:8px}pre,dd{overflow-wrap:anywhere;white-space:pre-wrap}dd{margin:0}</style><h1>SYNTHETIC TEST ONLY · Native 연결 아님</h1><main id="fixture"></main><script type="module">
import {createTireInspection} from '/tire-inspection.mjs';import {createNativeInspectionResults} from '/native-inspection-results.mjs';import {projectInspectionResults} from '/inspection-results.mjs';import {partResultHtml,resultSummaryHtml} from '/inspection-results-view.mjs';import {fixtureAdapter,publish} from '/test/native-results-browser-fixture.mjs';
const local=createTireInspection('fixture-local'),store=createNativeInspectionResults({adapter:fixtureAdapter});let part=null;const root=document.getElementById('fixture');
function render(){root.innerHTML=part?partResultHtml(local,store.snapshot,part)+'<button data-back>목록</button>':resultSummaryHtml(local,store.snapshot);}store.subscribe(render);store.startSession(local.sessionId);
root.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.action==='result-detail'){part=b.dataset.id;render();}if(b.dataset.action==='select-result')store.select(b.dataset.task,b.dataset.record);if(b.hasAttribute('data-back')){part=null;render();}};
window.fixtureTest={publish,rows:()=>projectInspectionResults(local,store.snapshot),snapshot:()=>store.snapshot};render();</script></html>`;
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(fixtureHtml);return;}const rel=decodeURIComponent(req.url.slice(1)),base=new URL('../',import.meta.url),file=new URL(rel,base);if(!file.href.startsWith(base.href)||!file.pathname.endsWith('.mjs'))throw Error('Denied');res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL??'chrome',headless:true});summary.browser=browser.version();
  const fixtures=MOBILE_TARGETS.map((t,i)=>({target:t,result:wireResult(t.taskId,['FOUND','UNABLE','NOT_FOUND'][i%3],`${(i+1).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`)}));
  for(const viewport of [{width:1440,height:960},{width:430,height:900}]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>summary.errors.push(e.message));
    await page.goto(root);await page.waitForFunction(()=>!!window.fixtureTest);
    for(const {target:t,result:r}of fixtures)assert.equal((await page.evaluate(async({t,r})=>window.fixtureTest.publish(r,t.partId),{t,r})).delivered,'STAGED');
    assert.equal(await page.evaluate(()=>fixtureTest.rows().filter(r=>r.status==='NOT_INSPECTED').length),17);
    for(const {target:t,result:r}of fixtures){await page.locator(`[data-action=result-detail][data-id="${t.partId}"]`).click();await page.locator(`[data-record="${r.inspectionId}"]`).click();assert.match(await page.locator('.part-results').textContent(),/MOBILE/);assert.match(await page.locator('.part-results').textContent(),/2026-11-04T01:02:03.000Z/);await page.locator('[data-back]').click();}
    assert.equal(await page.evaluate(()=>fixtureTest.rows().filter(r=>r.source==='MOBILE').length),17);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(out,`dom-${viewport.width}.png`),fullPage:true});summary.checks.push(`PASS ${viewport.width} DOM: 17 staged/explicit selections, statuses, original time, provenance, no overflow`);await context.close();
  }
  if(process.env.CARSCOPE_3D_TEST_URL){
    const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>summary.errors.push(e.message));
    const open=async()=>{await page.goto(process.env.CARSCOPE_3D_TEST_URL);await page.waitForFunction(()=>!!window.__inspectReady);await page.locator('#start').click();await page.waitForFunction(()=>__inspect.state.name==='INSPECTION_OVERVIEW'&&!__inspect.busy);};
    await open();assert.equal(await page.evaluate(()=>__inspect.nativeResults().connection),'INCOMPLETE_NATIVE');
    await page.evaluate(r=>{window.postMessage({sessionState:'ACCEPTED',result:r,trusted:true},'*');location.hash='result='+encodeURIComponent(JSON.stringify(r));},fixtures[0].result);
    assert.equal(await page.evaluate(()=>__inspect.resultMap().filter(r=>r.status==='NOT_INSPECTED').length),17);
    assert.equal(await page.evaluate(()=>Object.keys(__inspect).some(k=>/receive|inject|accept/i.test(k))),false);
    summary.checks.push('PASS actual production page: no adapter, postMessage/fragment/JSON cannot create completion');
    // Network interception in this test context only. The committed page still constructs no adapter.
    await page.route('**/inspect.js',async route=>{const response=await route.fetch(),source=await response.text();assert.ok(source.includes('createNativeInspectionResults()'));await route.fulfill({response,body:`import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n`+source.replace('createNativeInspectionResults()','createNativeInspectionResults({adapter:fixtureAdapter})')});});
    await open();const sdkBefore=await page.evaluate(()=>JSON.stringify([__inspect.tireStatus(),__inspect.componentStatus(),__inspect.visibilityStatus()]));
    // Existing local tire controls remain independently usable.
    await page.locator('[data-action=area][data-id=tires]').click();await page.locator('[data-action=tire][data-id="tire.front-left"]').first().click();
    for(const key of ['damage','debris','wear'])await page.locator(`input[data-check=${key}][value=FOUND]`).check();await page.locator('[data-action=confirm-tire]').click();
    const localBefore=await page.evaluate(()=>JSON.stringify(__inspect.userInspection()));
    for(const {target:t,result:r}of fixtures)assert.equal((await page.evaluate(async({t,r})=>{const f=await import('./test/native-results-browser-fixture.mjs');return f.publish(r,t.partId);},{t,r})).delivered,'STAGED');
    assert.equal(await page.evaluate(()=>__inspect.resultMap().filter(r=>r.source==='MOBILE').length),0);assert.equal(await page.evaluate(()=>JSON.stringify(__inspect.userInspection())),localBefore);
    await page.locator('[data-action=product-summary]').click();await page.waitForFunction(()=>__inspect.state.name==='INSPECTION_SUMMARY'&&!__inspect.busy);
    for(const {target:t,result:r}of fixtures.slice(0,16)){
      await page.locator(`[data-action=result-detail][data-id="${t.partId}"]`).click();await page.waitForFunction(()=>__inspect.state.name==='PART_RESULT'&&!__inspect.busy);
      if(t.taskId==='lcw-coolant-reservoir')assert.match(await page.locator('#panel').textContent(),/형상이 없거나/);
      const geometryCount=await page.evaluate(()=>__inspect.renderInfo.geometries);
      await page.locator(`[data-record="${r.inspectionId}"]`).click();assert.equal(await page.evaluate(id=>__inspect.resultMap().find(r=>r.taskId===id).source,t.taskId),'MOBILE');
      assert.equal(await page.evaluate(()=>__inspect.renderInfo.geometries),geometryCount,'selection of a report creates no geometry');
      await page.locator('[data-action=back]').click();await page.waitForFunction(()=>__inspect.state.name==='INSPECTION_SUMMARY'&&!__inspect.busy);
    }
    assert.equal(await page.evaluate(()=>__inspect.resultMap().filter(r=>r.source==='MOBILE').length),16);assert.equal(await page.evaluate(()=>__inspect.resultMap().find(r=>r.taskId==='light-high-beam-right-0').status),'NOT_INSPECTED');
    assert.equal(await page.evaluate(()=>__inspect.componentInfo().some(c=>c.id==='lcw-coolant-reservoir')),false);
    assert.equal(await page.evaluate(()=>__inspect.resultPaint().every(p=>{const row=__inspect.resultMap().find(r=>r.partId===p.partId);return row.status==='NOT_INSPECTED'||p.colors.every(c=>c===row.color);})),true,'all existing selected parts use the report color');
    assert.equal(await page.evaluate(()=>JSON.stringify(__inspect.userInspection())),localBefore);assert.equal(await page.evaluate(()=>JSON.stringify([__inspect.tireStatus(),__inspect.componentStatus(),__inspect.visibilityStatus()])),sdkBefore);
    await page.screenshot({path:path.join(out,'3d-desktop-summary.png')});
    for(const viewport of [{width:1440,height:960},{width:430,height:900}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(250);await page.locator('[data-action=result-detail][data-id="battery-12v"]').click();await page.waitForFunction(()=>!__inspect.busy);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.part-results').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`3d-detail-${viewport.width}.png`)});await page.locator('[data-action=back]').click();await page.waitForFunction(()=>__inspect.state.name==='INSPECTION_SUMMARY'&&!__inspect.busy);
    }
    await page.locator('[data-action=exit]').click();await page.waitForFunction(()=>__inspect.state.name==='IDLE'&&!__inspect.busy);assert.equal(await page.evaluate(()=>__inspect.nativeResults().records.length),0);assert.equal(await page.evaluate(()=>__inspect.resultPaint().every(p=>p.colors.every((c,i)=>c===p.baseColors[i]))),true);
    await page.locator('#start').click();await page.waitForFunction(()=>__inspect.state.name==='INSPECTION_OVERVIEW');assert.equal(await page.evaluate(()=>__inspect.resultMap().filter(r=>r.status==='NOT_INSPECTED').length),17);
    const stale=await page.evaluate(async({t,r})=>(await import('./test/native-results-browser-fixture.mjs')).publish(r,t.partId,0),{t:fixtures[0].target,r:fixtures[0].result});assert.equal(stale.delivered,'OLD_SESSION');
    await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.evaluate(()=>__inspect.nativeResults().connection),'DISPOSED');
    summary.checks.push('PASS real GLB desktop/mobile: separate local/mobile, explicit selection, LCW list-only, independent lights, original time, unchanged SDK, end/new session/late callback');await context.close();
  }
  assert.deepEqual(summary.errors,[]);summary.status='PASS';
}catch(error){summary.status='FAIL';summary.errors.push(error.stack??String(error));process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
