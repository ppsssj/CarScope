#!/usr/bin/env node
// LOCAL OPERATOR ONLY. No public admin endpoint, test credential or vehicle ownership assertion.
import { fileURLToPath } from 'node:url';
import { writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { AvdSimulatorCredentialStore, AVD_MAX_ENROLLMENT_MS } from '../src/avd-simulator-credentials.mjs';

/** Pure, testable operator CLI parser; all keys are normalized before action validation.
 *  No command-line secrets: --label, --out, --hours and --id only.
 */
export function parseOperatorArguments(argv) {
  if (!Array.isArray(argv) || !['issue', 'revoke', 'list'].includes(argv[0]))
    throw new Error('INVALID_ADMIN_COMMAND');
  const [cmd, ...args] = argv;
  const allowed = cmd === 'issue' ? new Set(['label', 'out', 'hours'])
    : cmd === 'revoke' ? new Set(['id']) : new Set();
  if (args.length % 2 !== 0) throw new Error('INVALID_ARGUMENTS');
  const opts = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (typeof flag !== 'string' || !/^--(?:label|out|hours|id)$/.test(flag))
      throw new Error('INVALID_ARGUMENTS');
    const key = flag.slice(2);
    if (!allowed.has(key) || Object.hasOwn(opts, key) ||
        typeof args[i + 1] !== 'string' || args[i + 1].length === 0 ||
        args[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    opts[key] = args[i + 1];
  }
  if (cmd === 'issue' && (!opts.label || !opts.out)) throw new Error('ISSUE_ARGUMENTS');
  if (cmd === 'revoke' && !opts.id) throw new Error('REVOKE_ARGUMENTS');
  return {cmd, opts};
}

async function run(argv=process.argv.slice(2)) {
  const {cmd, opts} = parseOperatorArguments(argv);
  if (!process.env.PG_ADMIN_DATABASE_URL || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('INVALID_ADMIN_CONFIGURATION');
  const url = new URL(process.env.PG_ADMIN_DATABASE_URL);
  if (!['postgresql:','postgres:'].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      !url.pathname || url.pathname === '/' || url.hash) throw new Error('INVALID_POSTGRES_URL');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.PG_ADMIN_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const auth = new AvdSimulatorCredentialStore({ pool });
    await auth.initialize();
    if (cmd === 'issue') {
      if (!opts.label || !opts.out) throw new Error('ISSUE_ARGUMENTS');
      const hours = opts.hours == null ? 2 : Number(opts.hours);
      if (!Number.isSafeInteger(hours) || hours < 1 || hours > AVD_MAX_ENROLLMENT_MS / 3600000) throw new Error('ENROLLMENT_TTL');
      const target = resolve(opts.out);
      const project = await realpath(fileURLToPath(new URL('../../../', import.meta.url)));
      const folder = await realpath(dirname(target)); // must already exist; do not create directories.
      const rel = relative(project, folder);
      if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) throw new Error('OUTPUT_IN_SOURCE_REPOSITORY_FORBIDDEN');
      const {registrationId, enrollmentProof, expiresAt, mode} = await auth.register({label:opts.label,ttlMs:hours*3600000});
      try {
        await writeFile(target, JSON.stringify({mode,registrationId,enrollmentProof,expiresAt})+'\n',
          {encoding:'utf8',flag:'wx',mode:0o600});
      } catch (e) {
        await auth.revoke({registrationId});
        throw new Error('SECRET_FILE_CREATION_FAILED');
      }
      process.stdout.write(JSON.stringify({status:'ISSUED',registrationId,expiresAt,secret:'SAVED_LOCALLY_NOT_PRINTED'})+'\n');
      return;
    }
    if (cmd === 'revoke') {
      if (!opts.id) throw new Error('REVOKE_ARGUMENTS');
      const revoked = await auth.revoke({registrationId:opts.id});
      process.stdout.write(JSON.stringify({status:revoked?'REVOKED':'NOT_FOUND',registrationId:opts.id})+'\n');
      return;
    }
    // list accepts no options, as enforced by parseOperatorArguments.
    process.stdout.write(JSON.stringify({registrations:await auth.metadata()})+'\n');
  } finally { await pool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(() => { console.error('AVD_OPERATOR_COMMAND_FAILED (no credentials logged)'); process.exitCode=1; });
}
