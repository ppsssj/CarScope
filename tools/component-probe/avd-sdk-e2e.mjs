// Pleos Virtual Console -> Vehicle SDK -> CarScope E2E on the Pleos AVD. Read-only unless approved.
//
//   node tools/component-probe/avd-sdk-e2e.mjs --out=C:/CarScope-External/pleos-avd-e2e/run-1
//     [--approve-ui-navigation]   drive the app: Inspection page flow events, MainActivity PLEOS/MOCK buttons, Back
//     [--approve-console-writes]  change reversible console properties and set each one back (never the odometer)
//     [--park]                    with writes: Park for readable screenshots, gear set back at the end
//     [--items=soc,wiper-front]   subset; default all
//     [--adb=...] [--serial=emulator-5554] [--console=http://127.0.0.1:8088]
//
// Read-only mode: console GET, app log (CarScope* tags only, no logcat -c), the visible Inspection page's stores. No tap,
// no flow event, no console write, no heartbeat. Evidence goes to an external --out; an existing results.json is kept.
// Exit 0 when nothing failed and the console ended as it started, 2 otherwise.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ITEMS, VERDICT, get, writePlan, stateDiff, layerVerdict, combine, cardShows, storeShows, lastStatusFromLog } from './avd-sdk-e2e-plan.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, v] = s.replace(/^--/, '').split(/=(.*)/s); return [k, v ?? true]; }));
const out = resolve(String(args.out ?? '')), rel = relative(resolve(import.meta.dirname, '../..'), out);
if (!args.out || !(rel.startsWith('..' + sep) || isAbsolute(rel))) throw Error('An --out outside the repository is required');
if (existsSync(resolve(out, 'results.json'))) throw Error('Existing evidence preserved: choose a new --out');
const ADB = args.adb ?? 'C:\\Android\\Sdk\\platform-tools\\adb.exe', SERIAL = args.serial ?? 'emulator-5554';
const CONSOLE = new URL(args.console ?? 'http://127.0.0.1:8088');
if (!['127.0.0.1', 'localhost'].includes(CONSOLE.hostname)) throw Error('The console must be on loopback (adb forward)');
const approveWrites = args['approve-console-writes'] === true, approveUi = args['approve-ui-navigation'] === true, park = args.park === true;
if (park && !approveWrites) throw Error('--park needs --approve-console-writes');
const items = args.items ? ITEMS.filter((i) => String(args.items).split(',').includes(i.id)) : ITEMS;
mkdirSync(resolve(out, 'shots'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...cmd) => execFileSync(ADB, ['-s', SERIAL, ...cmd], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 << 20 });
const deviceNow = () => adb('shell', 'date +%m-%d\\ %H:%M:%S.000').trim();
const TAGS = ['CarScopeComponent:I', 'CarScopeTire:I', 'CarScopeDoor:I', 'AndroidRuntime:E'];
const appLog = (since) => adb('logcat', '-d', '-v', 'threadtime', ...(since ? ['-T', since] : []), '-s', ...TAGS).split(/\r?\n/).filter((l) => l && !l.startsWith('-----'));
async function until(probe, ms = 10_000, every = 600) { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await probe(); if (last?.ok) return last; await sleep(every); } return last ?? { ok: false }; }
const waitLog = (since, text, ms) => until(async () => { const hit = appLog(since).filter((l) => (text instanceof RegExp ? text.test(l) : l.includes(text))); return { ok: hit.length > 0, hit: hit.slice(0, 2) }; }, ms);
function shot(name) {
  adb('shell', 'screencap', '-p', '/data/local/tmp/carscope-sdk-e2e.png');
  execFileSync(ADB, ['-s', SERIAL, 'pull', '/data/local/tmp/carscope-sdk-e2e.png', resolve(out, 'shots', name)], { encoding: 'utf8' });
  adb('shell', 'rm', '/data/local/tmp/carscope-sdk-e2e.png');
  return `shots/${name}`;
}
const topActivity = () => (adb('shell', 'dumpsys activity activities | grep topResumedActivity').split('\n')[0].match(/io\.carscope\.app\/(\S+)/)?.[1]) ?? 'OTHER';

