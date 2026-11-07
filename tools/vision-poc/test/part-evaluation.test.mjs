// P12-F: the scoring rules, the call limit and the label file. No model and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallLimitReached, CALL_LIMIT, createCallLedger, ledgeredFetch } from '../src/call-ledger.mjs';
import { EXPLORATORY_LICENSES } from '../src/exploratory.mjs';
import { boxesOf, confusions, MATCH, scoreClass, scorePhoto, sizeAgainstPart } from '../src/part-evaluation.mjs';

const answer = (...predictions) => ({ image: { width: 100, height: 100 }, predictions });
const P = (name, confidence, x, y, width, height) => ({ class: name, confidence, x, y, width, height });
const images = [
  { id: 'a', parts: { fuse: { boxes: [[0.1, 0.1, 0.2, 0.2]] }, hv: [[0.6, 0.6, 0.3, 0.3]] } },
  { id: 'b', parts: { fuse: { boxes: [] } } },
  { id: 'c', parts: { battery: { boxes: [[0.1, 0.1, 0.2, 0.2]] } } }, // Fuse box unknown here.
];
const answers = { a: answer(P('Fuse Box', 0.9, 20, 20, 20, 20), P('Fuse Box', 0.8, 75, 75, 10, 10), P('12', 0.99, 20, 20, 20, 20)), b: answer(P('Fuse Box', 0.5, 50, 50, 10, 10)), c: answer(P('Fuse Box', 0.9, 50, 50, 10, 10)) };

test('only the exact class counts, as fractions of the picture, best first', () => {
  const boxes = boxesOf(answers.a, 'Fuse Box');
  assert.deepEqual(boxes.map(b => b.score), [0.9, 0.8]);
  assert.deepEqual(boxes[0].box, [0.1, 0.1, 0.2, 0.2]);
  assert.equal(boxesOf(answers.a, 'Fuse').length, 0);
});

test('a photo where the part is unknown is out of the count; a labelled absence is not', () => {
  const r = scoreClass({ images, answers, part: 'fuse', className: 'Fuse Box', threshold: 0.4 });
  assert.deepEqual([r.photos, r.positives, r.tp, r.fp, r.fn], [2, 1, 1, 2, 0]);
  assert.equal(r.precision, 1 / 3);
  assert.equal(r.recall, 1);
  assert.ok(r.cases.every(c => c.id !== 'c'));
  const high = scoreClass({ images, answers, part: 'fuse', className: 'Fuse Box', threshold: 0.95 });
  assert.deepEqual([high.tp, high.fp, high.fn, high.precision], [0, 0, 1, null]);
});

test('strict needs IoU 0.5; location needs the centre on the part and a box not much larger; a cap counts as the part', () => {
  const whole = [0.2, 0.2, 0.4, 0.4], cap = [0.3, 0.2, 0.1, 0.1];
  assert.equal(MATCH.strict([0.2, 0.2, 0.4, 0.35], whole), true);
  assert.equal(MATCH.strict([0.3, 0.2, 0.1, 0.1], whole), false, 'a cap box against the whole tank');
  assert.equal(MATCH.strict([0.3, 0.2, 0.1, 0.1], whole, [cap]), true);
  assert.equal(MATCH.location([0.3, 0.2, 0.1, 0.1], whole), true);
  assert.equal(MATCH.location([0, 0, 1, 1], whole), false, 'centre on it, but far too large');
  assert.equal(MATCH.location([0.8, 0.8, 0.1, 0.1], whole), false);
});

test('one box takes one part, a second box on it is false, and a look-alike marked ignore counts neither way', () => {
  const label = { boxes: [[0.1, 0.1, 0.2, 0.2]], ignore: [[0.6, 0.6, 0.2, 0.2]] };
  const on = { box: [0.1, 0.1, 0.2, 0.2] }, there = { box: [0.62, 0.62, 0.15, 0.15] };
  assert.deepEqual(scorePhoto([on, on], label, MATCH.strict), { tp: 1, fp: 1, fn: 0, ignored: 0 });
  assert.deepEqual(scorePhoto([there], label, MATCH.strict), { tp: 0, fp: 0, fn: 1, ignored: 1 });
});

test('confusions name where boxes land, high voltage regions included', () => {
  const table = confusions({ images, answers, classes: { fuse: 'Fuse Box' }, threshold: 0.4 });
  assert.deepEqual(table.fuse.fuse, [{ id: 'a', score: 0.9 }]);
  assert.deepEqual(table.fuse.hv, [{ id: 'a', score: 0.8 }]);
  assert.equal(table.fuse.elsewhere.length, 2);
  assert.deepEqual(sizeAgainstPart({ images, answers, part: 'fuse', className: 'Fuse Box', threshold: 0.4 }), { count: 1, median: 1, min: 1, max: 1 });
});

test('the ledger counts before sending, keeps counting across instances, and stops at the limit', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-')), file = join(dir, 'calls.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(CALL_LIMIT, 20);
  const ledger = createCallLedger({ file, limit: 2 });
  const seen = [];
  const fetched = ledgeredFetch({ ledger, purpose: 'x', fetchImpl: async (url, init) => { seen.push(createCallLedger({ file, limit: 2 }).count); return new Response('{"a":1}', { status: 200 }); } });
  const r = await fetched('u', { body: 'abcd' });
  assert.deepEqual(await r.json(), { a: 1 });
  assert.deepEqual(seen, [1], 'already counted while it runs');
  await assert.rejects(ledgeredFetch({ ledger, purpose: 'y', fetchImpl: async () => { throw new Error('boom'); } })('u', {}), /boom/);
  await assert.rejects(fetched('u', {}), CallLimitReached);
  assert.equal(seen.length, 1);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.calls.length, 2);
  assert.equal(stored.calls[0].requestBytes, 4);
  assert.equal(stored.calls[1].error, 'Error');
  assert.deepEqual(Object.keys(stored.calls[0]).sort(), ['at', 'httpStatus', 'n', 'purpose', 'requestBytes', 'responseBytes', 'roundTripMs']);
});

test('the label file: not reviewed and saying so, sound boxes, known classes, licences, within the call budget', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dataset/p12-f-bonnet-parts.json', import.meta.url), 'utf8'));
  assert.equal(manifest.labelsReviewedByPerson, false);
  assert.equal(manifest.evaluationType, 'EXPLORATORY_EVALUATION');
  assert.equal(manifest.model, 'engine-bay-parts/1');
  // Neither class is mapped to low-conductivity coolant: no label exists for it.
  assert.deepEqual(Object.keys(manifest.classes).sort(), ['battery', 'brake', 'coolant', 'fuse', 'washer']);
  assert.ok(manifest.images.filter(i => i.inference === 'REAL_CALL').length <= CALL_LIMIT);
  assert.equal(new Set(manifest.images.map(i => i.sha256)).size, manifest.images.length);
  const sound = ([x, y, w, h]) => x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001;
  for (const image of manifest.images) {
    assert.ok(EXPLORATORY_LICENSES.includes(image.license), `${image.id} ${image.license}`);
    assert.ok(image.source.startsWith('https://commons.wikimedia.org/'), image.id);
    for (const [part, label] of Object.entries(image.parts)) {
      if (part === 'hv') { assert.ok(label.every(sound), image.id); continue; }
      assert.ok(Object.hasOwn(manifest.classes, part), part);
      for (const list of [label.boxes, label.caps ?? [], label.ignore ?? []]) assert.ok(list.every(sound), `${image.id} ${part}`);
    }
  }
});
