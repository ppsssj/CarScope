import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import { handoffURL, isLoopbackHost } from '../public/handoff.mjs';
import {MOBILE_MODULES} from '../public-modules.mjs';
import {WEBXR_GUIDE_FILES, markWebXrGuidePage} from '../webxr-modules.mjs';
import {webxrGuideEnabled} from '../webxr-flag.mjs';

export const PUBLIC_FILES = ['index.html','style.css','app-entry.mjs',...MOBILE_MODULES,'favicon.svg'];

// Static staging only: the page and modules are copied unchanged. No upload API, no result transport (AR-01).
// The experimental WebXR guide is added only on explicit request, so a default build keeps its exact files and bytes.
export async function buildStaging({ origin, outputDirectory, revision = 'UNRECORDED', webxrGuide = false }) {
  const url = handoffURL(origin);
  if (isLoopbackHost(new URL(url).hostname)) {
    throw new Error('Staging requires a reachable HTTPS hostname, not loopback');
  }
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  for (const name of PUBLIC_FILES) await copyFile(new URL(`../public/${name}`, import.meta.url), path.join(output, name));
  if (webxrGuide) {
    await mkdir(path.join(output, 'webxr'), { recursive: true });
    for (const [served, source] of WEBXR_GUIDE_FILES) await copyFile(new URL(`../${source}`, import.meta.url), path.join(output, 'webxr', served));
    await writeFile(path.join(output, 'index.html'), markWebXrGuidePage(await readFile(path.join(output, 'index.html'), 'utf8')));
  }
  await writeFile(path.join(output, 'handoff.json'), JSON.stringify({ configured: true, url }));
  await writeFile(path.join(output, 'qr.svg'), await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320 }));
  await writeFile(path.join(output, 'build-info.json'), JSON.stringify({ revision, kind: 'QR_AR_STATIC_STAGING', semanticRecognition: 'UNVERIFIED' }));
  return { url, outputDirectory: output };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.env.POC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/` : null);
  if (!origin) throw new Error('Set POC_BASE_URL or use Vercel VERCEL_URL; no staging origin available');
  const result = await buildStaging({ origin, webxrGuide: webxrGuideEnabled(process.env, process.argv),
    outputDirectory: process.env.POC_STAGING_OUTPUT || fileURLToPath(new URL('../build/staging/', import.meta.url)),
    revision: process.env.VERCEL_GIT_COMMIT_SHA || process.env.POC_SOURCE_REVISION || 'UNRECORDED' });
  console.log(`Static QR-AR staging built for ${new URL(result.url).origin}; revision recorded in build-info.json`);
}
