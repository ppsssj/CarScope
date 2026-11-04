// Compare compiled Native metadata with mobile, Node and the exact P7-B handoff. No device or secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { taskLinks, TIRE_TASKS, CHARGE_TASK, BRAKE_TASK } from '../mobile-ar-poc/public/inspection-tasks.mjs';
import { EXTRA_TASKS } from '../mobile-ar-poc/public/extra-tasks.mjs';
import { TIRE_CHECKS } from '../mobile-ar-poc/public/tire-result.mjs';
import { CHARGE_CHECKS } from '../mobile-ar-poc/public/charge-result.mjs';
import { BRAKE_CHECKS } from '../mobile-ar-poc/public/brake-result.mjs';
import { SUPPORTED_TASKS } from '../inspection-sync-poc/src/protocol.mjs';

const row = (taskId, partId, checks = []) => ({ taskId, partId, schemaVersion: taskId === 'washer-fluid' ? 1 : 2, responseKeys: checks.map(c => c.id).sort() });
export const taskContract = [row('washer-fluid','washer-fluid-cap'), ...TIRE_TASKS.map(t=>row(t.id,t.id,TIRE_CHECKS)),
  row(CHARGE_TASK.id,CHARGE_TASK.id,CHARGE_CHECKS),row(BRAKE_TASK.id,'brake-fluid-reservoir',BRAKE_CHECKS),
  ...EXTRA_TASKS.map(t=>row(t.id,t.id,t.checks))];
assert.equal(taskContract.length,17);
assert.equal(new Set(taskContract.map(r=>r.taskId)).size,17);
assert.deepEqual(taskContract.map(r=>r.taskId),SUPPORTED_TASKS);
assert.deepEqual(taskLinks().map(r=>r.id),SUPPORTED_TASKS);
const doc = readFileSync(new URL('../../docs/contracts/p7-b-mobile-tasks-v2.md',import.meta.url),'utf8');
const handoff = JSON.parse(doc.match(/<!-- p7-b-task-contract -->\s*```json\s*([\s\S]*?)```/)[1]);
assert.equal(handoff.extensionVersion,1);
assert.deepEqual(handoff.tasks.map(t=>({...t,responseKeys:[...t.responseKeys].sort()})),taskContract.slice(7));
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
if (process.argv[2]) {
  const native = JSON.parse(readFileSync(process.argv[2],'utf8'));
  assert.deepEqual(native,taskContract,'Native task/part/schema/responseKeys must match mobile, Node and P7-B');
  console.log('PASS: compiled Native allowlist matches all 17 mobile/Node tasks and P7-B exact part/schema/keys');
} else console.log(JSON.stringify(taskContract));
}
