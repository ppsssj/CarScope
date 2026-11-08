// P13-B: the washer cap vision evaluation, step by step. No step calls Roboflow. Only `run --real-openai` can call OpenAI, and only with an
// approval file, a key file, a model id and the existing 5-call ledger. P13-B itself never ran that step.
//   node scripts/washer-eval.mjs manifest            rebuild dataset/p13-b-washer-eval.json from the checked P12-F set (no call)
//   node scripts/washer-eval.mjs status              truth progress, eligibility, the pre-call checklist (no call)
//   node scripts/washer-eval.mjs plan [--budget 5]   which photo pairs a run would send (no call)
//   node scripts/washer-eval.mjs run --mock <runId>  the whole pipeline with the MOCK provider, marked synthetic (no call)
//   node scripts/washer-eval.mjs run --real-openai <runId>   needs approval; refuses otherwise
//   node scripts/washer-eval.mjs report <runId>      score a stored run against the truth (no call)
// Crops are made by `npm run washer:prepare` (Chrome, the P13-A crop code).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PATHS, loadEvaluationSet, sha256 } from '../review/review-data.mjs';
import { candidatesFor } from '../../mobile-ar-poc/public/part-detection.mjs';
import { buildAnalysisPrompt, REGION_SOURCE as AREGION } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { parseRoboflowResponse } from '../src/roboflow-adapter.mjs';
import { createMockVisionProvider } from '../src/mock-vision-provider.mjs';
import { VISION_CALL_LIMIT, realOpenAiProvider } from './part-analysis-local.mjs';
import { assertOutside, loadTruthFile, loadWasherSet, manifestHash, WASHER_PATHS } from '../washer-eval/washer-eval-data.mjs';
import { detectionRegions, eligibility, gateResults, MARGIN_KEYS, MARGINS, PART_ID, planCalls, REGION_SOURCE, scoreRun, truthState } from '../washer-eval/washer-eval-model.mjs';

export const RUN_SCHEMA = 'carscope-washer-run-v1';

