// Existing GLB and real Chrome input. Native shell JS checks below are desktop simulation, not Android runtime.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(process.argv[2] ?? ''), rel = relative(repo, out);
if (!process.argv[2] || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('External evidence required');
mkdirSync(out, { recursive: true });
const width = Number(process.argv[4] ?? 1600), height = Number(process.argv[5] ?? 1000), I = 'window.__inspect';
const ev = s => ['eval', s], until = s => ['until', s, 20000], settled = s => until(`${I}.state.name==='${s}'&&!${I}.busy`);
const expect = (s, label) => ev(`(()=>{if(!(${s}))throw Error(${JSON.stringify(label)});return ${JSON.stringify('PASS: ' + label)};})()`);
const click = selector => [ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});'scroll'`), ['click', selector]];
const summary = () => [...click('[data-action=product-summary]'), settled('INSPECTION_SUMMARY')];
const shot = name => ['shot', join(out, name + '.png'), 'body'];
const actions = [until('window.__inspectReady'),
  expect(`document.getElementById('panel').inert&&!document.getElementById('home').inert`, 'home exposes only active controls'),
  ['click', '#start'], settled('INSPECTION_OVERVIEW'), ...summary(),
  expect(`document.querySelector('[data-result-source=USER_REPORTED]').textContent.includes('0/4')`, 'whole summary is available before any answers'),
  expect(`document.querySelector('[data-result-source=NOT_RECORDED]').textContent.includes('QR 표시는 점검 완료가 아닙니다')`, 'washer guidance never fabricates a completed result'),
  expect(`document.getElementById('home').inert&&document.activeElement.tagName==='H2'`, 'summary focus and hidden home controls'), shot('01-empty-summary'),
  ...click('[data-action=tire][data-id="tire.front-left"]'), settled('TIRE_PREVIEW'),
  ev(`window.__productSession=${I}.userInspection().sessionId;'remember session'`)];
for (const check of ['damage', 'debris', 'wear']) actions.push(...click(`input[data-check=${check}][value=UNABLE]`));
actions.push(...click('[data-action=confirm-tire]'), ...summary(),
  expect(`${I}.userInspection().tires['tire.front-left'].status==='COMPLETED'&&document.getElementById('panel').textContent.includes('1/4')`, 'confirmed tire appears in whole-session summary'),
  ...click('[data-action=area][data-id=hood]'), settled('COMPONENT_SELECTION'),
  ...click('[data-action=component][data-id="washer-fluid-cap"]'), settled('WASHER_SELECTED'),
  expect(`document.querySelectorAll('[data-action=exit]').length===1&&document.querySelector('[data-action=exit]').textContent.includes('기록 지우기')`, 'washer detail has the same explicit end action'),
  ...summary(), expect(`${I}.hoodAngle===0&&${I}.state.component===null`, 'washer-to-summary closes hood and clears selection'),
  expect(`${I}.userInspection().sessionId===window.__productSession&&${I}.userInspection().tires['tire.front-left'].status==='COMPLETED'`, 'cross-area navigation preserves memory records'), shot('02-combined-summary'),
  ...click('[data-action=tire][data-id="tire.front-left"]'), settled('TIRE_PREVIEW'),
  ...click('input[data-check=damage][value=FOUND]'),
  expect(`${I}.userInspection().tires['tire.front-left'].completedAt===null`, 'edit from summary requires reconfirmation'),
  ...click('[data-action=confirm-tire]'), ...summary(),
  ...click('[data-action=back]'), settled('INSPECTION_OVERVIEW'), ...click('[data-action=area][data-id=hood]'),
  ...click('[data-action=product-summary]'), settled('INSPECTION_SUMMARY'),
  expect(`${I}.hoodAngle===0`, 'summary during opening settles hood closed'),
  ...click('[data-action=area][data-id=hood]'), settled('COMPONENT_SELECTION'), ...click('[data-action=component][data-id="washer-fluid-cap"]'), settled('WASHER_SELECTED'),
  ...click('[data-action=handoff]'), settled('MOBILE_HANDOFF_READY'), ...summary(),
  expect(`document.querySelector('[data-result-source=NOT_RECORDED]')&&${I}.userInspection().sessionId===window.__productSession`, 'QR return retains tire records without inventing washer data'),
  ...click('[data-action=exit]'), settled('IDLE'),
  expect(`${I}.userInspection().sessionId!==window.__productSession&&Object.values(${I}.userInspection().tires).every(r=>r.status==='NOT_STARTED')&&document.activeElement.id==='start'`, 'end deletes records and restores home focus'),
  ['click', '#start'], settled('INSPECTION_OVERVIEW'), ...summary(),
  expect(`document.querySelector('[data-result-source=USER_REPORTED]').textContent.includes('0/4')`, 're-entry starts a fresh session'),
  // Import the shipped Android shell in desktop Chrome; native boundary is separately tested by Robolectric.
  ev(`import('./android-inspect-shell.js').then(()=>true)`), until('Boolean(window.__androidShell)'),
  ev(`window.__androidShell.back();true`), settled('INSPECTION_OVERVIEW'),
  expect(`${I}.state.name==='INSPECTION_OVERVIEW'`, 'Android shell Back shares browser step navigation'),
  ...click('[data-action=area][data-id=hood]'), settled('COMPONENT_SELECTION'), ...click('[data-action=component][data-id="washer-fluid-cap"]'), settled('WASHER_SELECTED'),
  shot('03-washer-link'), ...click('a.link'), expect(`document.getElementById('androidLinkNotice')?.textContent.includes('열 수 없습니다')`, 'blocked native external link has visible feedback'),
  ev(`window.__androidShell.back();true`), settled('COMPONENT_SELECTION'),
  expect(`${I}.state.name==='COMPONENT_SELECTION'&&!document.getElementById('androidLinkNotice')`, 'native shell step back keeps page alive and replaces old feedback'), shot('03-android-shell-desktop'),
  expect(`document.documentElement.scrollWidth===innerWidth&&[...document.querySelectorAll('.session-actions button')].every(e=>e.getBoundingClientRect().height>=44)`, 'session controls fit viewport and maintain touch target height'));
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8131/inspect.html?capture=1', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)], { encoding: 'utf8', maxBuffer: 64 << 20 });
const stdout = r.stdout ?? '', passed = r.status === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + (r.stderr ?? ''));
writeFileSync(join(out, 'results.json'), JSON.stringify({ passed, exitCode: r.status, width, height, scope: 'DESKTOP_CHROME_REAL_GLB_AND_ANDROID_SHELL_JS_SIMULATION_NO_ANDROID_RUNTIME', assertions: stdout.split('\n').filter(s=>s.includes('PASS: ')) }, null, 2));
console.log(stdout.split('\n').map(s=>s.slice(0,280)).join('\n')); if(r.stderr) console.error(r.stderr); process.exitCode = passed ? 0 : 1;
