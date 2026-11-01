import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['--test', 'test/service.test.mjs', 'test/race.test.mjs'], {
  stdio: 'inherit', env: { ...process.env, SYNC_TEST_STORE: 'sqlite' },
});
process.exitCode = r.status ?? 1;
