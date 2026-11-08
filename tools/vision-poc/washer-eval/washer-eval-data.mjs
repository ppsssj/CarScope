// P13-B: what the washer evaluation stands on, checked. Photos by hash and stored real answers come from the P12-G loader (BLOCKED on any gap).
// Regions are the stored real detections, or a box from a completed P12-G human review. Nothing is filled in, and no fixture is a region.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatesFor } from '../../mobile-ar-poc/public/part-detection.mjs';
import { parseRoboflowResponse } from '../src/roboflow-adapter.mjs';
import { DEFAULT_PATHS, loadEvaluationSet, sha256 } from '../review/review-data.mjs';
import { detectionRegions, TRUTH_SCHEMA, truthFileProblems } from './washer-eval-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = path.resolve(here, '../../..').toLowerCase() + path.sep;
export const WASHER_PATHS = Object.freeze({
  manifest: new URL('../dataset/p13-b-washer-eval.json', import.meta.url),
  truth: 'C:/CarScope-External/p13-b/washer-truth.json',
  prepared: 'C:/CarScope-External/p13-b/prepared',
  runs: 'C:/CarScope-External/p13-b/runs',
  approval: 'C:/CarScope-External/p13-b/approval.json',
  p12gReview: DEFAULT_PATHS.review,
});

/** Every file this evaluation writes lives outside the repository, and nothing runs on Render. */
export function assertOutside(file, env = process.env) {
  if (env.RENDER) throw new Error('LOCAL_TOOL_ONLY');
  const resolved = path.resolve(String(file));
  if (resolved.toLowerCase().startsWith(REPOSITORY)) throw new Error('PATH_INSIDE_REPOSITORY');
  return resolved;
}

/** Washer boxes from completed P12-G human reviews: a person drew them, so they may be offered as a region. Drafts never are. */
export function p12gWasherBoxes(file, images) {
  if (!file || !existsSync(file)) return {};
  const review = JSON.parse(readFileSync(file, 'utf8'));
  if (review.synthetic !== false) return {};
  const out = {};
  for (const image of images) {
    const record = review.images?.[image.id], washer = record?.parts?.washer;
    if (!record?.complete || record.imageSha256 !== image.sha256 || washer?.status !== 'PRESENT') continue;
    out[image.id] = { reviewer: record.reviewer, completedAt: record.completedAt, boxes: [...(washer.caps ?? []), ...(washer.boxes ?? [])] };
  }
  return out;
}

/**
 * The evaluation set: the committed manifest's photos, each with its file, stored answer and regions.
 * @returns {{ status: 'READY'|'BLOCKED', problems, images, files, detections, humanBoxes, manifest }}
 */
export function loadWasherSet({ manifest = WASHER_PATHS.manifest, data = {}, p12gReview = WASHER_PATHS.p12gReview } = {}) {
  const set = loadEvaluationSet(data);
  const problems = [...set.problems];
  const listed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (listed.sourceLabelsSha256 !== set.sourceLabelsSha256) problems.push('manifest was built from other P12-F labels');
  const byId = new Map(set.images.map(image => [image.id, image]));
  const images = [];
  for (const row of listed.images) {
    const image = byId.get(row.id);
    if (!image || image.sha256 !== row.sha256) { problems.push(`${row.id}: not the photo the manifest names`); continue; }
    images.push(image);
  }
  if (set.answers && existsSync(String(data.answers ?? DEFAULT_PATHS.answers)) && listed.answersSha256 !== sha256(readFileSync(data.answers ?? DEFAULT_PATHS.answers))) problems.push('stored answers differ from the manifest');
  const detections = Object.fromEntries(images.map(image => [image.id, detectionRegions(set.answers[image.id], candidatesFor, parseRoboflowResponse)]));
  return { status: problems.length ? 'BLOCKED' : 'READY', problems, images, files: set.files, answers: set.answers, detections, humanBoxes: p12gWasherBoxes(p12gReview, images), manifest: listed };
}

export const newTruthFile = ({ synthetic, manifestSha256 }) => ({ schema: TRUTH_SCHEMA, synthetic, manifestSha256, images: {} });

export function loadTruthFile(file, { images, synthetic = false, manifestSha256 }) {
  if (!existsSync(file)) return newTruthFile({ synthetic, manifestSha256 });
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('TRUTH_FILE_INVALID: not JSON'); }
  const problems = truthFileProblems(parsed, images);
  if (problems.length) throw new Error(`TRUTH_FILE_INVALID: ${problems.slice(0, 5).join('; ')}`);
  if (parsed.synthetic !== synthetic) throw new Error(synthetic ? 'TRUTH_FILE_INVALID: a test must not open a real truth file' : 'TRUTH_FILE_INVALID: a synthetic file is not a review');
  return parsed;
}
export const manifestHash = file => sha256(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
