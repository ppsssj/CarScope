import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../mobile-ar-poc/', import.meta.url));
const files = readdirSync(new URL('../../mobile-ar-poc/test/', import.meta.url)).filter((s) => s.endsWith('.test.mjs')).map((s) => `test/${s}`);
const r = spawnSync(process.execPath, ['--import', new URL('./ar01-clock.mjs', import.meta.url).href, '--test', ...files], { cwd, stdio: 'inherit' });
process.exitCode = r.status ?? 1;
