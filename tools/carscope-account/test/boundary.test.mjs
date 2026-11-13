// P15 boundaries: the account feature is separate from trial mode, Android, Render, QR/AVD auth and the session /
// inspection-record schema, and holds no secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { importGraph, AVD_HISTORY_DEMO_ENTRY, WEBXR_EXPERIMENT_ENTRY, VISION_EXPERIMENT_ENTRY } from '../../inspection-sync-poc/preflight/static-gates.mjs';

const REPO = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PKG = 'tools/carscope-account';
const read = (p) => readFileSync(join(REPO, p), 'utf8');
function files(dir, exts) {
  const out = [];
  for (const name of readdirSync(join(REPO, dir))) {
    if (['node_modules', 'build', '.gradle', 'generated', '.temp', '.branches'].includes(name)) continue;
    const p = join(dir, name), s = statSync(join(REPO, p));
    if (s.isDirectory()) out.push(...files(p, exts)); else if (exts.some((e) => name.endsWith(e))) out.push(p.split(sep).join('/'));
  }
  return out;
}
const MIGRATION = `${PKG}/supabase/migrations/20261113000000_p15_account_vehicles.sql`;
const sqlCode = () => read(MIGRATION).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('no Render entry, sync server or mobile receiver imports the account package or Supabase Auth', () => {
  for (const entry of ['src/render-stateful.mjs', AVD_HISTORY_DEMO_ENTRY, WEBXR_EXPERIMENT_ENTRY, VISION_EXPERIMENT_ENTRY, 'src/server.mjs', 'src/https-mobile-service.mjs']) {
    assert.ok(!importGraph(entry).some((f) => f.includes('carscope-account') || f.includes('@supabase')), entry);
  }
});

test('trial mode, QR, AVD and Android sources do not reference the account pages, Supabase Auth or Google sign-in', () => {
  const scanned = [
    ...files('tools/three-poc', ['.mjs', '.js', '.html']).filter((f) => !f.includes('/test')),
    ...files('tools/mobile-ar-poc/public', ['.mjs', '.js', '.html']),
    ...files('tools/inspection-sync-poc/src', ['.mjs']), ...files('tools/inspection-sync-poc/public', ['.mjs', '.html']),
    ...files('app/src', ['.kt', '.xml', '.kts']),
  ];
  assert.ok(scanned.length > 80, `scanned ${scanned.length}`);
  for (const f of scanned) assert.doesNotMatch(read(f), /carscope-account|@supabase\/|supabase-js|signInWithOAuth|\/auth\/v1\//, f);
});

test('the Android asset builders copy no account file (Debug and Release stay without Google sign-in)', () => {
  for (const builder of ['tools/three-poc/build-android-inspection.mjs', 'tools/three-poc/build-android-lab.mjs']) {
    assert.doesNotMatch(read(builder), /carscope-account|account\/|supabase/i, builder);
  }
});

test('the browser code holds no secret, no SDK, no console output and builds no HTML from strings', () => {
  const web = files(`${PKG}/web`, ['.mjs', '.html', '.css']);
  assert.ok(web.length >= 10);
  for (const f of web) {
    const text = read(f);
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9]|service_role\s*[:=]|SUPABASE_SECRET|SERVICE_ROLE_KEY|client_secret/i, f);
    if (f.endsWith('.mjs')) {
      assert.doesNotMatch(text, /console\.|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, f);
      assert.doesNotMatch(text, /pleos|io\.carscope|vehicle-data-api|hyundai\.com/i, f);
      assert.doesNotMatch(text, /getSession\(\)[^;]*\.user\b/, `${f}: identity must come from getUser, not getSession`);
    }
  }
  // public-config.mjs is the only place that names secret key prefixes, to refuse them.
  assert.match(read(`${PKG}/web/lib/public-config.mjs`), /SECRET_KEY_REFUSED/);
});

test('the server code never reads secret environment variables and never logs tokens', () => {
  for (const f of [`${PKG}/serve.mjs`, ...files(`${PKG}/src`, ['.mjs'])]) {
    const text = read(f);
    assert.doesNotMatch(text, /process\.env\.(SUPABASE_SECRET|SUPABASE_SERVICE|SERVICE_ROLE|GOOGLE_CLIENT_SECRET)/, f);
    assert.doesNotMatch(text, /console\./, f);
  }
});

test('migration: only carscope_account; no carscope / carscope_private / public objects; no SECURITY DEFINER; nothing to anon / service_role', () => {
  const sql = sqlCode();
  assert.doesNotMatch(sql, /\bcarscope\.|\bcarscope_private\b|\bpublic\./i);
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.doesNotMatch(sql, /\bdrop\b|\btruncate\b|alter\s+default\s+privileges|bypassrls/i);
  assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/i);
  for (const line of sql.split(';')) {
    if (/\bgrant\b/i.test(line)) assert.doesNotMatch(line, /\b(anon|service_role|public)\b(?!\.)/i, line.trim());
  }
  const tables = [...sql.matchAll(/create table (carscope_account\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ['carscope_account.profiles', 'carscope_account.vehicles', 'carscope_account.vehicle_inspection_links']);
  for (const t of tables) assert.match(sql, new RegExp(`alter table ${t.replace('.', '\\.')} enable row level security`), t);
  for (const m of sql.matchAll(/create policy[\s\S]*?;/g)) assert.match(m[0], /\bto authenticated\b/, m[0]);
  assert.match(sql, /for update to authenticated using \(\(select auth\.uid\(\)\) = owner_id\) with check \(\(select auth\.uid\(\)\) = owner_id\)/);
  assert.match(sql, /record_namespace text not null check \(record_namespace = 'VERIFIED_VEHICLE'\)/);
});

test('local Supabase config: secrets only by env() substitution, signing key in the ignored folder, Google off', () => {
  const toml = read(`${PKG}/supabase/config.toml`);
  assert.match(toml, /secret = "env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET\)"/);
  assert.doesNotMatch(toml, /secret = "(?!env\()[^"]+"/);
  assert.match(toml, /\[auth\.external\.google\]\r?\nenabled = false/);
  assert.match(toml, /signing_keys_path = "\.\/\.temp\/signing_keys\.json"/);
  assert.match(read(`${PKG}/supabase/.gitignore`), /^\.temp\r?$/m);
});

test('git tracks no key file, env file or captured session from this package', () => {
  const tracked = execFileSync('git', ['ls-files', PKG], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of tracked) assert.doesNotMatch(f, /signing_keys|\.env|\.pem$|\.key$|\.temp\/|storage-state|evidence/i, f);
});
