// Why does an inspection page sometimes not "start" within 15 seconds? Loads pages from one or more checkouts, in turn, on one machine.
// Two independent observers run on every load:
//   playwright: the same page.waitForFunction the suites use, with its default polling and 15 second limit.
//   direct:     page.evaluate every 100 ms, which needs no animation frame.
// If direct sees the hook and playwright times out, the page started and the waiting is what stalled.
// It records every load, measures only, and exits 0 unless it crashes. Paths only: no invite or token is printed.
// Usage: node test/page-start-probe.mjs --roots <checkoutA>,<checkoutB> --rounds 10 --loads 12 --channels chrome,msedge [--label x]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = path.resolve(import.meta.dirname, '../../..');
const roots = option('roots', here).split(',').map(root => path.resolve(root));
const ROUNDS = Number(option('rounds', 2)), LOADS = Number(option('loads', 12)), channels = option('channels', 'chrome').split(','), LIMIT_MS = 15000;
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const say = (tag, value) => console.log(`${tag} ${JSON.stringify(value)}`);

const INIT = `(() => {
  window.__startProbe = { longTasks: 0, longest: 0, errors: [] };
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__startProbe.longTasks++; window.__startProbe.longest = Math.max(window.__startProbe.longest, Math.round(e.duration)); } }).observe({ entryTypes: ['longtask'] }); } catch {}
  addEventListener('error', e => window.__startProbe.errors.push(String(e.message ?? e.type)));
  addEventListener('unhandledrejection', e => window.__startProbe.errors.push(String(e.reason?.message ?? e.reason)));
})();`;
const PAGE_STATE = async () => {
  const frame = await Promise.race([new Promise(resolve => requestAnimationFrame(() => resolve('fired'))), new Promise(resolve => setTimeout(() => resolve('no-frame-in-2s'), 2000))]);
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  return {
    hook: Boolean(window.__selfInspection || window.__checklistInspection), frame, hidden: document.hidden, visibility: document.visibilityState, ready: document.readyState,
    body: { step: document.body?.dataset.step, bodyReady: document.body?.dataset.ready, checklist: document.body?.dataset.checklist, flow: document.body?.dataset.flow },
    nav: nav && { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) },
    resources: resources.length, slowest: resources.sort((a, b) => b.duration - a.duration).slice(0, 3).map(r => [new URL(r.name).pathname.split('/').pop(), Math.round(r.duration)]),
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, probe: window.__startProbe,
  };
};
// TCP sockets by state, Windows only. WSAENOBUFS is about sockets, so this is the resource to watch.
const tcpStates = () => {
  if (process.platform !== 'win32') return null;
  try {
    const counts = {};
    for (const line of execFileSync('netstat', ['-an', '-p', 'tcp'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')) { const state = line.trim().split(/\s+/)[3]; if (/^[A-Z_0-9]+$/.test(state ?? '')) counts[state] = (counts[state] ?? 0) + 1; }
    return counts;
  } catch { return 'netstat failed'; }
};
const percentile = (values, p) => (values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null);

const stats = new Map();
const bucket = key => { if (!stats.has(key)) stats.set(key, { loads: 0, hookMs: [], playwrightTimeouts: 0, neverStarted: 0, gotoFailed: 0, withPageErrors: 0, recovered: 0 }); return stats.get(key); };

for (let round = 0; round < ROUNDS; round++) {
  // Each round takes the checkouts in the other order, so neither always runs first.
  for (const root of round % 2 ? [...roots].reverse() : roots) {
    const require = createRequire(path.join(root, 'tools/mobile-ar-poc/package.json'));
    const { chromium } = require('playwright');
    const { startMobileDevServer } = await load(root, 'tools/inspection-sync-poc/src/mobile-dev-server.mjs');
    const { LocalTestSessionCreationAuthorizer } = await load(root, 'tools/inspection-sync-poc/src/creation-authorizer.mjs');
    const { ReceiverClient } = await load(root, 'tools/inspection-sync-poc/bin/receiver.mjs');
    const label = path.basename(root);
    let now = Date.now(), lag = 0, last = Date.now();
    const ticker = setInterval(() => { const t = Date.now(); lag = Math.max(lag, t - last - 50); last = t; }, 50);
    const server = await startMobileDevServer({ now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });
    for (const channel of channels) {
      const browser = await chromium.launch({ channel, headless: true, args: channel === 'chrome' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [] });
      for (let index = 0; index < LOADS; index++) {
        const scenario = ['qr-washer', 'qr-tire', 'direct-washer', 'direct'][index % 4];
        now += 61_000;
        const stat = bucket(`${label}|${channel}`), first = bucket(`${label}|${channel}|first-page-of-browser`);
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await context.addInitScript(INIT);
        const page = await context.newPage();
        const pending = new Set(), failed = [], bad = [], problems = [];
        const where = value => new URL(value).pathname;
        let requested = 0;
        const paths = new Set();
        page.on('request', request => { requested++; paths.add(where(request.url())); pending.add(where(request.url())); });
        page.on('requestfinished', request => pending.delete(where(request.url())));
        page.on('requestfailed', request => { pending.delete(where(request.url())); failed.push(`${where(request.url())} ${request.failure()?.errorText}`); });
        page.on('response', response => { if (response.status() >= 400) bad.push(`${where(response.url())} ${response.status()}`); });
        page.on('pageerror', error => problems.push(error.message.slice(0, 200)));
        page.on('console', message => { if (message.type() === 'error') problems.push(message.text().slice(0, 200)); });
        let fragment = scenario === 'direct-washer' ? '#v=1&task=washer-fluid' : '';
        if (scenario.startsWith('qr')) fragment = (await new ReceiverClient({ baseUrl: server.url }).create(scenario === 'qr-tire' ? 'tire.front-left' : 'washer-fluid')).fragment;
        const started = Date.now();
        let gotoMs = null, hookMs = null, playwright = 'ok', playwrightMs = null;
        try {
          await page.goto(`${server.url}/${fragment}`, { timeout: 30000 });
          gotoMs = Date.now() - started;
          const watching = (async () => { for (;;) { const seen = await page.evaluate(() => Boolean(window.__selfInspection || window.__checklistInspection)).catch(() => null); if (seen) { hookMs = Date.now() - started; return; } if (Date.now() - started > LIMIT_MS + 5000) return; await new Promise(resolve => setTimeout(resolve, 100)); } })();
          await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection, null, { timeout: LIMIT_MS }).then(() => { playwrightMs = Date.now() - started; }, () => { playwright = 'timeout'; });
          await watching;
        } catch (error) { playwright = `goto:${error.name}`; bucket(`${label}|${channel}`).gotoFailed++; }
        for (const s of index === 0 ? [stat, first] : [stat]) {
          s.loads++;
          if (hookMs !== null) s.hookMs.push(hookMs);
          if (playwright === 'timeout') s.playwrightTimeouts++;
          if (hookMs === null) s.neverStarted++;
          if (problems.length) s.withPageErrors++;
          if (failed.length && hookMs !== null) s.recovered++;
        }
        if (playwright !== 'ok' || hookMs === null || hookMs > 5000 || failed.length) {
          const state = await page.evaluate(PAGE_STATE).catch(error => error.name);
          say('PROBE_SLOW', { root: label, channel, round, index, scenario, playwright, playwrightMs, gotoMs, hookMs, totalMs: Date.now() - started, state, pending: [...pending], failed, bad, problems, requested, tcp: tcpStates(), serverLoopLagMs: lag, freeMemMb: Math.round(os.freemem() / 1048576), rssMb: Math.round(process.memoryUsage().rss / 1048576) });
        }
        if (round === 0 && index === 0) say('PROBE_FILES', { root: label, scenario, requested, detectionFiles: [...paths].filter(name => name.includes('part-detection')), files: [...paths].sort() });
        await context.close();
      }
      await browser.close();
    }
    clearInterval(ticker);
    await server.stop();
    say('PROBE_NET', { root: label, round, elapsedS: Math.round(process.uptime()), tcp: tcpStates() });
  }
}
for (const [key, s] of [...stats].sort()) say('PROBE_SUMMARY', { key, loads: s.loads, playwrightTimeouts: s.playwrightTimeouts, neverStarted: s.neverStarted, gotoFailed: s.gotoFailed, withPageErrors: s.withPageErrors, recovered: s.recovered, hookMsP50: percentile(s.hookMs, 0.5), hookMsP99: percentile(s.hookMs, 0.99), hookMsMax: s.hookMs.length ? Math.max(...s.hookMs) : null });
process.exit(0);
