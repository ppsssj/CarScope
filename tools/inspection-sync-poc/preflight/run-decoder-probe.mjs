#!/usr/bin/env node
// Executes the real Kotlin decoders of two revisions against both server response shapes.
// Exports each revision with `git archive` into a new directory outside the repository, so no worktree, branch or
// tracked file changes. It builds unit tests only: no APK install, no emulator, no device.
//   node preflight/run-decoder-probe.mjs --work <new dir outside repo> [--legacy 2435087] [--current HEAD] [--sdk <path>]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_DECODER_REV } from './compat.mjs';
import { REPO_ROOT } from './static-gates.mjs';

const TEMPLATE = fileURLToPath(new URL('./DeployCompatProbeTest.kt.template', import.meta.url));
export const EXPECTED = Object.freeze({
  legacy: { oldServer: 'ACCEPTED', newServer: 'REJECTED' },
  current: { oldServer: 'ACCEPTED', newServer: 'ACCEPTED' },
});

function run(command, args, options) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true, ...options });
  if (r.status !== 0) throw new Error(`${command} exited ${r.status ?? r.error?.code}: ${(r.stdout ?? '').slice(-2000)}${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
}

function probe(revision, dir, sdk) {
  mkdirSync(dir, { recursive: true });
  run('git', ['archive', '--format=tar', '-o', join(dir, 'source.tar'), revision], { cwd: REPO_ROOT });
  run('tar', ['-xf', 'source.tar'], { cwd: dir });
  if (sdk) writeFileSync(join(dir, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}\n`);
  copyFileSync(TEMPLATE, join(dir, 'app/src/testDebug/java/io/carscope/app/sync/DeployCompatProbeTest.kt'));
  const windows = process.platform === 'win32';
  run(windows ? '.\\gradlew.bat' : './gradlew', [':app:testDebugUnitTest', '--tests', 'io.carscope.app.sync.DeployCompatProbeTest', '--console=plain', '--max-workers=1', '-Pkotlin.compiler.execution.strategy=in-process', '--no-daemon'], { cwd: dir, shell: windows, env: process.env });
  return {
    revision: run('git', ['rev-parse', revision + '^{commit}'], { cwd: REPO_ROOT }).trim(),
    ...JSON.parse(readFileSync(join(dir, 'app/build/deploy-compat-probe.json'), 'utf8')),
  };
}

function main() {
  const args = process.argv.slice(2), opt = {};
  for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  if (!opt.work) throw new Error('--work is required');
  const work = resolve(opt.work);
  if (existsSync(work)) throw new Error('--work must be a new directory');
  mkdirSync(work, { recursive: true });
  const from = relative(realpathSync(REPO_ROOT), realpathSync(work));
  if (!from.startsWith('..' + sep) && from !== '..' && !isAbsolute(from)) throw new Error('--work must be outside the repository');
  const sdk = opt.sdk ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const results = {
    legacy: probe(opt.legacy ?? LEGACY_DECODER_REV, join(work, 'legacy'), sdk),
    current: probe(opt.current ?? 'HEAD', join(work, 'current'), sdk),
  };
  const wrong = Object.entries(EXPECTED).flatMap(([gen, want]) => Object.entries(want).filter(([server, verdict]) => results[gen][server] !== verdict).map(([server]) => `${gen}/${server}`));
  console.log(JSON.stringify({ status: wrong.length ? 'FAIL' : 'PASS', scope: 'KOTLIN_UNIT_TEST_ONLY_NO_DEVICE', results, unexpected: wrong }, null, 2));
  if (wrong.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
