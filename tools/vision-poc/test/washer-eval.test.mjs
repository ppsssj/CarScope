// P13-B: the washer evaluation rules, the truth server and the run/report pipeline on a synthetic set. No real photo, no truth, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANALYSIS_PROFILES } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { FIXTURE_PREDICTIONS } from '../scripts/part-analysis-local.mjs';
import { MOCK_SCENARIOS } from '../src/mock-vision-provider.mjs';
import { openAiVisionProvider, pickUsage } from '../src/openai-vision.mjs';
import { buildAnalysisPrompt } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { assertOutside, loadWasherSet, WASHER_PATHS } from '../washer-eval/washer-eval-data.mjs';
import { startTruthServer } from '../washer-eval/washer-truth-server.mjs';
import { buildManifest, preCallChecklist, report, runEvaluation, status } from '../scripts/washer-eval.mjs';
import {
  CROP_BASE, costOf, eligibility, emptyTruth, expectedOf, gateResults, PRODUCT_CROP, planCalls, regionProblems, REGION_SOURCE, scoreRun, truthProblems, truthState, wilson,
} from '../washer-eval/washer-eval-model.mjs';
import { dataOf, makeFixture } from './review-fixture.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const W = 'washer-fluid-cap';
const truthOf = fields => ({ ...emptyTruth(), region: { source: REGION_SOURCE.HUMAN, box: [0.1, 0.1, 0.2, 0.2], detectionIndex: null }, identification: 'WASHER_CAP', capMissing: 'NO', capOpen: 'NO', capDamage: 'NO', judgeable: 'JUDGEABLE', personalData: 'NONE_VISIBLE', ...fields });
const RECTS = { m40: { x: 10, y: 10, width: 100, height: 80 }, m80: { x: 0, y: 0, width: 150, height: 120 } };
const body = (truth, extra = {}) => ({ reviewer: '검수자', complete: true, expectedRevision: 0, truth, ...extra });

function washerFixture() {
  const fixture = makeFixture();
  const manifest = join(fixture.dir, 'washer-set.json');
  writeFileSync(manifest, JSON.stringify(buildManifest({ data: dataOf(fixture), p12gReview: join(fixture.dir, 'none.json') })));
  return { ...fixture, manifest, truthFile: join(fixture.dir, 'p13-b', 'truth.json'), preparedDir: join(fixture.dir, 'p13-b', 'prepared'), runsDir: join(fixture.dir, 'p13-b', 'runs') };
}

test('crop arms: the product arm is the P13-A washer profile; the sent arm changes only the minimum', () => {
  const { margin, ...profile } = ANALYSIS_PROFILES[W].crop;
  assert.deepEqual({ minSidePx: profile.minSidePx, minShortSideFraction: profile.minShortSideFraction, maxOutputSide: profile.maxOutputSide, jpegQuality: profile.jpegQuality }, PRODUCT_CROP);
  assert.equal(margin, 0.8);
  assert.deepEqual({ ...CROP_BASE, minSidePx: PRODUCT_CROP.minSidePx, minShortSideFraction: PRODUCT_CROP.minShortSideFraction }, PRODUCT_CROP);
  assert.equal(CROP_BASE.minSidePx, 64, 'the relay refuses smaller pictures');
});

test('regions: a stored detection must match exactly; a fixture box is not a detection', () => {
  const detections = [{ index: 0, score: 0.8, box: [0.1, 0.1, 0.2, 0.2] }];
  assert.deepEqual(regionProblems({ source: 'DETECTION', box: [0.1, 0.1, 0.2, 0.2], detectionIndex: 0 }, detections), []);
  assert.deepEqual(regionProblems({ source: 'DETECTION', box: FIXTURE_PREDICTIONS[0].box, detectionIndex: 0 }, detections), ['not a stored detection']);
  assert.deepEqual(regionProblems({ source: 'DETECTION', box: [0.1, 0.1, 0.2, 0.2], detectionIndex: 1 }, detections), ['not a stored detection']);
  assert.deepEqual(regionProblems({ source: 'FIXTURE', box: [0.1, 0.1, 0.2, 0.2] }, detections), ['region source']);
  assert.deepEqual(regionProblems({ source: 'NONE', box: null }, detections), []);
  assert.deepEqual(regionProblems({ source: 'HUMAN', box: [0.9, 0.9, 0.2, 0.2] }, detections), ['region box']);
});

