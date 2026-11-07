// P12-B: evaluates one prediction file on the test split. Refuses to print a number unless the dataset gate passes.
//   node scripts/evaluate.mjs <manifest.json> <dataset folder> <predictions.json>
//   predictions.json: { "source": "...", "sourceSha256": "...", "predictions": { "<imageId>": [{ "box": [x, y, w, h], "score": 0.9 }] } }
import { readFile } from 'node:fs/promises';
import { DATASET_STATUS, fileErrors, validateDataset } from '../src/dataset.mjs';
import { evaluate, notMeasuredReport } from '../src/evaluate.mjs';

const [manifestPath, root, predictionsPath] = process.argv.slice(2);
if (!manifestPath || !root || !predictionsPath) { console.error('Usage: evaluate.mjs <manifest.json> <dataset folder> <predictions.json>'); process.exit(64); }
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const gate = validateDataset(manifest);
const missing = await fileErrors(manifest, root);
const status = missing.length ? DATASET_STATUS.INVALID : gate.status;
if (status !== DATASET_STATUS.READY) {
  console.log(JSON.stringify({ ...notMeasuredReport(status), shortfalls: gate.shortfalls, errors: [...gate.errors, ...missing] }, null, 2));
  process.exit(2);
}
const { source, sourceSha256, predictions } = JSON.parse(await readFile(predictionsPath, 'utf8'));
if (!source || !sourceSha256) { console.error('Predictions must name their source and its sha256'); process.exit(64); }
const test = manifest.images.filter(image => image.split === 'test');
const inTest = Object.fromEntries(test.map(image => [image.id, predictions[image.id]]));
console.log(JSON.stringify({ status, source, sourceSha256, split: 'test', ...evaluate({ images: test, predictions: inTest }) }, null, 2));
