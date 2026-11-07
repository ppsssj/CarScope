// P12-C: the preliminary report for one model run. Formal metrics stay with scripts/evaluate.mjs and DATASET_GATE.
//   node scripts/exploratory-evaluate.mjs <manifest.json> <results.json> [--threshold 0.5]
import { readFile } from 'node:fs/promises';
import { UNCALIBRATED_SCORE_THRESHOLD } from '../src/detection-contract.mjs';
import { EVALUATION_TYPE, EXPLORATORY_STATUS, buildExploratoryReport } from '../src/exploratory.mjs';

const args = process.argv.slice(2), at = args.indexOf('--threshold');
const threshold = at >= 0 ? Number(args[at + 1]) : UNCALIBRATED_SCORE_THRESHOLD;
const [manifestPath, resultsPath] = args.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
if (!manifestPath || !resultsPath) { console.error('Usage: exploratory-evaluate.mjs <manifest.json> <results.json> [--threshold 0.5]'); process.exit(64); }
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let results;
try { results = JSON.parse(await readFile(resultsPath, 'utf8')); }
catch { console.log(JSON.stringify({ evaluationType: EVALUATION_TYPE, status: EXPLORATORY_STATUS.NOT_RUN, metrics: 'NOT_MEASURED', reason: 'No model results exist.' }, null, 2)); process.exit(2); }
let report;
try { report = buildExploratoryReport({ manifest, modelId: results.modelId, predictions: results.results, scoreThreshold: threshold }); }
catch (error) { console.log(JSON.stringify({ evaluationType: EVALUATION_TYPE, status: EXPLORATORY_STATUS.NOT_RUN, metrics: 'NOT_MEASURED', reason: error.message }, null, 2)); process.exit(2); }
console.log(JSON.stringify({ ...report, endpoint: results.endpoint }, null, 2));
if (report.status !== EXPLORATORY_STATUS.READY) process.exitCode = 2;
