// P12-G: a made-up evaluation set in a temporary folder: generated pictures, invented labels and invented model answers. Nothing here is a car, a real answer or a human review.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { PNG } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('pngjs');
export const WIDTH = 800, HEIGHT = 500;
function picture(shade) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = shade; png.data[i + 1] = shade + 10; png.data[i + 2] = shade + 20; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** A prediction from fractions, in the shape the hosted model answers: centre and size in pixels. */
export const predicted = (className, confidence, [x, y, w, h]) => ({ class: className, confidence, x: (x + w / 2) * WIDTH, y: (y + h / 2) * HEIGHT, width: w * WIDTH, height: h * HEIGHT });

export const WASHER = [0.1, 0.1, 0.2, 0.2], COOLANT = [0.5, 0.5, 0.2, 0.2], ELSEWHERE = [0.75, 0.05, 0.1, 0.1];

export function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'carscope-review-'));
  const images = join(dir, 'images'); mkdirSync(images);
  const ids = ['syn-a', 'syn-b', 'syn-c'];
  const manifestImages = ids.map((id, index) => {
    const bytes = picture(40 + index * 30); writeFileSync(join(images, `${id}.png`), bytes);
    return { id, file: `${id}.png`, root: 'P12F', sha256: sha(bytes), license: 'CC0-1.0', source: 'https://commons.wikimedia.org/wiki/File:synthetic', attribution: 'generated', vehicle: `Synthetic ${index}`, electrified: index === 1, inference: 'REAL_CALL', parts: {} };
  });
  manifestImages[0].parts = { washer: { boxes: [WASHER] }, coolant: { boxes: [COOLANT], caps: [[0.55, 0.5, 0.05, 0.05]] }, hv: [[0.3, 0.3, 0.1, 0.1]] };
  manifestImages[1].parts = { washer: { boxes: [] } };
  const manifest = { evaluationType: 'EXPLORATORY_EVALUATION', model: 'synthetic', labelsReviewedByPerson: false, images: manifestImages };
  const labels = join(dir, 'labels.json'); writeFileSync(labels, `${JSON.stringify(manifest, null, 1)}\n`);
  const answers = join(dir, 'answers.json');
  const image = { width: WIDTH, height: HEIGHT };
  writeFileSync(answers, JSON.stringify({ answers: {
    'syn-a': { image, predictions: [predicted('Windshield Wiper Fluid', 0.8, WASHER), predicted('Windshield Wiper Fluid', 0.6, ELSEWHERE), predicted('Radiator Cap', 0.7, [0.4, 0.1, 0.1, 0.1]), predicted('Engine Coolant Reservoir', 0.3, COOLANT)] },
    'syn-b': { image, predictions: [predicted('Windshield Wiper Fluid', 0.9, ELSEWHERE)] },
    'syn-c': { image, predictions: [] },
  } }));
  return { dir, labels, answers, roots: { P12F: images }, review: join(dir, 'review', 'review.json'), images: manifestImages, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
export const dataOf = fixture => ({ labels: fixture.labels, answers: fixture.answers, roots: fixture.roots });
