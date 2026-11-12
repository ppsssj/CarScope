// The external data layer is a library with no entrypoint. Nothing that runs today (Render entries, Android, the mobile pages,
// the 3D page's network code) may import it, name its hosts, or turn its UI block on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGraph, AVD_HISTORY_DEMO_ENTRY, WEBXR_EXPERIMENT_ENTRY, VISION_EXPERIMENT_ENTRY } from '../../inspection-sync-poc/preflight/static-gates.mjs';

const REPO = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const read = p => readFileSync(join(REPO, p), 'utf8');
function files(dir, exts) {
  const out = [];
  for (const name of readdirSync(join(REPO, dir))) {
    if (['node_modules', 'build', '.gradle', 'generated'].includes(name)) continue;
    const p = join(dir, name), s = statSync(join(REPO, p));
    if (s.isDirectory()) out.push(...files(p, exts)); else if (exts.some(e => name.endsWith(e))) out.push(p.split(sep).join('/'));
  }
  return out;
}
const HOSTS = /kr-ccapi\.hyundai\.com|api\.pleos\.ai|vehicle-data-api/;

test('no Render entry (default, AVD demo, WebXR, Vision) imports the external data layer', () => {
  for (const entry of ['src/render-stateful.mjs', AVD_HISTORY_DEMO_ENTRY, WEBXR_EXPERIMENT_ENTRY, VISION_EXPERIMENT_ENTRY, 'src/server.mjs', 'src/https-mobile-service.mjs'])
    assert.ok(!importGraph(entry).some(f => f.includes('vehicle-data-api')), entry);
});

test('no server, Android, mobile or 3D source outside this package names the provider hosts or imports the package', () => {
  const scanned = [...files('tools/inspection-sync-poc/src', ['.mjs']), ...files('tools/inspection-sync-poc/bin', ['.mjs']), ...files('tools/mobile-ar-poc/public', ['.mjs', '.js', '.html']),
    ...files('tools/three-poc', ['.mjs', '.js', '.html']).filter(f => !f.includes('/test')), ...files('app/src', ['.kt', '.xml']), ...files('.github/workflows', ['.yml'])
      .filter(f => !f.endsWith('vehicle-data-api-ci.yml'))];
  assert.ok(scanned.length > 50);
  for (const f of scanned) assert.doesNotMatch(read(f), HOSTS, f);
});

test('the 3D page block is fixture-only: no network code, and only ?externalVehicleData=fixture turns it on', () => {
  const block = read('tools/three-poc/external-vehicle-data.mjs');
  assert.doesNotMatch(block, /fetch\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//);
  const inspect = read('tools/three-poc/inspect.js');
  const uses = [...inspect.matchAll(/EXTERNAL_FIXTURE/g)];
  assert.equal(uses.length, 2, 'imported once, used once behind the flag');
  assert.match(inspect, /const externalVehicleData=params\.get\('externalVehicleData'\)==='fixture'\?EXTERNAL_FIXTURE:null;/);
  assert.doesNotMatch(read('tools/three-poc/android-inspect-shell.js'), /externalVehicleData/);
});

test('package has no dependencies and no entrypoint', () => {
  const pkg = JSON.parse(read('tools/vehicle-data-api/package.json'));
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['check', 'test']);
  for (const f of files('tools/vehicle-data-api/src', ['.mjs'])) {
    const s = read(f);
    assert.doesNotMatch(s, /createServer|\.listen\(|process\.argv|console\./, f);
    assert.doesNotMatch(s, /process\.env\.[A-Z]/, f + ' reads no environment by itself (availability takes env as an argument)');
  }
});
