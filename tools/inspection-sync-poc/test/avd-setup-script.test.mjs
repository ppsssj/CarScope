// The operator script needs a real AVD and database for its whole path. This covers what can be checked without them:
// its fixed rules, that PowerShell parses it, and the private-file write against a stand-in adb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../android/setup-avd-simulator.ps1', import.meta.url));
const source = readFileSync(script, 'utf8');
const policy = readFileSync(new URL('../../../app/src/debug/java/io/carscope/app/sync/AvdSimulatorProvisioning.kt', import.meta.url), 'utf8');
const windows = { skip: process.platform === 'win32' ? false : 'PowerShell 5.1 runs only on Windows' };

test('the script targets the only origin the app accepts and takes no secret as an argument', () => {
  const origin = policy.match(/API_ORIGIN = "([^"]+)"/)[1];
  assert.ok(source.includes(`$Origin = '${origin}'`));
  const parameters = source.slice(source.indexOf('param('), source.indexOf("$ErrorActionPreference"));
  assert.doesNotMatch(parameters, /proof|token|password|secret|\$Url|DatabaseUrl/i);
  assert.ok(/^[\x00-\x7f]*$/.test(source), 'PowerShell 5.1 reads a file without a BOM as ANSI');
});

test('the script never reads a private file back and leaves Render alone', () => {
  assert.doesNotMatch(source, /cat files\//);
  assert.doesNotMatch(source, /(Write-Output|Write-Host)[^\n]*(secretFile|ReadAllText|PG_ADMIN_DATABASE_URL)/);
  assert.doesNotMatch(source, /api\.render\.com|Invoke-RestMethod[^\n]*-Method (Post|Put|Patch|Delete)/);
  assert.match(source, /Assert-SimulationMode\s+Initialize-Database/, 'the mode check runs before any database use');
  assert.match(source, /-Action Remove|Invoke-Admin @\('revoke'/);
});

test('PowerShell parses the script', windows, () => {
  const check = `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$t,[ref]$e);$e.Count`;
  assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { encoding: 'utf8' }).trim(), '0');
});

test('the endpoint reaches the app only through stdin, with the fixed value, and is checked', windows, () => {
  const folder = mkdtempSync(join(tmpdir(), 'carscope-fake-adb-'));
  try {
    const log = join(folder, 'calls.jsonl');
    writeFileSync(join(folder, 'adb.mjs'), `import {appendFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2);const command=args.join(' ');
const stdin=command.includes('cat >')?readFileSync(0,'utf8'):'';
appendFileSync(${JSON.stringify(log)},JSON.stringify({command,stdin})+'\\n');
if(command.includes('am get-current-user'))console.log('10');
// A real device printed only the mode for a quoted format, because PowerShell 5.1 had dropped the quotes.
if(command.includes('stat -c %a:%s'))console.log('600:102');else if(command.includes('stat -c'))console.log('600');
if(command.includes('head -c 1'))console.log('{');
`);
    const adb = join(folder, 'adb.cmd');
    writeFileSync(adb, `@node "${join(folder, 'adb.mjs')}" %*\r\n`);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Serial', 'emulator-5554', '-Action', 'Endpoint', '-Adb', adb, '-StateDir', folder], { encoding: 'utf8' });
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const write = calls.find(call => call.command.includes('cat >'));
    assert.deepEqual(JSON.parse(write.stdin), { apiOrigin: 'https://carscope-lluo.onrender.com', mobileRoot: 'https://carscope-lluo.onrender.com/' });
    assert.ok(write.command.includes('--user 10') && write.command.includes('chmod 600'));
    assert.ok(!write.command.includes('apiOrigin'), 'the value is not on a command line');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
