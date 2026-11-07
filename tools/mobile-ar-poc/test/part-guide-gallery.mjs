// P12-A2: all 38 drawings on one page, for a person to look over. An HTML gallery and a PNG contact sheet, outside the repository.
// Usage: POC_EVIDENCE_DIR=C:/CarScope-External/<run> npm run guide:gallery
import { chromium } from 'playwright';
import path from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { PART_GUIDES } from '../public/part-guides.mjs';
import { INSPECTION_PARTS } from '../../three-poc/inspection-parts.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const dir = path.join(base, 'gallery');
await mkdir(dir, { recursive: true });
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const rows = [];
for (const part of INSPECTION_PARTS) {
  const guide = PART_GUIDES[part.id];
  for (const image of [guide.overviewImage, guide.detailImage]) await copyFile(new URL(`../public/${image.file}`, import.meta.url), path.join(dir, image.file));
  rows.push(`<section><h2>${escape(guide.title)}</h2><p class="meta"><code>${escape(part.id)}</code> · ${guide.taskId ? `점검 <code>${escape(guide.taskId)}</code>` : '<b>정보 전용 · 점검 없음</b>'} · 3D 근거 ${escape(part.geometrySource)} · ${escape(guide.vehicleApplicability.scope)} · ${escape(guide.photoStatus)}</p>
<div class="pair"><figure><img src="${guide.overviewImage.file}" alt="${escape(guide.overviewImage.alt)}"><figcaption>${escape(guide.overviewImage.caption)}</figcaption></figure><figure><img src="${guide.detailImage.file}" alt="${escape(guide.detailImage.alt)}"><figcaption>${escape(guide.detailImage.caption)}</figcaption></figure></div></section>`);
}
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>CarScope 부품 안내 그림 19개</title><style>
body{margin:0;padding:24px;background:#0e1013;color:#e8eaed;font:15px/1.45 system-ui,"Malgun Gothic",sans-serif}h1{font-size:22px;margin:0 0 4px}.lead{color:#a6adb7;margin:0 0 20px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:18px}section{background:#171a1f;border:1px solid #2a2f37;border-radius:12px;padding:12px 14px}h2{font-size:16px;margin:0}.meta{color:#a6adb7;font-size:12px;margin:2px 0 8px}code{font-size:11.5px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}figure{margin:0}img{width:100%;display:block;border-radius:8px}figcaption{color:#a6adb7;font-size:12px;margin-top:4px}
</style></head><body><h1>CarScope 부품 안내 그림 19개 (38장)</h1><p class="lead">CarScope가 직접 그린 설명용 그림입니다. 실제 사진이 아니고 특정 차량의 구조나 위치가 아닙니다.</p><main>${rows.join('\n')}</main></body></html>`;
const gallery = path.join(dir, 'index.html');
await writeFile(gallery, html);
const browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1780, height: 1000 } });
await page.goto(`file:///${gallery.replaceAll('\\', '/')}`);
await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
await page.screenshot({ path: path.join(dir, 'contact-sheet.png'), fullPage: true });
await browser.close();
console.log(JSON.stringify({ gallery, contactSheet: path.join(dir, 'contact-sheet.png'), parts: rows.length }));
