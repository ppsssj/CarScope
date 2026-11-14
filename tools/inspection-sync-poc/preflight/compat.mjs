// Debug APK <-> server compatibility of the session-creation response.
// The decoder policy is read from the Kotlin source so it cannot drift from a hand-written model. The real Kotlin
// decoders are also executed by run-decoder-probe.mjs; this module is the fast, Android-free view of the same matrix.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { check } from './report.mjs';
import { REPO_ROOT, TOOL_ROOT, serverClockGate } from './static-gates.mjs';
import { SessionService } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';

export const DECODER_PATH = 'app/src/inspection/java/io/carscope/app/sync/SyncHttpDecoder.kt';
/** Where the decoder lived at LEGACY_DECODER_REV (before the Release submission shared it). */
export const LEGACY_DECODER_PATH = 'app/src/debug/java/io/carscope/app/sync/SyncHttpDecoder.kt';
/** Last main commit with the exact six-key decoder: the parent side of PR #76. */
export const LEGACY_DECODER_REV = '2435087';
const LEGACY_SNAPSHOT = 'preflight/legacy-decoder-created-2435087.kt.txt';

/** Extracts `fun created` and the keys its exact() call requires or conditionally allows. */
export function decoderPolicy(source) {
  const start = source.indexOf('fun created(');
  const end = source.indexOf('fun view(', start);
  if (start < 0 || end < 0) throw new Error('DECODER_FUNCTION_NOT_FOUND');
  const body = source.slice(start, end);
  const exactLine = /exact\(x, (.+)\)\s*$/m.exec(body)?.[1];
  if (!exactLine) throw new Error('DECODER_POLICY_NOT_FOUND');
  const optional = [...exactLine.matchAll(/x\.containsKey\("(\w+)"\)/g)].map((m) => m[1]);
  const required = [...exactLine.replace(/if \(x\.containsKey.*$/, '').matchAll(/"(\w+)"/g)].map((m) => m[1]);
  return { required, optional, serverNowBelowInvite: /number\(x\["serverNow"\]\)\.also \{ if \(it >= inviteExpiry\) invalid\(\) \}/.test(body) };
}

export function decoderAccepts(policy, response) {
  const keys = Object.keys(response);
  if (policy.required.some((k) => !keys.includes(k))) return false;
  if (keys.some((k) => !policy.required.includes(k) && !policy.optional.includes(k))) return false;
  if (!keys.includes('serverNow')) return true;
  const t = response.serverNow;
  return Number.isSafeInteger(t) && t >= 0 && (!policy.serverNowBelowInvite || t < response.inviteExpiresAt);
}

export const legacyDecoderSource = () => readFileSync(resolve(TOOL_ROOT, LEGACY_SNAPSHOT), 'utf8');
export const currentDecoderSource = () => readFileSync(resolve(REPO_ROOT, DECODER_PATH), 'utf8');

/** The committed snapshot must equal history; a shallow clone cannot check that and says so. */
export function legacySnapshotGate(root = REPO_ROOT) {
  let historic;
  try {
    historic = execFileSync('git', ['show', `${LEGACY_DECODER_REV}:${LEGACY_DECODER_PATH}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return check('LEGACY_DECODER_SNAPSHOT', 'NOT_RUN', `git history for ${LEGACY_DECODER_REV} is unavailable (shallow clone?)`);
  }
  const normal = (x) => x.replaceAll('\r\n', '\n').trim();
  return normal(historic).includes(normal(legacyDecoderSource()))
    ? check('LEGACY_DECODER_SNAPSHOT', 'PASS', `snapshot is verbatim from ${LEGACY_DECODER_REV}`)
    : check('LEGACY_DECODER_SNAPSHOT', 'FAIL', `snapshot differs from ${LEGACY_DECODER_REV}`);
}

/**
 * Both server generations are derived from the actual response of this tree. Whichever generation the tree does not
 * implement is produced by adding or removing the single field, and is labelled so in `provenance`.
 */
export async function serverGenerations(service = new SessionService({ store: new MemorySessionStore() })) {
  const actual = await service.create({ taskId: 'washer-fluid' });
  const has = Object.hasOwn(actual, 'serverNow');
  const { serverNow, ...withoutClock } = actual;
  return {
    oldServer: { response: withoutClock, provenance: has ? 'DERIVED_FIELD_REMOVED' : 'ACTUAL_THIS_TREE' },
    newServer: { response: has ? actual : { ...withoutClock, serverNow: withoutClock.inviteExpiresAt - 1 }, provenance: has ? 'ACTUAL_THIS_TREE' : 'DERIVED_FIELD_ADDED_PR78_CONTRACT' },
  };
}

/**
 * Per combination: can a session be created, and can a real ACCEPTED reach 3D.
 * Old decoders have no bridge at all, so 3D is UNSUPPORTED for them regardless of the server.
 */
export async function compatibilityMatrix({ legacy = legacyDecoderSource(), current = currentDecoderSource(), service } = {}) {
  const decoders = { oldDecoder: decoderPolicy(legacy), newDecoder: decoderPolicy(current) };
  const servers = await serverGenerations(service);
  const rows = [];
  for (const [decoder, policy] of Object.entries(decoders))
    for (const [server, { response, provenance }] of Object.entries(servers)) {
      const accepted = decoderAccepts(policy, response);
      const clock = decoder === 'newDecoder' && server === 'newServer' && accepted;
      rows.push({
        decoder, server, provenance,
        nativeSession: accepted ? 'PASS' : 'FAIL',
        native3d: !accepted || decoder === 'oldDecoder' || !clock ? 'UNSUPPORTED' : 'PASS',
        reason: !accepted ? 'INVALID: creation response rejected' : clock ? 'clock available; device E2E still NOT_RUN' : decoder === 'newDecoder' ? 'SERVER_CLOCK_UNAVAILABLE: standalone Native only' : 'no 3D bridge in this APK',
      });
    }
  return rows;
}

const EXPECTED = {
  'oldDecoder/oldServer': ['PASS', 'UNSUPPORTED'],
  'oldDecoder/newServer': ['FAIL', 'UNSUPPORTED'],
  'newDecoder/oldServer': ['PASS', 'UNSUPPORTED'],
  'newDecoder/newServer': ['PASS', 'PASS'],
};

export function matrixGate(rows) {
  const wrong = rows.filter((r) => EXPECTED[`${r.decoder}/${r.server}`]?.join() !== [r.nativeSession, r.native3d].join());
  return wrong.length
    ? check('DECODER_SERVER_MATRIX', 'FAIL', 'deployment order no longer safe: ' + wrong.map((r) => `${r.decoder}/${r.server}=${r.nativeSession}`).join(', '), { rows })
    : check('DECODER_SERVER_MATRIX', 'PASS', 'install the new-decoder APK first, then deploy the serverNow server', { rows });
}

// ----- installed-APK classification -----

const u16 = (b, at) => b.readUInt16LE(at), u32 = (b, at) => b.readUInt32LE(at);
const MAX_DEX_BYTES = 512 * 1024 * 1024;

export function* dexEntries(apk) {
  let eocd = -1;
  for (let i = apk.length - 22; i >= Math.max(0, apk.length - 65557); i--) if (u32(apk, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('NOT_A_ZIP');
  const count = u16(apk, eocd + 10);
  let at = u32(apk, eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64_UNSUPPORTED');
  for (let n = 0; n < count; n++) {
    if (u32(apk, at) !== 0x02014b50) throw new Error('BAD_ZIP_DIRECTORY');
    const method = u16(apk, at + 10), compressed = u32(apk, at + 20), nameLength = u16(apk, at + 28), extra = u16(apk, at + 30), comment = u16(apk, at + 32), local = u32(apk, at + 42);
    const name = apk.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (!/^classes\d*\.dex$/.test(name)) continue;
    const start = local + 30 + u16(apk, local + 26) + u16(apk, local + 28), raw = apk.subarray(start, start + compressed);
    if (method === 0) yield raw;
    else if (method === 8) yield inflateRawSync(raw, { maxOutputLength: MAX_DEX_BYTES });
    else throw new Error('UNSUPPORTED_ZIP_METHOD');
  }
}

/**
 * Classifies by DEX string constants, not by running the decoder: the decoder class plus the serverNow literal.
 * This identifies the generation of a build; it does not prove the build was installed on any device.
 */
export function classifyApk(apk) {
  let decoder = false, clock = false, dex = 0;
  for (const entry of dexEntries(apk)) {
    dex++;
    decoder ||= entry.includes('io/carscope/app/sync/SyncHttpDecoder;');
    clock ||= entry.includes('serverNow');
  }
  const generation = !dex ? 'NOT_AN_APP' : !decoder ? 'NO_SYNC_DECODER' : clock ? 'NEW_DECODER' : 'LEGACY_DECODER';
  return { sha256: createHash('sha256').update(apk).digest('hex'), bytes: apk.length, dexFiles: dex, generation };
}

export function apkGate(path) {
  if (!path) return check('APK_GENERATION', 'NOT_VERIFIED', 'no --apk given: the APK to install is unidentified');
  let info;
  try {
    info = classifyApk(readFileSync(path));
  } catch (error) {
    return check('APK_GENERATION', 'FAIL', 'cannot read APK: ' + (/^[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : error?.code ?? 'UNEXPECTED'));
  }
  const detail = `${info.generation} sha256=${info.sha256}`;
  return check('APK_GENERATION', info.generation === 'NEW_DECODER' ? 'PASS' : 'FAIL', detail + (info.generation === 'NEW_DECODER' ? ' safe before the serverNow deploy' : ' do not use with a serverNow server'), { apk: info });
}

export async function runCompatGates({ apk } = {}) {
  const rows = await compatibilityMatrix();
  return [legacySnapshotGate(), matrixGate(rows), await serverClockGate(), apkGate(apk)];
}
