// Actual Kotlin MOCK cache projection and A's merged pack, on the real reference GLB.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateComponentStatus } from './component-status.mjs';
import { buildEvBatteryPack } from '../ioniq5-asset/ev-battery.mjs';
const [folder, golden] = process.argv.slice(2), here = dirname(fileURLToPath(import.meta.url));
const width = Number(process.argv[4] ?? 1600), height = Number(process.argv[5] ?? 1000);
const out = resolve(folder ?? ''), rel = relative(resolve(here, '../..'), out);
if (!folder || !golden || !(rel.startsWith('..' + sep) || isAbsolute(rel)) || !process.env.CARSCOPE_IONIQ5_GLB) throw Error('External output, actual Kotlin golden and CARSCOPE_IONIQ5_GLB required');
const packet = validateComponentStatus(JSON.parse(readFileSync(golden, 'utf8')));
if (!packet.readings.every(r => r.source === 'MOCK')) throw Error('Synthetic MOCK only');
mkdirSync(out, { recursive: true }); const fixture = join(out, 'fixture.json'); writeFileSync(fixture, JSON.stringify(packet));
const server = spawn(process.execPath, [join(here, 'serve.mjs')], { env: { ...process.env, PORT: '0', CARSCOPE_COMPONENT_UI_FIXTURE: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  let log = '';
  const origin = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(Error('Startup timeout')), 10000);
    server.stdout.on('data', bytes => { log += bytes; const m = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) { clearTimeout(timer); ok(m[0]); } });
    server.once('error', fail); server.once('exit', c => fail(Error('Server exit ' + c)));
  });
  const I = 'window.__inspect', ev = s => ['eval', s], until = s => ['until', s, 20000];
  const settled = s => until(`${I}.state.name==='${s}'&&!${I}.busy`);
  const expect = (s, label) => ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
  const click = selector => [ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});true`), ['click', selector]];
  const actions = [until(`window.__inspectReady&&${I}.componentStatus().readings[0].source==='MOCK'`),
    ['click', '#start'], settled('INSPECTION_OVERVIEW'), ev(`window.__evUser=${I}.userInspection().sessionId;true`),
    ...click('[data-action=area][data-id=ev-battery]'), settled('EV_BATTERY_PREVIEW'),
    expect(`${I}.hoodAngle===0&&${I}.batteryView().visible&&!${I}.batteryView().floorVisible&&!${I}.batteryView().ringVisible&&${I}.view().polarDeg>90`, 'underbody view exposes the pack without opening hood or moving model'),
    expect(`JSON.stringify(${I}.batteryView().meta)===${JSON.stringify(JSON.stringify(buildEvBatteryPack().parts[0].meta))}`, 'A model metadata and identity reused without modification'),
    expect(`(()=>{const p=${I}.componentPoint('ev-battery.pack');return ${I}.hitAt(p.x,p.y)?.id==='ev-battery.pack';})()`, 'visible pack center ray hits actual merged geometry with normal depth testing'),
    expect(`document.getElementById('componentStatusContent').querySelectorAll('[data-component-feature]').length===2&&document.getElementById('componentStatusContent').textContent.includes('73')&&document.getElementById('componentStatusContent').textContent.includes('false')&&!document.getElementById('componentStatusContent').textContent.includes('%')`, 'two Kotlin raw EV reports have no invented percentage or charging-in-progress'),
    ['shot', join(out, '00-ev-model.png'), 'body'],
    ev(`document.getElementById('componentStatusContent').scrollIntoView({block:'center'});window.__evPose=${I}.cameraPose();window.__evGeometry=${I}.renderInfo.geometries;true`),
    ['shot', join(out, '01-ev-cache.png'), 'body'],
    ev(`window.dispatchEvent(new Event('carscope-component-inactive'));true`),
    expect(`${I}.componentStatus().readings.every(r=>r.value===null&&r.source===null)&&${I}.userInspection().sessionId===window.__evUser&&JSON.stringify(${I}.cameraPose())===JSON.stringify(window.__evPose)&&${I}.renderInfo.geometries===window.__evGeometry`, 'pause clears SDK observations and preserves model camera and USER_REPORTED session'),
    ev(`window.dispatchEvent(new Event('carscope-component-active'));true`), until(`${I}.componentStatus().readings[0].source==='MOCK'`),
    ...click('[data-action=back]'), settled('INSPECTION_OVERVIEW'),
    expect(`!${I}.batteryView().visible&&${I}.batteryView().floorVisible&&${I}.batteryView().ringVisible&&${I}.batteryView().maxPolarAngle<Math.PI/2`, 'Back restores scene decorations and original orbit constraints'),
    ...click('[data-action=area][data-id=ev-battery]'), settled('EV_BATTERY_PREVIEW'),
    ...click('[data-action=product-summary]'), settled('INSPECTION_SUMMARY'),
    expect(`${I}.hoodAngle===0&&!${I}.batteryView().visible&&${I}.userInspection().sessionId===window.__evUser`, 'EV summary closes view without adding user results'),
    ...click('[data-action=exit]'), settled('IDLE'),
    expect(`${I}.userInspection().sessionId!==window.__evUser&&${I}.batteryView().floorVisible&&!${I}.batteryView().visible`, 'explicit end resets only the established memory session'),
    ev(`${I}.dispose('ev-test');true`)];
  writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
  const child = spawn(process.execPath, ['--experimental-websocket', join(process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy'), 'scripts/drive.mjs'), origin + 'inspect.html?capture=1&componentStatus=fixture', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)]);
  let stdout = '', stderr = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  const code = await new Promise((ok, fail) => { child.once('exit', ok); child.once('error', fail); });
  const passed = code === 0 && stdout.includes('console: clean');
  writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + stderr);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, width, height, scope: 'DESKTOP_CHROME_REAL_GLB_KOTLIN_MOCK_NO_DEVICE', avd: 'NOT_RUN', assertions: stdout.split('\n').filter(s => s.includes('PASS: ')) }, null, 2));
  console.log(stdout); if (stderr) console.error(stderr); if (!passed) process.exitCode = 1;
} finally { server.kill(); }
