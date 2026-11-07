// P12-F: real hosted calls for dataset/p12-f-bonnet-parts.json. A photo with a stored answer is not sent again, and the shared ledger caps the total.
//   node scripts/part-eval-infer.mjs <manifest.json> <P12C image folder> <P12C results.json> <P12F image folder> <run folder> [--dry-run]
// The key comes from the file named by ROBOFLOW_API_KEY_FILE, kept outside the repository. Results hold no key and no request.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCallLedger, ledgeredFetch } from '../src/call-ledger.mjs';
import { parseRoboflowResponse, ROBOFLOW_MODEL_ID } from '../src/roboflow-adapter.mjs';
import { CALL_STATUS, inferImage, stopsTheRun } from '../src/roboflow-client.mjs';

const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const [manifestPath, p12cImages, p12cResults, p12fImages, run] = args.filter(a => !a.startsWith('--'));
if (!run) { console.error('Usage: part-eval-infer.mjs <manifest> <P12C images> <P12C results> <P12F images> <run folder> [--dry-run]'); process.exit(64); }
const repository = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase() + path.sep;
const keyFile = process.env.ROBOFLOW_API_KEY_FILE;
if (!dryRun && (!keyFile || path.resolve(keyFile).toLowerCase().startsWith(repository))) { console.log(JSON.stringify({ status: CALL_STATUS.BLOCKED_API_KEY_REQUIRED, calls: 0 })); process.exit(3); }

mkdirSync(path.join(run, 'cache'), { recursive: true });
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const ledger = createCallLedger({ file: path.join(path.dirname(path.resolve(run)), 'calls.json') });
const stored = JSON.parse(readFileSync(p12cResults, 'utf8')).results;
const apiKey = dryRun ? null : readFileSync(keyFile, 'utf8').trim();

const rows = [], answers = {};
for (const image of manifest.images) {
  const file = path.resolve(image.root === 'P12C' ? p12cImages : p12fImages, image.file), bytes = readFileSync(file);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== image.sha256) { console.log(JSON.stringify({ status: 'PHOTO_CHANGED', id: image.id })); process.exit(2); }
  const cache = path.join(run, 'cache', `${sha}.json`);
  if (image.inference === 'CACHED_P12C_RUN2') { answers[image.id] = stored[image.id].raw; rows.push({ id: image.id, source: 'P12C_RUN2', imageBytes: bytes.length, roundTripMs: stored[image.id].ms }); continue; }
  if (existsSync(cache)) { const saved = JSON.parse(readFileSync(cache, 'utf8')); answers[image.id] = saved.body; rows.push({ id: image.id, source: 'CACHE', ...saved.timing }); continue; }
  if (dryRun) { rows.push({ id: image.id, source: 'WOULD_CALL', imageBytes: bytes.length }); continue; }
  const started = performance.now();
  const answer = await inferImage({ modelId: ROBOFLOW_MODEL_ID, apiKey, image: bytes, fetchImpl: ledgeredFetch({ ledger, purpose: `eval:${image.id}` }), timeoutMs: 30000 });
  const roundTripMs = Math.round(performance.now() - started);
  if (answer.status !== CALL_STATUS.OK) {
    rows.push({ id: image.id, source: 'FAILED', status: answer.status, httpStatus: answer.httpStatus, error: answer.error });
    if (stopsTheRun(answer.status)) break;
    continue;
  }
  const parseStart = performance.now();
  parseRoboflowResponse(answer.body);
  const timing = { imageBytes: bytes.length, base64Bytes: Math.ceil(bytes.length / 3) * 4, responseBytes: Buffer.byteLength(JSON.stringify(answer.body)), roundTripMs, parseMs: Number((performance.now() - parseStart).toFixed(2)) };
  writeFileSync(cache, JSON.stringify({ body: answer.body, timing }));
  answers[image.id] = answer.body;
  rows.push({ id: image.id, source: 'REAL_CALL', ...timing });
}
writeFileSync(path.join(run, 'answers.json'), JSON.stringify({ modelId: ROBOFLOW_MODEL_ID, answers }));
writeFileSync(path.join(run, 'calls-this-run.json'), JSON.stringify(rows, null, 1));
const failed = rows.filter(r => r.source === 'FAILED');
console.log(JSON.stringify({ status: failed.length ? CALL_STATUS.FAILED : CALL_STATUS.OK, dryRun, ledgerCount: ledger.count, sources: rows.reduce((all, r) => ({ ...all, [r.source]: (all[r.source] ?? 0) + 1 }), {}), failed }, null, 1));
process.exit(failed.length ? 1 : 0);
