// Debug package and Release boundary for P8-B1. Runs the real builder on a temporary copy, never in app/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,cpSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const walk=dir=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]):[];
const MODULES=['inspection-history-contract.mjs','inspection-history-store.mjs','inspection-history-view.mjs','inspection-history-client.mjs','native-history-provider.mjs'];

test('Debug package has the History UI unchanged, no provider, and no synthetic data or credential path',()=>{
  const fixture=mkdtempSync(join(tmpdir(),'carscope-history-packaging-')),tools=join(fixture,'tools');mkdirSync(tools);
  cpSync(join(repo,'tools/three-poc'),join(tools,'three-poc'),{recursive:true});
  cpSync(join(repo,'tools/ioniq5-asset'),join(tools,'ioniq5-asset'),{recursive:true});
  mkdirSync(join(tools,'mobile-ar-poc/public'),{recursive:true});
  cpSync(join(repo,'tools/mobile-ar-poc/public/handoff.mjs'),join(tools,'mobile-ar-poc/public/handoff.mjs'));
  cpSync(join(repo,'tools/mobile-ar-poc/public/part-capabilities.mjs'),join(tools,'mobile-ar-poc/public/part-capabilities.mjs'));
  const r=spawnSync(process.execPath,['tools/three-poc/build-android-inspection.mjs'],{cwd:fixture,encoding:'utf8',env:{...process.env,CARSCOPE_QR_AR_BASE_URL:''}});
  assert.equal(r.status,0,r.stderr);
  const out=join(fixture,'app/src/debug/assets/inspection'),files=walk(out);
  for(const name of MODULES)assert.equal(readFileSync(join(out,name),'utf8'),readFileSync(join(repo,'tools/three-poc',name),'utf8'),name);
  const page=readFileSync(join(out,'inspect.js'),'utf8');
  assert.ok(page.includes('createInspectionHistoryStore({provider:null})'),'no provider is composed');
  assert.ok(!/history-demo|demoHistoryProvider|demoRows/.test(page));
  assert.ok(!files.some(f=>/history-demo|fixture|[\\/]test[\\/]/.test(f.slice(out.length))),'synthetic History data is not packaged');
  for(const file of files.filter(f=>/inspection-history|native-history|inspect\.js$|inspection-flow|inspection-product|android-inspect-shell/.test(f))){
    const text=readFileSync(file,'utf8').replace(/^\s*\/\/.*$/gm,'');
    assert.ok(!/Authorization|[Bb]earer\s|X-Forwarded|\/v1\/inspection-records|history:read|PG_TEST_URL|onrender\.com/.test(text),file);
    assert.ok(!/synthetic-(user|vehicle|device|registration)|issuer\.example/.test(text),file);
  }
  for(const file of files.filter(f=>/inspection-history-(contract|store|view|client)/.test(f)))assert.ok(!/\bfetch\s*\(/.test(readFileSync(file,'utf8')),file);
  assert.ok(!existsSync(join(fixture,'app/src/release')),'builder writes nothing to Release');
  assert.ok(!existsSync(join(fixture,'app/src/main/assets/inspection')),'builder writes nothing to main');
});

test('Release and main sources contain no History UI, demo data or History credential path',()=>{
  const roots=['app/src/main','app/src/release'].map(p=>join(repo,p));
  for(const file of roots.flatMap(walk)){
    assert.ok(!/inspection-history|history-demo/.test(file),file);
    if(/\.(kt|java|xml|html|js|mjs|json|txt)$/.test(file)){
      const text=readFileSync(file,'utf8');
      assert.ok(!/inspection-records|inspection:history:read|inspection-history|데모 데이터/.test(text),file);
    }
  }
  const gradle=readFileSync(join(repo,'app/build.gradle.kts'),'utf8');assert.ok(!/inspection-history|history-demo/.test(gradle));
});

test('the ACCEPTED bridge is not History access: the Android adapter has no History operation',()=>{
  const adapter=readFileSync(join(repo,'tools/three-poc/android-native-inspection-adapter.mjs'),'utf8');
  assert.ok(!/history/i.test(adapter));
  const results=readFileSync(join(repo,'tools/three-poc/native-inspection-results.mjs'),'utf8');assert.ok(!/history/i.test(results));
  for(const name of MODULES)assert.ok(!/android-native-inspection-adapter|native-inspection-results/.test(readFileSync(join(repo,'tools/three-poc',name),'utf8')),name);
});
