import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,cpSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
test('Android debug package follows the new inspection builder and every relative module unchanged',()=>{
  const fixture=mkdtempSync(join(tmpdir(),'carscope-state-map-packaging-'));
  const fixtureTools=join(fixture,'tools');mkdirSync(fixtureTools);
  cpSync(join(repo,'tools/three-poc'),join(fixtureTools,'three-poc'),{recursive:true});
  cpSync(join(repo,'tools/ioniq5-asset'),join(fixtureTools,'ioniq5-asset'),{recursive:true});
  mkdirSync(join(fixtureTools,'mobile-ar-poc/public'),{recursive:true});
  cpSync(join(repo,'tools/mobile-ar-poc/public/handoff.mjs'),join(fixtureTools,'mobile-ar-poc/public/handoff.mjs'));
  const r=spawnSync(process.execPath,['tools/three-poc/build-android-inspection.mjs'],{cwd:fixture,encoding:'utf8',env:{...process.env,CARSCOPE_QR_AR_BASE_URL:''}});
  assert.equal(r.status,0,r.stderr);
  const out=join(fixture,'app/src/debug/assets/inspection');
  assert.ok(existsSync(join(out,'ioniq5-asset/inspection-components.mjs')));
  assert.ok(existsSync(join(out,'ioniq5-asset/ev-battery.mjs')));
  assert.equal(readFileSync(join(out,'charge-port-model.mjs'),'utf8'),readFileSync(join(repo,'tools/three-poc/charge-port-model.mjs'),'utf8'));
  assert.ok(existsSync(join(out,'ioniq5-asset/ev-charge-port.mjs')));
  assert.equal(readFileSync(join(out,'ev-charge-status.mjs'),'utf8'),readFileSync(join(repo,'tools/three-poc/ev-charge-status.mjs'),'utf8'));
  assert.equal(readFileSync(join(out,'visibility-status.mjs'),'utf8'),readFileSync(join(repo,'tools/three-poc/visibility-status.mjs'),'utf8'));
  for (const name of ['inspection-product.mjs', 'inspection-state-map.mjs', 'inspection-state-view.mjs', 'inspection-tires.mjs', 'tire-targets.mjs', 'tire-status.mjs', 'component-status.mjs', 'tire-inspection.mjs', 'tire-inspection-view.mjs']) {
    assert.equal(readFileSync(join(out,name),'utf8'),readFileSync(join(repo,'tools/three-poc',name),'utf8'),name);
  }
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  for(const file of walk(out).filter(f=>f.endsWith('.mjs')||basename(f)==='inspect.js')) {
    const text=readFileSync(file,'utf8');
    for(const m of text.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) assert.ok(existsSync(resolve(dirname(file),m[1])),`${file}: ${m[1]}`);
  }
  for(const name of readdirSync(join(out,'ioniq5-asset'))) assert.equal(readFileSync(join(out,'ioniq5-asset',name),'utf8'),readFileSync(join(repo,'tools/ioniq5-asset',name),'utf8'),name);
  assert.equal(readFileSync(join(out,'inspect.js'),'utf8'),readFileSync(join(repo,'tools/three-poc/inspect.js'),'utf8'));
  assert.ok(!walk(out).some(f=>f.endsWith('.glb')));
  for(const name of ['mobile-result-contract.mjs','native-inspection-results.mjs','inspection-results.mjs','inspection-results-view.mjs'])assert.equal(readFileSync(join(out,name),'utf8'),readFileSync(join(repo,'tools/three-poc',name),'utf8'));
  assert.ok(!walk(out).some(f=>/fixture|test[\\/]/.test(f.slice(out.length))),'synthetic receiver authorities never enter Android assets');
  assert.ok(readFileSync(join(out,'inspect.js'),'utf8').includes('createNativeInspectionResults()'),'production composition has no fake Native adapter');
  assert.ok(!existsSync(join(fixture,'app/src/release/assets/inspection')),'builder remains debug-only');
  const html=readFileSync(join(out,'index.html'),'utf8');assert.ok(html.includes('android-inspect-shell.js'));assert.ok(readFileSync(join(out,'csp.txt'),'utf8').includes("connect-src 'self'"));
});
