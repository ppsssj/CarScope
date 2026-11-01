// Store only test output and metadata in an explicit external evidence directory; no request payloads or secrets.
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = process.env.SYNC_EVIDENCE_DIR;
if (!output || !path.isAbsolute(output)) throw new Error('Set SYNC_EVIDENCE_DIR to an absolute external directory');
const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const relative = path.relative(repo, path.resolve(output));
if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Evidence must be external');
mkdirSync(output, { recursive: true });
const gates = ['check', 'test:legacy', 'test', 'test:sqlite', 'test:ar01'];
const summary = { node: process.version, platform: process.platform, at: new Date().toISOString(), gates: [] };
for (const gate of gates) {
  const r = spawnSync(process.execPath, [process.env.npm_execpath, 'run', gate], { encoding: 'utf8', env: process.env });
  writeFileSync(path.join(output, gate.replaceAll(':', '-') + '.txt'), (r.stdout ?? '') + (r.stderr ?? ''));
  summary.gates.push({ gate, status: r.status === 0 ? 'PASS' : 'FAIL', exit: r.status });
  console.log(`${gate}: ${r.status === 0 ? 'PASS' : 'FAIL'}`);
}
writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.gates.some((g) => g.status !== 'PASS')) process.exitCode = 1;
