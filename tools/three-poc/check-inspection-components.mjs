// P3-A7 browser integration, using the existing pinned Anatomy driver.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(process.argv[2]??''),rel=relative(repo,out);
if(!process.argv[2]||!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Provide an external output folder');
mkdirSync(out,{recursive:true});
const width=Number(process.argv[4]??1600),height=Number(process.argv[5]??1000),I='window.__inspect';
const ev=s=>['eval',s],shot=n=>[['wait',200],['shot',join(out,n+'.png'),'body']];
const settled=n=>['until',`${I}.state.name==='${n}'&&!${I}.busy`,15000];
const expect=(cond,msg)=>ev(`(()=>{if(!(${cond}))throw Error(${JSON.stringify(msg)});return ${JSON.stringify('PASS: '+msg)};})()`);
const ids=['coolant-reservoir','brake-fluid-reservoir','battery-12v','fuse-box'];
// A noninteractive marker locates the real CDP pointer click; events pass through it to the canvas.
const tap=id=>[ev(`(()=>{const p=${I}.componentPoint('${id}'),h=${I}.hitAt(p.x,p.y);if(h?.id!=='${id}')throw Error('occluded '+JSON.stringify({p,h}));let marker=document.getElementById('__componentTap');if(!marker){marker=document.createElement('div');marker.id='__componentTap';document.body.append(marker);}Object.assign(marker.style,{position:'fixed',left:(p.x-1)+'px',top:(p.y-1)+'px',width:'2px',height:'2px',pointerEvents:'none'});return JSON.stringify({id:'${id}',p,h});})()`),['click','#__componentTap']];
const actions=[['until','window.__inspectReady',60000],
  expect(`${I}.componentInfo().length===5&&${I}.componentInfo().slice(1).reduce((n,g)=>n+g.meshes.length,0)===10`,'all four builders loaded: ten meshes'),
  ['click','#start'],settled('INSPECTION_OVERVIEW'),
  expect(`['${ids.join("','")}'].every(id=>{const p=${I}.componentPoint(id);return ${I}.hitAt(p.x,p.y)?.kind!=='component';})`,'closed hood occludes all new targets'),
  ['click','[data-action=area]'],settled('COMPONENT_SELECTION'),
  expect(`document.querySelectorAll('.item[aria-disabled=true]').length===1&&document.querySelectorAll('.item.preview').length===4`,'LCW planned; four shape-only buttons'),
  ...shot('01-list'),
];
for(const id of ids) actions.push(
  ev(`document.querySelector('[data-id="${id}"]').scrollIntoView({block:'center'});document.addEventListener('click',()=>{window.__savedCamera=${I}.cameraPose();window.__savedScroll=document.getElementById('panel').scrollTop;},{capture:true,once:true}); 'save at actual click'`),
  ['click',`[data-id="${id}"]`],settled('COMPONENT_PREVIEW'),
  expect(`${I}.state.component==='${id}'&&${I}.hoodAngle===60`,'list selection '+id),
  expect(`document.getElementById('panel').textContent.includes('실제 차량별 배치: 미검증')&&!document.querySelector('[data-action=handoff]')`,'accuracy and no procedure/handoff '+id),
  expect(`${I}.componentInfo().filter(g=>g.id!=='washer-fluid-cap').every(g=>g.meshes.every(m=>m.highlighted===(g.id==='${id}')))`,'whole group highlight '+id),
  expect(`(()=>{const p=${I}.componentPoint('${id}'),r=document.getElementById('panel').getBoundingClientRect();return p.x>0&&p.x<innerWidth&&p.y>60&&p.y<innerHeight&&!(p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom);})()`,'camera target in usable viewport '+id),
  ...shot(id),
  ev(`(()=>{const before=${I}.state;${I}.dispatch({type:'SELECT_COMPONENT',id:'${id}'});${I}.dispatch({type:'REQUEST_HANDOFF'});if(before!==${I}.state)throw Error('duplicate or QR');return 'PASS: duplicate ignored / QR rejected';})()`),
  ['click','#back'],settled('COMPONENT_SELECTION'),
  ev(`JSON.stringify({restored:${I}.cameraPose(),saved:window.__savedCamera,focus:document.activeElement.dataset.id,scroll:document.getElementById('panel').scrollTop,savedScroll:window.__savedScroll,log:window.__inspectLog.slice(-10)})`),
  expect(`(()=>{const p=${I}.cameraPose();return p.position.every((v,k)=>Math.abs(v-window.__savedCamera.position[k])<0.0001)&&p.target.every((v,k)=>Math.abs(v-window.__savedCamera.target[k])<0.0001)&&document.activeElement.dataset.id==='${id}'&&Math.abs(document.getElementById('panel').scrollTop-window.__savedScroll)<1;})()`,'back restores camera, focus and list scroll '+id),
  ...tap(id),settled('COMPONENT_PREVIEW'),expect(`${I}.state.component==='${id}'`,'3D same target '+id),
  ['click','#back'],settled('COMPONENT_SELECTION'),
);
actions.push(
  ev(`(()=>{const d=id=>${I}.dispatch({type:'SELECT_COMPONENT',id});d('${ids[0]}');d('${ids[1]}');d('${ids[2]}');d('${ids[3]}');return ${I}.state.component;})()`),settled('COMPONENT_PREVIEW'),
  expect(`${I}.state.component==='fuse-box'&&${I}.componentInfo().filter(g=>g.id!=='washer-fluid-cap').every(g=>g.meshes.every(m=>m.highlighted===(g.id==='fuse-box')))`,'rapid switch clears previous highlight'),
  ev(`${I}.dispatch({type:'BACK'});${I}.dispatch({type:'SELECT_COMPONENT',id:'battery-12v'});${I}.dispatch({type:'BACK'});'cancel camera'`),settled('COMPONENT_SELECTION'),
  expect(`${I}.componentInfo().slice(1).every(g=>g.meshes.every(m=>!m.highlighted))`,'back during camera move clears highlight'),
  ev(`${I}.dispatch({type:'SELECT_COMPONENT',id:'brake-fluid-reservoir'});${I}.dispatch({type:'EXIT'});'exit camera'`),settled('IDLE'),
  expect(`${I}.state.component===null&&${I}.hoodAngle===0&&${I}.componentInfo().every(g=>g.meshes.every(m=>!m.highlighted))`,'exit cancels camera and cleans selection/hood/highlight'),
  ...shot('06-exit'),
);
writeFileSync(join(out,'actions.json'),JSON.stringify(actions));
const anatomy=process.env.ANATOMY_HOME??join(homedir(),'.claude/skills/anatomy');
const r=spawnSync(process.execPath,['--experimental-websocket',join(anatomy,'scripts/drive.mjs'),process.argv[3]??'http://127.0.0.1:8107/inspect.html?capture=1','--actions',join(out,'actions.json'),'--width',String(width),'--height',String(height)],{encoding:'utf8',maxBuffer:64<<20});
const stdout=r.stdout??'',passed=r.status===0&&stdout.includes('console: clean');
writeFileSync(join(out,'browser-log.txt'),stdout+'\n'+(r.stderr??''));writeFileSync(join(out,'results.json'),JSON.stringify({passed,exitCode:r.status,width,height,passes:stdout.split('\n').filter(s=>s.includes('PASS: '))},null,2));
console.log(stdout.split('\n').map(s=>s.slice(0,400)).join('\n'));if(r.stderr)console.error(r.stderr);process.exitCode=passed?0:1;