// Virtual Console. Writes need the browser-session heartbeat the console's own page sends every second.
const consoleUrl = (p) => new URL(p, CONSOLE);
const consoleState = async () => (await fetch(consoleUrl('/vehicle/state'), { cache: 'no-store', signal: AbortSignal.timeout(10_000) })).json();
async function consolePut(endpoint, params) {
  if (!approveWrites) throw Error('WRITE_NOT_APPROVED');
  const r = await fetch(consoleUrl(`${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`), { method: 'PUT', signal: AbortSignal.timeout(10_000) });
  return { status: r.status, error: r.ok ? null : (await r.text()).slice(0, 200) };
}
// The heartbeat runs on its own thread: adb calls here are synchronous (uiautomator takes seconds) and would starve a timer.
const client = 'carscope-sdk-e2e-' + randomUUID().slice(0, 8); let beat = null;
const beatUrl = consoleUrl(`/browser/session?client=${client}`).href;
const heartbeat = (closing = false) => fetch(beatUrl + (closing ? '&closing=1' : ''), { method: 'POST', cache: 'no-store' }).catch(() => {});
const startHeartbeat = () => new Worker(`const u=${JSON.stringify(beatUrl)};const b=()=>fetch(u,{method:'POST',cache:'no-store'}).catch(()=>{});b();setInterval(b,1000);`, { eval: true });

