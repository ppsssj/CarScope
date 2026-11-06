// Synthetic mobile Chrome only: canvas stream / injected permissions / simulated lifecycle events.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHandler} from '../server.mjs';
import {validateChargeResult} from '../public/charge-result.mjs';
import {startMobileDevServer} from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import {LocalTestSessionCreationAuthorizer} from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import {ReceiverClient} from '../../inspection-sync-poc/bin/receiver.mjs';
const base=process.env.POC_EVIDENCE_DIR;
if(!base || !path.isAbsolute(base) || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external POC_EVIDENCE_DIR');
const output=path.join(base,'charge');await mkdir(output,{recursive:true});
const result={kind:'SYNTHETIC_CHROME_MOBILE_ONLY',realPhone:'NOT_RUN',realCamera:'NOT_RUN',realAndroid:'NOT_RUN',checks:[],errors:[]};
const pass=s=>result.checks.push(s);
const server=http.createServer(createHandler());await new Promise(r=>server.listen(0,'127.0.0.1',r));
const root=`http://127.0.0.1:${server.address().port}`;
let browser,sync;
try {
  browser=await chromium.launch({channel:process.env.POC_BROWSER_CHANNEL??'chrome',headless:true});result.browser=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const c=canvas.getContext('2d');setInterval(()=>{c.fillStyle='#66727c';c.fillRect(0,0,640,480);c.strokeStyle='#202830';c.lineWidth=15;c.strokeRect(150,90,340,300);},60);
    window.testCamera={mode:'normal',requests:0,streams:[],release:null};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async options=>{
      testCamera.requests++;testCamera.options=options;
      if(testCamera.mode==='denied')throw new DOMException('denied','NotAllowedError');
      if(testCamera.mode==='pending')await new Promise(r=>testCamera.release=r);
      const stream=canvas.captureStream(12);testCamera.streams.push(stream);return stream;
    }}});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',()=>result.errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')result.errors.push('console error');});
  const state=()=>page.evaluate(()=>window.__chargeInspection.state);
  const step=s=>page.waitForFunction(s=>window.__chargeInspection?.state.step===s,s);
  // Reopening the identical fragment is same-document navigation: explicitly reload to start a fresh page attempt.
  const open=async()=>{await page.goto(root+'/#task=ev-charge.port');await page.reload();await step('intro');};
  const nav=async id=>{await page.locator(id).click();await page.waitForTimeout(370);};
  const safe=async()=>{await page.locator('#safety').check();await page.locator('#not-charging').check();};
  const ended=()=>page.evaluate(()=>testCamera.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  const answer=async value=>{await page.locator(`#inspection-answers input[value=${value}]`).check();};
  const answerAll=async(values=['NOT_FOUND','NOT_FOUND','UNABLE'])=>{for(const value of values){await answer(value);await nav('#primary');}await step('review');};
  const tap=async()=>{
    await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);
    const p=await page.evaluate(async()=>{const stage=document.querySelector('#stage');stage.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=stage.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
    await page.touchscreen.tap(p.x,p.y);await page.waitForFunction(()=>!!window.__chargeInspection.mark);
  };
  await open();assert.equal((await state()).taskId,'ev-charge.port');
  assert.match(await page.locator('#step-intro').innerText(),/현재 차량과 모델의 일치는 확인되지/);
  assert.equal(await page.locator('#primary').isDisabled(),true);await page.locator('#safety').check();assert.equal(await page.locator('#manual-start').isDisabled(),true);
  assert.equal(await page.evaluate(()=>testCamera.requests),0);await page.locator('#not-charging').check();await nav('#manual-start');
  assert.equal(await page.locator('#primary').isDisabled(),true);assert.deepEqual((await state()).record.responses,{});
  const radio=page.locator('#inspection-answers input[value=NOT_FOUND]');await radio.focus();await page.keyboard.press('Space');assert.equal(await radio.evaluate(e=>document.activeElement===e),true);
  await nav('#primary');await answer('NOT_FOUND');await nav('#primary');await answer('UNABLE');await nav('#primary');await step('review');
  await nav('#back');assert.equal((await state()).record.responses.visibleDamage,'UNABLE');await answer('NOT_FOUND');await nav('#primary');
  await page.locator('#primary').evaluate(b=>{b.click();b.click();});await step('done');
  const first=(await state()).record;assert.deepEqual(validateChargeResult(first),[]);assert.equal(first.status,'NO_FINDINGS_REPORTED');assert.equal(first.confirmation,'USER_REPORTED');
  assert.equal(await page.locator('#primary').isDisabled(),true);await page.screenshot({path:path.join(output,'01-confirmed.png'),fullPage:true});
  await page.waitForFunction(()=>!document.querySelector('#primary').disabled);await nav('#primary');await step('intro');assert.equal((await state()).notCharging,false);assert.equal((await state()).record,null);
  pass('exact charge task, conditional model location, dual safety gate, manual checklist/keyboard, partial block, review/edit, duplicate confirmation and fresh attempt');

  await safe();await nav('#primary');await step('locate');await page.waitForFunction(()=>window.__chargeInspection.state.record.aids.cameraUsed);
  assert.equal(await page.evaluate(()=>testCamera.options.video.facingMode.ideal),'environment');await tap();await page.screenshot({path:path.join(output,'02-camera.png'),fullPage:true});
  await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>window.__chargeInspection.mark===null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'03-landscape.png'),fullPage:true});
  await page.locator('#stop').click();assert.equal(await ended(),true);await page.locator('#start').click();await tap();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await ended(),true);assert.equal(await page.evaluate(()=>window.__chargeInspection.mark),null);
  await page.evaluate(()=>delete document.hidden);await page.locator('#start').click();await tap();await page.evaluate(()=>document.querySelector('#video').pause());
  await page.waitForFunction(()=>window.__chargeInspection.mark===null);
  assert.equal(await ended(),true);assert.equal(await page.evaluate(()=>window.__chargeInspection.mark),null);
  pass('rear-camera request, manual 2D mark, landscape reset, stop/restart, simulated background and video pause stop all tracks');

  await page.setViewportSize({width:390,height:844});await page.locator('#start').click();await tap();await nav('#primary');await step('check');
  assert.equal(await page.evaluate(()=>window.__chargeInspection.mark),null);await answer('FOUND');assert.equal((await state()).observationStopped,true);
  assert.equal((await state()).mode,'manual');assert.equal(await ended(),true);assert.deepEqual((await state()).record.responses,{flapDamage:'FOUND'});
  assert.equal(await page.locator('#observation-stopped').isVisible(),true);
  await nav('#primary');assert.equal(await page.locator('#primary').isDisabled(),true);await answer('UNABLE');await nav('#primary');await answer('UNABLE');await nav('#primary');await nav('#primary');await step('done');
  assert.equal((await state()).record.status,'REVIEW_NEEDED');assert.equal((await state()).record.responses.debris,'UNABLE');
  pass('finding stops observation without auto-filling; remaining unknown answers are explicit USER_REPORTED and no safety/charging verdict');

  await open();await page.evaluate(()=>testCamera.mode='denied');await safe();await nav('#primary');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('권한'));
  assert.equal((await state()).record.aids.cameraUsed,false);await nav('#locate-manual');await answerAll(['UNABLE','UNABLE','UNABLE']);await nav('#primary');await step('done');assert.equal((await state()).record.status,'UNABLE');
  pass('permission denial keeps manual route; all UNABLE remains incomplete observation, never fabricated camera use');

  await open();await page.evaluate(()=>testCamera.mode='pending');await safe();await page.locator('#primary').dblclick();await page.waitForFunction(()=>testCamera.requests===1);await page.waitForTimeout(370);await nav('#back');await step('intro');
  await page.evaluate(()=>testCamera.release());await page.waitForTimeout(250);assert.equal(await ended(),true);assert.equal((await state()).record,null);
  await page.evaluate(()=>testCamera.mode='normal');await safe();await nav('#manual-start');await answer('UNABLE');await page.locator('#cancel').click();await page.locator('#cancel-no').click();assert.equal((await state()).record.responses.flapDamage,'UNABLE');
  await page.locator('#cancel').click();await page.locator('#cancel-yes').click();await step('intro');assert.equal((await state()).record,null);
  await safe();await nav('#primary');await tap();await page.locator('#safety-stop').click();await step('check');
  assert.equal(await ended(),true);assert.equal((await state()).observationStopped,true);assert.deepEqual((await state()).record.responses,{});
  assert.equal(await page.locator('#primary').isDisabled(),true);
  pass('duplicate Start has one permission request; Back invalidates pending stream; cancel resumes/discards; voluntary observation stop never fills answers');

  sync=await startMobileDevServer({port:0,authorizer:new LocalTestSessionCreationAuthorizer()});
  const receiver=new ReceiverClient({baseUrl:sync.url}),session=await receiver.create('ev-charge.port');
  await page.goto(sync.url+'/'+session.fragment);await step('intro');assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.locator('.task-links').count(),0);
  await page.waitForFunction(()=>document.querySelector('#sync-claim').disabled);
  await safe();await nav('#manual-start');await answerAll();await nav('#primary');await step('done');
  await page.waitForFunction(()=>!document.querySelector('#sync-send').disabled);assert.equal((await receiver.view()).result,null);
  let submits=0;page.on('request',r=>{if(r.url().endsWith('/v1/submissions')&&r.method()==='POST')submits++;});
  await page.locator('#sync-send').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>document.querySelector('#done-sync').dataset.syncState==='SENT');assert.equal(submits,1);
  const received=await receiver.view();assert.equal(received.result.taskId,'ev-charge.port');assert.equal(received.result.responses.visibleDamage,'UNABLE');
  await receiver.accept(received.resultDigest);await page.locator('#sync-refresh').click();await page.waitForFunction(()=>document.querySelector('#done-sync').dataset.syncState==='ACCEPTED');
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.ok(!(await page.content()).includes(session.fragment.split('invite=')[1]));
  await page.screenshot({path:path.join(output,'04-node-accepted.png'),fullPage:true});
  pass('QR v2 exact task/claim, explicit double-send single request, verified server receipt then Node receiver accept; no token in DOM/storage');
  assert.deepEqual(result.errors,[]);result.status='PASS';await context.close();
} catch(e) {result.status='FAIL';result.errors.push((e.stack??e.message).replace(/invite=[A-Za-z0-9_-]+/g,'invite=[REDACTED]'));process.exitCode=1;}
finally {await browser?.close();await sync?.stop();await new Promise(r=>server.close(r));await writeFile(path.join(output,'browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
