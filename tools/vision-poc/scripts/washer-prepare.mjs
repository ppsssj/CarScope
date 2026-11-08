// P13-B: cuts the crops in Chrome with the P13-A code (cropWithContext), so the bytes are the ones the phone would send. No call to any model.
//   node scripts/washer-prepare.mjs              crops for photos with a completed truth and a region -> prepared/, checked against the reviewed rects
//   node scripts/washer-prepare.mjs --candidates preview sheets for every stored detection and P12-G human box -> prepared/candidates/ (not sendable)
// Outputs stay outside the repository.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../review/review-data.mjs';
import { assertOutside, WASHER_PATHS } from '../washer-eval/washer-eval-data.mjs';
import { startTruthServer } from '../washer-eval/washer-truth-server.mjs';
import { CROP_BASE, MARGIN_KEYS, MARGINS, PRODUCT_CROP, REGION_SOURCE, truthState } from '../washer-eval/washer-eval-model.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');

/** Runs in the page: decode with EXIF orientation, cut both margins, encode JPEG, and draw one preview sheet. */
async function cutInPage({ id, regions, cropBase, productCrop, margins, keys }) {
  const { contextCropPlan, cropWithContext } = await import('/mobile-ar-poc/public/context-crop.mjs');
  const blob = await (await fetch(`/images/${id}`)).blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const toB64 = async b => { const bytes = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const out = [];
  for (const region of regions) {
    const crops = {};
    // The P13-A product crop at both margins, planned only: does the margin change anything there?
    const product = margins.map(margin => contextCropPlan({ width: bitmap.width, height: bitmap.height }, region.box, { ...productCrop, margin }).rect);
    for (const margin of margins) {
      const { plan, canvas, blob: jpeg } = await cropWithContext(bitmap, region.box, { ...cropBase, margin });
      crops[keys[margin]] = { plan, canvas, jpeg: await toB64(jpeg) };
    }
    // Sheet: the photo with the region and both crop rectangles, then the two crops with the part outlined.
    const W = 1400, photoH = Math.round(bitmap.height * (W / 2) / bitmap.width), cropsH = Math.max(...Object.values(crops).map(c => c.canvas.height * (W / 2 - 10) / c.canvas.width));
    const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = Math.max(photoH, 0) + Math.round(cropsH) + 40;
    const g = sheet.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
    g.drawImage(bitmap, 0, 0, W / 2, photoH);
    const sx = (W / 2) / bitmap.width;
    g.lineWidth = 3; g.strokeStyle = '#7ee0ff'; g.strokeRect(region.box[0] * W / 2, region.box[1] * photoH, region.box[2] * W / 2, region.box[3] * photoH);
    const colors = { [keys[margins[0]]]: '#ffe16a', [keys[margins[1]]]: '#ff7ad9' };
    for (const [key, c] of Object.entries(crops)) { g.strokeStyle = colors[key]; g.setLineDash([8, 6]); g.strokeRect(c.plan.rect.x * sx, c.plan.rect.y * sx, c.plan.rect.width * sx, c.plan.rect.height * sx); g.setLineDash([]); }
    g.fillStyle = '#ddd'; g.font = '16px system-ui'; g.fillText(`${id} · ${region.label} · 하늘색: 영역, 노랑: 여백 40%, 분홍: 여백 80%`, W / 2 + 10, 24);
    Object.entries(crops).forEach(([key, c], i) => {
      const x = i * (W / 2), w = W / 2 - 10, h = c.canvas.height * w / c.canvas.width, y = photoH + 30;
      g.drawImage(c.canvas, x, y, w, h);
      const [tx, ty, tw, th] = c.plan.targetInCrop; g.strokeStyle = '#7ee0ff'; g.lineWidth = 2; g.strokeRect(x + tx * w, y + ty * h, tw * w, th * h);
      g.fillStyle = '#ddd'; g.fillText(`${key}: ${c.plan.rect.width}×${c.plan.rect.height} → ${c.plan.output.width}×${c.plan.output.height}`, x + 4, photoH + 22);
    });
    const png = await toB64(await new Promise(r => sheet.toBlob(r, 'image/png')));
    out.push({ label: region.label, sheet: png, productIdentical: JSON.stringify(product[0]) === JSON.stringify(product[1]), productRects: product, crops: Object.fromEntries(Object.entries(crops).map(([k, c]) => [k, { plan: { rect: c.plan.rect, output: c.plan.output, targetInCrop: c.plan.targetInCrop, source: c.plan.source }, jpeg: c.jpeg }])) });
  }
  bitmap.close();
  return out;
}

export async function prepare({ candidates = false, truthFile = WASHER_PATHS.truth, preparedDir = WASHER_PATHS.prepared, synthetic = false, data, manifest, p12gReview, channel = process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', env = process.env } = {}) {
  const outDir = assertOutside(preparedDir, env);
  const server = await startTruthServer({ truthFile, synthetic, ...(data ? { data } : {}), ...(manifest ? { manifest } : {}), ...(p12gReview !== undefined ? { p12gReview } : {}), env });
  const browser = await chromium.launch({ channel, headless: true });
  const index = { schema: 'carscope-washer-prepared-v1', synthetic, generatedAt: new Date().toISOString(), browser: browser.version(), cropBase: CROP_BASE, productCrop: PRODUCT_CROP, images: {} };
  const problems = [];
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/`);
    const keys = { ...MARGIN_KEYS };
    for (const image of server.set.images) {
      const record = server.truth.images[image.id];
      let regions;
      if (candidates) {
        regions = [...server.set.detections[image.id].map((d, i) => ({ label: `AI 탐지 ${i + 1} (score ${d.score})`, box: d.box })), ...(server.set.humanBoxes[image.id]?.boxes ?? []).map((b, i) => ({ label: `P12-G 사람 박스 ${i + 1}`, box: b }))];
      } else {
        if (truthState(image, record) !== 'HUMAN_REVIEWED' || record.truth.region.source === REGION_SOURCE.NONE) continue;
        regions = [{ label: `검수 영역 (${record.truth.region.source})`, box: record.truth.region.box }];
      }
      if (!regions.length) continue;
      const cut = await page.evaluate(cutInPage, { id: image.id, regions, cropBase: CROP_BASE, productCrop: PRODUCT_CROP, margins: MARGINS, keys });
      const dir = candidates ? path.join(outDir, 'candidates') : outDir;
      mkdirSync(path.join(dir, 'preview'), { recursive: true });
      cut.forEach((c, n) => {
        const suffix = candidates ? `-r${n + 1}` : '';
        writeFileSync(path.join(dir, 'preview', `${image.id}${suffix}.png`), Buffer.from(c.sheet, 'base64'));
        const entry = { preview: `preview/${image.id}${suffix}.png`, region: regions[n], product: { identical: c.productIdentical, rects: c.productRects } };
        for (const [key, crop] of Object.entries(c.crops)) {
          const bytes = Buffer.from(crop.jpeg, 'base64'), file = `${image.id}${suffix}-${key}.jpg`;
          writeFileSync(path.join(dir, file), bytes);
          entry[key] = { file: candidates ? `candidates/${file}` : file, sha256: sha256(bytes), bytes: bytes.length, rect: crop.plan.rect, output: crop.plan.output, targetInCrop: crop.plan.targetInCrop, source: crop.plan.source, margin: MARGINS.find(m => MARGIN_KEYS[m] === key) };
          if (!candidates && JSON.stringify(crop.plan.rect) !== JSON.stringify(record.cropRects?.[key])) problems.push(`${image.id} ${key}: crop differs from the one the reviewer saw`);
        }
        if (!candidates) entry.truthRevision = record.revision;
        index.images[candidates ? `${image.id}${suffix}` : image.id] = entry;
      });
    }
  } finally { await browser.close(); await server.close(); }
  index.problems = problems;
  writeFileSync(path.join(outDir, candidates ? 'candidates/candidates.json' : 'prepared.json'), JSON.stringify(index, null, 1));
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const candidates = process.argv.includes('--candidates');
    const index = await prepare({ candidates, data: { p12cResults: 'C:/CarScope-External/p12-c/run2/results.json' } });
    console.log(`${Object.keys(index.images).length} ${candidates ? 'candidate regions previewed (not sendable)' : 'photos prepared'} in ${WASHER_PATHS.prepared}. Problems: ${index.problems.length ? index.problems.join('; ') : 'none'}. No call.`);
    if (index.problems.length) process.exit(1);
  } catch (error) { console.error(error.message); process.exit(2); }
}