/** The manifest is a list of photos with their checked facts. It holds no answer: truth is a person's, in a file outside Git. */
export function buildManifest({ data = {}, p12gReview = WASHER_PATHS.p12gReview } = {}) {
  const set = loadEvaluationSet(data);
  if (set.status !== 'READY') throw new Error(`BLOCKED: ${set.problems.join('; ')}`);
  const answersFile = data.answers ?? DEFAULT_PATHS.answers;
  const human = existsSync(p12gReview) ? JSON.parse(readFileSync(p12gReview, 'utf8')) : { images: {} };
  return {
    schema: 'carscope-washer-eval-set-v1',
    part: PART_ID,
    truthStatus: 'AWAITING_HUMAN_REVIEW',
    note: 'Candidate photos only. P12-F drafts and P12-H assisted candidates are not truth. A photo enters scoring only after a person completes its washer truth.',
    sourceLabelsSha256: set.sourceLabelsSha256,
    answersSha256: sha256(readFileSync(answersFile)),
    detection: { model: 'engine-bay-parts/1', answers: 'p12-f/run1/answers.json (real hosted responses; P12-C photos reuse P12-C run2)', rule: 'candidatesFor(washer-fluid-cap): class Windshield Wiper Fluid, score >= 0.4, overlap-merged, at most 3' },
    images: set.images.map(image => {
      const regions = detectionRegions(set.answers[image.id], candidatesFor, parseRoboflowResponse);
      const draft = image.parts?.washer;
      const record = human.images?.[image.id];
      return {
        id: image.id, sha256: image.sha256, vehicle: image.vehicle, electrified: image.electrified,
        license: image.license, attribution: image.attribution, source: image.source,
        detections: regions.length,
        p12fDraft: !draft ? 'NOT_LABELLED' : draft.boxes?.length ? 'BOX' : 'EMPTY', // information only, never truth
        p12gHumanWasher: record?.complete && human.synthetic === false && record.imageSha256 === image.sha256 ? record.parts?.washer?.status ?? 'NONE' : 'NONE',
      };
    }),
  };
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
function preparedIndex(dir) {
  const file = path.join(dir, 'prepared.json');
  return existsSync(file) ? readJson(file).images ?? {} : {};
}

/** The checklist before any paid call. Every line must be PASS; the run step re-checks it. */
export function preCallChecklist({ approvalFile = WASHER_PATHS.approval, plan, env = process.env, ledgerCount = null }) {
  const approval = existsSync(approvalFile) ? readJson(approvalFile) : null;
  const line = (id, ok, detail) => ({ id, status: ok ? 'PASS' : 'BLOCKED', detail });
  return [
    line('OWNER_APPROVAL_FILE', Boolean(approval?.approvedBy && approval?.approvedAt && approval?.scope === 'p13-b-washer-eval'), 'approval.json with approvedBy, approvedAt, scope p13-b-washer-eval (written by the owner, outside Git)'),
    line('CALL_CAP', Number.isInteger(approval?.maxCalls) && approval.maxCalls >= 1 && approval.maxCalls <= VISION_CALL_LIMIT, `approval.maxCalls 1..${VISION_CALL_LIMIT}; the ledger refuses beyond ${VISION_CALL_LIMIT}`),
    line('MODEL_CHOSEN', Boolean(env.OPENAI_VISION_MODEL) && approval?.model === env.OPENAI_VISION_MODEL, 'OPENAI_VISION_MODEL set and equal to approval.model (checked against the current OpenAI docs on the day)'),
    line('PRICE_RECORDED', Number.isFinite(approval?.price?.inputPerMillionUsd) && Number.isFinite(approval?.price?.outputPerMillionUsd) && Boolean(approval?.price?.source), 'approval.price with per-million input/output USD and its source page; else cost is not computed'),
    line('KEY_FILE_OUTSIDE_REPOSITORY', Boolean(env.OPENAI_API_KEY_FILE) && !path.resolve(env.OPENAI_API_KEY_FILE).toLowerCase().startsWith(path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase()), 'OPENAI_API_KEY_FILE outside the repository'),
    line('LEDGER_SET', Boolean(env.CARSCOPE_VISION_LEDGER), `CARSCOPE_VISION_LEDGER outside the repository${ledgerCount === null ? '' : `, ${ledgerCount}/${VISION_CALL_LIMIT} used`}`),
    line('DATA_TERMS_ACCEPTED', approval?.dataTermsReviewed === true, 'the owner read OpenAI data use and retention for this account and accepts sending these crops'),
    line('PHOTOS_PLANNED', plan.calls.length > 0, `${plan.calls.length} calls (${plan.calls.filter(c => c.sameCrop).length} on identical crops); each photo has a completed truth, NONE_VISIBLE personal data and prepared crops equal to the reviewed ones`),
    line('NOT_RENDER', !env.RENDER, 'local machine only'),
  ];
}

function context({ truthFile = WASHER_PATHS.truth, preparedDir = WASHER_PATHS.prepared, synthetic = false, data, manifest } = {}) {
  const set = loadWasherSet({ ...(manifest ? { manifest } : {}), data });
  if (set.status !== 'READY') throw new Error(`BLOCKED: ${set.problems.join('; ')}`);
  const truth = loadTruthFile(assertOutside(truthFile), { images: set.images, synthetic, manifestSha256: manifestHash(manifest ?? WASHER_PATHS.manifest) });
  const prepared = preparedIndex(assertOutside(preparedDir));
  return { set, truth, prepared };
}

export function status(options = {}) {
  const { set, truth, prepared } = context(options);
  const rows = set.images.map(image => {
    const record = truth.images[image.id];
    return { id: image.id, truth: truthState(image, record), detections: set.detections[image.id].length, humanBox: Boolean(set.humanBoxes[image.id]), region: record?.truth?.region?.source ?? null, ...eligibility(image, record, prepared[image.id]) };
  });
  const plan = planCalls(set.images, truth, prepared, options.budget ?? VISION_CALL_LIMIT);
  return { rows, counts: Object.fromEntries(['UNREVIEWED', 'IN_PROGRESS', 'HUMAN_REVIEWED', 'INVALIDATED'].map(s => [s, rows.filter(r => r.truth === s).length])), plan, checklist: preCallChecklist({ plan, approvalFile: options.approvalFile ?? WASHER_PATHS.approval, env: options.env ?? process.env }) };
}

/**
 * Sends the planned crops, one call each, and stores what came back. With `mock`, nothing leaves the machine and the run is marked synthetic.
 * Each record keeps the raw answer (a JSON object, never the photo), the latency, the provider's token counts and a fixed error code.
 */
export async function runEvaluation({ runId, mock = false, real = false, env = process.env, runsDir = WASHER_PATHS.runs, provider: given = null, ...options }) {
  if (!/^[a-z0-9-]{3,40}$/.test(runId ?? '')) throw new Error('RUN_ID_INVALID');
  if (mock === real && !given) throw new Error('CHOOSE_MOCK_OR_REAL');
  const { set, truth, prepared } = context({ ...options, synthetic: options.synthetic ?? mock });
  const dir = path.join(assertOutside(runsDir, env), runId);
  if (existsSync(dir)) throw new Error('RUN_EXISTS');
  let provider = given, ledger = null, budget = options.budget ?? VISION_CALL_LIMIT;
  if (real) {
    const plan0 = planCalls(set.images, truth, prepared, budget);
    const checklist = preCallChecklist({ plan: plan0, approvalFile: options.approvalFile ?? WASHER_PATHS.approval, env });
    const blocked = checklist.filter(c => c.status !== 'PASS');
    if (blocked.length) throw new Error(`NOT_APPROVED: ${blocked.map(c => c.id).join(', ')}`);
    ({ provider, ledger } = realOpenAiProvider({ env }));
    budget = Math.min(readJson(options.approvalFile ?? WASHER_PATHS.approval).maxCalls, VISION_CALL_LIMIT - ledger.count);
  } else if (mock) provider = createMockVisionProvider();
  const plan = planCalls(set.images, truth, prepared, budget);
  mkdirSync(dir, { recursive: true });
  const meta = { schema: RUN_SCHEMA, runId, synthetic: Boolean(mock || options.synthetic), provider: provider.id, model: provider.model, startedAt: new Date().toISOString(), calls: plan.calls.length, skipped: plan.skipped, pairsDropped: plan.pairsDropped, manifestSha256: manifestHash(options.manifest ?? WASHER_PATHS.manifest) };
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 1));
  const out = path.join(dir, 'records.jsonl');
  for (const { imageId, margin, sameCrop } of plan.calls) {
    const crop = prepared[imageId][MARGIN_KEYS[margin]];
    const image = readFileSync(path.join(assertOutside(options.preparedDir ?? WASHER_PATHS.prepared, env), crop.file));
    if (sha256(image) !== crop.sha256) throw new Error(`CROP_CHANGED: ${imageId} ${margin}`);
    const regionSource = truth.images[imageId].truth.region.source === REGION_SOURCE.DETECTION ? AREGION.AI_CANDIDATE : AREGION.MANUAL;
    const input = { partId: PART_ID, image, imageSize: crop.output, targetInCrop: crop.targetInCrop, regionSource, ...buildAnalysisPrompt(PART_ID, { targetInCrop: crop.targetInCrop, regionSource }) };
    let usage = null, responseStatus = null;
    const started = performance.now();
    let raw = null, errorCode = null;
    try { raw = await provider.analyzePart(input, { onResponse: info => { usage = info.usage ?? null; responseStatus = info.status ?? null; } }); }
    catch (error) { errorCode = /^[A-Z0-9_]{3,60}$/.test(error?.message ?? '') ? error.message : 'PROVIDER_ERROR'; }
    const record = { imageId, margin, sameCrop, cropSha256: crop.sha256, latencyMs: Math.round(performance.now() - started), raw, errorCode, usage, responseStatus };
    appendFileSync(out, `${JSON.stringify(record)}\n`);
  }
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...meta, finishedAt: new Date().toISOString(), ledgerAfter: ledger ? ledger.count : null }, null, 1));
  return { dir, plan };
}

