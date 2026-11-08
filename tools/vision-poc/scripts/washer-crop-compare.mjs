// P13-C: product crop vs evaluation crops on the reviewed photos, without any model call.
// Reads the P13-B truth file and prepared index read-only; writes only to its own output folder (outside the repository):
//   compare.json   facts per photo and arm, and totals
//   sheets/<id>.png  the photo with the region and three crop rectangles, then the three crops side by side
//   index.html     a static page over the sheets and the table (open it from the folder; it loads nothing else)
//   node scripts/washer-crop-compare.mjs [--out C:/CarScope-External/p13-c/crop-compare]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../review/review-data.mjs';
import { assertOutside, WASHER_PATHS } from '../washer-eval/washer-eval-data.mjs';
import { startTruthServer } from '../washer-eval/washer-truth-server.mjs';
import { ARMS, compareArms, confusablesOf, summarize } from '../washer-eval/crop-compare.mjs';
import { REGION_SOURCE, truthState } from '../washer-eval/washer-eval-model.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
export const DEFAULT_OUT = 'C:/CarScope-External/p13-c/crop-compare';

async function cutThree({ id, box, arms }) {
  const { cropWithContext } = await import('/mobile-ar-poc/public/context-crop.mjs');
  const bitmap = await createImageBitmap(await (await fetch(`/images/${id}`)).blob(), { imageOrientation: 'from-image' });
  const b64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const out = { source: { width: bitmap.width, height: bitmap.height }, crops: {} };
  for (const [key, options] of Object.entries(arms)) {
    const { plan, canvas, blob } = await cropWithContext(bitmap, box, options);
    out.crops[key] = { plan: { rect: plan.rect, output: plan.output, targetInCrop: plan.targetInCrop }, canvas, jpeg: await b64(blob) };
  }
  // Sheet: photo (left) with region and arm rectangles; three crops below, each scaled to the same height, the part outlined.
  const W = 1500, ph = Math.round(bitmap.height * 700 / bitmap.width), row = 360;
  const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = ph + row + 60;
  const g = sheet.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, W, sheet.height);
  g.drawImage(bitmap, 0, 0, 700, ph);
  const s = 700 / bitmap.width, colors = { A_PRODUCT: '#ff7a59', B_EVAL_40: '#ffe16a', C_EVAL_80: '#ff7ad9' };
  g.lineWidth = 3; g.strokeStyle = '#7ee0ff'; g.strokeRect(box[0] * 700, box[1] * ph, box[2] * 700, box[3] * ph);
  for (const [key, c] of Object.entries(out.crops)) { g.strokeStyle = colors[key]; g.setLineDash([8, 6]); g.strokeRect(c.plan.rect.x * s, c.plan.rect.y * s, c.plan.rect.width * s, c.plan.rect.height * s); g.setLineDash([]); }
  g.fillStyle = '#ddd'; g.font = '16px system-ui';
  g.fillText(`${id} — 하늘색: 사람 검수 영역 · 주황 A 제품(P13-A) · 노랑 B 평가 40% · 분홍 C 평가 80%`, 710, 24);
  let x = 0;
  for (const [key, c] of Object.entries(out.crops)) {
    const h = row, w = Math.min(490, c.canvas.width * h / c.canvas.height), hh = w * c.canvas.height / c.canvas.width;
    g.drawImage(c.canvas, x, ph + 40, w, hh);
    const [tx, ty, tw, th] = c.plan.targetInCrop; g.strokeStyle = '#7ee0ff'; g.lineWidth = 2; g.strokeRect(x + tx * w, ph + 40 + ty * hh, tw * w, th * hh);
    g.fillStyle = colors[key]; g.fillText(`${key}: ${c.plan.output.width}×${c.plan.output.height}`, x + 4, ph + 30);
    x += 500;
  }
  out.sheet = await b64(await new Promise(r => sheet.toBlob(r, 'image/png')));
  for (const c of Object.values(out.crops)) delete c.canvas;
  bitmap.close();
  return out;
}

