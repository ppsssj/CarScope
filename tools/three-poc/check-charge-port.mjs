// Real GLB and actual Kotlin MOCK serializer output. No vehicle/Android runtime claim.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateChargePortStatus } from './ev-charge-status.mjs';
const [folder,goldenFile] = process.argv.slice(2), here=dirname(fileURLToPath(import.meta.url));
const out=resolve(folder??''), rel=relative(resolve(here,'../..'),out), width=Number(process.argv[4]??1600),height=Number(process.argv[5]??1000);
if(!folder||!goldenFile||!(rel.startsWith('..'+sep)||isAbsolute(rel))||!process.env.CARSCOPE_IONIQ5_GLB)throw Error('External output, Kotlin golden and CARSCOPE_IONIQ5_GLB required');
const golden=validateChargePortStatus(JSON.parse(readFileSync(goldenFile,'utf8')));if(golden.readings[0].source!=='MOCK')throw Error('Synthetic MOCK only');
mkdirSync(out,{recursive:true});const fixture=join(out,'fixture.json');const update=p=>{writeFileSync(fixture+'.tmp',JSON.stringify(p));renameSync(fixture+'.tmp',fixture);};update(golden);
const server=spawn(process.execPath,[join(here,'serve.mjs')],{env:{...process.env,PORT:'0',CARSCOPE_CHARGE_UI_FIXTURE:fixture},stdio:['ignore','pipe','pipe']});
try{
  let log='';const origin=await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('Startup timeout')),10000);server.stdout.on('data',b=>{log+=b;const m=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m){clearTimeout(timer);ok(m[0]);}});server.once('error',fail);server.once('exit',c=>fail(Error('Server exit '+c)));});
  const I='window.__inspect',ev=s=>['eval',s],until=s=>['until',s,20000],settled=s=>until(`${I}.state.name==='${s}'&&!${I}.busy`);
  const expect=(s,label)=>ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: '+label)};})()`);
  const click=s=>[ev(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'});true`),['click',s]];
  const stage=s=>ev(JSON.stringify('CHARGE_STAGE:'+s));
  const marker=s=>ev(`(()=>{const p=${s};if(!p)throw Error('No actual visible ray target');let m=document.getElementById('chargeHit');if(!m){m=document.createElement('span');m.id='chargeHit';document.body.appendChild(m);}m.style.cssText='position:fixed;pointer-events:none;width:2px;height:2px;z-index:999;left:'+p.x+'px;top:'+p.y+'px';return 'target';})()`);
  const rayClick=id=>[marker(`${I}.chargePoint('${id}')`),['click','#chargeHit']];
  const preserved=`${I}.state===window.__chargeFlow&&JSON.stringify(${I}.cameraPose())===window.__chargePose&&${I}.userInspection().sessionId===window.__chargeUser&&JSON.stringify(${I}.chargeGeometry().parts)===window.__chargeGeometry&&${I}.renderInfo.geometries===window.__chargeCount`;
  const actions=[until(`window.__inspectReady&&${I}.chargePortStatus().readings[0].source==='MOCK'`),
    expect(`${I}.chargeGeometry().status==='AVAILABLE'&&${I}.chargeGeometry().sourceUnchanged&&${I}.chargeGeometry().sourceMeshCount>0`,'all original world meshes measured without source mutation or fallback'),
    ['click','#start'],settled('INSPECTION_OVERVIEW'),...click('[data-action=area][data-id=ev-charge]'),settled('CHARGE_PORT_PREVIEW'),
    expect(`${I}.state.component==='ev-charge.flap'&&${I}.hoodAngle===0&&${I}.cameraPose().position[0]<${I}.cameraPose().target[0]&&${I}.cameraPose().position[2]>${I}.cameraPose().target[2]`,'area entry focuses vehicle rear-right without hood animation'),
    expect(`${I}.chargeGeometry().parts.length===2&&${I}.chargeGeometry().parts.every(p=>p.meta.pose==='STATIC_CLOSED_ILLUSTRATION'&&p.meta.geometryConfidence==='ESTIMATED_GEOMETRY')`,'two merged partIds retain static estimated geometry metadata'),
    ...rayClick('ev-charge.port'),settled('CHARGE_PORT_PREVIEW'),expect(`${I}.state.component==='ev-charge.port'&&${I}.componentInfo().find(p=>p.id==='ev-charge.port').meshes.every(m=>m.highlighted)`,'actual frame canvas click selects and highlights partId'),
    ...rayClick('ev-charge.flap'),settled('CHARGE_PORT_PREVIEW'),expect(`${I}.state.component==='ev-charge.flap'&&${I}.componentInfo().find(p=>p.id==='ev-charge.flap').meshes.every(m=>m.highlighted)`,'actual flap canvas click selects its distinct partId'),
    expect(`document.getElementById('chargePortStatusContent').textContent.includes('STALE')&&document.getElementById('chargePortStatusContent').textContent.includes('false')`,'actual Kotlin false and callback timestamp reach independent charge panel'),['shot',join(out,'00-static-geometry.png'),'body'],
    ev(`window.__chargeFlow=${I}.state;window.__chargePose=JSON.stringify(${I}.cameraPose());window.__chargeUser=${I}.userInspection().sessionId;window.__chargeGeometry=JSON.stringify(${I}.chargeGeometry().parts);window.__chargeCount=${I}.renderInfo.geometries;document.getElementById('chargePortStatusContent').scrollIntoView({block:'center'});true`),
    stage('open'),until(`${I}.chargePortStatus().readings[0].value===true`),expect(preserved,'SDK OPEN report changes only state text and never rotates or moves flap'),['shot',join(out,'01-sdk-open-static.png'),'body'],
    stage('invalid'),until(`${I}.chargePortStatus().connectionStatus==='UNAVAILABLE'`),expect(`${preserved}&&${I}.chargePortStatus().readings[0].value===null&&!document.body.textContent.includes('PRIVATE_MARKER')`,'invalid UNKNOWN response clears report without model or user-record mutation'),
    stage('recovered'),until(`${I}.chargePortStatus().readings[0].value===false`),expect(preserved,'valid false recovers independently without implying charging safety'),
    ev(`window.dispatchEvent(new Event('carscope-component-inactive'));true`),expect(`${preserved}&&${I}.chargePortStatus().readings[0].source===null`,'Native pause clears charge data but preserves selection camera geometry and records'),
    ev(`window.dispatchEvent(new Event('carscope-component-active'));true`),until(`${I}.chargePortStatus().readings[0].source==='MOCK'`),
    ...click('[data-action=back]'),settled('INSPECTION_OVERVIEW'),
    ev(`(()=>{const p=${I}.componentPoint('ev-charge.flap');return {point:p,element:document.elementFromPoint(p.x,p.y)?.tagName,hit:${I}.hitAt(p.x,p.y),view:${I}.view()};})()`),['shot',join(out,'02-occluded-overview.png'),'body'],
    expect(`(()=>{const p=${I}.componentPoint('ev-charge.flap');return p.inFront&&p.x>0&&p.x<innerWidth&&p.y>0&&p.y<innerHeight&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'&&${I}.hitAt(p.x,p.y)?.kind!=='charge'&&${I}.hitAt(p.x,p.y)!==null;})()`,'opaque car body wins over hidden rear-right charge geometry'),
    marker(`${I}.componentPoint('ev-charge.flap')`),['click','#chargeHit'],expect(`${I}.state.name==='INSPECTION_OVERVIEW'`,'real canvas click cannot select charge port through opaque body'),
    ...click('[data-action=area][data-id=ev-charge]'),settled('CHARGE_PORT_PREVIEW'),...click('[data-action=product-summary]'),settled('INSPECTION_SUMMARY'),expect(`${I}.userInspection().sessionId===window.__chargeUser&&${I}.hoodAngle===0`,'charge summary returns whole vehicle without creating a completion result'),
    ...click('[data-action=exit]'),settled('IDLE'),expect(`${I}.userInspection().sessionId!==window.__chargeUser&&!${I}.chargeGeometry().visible`,'explicit end hides charge overlay and starts a fresh memory session'),ev(`${I}.dispose('charge-test');true`)];
  writeFileSync(join(out,'actions.json'),JSON.stringify(actions));const child=spawn(process.execPath,['--experimental-websocket',join(process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy'),'scripts/drive.mjs'),origin+'inspect.html?capture=1&chargeStatus=fixture','--actions',join(out,'actions.json'),'--width',String(width),'--height',String(height)]);
  let stdout='',stderr='';const applied=new Set();child.stdout.on('data',b=>{stdout+=b;for(const name of ['open','invalid','recovered'])if(stdout.includes('CHARGE_STAGE:'+name)&&!applied.has(name)){applied.add(name);const p=structuredClone(golden);p.sequence=name==='open'?2:name==='invalid'?3:4;Object.assign(p.readings[0],{availabilityStatus:'SUPPORTED',observedAt:2000,value:name==='open'});if(name==='invalid'){p.readings[0].value='UNKNOWN';p.readings[0].reason='PRIVATE_MARKER';}update(p);}});child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((ok,fail)=>{child.once('exit',ok);child.once('error',fail);});const passed=code===0&&stdout.includes('console: clean');
  writeFileSync(join(out,'browser-log.txt'),stdout+'\n'+stderr);writeFileSync(join(out,'results.json'),JSON.stringify({passed,width,height,scope:'DESKTOP_CHROME_REAL_GLB_KOTLIN_MOCK_NO_DEVICE',avd:'NOT_RUN',assertions:stdout.split('\n').filter(s=>s.includes('PASS: '))},null,2));console.log(stdout);if(stderr)console.error(stderr);if(!passed)process.exitCode=1;
}finally{server.kill();}
