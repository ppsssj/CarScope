import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOperatorArguments } from '../bin/avd-simulator-admin.mjs';
import { AvdSimulatorCredentialStore } from '../src/avd-simulator-credentials.mjs';

test('operator CLI accepts issue/revoke/list and normalizes --flag names exactly', () => {
  const a=parseOperatorArguments(['issue','--label','CarScope_Pleos_API34',
    '--out','C:/CarScope-External/avd-enrollment.json','--hours','2']);
  assert.equal(a.cmd,'issue');
  assert.equal(a.opts.label,'CarScope_Pleos_API34');
  assert.equal(a.opts.out,'C:/CarScope-External/avd-enrollment.json');
  assert.equal(a.opts.hours,'2');
  assert.equal(parseOperatorArguments(['revoke','--id','an-id']).opts.id,'an-id');
  assert.equal(parseOperatorArguments(['list']).cmd,'list');
  for (const input of [
    [], ['invalid'], ['issue'], ['revoke'], ['list','--label','x'],
    ['issue','--id','x','--label','x','--out','/tmp/secret'],
    ['revoke','--label','x'], ['issue','--label','x','--out'],
    ['issue','--label','x','--label','y','--out','/tmp/secret'],
    ['issue','--label','x','--out','--id'], ['issue','--label','x','--out','/tmp/secret','--unknown','abc'],
    ['revoke','--id','x','--out','/tmp/secret']
  ]) assert.throws(() => parseOperatorArguments(input), /INVALID_|_ARGUMENTS/);
});

const uri=process.env.PG_TEST_URL;
test('operator CLI E2E: actual PostgreSQL issue/list/revoke, no raw bearer in stdout or database',
  { skip: !uri && 'PG_TEST_URL absent: real Postgres operator test NOT_RUN', timeout: 90_000 },
  async () => {
    if (!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(uri).hostname))
      throw new Error('TEST_DB_MUST_BE_LOOPBACK');
    const { Pool } = await import('pg');
    const pool=new Pool({connectionString:uri,max:2,connectionTimeoutMillis:5000});
    const registry=new AvdSimulatorCredentialStore({pool});
    const temp=await mkdtemp(join(tmpdir(),'carscope-admin-cli-'));
    const secret=join(temp,'operator-only-avd-enrollment.json');
    const cli=fileURLToPath(new URL('../bin/avd-simulator-admin.mjs',import.meta.url));
    const run=(...args)=>{
      const p=spawnSync(process.execPath,[cli,...args],{
        env:{...process.env,PG_ADMIN_DATABASE_URL:uri},encoding:'utf8',timeout:15000,
      });
      return {status:p.status,stdout:p.stdout||'',stderr:p.stderr||''};
    };
    try {
      await registry.initialize();
      const issued=run('issue','--label','CarScope_Pleos_API34',
        '--out',secret,'--hours','1');
      assert.equal(issued.status,0,'operator issue must exit 0');
      const publicMeta=JSON.parse(issued.stdout);
      assert.equal(publicMeta.status,'ISSUED');
      assert.equal(publicMeta.secret,'SAVED_LOCALLY_NOT_PRINTED');
      const file=JSON.parse(await readFile(secret,'utf8'));
      assert.equal(file.registrationId,publicMeta.registrationId);
      assert.equal(file.mode,'OPERATOR_APPROVED_AVD_SIMULATION');
      assert.match(file.enrollmentProof,/^[A-Za-z0-9_-]{43}$/);
      assert.ok(!issued.stdout.includes(file.enrollmentProof));
      assert.ok(!issued.stderr.includes(file.enrollmentProof));
      const raw=await pool.query('SELECT enrollment_hash FROM cs_avd_registrations WHERE id=$1',
        [file.registrationId]);
      assert.equal(raw.rows.length,1);
      assert.notEqual(raw.rows[0].enrollment_hash,file.enrollmentProof);
      assert.equal((await registry.provision({enrollmentProof:file.enrollmentProof,
        apiOrigin:'https://carscope-lluo.onrender.com'})).registrationId,file.registrationId);
      const listed=run('list');
      assert.equal(listed.status,0);
      assert.ok(JSON.parse(listed.stdout).registrations.some(x=>x.registrationId===file.registrationId));
      assert.ok(!listed.stdout.includes(file.enrollmentProof));
      const duplicate=run('issue','--label','CarScope_Pleos_API34','--out',secret,'--hours','1');
      assert.notEqual(duplicate.status,0,'must not overwrite existing proof');
      assert.ok(!duplicate.stderr.includes(file.enrollmentProof));
      const revoked=run('revoke','--id',file.registrationId);
      assert.equal(revoked.status,0);
      assert.equal(JSON.parse(revoked.stdout).status,'REVOKED');
      assert.equal(await registry.provision({enrollmentProof:file.enrollmentProof,
        apiOrigin:'https://carscope-lluo.onrender.com'}),null);
    } finally {
      await pool.end();
      await rm(temp,{recursive:true,force:true});
    }
  });
