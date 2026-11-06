// No database. What opens the Debug AVD read path, and what must not. Real entrypoints are in the PostgreSQL suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { avdHistoryDemoGate, avdHistoryDemoRefusalGate, ALLOWED_ENV, environmentGate, AVD_HISTORY_DEMO_ENTRY, TOOL_ROOT } from '../preflight/static-gates.mjs';
import { probeDeployment } from '../preflight/probe.mjs';
import { manualRenderGates } from '../preflight/render-gates.mjs';
import { AVD_MAX_ENROLLMENT_MS } from '../src/avd-simulator-credentials.mjs';

function runtimeCopy(t) {
  const root = mkdtempSync(join(tmpdir(), 'carscope-avd-gate-')), tool = join(root, 'tools/inspection-sync-poc');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(tool, { recursive: true });
  for (const dir of ['src', 'bin']) cpSync(join(TOOL_ROOT, dir), join(tool, dir), { recursive: true });
  cpSync(resolve(TOOL_ROOT, '../mobile-ar-poc'), join(root, 'tools/mobile-ar-poc'), { recursive: true, filter: (from) => !/[\\/]node_modules([\\/]|$)/.test(from) });
  return tool;
}
const edit = (tool, file, from, to) => {
  const path = join(tool, file), source = readFileSync(path, 'utf8');
  assert.ok(source.includes(from), from);
  writeFileSync(path, source.replace(from, to));
};

test('this tree passes the activation gate, and no environment variable was added for it', () => {
  assert.equal(avdHistoryDemoGate().status, 'PASS');
  assert.equal(environmentGate().status, 'PASS');
  assert.ok(!ALLOWED_ENV.some((name) => /HISTORY/.test(name)));
  assert.equal(AVD_MAX_ENROLLMENT_MS, 24 * 60 * 60_000, 'the registration lifetime policy is unchanged');
});

test('the activation gate catches every shortcut around the Start Command', (t) => {
  const failing = (mutate, pattern) => {
    const tool = runtimeCopy(t);
    mutate(tool);
    const gate = avdHistoryDemoGate(tool);
    assert.equal(gate.status, 'FAIL');
    assert.match(gate.detail, pattern);
  };
  const STATEFUL = 'src/render-stateful.mjs';
  failing((x) => edit(x, STATEFUL, "      enableAvdSimulation,\n    });\n    console.log(enableAvdSimulation", "      enableAvdSimulation, enableAvdHistoryRead: enableAvdSimulation,\n    });\n    console.log(enableAvdSimulation"), /default CLI passes/);
  failing((x) => edit(x, STATEFUL, 'enableAvdHistoryRead = false', 'enableAvdHistoryRead = true'), /not off by default/);
  failing((x) => edit(x, STATEFUL, "if (historyAuthority && enableAvdSimulation) throw new Error('HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN');", ''), /owner authority guard/);
  failing((x) => appendFileSync(join(x, 'src/render-preflight.mjs'), '\nexport const open = { enableAvdHistoryRead: true };\n'), /render-preflight\.mjs passes/);
  failing((x) => appendFileSync(join(x, 'bin/avd-simulator-admin.mjs'), '\nexport const open = { enableAvdHistoryRead: true };\n'), /avd-simulator-admin\.mjs passes/);
  failing((x) => appendFileSync(join(x, AVD_HISTORY_DEMO_ENTRY), '\nexport const on = process.env.CARSCOPE_ANY === "1";\n'), /reads the environment/);
  failing((x) => edit(x, AVD_HISTORY_DEMO_ENTRY, "if (!enableAvdSimulation) throw new Error('AVD_HISTORY_READ_REQUIRES_SIMULATION');", ''), /does not require simulator mode/);
  failing((x) => edit(x, AVD_HISTORY_DEMO_ENTRY, 'enableAvdHistoryRead: true,', 'enableAvdHistoryRead: true, historyAuthority: {},'), /passes a history authority/);
  failing((x) => { writeFileSync(join(x, 'src/extra-read.mjs'), 'export const x = 1;\n'); edit(x, AVD_HISTORY_DEMO_ENTRY, "import { fileURLToPath } from 'node:url';", "import { fileURLToPath } from 'node:url';\nimport './extra-read.mjs';"); }, /adds src\/extra-read\.mjs/);
  failing((x) => edit(x, STATEFUL, "import http from 'node:http';", "import http from 'node:http';\nimport './render-avd-history-demo.mjs';"), /default CLI imports/);
  failing((x) => rmSync(join(x, AVD_HISTORY_DEMO_ENTRY)), /missing/);
});

test('an environment switch stays refused by the existing gate, with this entrypoint present', (t) => {
  const tool = runtimeCopy(t);
  edit(tool, 'src/render-stateful.mjs', "      enableAvdSimulation,\n    });\n    console.log(enableAvdSimulation", "      enableAvdSimulation, enableAvdHistoryRead: process.env.CARSCOPE_AVD_HISTORY_READ === 'OPERATOR_APPROVED',\n    });\n    console.log(enableAvdSimulation");
  const gate = environmentGate(tool);
  assert.equal(gate.status, 'FAIL');
  assert.match(gate.detail, /CARSCOPE_AVD_HISTORY_READ/);
  assert.equal(avdHistoryDemoGate(tool).status, 'FAIL');
});

test('the demonstration entrypoint refuses unsafe configuration before any database contact', async () => {
  const gate = await avdHistoryDemoRefusalGate();
  assert.equal(gate.status, 'PASS', gate.detail);
});

test('preflight makes the running demonstration visible and still fails anything else that claims a read authority', async () => {
  const probe = async (health) => (await probeDeployment({ origin: 'https://carscope.test', request: async () => ({ status: 200, headers: {}, body: JSON.stringify(health) }) })).find((x) => x.id === 'RENDER_HISTORY_AUTHORITY');
  const simulator = { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' };
  const denied = { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' };
  assert.equal((await probe(simulator)).status, 'PASS');
  assert.equal((await probe(denied)).status, 'PASS');
  const demo = await probe({ ...simulator, historyRead: 'AVD_REGISTRATION_ONLY' });
  assert.equal(demo.status, 'MANUAL');
  assert.match(demo.detail, /no vehicle ownership/);
  assert.equal((await probe({ ...denied, historyRead: 'AVD_REGISTRATION_ONLY' })).status, 'FAIL', 'the label without simulator mode');
  assert.equal((await probe({ ...simulator, historyRead: 'AUTHORITY_ADAPTER_CONFIGURED' })).status, 'FAIL');
  assert.equal((await probe({ ...denied, historyRead: 'AUTHORITY_ADAPTER_CONFIGURED' })).status, 'FAIL');
  assert.equal((await probe({ ...simulator, historyRead: true })).status, 'FAIL');
});

test('the Start Command stays an open item in the deployment report', () => {
  const gate = manualRenderGates().find((x) => x.id === 'RENDER_START_COMMAND');
  assert.equal(gate.status, 'NOT_VERIFIED');
  assert.match(gate.detail, /render-stateful\.mjs/);
});
