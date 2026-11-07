import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DATASET_GATE, DATASET_STATUS, fileErrors, leakageErrors, validateDataset } from '../src/dataset.mjs';

let serial = 0;
// Spreads dhash bits so unrelated synthetic records are never near-identical.
const dhashOf = n => createHash('sha256').update(`d${n}`).digest('hex').slice(0, 16);
function image(overrides = {}) {
  const n = ++serial;
  return {
    id: `img-${n}`, file: `img-${n}.jpg`, sha256: createHash('sha256').update(`f${n}`).digest('hex'), dhash: dhashOf(n), split: 'train',
    license: { id: 'OWNER_CONSENT', consentRecord: `consent-${n}` },
    vehicle: { make: 'Hyundai', model: 'IONIQ 5', groupId: 'veh-train', verifiedBy: 'OWNER_RECORD' }, captureSessionId: 'session-train', privacyReviewed: true,
    conditions: { lighting: 'daylight', angle: 'top', distance: 'wide', occlusion: 'none', reflection: 'none' },
    labels: [{ class: 'washer-fluid-cap', box: [0.1, 0.1, 0.2, 0.2], truth: 'SYMBOL_VISIBLE', capColor: 'blue' }], confusers: [], ...overrides,
  };
}

test('the real inventory in this repository is empty and says DATASET_REQUIRED', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dataset/manifest.json', import.meta.url), 'utf8'));
  const result = validateDataset(manifest);
  assert.equal(result.status, DATASET_STATUS.REQUIRED);
  assert.equal(result.counts.images, 0);
  assert.ok(result.shortfalls.some(s => s.key === 'positiveImages' && s.required === DATASET_GATE.positiveImages));
});

test('nothing at all is DATASET_REQUIRED, not ready and not an error', () => {
  for (const input of [null, {}, { images: [] }]) { const r = validateDataset(input); assert.equal(r.status, DATASET_STATUS.REQUIRED); assert.deepEqual(r.errors, []); }
});

test('unknown, non-commercial, share-alike and unproven licenses are refused', () => {
  for (const license of [undefined, { id: 'UNKNOWN', source: 'x' }, { id: 'CC-BY-NC-4.0', source: 'x' }, { id: 'CC-BY-SA-4.0', source: 'x' }, { id: 'OWNER_CONSENT' }, { id: 'CC0-1.0' }, { id: 'CC-BY-4.0', source: 'x' }]) {
    const r = validateDataset({ images: [image({ license })] });
    assert.equal(r.status, DATASET_STATUS.INVALID, JSON.stringify(license));
    assert.ok(r.errors.some(e => /license/.test(e)));
  }
  assert.deepEqual(validateDataset({ images: [image({ license: { id: 'CC-BY-4.0', source: 'https://example.invalid/p', attribution: 'Name' } })] }).errors, []);
});

test('vehicle identity, privacy review, conditions and label truth are required', () => {
  const cases = [{ vehicle: { make: 'Hyundai' } }, { privacyReviewed: false }, { conditions: { lighting: 'daylight' } }, { captureSessionId: '' },
    { labels: [{ class: 'washer-fluid-cap', box: [0, 0, 0.1, 0.1], truth: 'LOOKS_BLUE', capColor: 'blue' }] },
    { labels: [{ class: 'coolant-cap', box: [0, 0, 0.1, 0.1], truth: 'SYMBOL_VISIBLE', capColor: 'blue' }] },
    { labels: [{ class: 'washer-fluid-cap', box: [0.9, 0, 0.5, 0.1], truth: 'SYMBOL_VISIBLE', capColor: 'blue' }] },
    { confusers: [{ kind: 'mystery', box: [0, 0, 0.1, 0.1] }] }];
  for (const overrides of cases) assert.equal(validateDataset({ images: [image(overrides)] }).status, DATASET_STATUS.INVALID, JSON.stringify(overrides));
});

