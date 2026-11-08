// Executes the actual Start Command with a fetch-blocking test preload and a disposable private PostgreSQL schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tempFixture } from './temp-fixture.mjs';
import { visionDatabase } from './vision-fixture.mjs';
const skip = !process.env.PG_TEST_URL && 'PG_TEST_URL absent: actual Vision CLI NOT_RUN';
const entry = fileURLToPath(new URL('../src/render-vision-experiment.mjs', import.meta.url));
const origin = 'https://vision-cli-test.onrender.com';
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0,'127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const request = (port, route, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const q = http.request({ host:'127.0.0.1', port, path:route, method, headers:{ Host:new URL(origin).host, 'X-Forwarded-Proto':'https', ...headers } }, r => {
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => resolve({ status:r.statusCode, text:Buffer.concat(chunks).toString() }));
  }); q.on('error', reject); q.end(body);
});

for (const detection of [false, true]) test('real Vision CLI detection=' + detection + ' keeps creation/history denied and never calls AI at startup', { skip, timeout:30_000 }, async t => {
  const db = await visionDatabase(); t.after(() => db.close());
  const owned = tempFixture(); t.after(() => owned.cleanup());
  const preload = join(owned.dir, 'no-network.mjs');
  writeFileSync(preload, "globalThis.fetch = () => { console.error('FORBIDDEN_EXTERNAL_FETCH'); throw new Error('FORBIDDEN_EXTERNAL_FETCH'); };\n");
  const port = await freePort();
  const platform = Object.fromEntries(['PATH','Path','SystemRoot','TEMP','TMP'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
  const env = { ...platform, RENDER:'true', RENDER_EXTERNAL_URL:origin, DATABASE_URL:process.env.PG_TEST_URL,
    CARSCOPE_DB_SCHEMA:db.schema, PGOPTIONS:'-c search_path=' + db.schema, PORT:String(port),
    CARSCOPE_VISION_APPROVAL:'OPERATOR_APPROVED', CARSCOPE_VISION_DAILY_CALL_LIMIT:'1', CARSCOPE_VISION_MONTHLY_CALL_LIMIT:'2',
    OPENAI_API_KEY:'synthetic-cli-key', OPENAI_VISION_MODEL:'synthetic-model', ROBOFLOW_API_KEY:'ignored-synthetic-key', ENABLE_ROBOFLOW:'true' };
  if (detection) env.CARSCOPE_ROBOFLOW_APPROVAL = 'OPERATOR_APPROVED';
  const child = spawn(process.execPath, ['--import',pathToFileURL(preload).href,entry], { env, stdio:['ignore','pipe','pipe'], windowsHide:true });
  let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  const closed = new Promise(resolve => child.once('close', resolve)); t.after(async () => { child.kill(); await closed; });
  for (let i = 0; ; i++) {
    try { if ((await request(port,'/healthz')).status === 200) break; } catch {}
    if (i > 200) throw new Error('Vision CLI did not start: ' + output);
    await new Promise(resolve => setTimeout(resolve,50));
  }
  const health = JSON.parse((await request(port,'/healthz')).text);
  assert.equal(health.mode,'STATEFUL_DENY_DEFAULT'); assert.equal(health.sessionCreation,'DENIED'); assert.equal(health.detection,detection ? 'EXPERIMENT' : 'OFF');
  if (detection) assert.equal(health.detectionModel,'engine-bay-parts/1');
  const home = await request(port,'/'); assert.match(home.text,/data-part-analysis="enabled"/);
  assert.equal(/data-part-detection="enabled"/.test(home.text),detection);
  assert.equal((await request(port,'/v1/sessions',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{"taskId":"washer-fluid"}' })).status,403);
  assert.equal((await request(port,'/v1/inspection-records')).status,403);
  assert.equal((await request(port,'/',{ headers:{ Host:'evil.example' } })).status,403);
  assert.equal((await request(port,'/',{ headers:{ Origin:'https://evil.example' } })).status,403);
  assert.equal((await request(port,'/',{ headers:{ 'X-Forwarded-Proto':'http' } })).status,403);
  assert.equal((await request(port,'//evil.example/')).status,400);
  assert.equal((await request(port,'/?enable=true')).status,400);
  assert.equal((await request(port,'/v1/part-detections/washer-fluid-cap',{ method:'POST' })).status,detection ? 428 : 404);
  assert.equal((await db.admin.query('SELECT count(*) AS n FROM ' + db.schema + '.cs_vision_calls')).rows[0].n,'0');
  assert.doesNotMatch(output,/FORBIDDEN_EXTERNAL_FETCH|synthetic-cli-key|ignored-synthetic-key/);
  child.kill(); await closed;
  const invalid = spawn(process.execPath, [entry], { env:{ ...env,CARSCOPE_VISION_MONTHLY_CALL_LIMIT:'' }, stdio:['ignore','pipe','pipe'],windowsHide:true });
  let invalidOutput = ''; invalid.stderr.on('data',c => { invalidOutput += c; });
  assert.equal(await new Promise(resolve => invalid.once('close',resolve)),1);
  assert.equal(invalidOutput.trim(),'VISION_EXPERIMENT_CONFIGURATION_FAILED');
});
