// P12-C: runs the existing blue heuristic on real photos the way the mobile page does: browser decode, at most 320×240, unmodified detector.mjs.
//   node scripts/color-baseline-run.mjs <manifest.json> <image folder> <results.json>   (needs `npm ci` in tools/mobile-ar-poc for Playwright)
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { fileErrors } from '../src/dataset.mjs';
import { validateExploratorySet } from '../src/exploratory.mjs';

const [manifestPath, root, outPath] = process.argv.slice(2);
if (!manifestPath || !root || !outPath) { console.error('Usage: color-baseline-run.mjs <manifest.json> <image folder> <results.json>'); process.exit(64); }
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const errors = [...validateExploratorySet(manifest).errors, ...await fileErrors(manifest, root)];
if (errors.length) { console.log(JSON.stringify({ status: 'EXPLORATORY_INVALID', errors }, null, 2)); process.exit(2); }

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const server = await startServer({ modelPath: '', manifestPath: '' });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(`${server.url}/`);
const results = {};
for (const image of manifest.images) {
  const bytes = [...await readFile(path.resolve(root, image.file))];
  const candidates = await page.evaluate(async bytes => {
    const { detectCandidates } = await import('/baseline/detector.mjs');
    const { toBaselinePredictions } = await import('/contract/detection-contract.mjs');
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const scale = Math.min(320 / bitmap.width, 240 / bitmap.height, 1), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * scale)); c.height = Math.max(1, Math.round(bitmap.height * scale));
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bitmap, 0, 0, c.width, c.height);
    return toBaselinePredictions(detectCandidates(x.getImageData(0, 0, c.width, c.height)));
  }, bytes);
  results[image.id] = { candidates: candidates.map(({ box, score }) => ({ box, score })), others: [] };
}
await browser.close();
await server.close();
await writeFile(outPath, JSON.stringify({ modelId: 'blue-component-heuristic', endpoint: 'LOCAL_BROWSER', calls: 0, answered: manifest.images.length, failures: [], results }, null, 1));
console.log(JSON.stringify({ status: 'OK', images: manifest.images.length }));
