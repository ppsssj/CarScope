import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { probeVisionDatabase } from '../src/vision-health.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(query) {
  const c = new EventEmitter(), releases = [];
  c.query = query; c.release = error => releases.push(Boolean(error));
  return { c, releases, pool:{ connect:async () => c } };
}
test('UP requires a completed real schema query; query has its own timeout', async () => {
  const f = fixture(async query => { assert.equal(query.text,'SELECT current_schema() AS name'); assert.equal(query.query_timeout,100); return { rows:[{ name:'carscope_vision' }] }; });
  assert.deepEqual(await probeVisionDatabase(f.pool,'carscope_vision',100),{ ok:true });
  assert.deepEqual(f.releases,[false]); assert.equal(f.c.listenerCount('error'),0);
});
test('a late pool checkout is discarded once without running SQL or changing the timeout result', async () => {
  let checkout, queries = 0;
  const f = fixture(async () => { queries++; return { rows:[{ name:'carscope_vision' }] }; });
  const result = await probeVisionDatabase({ connect:() => new Promise(resolve => { checkout=resolve; }) },'carscope_vision',20);
  assert.deepEqual(result,{ ok:false,code:'DATABASE_TIMEOUT' });
  checkout(f.c); await turn();
  assert.equal(queries,0); assert.deepEqual(f.releases,[true]);
});
test('a stuck query is bounded and its connection discarded; a late answer cannot become UP or release twice', async () => {
  let answer;
  const f = fixture(() => new Promise(resolve => { answer=resolve; }));
  const result = await probeVisionDatabase(f.pool,'carscope_vision',20);
  assert.deepEqual(result,{ ok:false,code:'DATABASE_TIMEOUT' }); assert.deepEqual(f.releases,[true]);
  answer({ rows:[{ name:'carscope_vision' }] }); await turn();
  assert.deepEqual(f.releases,[true]); assert.deepEqual(result,{ ok:false,code:'DATABASE_TIMEOUT' });
});
test('database errors and schema mismatches fail closed with fixed non-sensitive categories', async () => {
  const mismatch=fixture(async () => ({ rows:[{ name:'public' }] }));
  assert.deepEqual(await probeVisionDatabase(mismatch.pool,'carscope_vision'),{ ok:false,code:'DATABASE_SCHEMA_MISMATCH' });
  const failed=fixture(async () => { throw new Error('secret password and token'); });
  assert.deepEqual(await probeVisionDatabase(failed.pool,'carscope_vision'),{ ok:false,code:'DATABASE_UNAVAILABLE' });
  assert.deepEqual(failed.releases,[true]);
  assert.deepEqual(await probeVisionDatabase({ connect:async () => { throw new Error('secret URL'); } },'carscope_vision'),{ ok:false,code:'DATABASE_UNAVAILABLE' });
});
