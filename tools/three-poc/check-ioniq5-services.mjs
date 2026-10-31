// node tools/three-poc/check-ioniq5-services.mjs <external output dir> [url]
import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve,relative,isAbsolute,join,dirname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Provide an output folder outside the repo');
mkdirSync(out,{recursive:true});
const ev=s=>['eval',s],shot=name=>[['wait',350],['shot',join(out,name+'.png'),'body']];
const actions=[
  ['until',"window.__labLog?.some(e=>e.tag==='loaded'||e.tag==='load-error')",60000],
  ev(`(async()=>{const h=window.__hood,s=window.__services,fail=m=>{throw Error(m)};
    if(!s)fail('service module missing');
    await document.getElementById('focusWasher').onclick();
    if(document.getElementById('frunkMessage').textContent==='ANGLE_OUT_OF_RANGE')fail('animation timestamp underflow');
    const match=s.compareWithNode();if(match.maxVertexDeltaCm>0.00003)fail('Node mismatch');
    const p=s.screenPoint();s.select(null);return JSON.stringify({match,point:p});})()`),
  // Real CDP mouse input at the focused cap (1600x1100 canvas, camera centres the cap at x970/y509).
  ['click','#view canvas',0.60625,0.463],
  ev(`(()=>{const h=window.__hood,s=window.__services,fail=m=>{throw Error(m)},p=s.screenPoint();
    if(s.selected!=='washer-fluid-cap'||!document.getElementById('serviceGuidance').textContent.includes('점검 대상'))fail('raycast cap selection or guidance');
    if(!s.meshes.find(m=>m.name==='washer-fluid-cap').material.emissive.getHex())fail('highlight');
    s.select(null);h.setAngle(0);const blocked=s.pick(p.x,p.y);if(blocked)fail('clicked through closed hood');
    h.setAngle(60);h.useView('washer');s.select('washer-fluid-cap');return JSON.stringify({point:p,closedHoodBlocksPick:!blocked});})()`),
  ...shot('01-washer-cap-selected'),
  ev("window.__services.select('washer-fluid-filler'); 'filler'"),...shot('02-washer-filler'),
  ev("window.__services.select(null); window.__hood.useView('bay'); 'bay'"),...shot('03-service-layout'),
  ev("window.__frunk.setAngle(60); window.__hood.useView('bayiso'); 'frunk open'"),...shot('04-frunk-open'),
  ev("window.__frunk.setAngle(0); window.__services.setReservations(true); window.__services.select('lcw-coolant-reservoir'); window.__hood.useView('baytop'); 'reservations'"),...shot('05-reservations'),
  ev(`(()=>{const s=window.__services;for(const p of s.services.reservations){s.select(p.id);if(!document.getElementById('serviceConfidence').textContent.includes('예약 영역'))throw Error('reservation claim');}s.setReservations(false);s.select(null);return 'reservation metadata PASS';})()`),
  ev(`(()=>{const h=window.__hood,f=window.__frunk,rows=[];for(const id of ['A','C']){h.useAxis(id);for(const d of [0,15,30,45,60]){f.setAngle(0);h.setAngle(d);const a=h.compareWithNode(d),c=h.runCheck();if(a.maxVertexDeltaCm>0.00003||c.newPairs)throw Error('hood regression');rows.push({a,c});}}h.setAngle(60);return JSON.stringify(rows);})()`),
  ev("window.__hood.useView('bay'); window.__services.setVisible(false); window.__hood.perf(1).then(r=>JSON.stringify({warmup:true,...r}))"),
  ev("window.__hood.perf(2).then(r=>JSON.stringify({services:false,...r}))"),
  ev("window.__services.setVisible(true); window.__hood.perf(1).then(r=>JSON.stringify({warmup:true,...r}))"),
  ev("window.__hood.perf(2).then(r=>JSON.stringify({services:true,...r}))"),
  ev("window.__hood.setAngle(0); 'closed'"),...shot('06-closed-regression'),
  ev("window.__hood.svgTiming(['closed-services.svg','hood45-cover0.svg','hood60-cover60.svg'],'./external/p3-a2-3/svg/').then(r=>JSON.stringify(r))"),
];
writeFileSync(join(out,'actions.json'),JSON.stringify(actions));
const anatomy=process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy');
const r=spawnSync(process.execPath,['--experimental-websocket',join(anatomy,'scripts/drive.mjs'),process.argv[3]??'http://127.0.0.1:8097/ioniq5-hood.html','--actions',join(out,'actions.json'),'--width','1600','--height','1100'],{encoding:'utf8',maxBuffer:64<<20});
const stdout=r.stdout??'',evals=stdout.split('\n').filter(s=>s.startsWith('eval: ')).map(s=>{try{const x=JSON.parse(s.slice(6));try{return JSON.parse(x)}catch{return x}}catch{return s}});
const passed=r.status===0&&evals.some(e=>e?.closedHoodBlocksPick)&&evals.filter(e=>e?.services!==undefined&&e.frameMs).length===2&&stdout.includes('console: clean');
writeFileSync(join(out,'browser-log.txt'),stdout+'\n'+(r.stderr??''));writeFileSync(join(out,'browser-results.json'),JSON.stringify({passed,exitCode:r.status,evals},null,2));
console.log(stdout.split('\n').map(s=>s.slice(0,400)).join('\n'));if(r.stderr)console.error(r.stderr);process.exitCode=passed?0:1;
