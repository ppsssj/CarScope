// P12-B: prints what the dataset allows us to report. Exit 0 only for DATASET_READY.
//   node scripts/dataset-status.mjs [manifest.json] [--root <dataset folder>]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_STATUS, fileErrors, validateDataset } from '../src/dataset.mjs';
import { notMeasuredReport } from '../src/evaluate.mjs';

const args = process.argv.slice(2), rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? args[rootAt + 1] : null;
const manifestPath = args.find((a, i) => !a.startsWith('--') && (rootAt < 0 || i !== rootAt + 1)) ?? fileURLToPath(new URL('../dataset/manifest.json', import.meta.url));
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'));
const result = validateDataset(manifest);
if (root) {
  const missing = await fileErrors(manifest, root);
  if (missing.length) { result.errors.push(...missing); result.status = DATASET_STATUS.INVALID; }
} else if (result.status === DATASET_STATUS.READY) {
  result.errors.push('--root is required: a ready dataset must be checked against its files');
  result.status = DATASET_STATUS.INVALID;
}
console.log(JSON.stringify({ ...result, report: result.status === DATASET_STATUS.READY ? null : notMeasuredReport(result.status) }, null, 2));
process.exitCode = result.status === DATASET_STATUS.READY ? 0 : 2;
