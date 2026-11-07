// P12-G: the rules of a review, its evaluation and the local server, on a made-up set in a temporary folder. No real photo, no model and no network beyond 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { boxFromCorners, draftOf, emptyPart, fitView, imageState, moveBox, partProblems, PART_KEYS, predictionsOf, progressOf, REVIEW_CASES, REVIEW_PARTS, REVIEW_SCHEMA, resizeBox, reviewFileProblems, saveProblems, STATUS, toNormalized, toScreen, zoomAt } from '../review/review-model.mjs';
import { changesFromDraft, evaluateReview, instancesOf, matchPhoto } from '../review/review-evaluate.mjs';
import { labelsHash, loadEvaluationSet, loadReviewFile } from '../review/review-data.mjs';
import { assertReviewPath, startReviewServer } from '../review/review-server.mjs';
import { dataOf, makeFixture, WASHER, ELSEWHERE, COOLANT } from './review-fixture.mjs';

const close = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-9, `${a} vs ${b}`));
const decided = (overrides = {}) => Object.fromEntries(PART_KEYS.map(key => [key, { ...emptyPart(key), status: STATUS.UNKNOWN, ...overrides[key] }]));
const body = (image, { complete = true, reviewer = 'synthetic-tester', parts = decided(), expectedRevision = 0 } = {}) => ({ imageSha256: image.sha256, complete, reviewer, expectedRevision, parts });
const SYNTHETIC_FILE = (fixture, images = {}) => ({ schema: REVIEW_SCHEMA, synthetic: true, sourceLabelsSha256: 'x', images });

test('the six parts keep the dataset keys and the registry ids', async () => {
  const { INSPECTION_PARTS } = await import('../../three-poc/inspection-parts.mjs');
  const { PART_DETECTION } = await import('../../mobile-ar-poc/public/part-detection.mjs');
  assert.deepEqual(REVIEW_PARTS.map(part => [part.key, part.partId]), [['washer', 'washer-fluid-cap'], ['coolant', 'coolant-reservoir'], ['brake', 'brake-fluid-reservoir'], ['fuse', 'fuse-box'], ['battery', 'battery-12v'], ['lcw', 'lcw-coolant-reservoir']]);
  assert.deepEqual(REVIEW_PARTS.map(part => part.partId).sort(), INSPECTION_PARTS.filter(part => part.area === 'hood').map(part => part.id).sort());
  const manifest = JSON.parse(readFileSync(new URL('../dataset/p12-f-bonnet-parts.json', import.meta.url), 'utf8'));
  for (const part of REVIEW_PARTS) {
    assert.equal(part.modelClass, manifest.classes[part.key] ?? null, part.key);
    assert.ok(PART_DETECTION[part.partId], part.key);
    if (PART_DETECTION[part.partId].modelClass) assert.equal(PART_DETECTION[part.partId].modelClass, part.modelClass, part.key);
  }
  assert.equal(PART_DETECTION['battery-12v'].modelClass, null, 'measured here, still not offered to a driver');
  assert.equal(REVIEW_PARTS.find(part => part.key === 'lcw').modelClass, null);
  for (const item of REVIEW_CASES) for (const id of item.images) assert.ok(manifest.images.some(image => image.id === id), id);
  assert.deepEqual(REVIEW_CASES.find(item => item.id === 'leaf').images, manifest.images.filter(image => image.vehicle === 'Nissan Leaf').map(image => image.id));
  assert.deepEqual(REVIEW_CASES.find(item => item.id === 'bolt').images, manifest.images.filter(image => image.vehicle === 'Chevrolet Bolt EV').map(image => image.id));
});

test('coordinates: a box stays on the same spot of the picture through any zoom and pan', () => {
  const image = { width: 1280, height: 853 }, frame = { width: 900, height: 700 };
  const view = fitView(image, frame), corner = [0.25, 0.75];
  close(toNormalized(toScreen(corner, image, view), image, view), corner);
  const zoomed = zoomAt(view, 3, [120, 340], view.scale);
  assert.ok(zoomed.scale > view.scale);
  close(toNormalized(toScreen(corner, image, zoomed), image, zoomed), corner);
  close(toNormalized([120, 340], image, zoomed), toNormalized([120, 340], image, view));
  assert.equal(zoomAt(view, 1000, [0, 0], view.scale).scale, view.scale * 12, 'limited');
  assert.equal(zoomAt(view, 0.0001, [0, 0], view.scale).scale, view.scale * 0.5);
  close(predictionsOf({ image: { width: 1000, height: 500 }, predictions: [{ class: 'X', confidence: 0.5, x: 100, y: 100, width: 100, height: 50 }] })[0].box, [0.05, 0.15, 0.1, 0.1]);
});

