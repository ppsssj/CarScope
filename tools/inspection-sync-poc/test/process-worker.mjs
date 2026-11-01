import { SQLiteSessionStore } from '../src/sqlite-store.mjs';
import { SessionService } from '../src/sessions.mjs';
import { DatabaseSync } from 'node:sqlite';
const store = new SQLiteSessionStore({ filename: process.argv[2] });
process.send({ ready: true });
process.once('message', async (job) => {
  const svc = new SessionService({ store, now: () => job.now ?? Date.now(), limits: job.limits });
  try {
    let out;
    if (job.op === 'increment') {
      for (let i = 0; i < job.n; i++) await store.update(job.id, (s) => ({ ...s, counter: (s.counter ?? 0) + 1 }));
      out = true;
    } else if (job.op === 'create') {
      out = [];
      for (let i = 0; i < job.n; i++) {
        try { await svc.create({ taskId: 'washer-fluid' }); out.push('OK'); } catch (e) { out.push(e.code); }
      }
    } else if (job.op === 'rate') {
      out = Array.from({ length: job.n }, () => store.rateCheck('shared-client', 'create', { now: () => job.now, rates: { create: { limit: 7, windowMs: 1000 } } }).ok);
    } else if (job.op === 'claim') out = await svc.claim(job.token);
    else if (job.op === 'submit') out = await svc.submit(job.token, job.envelope);
    else if (job.op === 'accept') out = await svc.accept(job.id, job.token, job.digest);
    else if (job.op === 'sweep') out = await svc.sweep();
    else if (job.op === 'crash') {
      const db = new DatabaseSync(process.argv[2]);
      db.exec('BEGIN IMMEDIATE');
      db.prepare("UPDATE sessions SET data=json_set(data, '$.counter', 99999) WHERE id=?").run(job.id);
      process.exit(17); // abrupt exit before COMMIT, no store close/rollback callback
    } else throw new Error('Unknown operation');
    process.send({ out });
  } catch (e) { process.send({ error: e.code ?? e.message }); }
  finally { store.close(); process.disconnect(); }
});