// Native door screen through uiautomator (text and bounds only).
function uiNodes() {
  // uiautomator dump fails now and then ("could not get idle state"): retry before giving up.
  for (let attempt = 1; ; attempt++) { try { adb('shell', 'uiautomator', 'dump', '/data/local/tmp/carscope-sdk-e2e.xml'); break; } catch (e) { if (attempt >= 4) throw e; execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']); } }
  const xml = adb('shell', 'cat', '/data/local/tmp/carscope-sdk-e2e.xml'); adb('shell', 'rm', '/data/local/tmp/carscope-sdk-e2e.xml');
  return [...xml.matchAll(/text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((m) => ({ text: m[1].replace(/&#10;/g, '\n').replace(/&amp;/g, '&'), x: (+m[2] + +m[4]) >> 1, y: (+m[3] + +m[5]) >> 1 }));
}
function tapText(text) { const n = uiNodes().find((x) => x.text === text); if (!n) throw Error('UI_CONTROL_MISSING ' + text); adb('shell', 'input', 'tap', String(n.x), String(n.y)); }
const nativeText = () => uiNodes().map((n) => n.text).join('\n');
// MainActivity's door diagram WebView, read at once over DevTools (uiautomator takes longer than the 5 s STALE window).
async function evalOnce(ws, expression) {
  const socket = new WebSocket(ws); await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  try {
    return await new Promise((ok, fail) => { const t = setTimeout(() => fail(Error('CDP_TIMEOUT')), 10_000);
      socket.onmessage = ({ data }) => { const p = JSON.parse(data); if (p.id === 1) { clearTimeout(t); ok(p.result?.result?.value ?? null); } };
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  } finally { socket.close(); }
}
async function doorDiagram() {
  if (!forwardPort) { const pid = adb('shell', 'pidof', 'io.carscope.app').trim(); forwardPort = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).trim(); }
  const pages = await (await fetch(`http://127.0.0.1:${forwardPort}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const page = pages.find((p) => !p.url.startsWith('https://carscope-inspection.invalid/') && /^CarScope /.test(p.title) && JSON.parse(p.description || '{}').visible);
  if (!page) return '';
  return (await evalOnce(page.webSocketDebuggerUrl, `document.title+'\\n'+[...document.querySelectorAll('[aria-label],title,desc')].map(e=>e.getAttribute('aria-label')??e.textContent).join('\\n')`)) ?? '';
}

// Inspection WebView over the debuggable app's DevTools socket, loopback only.
let forwardPort = null, cdp = null;
async function inspectionPage() {
  const pid = adb('shell', 'pidof', 'io.carscope.app').trim(); if (!/^\d+$/.test(pid)) throw Error('APP_NOT_RUNNING');
  if (forwardPort) adb('forward', '--remove', `tcp:${forwardPort}`);
  forwardPort = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).trim();
  const found = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${forwardPort}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const page = pages.find((p) => p.url.startsWith('https://carscope-inspection.invalid/') && JSON.parse(p.description || '{}').visible);
    return { ok: Boolean(page), page };
  });
  if (!found.ok) throw Error('NO_VISIBLE_INSPECTION_PAGE');
  cdp?.close();
  const socket = new WebSocket(found.page.webSocketDebuggerUrl); await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const p = JSON.parse(data); if (p.id) { pending.get(p.id)?.(p); pending.delete(p.id); } };
  cdp = { close: () => socket.close(), eval: (expression) => new Promise((ok, fail) => {
    const key = ++id; const timer = setTimeout(() => { pending.delete(key); fail(Error('CDP_TIMEOUT')); }, 15_000);
    pending.set(key, (p) => { clearTimeout(timer); p.error || p.result.exceptionDetails ? fail(Error(JSON.stringify(p.error ?? p.result.exceptionDetails).slice(0, 300))) : ok(p.result.result.value); });
    socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  }) };
  await until(async () => ({ ok: await cdp.eval('window.__inspectReady===true') }), 30_000);
}
const stores = () => cdp.eval(`(()=>{const i=window.__inspect;return {state:i.state.name,componentStatus:i.componentStatus(),chargePortStatus:i.chargePortStatus(),visibilityStatus:i.visibilityStatus()}})()`);
const reading = (s, item) => s[item.store]?.readings?.find((r) => r.featureId === item.feature) ?? null;
async function dispatch(event) { await cdp.eval(`window.__inspect.dispatch(${JSON.stringify(event)})`); await until(async () => ({ ok: !(await cdp.eval('window.__inspect.busy')) }), 15_000, 300); await sleep(500); }
async function openScreen(item) {
  if (!approveUi) throw Error('UI_NOT_APPROVED');
  await dispatch({ type: 'EXIT' }); await dispatch({ type: 'START' });
  if (item.screen === 'summary') await dispatch({ type: 'SHOW_SUMMARY' });
  else if (item.screen === 'result') await dispatch({ type: 'OPEN_RESULT', id: item.part }); // the part's result screen holds its card
  else await dispatch({ type: 'SELECT_AREA', id: item.screen });
  if (!(await cdp.eval('document.querySelector("#vehicleStatusCard, #odometerCard")!==null'))) throw Error('CARD_REGION_MISSING ' + item.screen);
}
const cardRow = (item) => cdp.eval(`(()=>{const li=document.querySelector('li[data-sdk-feature=${JSON.stringify(item.feature)}]');if(!li)return null;
  const dev=li.closest('section')?.querySelector('details.dev-info');return {state:li.dataset.sdkState,text:li.textContent.replace(/\\s+/g,' ').trim(),dev:dev?dev.textContent.replace(/\\s+/g,' ').trim():null}})()`);
async function ensureInspection() {
  if (topActivity() === '.MainActivity') { adb('shell', 'input', 'keyevent', '4'); await sleep(3000); }
  if (topActivity() !== '.lab.InspectionActivity') throw Error('INSPECTION_NOT_ON_TOP');
  await inspectionPage();
}
async function restartSession() { adb('shell', 'am', 'start', '-n', 'io.carscope.app/.MainActivity'); await sleep(4000); adb('shell', 'input', 'keyevent', '4'); await sleep(3000); await ensureInspection(); }

const results = { tool: 'avd-sdk-e2e', startedAt: new Date().toISOString(), serial: SERIAL, approvals: { approveWrites, approveUi, park }, preflight: {}, readOnly: {}, items: [], restore: {}, final: null };
const save = () => writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
let exit = 0;
const before = await consoleState();
writeFileSync(resolve(out, 'console-before.json'), JSON.stringify(before, null, 2));
const initialTop = topActivity(), startMarker = deviceNow();
let initialFlow = null;
try {
  results.preflight = { device: adb('get-state').trim(), app: adb('shell', 'pm', 'path', 'io.carscope.app').includes('package:'), top: initialTop, gear: get(before, 'gear.actual.value') };
  // Read-only: app log status per feature (last lines in the existing buffer) and the visible page's stores, if any.
  results.readOnly.appLog = lastStatusFromLog(appLog());
  if (!Object.keys(results.readOnly.appLog).length) results.readOnly.appLogNote = 'NO_RECENT_LINES: the small log ring buffer has rotated; not a failure';
  if (initialTop === '.lab.InspectionActivity') { await inspectionPage(); results.readOnly.stores = await stores(); }
  else results.readOnly.stores = 'NOT_RUN: Inspection page not on top (navigation needs --approve-ui-navigation)';
  save();

  const plan = writePlan(items, before, { approveWrites, approveUi });
  if (approveWrites) { beat = startHeartbeat(); await sleep(1500); }
  if (park && get(before, 'gear.actual.value') !== 'Park') { results.restore.gearChanged = await consolePut('/vehicle/gear', { gear: 'Park' }); await sleep(2000); }
  if (approveUi) { await ensureInspection(); initialFlow = (await stores()).state; }

  for (const p of plan.filter((x) => x.item.screen !== 'main')) {
    const { item } = p; const r = { id: item.id, feature: item.feature, consolePath: item.consolePath, initial: p.initial, write: p.write, reason: p.reason ?? null, phases: [] };
    results.items.push(r);
    try {
      if (approveUi) {
        await openScreen(item);
        const s = await stores(), row = await cardRow(item), raw = item.sdk(p.initial);
        const store = item.store ? storeShows(reading(s, item), raw) : { observed: false, source: null };
        const card = item.id === 'odometer' ? { observed: Boolean(row?.dev?.includes(`SDK 원시 Float${raw.replace(/\.0$/, '')}`)) && /출처 차량 SDK/.test(row.text), source: /출처 차량 SDK/.test(row?.text ?? '') ? 'PLEOS' : null } : cardShows(row, item.words?.(p.initial));
        // A read-only item is still checked against the SDK when it reports on its own (the odometer does, every few seconds).
        const sdk0 = p.write ? null : await waitLog(startMarker, item.log(raw), 8_000);
        r.phases.push({ phase: 'initial', console: p.initial, expectedRaw: raw, ...(sdk0 ? { sdkLines: sdk0.hit ?? [], sdkVerdict: layerVerdict({ ran: true, observed: sdk0.ok }) } : {}), store: item.store ? { ...store, reading: reading(s, item) } : 'NO_STORE', card: { ...card, row }, shot: shot(`${item.id}-initial.png`),
          storeVerdict: item.store ? layerVerdict({ ran: true, ...store }) : VERDICT.NOT_RUN, cardVerdict: layerVerdict({ ran: true, ...card }) });
      }
      if (!p.write) continue;
      for (const [phase, value] of [['change', p.test], ['restore', p.initial]]) {
        const since = deviceNow(), w = await consolePut(item.write.endpoint, item.write.params(value)), now = get(await consoleState(), item.consolePath);
        if (item.sessionRestart) { await restartSession(); if (approveUi) await openScreen(item); }
        const raw = item.sdk(value), sdk = await waitLog(since, item.log(raw), 12_000);
        const ph = { phase, sent: value, http: w.status, httpError: w.error, consoleAfter: now, expectedRaw: raw, sdkLines: sdk.hit ?? [], sdkVerdict: layerVerdict({ ran: w.status === 200, observed: sdk.ok }) };
        if (approveUi) {
          const st = item.store ? await until(async () => storeShows(reading(await stores(), item), raw).observed ? { ok: true } : { ok: false }) : null;
          const cd = await until(async () => { const row = await cardRow(item); const c = cardShows(row, item.words?.(value)); return { ok: c.observed, ...c, row }; });
          const s = await stores();
          Object.assign(ph, { store: item.store ? { ...storeShows(reading(s, item), raw), reading: reading(s, item) } : 'NO_STORE', storeVerdict: item.store ? layerVerdict({ ran: true, observed: st.ok, source: reading(s, item)?.source }) : VERDICT.NOT_RUN,
            card: { observed: cd.ok, source: cd.source, row: cd.row }, cardVerdict: layerVerdict({ ran: true, observed: cd.ok, source: cd.source }), shot: shot(`${item.id}-${phase}.png`) });
        }
        r.phases.push(ph);
        if (w.status !== 200) break;
      }
    } catch (e) { r.error = String(e.message).slice(0, 300); }
    finally { if (p.write && get(await consoleState(), item.consolePath) !== p.initial) r.restoreAttempt = await consolePut(item.write.endpoint, item.write.params(p.initial)).catch((e) => ({ error: e.message })); }
    save();
  }
  if (approveUi && initialFlow === 'IDLE') await dispatch({ type: 'EXIT' });

  // Door: MainActivity's native SDK read path. PLEOS mode only for the test; the previous mode is selected again.
  for (const p of plan.filter((x) => x.item.screen === 'main')) {
    const { item } = p; const r = { id: item.id, feature: item.feature, consolePath: item.consolePath, initial: p.initial, write: p.write, reason: p.reason ?? null, phases: [] };
    results.items.push(r);
    if (!approveUi) { r.reason = r.reason ?? 'NEEDS_UI_APPROVAL'; continue; }
    adb('shell', 'am', 'start', '-n', 'io.carscope.app/.MainActivity'); await sleep(3000);
    let initialMode = 'UNKNOWN';
    try {
      initialMode = /데이터 출처: PLEOS/.test(nativeText()) ? 'PLEOS' : 'MOCK'; r.initialMode = initialMode;
      const since = deviceNow();
      if (initialMode !== 'PLEOS') tapText('PLEOS 읽기 모드');
      const init = await waitLog(since, new RegExp(`ROW_1_LEFT · (event|current) raw=${item.sdk(p.initial)}`), 12_000);
      const text = nativeText();
      r.phases.push({ phase: 'initial', sdkLines: init.hit ?? [], native: text.split('\n').filter((l) => /데이터 출처|FRONT_LEFT/.test(l)), cardVerdict: layerVerdict({ ran: true, observed: text.includes(item.nativeWords(p.initial)), source: /데이터 출처: PLEOS/.test(text) ? 'PLEOS' : 'MOCK' }), shot: shot('door-initial.png') });
      if (p.write) for (const [phase, value] of [['change', p.test], ['restore', p.initial]]) {
        const s2 = deviceNow(), w = await consolePut(item.write.endpoint, item.write.params(value));
        // The diagram first (within the 5 s STALE window), then the log, which stays in the buffer.
        const nat = await until(async () => { const t = await doorDiagram(); return { ok: t.includes(item.nativeWords(value)) && /PLEOS/.test(t), t }; }, 5_000, 250);
        const view = shot(`door-${phase}.png`);
        const sdk = await waitLog(s2, item.log(item.sdk(value)), 12_000);
        r.phases.push({ phase, sent: value, http: w.status, httpError: w.error, sdkLines: sdk.hit ?? [], sdkVerdict: layerVerdict({ ran: w.status === 200, observed: sdk.ok }),
          native: (nat.t ?? '').split('\n').filter((l) => /PLEOS|MOCK|FRONT_LEFT/.test(l)), cardVerdict: layerVerdict({ ran: w.status === 200, observed: nat.ok, source: /PLEOS/.test(nat.t ?? '') ? 'PLEOS' : 'MOCK' }), shot: view });
        if (w.status !== 200) break;
      }
    } catch (e) { r.error = String(e.message).slice(0, 300); }
    finally {
      if (p.write && get(await consoleState(), item.consolePath) !== p.initial) r.restoreAttempt = await consolePut(item.write.endpoint, item.write.params(p.initial));
      try { if (initialMode === 'MOCK') { tapText('MOCK 모드'); await sleep(2000); r.modeRestored = /데이터 출처: MOCK/.test(nativeText()); } }
      catch (e) { r.modeRestored = false; r.cleanupError = String(e.message).slice(0, 200); }
      adb('shell', 'input', 'keyevent', '4'); await sleep(3000);
    }
    save();
  }
} catch (e) { results.error = String(e.message).slice(0, 300); exit = 2; }
finally {
  if (results.restore.gearChanged) results.restore.gear = await consolePut('/vehicle/gear', { gear: get(before, 'gear.actual.value') }).catch((e) => ({ error: e.message }));
  if (beat) { await beat.terminate(); await heartbeat(true); }
  if (approveUi && initialTop === '.MainActivity' && topActivity() !== '.MainActivity') { adb('shell', 'am', 'start', '-n', 'io.carscope.app/.MainActivity'); await sleep(2500); }
  results.restore.top = { initial: initialTop, final: topActivity() };
  cdp?.close(); if (forwardPort) adb('forward', '--remove', `tcp:${forwardPort}`);
  const after = await consoleState();
  writeFileSync(resolve(out, 'console-after.json'), JSON.stringify(after, null, 2));
  results.restore.console = stateDiff(before, after, [...new Set([...items.map((i) => i.consolePath), 'gear.actual.value'])]);
  for (const r of results.items) {
    r.verdict = { sdk: combine(r.phases.map((x) => x.sdkVerdict ?? VERDICT.NOT_RUN)), store: combine(r.phases.map((x) => x.storeVerdict ?? VERDICT.NOT_RUN)), card: combine(r.phases.map((x) => x.cardVerdict ?? VERDICT.NOT_RUN)) };
    if (r.error || Object.values(r.verdict).some((v) => [VERDICT.FAIL, VERDICT.NOT_PLEOS, VERDICT.BLOCKED].includes(v))) exit = 2;
  }
  if (results.restore.console.some((d) => !d.same) || results.restore.top.initial !== results.restore.top.final) exit = 2;
  results.final = exit === 0 ? 'OK' : 'ATTENTION';
  results.finishedAt = new Date().toISOString(); save();
  const lines = results.items.map((r) => `${r.id.padEnd(16)} sdk=${r.verdict.sdk.padEnd(9)} store=${r.verdict.store.padEnd(9)} card=${r.verdict.card.padEnd(9)} ${r.write ? 'written+restored' : 'read-only: ' + (r.reason ?? '')}${r.error ? ' ERROR ' + r.error : ''}`);
  const diff = results.restore.console.map((d) => `${d.same ? 'SAME     ' : 'DIFFERENT'} ${d.path} ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`);
  const text = ['CarScope Pleos SDK AVD E2E', ...lines, '', 'Console before/after:', ...diff, `Top activity: ${results.restore.top.initial} -> ${results.restore.top.final}`, `Final: ${results.final}`].join('\n');
  writeFileSync(resolve(out, 'summary.txt'), text + '\n'); console.log(text);
}
process.exit(exit);
