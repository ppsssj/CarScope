// P12-D: one preliminary table for every detector on one manifest. Needs result files from run_zero_shot.py, plus the YOLOv8 and colour results when available.
//   node scripts/zero-shot-compare.mjs <manifest.json> <out.json> --zero-shot a.json,b.json [--roboflow results.json] [--colour results.json]
import { readFile, writeFile } from 'node:fs/promises';
import { validateDataset } from '../src/dataset.mjs';
import { EVALUATION_TYPE, OPERATING_POINTS, casesAt, confuserCheck, localizationCheck, nonMaxSuppress, scoreAt, subsets, targetPredictions, verdictFor } from '../src/zero-shot-evaluate.mjs';

const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const [manifestPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!manifestPath || !outPath || !option('--zero-shot')) { console.error('Usage: zero-shot-compare.mjs <manifest.json> <out.json> --zero-shot a.json,b.json [--roboflow r.json] [--colour c.json]'); process.exit(64); }
const read = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
const manifest = await read(manifestPath), images = manifest.images;
const sweep = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7];
const report = { evaluationType: EVALUATION_TYPE, preliminary: true, formalEvaluation: 'NOT_MEASURED', formalDatasetCheck: validateDataset(manifest).status, images: images.length, targets: images.filter(i => i.labels.length).length, detectors: {} };

for (const file of option('--zero-shot').split(',')) {
  const run = await read(file), byMode = {};
  for (const mode of Object.keys(run.prompts)) {
    const all = Object.fromEntries(images.map(i => [i.id, run.results[i.id].modes[mode].predictions]));
    // generic asks for any cap, so every row is a box on a cap by its own definition and the check below uses it for localization only.
    const target = Object.fromEntries(images.map(i => [i.id, mode === 'generic' ? nonMaxSuppress(all[i.id]) : targetPredictions(all[i.id])]));
    const threshold = OPERATING_POINTS[run.model];
    const operating = scoreAt({ images, predictionsById: target, threshold });
    const allMetrics = scoreAt({ images, predictionsById: target, threshold: run.rawThreshold });
    const curve = sweep.filter(t => t >= run.rawThreshold).map(t => scoreAt({ images, predictionsById: target, threshold: t }));
    const f1 = m => (m.precision && m.recall ? (2 * m.precision * m.recall) / (m.precision + m.recall) : 0);
    byMode[mode] = {
      threshold, operating, map50: allMetrics.ap50, bestF1OnThisSet: curve.reduce((a, b) => (f1(b) > f1(a) ? b : a)),
      curve: curve.map(({ threshold: t, tp, fp, fn, precision, recall }) => ({ threshold: t, tp, fp, fn, precision, recall })),
      cases: casesAt({ images, predictionsById: target, threshold }),
      localization: localizationCheck({ images, allPredictionsById: all, threshold }),
      confusers: confuserCheck({ images, allPredictionsById: all, threshold }),
      black: scoreAt({ images: subsets.black(images), predictionsById: target, threshold }),
      small: scoreAt({ images: subsets.small(images), predictionsById: target, threshold }),
    };
    if (mode !== 'generic') byMode[mode].reliability = verdictFor(operating, images, target, threshold);
  }
  report.detectors[run.model] = { kind: 'TEXT_PROMPT', repo: run.repo, revision: run.revision, device: run.device, threads: run.threads, versions: run.versions, loadMs: run.loadMs, parameters: run.parameters, rssBeforeBytes: run.rssBeforeBytes, rssPeakBytes: run.rssPeakBytes, medianMs: run.medianMs, modes: byMode };
}

async function fixed(name, file, threshold, map) {
  if (!file) return;
  const run = await read(file);
  const target = Object.fromEntries(images.map(i => [i.id, run.results[i.id].candidates.map(c => ({ box: c.box, score: c.score }))]));
  const all = Object.fromEntries(images.map(i => [i.id, [...target[i.id].map(c => ({ ...c, label: 'windshield washer' })), ...(run.results[i.id].others ?? []).map(o => ({ box: o.box, score: o.score, label: o.className }))]]));
  const operating = scoreAt({ images, predictionsById: target, threshold });
  report.detectors[name] = { kind: map, endpoint: run.endpoint, operating, map50: threshold === null ? 'NOT_APPLICABLE' : scoreAt({ images, predictionsById: target, threshold: 0.05 }).ap50, cases: casesAt({ images, predictionsById: target, threshold }), localization: localizationCheck({ images, allPredictionsById: all, threshold: threshold ?? 0 }), black: scoreAt({ images: subsets.black(images), predictionsById: target, threshold }), small: scoreAt({ images: subsets.small(images), predictionsById: target, threshold }), reliability: threshold === null ? null : verdictFor(operating, images, target, threshold) };
}
await fixed('yolov8-engine-bay-parts', option('--roboflow'), 0.3, 'TRAINED_PUBLIC_MODEL');
await fixed('colour-rule', option('--colour'), null, 'HEURISTIC');
await writeFile(outPath, JSON.stringify(report, null, 1));
const line = (name, m, map, extra = '') => console.log(`${name.padEnd(30)} ${m.tp}/${m.fp}/${m.fn} P=${m.precision?.toFixed(2) ?? '-'} R=${m.recall?.toFixed(2)} mAP=${typeof map === 'number' ? map.toFixed(2) : map} ${extra}`);
for (const [name, d] of Object.entries(report.detectors)) {
  if (d.kind === 'TEXT_PROMPT') for (const [mode, m] of Object.entries(d.modes)) line(`${name}/${mode}@${m.threshold}`, m.operating, m.map50, `${m.reliability?.verdict ?? ''} ${d.medianMs[mode]}ms`);
  else line(name, d.operating, d.map50, d.reliability?.verdict ?? '');
}
