// Explicit synthetic Chrome contract test. The server must use CARSCOPE_TIRE_UI_FIXTURE=<fixture file>.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusFixture } from './test/tire-status-fixture.mjs';
import { TIRES } from './inspection-tires.mjs';
const [dir, fixture, url = 'http://127.0.0.1:8115/inspect.html?capture=1&tireStatus=fixture', w = '1600', h = '1000'] = process.argv.slice(2);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const p of [dir, fixture]) {
  const rel = p && relative(repo, resolve(p));
  if (!rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Provide external evidence and fixture paths');
}
const out = resolve(dir), fixtureFile = resolve(fixture), width = Number(w), height = Number(h);
mkdirSync(out, { recursive: true });
// First browser packet is the actual Kotlin serializer's synthetic test output, untouched.
writeFileSync(fixtureFile, readFileSync(join(repo, 'app/build/test-results/tire-ui-v1.json')));
const I = 'window.__inspect', ev = s => ['eval', s];
const until = condition => ['until', condition, 15000];
const settled = state => until(`${I}.state.name==='${state}'&&!${I}.busy`);
const expect = (c, label) => ev(`(()=>{if(!(${c}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
const shot = name => ['shot', join(out, name + '.png'), 'body'];
const preserved = `(()=>{const p=${I}.cameraPose();return ${I}.state===window.__i1State&&${I}.state.component==='tire.front-left'&&p.position.every((v,i)=>Math.abs(v-window.__i1Pose.position[i])<0.0001)&&p.target.every((v,i)=>Math.abs(v-window.__i1Pose.target[i])<0.0001)&&${I}.renderInfo.geometries===window.__i1Geometry&&window.__inspectLog.filter(e=>e.tag==='loaded').length===window.__i1Loads;})()`;
const actions = [until(`window.__inspectReady&&${I}.tireStatus().readings[0].source==='MOCK'`),
  ['click', '#start'], settled('INSPECTION_OVERVIEW'), ['click', '[data-id=tires]'], settled('TIRE_SELECTION'),
  ['click', '[data-id="tire.front-left"]'], settled('TIRE_PREVIEW'),
  expect(`${I}.tireStatus().readings.some(r=>r.availabilityStatus==='STALE')&&document.getElementById('tireStatusContent').textContent.includes('MOCK · 모의 데이터')`, 'Kotlin projection reaches browser with explicit MOCK origin'),
  expect(`!['5544.125','PSI','kPa','bar'].some(s=>document.getElementById('panel').textContent.includes(s))&&${I}.tireStatus().readings.every(r=>!('value'in r)&&!('unit'in r)&&!('reason'in r))`, 'no raw pressure, unit or SDK reason in status UI'), shot('01-kotlin-mock'),
  ev(`window.__i1Pose=${I}.cameraPose();window.__i1State=${I}.state;window.__i1Geometry=${I}.renderInfo.geometries;window.__i1Loads=window.__inspectLog.filter(e=>e.tag==='loaded').length;'save model state'`),
  ev(`'FIXTURE_STAGE:varied'`), until(`${I}.tireStatus().readings.find(r=>r.featureId==='tire.pressure'&&r.vehiclePartId==='tire.front-left').availabilityStatus==='UNVERIFIED'`),
  expect(preserved, 'status update preserves selected object, pose, loaded model and geometry'),
  expect(`document.getElementById('tireStatusContent').textContent.includes('UNRESOLVED')`, 'UNRESOLVED shown separately from TireStatus'), shot('02-varied-states')];
for (const t of TIRES) actions.push(
  ev(`document.querySelector('[data-action=tire][data-id="${t.id}"]').scrollIntoView({block:'center'});'scroll tire button'`),
  ['click', `[data-action=tire][data-id="${t.id}"]`], settled('TIRE_PREVIEW'),
  expect(`(()=>{const rows=${I}.tireStatus().readings.filter(r=>r.vehiclePartId==='${t.id}');return rows.length===2&&rows.every(r=>{const dd=[...document.querySelector('[data-feature="'+r.featureId+'"]').querySelectorAll('dd')].map(e=>e.textContent);return dd[0]===r.capabilityStatus&&dd[1]===r.availabilityStatus&&dd[2]===(r.observedAt===null?'없음':new Date(r.observedAt).toISOString());});})()`, 'exact two-feature mapping ' + t.id),
  ev(`document.getElementById('panel').scrollTop=0;'show identity and source'`), shot(t.id));
actions.push(
  ev(`${I}.dispatch({type:'SELECT_TIRE',id:'tire.front-left'});'select lifecycle target'`), settled('TIRE_PREVIEW'),
  ev(`window.__i1Pose=${I}.cameraPose();window.__i1State=${I}.state;window.dispatchEvent(new Event('carscope-tire-inactive'));'invalidate native lifecycle'`),
  expect(`${I}.tireStatus().connectionStatus==='STOPPED'&&${I}.tireStatus().readings.every(r=>r.source===null&&r.observedAt===null)`, 'pause invalidates all eight observations'),
  expect(preserved, 'invalidation keeps 3D selection and camera'), shot('03-stopped'),
  ev(`'FIXTURE_STAGE:recovered'`), ev(`window.dispatchEvent(new Event('carscope-tire-active'));'resume native lifecycle'`),
  until(`${I}.tireStatus().readings[0].source==='MOCK'`), expect(preserved, 'resume accepts fresh status without model reload'),
  ev(`'FIXTURE_STAGE:invalid'`), until(`${I}.tireStatus().connectionStatus==='UNAVAILABLE'`),
  expect(`${I}.tireStatus().readings.every(r=>r.availabilityStatus==='ERROR'&&r.observedAt===null)&&!document.getElementById('panel').textContent.includes('PRIVATE_SECRET')`, 'malformed status rejected as transport ERROR, no secret displayed'),
  expect(preserved, 'invalid packet cannot reset camera or selected tire'), shot('04-invalid-rejected'),
  ['click', '#back'], settled('TIRE_SELECTION'), ['click', '[data-action=exit]'], settled('IDLE'),
  expect(`${I}.hoodAngle===0&&${I}.state.component===null`, 'normal back and exit remain functional')
);
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const child = spawn(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), url, '--actions', join(out, 'actions.json'), '--width', w, '--height', h]);
let stdout = '', stderr = ''; const applied = new Set();
child.stdout.on('data', chunk => {
  stdout += chunk;
  for (const name of ['varied', 'recovered', 'invalid']) if (stdout.includes('FIXTURE_STAGE:' + name) && !applied.has(name)) {
    applied.add(name); const packet = statusFixture(name === 'varied' ? 3 : name === 'recovered' ? 4 : 5);
    if (name === 'invalid') packet.readings[0].reason = 'PRIVATE_SECRET';
    writeFileSync(fixtureFile, JSON.stringify(packet));
  }
});
child.stderr.on('data', chunk => { stderr += chunk; });
const code = await new Promise(resolve => child.on('exit', resolve));
const passed = code === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + stderr);
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: code, width, height, source: 'SYNTHETIC_MOCK_ONLY', assertions: stdout.split('\n').filter(s => s.includes('PASS: ')) }, null, 2));
console.log(stdout.split('\n').map(s => s.slice(0, 350)).join('\n')); if (stderr) console.error(stderr); process.exitCode = passed ? 0 : 1;