test('truth: UNKNOWN is allowed everywhere; completion needs every answer, a region (or UNKNOWN identification) and the seen crops', () => {
  assert.deepEqual(truthProblems(body(truthOf({ capOpen: 'UNKNOWN', judgeable: 'UNKNOWN' }), { cropRects: RECTS }), { cropRects: RECTS }), []);
  assert.ok(truthProblems(body(truthOf({ capOpen: null })), { cropRects: RECTS }).includes('capOpen unanswered'));
  assert.ok(truthProblems(body(truthOf({}), {}), {}).includes('crop previews not seen'));
  assert.ok(truthProblems(body({ ...truthOf({}), region: { source: 'NONE', box: null } }), {}).includes('a region, or identification UNKNOWN'));
  assert.deepEqual(truthProblems(body({ ...truthOf({ identification: 'UNKNOWN' }), region: { source: 'NONE', box: null } }), {}), []);
  assert.ok(truthProblems(body(truthOf({ identification: 'NOT_WASHER_CAP', capOpen: 'YES' })), { cropRects: RECTS }).includes('a cap issue on what is not the cap'));
  assert.ok(truthProblems(body(truthOf({ capOpen: 'MAYBE' })), { cropRects: RECTS }).includes('capOpen'));
  assert.ok(truthProblems({ ...body(truthOf({})), reviewer: ' ' }, { cropRects: RECTS }).includes('reviewer'));
  // A draft needs no answers.
  assert.deepEqual(truthProblems({ reviewer: 'r', complete: false, expectedRevision: 0, truth: emptyTruth() }, {}), []);
});

test('expected results follow the pre-registered table', () => {
  const e = fields => { const x = expectedOf(truthOf(fields)); return [x.match, x.state, x.reason]; };
  assert.deepEqual(e({}), ['LIKELY_MATCH', 'NO_VISIBLE_ISSUE_DETECTED', 'DECIDED']);
  assert.deepEqual(e({ capOpen: 'YES' }), ['LIKELY_MATCH', 'SUSPECTED_ISSUE', 'DECIDED']);
  assert.deepEqual(e({ capOpen: 'YES', capDamage: 'UNKNOWN' }), ['LIKELY_MATCH', 'SUSPECTED_ISSUE', 'DECIDED']);
  assert.deepEqual(e({ capDamage: 'UNKNOWN' }), ['LIKELY_MATCH', null, 'STATE_UNKNOWN']);
  assert.deepEqual(e({ judgeable: 'UNKNOWN' }), ['LIKELY_MATCH', null, 'STATE_UNKNOWN']);
  assert.deepEqual(e({ judgeable: 'NOT_JUDGEABLE' }), ['LIKELY_MATCH', 'INDETERMINATE', 'NOT_JUDGEABLE']);
  assert.deepEqual(e({ identification: 'NOT_WASHER_CAP' }), ['NOT_MATCH', 'WRONG_PART', 'NOT_THE_CAP']);
  assert.deepEqual(e({ identification: 'UNKNOWN' }), [null, null, 'IDENTIFICATION_UNKNOWN']);
  assert.equal(expectedOf({ ...truthOf({}), region: { source: 'NONE', box: null } }).scored, false);
});

const prep = (same = false) => ({ m40: { file: 'a.jpg', sha256: 'aa', rect: RECTS.m40, output: { width: 100, height: 80 } }, m80: { file: 'b.jpg', sha256: same ? 'aa' : 'bb', rect: RECTS.m80, output: { width: 150, height: 120 } } });
const record = (truth = truthOf({}), extra = {}) => ({ imageSha256: 'h', complete: true, reviewer: 'r', revision: 1, truth, cropRects: RECTS, ...extra });

