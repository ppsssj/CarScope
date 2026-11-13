// Real browser + real supabase-js, synthetic Auth/Data API: MOCK_PASS, never Google or hosted RLS evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { createAccountServer } from '../serve.mjs';
import { startMockGoTrue } from './support/mock-gotrue.mjs';
import { AUTH_STORAGE_KEY } from '../web/lib/account-runtime.mjs';

const out = resolve(process.env.CARSCOPE_EVIDENCE_DIR ?? 'C:/CarScope-External/p16-integration');
const repo = resolve('../../..', import.meta.dirname);
assert.ok(!out.startsWith(repo + sep), 'Evidence must be outside repository');
await mkdir(out, {recursive:true});
const auth = await startMockGoTrue({corsOrigin:'*'});
const alice = auth.addUser({email:'alice@example.com',name:'Alice'});
const bob = auth.addUser({email:'bob@example.com',name:'Bob'});
let loginUser = alice;
const owned = randomUUID(), foreign = randomUUID();
const rows = [
  {id:owned, owner_id:alice.id, manufacturer:'기아', model:'EV6', nickname:'나의 테스트 차량', model_year:2024, verification_status:'SELF_REPORTED_UNVERIFIED', created_at:'2026-11-13', updated_at:'2026-11-13'},
  {id:foreign, owner_id:bob.id, manufacturer:'현대', model:'IONIQ 5', nickname:'다른 계정 차량', model_year:2022, verification_status:'SELF_REPORTED_UNVERIFIED', created_at:'2026-11-13', updated_at:'2026-11-13'},
];
const {server} = createAccountServer({env:{SUPABASE_URL:auth.origin, SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TESTONLYpublishable0000', CARSCOPE_IONIQ5_GLB:process.env.CARSCOPE_IONIQ5_GLB, CARSCOPE_QR_AR_BASE_URL:'https://mobile.example.invalid/'}});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const result = {scope:'MOCK_AUTH_AND_DATA_REAL_BROWSER', googleOAuth:'NOT_RUN', hostedRls:'NOT_RUN', checks:[]};
const observed = [], errors = [], csp = [], tokens = [];
const check = async (name, fn) => { await fn(); result.checks.push({name,status:'MOCK_PASS'}); };
try {
  browser = await chromium.launch({channel:process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome',headless:true});
  result.browser=browser.version();
  const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  context.on('page', p => {
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { observed.push(m.text()); if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
  });
  context.on('request', r => observed.push(r.url()));
  // Test-only Data API simulator. This is NOT PostgreSQL RLS; CI's local-stack job covers RLS separately.
  await context.route(auth.origin + '/rest/v1/**', async route => {
    const req=route.request(), url=new URL(req.url());
    const bearer=req.headers().authorization?.slice(7);
    let claims; try { claims=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url')); } catch {}
    if (!claims) return route.fulfill({status:401,json:{code:'PGRST301',message:'JWT required'}});
    if (url.pathname.endsWith('/profiles')) return route.fulfill({json:{id:claims.sub}});
    const id=url.searchParams.get('id')?.replace(/^eq\./,'');
    const visible=rows.filter(r => r.owner_id===claims.sub && (!id || r.id===id));
    if (req.method()==='DELETE') {
      for (const r of visible) rows.splice(rows.indexOf(r),1);
      return route.fulfill({json:visible.map(r=>({id:r.id}))});
    }
    return route.fulfill({json:id ? visible[0] ?? null : visible});
  });
  await context.route(auth.origin + '/auth/v1/authorize?**', async route => {
    const googleUrl = await auth.authorize(route.request().url());
    await route.fulfill({status:302,headers:{location:auth.approve(googleUrl,loginUser)}});
  });
  const p = await context.newPage(); p.setDefaultTimeout(20000);
  const selected = async () => p.locator('#accountInspection[data-selection=SELECTED]').waitFor();
  const login = async () => { await p.goto(base+'/account/'); await p.click('#google'); await p.waitForURL('**/account/vehicles.html'); await p.locator('#vehicles li').first().waitFor(); };
  await check('PKCE callback → My Vehicles → 3D selected → return; session restored',async () => {
    await login();
    const stored=JSON.parse(await p.evaluate(k => localStorage.getItem(k),AUTH_STORAGE_KEY)); tokens.push(stored.access_token, stored.refresh_token);
    await p.getByRole('link',{name:'3D 점검 시작'}).click(); await selected();
    assert.equal(new URL(p.url()).searchParams.get('vehicle'),owned);
    assert.match(await p.locator('#accountInspection').innerText(),/다른 차종/);
    if (process.env.CARSCOPE_IONIQ5_GLB) await p.waitForFunction(() => window.__inspectReady===true);
    await p.screenshot({path:join(out,'selected-desktop.png')});
    await p.reload(); await selected();
    await p.getByRole('link',{name:'← 내 차량',exact:true}).click(); await p.locator('#vehicles li').first().waitFor();
  });
  await check('foreign, deleted, malformed and duplicate UUID never display a selected vehicle',async () => {
    for (const query of [foreign,randomUUID(),'invalid',`${owned}&vehicle=${owned}`]) {
      await p.goto(base+'/inspect/inspect.html?vehicle='+query);
      await p.waitForFunction(() => ['NOT_FOUND','INVALID'].includes(document.querySelector('#accountInspection')?.dataset.selection));
      assert.equal(new URL(p.url()).searchParams.has('vehicle'),false);
      assert.doesNotMatch(await p.locator('#accountInspection').innerText(),/다른 계정 차량|나의 테스트 차량/);
    }
  });
  await check('cross-tab deletion invalidates immediately; logout clears selection and URL',async () => {
    await p.goto(base+'/inspect/inspect.html?vehicle='+owned); await selected();
    const other=await context.newPage(); await other.goto(base+'/account/vehicles.html');
    const fixture=rows.find(r=>r.id===owned);
    await other.locator('#vehicles li .danger').click();
    await other.locator('#vehicles .confirm .danger').click();
    await p.locator('#accountInspection[data-selection=NOT_FOUND]').waitFor();
    await p.goto(base+'/inspect/inspect.html?vehicle='+owned);
    await p.locator('#accountInspection[data-selection=NOT_FOUND]').waitFor();
    rows.push(fixture); // restore synthetic fixture for the following independent scenario
    await other.close();
    await p.goto(base+'/inspect/inspect.html?vehicle='+owned); await selected();
    await p.getByRole('button',{name:'로그아웃',exact:true}).click();
    await p.locator('#accountInspection[data-selection=SIGNED_OUT]').waitFor();
    assert.equal(new URL(p.url()).searchParams.has('vehicle'),false);
    assert.doesNotMatch(await p.locator('#accountInspection').innerText(),/나의 테스트 차량/);
  });
  await check('account switch in another tab removes previous account selection',async () => {
    await login(); await p.getByRole('link',{name:'3D 점검 시작'}).click(); await selected();
    const second=await context.newPage(); await second.goto(base+'/account/vehicles.html');
    const b=await auth.issue(bob); tokens.push(b.access_token,b.refresh_token);
    await second.evaluate(async ([key,value,origin]) => {
      const client = supabase.createClient(origin,'sb_publishable_TESTONLYpublishable0000',{auth:{storageKey:key,detectSessionInUrl:false}});
      await client.auth.setSession(value);
    },[AUTH_STORAGE_KEY,{access_token:b.access_token,refresh_token:b.refresh_token},auth.origin]);
    await p.locator('#accountInspection[data-selection=ACCOUNT_CHANGED]').waitFor();
    assert.equal(new URL(p.url()).searchParams.has('vehicle'),false);
    await second.close();
  });
  await check('trial needs no auth; QR and Native boundaries unchanged',async () => {
    const trial=await browser.newContext();
    const p=await trial.newPage(); p.setDefaultTimeout(20000);
    const requests=[]; p.on('request',r => requests.push(r.url()));
    await p.goto(base+'/inspect/inspect.html'); await p.locator('#accountInspection[data-selection=NONE]').waitFor();
    assert.equal(requests.some(u => u.startsWith(auth.origin) || u.includes('/account/config.json')),false);
    const handoff=await (await p.request.get(base+'/inspect/inspection-handoff.json')).json();
    assert.equal(handoff.configured,true); assert.ok(!handoff.url.includes(owned));
    assert.equal((await p.request.get(base+'/inspect/inspection-qr.svg')).status(),200);
    if (process.env.CARSCOPE_IONIQ5_GLB) {
      await p.waitForFunction(() => window.__inspectReady===true);
      const pose=await p.evaluate(() => JSON.stringify(__inspect.cameraPose()));
      await p.mouse.move(600,450); await p.mouse.down(); await p.mouse.move(740,470,{steps:10}); await p.mouse.up();
      assert.notEqual(await p.evaluate(() => JSON.stringify(__inspect.cameraPose())),pose);
      await p.click('#start'); await p.waitForFunction(() => __inspect.state.name==='INSPECTION_OVERVIEW' && !__inspect.busy);
      assert.equal(await p.evaluate(() => __inspect.nativeResults().connection),'INCOMPLETE_NATIVE');
      await p.locator('[data-action=area][data-id=hood]').click();
      await p.waitForFunction(() => __inspect.state.name==='COMPONENT_SELECTION' && !__inspect.busy);
      assert.equal(await p.evaluate(() => __inspect.hoodAngle),60);
      await p.click('#back');
      await p.waitForFunction(() => __inspect.state.name==='INSPECTION_OVERVIEW' && !__inspect.busy);
      assert.equal(await p.evaluate(() => __inspect.hoodAngle),0);
      await p.locator('[data-action=area][data-id=tires]').click();
      await p.locator('[data-action=tire][data-id="tire.front-left"]').first().click();
      assert.equal(await p.locator('input[data-check=damage]').count()>0,true);
      result.geometry='LOCAL_PASS_REAL_GLB';
    } else result.geometry='NOT_RUN_EXTERNAL_GLB_NOT_CONFIGURED';
    await trial.close();
  });
  await check('mobile layout and WebView never create an account client',async () => {
    await p.setViewportSize({width:390,height:844}); await p.goto(base+'/inspect/inspect.html?vehicle='+foreign); await selected();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    await p.screenshot({path:join(out,'selected-mobile.png')});
    const embedded=await browser.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'});
    const e=await embedded.newPage(); const requests=[]; e.on('request',r => requests.push(r.url()));
    await e.goto(base+'/inspect/inspect.html?vehicle='+owned);
    await e.waitForFunction(() => !document.querySelector('#accountInspection'));
    assert.equal(await e.locator('#accountInspection').count(),0);
    assert.equal(requests.some(u => u.includes('/account/config.json') || u.startsWith(auth.origin)),false);
    await embedded.close();
  });
  await check('no page errors, CSP violations or tokens in request URLs / console',async () => {
    assert.deepEqual(errors,[]); assert.deepEqual(csp,[]);
    assert.equal(observed.some(s => tokens.some(t => s.includes(t))),false);
    assert.equal(observed.some(s => /[?#&](?:access_token|refresh_token)=/.test(s)),false);
  });
  result.status='MOCK_PASS';
} catch(e) { result.status='FAIL'; result.error=String(e.message).slice(0,500); process.exitCode=1; }
finally {
  await browser?.close(); await new Promise(r=>server.close(r)); await auth.close();
  await writeFile(join(out,'summary.json'),JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
