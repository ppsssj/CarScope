// P12-C: what the results would be if a second source class were the same part. An analysis only: the adapter's single mapping is unchanged.
//   node scripts/exploratory-alias-analysis.mjs <manifest.json> <results.json> --alias 3 [--threshold 0.5]
import { readFile } from 'node:fs/promises';
import { UNCALIBRATED_SCORE_THRESHOLD } from '../src/detection-contract.mjs';
import { withAliasCandidates } from '../src/exploratory-alias.mjs';
import { buildExploratoryReport } from '../src/exploratory.mjs';

const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const [manifestPath, resultsPath] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const alias = option('--alias'), threshold = Number(option('--threshold') ?? UNCALIBRATED_SCORE_THRESHOLD);
if (!manifestPath || !resultsPath || !alias) { console.error('Usage: exploratory-alias-analysis.mjs <manifest.json> <results.json> --alias <class> [--threshold 0.5]'); process.exit(64); }
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), results = JSON.parse(await readFile(resultsPath, 'utf8'));
const report = buildExploratoryReport({ manifest, modelId: results.modelId, predictions: withAliasCandidates(results.results, alias), scoreThreshold: threshold });
console.log(JSON.stringify({ analysis: 'ALIAS_SENSITIVITY_NOT_THE_REPORTED_RESULT', alias, ...report }, null, 2));