const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function page(result) {
  const rows = result.photos.map(p => {
    const cell = key => { const a = p.comparison.arms[key]; return `<td>${a.output.width}×${a.output.height}<br><small>부품 ${Math.round(a.targetShare * 100)}% · 최소 ${a.minimumDecided.width || a.minimumDecided.height ? '적용' : '-'} · 경계 ${a.shiftedAtEdge ? '밀림' : '-'} · 혼동 ${a.confusableInView.length}</small></td>`; };
    return `<tr><td><a href="sheets/${esc(p.id)}.png">${esc(p.id)}</a><br><small>${esc(p.license)}</small></td>${cell('A_PRODUCT')}${cell('B_EVAL_40')}${cell('C_EVAL_80')}<td>${p.comparison.productEqualsEval80 ? 'A=C' : ''}</td><td>${p.reproduced === null ? '-' : p.reproduced ? '같음' : '<b>다름</b>'}</td></tr>`;
  }).join('\n');
  const t = result.summary.arms;
  const sum = key => `<td>긴 변 ${t[key].outputLongSide.min}–${t[key].outputLongSide.max} (중앙 ${t[key].outputLongSide.median})<br>부품 비율 중앙 ${Math.round(t[key].targetShareMedian * 100)}% · 최소 크기 결정 ${t[key].minimumDecided}/${t[key].photos} · 경계 ${t[key].shiftedAtEdge} · 혼동 대상 포함 ${t[key].withConfusableInView}</td>`;
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>P13-C 크롭 비교</title>
<style>body{font:14px system-ui;background:#0f1216;color:#e8edf2;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #2a3340;padding:6px;vertical-align:top}small{color:#9aa6b2}a{color:#7ee0ff}img{max-width:100%}</style>
<h1>P13-C 제품 크롭 vs 평가 크롭 (호출 없음)</h1>
<p>A: P13-A 제품 ${esc(JSON.stringify(ARMS.A_PRODUCT))}<br>B/C: P13-B 평가 ${esc(JSON.stringify(ARMS.B_EVAL_40))} / margin 0.8<br>혼동 대상: 저장된 실제 탐지기 출력(점수 0.25 이상, 정답 아님)이 크롭 안에 절반 이상 들어온 수. 재현: B·C를 다시 잘라 P13-B 준비 파일과 해시 비교.</p>
<table><tr><th></th><th>A 제품</th><th>B 평가 40%</th><th>C 평가 80%</th></tr><tr><td>합계 ${result.photos.length}장</td>${sum('A_PRODUCT')}${sum('B_EVAL_40')}${sum('C_EVAL_80')}</tr></table>
<p>A와 C가 같은 크롭: ${result.summary.productEqualsEval80}장 · A 면적 / C 면적 중앙값 ${result.summary.productAreaOverEval80Median}</p>
<table><tr><th>사진</th><th>A 제품</th><th>B 평가 40%</th><th>C 평가 80%</th><th></th><th>B·C 재현</th></tr>
${rows}</table>
${result.photos.map(p => `<h3 id="${esc(p.id)}">${esc(p.id)}</h3><img src="sheets/${esc(p.id)}.png" alt="${esc(p.id)} 크롭 비교">`).join('\n')}
</html>`;
}

export async function compareCrops({ out = DEFAULT_OUT, truthFile = WASHER_PATHS.truth, preparedDir = WASHER_PATHS.prepared, synthetic = false, data, manifest, p12gReview, env = process.env, channel = process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome' } = {}) {
  const target = assertOutside(out, env);
  const preparedFile = path.join(assertOutside(preparedDir, env), 'prepared.json');
  const prepared = existsSync(preparedFile) ? JSON.parse(readFileSync(preparedFile, 'utf8')).images ?? {} : {};
  const server = await startTruthServer({ truthFile, synthetic, ...(data ? { data } : {}), ...(manifest ? { manifest } : {}), ...(p12gReview !== undefined ? { p12gReview } : {}), env });
  const browser = await chromium.launch({ channel, headless: true });
  const photos = [];
  try {
    const tab = await browser.newPage();
    await tab.goto(`${server.url}/`);
    mkdirSync(path.join(target, 'sheets'), { recursive: true });
    for (const image of server.set.images) {
      const record = server.truth.images[image.id];
      if (truthState(image, record) !== 'HUMAN_REVIEWED' || record.truth.region.source === REGION_SOURCE.NONE) continue;
      const box = record.truth.region.box;
      const cut = await tab.evaluate(cutThree, { id: image.id, box, arms: ARMS });
      writeFileSync(path.join(target, 'sheets', `${image.id}.png`), Buffer.from(cut.sheet, 'base64'));
      const comparison = compareArms(cut.source, box, confusablesOf(server.set.answers[image.id], cut.source));
      // The page and the pure plan must agree, and B/C must reproduce the P13-B files byte for byte.
      for (const key of Object.keys(ARMS)) if (JSON.stringify(cut.crops[key].plan.rect) !== JSON.stringify(comparison.arms[key].rect)) throw new Error(`PLAN_MISMATCH ${image.id} ${key}`);
      const p = prepared[image.id];
      const hashes = { B_EVAL_40: sha256(Buffer.from(cut.crops.B_EVAL_40.jpeg, 'base64')), C_EVAL_80: sha256(Buffer.from(cut.crops.C_EVAL_80.jpeg, 'base64')), A_PRODUCT: sha256(Buffer.from(cut.crops.A_PRODUCT.jpeg, 'base64')) };
      const reproduced = p ? hashes.B_EVAL_40 === p.m40.sha256 && hashes.C_EVAL_80 === p.m80.sha256 : null;
      photos.push({ id: image.id, license: image.license, attribution: image.attribution, region: record.truth.region.source, source: cut.source, comparison, hashes, reproduced });
    }
  } finally { await browser.close(); await server.close(); }
  const result = { schema: 'carscope-crop-compare-v1', generatedAt: new Date().toISOString(), arms: ARMS, calls: 0, photos, summary: summarize(photos), reproduced: { checked: photos.filter(p => p.reproduced !== null).length, equal: photos.filter(p => p.reproduced === true).length } };
  writeFileSync(path.join(target, 'compare.json'), JSON.stringify(result, null, 1));
  writeFileSync(path.join(target, 'index.html'), page(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  try {
    const r = await compareCrops({ out: at >= 0 ? process.argv[at + 1] : DEFAULT_OUT, data: { p12cResults: 'C:/CarScope-External/p12-c/run2/results.json' } });
    console.log(JSON.stringify({ photos: r.photos.length, reproduced: r.reproduced, summary: r.summary }, null, 1));
  } catch (error) { console.error(error.message); process.exit(2); }
}
