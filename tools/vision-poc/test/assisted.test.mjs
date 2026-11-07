import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { ASSISTED_SCHEMA, assistedProblems, compareAssisted, importAssisted } from '../review/assisted-model.mjs';
import { jpegDimensions, loadAssisted } from '../review/assisted-data.mjs';
import { PART_KEYS, partProblems } from '../review/review-model.mjs';
import { startReviewServer } from '../review/review-server.mjs';
import { dataOf, makeFixture, WASHER, COOLANT } from './review-fixture.mjs';

export const observation = (image, dataset = 'P12F') => ({ id: image.id, dataset, sha256: image.sha256, analysis: 'PIXELS_INSPECTED', parts: Object.fromEntries(PART_KEYS.map(key => [key, { status: 'UNKNOWN', boxes: [], caps: [], evidence: 'Synthetic observation', uncertainty: 'Synthetic only', references: [], additionalReferenceNeeded: true }])) });
export const assistedFixture = fixture => {
  const data = { schema: ASSISTED_SCHEMA, evaluationType: 'PROVISIONAL_AI_ASSISTED', humanReviewed: false, images: fixture.images.map(image => observation(image)) };
  data.images[0].parts.washer = { ...data.images[0].parts.washer, status: 'VISUAL_CANDIDATE', caps: [WASHER] };
  return data;
};
test('assisted input refuses human approval, invalid bounds, changed hashes and unsafe source URLs', () => {
  const f = makeFixture();
  try {
    const data = assistedFixture(f); assert.deepEqual(assistedProblems(data, f.images), []);
    const bad = structuredClone(data); bad.humanReviewed = true; assert.ok(assistedProblems(bad, f.images).length);
    const bad2 = structuredClone(data); bad2.images[0].sha256 = 'a'.repeat(64); assert.match(assistedProblems(bad2, f.images).join(), /hash/);
    const bad3 = structuredClone(data); bad3.images[0].parts.washer.caps = [[0.9, 0, 0.5, 0.2]]; assert.ok(assistedProblems(bad3, f.images).length);
    const part = data.images[0].parts.washer; part.status = 'EVIDENCE_SUPPORTED'; assert.match(assistedProblems(data, f.images).join(), /evidence/);
    part.references.push({ url: 'javascript:alert(1)', title: 'bad', locator: '1', official: true, applicability: 'none' }); assert.match(assistedProblems(data, f.images).join(), /reference/);
    part.status = 'NOT_APPLICABLE'; part.caps = []; part.references[0].url = 'https://example.org'; assert.match(assistedProblems(data, f.images).join(), /absence/);
  } finally { f.cleanup(); }
});
test('import clones geometry into undecided draft, cannot complete a human review', () => {
  const candidate = { status: 'VISUAL_CANDIDATE', caps: [WASHER], boxes: [], evidence: 'cap', uncertainty: 'unverified year', references: [] };
  const part = importAssisted('washer', candidate);
  assert.equal(part.status, 'UNREVIEWED'); assert.equal(part.reviewer, undefined);
  assert.ok(partProblems('washer', part, { complete: true }).some(p => p.includes('not decided')));
  part.caps[0][0] = 0.3; assert.equal(candidate.caps[0][0], 0.1);
});
test('reference geometry uses JPEG dimensions and malformed segments fail closed', () => {
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 3, 0xc0, 5, 0, 0]);
  assert.deepEqual(jpegDimensions(sof), { width: 1280, height: 960 });
  assert.equal(jpegDimensions(sof.subarray(0, 9)), null);
  assert.equal(jpegDimensions(Buffer.from('not a photo')), null);
  const invalid = Buffer.from(sof); invalid[5] = 255; assert.equal(jpegDimensions(invalid), null);
});
test('comparison conserves one-to-one candidates; missing reference is not a false positive', () => {
  const row = observation({ id: 'test', sha256: 'a'.repeat(64) });
  row.parts.washer = { ...row.parts.washer, status: 'VISUAL_CANDIDATE', caps: [WASHER, COOLANT] };
  const p = (className, box) => ({ className, score: 0.8, box });
  const report = compareAssisted(row, [p('Windshield Wiper Fluid', WASHER), p('Windshield Wiper Fluid', WASHER), p('Brake Fluid', COOLANT)]);
  assert.deepEqual(report.results.map(r => r.category), ['DETECTION_SUCCESS_CANDIDATE', 'PART_CONFUSION_CANDIDATE', 'UNDETERMINED']);
  assert.equal(compareAssisted(row, []).results.filter(r => r.category === 'MISSED_CANDIDATE').length, 2);
  const opaque = compareAssisted(row, [p('12', WASHER)]);
  assert.equal(opaque.results[0].category, 'UNDETERMINED');
  assert.equal(opaque.results[0].reason, 'OPAQUE_MODEL_CLASS_OVERLAP');
  row.parts.washer.status = 'NOT_APPLICABLE'; row.parts.washer.caps = [];
  assert.equal(compareAssisted(row, [p('Windshield Wiper Fluid', WASHER)]).results[0].category, 'FALSE_POSITIVE_CANDIDATE');
});
test('optional sidecar is fail-closed and server reads leave labels, answers and human review unchanged', async () => {
  const f = makeFixture(); let server;
  try {
    assert.equal(loadAssisted(null, f.images).status, 'NOT_AVAILABLE');
    const file = `${f.dir}/assisted.json`; writeFileSync(file, JSON.stringify(assistedFixture(f)));
    const before = [f.labels, f.answers].map(file => readFileSync(file, 'utf8'));
    server = await startReviewServer({ reviewFile: f.review, assistedFile: file, data: dataOf(f), synthetic: true, env: {} });
    const state = await (await fetch(`${server.url}/api/state`)).json();
    assert.equal(state.assisted.status, 'READY'); assert.equal(state.progress.reviewed, 0);
    assert.equal(state.images[0].assisted.parts.washer.status, 'VISUAL_CANDIDATE');
    assert.equal(state.evaluation.metricState, 'SYNTHETIC_NOT_A_REVIEW');
    assert.deepEqual([f.labels, f.answers].map(file => readFileSync(file, 'utf8')), before);
    writeFileSync(file, '{broken'); assert.equal(loadAssisted(file, f.images).status, 'BLOCKED');
  } finally { await server?.close(); f.cleanup(); }
});