export function report({ runId, runsDir = WASHER_PATHS.runs, price = undefined, approvalFile = WASHER_PATHS.approval, ...options }) {
  const dir = path.join(assertOutside(runsDir), runId);
  const meta = readJson(path.join(dir, 'run.json'));
  const { truth } = context({ ...options, synthetic: meta.synthetic });
  const records = readFileSync(path.join(dir, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const answers = Object.fromEntries(Object.entries(truth.images).filter(([, r]) => r.complete).map(([id, r]) => [id, r.truth]));
  const costPrice = price !== undefined ? price : existsSync(approvalFile) ? readJson(approvalFile).price ?? null : null;
  const score = scoreRun(records, answers, { price: costPrice });
  const result = { schema: 'carscope-washer-report-v1', runId, kind: meta.synthetic ? 'MOCK_NOT_A_MEASUREMENT' : 'REAL_PROVIDER', provider: meta.provider, model: meta.model, calls: records.length, reviewedPhotos: Object.keys(answers).length, gates: gateResults(score), ...score };
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(result, null, 1));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = name => rest.includes(`--${name}`);
  const value = (name, fallback) => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : fallback; };
  const positional = rest.filter((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1] === '--budget'));
  try {
    if (command === 'manifest') {
      const file = fileURLToPath(WASHER_PATHS.manifest);
      writeFileSync(file, `${JSON.stringify(buildManifest(), null, 1)}\n`);
      console.log(`Wrote ${path.relative(process.cwd(), file)}. No call.`);
    } else if (command === 'status' || command === 'plan') {
      const s = status({ budget: Number(value('budget', VISION_CALL_LIMIT)) });
      console.log(JSON.stringify(command === 'plan' ? s.plan : { counts: s.counts, rows: s.rows.map(({ id, truth, detections, humanBox, region, eligible, reasons }) => ({ id, truth, detections, humanBox, region, eligible, reasons: reasons.join(',') })), checklist: s.checklist }, null, 1));
    } else if (command === 'run') {
      const { dir, plan } = await runEvaluation({ runId: positional[0], mock: flag('mock'), real: flag('real-openai') });
      console.log(`Run stored in ${dir}: ${plan.calls.length} calls. ${flag('mock') ? 'MOCK: nothing left this machine.' : ''}`);
    } else if (command === 'report') {
      console.log(JSON.stringify(report({ runId: positional[0] }), null, 1));
    } else { console.error('commands: manifest | status | plan | run --mock|--real-openai <runId> | report <runId>'); process.exit(2); }
  } catch (error) { console.error(error.message); process.exit(2); }
}