test('eligibility: completed truth, a region, cleared personal data, prepared crops equal to the reviewed ones, at least 64px', () => {
  const image = { id: 'x', sha256: 'h' };
  assert.deepEqual(eligibility(image, record(), prep()), { eligible: true, reasons: [] });
  assert.deepEqual(eligibility(image, null, prep()).reasons, ['TRUTH_NOT_COMPLETE']);
  assert.deepEqual(eligibility(image, record(truthOf({}), { complete: false }), prep()).reasons, ['TRUTH_NOT_COMPLETE']);
  assert.deepEqual(eligibility({ ...image, sha256: 'other' }, record(), prep()).reasons, ['TRUTH_NOT_COMPLETE'], 'a changed photo invalidates the truth');
  assert.ok(eligibility(image, record(truthOf({ personalData: 'UNKNOWN' })), prep()).reasons.includes('PERSONAL_DATA_NOT_CLEARED'));
  assert.ok(eligibility(image, record(truthOf({ personalData: 'VISIBLE' })), prep()).reasons.includes('PERSONAL_DATA_NOT_CLEARED'));
  assert.ok(eligibility(image, record(), { ...prep(), m80: { ...prep().m80, rect: { ...RECTS.m80, width: 151 } } }).reasons.includes('CROP_m80_DIFFERS_FROM_REVIEWED'));
  assert.ok(eligibility(image, record(), { ...prep(), m40: { ...prep().m40, output: { width: 63, height: 80 } } }).reasons.includes('CROP_m40_BELOW_ROUTE_MINIMUM'));
  assert.ok(eligibility(image, record(), null).reasons.includes('CROP_m40_NOT_PREPARED'));
  assert.equal(truthState(image, record()), 'HUMAN_REVIEWED');
});

test('plan: pairs are never split, differing pairs come first, identical crops get one call, the budget holds', () => {
  const images = ['a', 'b', 'c', 'd'].map(id => ({ id, sha256: 'h' }));
  const truth = { images: Object.fromEntries(images.map(i => [i.id, record()])) };
  const prepared = { a: prep(true), b: prep(), c: prep(), d: prep() };
  const five = planCalls(images, truth, prepared, 5);
  assert.deepEqual(five.calls.map(c => `${c.imageId}:${c.margin}:${c.sameCrop}`), ['b:0.4:false', 'b:0.8:false', 'c:0.4:false', 'c:0.8:false', 'a:0.4:true']);
  assert.equal(five.pairsDropped, 1);
  assert.equal(planCalls(images, truth, prepared, 3).calls.length, 3, 'one pair and the single identical crop');
  assert.equal(planCalls(images, truth, prepared, 1).calls.length, 1);
  assert.deepEqual(planCalls(images, { images: {} }, prepared, 5).calls, []);
  assert.throws(() => planCalls(images, truth, prepared, -1), /BUDGET_INVALID/);
});

