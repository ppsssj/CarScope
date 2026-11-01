import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
test('Android debug package follows the new inspection builder and every relative module unchanged',()=>{
  const r=spawnSync(process.execPath,['tools/three-poc/build-android-inspection.mjs'],{cwd:repo,encoding:'utf8',env:{...process.env,CARSCOPE_QR_AR_BASE_URL:''}});
  assert.equal(r.status,0,r.stderr);
  const out=join(repo,'app/src/debug/assets/inspection');
  assert.ok(existsSync(join(out,'ioniq5-asset/inspection-components.mjs')));
  for (const name of ['inspection-tires.mjs', 'tire-targets.mjs']) {
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
  const html=readFileSync(join(out,'index.html'),'utf8');assert.ok(html.includes('android-inspect-shell.js'));assert.ok(readFileSync(join(out,'csp.txt'),'utf8').includes("connect-src 'self'"));
});
