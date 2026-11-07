// No database. What turns the WebXR guide on for the Render path, and what must not. The real entrypoints with PostgreSQL
// and a browser are in tools/mobile-ar-poc/test/webxr-render-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ALLOWED_ENV, avdHistoryDemoGate, environmentGate, TOOL_ROOT, webxrExperimentGate, WEBXR_EXPERIMENT_ENTRY } from '../preflight/static-gates.mjs';
import { probeDeployment } from '../preflight/probe.mjs';
import { manualRenderGates } from '../preflight/render-gates.mjs';
import { MOBILE_HEADERS, serveMobilePage } from '../src/mobile-page.mjs';

function runtimeCopy(t) {
  const root = mkdtempSync(join(tmpdir(), 'carscope-webxr-gate-')), tool = join(root, 'tools/inspection-sync-poc');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(tool, { recursive: true });
  for (const dir of ['src', 'bin']) cpSync(join(TOOL_ROOT, dir), join(tool, dir), { recursive: true });
  cpSync(resolve(TOOL_ROOT, '../mobile-ar-poc'), join(root, 'tools/mobile-ar-poc'), { recursive: true, filter: (from) => !/[\\/]node_modules([\\/]|$)/.test(from) });
  return tool;
}
const edit = (tool, file, from, to) => {
  const path = join(tool, file), source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  assert.ok(source.includes(from), from);
  writeFileSync(path, source.replace(from, to));
};
function run(entry, env, cwd) {
  const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return new Promise((done) => {
    const child = spawn(process.execPath, [entry], { cwd, env: { ...platform, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', (x) => (output += x));
    child.once('close', (code) => done({ code, output: output.trim() }));
  });
}
const CLI = '      enableAvdSimulation,\n    });\n    console.log(enableAvdSimulation';

test('this tree passes the gate, and no environment variable was added for it', () => {
  assert.equal(webxrExperimentGate().status, 'PASS');
  assert.equal(environmentGate().status, 'PASS');
  assert.equal(avdHistoryDemoGate().status, 'PASS', 'the experiment entrypoint does not open the history demonstration');
  assert.ok(!ALLOWED_ENV.some((name) => /WEBXR|XR_|GUIDE/.test(name)));
});

test('the gate catches every shortcut around the Start Command', (t) => {
  const failing = (mutate, pattern) => {
    const tool = runtimeCopy(t);
    mutate(tool);
    const gate = webxrExperimentGate(tool);
    assert.equal(gate.status, 'FAIL');
    assert.match(gate.detail, pattern);
  };
  const STATEFUL = 'src/render-stateful.mjs';
  failing((x) => edit(x, STATEFUL, CLI, CLI.replace('enableAvdSimulation,\n', 'enableAvdSimulation, webxrGuide: true,\n')), /default CLI passes/);
  failing((x) => edit(x, STATEFUL, 'webxrGuide = false', 'webxrGuide = true'), /not off by default/);
  failing((x) => appendFileSync(join(x, 'src/render-preflight.mjs'), '\nexport const on = { webxrGuide: true };\n'), /render-preflight\.mjs knows/);
  failing((x) => appendFileSync(join(x, 'bin/avd-simulator-admin.mjs'), '\nexport const on = { webxrGuide: true };\n'), /avd-simulator-admin\.mjs passes/);
  failing((x) => edit(x, STATEFUL, "import http from 'node:http';", "import http from 'node:http';\nimport '../../mobile-ar-poc/webxr-flag.mjs';"), /variable switch is inside/);
  failing((x) => edit(x, STATEFUL, "import http from 'node:http';", "import http from 'node:http';\nimport './mobile-dev-server.mjs';"), /development host/);
  failing((x) => edit(x, STATEFUL, "import http from 'node:http';", "import http from 'node:http';\nimport './render-webxr-experiment.mjs';"), /default CLI imports/);
  failing((x) => appendFileSync(join(x, WEBXR_EXPERIMENT_ENTRY), '\nexport const on = process.env.CARSCOPE_ANY === "1";\n'), /reads the environment/);
  failing((x) => edit(x, WEBXR_EXPERIMENT_ENTRY, 'webxrGuide: true,', 'webxrGuide: true, enableAvdHistoryRead: enableAvdSimulation,'), /opens a history path/);
  failing((x) => edit(x, WEBXR_EXPERIMENT_ENTRY, 'await assertWebXrGuideFiles();', ''), /does not check its files/);
  failing((x) => { writeFileSync(join(x, 'src/extra.mjs'), 'export const x = 1;\n'); edit(x, WEBXR_EXPERIMENT_ENTRY, "import { fileURLToPath } from 'node:url';", "import { fileURLToPath } from 'node:url';\nimport './extra.mjs';"); }, /adds src\/extra\.mjs/);
  failing((x) => rmSync(join(x, WEBXR_EXPERIMENT_ENTRY)), /missing/);
});

test('an environment switch stays refused by the existing gate', (t) => {
  const tool = runtimeCopy(t);
  edit(tool, 'src/render-stateful.mjs', CLI, CLI.replace('enableAvdSimulation,\n', "enableAvdSimulation, webxrGuide: process.env.CARSCOPE_WEBXR_GUIDE === 'EXPERIMENT',\n"));
  const gate = environmentGate(tool);
  assert.equal(gate.status, 'FAIL');
  assert.match(gate.detail, /CARSCOPE_WEBXR_GUIDE/);
  assert.equal(webxrExperimentGate(tool).status, 'FAIL');
});

test('the entrypoint refuses to start without its files, before any database contact, with one fixed line', async (t) => {
  const tool = runtimeCopy(t); // No node_modules here, so three.js is missing as on a Render build that did not install it.
  const secret = 'not-a-real-password-' + Date.now();
  const r = await run(join(tool, WEBXR_EXPERIMENT_ENTRY), { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://webxr-gate.example', PORT: '1', DATABASE_URL: `postgresql://x:${secret}@127.0.0.1:1/x` }, tool);
  assert.deepEqual(r, { code: 1, output: 'WEBXR_GUIDE_ASSET_MISSING' });
});

test('the entrypoint refuses an unsafe configuration like the default command', async () => {
  const entry = join(TOOL_ROOT, WEBXR_EXPERIMENT_ENTRY);
  const valid = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://webxr-gate.example', PORT: '1', DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/x' };
  for (const [name, env] of Object.entries({
    NOT_RENDER: { ...valid, RENDER: undefined },
    TLS_VERIFY_DISABLED: { ...valid, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    TEST_AUTH: { ...valid, SYNC_LOCAL_TEST_AUTH: '1' },
    AVD_MODE_NOT_EXACT: { ...valid, CARSCOPE_AVD_SIMULATOR_MODE: 'ENABLED' },
  })) {
    assert.deepEqual(await run(entry, Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)), TOOL_ROOT), { code: 1, output: 'RENDER_STATEFUL_CONFIGURATION_FAILED' }, name);
  }
});

test('with the guide off, the shared page code adds no permission, no mark and no file on the secure path', async () => {
  const served = async (url, options) => new Promise((done) => {
    const res = { writeHead: (status, headers) => { res.status = status; res.headers = headers; }, end: (body) => done({ ...res, body: body ?? '' }) };
    void serveMobilePage({ method: 'GET', url }, res, options);
  });
  const off = await served('/', { tls: true });
  assert.equal(off.headers['Permissions-Policy'], MOBILE_HEADERS['Permissions-Policy']);
  assert.ok(!String(off.body).includes('data-webxr-guide'));
  assert.equal((await served('/mobile-ar-poc/public/webxr/webxr-guide.mjs', { tls: true })).status, 404);
  const on = await served('/', { tls: true, webxrGuide: true });
  assert.equal(on.headers['Permissions-Policy'], MOBILE_HEADERS['Permissions-Policy'] + ', xr-spatial-tracking=(self)');
  assert.equal(on.headers['Content-Security-Policy'], MOBILE_HEADERS['Content-Security-Policy'], 'the CSP is the same in both modes');
  assert.match(String(on.body), /data-webxr-guide="enabled"/);
});

test('preflight makes the running experiment visible and says nothing without it', async () => {
  const probe = async (health) => probeDeployment({ origin: 'https://carscope.test', request: async () => ({ status: 200, headers: {}, body: JSON.stringify(health) }) });
  const denied = { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' };
  assert.equal((await probe(denied)).some((x) => x.id === 'RENDER_WEBXR_GUIDE'), false);
  assert.equal((await probe({ ...denied, mobileGuide: 'WEBXR_EXPERIMENT' })).find((x) => x.id === 'RENDER_WEBXR_GUIDE').status, 'MANUAL');
  assert.equal((await probe({ ...denied, mobileGuide: true })).find((x) => x.id === 'RENDER_WEBXR_GUIDE').status, 'FAIL');
  assert.match(manualRenderGates().find((x) => x.id === 'RENDER_START_COMMAND').detail, /render-webxr-experiment\.mjs/);
});