test('editing keeps a box on the picture and never inside out', () => {
  close(boxFromCorners([0.5, 0.6], [0.2, 0.1]), [0.2, 0.1, 0.3, 0.5]);
  close(boxFromCorners([-1, -1], [2, 0.5]), [0, 0, 1, 1 - 0.5]);
  close(moveBox([0.8, 0.8, 0.2, 0.2], 0.5, 0.5), [0.8, 0.8, 0.2, 0.2]);
  close(moveBox([0.1, 0.1, 0.2, 0.2], -0.5, 0.1), [0, 0.2, 0.2, 0.2]);
  close(resizeBox([0.1, 0.1, 0.2, 0.2], 'se', 0.1, 0.1), [0.1, 0.1, 0.3, 0.3]);
  close(resizeBox([0.1, 0.1, 0.2, 0.2], 'nw', -0.05, -0.05), [0.05, 0.05, 0.25, 0.25]);
  const flipped = resizeBox([0.1, 0.1, 0.2, 0.2], 'e', -0.9, 0);
  assert.ok(flipped[2] > 0, 'the edge stops before the opposite one');
});

test('UNKNOWN and ABSENT are different, and each decision has its own rule', () => {
  const part = (key, patch) => ({ ...emptyPart(key), ...patch });
  assert.deepEqual(partProblems('washer', part('washer', { status: STATUS.ABSENT })), []);
  assert.deepEqual(partProblems('washer', part('washer', { status: STATUS.UNKNOWN })), []);
  assert.match(partProblems('washer', part('washer', { status: STATUS.PRESENT })).join(), /PRESENT needs a box/);
  assert.deepEqual(partProblems('washer', part('washer', { status: STATUS.PRESENT, caps: [WASHER] })), [], 'only the cap could be seen');
  assert.match(partProblems('washer', part('washer', { status: STATUS.ABSENT, boxes: [WASHER] })).join(), /only PRESENT/);
  assert.match(partProblems('washer', part('washer', { status: STATUS.UNKNOWN, caps: [WASHER] })).join(), /only PRESENT/);
  assert.deepEqual(partProblems('washer', part('washer', { boxes: [WASHER] })), [], 'drawn before the decision');
  assert.match(partProblems('washer', part('washer', { status: STATUS.NEEDS_REFERENCE })).join(), /NEEDS_REFERENCE/);
  assert.deepEqual(partProblems('washer', part('washer', { status: STATUS.NEEDS_REFERENCE, reference: 'manual p.1' })), []);
  assert.match(partProblems('washer', part('washer'), { complete: true }).join(), /not decided/);
  assert.match(partProblems('washer', part('washer', { hv: [WASHER] })).join(), /battery/);
  for (const bad of [[0, 0, 0, 0.1], [0.9, 0, 0.2, 0.1], [-0.1, 0, 0.1, 0.1], [0, 0, NaN, 0.1], [0, 0, 0.1]]) assert.match(partProblems('washer', part('washer', { boxes: [bad] })).join(), /invalid box/, String(bad));
});

test('a finished review needs every part decided and a typed reviewer; nothing supplies one', () => {
  const image = { sha256: 'a'.repeat(64) };
  assert.deepEqual(saveProblems(body(image), image), []);
  assert.match(saveProblems(body(image, { reviewer: '  ' }), image).join(), /reviewer is required/);
  assert.match(saveProblems({ ...body(image), reviewer: undefined }, image).join(), /reviewer is required/);
  const open = decided({ fuse: { status: STATUS.UNREVIEWED } });
  assert.match(saveProblems(body(image, { parts: open }), image).join(), /fuse: not decided/);
  assert.deepEqual(saveProblems(body(image, { parts: open, complete: false }), image), [], 'a draft save may stay open');
  assert.match(saveProblems({ ...body(image), imageSha256: 'b'.repeat(64) }, image).join(), /does not match/);
  const { fuse, ...five } = decided();
  assert.match(saveProblems(body(image, { parts: five }), image).join(), /all six/);
  assert.match(saveProblems(body(image, { parts: { ...decided(), extra: {} } }), image).join(), /all six/);
});

