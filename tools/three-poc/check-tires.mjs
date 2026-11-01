// Actual Chrome pointer/list interaction against the external GLB; no synthetic vehicle data.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIRES } from './inspection-tires.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(process.argv[2] ?? ''), rel = relative(repo, out);
if (!process.argv[2] || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Provide external output');
mkdirSync(out, { recursive: true });
const width = Number(process.argv[4] ?? 1600), height = Number(process.argv[5] ?? 1000), I = 'window.__inspect';
const ev = s => ['eval', s], settled = s => ['until', `${I}.state.name==='${s}'&&!${I}.busy`, 15000];
const expect = (condition, label) => ev(`(()=>{if(!(${condition}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
const shot = n => ['shot', join(out, n + '.png'), 'body'];
const selected = id => `${I}.tireInfo().every(t=>t.wheelMeshes.every(m=>m.highlighted===(t.id==='${id}'&&m.material==='Tire')))`;
const actions = [['until', 'window.__inspectReady', 60000], ['click', '#start'], settled('INSPECTION_OVERVIEW'),
  expect(`${I}.tireInfo().length===4&&new Set(${I}.tireInfo().map(t=>t.id)).size===4`, 'four actual GLB tire targets'),
  ['click', '[data-action=area][data-id=tires]'], settled('TIRE_SELECTION'),
  expect(`Array.from(document.querySelectorAll('[data-action=tire],#back,[data-action=exit]')).every(b=>b.getBoundingClientRect().height>=44)`, 'touch controls at least 44 CSS pixels'),
  expect(`${I}.tireInfo().every(t=>{const p=${I}.componentPoint(t.id);return p.x>0&&p.x<innerWidth&&p.y>60&&p.y<innerHeight;})`, 'all four projected tire centers fit overview'),
  expect(`['tire.front-right','tire.rear-right'].every(id=>{const p=${I}.componentPoint(id);return ${I}.hitAt(p.x,p.y)?.id!==id;})`, 'far side tires cannot be picked through body or nearer wheel'),
  shot('01-tire-list')];
for (const t of TIRES) actions.push(
  ev(`document.querySelector('[data-id="${t.id}"]').scrollIntoView({block:'center'});document.addEventListener('click',()=>{window.__beforeTire=${I}.cameraPose();window.__beforeTireScroll=document.getElementById('panel').scrollTop;},{capture:true,once:true});'capture actual click pose'`),
  ['click', `[data-id="${t.id}"]`], settled('TIRE_PREVIEW'),
  expect(`${I}.state.component==='${t.id}'&&${I}.hoodAngle===0&&${selected(t.id)}`, 'list selection and isolated rubber highlight ' + t.id),
  expect(`${I}.tireInfo().every(t=>t.panel.source===null&&t.panel.observedAt===null&&t.panel.capabilityStatus==='UNVERIFIED'&&t.panel.availabilityStatus==='UNVERIFIED')&&document.getElementById('panel').textContent.includes('없음 · 미연동')&&!document.querySelector('[data-action=handoff]')`, 'detached panel, no fabricated data or QR ' + t.id),
  expect(`(()=>{const p=${I}.componentPoint('${t.id}'),r=document.getElementById('panel').getBoundingClientRect();return p.inFront&&p.x>0&&p.x<innerWidth&&p.y>60&&p.y<innerHeight&&!(p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom);})()`, 'tire bounds center in usable viewport ' + t.id),
  expect(`(()=>{const t=${I}.tireInfo().find(t=>t.id==='${t.id}'),c=${I}.cameraPose();return (c.position[2]-c.target[2])*${-t.left}>0&&c.position[1]>c.target[1]&&c.position.every(Number.isFinite);})()`, 'outside-side camera ' + t.id),
  shot(t.id),
  ev(`(()=>{const before=${I}.state;${I}.dispatch({type:'SELECT_TIRE',id:'${t.id}'});${I}.dispatch({type:'REQUEST_HANDOFF'});if(${I}.state!==before)throw Error('duplicate/QR transition');return 'PASS: duplicate and QR ignored';})()`),
  // Real CDP pointer input at a projected point: nearest visible rim/rubber shares the same tire ID.
  ev(`(()=>{const p=${I}.componentPoint('${t.id}'),h=${I}.hitAt(p.x,p.y);if(h?.id!=='${t.id}'||h.kind!=='tire')throw Error('tire occluded '+JSON.stringify({p,h}));const m=document.createElement('div');m.id='__tireTap';Object.assign(m.style,{position:'fixed',left:(p.x-1)+'px',top:(p.y-1)+'px',width:'2px',height:'2px',pointerEvents:'none'});document.body.append(m);return JSON.stringify({p,h});})()`),
  ['click', '#__tireTap'], ev(`document.getElementById('__tireTap').remove();'real canvas click'`),
  ['click', '#back'], settled('TIRE_SELECTION'),
  expect(`(()=>{const c=${I}.cameraPose();return c.position.every((v,i)=>Math.abs(v-window.__beforeTire.position[i])<0.0001)&&c.target.every((v,i)=>Math.abs(v-window.__beforeTire.target[i])<0.0001)&&Math.abs(document.getElementById('panel').scrollTop-window.__beforeTireScroll)<1&&document.activeElement.dataset.id==='${t.id}'&&${I}.tireInfo().every(t=>t.meshes.every(m=>!m.highlighted));})()`, 'back restores pose, scroll, focus and deselects ' + t.id),
  // Select from the model after restoring the list's overview: for far wheels the body must occlude.
  ev(`(()=>{const p=${I}.componentPoint('${t.id}'),h=${I}.hitAt(p.x,p.y);window.__overviewHit={p,h};return JSON.stringify(window.__overviewHit);})()`),
);
// From a deselected overview use real CDP clicks, then rotate the model with real pointer drags
// to reach the opposite side. No pick-through-body shortcut or invisible proxy is used.
for (const side of [1, -1]) {
  if (side === -1) actions.push(
    ['drag', '#view canvas', 0.2, 0.23, 0.2 + height / width / 4, 0.23, 24],
    ['drag', '#view canvas', 0.2, 0.23, 0.2 + height / width / 4, 0.23, 24], ['wait', 1200]);
  for (const t of TIRES.filter(t => t.left === side)) actions.push(
    ev(`(()=>{const p=${I}.componentPoint('${t.id}'),h=${I}.hitAt(p.x,p.y);if(h?.id!=='${t.id}')throw Error('not visible after orbit '+JSON.stringify({p,h}));let m=document.createElement('div');m.id='__tireTap';Object.assign(m.style,{position:'fixed',left:(p.x-1)+'px',top:(p.y-1)+'px',width:'2px',height:'2px',pointerEvents:'none'});document.body.append(m);return JSON.stringify({p,h});})()`),
    ['click', '#__tireTap'], settled('TIRE_PREVIEW'),
    expect(`${I}.state.component==='${t.id}'&&${selected(t.id)}`, 'deselected model real pointer selects ' + t.id),
    ev(`document.getElementById('__tireTap').remove();'remove marker'`), ['click', '#back'], settled('TIRE_SELECTION'));
}
actions.push(
  ev(`${TIRES.map(t => `${I}.dispatch({type:'SELECT_TIRE',id:'${t.id}'});`).join('')} 'rapid switch'`), settled('TIRE_PREVIEW'),
  expect(`${selected('tire.rear-right')}`, 'rapid switch clears all previous tire highlights'),
  ev(`${I}.dispatch({type:'BACK'});${I}.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});${I}.dispatch({type:'BACK'});'back during motion'`), settled('TIRE_SELECTION'),
  expect(`${I}.state.component===null&&${I}.tireInfo().every(t=>t.meshes.every(m=>!m.highlighted))`, 'back during camera move cleans selection'),
  ev(`${I}.dispatch({type:'SELECT_TIRE',id:'tire.front-right'});${I}.dispatch({type:'EXIT'});'exit during motion'`), settled('IDLE'),
  expect(`${I}.hoodAngle===0&&${I}.state.component===null&&${I}.tireInfo().every(t=>t.meshes.every(m=>!m.highlighted))`, 'exit restores home and clears selection'),
  shot('06-exit'),
  expect(`!document.querySelector('body').scrollWidth||document.body.scrollWidth<=innerWidth`, 'no horizontal page overflow'),
);
if (width >= 1400) {
  const F = 'document.getElementById("__resizeFrame").contentWindow.__inspect';
  actions.push(
    ev(`(()=>{const frame=document.createElement('iframe');frame.id='__resizeFrame';frame.src=location.href;Object.assign(frame.style,{position:'fixed',top:'0',left:'0',width:'1600px',height:'1000px',border:'0',zIndex:'50'});document.body.append(frame);return 'create same-origin real browser viewport';})()`),
    ['until', 'document.getElementById("__resizeFrame").contentWindow.__inspectReady', 60000],
    ev(`${F}.dispatch({type:'START'});${F}.dispatch({type:'SELECT_AREA',id:'tires'});${F}.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});'select before resize'`),
    ['until', `!${F}.busy`, 15000]);
  for (const [w, h] of [[420, 860], [1024, 600]]) actions.push(
    ev(`Object.assign(document.getElementById('__resizeFrame').style,{width:'${w}px',height:'${h}px'});'resize actual child viewport'`), ['wait', 350],
    ['until', `document.getElementById('__resizeFrame').contentWindow.innerWidth===${w}&&!${F}.busy`, 15000],
    expect(`(()=>{const f=document.getElementById('__resizeFrame').contentWindow,p=f.__inspect.componentPoint('tire.front-left'),r=f.document.getElementById('panel').getBoundingClientRect();return f.innerHeight===${h}&&f.__inspect.state.component==='tire.front-left'&&p.x>0&&p.x<${w}&&p.y>60&&p.y<${h}&&!(p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom);})()`, 'selected tire survives actual resize ' + w + 'x' + h),
    ['shot', join(out, `resize-${w}x${h}.png`), '#__resizeFrame']);
  actions.push(ev(`${F}.dispatch({type:'BACK'});'back after viewport change'`), ['until', `!${F}.busy`, 15000],
    expect(`${F}.state.name==='TIRE_SELECTION'&&${F}.state.component===null`, 'back after resize recomputes tire overview'),
    ev(`${F}.dispose('resize-test-complete');document.getElementById('__resizeFrame').remove();'release test frame'`));
}
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8113/inspect.html?capture=1', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)], { encoding: 'utf8', maxBuffer: 64 << 20 });
const stdout = r.stdout ?? '', passed = r.status === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + (r.stderr ?? ''));
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: r.status, width, height, assertions: stdout.split('\n').filter(s => s.includes('PASS: ')) }, null, 2));
console.log(stdout.split('\n').map(s => s.slice(0, 350)).join('\n')); if (r.stderr) console.error(r.stderr); process.exitCode = passed ? 0 : 1;
