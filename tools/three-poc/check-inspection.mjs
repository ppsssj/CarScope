// node tools/three-poc/check-inspection.mjs <external output dir> [url] [width] [height]
// P3-A4 inspection flow in headless Chrome: real clicks on HTML controls, canvas picks through the page's
// own raycast (pointer events at projected part positions), screenshots per step. Needs the GLB served
// (CARSCOPE_IONIQ5_GLB) and, for the QR step, CARSCOPE_QR_AR_BASE_URL.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), out = resolve(process.argv[2] ?? ''), rel = relative(repo, out);
if (!process.argv[2] || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('Provide an output folder outside the repo');
mkdirSync(out, { recursive: true });
const [width, height] = [Number(process.argv[4] ?? 1600), Number(process.argv[5] ?? 1000)];
const I = 'window.__inspect';
const ev = (s) => ['eval', s], shot = (name) => [['wait', 300], ['shot', join(out, name + '.png'), 'body']];
const settled = (name) => ['until', `${I}.state.name==='${name}'&&!${I}.busy`, 15000];
// Fire pointerdown/up at a projected point: same code path as a mouse click on the canvas.
const tap = (point) => `(()=>{const p=${point},c=document.querySelector('#view canvas');for(const t of ['pointerdown','pointerup'])c.dispatchEvent(new PointerEvent(t,{clientX:p.x,clientY:p.y,bubbles:true,pointerId:1}));return JSON.stringify({p,state:${I}.state.name});})()`;
const expect = (cond, msg) => ev(`(()=>{if(!(${cond}))throw Error(${JSON.stringify(msg)});return ${JSON.stringify('PASS: ' + msg)};})()`);

const actions = [
  ['until', "window.__inspectReady||window.__inspectLog?.some(e=>e.tag==='load-error')", 60000],
  expect(`window.__inspectReady&&!document.getElementById('start').disabled`, 'model loaded, start enabled'),
  expect(`getComputedStyle(document.getElementById('panel')).transform!=='none'&&document.getElementById('dev').hidden`, 'home: panel and developer panel hidden'),
  ...shot('01-home'),
  ['click', '#start'], settled('INSPECTION_OVERVIEW'),
  expect(`${I}.hoodAngle===0&&document.querySelector('[data-action=area][data-id=hood]')`, 'overview: hood listed and closed'),
  // Closed hood occludes the bay: a pick at the cap position hits the hood, never the washer.
  expect(`${I}.hitAt(${I}.capPoint().x,${I}.capPoint().y)?.kind!=='washer'`, 'closed hood blocks washer pick'),
  ...shot('02-overview-hood-highlight'),
  // Duplicate input: three hood picks and a start click in one burst give exactly one transition.
  ev(`(()=>{const n=window.__inspectLog.length;${tap(`${I}.hoodPoint()`)};${tap(`${I}.hoodPoint()`)};${tap(`${I}.hoodPoint()`)};document.getElementById('start').click();
      const t=window.__inspectLog.slice(n).filter(e=>e.tag==='transition');if(t.length!==1||t[0].to!=='HOOD_OPENING')throw Error('duplicate picks: '+JSON.stringify(t));return 'PASS: duplicate hood picks -> one transition';})()`),
  ['wait', 500],
  expect(`${I}.state.name==='HOOD_OPENING'&&${I}.hoodAngle>0&&${I}.hoodAngle<60`, 'hood animating mid-way'),
  ...shot('03-hood-opening'),
  // Cancel mid-animation: hood reverses from its current angle and the flow returns to the overview.
  ev(`(()=>{const a=${I}.hoodAngle;document.getElementById('back').click();return JSON.stringify({cancelAt:a,state:${I}.state.name});})()`),
  expect(`${I}.state.name==='HOOD_CLOSING'`, 'cancel -> HOOD_CLOSING'),
  settled('INSPECTION_OVERVIEW'),
  expect(`${I}.hoodAngle===0`, 'cancel ends closed in overview'),
  // Open via the panel button this time (keyboard-accessible path).
  ['click', '[data-action=area][data-id=hood]'], settled('COMPONENT_SELECTION'),
  expect(`${I}.hoodAngle===60`, 'hood fully open (axis A, 60 deg)'),
  expect(`!document.getElementById('capLabel').hasAttribute('data-hidden')&&document.querySelectorAll('[data-action=component]').length===1&&document.querySelectorAll('.item[aria-disabled=true]').length===5`, 'cap label shown; washer only active item, 5 planned'),
  ...shot('04-component-selection'),
  ev(tap(`${I}.capPoint()`)), settled('WASHER_SELECTED'),
  expect(`${I}.state.component==='washer-fluid-cap'&&document.querySelector('#panel h2').textContent==='워셔액 점검'&&document.querySelector('#panel a.link').href.startsWith('https://manuals.hyundai.co.uk/')`, 'washer detail with manual source'),
  ...shot('05-washer-detail'),
  ['click', '[data-action=handoff]'], settled('MOBILE_HANDOFF_READY'),
  ['until', "document.querySelector('.qr img')?.complete&&document.querySelector('.qr img').naturalWidth>0", 5000],
  expect(`document.getElementById('handoffLink').href===${I}.handoff.url&&${I}.handoff.url.endsWith('/#v=1&task=washer-fluid')`, 'QR shown; direct link uses handoff contract'),
  ...shot('06-mobile-handoff'),
  ['shot', join(out, 'qr.png'), '.qr', 2],
  ['key', 'Escape', 'body'], settled('WASHER_SELECTED'),
  ['click', '[data-action=back]'], settled('COMPONENT_SELECTION'),
  expect(`${I}.hoodAngle===60`, 'back x2 keeps hood open'),
  ['click', '#back'], settled('INSPECTION_OVERVIEW'),
  expect(`${I}.hoodAngle===0`, 'back from components closes hood'),
  // Exit from deep in the flow closes the hood and returns home.
  ['click', '[data-action=area][data-id=hood]'], settled('COMPONENT_SELECTION'),
  ['click', '[data-action=component]'], settled('WASHER_SELECTED'),
  ['wait', 200],
  ev(`(()=>{${I}.dispatch({type:'EXIT'});return ${I}.state.name;})()`),
  settled('IDLE'),
  expect(`${I}.hoodAngle===0&&getComputedStyle(document.getElementById('back')).display==='none'`, 'exit -> home, hood closed'),
  // Back spam while the hood opens never leaves the flow half-way.
  ['click', '#start'], settled('INSPECTION_OVERVIEW'),
  ev(`(async()=>{const d=(t)=>${I}.dispatch({type:t,id:'hood'});for(let i=0;i<6;i++){d(i%2?'BACK':'SELECT_AREA');await new Promise(r=>setTimeout(r,90));}return ${I}.state.name;})()`),
  ['until', `!${I}.busy&&['INSPECTION_OVERVIEW','COMPONENT_SELECTION'].includes(${I}.state.name)`, 15000],
  expect(`(${I}.state.name==='INSPECTION_OVERVIEW'&&${I}.hoodAngle===0)`, 'rapid open/cancel settles closed in overview'),
  ev(`(()=>{${I}.dispatch({type:'EXIT'});return ${I}.state.name;})()`), settled('IDLE'),
  ['key', '`', 'body'],
  expect(`!document.getElementById('dev').hidden`, 'developer panel toggles'),
  ...shot('07-home-dev-panel'),
];
writeFileSync(join(out, 'actions.json'), JSON.stringify(actions));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), '.claude/skills/anatomy');
const r = spawnSync(process.execPath, ['--experimental-websocket', join(anatomy, 'scripts/drive.mjs'), process.argv[3] ?? 'http://127.0.0.1:8098/inspect.html', '--actions', join(out, 'actions.json'), '--width', String(width), '--height', String(height)], { encoding: 'utf8', maxBuffer: 64 << 20 });
const stdout = r.stdout ?? '', passes = stdout.split('\n').filter((s) => s.includes('PASS: '));
const passed = r.status === 0 && stdout.includes('console: clean');
writeFileSync(join(out, 'browser-log.txt'), stdout + '\n' + (r.stderr ?? ''));
writeFileSync(join(out, 'browser-results.json'), JSON.stringify({ passed, exitCode: r.status, width, height, passes }, null, 2));
console.log(stdout.split('\n').map((s) => s.slice(0, 300)).join('\n'));
if (r.stderr) console.error(r.stderr);
process.exitCode = passed ? 0 : 1;
