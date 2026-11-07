// P12-G: checks the photos and stored answers, then reports against finished reviews only. Calls no model and reads no key.
//   node scripts/review-report.mjs [--review <file>] [--out <report.json>]
// Exit 0 when the data checks out (a pending review is a normal state). Exit 2 when something is missing: BLOCKED.
import { writeFileSync } from 'node:fs';
import { DEFAULT_PATHS, loadEvaluationSet, loadReviewFile } from '../review/review-data.mjs';
import { evaluateReview } from '../review/review-evaluate.mjs';

const option = name => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
const set = loadEvaluationSet({ p12cResults: DEFAULT_PATHS.p12cResults });
const tally = field => set.report.reduce((all, row) => ({ ...all, [row[field]]: (all[row[field]] ?? 0) + 1 }), {});
console.log(JSON.stringify({ status: set.status, images: set.images.length, file: tally('file'), sha256: tally('sha256'), answer: tally('answer'), predictions: set.report.reduce((sum, row) => sum + row.predictions, 0), withoutLicenseOrSource: set.report.filter(row => !row.license || !row.source).length, labelsReviewedByPerson: set.manifest.labelsReviewedByPerson, sourceLabelsSha256: set.sourceLabelsSha256, problems: set.problems }, null, 1));
if (set.status !== 'READY') process.exit(2);

const review = loadReviewFile(option('review') ?? DEFAULT_PATHS.review, { images: set.images, sourceLabelsSha256: set.sourceLabelsSha256 });
const result = evaluateReview({ images: set.images, answers: set.answers, review });
const line = (name, kind, m) => console.log(`${name.padEnd(8)} ${kind.padEnd(20)} TP=${String(m.tp).padEnd(3)} FP=${String(m.fp).padEnd(3)} FN=${String(m.fn).padEnd(3)} P=${m.precision} R=${m.recall} F1=${m.f1} IoU(median)=${m.iouMedian}`);
console.log(`reviewState=${result.reviewState} metricState=${result.metricState} reviewed=${result.progress.reviewed}/${result.progress.total} changedParts=${result.changedParts} reviewers=${JSON.stringify(result.reviewers)}`);
for (const [key, entry] of Object.entries(result.parts)) {
  if (entry.reviewed === 'NO_MODEL_CLASS') { console.log(`${key.padEnd(8)} NO_MODEL_CLASS`); continue; }
  line(key, 'P12-F draft, all', entry.p12fDraftAllPhotos);
  if (typeof entry.reviewed === 'object') { line(key, 'P12-F draft, same', entry.p12fDraftSamePairs); line(key, `reviewed ${result.metricState}`, entry.reviewed); } else console.log(`${key.padEnd(8)} reviewed: ${entry.reviewed}`);
}
if (option('out')) writeFileSync(option('out'), JSON.stringify(result, null, 1));