test('a vehicle, capture session, file or near-identical frame across splits is leakage', () => {
  const sameVehicle = [image(), image({ split: 'test', captureSessionId: 'other' })];
  assert.ok(leakageErrors(sameVehicle).some(e => /vehicle veh-train/.test(e)));
  const sameSession = [image(), image({ split: 'val', vehicle: { make: 'Kia', model: 'EV6', groupId: 'other', verifiedBy: 'OWNER_RECORD' } })];
  assert.ok(leakageErrors(sameSession).some(e => /capture session/.test(e)));
  const a = image(), other = { vehicle: { make: 'Kia', model: 'EV6', groupId: 'other', verifiedBy: 'OWNER_RECORD' }, captureSessionId: 'other' };
  assert.ok(leakageErrors([a, image({ split: 'test', sha256: a.sha256, ...other })]).some(e => /file/.test(e)));
  const near = (parseInt(a.dhash.slice(-1), 16) ^ 0b111).toString(16);
  assert.ok(leakageErrors([a, image({ split: 'test', dhash: a.dhash.slice(0, -1) + near, ...other })]).some(e => /near-identical/.test(e)), '3 bits apart');
  assert.deepEqual(leakageErrors([a, image({ split: 'test', ...other })]), [], 'unrelated frames');
  assert.deepEqual(leakageErrors([a, image({ dhash: a.dhash })]), [], 'near-identical inside one split is not leakage');
});

test('leakage makes a dataset invalid even when every count passes', () => {
  const full = readyDataset();
  assert.equal(validateDataset(full).status, DATASET_STATUS.READY);
  full.images.at(-1).vehicle.groupId = full.images[0].vehicle.groupId;
  full.images.at(-1).split = 'test';
  const result = validateDataset({ images: full.images.map((img, i) => (i === 0 ? { ...img, split: 'train' } : img)) });
  assert.equal(result.status, DATASET_STATUS.INVALID);
});

function readyDataset() {
  const g = DATASET_GATE, makes = ['Hyundai', 'Kia', 'Genesis', 'Toyota', 'Tesla'], images = [];
  const vehicle = (i, split, model = 'Model') => ({ make: makes[i % makes.length], model, groupId: `${split}-veh-${i}`, verifiedBy: 'OWNER_RECORD' });
  for (let i = 0; i < g.positiveImages - g.testPositiveImages; i++) images.push(image({ vehicle: vehicle(i % 24, 'train'), captureSessionId: `train-${i}` }));
  for (let i = 0; i < g.testPositiveImages; i++) images.push(image({
    split: 'test', vehicle: vehicle(i % g.testVehicles, 'test', i < g.testIoniq5PositiveImages ? 'IONIQ 5' : 'Model'), captureSessionId: `test-${i}`,
    conditions: { lighting: i % 4 === 0 ? 'low-light' : 'daylight', angle: i % 4 === 1 ? 'oblique' : 'top', distance: 'closeup', occlusion: i % 4 === 2 ? 'partial' : 'none', reflection: i % 4 === 3 ? 'present' : 'none' },
    labels: [{ class: 'washer-fluid-cap', box: [0.1, 0.1, 0.2, 0.2], truth: 'OWNER_MANUAL_CONFIRMED', capColor: i % 2 ? 'blue' : 'yellow' }],
    confusers: [{ kind: 'coolant-cap', box: [0.5, 0.5, 0.1, 0.1] }, { kind: 'brake-fluid-cap', box: [0.7, 0.5, 0.1, 0.1] }],
  }));
  for (let i = 0; i < g.hardNegativeImages; i++) images.push(image({ vehicle: vehicle(i % 24, 'train'), captureSessionId: `neg-${i}`, labels: [], confusers: [{ kind: 'coolant-cap', box: [0.1, 0.1, 0.2, 0.2] }] }));
  return { images };
}

test('every gate must pass: one image short keeps it DATASET_REQUIRED with the exact shortfall', () => {
  const full = readyDataset();
  const result = validateDataset(full);
  assert.equal(result.status, DATASET_STATUS.READY, JSON.stringify(result.shortfalls));
  const firstTrain = full.images.findIndex(i => i.split === 'train' && i.labels.length);
  const short = validateDataset({ images: full.images.filter((_, i) => i !== firstTrain) });
  assert.equal(short.status, DATASET_STATUS.REQUIRED);
  assert.deepEqual(short.shortfalls.map(s => [s.key, s.have, s.required]), [['positiveImages', DATASET_GATE.positiveImages - 1, DATASET_GATE.positiveImages]]);
});

