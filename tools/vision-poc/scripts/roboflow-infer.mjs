// P12-C: runs engine-bay-parts/1 on the images of an exploratory manifest and stores what came back. Exit 0 only if every image was answered.
//   node scripts/roboflow-infer.mjs <manifest.json> <image folder> <results.json> [--api-url http://127.0.0.1:9001] [--max-calls 100]
// The key comes from ROBOFLOW_API_KEY or from the file named by ROBOFLOW_API_KEY_FILE. Keep that file outside the repository.
// The hosted API sends each image to Roboflow. Photos under OWNER_CONSENT go only with license.hostedInferenceConsent.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLORATORY_STATUS, validateExploratorySet } from '../src/exploratory.mjs';
import { ROBOFLOW_MODEL_ID, interpretRoboflow, otherClasses, parseRoboflowResponse } from '../src/roboflow-adapter.mjs';
import { CALL_STATUS, HOSTED_API_URL, REQUEST_CONFIDENCE, inferImage, stopsTheRun } from '../src/roboflow-client.mjs';
import { fileErrors } from '../src/dataset.mjs';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const [manifestPath, root, outPath] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const finish = (status, extra = {}, code = 3) => { console.log(JSON.stringify({ status, model: ROBOFLOW_MODEL_ID, ...extra }, null, 2)); process.exit(code); };
if (!manifestPath || !root || !outPath) { console.error('Usage: roboflow-infer.mjs <manifest.json> <image folder> <results.json> [--api-url URL] [--max-calls N]'); process.exit(64); }

const repository = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase() + path.sep;
async function loadKey() {
  if (process.env.ROBOFLOW_API_KEY) return process.env.ROBOFLOW_API_KEY.trim();
  const file = process.env.ROBOFLOW_API_KEY_FILE;
  if (!file) return null;
  if (path.resolve(file).toLowerCase().startsWith(repository)) finish('KEY_FILE_INSIDE_REPOSITORY', {}, 64);
  return (await readFile(file, 'utf8')).trim() || null;
}

const apiKey = await loadKey();
if (!apiKey) finish(CALL_STATUS.BLOCKED_API_KEY_REQUIRED, { calls: 0, reason: 'Roboflow answers 401 without a key, for hosted and for self-hosted Universe models.' });
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const set = validateExploratorySet(manifest), missing = await fileErrors(manifest, root);
if (set.status !== EXPLORATORY_STATUS.READY || missing.length) finish(set.status === EXPLORATORY_STATUS.READY ? EXPLORATORY_STATUS.INVALID : set.status, { calls: 0, errors: [...set.errors, ...missing] }, 2);

const apiUrl = option('--api-url') ?? HOSTED_API_URL, maxCalls = Number(option('--max-calls') ?? 100), hosted = apiUrl === HOSTED_API_URL;
if (manifest.images.length > maxCalls) finish('TOO_MANY_CALLS', { calls: 0, images: manifest.images.length, maxCalls }, 2);
if (hosted) {
  const refused = manifest.images.filter(i => i.license.id === 'OWNER_CONSENT' && i.license.hostedInferenceConsent !== true).map(i => i.id);
  if (refused.length) finish('HOSTED_UPLOAD_NOT_CONSENTED', { calls: 0, images: refused }, 2);
}

const results = {}, failures = [];
let calls = 0, stopped = null;
for (const image of manifest.images) {
  calls++;
  const started = performance.now();
  const answer = await inferImage({ apiUrl, modelId: ROBOFLOW_MODEL_ID, apiKey, image: await readFile(path.resolve(root, image.file)) });
  const ms = Math.round(performance.now() - started);
  if (answer.status !== CALL_STATUS.OK) {
    failures.push({ id: image.id, status: answer.status, httpStatus: answer.httpStatus, error: answer.error });
    if (stopsTheRun(answer.status)) { stopped = answer.status; break; } // Do not spend more calls on a refusal.
    continue;
  }
  try {
    const parsed = parseRoboflowResponse(answer.body), mapped = interpretRoboflow(parsed, { scoreThreshold: 0 });
    results[image.id] = { candidates: mapped.candidates.map(({ box, score }) => ({ box, score })), others: otherClasses(parsed), ms, raw: answer.body };
  } catch (error) { failures.push({ id: image.id, status: CALL_STATUS.FAILED, error: error.message }); }
}
const output = { modelId: ROBOFLOW_MODEL_ID, endpoint: hosted ? 'HOSTED' : 'SELF_HOSTED', requestConfidence: REQUEST_CONFIDENCE, calls, answered: Object.keys(results).length, failures, results };
await writeFile(outPath, JSON.stringify(output, null, 1));
const complete = !failures.length && output.answered === manifest.images.length;
finish(stopped ?? (complete ? CALL_STATUS.OK : CALL_STATUS.FAILED), { endpoint: output.endpoint, calls, answered: output.answered, failures }, complete ? 0 : stopped ? 3 : 1);