test('a bad review file is refused, and a changed photo voids its record without voiding the file', () => {
  const fixture = makeFixture();
  try {
    const set = loadEvaluationSet(dataOf(fixture));
    assert.equal(set.status, 'READY');
    const image = set.images[0], record = { imageSha256: image.sha256, complete: true, reviewer: 'synthetic-tester', completedAt: 'x', revision: 1, parts: decided() };
    assert.deepEqual(reviewFileProblems(SYNTHETIC_FILE(fixture, { [image.id]: record }), set.images), []);
    for (const [text, file] of [
      ['schema', { ...SYNTHETIC_FILE(fixture), schema: 'other' }],
      ['synthetic', { ...SYNTHETIC_FILE(fixture), synthetic: 'yes' }],
      ['not in the evaluation set', SYNTHETIC_FILE(fixture, { nope: record })],
      ['needs a reviewer', SYNTHETIC_FILE(fixture, { [image.id]: { ...record, reviewer: '' } })],
      ['completedAt', SYNTHETIC_FILE(fixture, { [image.id]: { ...record, completedAt: null } })],
      ['not decided', SYNTHETIC_FILE(fixture, { [image.id]: { ...record, parts: decided({ lcw: { status: STATUS.UNREVIEWED } }) } })],
      ['unknown part', SYNTHETIC_FILE(fixture, { [image.id]: { ...record, parts: { ...decided(), hv: {} } } })],
      ['imageSha256', SYNTHETIC_FILE(fixture, { [image.id]: { ...record, imageSha256: 'short' } })],
    ]) assert.match(reviewFileProblems(file, set.images).join(), new RegExp(text), text);
    assert.equal(imageState(image, { ...record, imageSha256: 'c'.repeat(64) }), 'INVALIDATED');
    assert.equal(imageState(image, { ...record, complete: false }), 'IN_PROGRESS');
    assert.equal(imageState(image, null), 'UNREVIEWED');
    const options = { images: set.images, sourceLabelsSha256: 'x' };
    mkdirSync(join(fixture.dir, 'bad'));
    const junk = join(fixture.dir, 'bad', 'junk.json'); writeFileSync(junk, '{nope');
    assert.throws(() => loadReviewFile(junk, options), /REVIEW_FILE_INVALID/);
    const wrong = join(fixture.dir, 'bad', 'kind.json'); writeFileSync(wrong, JSON.stringify(SYNTHETIC_FILE(fixture)));
    assert.throws(() => loadReviewFile(wrong, options), /synthetic test file is not a review/, 'a test result can never open as a review');
    assert.equal(loadReviewFile(wrong, { ...options, synthetic: true }).synthetic, true);
  } finally { fixture.cleanup(); }
});

test('missing or changed data is BLOCKED, not filled in', () => {
  const fixture = makeFixture();
  try {
    writeFileSync(join(fixture.roots.P12F, 'syn-b.png'), Buffer.from('changed'));
    const damaged = loadEvaluationSet(dataOf(fixture));
    assert.equal(damaged.status, 'BLOCKED');
    assert.match(damaged.problems.join(), /syn-b: photo hash differs/);
    assert.equal(damaged.files.has('syn-b'), false, 'the changed file is not served');
    const noAnswers = loadEvaluationSet({ ...dataOf(fixture), answers: join(fixture.dir, 'gone.json') });
    assert.match(noAnswers.problems.join(), /STORED_ANSWERS_MISSING/);
    assert.match(noAnswers.problems.join(), /syn-a: stored answer missing/);
    writeFileSync(fixture.answers, JSON.stringify({ answers: { 'syn-a': { image: { width: 1, height: 1 }, predictions: [{ class: 'X', confidence: 9, x: 0, y: 0, width: 1, height: 1 }] } } }));
    assert.match(loadEvaluationSet(dataOf(fixture)).problems.join(), /syn-a: stored answer missing or damaged/);
    assert.equal(labelsHash('a\r\nb'), labelsHash('a\nb'), 'line endings are not a change');
  } finally { fixture.cleanup(); }
});

