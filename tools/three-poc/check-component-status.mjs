// Actual Kotlin synthetic projection + real existing GLB in desktop Chrome. Never Android/vehicle evidence.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateComponentStatus } from './component-status.mjs';
const [output, goldenFile] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
if (!output || !goldenFile || !process.env.CARSCOPE_IONIQ5_GLB) throw Error('Provide external evidence folder, Kotlin golden JSON and CARSCOPE_IONIQ5_GLB');
const out = resolve(output), rel = relative(repo, out);
if (!(rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Evidence must be external');
mkdirSync(out, { recursive: true });
const golden = validateComponentStatus(JSON.parse(readFileSync(goldenFile, 'utf8')));
if (golden.readings.some(r => r.source !== 'MOCK')) throw Error('Only explicit synthetic Kotlin fixture accepted');
const fixture = join(out, 'fixture.json');
const update = (packet) => { writeFileSync(fixture + '.tmp', JSON.stringify(packet)); renameSync(fixture + '.tmp', fixture); };
update(golden);
const server = spawn(process.execPath, [join(here, 'serve.mjs')], { env: { ...process.env, PORT: '0', CARSCOPE_COMPONENT_UI_FIXTURE: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
let serviceLog = '';
try {
  const origin = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(Error('Local server startup timeout')), 10000);
    server.stdout.on('data', bytes => { serviceLog += bytes; const m = serviceLog.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) { clearTimeout(timer); ok(m[0]); } });
    server.once('error', fail); server.once('exit', code => fail(Error('Local server exited ' + code)));
  });
  const I = 'window.__inspect', ev = s => ['eval', s], until = s => ['until', s, 20000];
  const settled = s => until(`${I}.state.name==='${s}'&&!${I}.busy`);
  const expect = (s, label) => ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
  const preserved = `${I}.state===window.__componentFlow&&${I}.renderInfo.geometries===window.__componentGeometries&&${I}.cameraPose().position.every((v,i)=>Math.abs(v-window.__componentPose.position[i])<0.0001)&&${I}.userInspection().sessionId===window.__componentUser`;
  const remember = ev(`window.__componentFlow=${I}.state;window.__componentGeometries=${I}.renderInfo.geometries;window.__componentPose=${I}.cameraPose();window.__componentUser=${I}.userInspection().sessionId;'remember'`);
  const stage = name => ev(JSON.stringify('FIXTURE_STAGE:' + name));
  const actions = [until(`window.__inspectReady&&${I}.componentStatus().readings[0].source==='MOCK'`), ['click', '#start'], settled('INSPECTION_OVERVIEW'),
    ['click', '[data-id=hood]'], settled('COMPONENT_SELECTION'), ['click', '[data-id="washer-fluid-cap"]'], settled('WASHER_SELECTED'),
    expect(`document.getElementById('componentStatusContent').textContent.includes('STALE')&&document.getElementById('componentStatusContent').textContent.includes('false')`, 'Kotlin false and STALE reach washer panel without healthy inference'),
    expect(`document.getElementById('componentStatusContent').textContent.includes('USER_REPORTED')&&document.getElementById('componentStatusContent').textContent.includes('형상 정확도')`, 'SDK provenance remains independent of user record and geometry'),
    remember, stage('denied'), until(`document.getElementById('componentStatusContent').textContent.includes('PERMISSION_DENIED')`),
    expect(preserved, 'cache update preserves selection camera geometry and user session'), ['shot', join(out, '01-washer-denied.png'), 'body'],
    ['click', '[data-action=back]'], settled('COMPONENT_SELECTION'), ['click', '[data-id="brake-fluid-reservoir"]'], settled('COMPONENT_PREVIEW'),
    expect(`document.getElementById('componentStatusContent').textContent.includes('LOW')&&${I}.state.component==='brake-fluid-reservoir'`, 'brake report uses existing part ID and actual typed report'),
    remember, stage('invalid'), until(`${I}.componentStatus().connectionStatus==='UNAVAILABLE'`),
    expect(`${preserved}&&!document.body.textContent.includes('PRIVATE_MARKER')&&${I}.componentStatus().readings.every(r=>r.value===null&&r.observedAt===null)`, 'invalid packet clears data without leaked reason or model changes'),
    stage('recovered'), until(`document.getElementById('componentStatusContent').textContent.includes('NORMAL')`),
    expect(`${preserved}&&document.getElementById('componentStatusContent').textContent.includes('차량 안전·정상 판정이 아닙니다')`, 'NORMAL remains SDK-reported enum without a vehicle safety verdict'), ['shot', join(out, '02-brake-report.png'), 'body'],
    stage('replay'), ['wait', 1500], expect(`document.getElementById('componentStatusContent').textContent.includes('NORMAL')`, 'old sequence cannot replace the current report'),
    ev(`window.dispatchEvent(new Event('carscope-component-inactive'));true`), expect(`${I}.componentStatus().readings.every(r=>r.source===null&&r.value===null)`, 'native inactive signal immediately clears observations'),
    ev(`window.dispatchEvent(new Event('carscope-component-active'));true`), until(`${I}.componentStatus().readings[0].source==='MOCK'`),
    expect(`${preserved}`, 'resume keeps independent user session and geometry'),
    ev(`${I}.dispose('component-test');true`), expect(`${I}.componentStatus().connectionStatus==='STOPPED'`, 'renderer disposal stops component polling')];
  writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
  const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
  const child = spawn(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), origin + 'inspect.html?capture=1&componentStatus=fixture', '--actions', join(out, 'actions.json'), '--width', '1600', '--height', '1000']);
  let stdout = '', stderr = ''; const applied = new Set();
  child.stdout.on('data', bytes => {
    stdout += bytes;
    for (const name of ['denied', 'invalid', 'recovered', 'replay']) if (stdout.includes('FIXTURE_STAGE:' + name) && !applied.has(name)) {
      applied.add(name); const packet = structuredClone(golden); packet.sequence = name === 'denied' ? 2 : name === 'invalid' ? 3 : name === 'recovered' ? 4 : 2;
      const washer = packet.readings[0], brake = packet.readings[1];
      Object.assign(washer, { capabilityStatus: 'PERMISSION_DENIED', availabilityStatus: 'PERMISSION_DENIED', observedAt: null, value: null });
      Object.assign(brake, { availabilityStatus: 'SUPPORTED', observedAt: 2000, value: name === 'recovered' ? 'NORMAL' : 'LOW' });
      if (name === 'invalid') brake.reason = 'PRIVATE_MARKER';
      update(packet);
    }
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const code = await new Promise((ok, fail) => { child.once('exit', ok); child.once('error', fail); });
  const passed = code === 0 && stdout.includes('console: clean');
  writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + stderr);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: code, scope: 'KOTLIN_MOCK_TO_DESKTOP_CHROME_REAL_EXISTING_GLB', avd: 'NOT_RUN', vehicle: 'NOT_RUN', assertions: stdout.split('\n').filter(s => s.includes('PASS: ')) }, null, 2));
  console.log(stdout.split('\n').map(s => s.slice(0, 320)).join('\n')); if (stderr) console.error(stderr); if (!passed) process.exitCode = 1;
} finally { server.kill(); }
