// P12-B: decides whether a labelled dataset exists and may be used. No metric is reported before this says DATASET_READY.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TARGET_CLASS } from './detection-contract.mjs';

export const DATASET_STATUS = Object.freeze({ REQUIRED: 'DATASET_REQUIRED', INVALID: 'DATASET_INVALID', READY: 'DATASET_READY' });

// Fixed before any data exists, so results cannot move them. An entry gate for a first evaluation, not a statistical proof.
export const DATASET_GATE = Object.freeze({
  vehicles: 30,
  makes: 5,
  positiveImages: 300,
  nonBlueTargetImages: 30,
  hardNegativeImages: 150,
  testPositiveImages: 60,
  testVehicles: 6,
  testIoniq5PositiveImages: 10,
  testConfusersPerKind: 20, // coolant-cap and brake-fluid-cap
  testPositivesPerHardCondition: 15, // low light, partial occlusion, oblique angle, reflection
});

export const ALLOWED_LICENSES = Object.freeze(['OWNER_CONSENT', 'CC0-1.0', 'PDM-1.0', 'CC-BY-4.0']);
export const CONFUSER_KINDS = Object.freeze(['coolant-cap', 'brake-fluid-cap', 'oil-cap', 'other-fluid-cap', 'other-blue-object']);
export const LABEL_TRUTH = Object.freeze(['SYMBOL_VISIBLE', 'OWNER_MANUAL_CONFIRMED']); // A label must rest on the marking or the manual, not on colour.
export const DHASH_MAX_HAMMING = 6;

const SPLITS = ['train', 'val', 'test'];
const CONDITIONS = {
  lighting: ['daylight', 'shade', 'low-light'],
  angle: ['top', 'oblique', 'side'],
  distance: ['wide', 'closeup'],
  occlusion: ['none', 'partial'],
  reflection: ['none', 'present'],
};
const validBox = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1.000001 && b[1] + b[3] <= 1.000001;
const hamming = (a, b) => { let bits = 0; for (let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); x; x &= x - 1n) bits++; return bits; };

export function imageErrors(image, { splits = SPLITS, licenses = ALLOWED_LICENSES } = {}) {
  const e = [], at = message => e.push(`${image?.id ?? '(no id)'}: ${message}`);
  if (!image?.id || !image.file) at('id and file are required');
  if (!/^[0-9a-f]{64}$/.test(image?.sha256 ?? '')) at('sha256 is required');
  if (!/^[0-9a-f]{16}$/.test(image?.dhash ?? '')) at('dhash is required');
  if (!splits.includes(image?.split)) at(`split must be ${splits.join(', ')}`);
  const license = image?.license;
  if (!licenses.includes(license?.id)) at(`license ${license?.id ?? 'missing'} is not allowed`);
  else if (license.id === 'OWNER_CONSENT' ? !license.consentRecord : !license.source) at('license needs its consent record or source page');
  if (license?.id?.startsWith('CC-BY') && !license.attribution) at(`license ${license.id} needs attribution`);
  const vehicle = image?.vehicle;
  if (!vehicle?.make || !vehicle.model || !vehicle.groupId || !vehicle.verifiedBy) at('vehicle make, model, groupId and verifiedBy are required');
  if (!image?.captureSessionId) at('captureSessionId is required');
  if (image?.privacyReviewed !== true) at('privacy review is required (plates, faces, people)');
  for (const [key, values] of Object.entries(CONDITIONS)) if (!values.includes(image?.conditions?.[key])) at(`condition ${key} must be one of ${values.join(', ')}`);
  if (!Array.isArray(image?.labels) || !Array.isArray(image?.confusers)) { at('labels and confusers must be arrays; use [] for none'); return e; }
  for (const label of image.labels) {
    if (label?.class !== TARGET_CLASS) at(`label class must be ${TARGET_CLASS}`);
    if (!validBox(label?.box)) at('label box must be normalized [x, y, width, height]');
    if (!LABEL_TRUTH.includes(label?.truth)) at('label truth must be the visible symbol or the owner manual');
    if (typeof label?.capColor !== 'string' || !label.capColor) at('label capColor is required');
  }
  for (const confuser of image.confusers) {
    if (!CONFUSER_KINDS.includes(confuser?.kind)) at(`confuser kind ${confuser?.kind} is unknown`);
    if (!validBox(confuser?.box)) at('confuser box must be normalized [x, y, width, height]');
  }
  return e;
}

