// Existing WebView DevTools socket only. No browser/app startup, bridge, policy bypass or SDK state injection.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessExchange, sdkCapabilityObservation, ORIGIN, ENDPOINT } from './evidence.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), out = resolve(args.out ?? ''), rel = relative(repo, out);
if (!args.out || !rel || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('External output required');
if (!/^emulator-\d+$/.test(args.serial ?? '') || !/^\d+$/.test(args.user ?? '') || !Number.isInteger(Number(args.cpus)) || !(Number(args.cpus) > 0)
  || !/^\d+$/.test(args.port ?? '') || Number(args.port) > 65535 || !args.csp || !/^[a-f0-9]{32}$/.test(args['run-id'] ?? '')) throw Error('Runner must supply verified target/user/CPU/forwarding port/CSP/run ID');
mkdirSync(out, { recursive: true });
if (existsSync(join(out, 'webview-results.json'))) throw Error('Existing evidence preserved; use a fresh run directory');
const result = { runId: args['run-id'], status: 'BLOCKED', checks: {}, snapshots: [], exchanges: [], network: [], errors: [], input: 'CDP pointer events in the existing Android WebView' };
for (const name of ['late_sdk_callback', 'sdk_listener', 'sdk_release_ack', 'renderer_exit', 'recreation']) result.checks[name] = { status: 'NOT_RUN', reason: 'Requires independent runtime observation/manual scenario; never inferred from static declarations' };
let socket, nextId = 0, connectionGeneration = 0, stage = 'webview_render'; const pending = new Map(), packets = new Map(), completed = [];
class Blocked extends Error {}
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2));
const adb = (...cmd) => {
  try { return execFileSync(args.adb, ['-s', args.serial, ...cmd], { timeout: 5000, encoding: 'utf8', maxBuffer: 8 << 20 }).trim(); }
  catch (_) { throw new Blocked('ADB stopped responding: ' + cmd.slice(0, 3).join(' ')); }
};
function pulse() {
  if (adb('emu', 'avd', 'name').split(/\r?\n/)[0] !== 'CarScope_Pleos_API34' || adb('shell', 'getprop', 'sys.boot_completed') !== '1') throw new Blocked('AVD identity/boot changed');
  const load = adb('shell', 'cat', '/proc/loadavg').split(/\s+/).slice(0, 2).map(Number);
  if (load.length !== 2 || !load.every(n => Number.isFinite(n) && n >= 0) || load[0] > Number(args.cpus)
    || load[1] > Number(args.cpus) * 1.5 || !/^\d+$/.test(adb('shell', 'pidof', 'com.android.systemui'))) throw new Blocked('AVD load/SystemUI gate deteriorated');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mark = (name, condition, data = {}) => { result.checks[name] = { status: condition ? 'PASS' : 'FAIL', ...data }; if (!condition) throw Error(name); };
async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await sleep(200); }
  throw new Blocked('Timed out: ' + label);
}
function send(method, params = {}, wire = socket) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Blocked('CDP timeout: ' + method)); }, 10000);
    pending.set(id, data => { clearTimeout(timer); data.error ? reject(new Blocked(data.error.message)) : resolve(data.result); });
    wire.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result?.value;
}
async function connect() {
  const generation = ++connectionGeneration;
  completed.length = 0; packets.clear();
  const pages = await (await fetch(`http://127.0.0.1:${args.port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const candidates = pages.filter(p => { try { const u = new URL(p.url); return u.origin === ORIGIN && u.pathname === '/index.html' && !u.searchParams.has('tireStatus'); } catch (_) { return false; } });
  let selected = null;
  for (const page of candidates) {
    const endpoint = new URL(page.webSocketDebuggerUrl);
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== args.port) throw new Blocked('Non-loopback DevTools target');
    socket = new WebSocket(endpoint);
    const wire = socket;
    await new Promise((r, reject) => {
      const timer = setTimeout(() => { wire.close(); reject(new Blocked('DevTools handshake timeout')); }, 5000);
      wire.onopen = () => { clearTimeout(timer); r(); };
      wire.onerror = () => { clearTimeout(timer); reject(new Blocked('DevTools unavailable')); };
    });
    socket.onmessage = async ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const done = pending.get(message.id); pending.delete(message.id); done?.(message); return; }
      const p = message.params;
      if (message.method === 'Network.requestWillBeSent' && p.request.url === ENDPOINT) packets.set(p.requestId, { url: p.request.url, method: p.request.method });
      if (message.method === 'Network.responseReceived' && packets.has(p.requestId)) {
        Object.assign(packets.get(p.requestId), { status: p.response.status, headers: p.response.headers });
        result.network.push({ url: p.response.url, status: p.response.status });
      }
      if (message.method === 'Network.loadingFailed' && packets.has(p.requestId)) { result.network.push({ url: ENDPOINT, failed: true }); packets.delete(p.requestId); }
      if (result.network.length > 20) result.network.shift();
      if (message.method === 'Network.loadingFinished' && packets.has(p.requestId)) {
        try {
          const r = await send('Network.getResponseBody', { requestId: p.requestId }, wire);
          const raw = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
          if (generation === connectionGeneration) {
            completed.push({ ...packets.get(p.requestId), body: JSON.parse(raw) }); if (completed.length > 20) completed.shift();
          }
        } catch (_) { /* no evidence is better than assuming that a request succeeded */ }
        packets.delete(p.requestId);
      }
    };
    if (await evaluate("document.visibilityState==='visible'")) {
      if (selected) { selected.close(); socket.close(); throw new Blocked('Multiple visible private WebViews; refusing to guess'); }
      selected = socket;
    } else socket.close();
  }
  if (!selected) throw new Blocked('No visible private Inspection WebView');
  socket = selected;
  await send('Runtime.enable'); await send('Network.enable');
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}
async function shot(name) {
  const image = execFileSync(args.adb, ['-s', args.serial, 'exec-out', 'screencap', '-p'], { timeout: 5000, maxBuffer: 32 << 20 });
  writeFileSync(join(out, name + '.png'), image);
}
async function settled(name) { await until(() => evaluate(`window.__inspect?.state.name==='${name}'&&!window.__inspect.busy`), name); }
function foreground(name) {
  return adb('shell', 'dumpsys', 'activity', 'activities').split(/\r?\n/).some(line =>
    /mResumedActivity|topResumedActivity/.test(line) && line.includes('io.carscope.app/') && line.includes(name));
}
async function matchedExchange() {
  return until(async () => {
    const ui = await evaluate('window.__inspect.tireStatus()');
    for (const packet of completed.toReversed()) {
      try { return assessExchange({ ...packet, ui, expectedCsp: args.csp }); } catch (e) { result.lastContractFailure = e.message; }
    }
    return false;
  }, 'private native response, strict contract and JS store match', 15000);
}
try {
  pulse(); await connect();
  await until(() => evaluate('Boolean(window.__inspectReady)'), 'model readiness', 60000);
  const info = await evaluate('({render:window.__inspect.renderInfo,tires:window.__inspect.tireInfo(),pose:window.__inspect.cameraPose()})');
  mark('webview_render', info.render.calls > 0); mark('model', info.render.triangles > 0);
  mark('four_tires', info.tires.length === 4 && new Set(info.tires.map(t => t.id)).size === 4);
  await click('#start'); await settled('INSPECTION_OVERVIEW'); await click('[data-id=tires]'); await settled('TIRE_SELECTION');
  const listPose = await evaluate('window.__inspect.cameraPose()');
  for (const { id } of info.tires) {
    stage = 'selection';
    pulse(); await click(`[data-action=tire][data-id="${id}"]`); await settled('TIRE_PREVIEW');
    const current = await evaluate('({state:window.__inspect.state,tires:window.__inspect.tireInfo(),status:window.__inspect.tireStatus(),text:document.getElementById("tireStatusContent").textContent})');
    mark('selection', current.state.component === id);
    mark('highlight', current.tires.every(t => t.wheelMeshes.every(m => m.highlighted === (t.id === id && m.material === 'Tire'))));
    stage = 'webview_status';
    const matched = await matchedExchange(); result.exchanges.push(matched); result.snapshots.push({ id, ...current });
    result.checks.native_projection = { status: 'PASS', reason: 'Observed matching private response; SDK provenance is the verified APK/forwarding chain' };
    result.checks.webview_status = { status: 'PASS', reason: 'Native response == sanitized JS store; no-store/CSP/status contract checked' };
    mark('switch', current.state.component === id); await shot(id);
    await click('#back'); await settled('TIRE_SELECTION');
    const restored = await evaluate('window.__inspect.cameraPose()');
    mark('camera_restore', ['position', 'target'].every(k => restored[k].every((n, i) => Math.abs(n - listPose[k][i]) < 0.0001)));
  }
  result.checks.sdk_capability = sdkCapabilityObservation(result.exchanges.at(-1).view.readings);
  result.checks.stale_error = { status: result.exchanges.some(e => e.view.readings.some(r => ['STALE', 'ERROR'].includes(r.availabilityStatus))) ? 'PASS' : 'NOT_RUN', reason: 'Only actually observed states count; no SDK values are injected' };
  // Open the existing native Probe, then return. Never force-stop or use global rotation/settings.
  const previous = result.exchanges.at(-1).sessionId;
  stage = 'probe_transfer';
  pulse(); adb('shell', 'am', 'start', '--user', args.user, '-n', 'io.carscope.app/.tire.TireProbeActivity'); await sleep(1500);
  await until(() => foreground('TireProbeActivity'), 'native Probe foreground');
  await shot('probe'); socket.close(); completed.length = 0;
  adb('shell', 'am', 'start', '--user', args.user, '-n', 'io.carscope.app/.lab.InspectionActivity'); await sleep(1500);
  await until(() => foreground('InspectionActivity'), 'native Inspection foreground');
  await connect(); await until(() => evaluate('Boolean(window.__inspectReady)'), 'resumed model');
  stage = 'pause_resume'; const resumed = await matchedExchange();
  mark('pause_resume', resumed.sessionId !== previous, { reason: 'New lease generation observed; OS rotation/saved-state recreation not inferred' });
  result.checks.probe_transfer = { status: 'PASS', reason: 'Native Probe foregrounded and Inspection returned with a different UI generation' };
  result.exchanges.push(resumed); await shot('inspection-returned');
  stage = 'screen_exit'; await evaluate("window.__androidShell.closeScreen('p3-i2-runtime-complete')");
  result.checks.screen_exit = { status: 'PASS', reason: 'Close request returned; SDK release acknowledgement not implied' };
  result.status = Object.values(result.checks).some(c => c.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
} catch (e) {
  result.status = e instanceof Blocked ? 'BLOCKED' : 'FAIL'; result.errors.push(String(e.message));
  result.checks[stage] = { status: result.status, reason: e.message };
  try { result.lastPageState = await evaluate('({ready:Boolean(window.__inspectReady),status:window.__inspect?.tireStatus()})'); } catch (_) { }
} finally {
  try { socket?.close(); } catch (_) { }
  save('webview-results.json', result);
}
console.log(JSON.stringify({ status: result.status, checks: result.checks, errors: result.errors }, null, 2));
process.exitCode = result.status === 'PASS' ? 0 : 2;