test('colour alone cannot fill the set: non-blue targets are counted separately', () => {
  const full = readyDataset();
  for (const img of full.images) for (const label of img.labels) label.capColor = 'blue';
  assert.ok(validateDataset(full).shortfalls.some(s => s.key === 'nonBlueTargetImages'));
});

test('a manifest entry is only valid with its real file, inside the root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vision-dataset-'));
  try {
    await writeFile(path.join(root, 'real.bin'), 'content');
    const sha256 = createHash('sha256').update('content').digest('hex');
    assert.deepEqual(await fileErrors({ images: [{ id: 'a', file: 'real.bin', sha256 }] }, root), []);
    assert.match((await fileErrors({ images: [{ id: 'a', file: 'real.bin', sha256: '0'.repeat(64) }] }, root))[0], /does not match/);
    assert.match((await fileErrors({ images: [{ id: 'a', file: 'gone.bin', sha256 }] }, root))[0], /missing/);
    assert.match((await fileErrors({ images: [{ id: 'a', file: '../outside.bin', sha256 }] }, root))[0], /outside/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the status script reports DATASET_REQUIRED and no number for the real inventory', () => {
  const script = fileURLToPath(new URL('../scripts/dataset-status.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, DATASET_STATUS.REQUIRED);
  assert.equal(output.report.precision, 'NOT_MEASURED');
  assert.equal(output.report.map50, 'NOT_MEASURED');
  assert.equal(output.report.zFlip8, 'NOT_MEASURED');
});

test('the status script reads the manifest it is given, with or without --root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-status-'));
  try {
    const script = fileURLToPath(new URL('../scripts/dataset-status.mjs', import.meta.url)), manifest = path.join(dir, 'm.json');
    await writeFile(manifest, JSON.stringify({ images: [image()] }));
    const count = args => JSON.parse(spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }).stdout).counts.images;
    assert.equal(count([manifest]), 1);
    assert.equal(count([manifest, '--root', dir]), 1);
    assert.equal(count(['--root', dir, manifest]), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the evaluate script refuses to print a metric without a ready dataset', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-eval-'));
  try {
    const script = fileURLToPath(new URL('../scripts/evaluate.mjs', import.meta.url)), manifest = path.join(dir, 'm.json'), predictions = path.join(dir, 'p.json');
    await writeFile(manifest, JSON.stringify({ images: [] }));
    await writeFile(predictions, JSON.stringify({ source: 'x', sourceSha256: 'y', predictions: {} }));
    const result = spawnSync(process.execPath, [script, manifest, dir, predictions], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).recall, 'NOT_MEASURED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const pillow = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
test('the fingerprint script gives a near-identical hash for a brighter copy, and a far one for a different image', { skip: pillow ? false : 'Pillow is not installed' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-fp-'));
  try {
    const make = `
from PIL import Image
import sys
a = Image.new('L', (64, 64))
a.putdata([(x * 4 + (y // 8) * 11) % 256 for y in range(64) for x in range(64)])
a.save(sys.argv[1] + '/a.png')
a.point(lambda v: min(255, v + 8)).save(sys.argv[1] + '/b.png')
c = Image.new('L', (64, 64))
c.putdata([(255 - y * 4 + (x // 8) * 23) % 256 for y in range(64) for x in range(64)])
c.save(sys.argv[1] + '/c.png')
`;
    execFileSync('python', ['-c', make, dir]);
    const script = fileURLToPath(new URL('../scripts/fingerprint_images.py', import.meta.url));
    const [a, b, c] = execFileSync('python', [script, ...['a', 'b', 'c'].map(n => path.join(dir, `${n}.png`))], { encoding: 'utf8' }).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.match(a.dhash, /^[0-9a-f]{16}$/);
    assert.equal(a.sha256, createHash('sha256').update(await readFile(path.join(dir, 'a.png'))).digest('hex'));
    const pair = (x, y) => leakageErrors([{ id: 'x', split: 'train', dhash: x.dhash }, { id: 'y', split: 'test', dhash: y.dhash }]).length;
    assert.equal(pair(a, b), 1, 'brighter copy');
    assert.equal(pair(a, c), 0, 'different image');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
