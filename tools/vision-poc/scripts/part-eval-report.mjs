// P12-F: turns stored answers into the evaluation report. Makes no call. Figures are preliminary: see the manifest's note.
//   node scripts/part-eval-report.mjs <manifest.json> <answers.json> <report.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { candidatesFor } from '../../mobile-ar-poc/public/part-detection.mjs';
import { parseRoboflowResponse } from '../src/roboflow-adapter.mjs';
import { confusions, scoreClass, sizeAgainstPart } from '../src/part-evaluation.mjs';

const [manifestPath, answersPath, reportPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')), { answers } = JSON.parse(readFileSync(answersPath, 'utf8'));
const { images, classes, rule } = manifest;
const fix = v => (v === null ? null : Number(v.toFixed(2)));
const line = r => `${r.part.padEnd(8)} ${r.match.padEnd(8)} t=${String(r.threshold).padEnd(4)} photos=${String(r.photos).padEnd(2)} pos=${String(r.positives).padEnd(2)} TP=${String(r.tp).padEnd(2)} FP=${String(r.fp).padEnd(2)} FN=${String(r.fn).padEnd(2)} ign=${r.ignored} P=${fix(r.precision)} ${JSON.stringify(r.precision95?.map(fix))} R=${fix(r.recall)} ${JSON.stringify(r.recall95?.map(fix))}`;

const scores = [];
for (const [part, className] of Object.entries(classes)) for (const match of ['strict', 'location']) for (const threshold of rule.thresholds) scores.push(scoreClass({ images, answers, part, className, threshold, match }));
for (const r of scores) console.log(line(r));

const report = {
  evaluationType: manifest.evaluationType, model: manifest.model, labelsReviewedByPerson: manifest.labelsReviewedByPerson, photos: images.length, answered: Object.keys(answers).length,
  scores,
  sizeAgainstPart: Object.fromEntries(Object.entries(classes).map(([part, className]) => [part, sizeAgainstPart({ images, answers, part, className, threshold: rule.primaryThreshold })])),
  confusionsAtPrimary: confusions({ images, answers, classes, threshold: rule.primaryThreshold }),
  numbered: {},
};
// Other tank classes: how often, and on what. Never counted as any of the six parts.
const OTHERS = ['Inverter Coolant Reservoir', 'Secondary Coolant Reservoir', 'Intercooler Coolant Reservoir', 'Electric Motor', 'Radiator Cap', 'Clutch Fluid Reservoir', 'Power Steering Reservoir', 'ABS Unit'];
report.otherClasses = Object.fromEntries(OTHERS.map(name => [name, images.flatMap(image => (answers[image.id]?.predictions ?? []).filter(p => p.class === name && p.confidence >= 0.25).map(p => ({ id: image.id, vehicle: image.vehicle, score: Number(p.confidence.toFixed(3)) })))]));
// What the service would really hand to the page at its fixed threshold, per photo, and how long that conversion takes on real answers.
const conversion = [];
report.candidatesPerPhoto = {};
for (const image of images) {
  const raw = answers[image.id];
  if (!raw) continue;
  const started = performance.now();
  const parsed = parseRoboflowResponse(raw);
  report.candidatesPerPhoto[image.id] = Object.fromEntries(['washer-fluid-cap', 'coolant-reservoir', 'brake-fluid-reservoir', 'fuse-box', 'battery-12v', 'lcw-coolant-reservoir'].map(id => [id, candidatesFor(id, parsed).length]));
  conversion.push(performance.now() - started);
}
conversion.sort((a, b) => a - b);
report.conversionMs = { photos: conversion.length, median: Number(conversion[Math.floor(conversion.length / 2)]?.toFixed(3)), max: Number(conversion.at(-1)?.toFixed(3)) };
console.log('sizes', JSON.stringify(report.sizeAgainstPart));
console.log('confusions', JSON.stringify(report.confusionsAtPrimary));
console.log('others', JSON.stringify(report.otherClasses));
console.log('conversion', JSON.stringify(report.conversionMs));
writeFileSync(reportPath, JSON.stringify(report, null, 1));