test('matching: one box one part, caps count, a cap alone stands as a part, several parts are allowed, ignore counts neither way', () => {
  const p = (score, box) => ({ score, box, className: 'X' });
  const part = { ...emptyPart('coolant'), status: STATUS.PRESENT, boxes: [[0.1, 0.1, 0.4, 0.4], [0.6, 0.6, 0.2, 0.2]], caps: [[0.2, 0.15, 0.1, 0.1], [0.05, 0.8, 0.05, 0.05]], ignore: [[0.8, 0.1, 0.1, 0.1]] };
  assert.equal(instancesOf(part).length, 3);
  assert.equal(instancesOf(part)[0].caps.length, 1);
  const r = matchPhoto([p(0.9, [0.1, 0.1, 0.4, 0.4]), p(0.8, [0.2, 0.15, 0.1, 0.1]), p(0.7, [0.6, 0.6, 0.2, 0.2]), p(0.6, [0.81, 0.11, 0.08, 0.08]), p(0.5, [0.4, 0.8, 0.1, 0.1])], part);
  assert.deepEqual([r.hits.length, r.falses.length, r.ignored.length, r.missed], [2, 2, 1, 1]);
  assert.equal(r.hits[0].iou, 1);
});

function evaluationFor(set, records, { synthetic = true } = {}) {
  return evaluateReview({ images: set.images, answers: JSON.parse(readFileSync(set.answersFile, 'utf8')).answers, review: records && { schema: REVIEW_SCHEMA, synthetic, sourceLabelsSha256: 'x', images: records } });
}
test('no review: no figures, whatever the draft says. Partial stays partial and a synthetic file never counts as a review', () => {
  const fixture = makeFixture();
  try {
    const set = { ...loadEvaluationSet(dataOf(fixture)), answersFile: fixture.answers };
    const none = evaluationFor(set, null);
    assert.equal(none.reviewState, 'AWAITING_HUMAN_REVIEW');
    assert.equal(none.metricState, 'HUMAN_REVIEW_PENDING');
    assert.equal(none.parts.washer.reviewed, 'HUMAN_REVIEW_PENDING');
    assert.equal(none.parts.lcw.reviewed, 'NO_MODEL_CLASS');
    assert.equal(none.parts.washer.p12fDraftAllPhotos.labels, 'UNREVIEWED_DRAFT');
    assert.deepEqual([none.parts.washer.p12fDraftAllPhotos.tp, none.parts.washer.p12fDraftAllPhotos.fp, none.parts.washer.p12fDraftAllPhotos.fn], [1, 2, 0], 'the draft figure is still there, labelled as a draft');
    const [a] = set.images;
    const record = complete => ({ imageSha256: a.sha256, complete, reviewer: 'someone', completedAt: 'x', revision: 1, parts: decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER] } }) });
    const unfinished = evaluationFor(set, { [a.id]: record(false) }, { synthetic: false });
    assert.equal(unfinished.metricState, 'HUMAN_REVIEW_PENDING', 'an unfinished save is not a review');
    const partial = evaluationFor(set, { [a.id]: record(true) }, { synthetic: false });
    assert.equal(partial.reviewState, 'PARTIALLY_REVIEWED');
    assert.equal(partial.parts.washer.reviewed.scope, 'PARTIALLY_REVIEWED');
    const b = set.images[1], other = complete => ({ imageSha256: b.sha256, complete, reviewer: 'someone', completedAt: 'x', revision: 1, parts: decided({ washer: { status: STATUS.ABSENT } }) });
    const mixed = evaluationFor(set, { [a.id]: record(true), [b.id]: other(false) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual(mixed.cases.map(item => item.imageId), [a.id], 'beside a finished photo, an unfinished save still does not count');
    const voided = evaluationFor(set, { [a.id]: record(true), [b.id]: { ...other(true), imageSha256: 'd'.repeat(64) } }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual(voided.cases.map(item => item.imageId), [a.id], 'nor does a record for other bytes');
    assert.equal(evaluationFor(set, { [a.id]: record(true) }).reviewState, 'SYNTHETIC_NOT_A_REVIEW');
    assert.equal(evaluationFor(set, { [a.id]: { ...record(true), imageSha256: 'd'.repeat(64) } }, { synthetic: false }).metricState, 'HUMAN_REVIEW_PENDING', 'a record for other bytes counts for nothing');
    assert.throws(() => evaluateReview({ images: set.images, answers: {}, review: null }), /STORED_ANSWER_MISSING/, 'a missing answer is not "nothing found"');
  } finally { fixture.cleanup(); }
});

