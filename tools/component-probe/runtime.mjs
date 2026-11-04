// Observe the existing Android Inspection WebView. No SDK injection or vehicle control.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { validateComponentStatus } from '../three-poc/component-status.mjs';
import { validateChargePortStatus } from '../three-poc/ev-charge-status.mjs';
import { validateVisibilityStatus } from '../three-poc/visibility-status.mjs';
import { validateTireStatus } from '../three-poc/tire-status.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const out = resolve(args.out ?? ''), rel = relative(resolve(import.meta.dirname, '../..'), out);
if (!args.out || !(rel.startsWith('..' + sep) || isAbsolute(rel)) || !/^\d+$/.test(args.port ?? '') || !args.adb) throw Error('External --out, --port and --adb required');
if (existsSync(resolve(out, 'results.json'))) throw Error('Existing evidence preserved');
mkdirSync(out, { recursive: true });
const adb = (...cmd) => execFileSync(args.adb, ['-s', 'emulator-5554', ...cmd], { timeout: 15000, maxBuffer: 32 << 20 });
if (adb('emu', 'avd', 'name').toString().split(/[\r\n]+/)[0].trim() !== 'CarScope_Pleos_API34' || adb('shell', 'am', 'get-current-user').toString().trim() !== '10') throw Error('Exact AVD/user required');
const pages = await (await fetch(`http://127.0.0.1:${args.port}/json/list`, { signal: AbortSignal.timeout(10000) })).json();
const matches = pages.filter(p => p.url === 'https://carscope-inspection.invalid/index.html?');
if (matches.length !== 1) throw Error('Exactly one private Inspection page required');
const endpoint = new URL(matches[0].webSocketDebuggerUrl);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== args.port) throw Error('Loopback socket required');
const socket = new WebSocket(endpoint);
await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
let id = 0; const pending = new Map();
socket.onmessage = ({ data }) => { const p = JSON.parse(data); if (p.id) { pending.get(p.id)?.(p); pending.delete(p.id); } };
const send = (method, params = {}) => new Promise((ok, fail) => {
  const key = ++id, timer = setTimeout(() => { pending.delete(key); fail(Error('CDP timeout: ' + method)); }, 15000);
  pending.set(key, p => { clearTimeout(timer); p.error ? fail(Error(p.error.message)) : ok(p.result); });
  socket.send(JSON.stringify({ id: key, method, params }));
});
const evaluate = async expression => { const p = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (p.exceptionDetails) throw Error(JSON.stringify(p.exceptionDetails)); return p.result.value; };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function until(expression) { const end = Date.now() + 60000; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(500); } throw Error('UI timeout: ' + expression); }
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button:'left', clickCount:1 });
  await until('!window.__inspect.busy');
}
const results = { scope:'ACTUAL_PLEOS_AVD_API34_USER10', status:'FAIL', packets:[], panels:[], checks:[] };
const save = () => writeFileSync(resolve(out,'results.json'), JSON.stringify(results,null,2));
try {
  await until('window.__inspectReady && document.visibilityState === "visible"');
  const channels = [['component-status.json',validateComponentStatus,'componentStatus'],['ev-charge-status.json',validateChargePortStatus,'chargePortStatus'],['visibility-status.json',validateVisibilityStatus,'visibilityStatus'],['tire-status.json',validateTireStatus,'tireStatus']];
  for (const [path, validate, hook] of channels) {
    const packet = await evaluate(`fetch('./${path}',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()})`);
    validate(packet);
    if (packet.connectionStatus !== 'ATTACHED' || packet.readings.some(r=>r.source !== 'PLEOS')) throw Error('Not attached PLEOS: '+path);
    results.packets.push({path,packet});
    const state = await evaluate(`window.__inspect.${hook}()`);
    if (JSON.stringify(state.readings) !== JSON.stringify(packet.readings)) throw Error('Native/UI mismatch: '+path);
    results.checks.push('Native cache and JS consumer match: '+path);
  }
  const observed = results.packets.flatMap(p=>p.packet.readings).filter(r=>r.observedAt !== null);
  await sleep(6500);
  for (const [path, validate] of channels) {
    const packet = await evaluate(`fetch('./${path}',{cache:'no-store'}).then(r=>r.json())`); validate(packet);
    results.packets.push({path,packet,stage:'after-6500ms'});
    for (const row of packet.readings) {
      const old = observed.find(r=>r.featureId===row.featureId && r.vehiclePartId===row.vehiclePartId);
      if (old && old.observedAt===row.observedAt && row.availabilityStatus !== 'STALE') throw Error('Observation did not become STALE');
    }
  }
  results.checks.push('5000ms policy preserved; cache reads do not fabricate observations');
  if (args['cache-only'] !== '1') {
  await click('#start');
  const panel = async (name, selector) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelectorAll('.sdk-details').forEach(e=>e.open=true);document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});true`);
    const text = await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    if (!text.includes('PLEOS')) throw Error('Panel lost SDK provenance: '+name);
    results.panels.push({name,text,state:await evaluate('window.__inspect.state')});
    writeFileSync(resolve(out,name+'.png'),adb('exec-out','screencap','-p')); save();
  };
  await click('[data-id="hood"]'); await click('[data-id="washer-fluid-cap"]'); await panel('washer','#componentStatusContent');
  await click('[data-action="back"]'); await click('[data-id="brake-fluid-reservoir"]'); await panel('brake','#componentStatusContent');
  await click('[data-action="back"]'); await click('[data-action="back"]');
  for (const [area,name,selector] of [['ev-battery','battery','#componentStatusContent'],['ev-charge','charge','#chargePortStatusContent'],['wipers','wiper','#visibilityStatusContent'],['lights','light','#visibilityStatusContent']]) {
    await click(`[data-id="${area}"]`); await panel(name,selector); await click('[data-action="back"]');
  }
  await click('[data-id="tires"]'); await click('[data-action="tire"]'); await panel('tire','#tireStatusContent');
  }
  results.status='PASS'; save(); console.log(args['cache-only'] === '1' ? 'PASS: actual Native cache → JS stores (cache-only)' : 'PASS: actual Native cache → JS stores → seven existing 3D panels; screenshots external');
} catch (error) { results.error=String(error); save(); throw error; }
finally { socket.close(); }
