// Actual UI inputs on the real GLB. No mobile record injection or SDK-to-user-result conversion.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('External evidence required');
mkdirSync(out,{recursive:true});
const width=Number(process.argv[4]??1600),height=Number(process.argv[5]??1000),I='window.__inspect';
const ev=s=>['eval',s],until=s=>['until',s,30000],settled=s=>until(`${I}.state.name==='${s}'&&!${I}.busy`);
const expect=(s,label)=>ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: '+label)};})()`);
const click=sel=>[ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'});'scroll'`),['click',sel]];
const shot=name=>['shot',join(out,name+'.png'),'body'];
// P10: NOT_INSPECTED keeps the original rubber; a confirmed result sets its state color.
const paintMatches=`${I}.inspectionPaint().every(t=>{const r=${I}.inspectionMap().find(r=>r.partId===t.id);return t.colors.every((c,i)=>c===(r.status==='NOT_INSPECTED'?t.baseColors[i]:r.color));})`;
const actions=[until('window.__inspectReady'),['click','#start'],settled('INSPECTION_OVERVIEW'),
  expect(`${I}.inspectionMap().length===4&&${I}.inspectionMap().every(r=>r.status==='NOT_INSPECTED'&&r.source===null)&&${paintMatches}`,'new session has four uninspected parts with no invented result'),
  ...click('[data-action=area][data-id=tires]'),settled('TIRE_SELECTION'),
  ev(`window.__mapSession=${I}.userInspection().sessionId;window.__sdkBefore=JSON.stringify(${I}.tireStatus());window.__mapGeometryCount=${I}.renderInfo.geometries;'remember separate SDK and session'`),shot('01-empty-map')];
for(const [id,values]of [
  ['tire.front-left',['FOUND','NOT_FOUND','UNABLE']],
  ['tire.front-right',['UNABLE','NOT_FOUND','NOT_FOUND']],
  ['tire.rear-left',['NOT_FOUND','NOT_FOUND','NOT_FOUND']],
]){
  actions.push(...click(`[data-action=tire][data-id="${id}"]`),settled('TIRE_PREVIEW'));
  for(const [i,key]of ['damage','debris','wear'].entries())actions.push(...click(`input[data-check=${key}][value=${values[i]}]`));
  actions.push(expect(`${I}.inspectionMap().find(r=>r.partId==='${id}').status==='NOT_INSPECTED'&&${I}.inspectionMap().find(r=>r.partId==='${id}').draft`,'answered but unconfirmed remains uninspected '+id),
    ...click('[data-action=confirm-tire]'),
    expect(`${I}.inspectionMap().find(r=>r.partId==='${id}').source==='USER_REPORTED'&&${I}.inspectionMap().find(r=>r.partId==='${id}').origin==='THIS_3D_PAGE'&&${paintMatches}`,'confirmation updates material and local provenance '+id));
}
actions.push(...click('[data-action=tire-summary]'),settled('TIRE_SUMMARY'),
  expect(`JSON.stringify(${I}.inspectionMap().map(r=>r.status))===JSON.stringify(['FINDINGS_REPORTED','UNABLE','NO_FINDINGS_REPORTED','NOT_INSPECTED'])`,'all four report states coexist without a safety verdict'),
  expect(`document.querySelectorAll('.tire-summary').length===4&&['FINDINGS_REPORTED','UNABLE','NO_FINDINGS_REPORTED','NOT_INSPECTED'].every(s=>document.querySelector('.tire-summary [data-inspection-state="'+s+'"]'))`,'accessible position list mirrors every 3D state including uninspected'),shot('02-mixed-map'),expect(`(()=>{const p=document.getElementById('panel').getBoundingClientRect(),r=document.querySelector('.tire-summary').getBoundingClientRect();return r.top<p.bottom-44;})()`,'first summary result is reachable in the initial panel viewport'),...click('.tire-summary[data-id="tire.rear-right"]'),settled('TIRE_PREVIEW'),...click('[data-action=tire-summary]'),settled('TIRE_SUMMARY'),ev(`document.querySelector('.tire-summary[data-id="tire.rear-right"]').scrollIntoView({block:'center'});'show report rows'`),shot('02-mixed-map-rows'),
  ev(`document.querySelector('.record-scope summary').scrollIntoView({block:'center'});'show scope disclosure'`),['key','Enter','.record-scope summary'],
  expect(`document.querySelector('.record-scope').open&&getComputedStyle(document.querySelector('.record-scope p')).display!=='none'`,'keyboard opens the actual record scope and unavailable mobile connection explanation'),
  ...click('[data-action=product-summary]'),settled('INSPECTION_SUMMARY'),
  expect(`${paintMatches}&&document.querySelector('[data-result-source=NOT_RECORDED]')&&document.getElementById('panel').textContent.includes('모바일·Native 결과는 로컬 타이어 기록에 합치지')`,'whole summary shares map while mobile and uncollected parts remain absent'),shot('03-whole-summary'),
  ev(`document.querySelector('.tire-summary[data-id="tire.front-left"]').scrollIntoView({block:'center'});'show keyboard target'`),['key','Enter','.tire-summary[data-id="tire.front-left"]'],settled('TIRE_PREVIEW'),
  expect(`(()=>{const row=${I}.inspectionMap()[0],card=document.querySelector('[data-inspection-part="tire.front-left"]');return card.textContent.includes(row.label)&&card.textContent.includes('USER_REPORTED')&&card.textContent.includes(new Date(row.completedAt).toISOString())&&Object.values(row.responses).includes('FOUND');})()`,'keyboard selection shows exact session result source and original confirmation time'),
  ev(`window.__mapTime=${I}.inspectionMap()[0].completedAt;const p=${I}.componentPoint('tire.front-left');if(${I}.hitAt(p.x,p.y)?.id!=='tire.front-left')throw Error('occluded tire');const marker=document.createElement('div');marker.id='__mapTap';Object.assign(marker.style,{position:'fixed',left:(p.x-1)+'px',top:(p.y-1)+'px',width:'2px',height:'2px',pointerEvents:'none'});document.body.append(marker);'real mesh pointer target'`),['click','#__mapTap'],ev(`document.getElementById('__mapTap').remove();'remove target'`),
  expect(`${I}.state.component==='tire.front-left'&&${I}.inspectionMap()[0].completedAt===window.__mapTime&&${I}.tireInfo().every(t=>t.meshes.every(m=>m.highlighted===(t.id==='tire.front-left')))&&${paintMatches}`,'real canvas click preserves report color/time and independent selected highlight'),shot('04-selected-report'),expect(`(()=>{const h=${I}.highlightInfo('tire.front-left'),L=c=>0.2126*c[0]+0.7152*c[1]+0.0722*c[2];return h.role==='SELECTED'&&h.meshes.every(m=>m.outline&&(m.intensity*0.468<=0.5*L(m.colorLinear)+1e-6||m.intensity===0.1));})()&&document.querySelector('.part-identity')?.open===false`,'confirmed selection keeps a restrained accent (P10 shared rule: at most half the result luminance, plus outline) and model identifiers do not crowd the record'),
  // P10: the first selection draws the cyan outline once (GPU upload). Count again here, so the check below still proves
  // that editing and reconfirming a result allocates no geometry.
  ev(`window.__mapGeometryCount=${I}.renderInfo.geometries;'recount after the selection outline is drawn'`),
  ...click('input[data-check=damage][value=UNABLE]'),
  expect(`${I}.inspectionMap()[0].status==='NOT_INSPECTED'&&${I}.inspectionMap()[0].completedAt===null&&${paintMatches}`,'editing clears mapped result and confirmation time until reconfirmation'),
  ...click('[data-action=confirm-tire]'),
  expect(`${I}.inspectionMap()[0].status==='UNABLE'&&JSON.stringify(${I}.tireStatus())===window.__sdkBefore&&${I}.renderInfo.geometries===window.__mapGeometryCount`,'reconfirmed user result never alters SDK readings'),
  ...click('[data-action=product-summary]'),settled('INSPECTION_SUMMARY'),...click('[data-action=area][data-id=hood]'),settled('COMPONENT_SELECTION'),...click('[data-action=component][data-id="washer-fluid-cap"]'),settled('WASHER_SELECTED'),...click('[data-action=handoff]'),settled('MOBILE_HANDOFF_READY'),...click('[data-action=product-summary]'),settled('INSPECTION_SUMMARY'),
  expect(`${I}.userInspection().sessionId===window.__mapSession&&${I}.inspectionMap().filter(r=>r.completedAt!==null).length===3&&${I}.hoodAngle===0&&${paintMatches}`,'cross-area and QR visits preserve exactly three local records without mobile completion'),
  expect(`document.documentElement.scrollWidth===innerWidth&&document.querySelector('.inspection-legend').scrollWidth<=document.getElementById('panel').clientWidth`,'state legend and summary fit viewport'),
  ...click('[data-action=exit]'),settled('IDLE'),
  expect(`${I}.inspectionMap().every(r=>r.status==='NOT_INSPECTED')&&${I}.inspectionPaint().every(t=>t.colors.every((c,i)=>c===t.baseColors[i]))`,'end clears session and restores original rubber colors'),
  ['click','#start'],settled('INSPECTION_OVERVIEW'),
  expect(`${I}.userInspection().sessionId!==window.__mapSession&&${paintMatches}`,'fresh session cannot inherit previous results'),
  ev(`location.reload();'reload'`),until('window.__inspectReady'),
  expect(`${I}.state.name==='IDLE'&&${I}.inspectionMap().every(r=>r.completedAt===null)&&localStorage.length===0&&sessionStorage.length===0`,'reload starts empty without persistent storage'),
  ev(`${I}.dispose('state-map-check');true`),expect(`${I}.inspectionMap().every(r=>r.source===null)`,'dispose clears local map records'));
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8131/inspect.html?capture=1', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)], { encoding: 'utf8', maxBuffer: 64 << 20 });
const stdout = r.stdout ?? '', passed = r.status === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + (r.stderr ?? ''));
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: r.status, width, height, scope: 'CHROME_REAL_GLB_LOCAL_USER_REPORTED_INPUT_NO_MOBILE_OR_NATIVE_RECEIPT', assertions: stdout.split('\n').filter(s=>s.includes('PASS: ')) }, null, 2));
console.log(stdout.split('\n').map(s=>s.slice(0,280)).join('\n')); if(r.stderr) console.error(r.stderr); process.exitCode = passed ? 0 : 1;
