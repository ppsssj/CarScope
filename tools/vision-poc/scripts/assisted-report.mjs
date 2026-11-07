// Saved answers only. No inference client, ledger mutation or human review write.
import { DEFAULT_PATHS, loadEvaluationSet } from '../review/review-data.mjs';
import { DEFAULT_ASSISTED, loadAssisted } from '../review/assisted-data.mjs';
import { compareAssisted } from '../review/assisted-model.mjs';
import { predictionsOf, REVIEW_PARTS } from '../review/review-model.mjs';
const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? fallback : process.argv[at + 1]; };
const set = loadEvaluationSet({ p12cResults: DEFAULT_PATHS.p12cResults });
const assisted = loadAssisted(option('assisted', DEFAULT_ASSISTED), set.images);
if (set.status !== 'READY' || assisted.status !== 'READY') { console.error(JSON.stringify({ status: 'BLOCKED', problems: [...set.problems, ...assisted.problems] })); process.exitCode = 2; }
else {
  const rows = assisted.images.map(row => ({ id: row.id, dataset: row.dataset, parts: row.parts, comparison: row.dataset === 'P12F' ? compareAssisted(row, predictionsOf(set.answers[row.id])) : { status: 'NOT_RUN', reason: 'NO_STORED_INFERENCE' } }));
  const sets = Object.fromEntries(['P12F', 'IONIQ5_REFERENCE'].map(dataset => {
    const images = rows.filter(row => row.dataset === dataset), categories = {};
    for (const row of images) for (const item of row.comparison.results ?? []) categories[item.category] = (categories[item.category] ?? 0) + 1;
    return [dataset, { images: images.length, boxes: images.reduce((n, r) => n + Object.values(r.parts).reduce((n, p) => n + p.boxes.length + p.caps.length, 0), 0), parts: Object.fromEntries(REVIEW_PARTS.map(({ key }) => [key, images.reduce((counts, row) => { const status = row.parts[key].status; counts[status] = (counts[status] ?? 0) + 1; return counts; }, {})])), categories }];
  }));
  console.log(JSON.stringify({ status: 'PROVISIONAL_AI_ASSISTED', humanReviewed: false, limitation: 'Candidate overlap counts only. No precision/recall; incomplete and uncertain candidates are not ground truth. Geometry estimated from visible pixels; not exhaustive instance coverage.', sets, images: rows }, null, 2));
}
