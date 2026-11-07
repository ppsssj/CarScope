// P12-G: loads and checks what a review stands on: the label file, the photos by hash and the stored model answers. Read-only. Any gap is BLOCKED: nothing is filled in.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEW_SCHEMA, reviewFileProblems } from './review-model.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Git may check the label file out with other line endings. That must not look like a changed file. */
export const labelsHash = text => sha256(text.replace(/\r\n/g, '\n'));

export const DEFAULT_PATHS = Object.freeze({
  labels: new URL('../dataset/p12-f-bonnet-parts.json', import.meta.url),
  answers: 'C:/CarScope-External/p12-f/run1/answers.json',
  roots: Object.freeze({ P12C: 'C:/CarScope-External/p12-c/exploratory', P12F: 'C:/CarScope-External/p12-f/eval' }),
  p12cResults: 'C:/CarScope-External/p12-c/run2/results.json',
  review: 'C:/CarScope-External/p12-g/label-review.json',
});

const jpegOrPng = bytes => (bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : null);
const predictionProblem = p => !p || typeof p.class !== 'string' || ![p.x, p.y, p.width, p.height, p.confidence].every(Number.isFinite) || p.confidence < 0 || p.confidence > 1 || p.width <= 0 || p.height <= 0;

export function loadEvaluationSet({ labels = DEFAULT_PATHS.labels, answers = DEFAULT_PATHS.answers, roots = DEFAULT_PATHS.roots, p12cResults } = {}) {
  const problems = [], files = new Map();
  const text = readFileSync(labels, 'utf8');
  const manifest = JSON.parse(text);
  let stored = {};
  if (!existsSync(answers)) problems.push('STORED_ANSWERS_MISSING');
  else stored = JSON.parse(readFileSync(answers, 'utf8')).answers ?? {};
  const earlier = p12cResults && existsSync(p12cResults) ? JSON.parse(readFileSync(p12cResults, 'utf8')).results : null;
  const report = [];
  for (const image of manifest.images) {
    const row = { id: image.id, file: 'MISSING', sha256: 'NOT_CHECKED', answer: 'MISSING', predictions: 0, license: image.license ?? null, source: image.source ?? null, attribution: image.attribution ?? null };
    report.push(row);
    if (!image.license || !image.source) problems.push(`${image.id}: license or source missing`);
    const root = roots[image.root], file = root ? path.resolve(root, path.basename(image.file)) : null;
    if (!file || !existsSync(file)) { problems.push(`${image.id}: photo missing`); } else {
      const bytes = readFileSync(file), type = jpegOrPng(bytes);
      row.file = 'FOUND';
      row.sha256 = sha256(bytes) === image.sha256 ? 'MATCH' : 'MISMATCH';
      if (row.sha256 !== 'MATCH') problems.push(`${image.id}: photo hash differs`);
      else if (!type) problems.push(`${image.id}: not a JPEG or PNG`);
      else files.set(image.id, { file, type });
    }
    const answer = stored[image.id];
    if (!answer || !Array.isArray(answer.predictions) || !(answer.image?.width > 0) || !(answer.image?.height > 0) || answer.predictions.some(predictionProblem)) { problems.push(`${image.id}: stored answer missing or damaged`); continue; }
    row.answer = 'VALID'; row.predictions = answer.predictions.length;
    // Reuse must mean the same answer P12-C stored, not one rebuilt since.
    if (image.root === 'P12C' && earlier && JSON.stringify(earlier[image.id]?.raw) !== JSON.stringify(answer)) { row.answer = 'DIFFERS_FROM_P12C'; problems.push(`${image.id}: differs from the P12-C stored answer`); }
  }
  return { manifest, images: manifest.images, answers: stored, files, report, problems, sourceLabelsSha256: labelsHash(text), status: problems.length ? 'BLOCKED' : 'READY' };
}

export const newReviewFile = ({ sourceLabelsSha256, synthetic }) => ({ schema: REVIEW_SCHEMA, synthetic, sourceLabelsSha256, images: {} });

/** A file that breaks a rule is refused, and left as it is for a person to look at. */
export function loadReviewFile(file, { images, sourceLabelsSha256, synthetic = false }) {
  if (!existsSync(file)) return newReviewFile({ sourceLabelsSha256, synthetic });
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('REVIEW_FILE_INVALID: not JSON'); }
  const problems = reviewFileProblems(parsed, images);
  if (problems.length) throw new Error(`REVIEW_FILE_INVALID: ${problems.slice(0, 5).join('; ')}`);
  if (parsed.synthetic !== synthetic) throw new Error(synthetic ? 'REVIEW_FILE_INVALID: a test must not open a real review' : 'REVIEW_FILE_INVALID: a synthetic test file is not a review');
  return parsed;
}
