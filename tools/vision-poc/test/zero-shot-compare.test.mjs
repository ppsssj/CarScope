// The comparison script end to end, on drawn numbers only. No model and no photo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/zero-shot-compare.mjs', import.meta.url));
const cap = [0.1, 0.1, 0.2, 0.2], far = [0.6, 0.6, 0.2, 0.2];
const picture = (id, labels, confusers = []) => ({ id, split: 'exploratory', vehicle: { make: 'M', model: id }, conditions: {}, labels, confusers });
const images = [picture('blue', [{ box: cap, capColor: 'blue' }]), picture('black', [{ box: cap, capColor: 'black' }]), picture('none', [], [{ kind: 'coolant-cap', box: cap }])];
const prompts = { contrast: ['windshield washer fluid cap', 'radiator coolant cap'], single: ['windshield washer fluid cap'], generic: ['cap'] };
const washer = (box, score) => ({ label: 'windshield washer fluid cap', box, score }), coolant = (box, score) => ({ label: 'radiator coolant cap', box, score });
const entry = rows => ({ width: 100, height: 100, modes: Object.fromEntries(Object.keys(prompts).map(mode => [mode, { ms: 1, predictions: rows }])) });
const run = results => ({ model: 'owlv2', repo: 'r', revision: 'v', device: 'cpu', threads: 4, versions: {}, prompts, rawThreshold: 0.02, loadMs: 1, parameters: 1, rssBeforeBytes: 1, rssPeakBytes: 2, medianMs: { contrast: 5, single: 5, generic: 5 }, results });

async function compare(results, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-zs-'));
  try {
    const manifest = path.join(dir, 'm.json'), zero = path.join(dir, 'z.json'), out = path.join(dir, 'o.json'), args = [script, manifest, out, '--zero-shot', zero];
    await writeFile(manifest, '﻿' + JSON.stringify({ images }));
    await writeFile(zero, JSON.stringify(run(results)));
    for (const [flag, body] of Object.entries(extra)) { const file = path.join(dir, `${flag}.json`); await writeFile(file, JSON.stringify(body)); args.push(`--${flag}`, file); }
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    return { status: result.status, stderr: result.stderr, report: result.status === 0 ? JSON.parse(await readFile(out, 'utf8')) : null };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the report is preliminary, keeps the formal gate apart and scores contrast by the washer label only', async () => {
  const { status, report, stderr } = await compare({ blue: entry([washer(cap, 0.5), coolant(far, 0.9)]), black: entry([coolant(cap, 0.6)]), none: entry([]) });
  assert.equal(status, 0, stderr);
  assert.equal(report.evaluationType, 'EXPLORATORY_EVALUATION');
  assert.equal(report.preliminary, true);
  assert.equal(report.formalEvaluation, 'NOT_MEASURED');
  assert.equal(report.formalDatasetCheck, 'DATASET_INVALID');
  const contrast = report.detectors.owlv2.modes.contrast;
  assert.deepEqual([contrast.operating.tp, contrast.operating.fp, contrast.operating.fn], [1, 0, 1]);
  assert.equal(contrast.reliability.verdict, 'NOT_RELIABLE', 'recall 0.5 and the black cap named as coolant');
  assert.deepEqual(contrast.localization.find(l => l.id === 'black'), { id: 'black', boxOnCap: true, topLabel: 'radiator coolant cap', topScore: 0.6, namedAsTarget: false });
});

test('a washer label on the coolant cap is reported by name', async () => {
  const { report } = await compare({ blue: entry([washer(cap, 0.5)]), black: entry([washer(cap, 0.5)]), none: entry([washer(cap, 0.9)]) });
  const contrast = report.detectors.owlv2.modes.contrast;
  assert.deepEqual(contrast.operating.confuserFalsePositives, { 'coolant-cap': ['none'] });
  assert.equal(contrast.reliability.checks.confusers, false);
  assert.equal(contrast.reliability.verdict, 'NOT_RELIABLE');
});

test('even a perfect result on these numbers earns only a larger evaluation', async () => {
  const { report } = await compare({ blue: entry([washer(cap, 0.5)]), black: entry([washer(cap, 0.5)]), none: entry([]) });
  assert.equal(report.detectors.owlv2.modes.contrast.reliability.verdict, 'WORTH_LARGER_EVALUATION');
  assert.equal(report.formalEvaluation, 'NOT_MEASURED');
});

test('the other detectors join the same table: the colour rule without a score, the public model with one', async () => {
  const fixed = rows => ({ endpoint: 'X', results: Object.fromEntries(images.map(i => [i.id, { candidates: rows[i.id] ?? [], others: [] }])) });
  const { status, report, stderr } = await compare({ blue: entry([]), black: entry([]), none: entry([]) }, { colour: fixed({ blue: [{ box: cap, score: null }] }), roboflow: fixed({ blue: [{ box: cap, score: 0.8 }] }) });
  assert.equal(status, 0, stderr);
  assert.equal(report.detectors['colour-rule'].map50, 'NOT_APPLICABLE');
  assert.equal(report.detectors['colour-rule'].operating.tp, 1);
  assert.equal(report.detectors['yolov8-engine-bay-parts'].operating.tp, 1);
  assert.equal(report.detectors['yolov8-engine-bay-parts'].reliability.verdict, 'NOT_RELIABLE');
});

test('a photo without a result stops the comparison', async () => {
  const { status } = await compare({ blue: entry([]), black: entry([]) });
  assert.notEqual(status, 0);
});