test('scoring: schema, part match, state, unsupported suspicions, indeterminate, latency, tokens and cost, by margin', () => {
  const ok = MOCK_SCENARIOS['no-visible-issue'], suspected = MOCK_SCENARIOS.suspected, wrong = MOCK_SCENARIOS['wrong-part'], unsure = MOCK_SCENARIOS.indeterminate;
  const truth = { a: truthOf({}), b: truthOf({ capMissing: 'YES' }), c: truthOf({ identification: 'NOT_WASHER_CAP' }), d: truthOf({ judgeable: 'NOT_JUDGEABLE' }) };
  const usage = { input_tokens: 1000, output_tokens: 200 };
  const records = [
    { imageId: 'a', margin: 0.4, raw: ok, latencyMs: 900, usage }, { imageId: 'a', margin: 0.8, raw: suspected, latencyMs: 1100, usage }, // unsupported: truth said NO missing
    { imageId: 'b', margin: 0.4, raw: suspected, latencyMs: 1000, usage }, { imageId: 'b', margin: 0.8, raw: MOCK_SCENARIOS['claims-safe'], latencyMs: 1200, usage },
    { imageId: 'c', margin: 0.4, raw: wrong, latencyMs: 800, usage }, { imageId: 'c', margin: 0.8, raw: null, errorCode: 'OPENAI_REFUSED', latencyMs: 300, usage: null },
    { imageId: 'd', margin: 0.4, raw: unsure, latencyMs: 700, usage, sameCrop: true },
  ];
  const s = scoreRun(records, truth, { price: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 } });
  const m40 = s.byMargin.m40, m80 = s.byMargin.m80;
  assert.equal(m40.calls, 4); assert.equal(m40.schema.rate, 1);
  assert.equal(m80.calls, 4); assert.equal(m80.schema.valid, 2);
  assert.deepEqual(m80.schema.failures.sort((x, y) => x.reason.localeCompare(y.reason)), [{ reason: 'FORBIDDEN_TEXT', count: 1 }, { reason: 'OPENAI_REFUSED', count: 1 }]);
  // m40: a ok, b ok, c NOT_MATCH ok, d UNCERTAIN vs LIKELY_MATCH -> 3/4.
  assert.deepEqual([m40.partMatch.agree, m40.partMatch.scored, m40.partMatch.uncertain], [3, 4, 1]);
  assert.deepEqual([m40.state.agree, m40.state.scored], [4, 4]);
  assert.equal(m40.unsupportedSuspicions.count, 0);
  assert.deepEqual(m80.unsupportedSuspicions.items, [{ imageId: 'a', code: 'CAP_MISSING_SUSPECTED', truth: 'NO' }]);
  assert.equal(m40.indeterminate.count, 1);
  assert.equal(m80.sameCropRows, 1, 'the identical crop answers for both margins');
  assert.equal(m40.latencyMs.median, 800); assert.equal(m40.latencyMs.max, 1000);
  assert.equal(m80.latencyMs.max, 1200, 'the mirrored row adds no latency');
  assert.equal(m40.costUsd.status, 'COMPUTED'); assert.equal(m40.costUsd.total, Number((4 * (1000 * 2 + 200 * 8) / 1e6).toFixed(6)));
  assert.equal(m80.costUsd.status, 'USAGE_MISSING');
  assert.equal(s.calls.total, 7, 'seven calls made'); assert.equal(s.calls.sameCrop, 1); assert.equal(s.calls.costUsd, null, 'one call reported no usage');
  assert.deepEqual([s.pairs.total, s.pairs.compared, s.pairs.differ], [4, 3, 3]);
  const gates = gateResults(s);
  assert.deepEqual(gates.m40, { SCHEMA_ALL_VALID: 'PASS', NO_UNSUPPORTED_SUSPICION: 'PASS', ACCURACY: 'INSUFFICIENT_SAMPLE' });
  assert.deepEqual(gates.m80, { SCHEMA_ALL_VALID: 'FAIL', NO_UNSUPPORTED_SUSPICION: 'FAIL', ACCURACY: 'INSUFFICIENT_SAMPLE' });
  assert.equal(scoreRun(records, truth).byMargin.m40.costUsd.status, 'PRICE_NOT_CONFIGURED');
  assert.equal(costOf(usage, null), null);
  assert.deepEqual(wilson(4, 4), [0.5101, 1]);
  assert.equal(wilson(0, 0), null);
});