// Train, val and test must not share a vehicle, a capture session, a file or a near-identical frame.
export function leakageErrors(images) {
  const errors = [];
  for (const [name, read] of [['vehicle', i => i.vehicle?.groupId], ['capture session', i => i.captureSessionId], ['file', i => i.sha256]]) {
    const seen = new Map();
    for (const image of images) {
      const value = read(image);
      if (!value) continue;
      if (!seen.has(value)) seen.set(value, new Set());
      seen.get(value).add(image.split);
    }
    for (const [value, splits] of seen) if (splits.size > 1) errors.push(`leakage: ${name} ${value} is in ${[...splits].join(' and ')}`);
  }
  for (let a = 0; a < images.length; a++) for (let b = a + 1; b < images.length; b++) {
    const x = images[a], y = images[b];
    if (x.split === y.split || !/^[0-9a-f]{16}$/.test(x.dhash ?? '') || !/^[0-9a-f]{16}$/.test(y.dhash ?? '')) continue;
    if (hamming(x.dhash, y.dhash) <= DHASH_MAX_HAMMING) errors.push(`leakage: ${x.id} (${x.split}) and ${y.id} (${y.split}) are near-identical`);
  }
  return errors;
}

export function datasetCounts(images) {
  const positive = images.filter(i => i.labels?.length), test = images.filter(i => i.split === 'test'), testPositive = test.filter(i => i.labels?.length);
  const inTest = kind => test.reduce((sum, i) => sum + (i.confusers ?? []).filter(c => c.kind === kind).length, 0);
  const hard = read => testPositive.filter(read).length;
  return {
    images: images.length,
    vehicles: new Set(images.map(i => i.vehicle?.groupId).filter(Boolean)).size,
    makes: new Set(images.map(i => i.vehicle?.make?.toLowerCase()).filter(Boolean)).size,
    positiveImages: positive.length,
    nonBlueTargetImages: positive.filter(i => i.labels.some(l => !/blue|파랑|파란/i.test(l.capColor ?? ''))).length,
    hardNegativeImages: images.filter(i => !i.labels?.length && i.confusers?.length).length,
    testPositiveImages: testPositive.length,
    testVehicles: new Set(test.map(i => i.vehicle?.groupId).filter(Boolean)).size,
    testIoniq5PositiveImages: testPositive.filter(i => /ioniq\s*5/i.test(i.vehicle?.model ?? '')).length,
    testCoolantConfusers: inTest('coolant-cap'),
    testBrakeConfusers: inTest('brake-fluid-cap'),
    testLowLightPositives: hard(i => i.conditions?.lighting === 'low-light'),
    testOccludedPositives: hard(i => i.conditions?.occlusion === 'partial'),
    testObliquePositives: hard(i => i.conditions?.angle === 'oblique'),
    testReflectionPositives: hard(i => i.conditions?.reflection === 'present'),
  };
}

function shortfalls(counts) {
  const g = DATASET_GATE;
  const need = [['vehicles', g.vehicles], ['makes', g.makes], ['positiveImages', g.positiveImages], ['nonBlueTargetImages', g.nonBlueTargetImages], ['hardNegativeImages', g.hardNegativeImages], ['testPositiveImages', g.testPositiveImages], ['testVehicles', g.testVehicles], ['testIoniq5PositiveImages', g.testIoniq5PositiveImages], ['testCoolantConfusers', g.testConfusersPerKind], ['testBrakeConfusers', g.testConfusersPerKind], ['testLowLightPositives', g.testPositivesPerHardCondition], ['testOccludedPositives', g.testPositivesPerHardCondition], ['testObliquePositives', g.testPositivesPerHardCondition], ['testReflectionPositives', g.testPositivesPerHardCondition]];
  return need.filter(([key, required]) => counts[key] < required).map(([key, required]) => ({ key, have: counts[key], required }));
}

export function validateDataset(manifest) {
  const images = Array.isArray(manifest?.images) ? manifest.images : [];
  const counts = datasetCounts(images);
  const ids = images.map(i => i?.id).filter(Boolean);
  const errors = [...images.flatMap(imageErrors), ...(new Set(ids).size === ids.length ? [] : ['image ids must be unique']), ...leakageErrors(images)];
  const missing = shortfalls(counts);
  const status = errors.length ? DATASET_STATUS.INVALID : missing.length ? DATASET_STATUS.REQUIRED : DATASET_STATUS.READY;
  return { status, counts, shortfalls: missing, errors };
}

// A manifest entry only counts if its file is really there with the recorded contents.
export async function fileErrors(manifest, root) {
  const errors = [];
  for (const image of manifest?.images ?? []) {
    const file = path.resolve(root, image.file ?? '');
    if (file !== path.resolve(root) && !file.startsWith(path.resolve(root) + path.sep)) { errors.push(`${image.id}: file is outside the dataset root`); continue; }
    try { if (createHash('sha256').update(await readFile(file)).digest('hex') !== image.sha256) errors.push(`${image.id}: sha256 does not match the file`); }
    catch { errors.push(`${image.id}: file is missing`); }
  }
  return errors;
}
