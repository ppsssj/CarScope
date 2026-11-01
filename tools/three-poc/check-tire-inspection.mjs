// Real Chrome UI input with the external GLB. USER_REPORTED test responses, no SDK data.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIRES } from './inspection-tires.mjs';
import { CHECKS } from './tire-inspection.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(process.argv[2] ?? ''), rel = relative(repo, out);
if (!process.argv[2] || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('External evidence required');
mkdirSync(out, { recursive: true });
const width = Number(process.argv[4] ?? 1600), height = Number(process.argv[5] ?? 1000), I = 'window.__inspect';
const ev = s => ['eval', s], until = s => ['until', s, 15000], settled = s => until(`${I}.state.name==='${s}'&&!${I}.busy`);
const expect = (s, label) => ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
const click = selector => [ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});'scroll control'`), ['click', selector]];
const shot = name => ['shot', join(out, name + '.png'), 'body'];
const row = id => `${I}.userInspection().tires['${id}']`, first = TIRES[0].id;
const actions = [until('window.__inspectReady'), ['click', '#start'], settled('INSPECTION_OVERVIEW'),
  ['click', '[data-id=tires]'], settled('TIRE_SELECTION'),
  ev(`window.__guideOverview=${I}.cameraPose();window.__guideSession=${I}.userInspection().sessionId;'save overview'`),
  ...click('[data-action=tire-summary]'), settled('TIRE_SUMMARY'),
  expect(`Object.values(${I}.userInspection().tires).every(t=>t.status==='NOT_STARTED')&&document.getElementById('panel').textContent.includes('0/4')`, 'empty intermediate summary is available'),
  expect(`(()=>{const b=[...document.querySelectorAll('.tire-summary')].map(x=>x.getBoundingClientRect());return b.length===4&&b[0].left<b[1].left&&b[0].top===b[1].top&&b[2].top>b[0].top&&b[2].left===b[0].left;})()`, 'summary corresponds to front left right and rear left right'), shot('01-empty-summary'),
  ...click(`[data-action=tire][data-id="${first}"]`), settled('TIRE_PREVIEW'),
  ev(`window.__guidePose=${I}.cameraPose();'save tire pose'`),
  expect(`document.documentElement.scrollWidth===innerWidth&&[...document.querySelectorAll('.tire-check label,.tire-nav button')].every(e=>e.getBoundingClientRect().height>=44)`, 'narrow layout has no page overflow and 44px checklist targets'),
  expect(`document.querySelector('.sdk-details summary').textContent.includes('Pleos')&&document.querySelectorAll('#tireStatusContent [data-feature]').length===2`, 'independent SDK details preserve both status features'),
  expect(`document.querySelector('[data-action=confirm-tire]').disabled`, 'empty checklist cannot complete'), shot('01-checklist-start')];
for (let i = 0; i < TIRES.length; i++) {
  const id = TIRES[i].id;
  if (i) actions.push(...click('[data-action=next-tire]'), settled('TIRE_PREVIEW'));
  actions.push(expect(`${I}.state.component==='${id}'&&${row(id)}.status==='NOT_STARTED'`, 'independent initial row ' + id));
  for (let j = 0; j < CHECKS.length; j++) {
    const answer = i === 1 && j === 1 ? 'FOUND' : i === 2 && j === 2 ? 'UNABLE' : 'NOT_FOUND';
    const selector = `input[data-check="${CHECKS[j].id}"][value="${answer}"]`;
    if (i === 0 && j === 0) actions.push(ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});'scroll keyboard radio'`),
      ['key', ' ', selector], expect(`document.querySelector(${JSON.stringify(selector)}).checked&&document.activeElement.matches(${JSON.stringify(selector)})`, 'native radio keyboard activation retains focus after response render'));
    else actions.push(...click(selector));
    if (j === 1) actions.push(expect(`document.querySelector('[data-action=confirm-tire]').disabled&&${row(id)}.status==='IN_PROGRESS'`, 'two responses cannot complete ' + id));
  }
  actions.push(expect(`${row(id)}.status==='IN_PROGRESS'&&${row(id)}.completedAt===null`, 'all answers still require explicit confirmation ' + id),
    ...click('[data-action=confirm-tire]'), expect(`${row(id)}.status==='COMPLETED'&&Number.isSafeInteger(${row(id)}.completedAt)&&${row(id)}.source==='USER_REPORTED'`, 'explicit completion ' + id));
  if (i === 0) actions.push(
    expect(`(()=>{const p=${I}.cameraPose();return p.position.every((v,i)=>Math.abs(v-window.__guidePose.position[i])<.0001)&&p.target.every((v,i)=>Math.abs(v-window.__guidePose.target[i])<.0001);})()`, 'answers preserve selected tire camera'),
    ...click('input[data-check=damage][value=FOUND]'), expect(`${row(id)}.status==='IN_PROGRESS'&&${row(id)}.completedAt===null`, 'edit invalidates completion timestamp'),
    ...click('[data-action=confirm-tire]'), shot('02-checklist-completed'),
    ...click('[data-action=tire-summary]'), settled('TIRE_SUMMARY'),
    expect(`document.getElementById('panel').textContent.includes('1/4')&&${row(TIRES[1].id)}.status==='NOT_STARTED'`, 'partial summary preserves remaining wheels'), shot('03-partial-summary'),
    ...click(`[data-action=tire][data-id="${first}"]`), settled('TIRE_PREVIEW'),
    expect(`document.querySelector('input[data-check=damage][value=FOUND]').checked&&${row(id)}.status==='COMPLETED'`, 're-entry restores confirmed answers'));
}
actions.push(...click('[data-action=tire-summary]'), settled('TIRE_SUMMARY'),
  expect(`document.getElementById('panel').textContent.includes('4/4')&&Object.values(${I}.userInspection().tires).every(t=>t.status==='COMPLETED')`, 'all four results summarized'),
  expect(`document.getElementById('panel').textContent.includes('눈에 띄는 이물질')&&document.getElementById('panel').textContent.includes('불균일한 마모')`, 'found and unable are review items'), shot('04-full-summary'),
  ev(`document.querySelector('.tire-summary[data-id="tire.rear-right"]').scrollIntoView({block:'center'});'show rear summary row'`), shot('04-summary-rear'),
  ...click(`[data-action=tire][data-id="${first}"]`), settled('TIRE_PREVIEW'),
  ev(`${I}.dispatch({type:'SELECT_TIRE',id:'tire.rear-left'});${I}.dispatch({type:'SELECT_TIRE',id:'tire.front-right'});${I}.dispatch({type:'SELECT_TIRE',id:'tire.rear-right'});'rapid tire targets'`), settled('TIRE_PREVIEW'),
  expect(`${I}.state.component==='tire.rear-right'&&${I}.tireInfo().every(t=>t.meshes.every(m=>m.highlighted===(t.id==='tire.rear-right')))`, 'rapid switching leaves only final rubber highlighted'),
  expect(`Object.values(${I}.userInspection().tires).every(t=>t.status==='COMPLETED')&&${I}.tireStatus().readings.every(r=>r.source===null)&&!('value' in ${I}.tireStatus().readings[0])`, 'user completion never changes detached SDK status'),
  ...click('[data-action=previous-tire]'), settled('TIRE_PREVIEW'), expect(`${I}.state.component==='tire.rear-left'`, 'previous tire navigation'),
  ...click('[data-action=back]'), settled('TIRE_SELECTION'),
  expect(`${I}.state.component===null&&${I}.tireInfo().every(t=>t.meshes.every(m=>!m.highlighted))`, 'back clears selection and highlight'),
  expect(`(()=>{const p=${I}.cameraPose();return p.position.every((v,i)=>Math.abs(v-window.__guideOverview.position[i])<.0001)&&p.target.every((v,i)=>Math.abs(v-window.__guideOverview.target[i])<.0001);})()`, 'original overview camera restored'),
  ...click('[data-action=exit]'), settled('IDLE'), ['click', '#start'], settled('INSPECTION_OVERVIEW'), ['click', '[data-id=tires]'], settled('TIRE_SELECTION'),
  expect(`${I}.userInspection().sessionId!==window.__guideSession&&Object.values(${I}.userInspection().tires).every(t=>t.status==='NOT_STARTED')`, 'exit clears memory session and creates a fresh identifier'), shot('05-new-session'));
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8123/inspect.html?capture=1', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)], { encoding: 'utf8', maxBuffer: 64 << 20 });
const stdout = r.stdout ?? '', passed = r.status === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + (r.stderr ?? ''));
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: r.status, width, height, source: 'USER_REPORTED_TEST_INPUT_NO_SDK', assertions: stdout.split('\n').filter(s => s.includes('PASS: ')) }, null, 2));
console.log(stdout.split('\n').map(s => s.slice(0, 260)).join('\n')); if (r.stderr) console.error(r.stderr); process.exitCode = passed ? 0 : 1;