test('figures follow the corrected label, UNKNOWN stays out, ABSENT counts, and no threshold is chosen afterwards', () => {
  const fixture = makeFixture();
  try {
    const set = { ...loadEvaluationSet(dataOf(fixture)), answersFile: fixture.answers };
    const [a, b, c] = set.images;
    const rec = (image, parts) => ({ imageSha256: image.sha256, complete: true, reviewer: 'someone', completedAt: 'x', revision: 1, parts });
    const asDraft = evaluationFor(set, { [a.id]: rec(a, decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER] } })) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual([asDraft.tp, asDraft.fp, asDraft.fn, asDraft.precision, asDraft.recall], [1, 1, 0, 0.5, 1]);
    assert.equal(asDraft.f1, 0.667);
    assert.equal(asDraft.iouMedian, 1);
    const corrected = evaluationFor(set, { [a.id]: rec(a, decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER, ELSEWHERE] } })) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual([corrected.tp, corrected.fp, corrected.fn, corrected.precision], [2, 0, 0, 1], 'the same answers, a new label, new figures');
    const unknown = evaluationFor(set, { [b.id]: rec(b, decided()) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual([unknown.photos, unknown.fp], [0, 0], 'UNKNOWN: a box there is not false');
    const absent = evaluationFor(set, { [b.id]: rec(b, decided({ washer: { status: STATUS.ABSENT } })) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual([absent.photos, absent.fp, absent.recall], [1, 1, null], 'ABSENT: the same box is false');
    assert.deepEqual(absent.falseKinds.NO_LABELLED_PART.map(item => item.imageId), [b.id]);
    const missed = evaluationFor(set, { [c.id]: rec(c, decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER] } })) }, { synthetic: false }).parts.washer.reviewed;
    assert.deepEqual([missed.tp, missed.fn, missed.recall], [0, 1, 0]);
    const on = evaluationFor(set, { [a.id]: rec(a, decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER] }, fuse: { status: STATUS.PRESENT, boxes: [ELSEWHERE] } })) }, { synthetic: false });
    assert.deepEqual(Object.keys(on.parts.washer.reviewed.falseKinds), ['ON_FUSE'], 'what the false box landed on');
    const hv = evaluationFor(set, { [a.id]: rec(a, decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER] }, battery: { status: STATUS.UNKNOWN, hv: [ELSEWHERE] } })) }, { synthetic: false });
    assert.deepEqual(Object.keys(hv.parts.washer.reviewed.falseKinds), ['ON_HIGH_VOLTAGE']);
    const table = on.parts.coolant.byThreshold;
    assert.deepEqual(table.map(row => row.threshold), [0.05, 0.25, 0.4, 0.5]);
    assert.deepEqual(table.filter(row => row.primary).map(row => row.threshold), [0.4]);
    assert.equal(on.rule.primaryThreshold, 0.4);
    assert.equal(on.rule.iou, 0.5);
    assert.ok(!JSON.stringify(on).match(/best.?threshold|optimal/i));
    const changes = changesFromDraft(a, rec(a, decided({ washer: { status: STATUS.PRESENT, boxes: [[0.1, 0.1, 0.25, 0.2]] }, coolant: { status: STATUS.ABSENT } })));
    const byPart = Object.fromEntries(changes.map(change => [change.part, change.what.join('; ')]));
    assert.match(byPart.washer, /boxes moved, lowest IoU 0.8/);
    assert.match(byPart.coolant, /status PRESENT -> ABSENT; boxes 1 -> 0; caps 1 -> 0/);
    assert.match(byPart.battery, /hv 1 -> 0/);
    assert.equal(byPart.fuse, undefined, 'unknown in both is no change');
    assert.equal(changesFromDraft(c, rec(c, decided())).length, 0);
    assert.deepEqual(draftOf(b, 'washer').status, STATUS.ABSENT);
    assert.deepEqual(draftOf(b, 'coolant').labelled, false);
    assert.deepEqual(progressOf(set.images, { images: { [a.id]: rec(a, decided()), [b.id]: { ...rec(b, decided()), complete: false } } }), { total: 3, reviewed: 1, inProgress: 1, invalidated: 0, unreviewed: 1, needed: 2 });
    assert.ok(COOLANT);
  } finally { fixture.cleanup(); }
});