test('the OpenAI adapter reports token counts through an optional hook, and nothing else', async () => {
  const input = { partId: W, image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), imageSize: { width: 100, height: 100 }, ...buildAnalysisPrompt(W, { targetInCrop: [0, 0, 1, 1], regionSource: 'MANUAL' }) };
  const body = { status: 'completed', usage: { input_tokens: 812, output_tokens: 140, output_tokens_details: { reasoning_tokens: 60 }, extra: 'x' }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(MOCK_SCENARIOS['no-visible-issue']) }] }] };
  const seen = [];
  const provider = openAiVisionProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }) });
  await provider.analyzePart(input, { onResponse: info => seen.push(info) });
  assert.deepEqual(seen, [{ usage: { input_tokens: 812, output_tokens: 140, reasoning_tokens: 60 }, status: 'completed' }]);
  await provider.analyzePart(input); // no hook: unchanged P13-A behaviour
  const refused = openAiVisionProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', usage: { input_tokens: 5, output_tokens: 4000 }, output: [] }), { status: 200 }) });
  await assert.rejects(refused.analyzePart(input, { onResponse: info => seen.push(info) }), /OPENAI_INCOMPLETE/);
  assert.deepEqual(seen.at(-1), { usage: { input_tokens: 5, output_tokens: 4000 }, status: 'incomplete' }, 'a failed answer still shows its cost');
  assert.equal(pickUsage({ input_tokens: 'x' }), null);
});

test('paths: every output is outside the repository, and nothing runs on Render', () => {
  assert.throws(() => assertOutside('tools/vision-poc/x.json', {}), /PATH_INSIDE_REPOSITORY/);
  assert.throws(() => assertOutside('C:/CarScope-External/p13-b/x.json', { RENDER: 'true' }), /LOCAL_TOOL_ONLY/);
  for (const value of Object.values(WASHER_PATHS)) if (typeof value === 'string') assert.doesNotThrow(() => assertOutside(value, {}), value);
});

