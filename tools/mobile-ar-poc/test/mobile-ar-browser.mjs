// P7-B: synthetic browser matrix; real camera/phone/part accuracy remain NOT_RUN.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHandler} from '../server.mjs';
import {taskLinks} from '../public/inspection-tasks.mjs';
import {startMobileDevServer} from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import {LocalTestSessionCreationAuthorizer} from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import {ReceiverClient} from '../../inspection-sync-poc/bin/receiver.mjs';
const base=process.env.POC_EVIDENCE_DIR;
if(!base||!path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\'))throw Error('Set external POC_EVIDENCE_DIR');
const output=path.join(base,'p7-b');await mkdir(output,{recursive:true});
const result={kind:'SYNTHETIC_BROWSER_ONLY',realPhone:'NOT_RUN',realPartAccuracy:'NOT_RUN',checks:[],errors:[]};
const server=http.createServer(createHandler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const root=`http://127.0.0.1:${server.address().port}`;let browser,sync;
try{
  browser=await chromium.launch({channel:process.env.POC_BROWSER_CHANNEL??'msedge',headless:true});result.browser=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await context.addInitScript(()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');
    window.fixture={mode:'normal',streams:[],requests:0,release:null};
    setInterval(()=>{ctx.fillStyle='#707a85';ctx.fillRect(0,0,160,120);},60);
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
      fixture.requests++;if(fixture.mode==='denied')throw new DOMException('denied','NotAllowedError');
      if(fixture.mode==='pending')await new Promise(resolve=>fixture.release=resolve);
      const stream=canvas.captureStream(12);fixture.streams.push(stream);return stream;
    }}});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>result.errors.push(e.message));
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const state=()=>page.evaluate(()=>(window.__checklistInspection??window.__selfInspection).state);
  const ended=()=>page.evaluate(()=>fixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  const next=async id=>{await page.locator(id).click();await page.waitForTimeout(370);};
  const ready=()=>page.waitForFunction(()=>document.querySelector('#placeholder').hidden);
  const start=async camera=>{
    if(await page.locator('#safety').count())await page.locator('#safety').check();
    if(await page.locator('#not-charging').count())await page.locator('#not-charging').check();
    await next(camera?'#primary':'#manual-start');
  };
  const tap=async()=>{
    await page.locator('#stage').scrollIntoViewIfNeeded();const b=await page.locator('#stage').boundingBox();
    await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await page.waitForFunction(()=>document.querySelector('#stage').hasAttribute('data-marked'));
  };
  const open=async task=>{await page.goto('about:blank');await page.goto(root+'/'+task.href);await page.waitForFunction(()=>!!(window.__checklistInspection??window.__selfInspection));};
  for(const task of taskLinks()){
    await open(task);await start(true);await ready();await tap();
    assert.match(await page.locator('.part-location').textContent(),new RegExp(task.label));
    if(task.id.startsWith('tire.'))assert.equal(await page.locator('.part-location .wheel-map [aria-current]').count(),1);
    if(['coolant-reservoir','wiper.front.left','light-low-beam-left-0'].includes(task.id)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,task.id+'-camera.png'),fullPage:true});}
    await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!document.querySelector('#stage').hasAttribute('data-marked'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(task.id==='coolant-reservoir'){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'coolant-landscape.png'),fullPage:true});}
    await page.setViewportSize({width:390,height:844});await tap();
    // Mute does not always emit ended/currentTime changes: handle it immediately.
    await page.evaluate(()=>fixture.streams.at(-1).getTracks()[0].dispatchEvent(new Event('mute')));
    assert.equal(await ended(),true);assert.equal(await page.locator('#stage').getAttribute('data-marked'),null);
    assert.equal(await page.locator('#start').isEnabled(),true);
    await page.locator('#start').click();await ready();await tap();
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await ended(),true);await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.evaluate(()=>document.querySelector('#video').srcObject),null,'foreground never auto-starts');
    await next('#locate-manual');assert.equal((await state()).mode,'manual');
    assert.equal(await page.locator('.part-location').isVisible(),true);
    // Fresh attempt: pending grant after manual transition must not turn camera on.
    await open(task);await page.evaluate(()=>fixture.mode='pending');await start(true);
    await next('#locate-manual');await page.evaluate(()=>fixture.release());await page.waitForTimeout(150);
    assert.equal(await ended(),true);assert.equal((await state()).record.aids.cameraUsed,false);
    await open(task);await page.evaluate(()=>fixture.mode='denied');await start(true);
    assert.match(await page.locator('#status').textContent(),/권한/);assert.equal((await state()).record.aids.cameraUsed,false);
    await next('#locate-manual');assert.equal((await state()).step,'check');
    result.checks.push(`PASS ${task.id}: guide, marker, rotation, mute, background, manual, pending grant, denial`);
    console.log(result.checks.at(-1));
  }
  assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith(root+'/')),'camera aid never uploads media');
  await open(taskLinks()[0]);await start(true);await ready();await tap();
  await page.evaluate(()=>Object.defineProperty(document.querySelector('#video'),'readyState',{configurable:true,value:0}));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('영상이 준비되지'));
  assert.equal(await ended(),true);assert.equal(await page.locator('#stage').getAttribute('data-marked'),null);
  result.checks.push('PASS unavailable video readiness clears overlay and stops camera within bounded wait');
  // QR v2 task binding + schema versions through the unchanged real HTTP/Node receiver.
  // Each task gets an isolated service, keeping the production 10/min creation limiter intact.
  for(const task of taskLinks()){
    sync=await startMobileDevServer({port:0,authorizer:new LocalTestSessionCreationAuthorizer()});
    const receiver=new ReceiverClient({baseUrl:sync.url});const session=await receiver.create(task.id);
    await page.goto(sync.url+'/'+session.fragment);await page.waitForFunction(()=>!!(window.__checklistInspection??window.__selfInspection));
    assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.locator('.task-links').count(),0);
    await page.waitForFunction(()=>document.querySelector('#sync-claim').disabled);
    await start(false);
    if(task.id==='washer-fluid'){
      await next('#unsure-check');await next('#primary');
    }else{
      for(let i=0;i<3;i++){await page.locator('fieldset input[value=UNABLE]').check();await next('#primary');}
      await next('#primary');
    }
    await page.waitForFunction(()=>!document.querySelector('#sync-send').disabled);await page.locator('#sync-send').click();
    await page.waitForFunction(()=>document.querySelector('#done-sync').dataset.syncState==='SENT');
    const received=await receiver.view();assert.equal(received.result.taskId,task.id);assert.equal(received.result.schemaVersion,task.id==='washer-fluid'?1:2);
    assert.equal(received.result.confirmation,'USER_REPORTED');await receiver.accept(received.resultDigest);
    await page.locator('#sync-refresh').click();await page.waitForFunction(()=>document.querySelector('#done-sync').dataset.syncState==='ACCEPTED');
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    if(task.id==='battery-12v')await page.screenshot({path:path.join(output,'battery-node-accepted.png'),fullPage:true});
    result.checks.push(`PASS QR v2 ${task.id} -> schema v${received.result.schemaVersion} -> explicit send -> Node accept`);
    console.log(result.checks.at(-1));
    await sync.stop();sync=null;
  }
  assert.deepEqual(result.errors,[]);result.status='PASS';await context.close();
}catch(error){result.status='FAIL';result.errors.push((error.stack??error.message).replace(/invite=[A-Za-z0-9_-]+/g,'invite=[REDACTED]'));process.exitCode=1;}
finally{await browser?.close();await sync?.stop();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