async function withServer(t, options = {}) {
  const fixture = makeFixture();
  const server = await startReviewServer({ reviewFile: fixture.review, data: dataOf(fixture), synthetic: true, env: {}, ...options });
  t.after(async () => { await server.close(); fixture.cleanup(); });
  const put = (id, value, headers = {}) => fetch(`${server.url}/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json', 'X-CarScope-Review': 'v1', ...headers } });
  return { fixture, server, put };
}
test('the server: saved, reloaded, marked synthetic, with a history; the label file untouched', async (t) => {
  const { fixture, server, put } = await withServer(t);
  const before = readFileSync(fixture.labels, 'utf8');
  const state = await (await fetch(`${server.url}/api/state`)).json();
  assert.equal(state.images.length, 3);
  assert.deepEqual(state.progress, { total: 3, reviewed: 0, inProgress: 0, invalidated: 0, unreviewed: 3, needed: 3 });
  assert.equal(state.evaluation.reviewState, 'SYNTHETIC_NOT_A_REVIEW');
  assert.ok(state.images.every(image => image.record === null), 'no draft is adopted');
  const image = state.images[0];
  const r = await put(image.id, body(image, { parts: decided({ washer: { status: STATUS.PRESENT, boxes: [WASHER], note: 'n', reference: 'r' } }) }));
  const saved = await r.json();
  assert.equal(r.status, 200);
  assert.equal(saved.record.reviewer, 'synthetic-tester');
  assert.equal(saved.progress.reviewed, 1);
  assert.equal(saved.record.parts.washer.note, 'n');
  assert.ok(saved.record.parts.washer.reviewedAt && saved.record.completedAt);
  const file = JSON.parse(readFileSync(fixture.review, 'utf8'));
  assert.equal(file.synthetic, true);
  assert.equal(file.schema, REVIEW_SCHEMA);
  assert.deepEqual(reviewFileProblems(file, state.images), []);
  assert.equal(file.images[image.id].imageSha256, image.sha256);
  assert.equal(readFileSync(`${fixture.review}.history.jsonl`, 'utf8').trim().split('\n').length, 1);
  assert.equal(readFileSync(fixture.labels, 'utf8'), before);
  assert.equal(JSON.parse(before).labelsReviewedByPerson, false);
  assert.equal((await put(image.id, body(image))).status, 409, 'an old copy cannot overwrite a newer save');
  const second = await put(image.id, body(image, { expectedRevision: 1, complete: false, parts: decided() }));
  assert.equal((await second.json()).record.revision, 2);
  assert.equal(readFileSync(`${fixture.review}.history.jsonl`, 'utf8').trim().split('\n').length, 2);
  await server.close();
  const reopened = await startReviewServer({ reviewFile: fixture.review, data: dataOf(fixture), synthetic: true, env: {} });
  const again = await (await fetch(`${reopened.url}/api/state`)).json();
  assert.equal(again.images[0].record.revision, 2);
  await reopened.close();
  server.close = async () => {};
});
test('the server refuses what is not a person\'s finished decision, and refuses other sites', async (t) => {
  const { server, put } = await withServer(t);
  const state = await (await fetch(`${server.url}/api/state`)).json(), image = state.images[0];
  const before = JSON.stringify(state.progress);
  assert.equal((await put(image.id, body(image, { reviewer: '' }))).status, 422);
  assert.equal((await put(image.id, body(image, { parts: decided({ fuse: { status: STATUS.UNREVIEWED } }) }))).status, 422);
  assert.equal((await put(image.id, { ...body(image), imageSha256: 'e'.repeat(64) })).status, 422);
  assert.equal((await put('nope', body(image))).status, 404);
  assert.equal((await put(image.id, body(image), { 'X-CarScope-Review': '' })).status, 415);
  assert.equal((await put(image.id, body(image), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await put(image.id, body(image), { Origin: 'https://example.com' })).status, 403);
  const big = { ...body(image), padding: 'x'.repeat(300 * 1024) };
  assert.equal((await put(image.id, big)).status, 413);
  assert.equal((await (await fetch(`${server.url}/api/state`)).json()).images[0].record, null);
  assert.equal(JSON.stringify((await (await fetch(`${server.url}/api/state`)).json()).progress), before);
  assert.equal((await fetch(`${server.url}/api/state`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${server.url}/api/state`, { method: 'OPTIONS' })).status, 405, 'no preflight is answered');
});
test('only listed files and listed photos can be read: no path reaches anything else', async (t) => {
  const { server } = await withServer(t);
  const http = await import('node:http');
  const raw = target => new Promise((done, fail) => { const request = http.request(`${server.url}/`, { path: target, headers: { host: new URL(server.url).host } }, response => { response.resume(); done(response.statusCode); }); request.on('error', fail); request.end(); });
  for (const target of ['/images/../labels.json', '/images/..%2f..%2flabels.json', '/images/syn-a.png', '/images/nope', '/review-server.mjs', '/review-data.mjs', '/../../package.json', '/%2e%2e/%2e%2e/package.json', '/api/review', '/images/SYN-A']) assert.ok([403, 404].includes(await raw(target)), target);
  const photo = await fetch(`${server.url}/images/syn-a`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.match(photo.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(await new Promise((done, fail) => { const request = http.request(`${server.url}/api/state`, { headers: { host: 'evil.example' } }, response => { response.resume(); done(response.statusCode); }); request.on('error', fail); request.end(); }), 403, 'another host name reaching this port');
  assert.equal(server.server.address().address, '127.0.0.1');
  const state = await (await fetch(`${server.url}/api/state`)).text();
  assert.ok(!/C:\\|C:\/|\/tmp|carscope-review-/.test(state), 'no file path in what the page gets');
});
test('the review file stays outside the repository, and the tool stays out of production', () => {
  assert.throws(() => assertReviewPath(resolve(import.meta.dirname, 'x.json'), {}), /INSIDE_REPOSITORY/);
  assert.throws(() => assertReviewPath(join(tmpDirectory(), 'x.json'), { RENDER: 'true' }), /LOCAL_TOOL_ONLY/);
  assert.equal(assertReviewPath(join(tmpDirectory(), 'x.json'), {}), join(tmpDirectory(), 'x.json'));
});
const tmpDirectory = () => resolve(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp');

test('no model, no key, no outside network in the tool, and no review result in the repository', () => {
  const root = new URL('../review/', import.meta.url);
  const files = ['review-model.mjs', 'review-data.mjs', 'review-evaluate.mjs', 'review-server.mjs', 'public/review.mjs', 'public/index.html', '../scripts/review-report.mjs'];
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /roboflow-client|call-ledger|part-detection-local|ROBOFLOW|inferImage|roboflow\.key|api[_-]?key/i, file);
    assert.doesNotMatch(text.replace(/https:\/\/commons\.wikimedia\.org[^'"]*/g, ''), /https?:\/\/(?!127\.0\.0\.1|local)/, file);
  }
  assert.doesNotMatch(readFileSync(new URL('review-server.mjs', root), 'utf8'), /\bfetch\(/);
  assert.doesNotMatch(readFileSync(new URL('public/review.mjs', root), 'utf8'), /HUMAN_REVIEWED'\s*;|reviewer\s*=\s*['"]/, 'the page never sets a reviewer');
  const inDataset = readdirSync(new URL('../dataset/', import.meta.url));
  assert.ok(!inDataset.some(name => /review/i.test(name)), 'review results live outside the repository');
  assert.equal(JSON.parse(readFileSync(new URL('../dataset/p12-f-bonnet-parts.json', import.meta.url), 'utf8')).labelsReviewedByPerson, false);
  assert.ok(!existsSync(new URL('label-review.json', root)));
});