test('the committed manifest lists the 26 P12-F photos with their facts and no answer', () => {
  const manifest = JSON.parse(readFileSync(WASHER_PATHS.manifest, 'utf8'));
  assert.equal(manifest.images.length, 26);
  assert.equal(manifest.truthStatus, 'AWAITING_HUMAN_REVIEW');
  const labels = JSON.parse(readFileSync(new URL('../dataset/p12-f-bonnet-parts.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.images.map(i => [i.id, i.sha256]), labels.images.map(i => [i.id, i.sha256]));
  for (const image of manifest.images) {
    assert.deepEqual(Object.keys(image).sort(), ['attribution', 'detections', 'electrified', 'id', 'license', 'p12fDraft', 'p12gHumanWasher', 'sha256', 'source', 'vehicle'].sort());
    assert.ok(image.license && image.source.startsWith('https://commons.wikimedia.org/'), image.id);
  }
  assert.equal(manifest.images.reduce((n, i) => n + i.detections, 0), 11);
  assert.ok(!/truth"\s*:|identification|capOpen/.test(JSON.stringify(manifest)), 'no answer in Git');
});

test('a synthetic set: truth server refuses bad saves, keeps revisions and history; status, plan, mock run and report work end to end', async (t) => {
  const f = washerFixture(); t.after(f.cleanup);
  const set = loadWasherSet({ manifest: f.manifest, data: dataOf(f), p12gReview: join(f.dir, 'none.json') });
  assert.equal(set.status, 'READY', set.problems.join());
  assert.equal(set.detections['syn-a'].length, 2, 'two washer boxes in syn-a, other classes left out');
  assert.equal(set.detections['syn-c'].length, 0);
  const server = await startTruthServer({ truthFile: f.truthFile, synthetic: true, data: dataOf(f), manifest: f.manifest, p12gReview: join(f.dir, 'none.json'), env: {} });
  t.after(() => server.close());
  const put = (id, payload, headers = {}) => fetch(`${server.url}/api/truth/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CarScope-Review': 'washer-v1', ...headers }, body: JSON.stringify(payload) });
  const state = await (await fetch(`${server.url}/api/state`)).json();
  assert.deepEqual(state.progress, { UNREVIEWED: 3, IN_PROGRESS: 0, HUMAN_REVIEWED: 0, INVALIDATED: 0 });
  assert.ok(state.images.every(i => i.record === null), 'nothing prefilled');
  assert.ok(!JSON.stringify(state).includes('"draft"'), 'P12-F drafts are not sent to the page');
  const detection = set.detections['syn-a'][0];
  const good = body({ ...truthOf({}), region: { source: 'DETECTION', box: detection.box, detectionIndex: 0 } }, { cropRects: RECTS });
  assert.equal((await put('syn-a', good, { 'X-CarScope-Review': 'v1' })).status, 415);
  assert.equal((await fetch(`${server.url}/api/truth/syn-a`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CarScope-Review': 'washer-v1', Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await put('nope', good)).status, 404);
  const fake = await put('syn-a', { ...good, truth: { ...good.truth, region: { source: 'DETECTION', box: FIXTURE_PREDICTIONS[0].box, detectionIndex: 0 } } });
  assert.equal(fake.status, 422); assert.deepEqual((await fake.json()).problems, ['not a stored detection']);
  const saved = await put('syn-a', good);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).expected.state, 'NO_VISIBLE_ISSUE_DETECTED');
  assert.equal((await put('syn-a', good)).status, 409, 'a stale revision is refused');
  assert.equal(readFileSync(`${f.truthFile}.history.jsonl`, 'utf8').trim().split('\n').length, 1);
  await put('syn-b', { ...body({ ...truthOf({ identification: 'NOT_WASHER_CAP' }), region: { source: 'DETECTION', box: set.detections['syn-b'][0].box, detectionIndex: 0 } }, { cropRects: RECTS }) });
  await put('syn-c', { reviewer: 'r', complete: false, expectedRevision: 0, truth: emptyTruth() });
  await server.close();

  // Prepared crops as the Chrome step would write them (here: made-up bytes; the MOCK never decodes them).
  mkdirSync(f.preparedDir, { recursive: true });
  const write = (name, bytes) => { writeFileSync(join(f.preparedDir, name), bytes); return { file: name, sha256: sha(bytes) }; };
  const crop = (id, key, rect, text) => ({ ...write(`${id}-${key}.jpg`, Buffer.from(text)), rect, output: { width: rect.width, height: rect.height }, targetInCrop: [0.2, 0.2, 0.6, 0.6] });
  writeFileSync(join(f.preparedDir, 'prepared.json'), JSON.stringify({ images: {
    'syn-a': { m40: crop('syn-a', 'm40', RECTS.m40, 'a40'), m80: crop('syn-a', 'm80', RECTS.m80, 'a80') },
    'syn-b': { m40: crop('syn-b', 'm40', RECTS.m40, 'b'), m80: crop('syn-b', 'm80', RECTS.m80, 'b') }, // byte-identical
  } }));
  const options = { truthFile: f.truthFile, preparedDir: f.preparedDir, manifest: f.manifest, data: dataOf(f), synthetic: true, env: {} };
  const s = status({ ...options, budget: 5, approvalFile: join(f.dir, 'no-approval.json') });
  assert.deepEqual(s.counts, { UNREVIEWED: 0, IN_PROGRESS: 1, HUMAN_REVIEWED: 2, INVALIDATED: 0 });
  assert.deepEqual(s.plan.calls.map(c => `${c.imageId}:${c.margin}`), ['syn-a:0.4', 'syn-a:0.8', 'syn-b:0.4']);
  assert.ok(s.checklist.filter(c => c.status === 'BLOCKED').map(c => c.id).includes('OWNER_APPROVAL_FILE'));

  await assert.rejects(runEvaluation({ runId: 'real-1', real: true, runsDir: f.runsDir, ...options, approvalFile: join(f.dir, 'no-approval.json') }), /NOT_APPROVED: OWNER_APPROVAL_FILE/);
  assert.equal(existsSync(join(f.runsDir, 'real-1')), false, 'a refused real run leaves nothing');
  const { dir } = await runEvaluation({ runId: 'mock-1', mock: true, runsDir: f.runsDir, ...options });
  const records = readFileSync(join(dir, 'records.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records.length, 3);
  assert.ok(records.every(r => r.raw && !('image' in r) && Number.isFinite(r.latencyMs)), 'answers and timings, no picture');
  await assert.rejects(runEvaluation({ runId: 'mock-1', mock: true, runsDir: f.runsDir, ...options }), /RUN_EXISTS/);
  // A crop changed after preparation is refused before it is sent.
  writeFileSync(join(f.preparedDir, 'syn-a-m40.jpg'), 'tampered');
  await assert.rejects(runEvaluation({ runId: 'mock-2', mock: true, runsDir: f.runsDir, ...options }), /CROP_CHANGED: syn-a 0.4/);
  const r = report({ runId: 'mock-1', runsDir: f.runsDir, ...options, approvalFile: join(f.dir, 'no-approval.json') });
  assert.equal(r.kind, 'MOCK_NOT_A_MEASUREMENT');
  assert.equal(r.reviewedPhotos, 2);
  assert.equal(r.byMargin.m40.calls, 2); assert.equal(r.byMargin.m80.calls, 2);
  assert.equal(r.byMargin.m40.partMatch.agree, 1, 'the MOCK always says LIKELY_MATCH: right on syn-a, wrong on syn-b');
  assert.equal(r.byMargin.m40.costUsd.status, 'PRICE_NOT_CONFIGURED');
  assert.deepEqual(r.gates.m40.ACCURACY, 'INSUFFICIENT_SAMPLE');
  assert.ok(existsSync(join(dir, 'report.json')));
});

test('the pre-call checklist passes only with every owner decision in place', () => {
  const plan = { calls: [{ imageId: 'a', margin: 0.4, sameCrop: false }] };
  const env = { OPENAI_VISION_MODEL: 'model-x', OPENAI_API_KEY_FILE: 'C:/CarScope-External/openai.key', CARSCOPE_VISION_LEDGER: 'C:/CarScope-External/p13-b/calls.json' };
  const approval = join(mkdtempSync(join(tmpdir(), 'carscope-approval-')), 'approval.json');
  const full = { approvedBy: 'owner', approvedAt: '2026-11-09', scope: 'p13-b-washer-eval', maxCalls: 4, model: 'model-x', price: { inputPerMillionUsd: 1, outputPerMillionUsd: 2, source: 'https://example.invalid/pricing' }, dataTermsReviewed: true };
  writeFileSync(approval, JSON.stringify(full));
  assert.deepEqual(preCallChecklist({ approvalFile: approval, plan, env }).filter(c => c.status !== 'PASS'), []);
  for (const [patch, id] of [[{ maxCalls: 6 }, 'CALL_CAP'], [{ model: 'other' }, 'MODEL_CHOSEN'], [{ dataTermsReviewed: false }, 'DATA_TERMS_ACCEPTED'], [{ price: null }, 'PRICE_RECORDED'], [{ scope: 'x' }, 'OWNER_APPROVAL_FILE']]) {
    writeFileSync(approval, JSON.stringify({ ...full, ...patch }));
    assert.ok(preCallChecklist({ approvalFile: approval, plan, env }).find(c => c.id === id).status === 'BLOCKED', id);
  }
  writeFileSync(approval, JSON.stringify(full));
  assert.equal(preCallChecklist({ approvalFile: approval, plan, env: { ...env, OPENAI_API_KEY_FILE: 'tools/openai.key' } }).find(c => c.id === 'KEY_FILE_OUTSIDE_REPOSITORY').status, 'BLOCKED');
  assert.equal(preCallChecklist({ approvalFile: approval, plan: { calls: [] }, env }).find(c => c.id === 'PHOTOS_PLANNED').status, 'BLOCKED');
  assert.equal(preCallChecklist({ approvalFile: approval, plan, env: { ...env, RENDER: '1' } }).find(c => c.id === 'NOT_RENDER').status, 'BLOCKED');
});
