// P13-B: the local page where a person enters the washer cap truth for each photo. 127.0.0.1 only. Writes one truth file outside the repository.
// It reads no API key and calls no model. Regions offered are the stored real detections and completed P12-G human boxes; drafts are not shown.
//   node washer-eval/washer-truth-server.mjs [--port 8211] [--truth C:/CarScope-External/p13-b/washer-truth.json]
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS } from '../review/review-server.mjs';
import { assertOutside, loadTruthFile, loadWasherSet, manifestHash, WASHER_PATHS } from './washer-eval-data.mjs';
import { CROP_BASE, MARGIN_KEYS, MARGINS, truthProblems, truthState, expectedOf } from './washer-eval-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '../../mobile-ar-poc/public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// The page runs the same crop code P13-A sends with, so what a person checks for plates and people is what would go out.
export const ROUTES = Object.freeze({
  '/': path.join(here, 'public/index.html'),
  '/truth.mjs': path.join(here, 'public/truth.mjs'),
  '/truth.css': path.join(here, 'public/truth.css'),
  '/washer-eval/washer-eval-model.mjs': path.join(here, 'washer-eval-model.mjs'),
  '/mobile-ar-poc/public/part-analysis.mjs': path.join(mobile, 'part-analysis.mjs'),
  '/mobile-ar-poc/public/context-crop.mjs': path.join(mobile, 'context-crop.mjs'),
  // P13-D: part-analysis.mjs reads the detection table to tell detected parts from hand-marked ones.
  '/mobile-ar-poc/public/part-detection.mjs': path.join(mobile, 'part-detection.mjs'),
});
const MAX_BODY = 64 * 1024;

export async function startTruthServer({ port = 0, truthFile = WASHER_PATHS.truth, synthetic = false, data = {}, manifest = WASHER_PATHS.manifest, p12gReview = WASHER_PATHS.p12gReview, now = () => new Date(), env = process.env } = {}) {
  const target = assertOutside(truthFile, env);
  const set = loadWasherSet({ manifest, data, p12gReview });
  if (set.status !== 'READY') { const error = new Error(`BLOCKED: ${set.problems.join('; ')}`); error.problems = set.problems; throw error; }
  const truth = loadTruthFile(target, { images: set.images, synthetic, manifestSha256: manifestHash(manifest) });
  const images = new Map(set.images.map(image => [image.id, image]));
  const persist = () => {
    mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(truth, null, 1));
    renameSync(temp, target);
  };
  const progress = () => Object.fromEntries(['UNREVIEWED', 'IN_PROGRESS', 'HUMAN_REVIEWED', 'INVALIDATED'].map(s => [s, set.images.filter(image => truthState(image, truth.images[image.id]) === s).length]));
  const payload = () => ({
    synthetic, margins: MARGINS, marginKeys: MARGIN_KEYS, cropBase: CROP_BASE, progress: progress(),
    images: set.images.map(image => {
      const record = truth.images[image.id] ?? null;
      return { id: image.id, vehicle: image.vehicle, license: image.license, attribution: image.attribution, source: image.source, sha256: image.sha256,
        detections: set.detections[image.id], humanBoxes: set.humanBoxes[image.id] ?? null, state: truthState(image, record), record, expected: record ? expectedOf(record.truth) : null };
    }),
  });

  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { ...HEADERS, 'Content-Type': type }); response.end(request.method === 'HEAD' ? undefined : type.startsWith('application/json') ? JSON.stringify(body) : body); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, { error: 'LOCAL_ONLY' });
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'PUT') {
        const match = /^\/api\/truth\/([a-z0-9-]{1,40})$/.exec(pathname), image = match && images.get(match[1]);
        if (!image) return send(404, { error: 'UNKNOWN_IMAGE' });
        if (request.headers['x-carscope-review'] !== 'washer-v1' || !/^application\/json\b/.test(request.headers['content-type'] ?? '')) return send(415, { error: 'NOT_THE_TRUTH_PAGE' });
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) return send(413, { error: 'TOO_LARGE' }); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'NOT_JSON' }); }
        const detections = set.detections[image.id];
        const cropRects = body.cropRects ?? null;
        const problems = truthProblems(body, { detections, cropRects });
        if (problems.length) return send(422, { error: 'TRUTH_REFUSED', problems });
        const current = truth.images[image.id];
        if ((current?.revision ?? 0) !== body.expectedRevision) return send(409, { error: 'REVISION_CONFLICT', revision: current?.revision ?? 0 });
        const at = now().toISOString(), t = body.truth;
        const record = {
          imageSha256: image.sha256, complete: body.complete, reviewer: body.reviewer.trim(), revision: (current?.revision ?? 0) + 1, savedAt: at, completedAt: body.complete ? at : null,
          truth: { region: { source: t.region.source, box: t.region.box, detectionIndex: t.region.detectionIndex ?? null }, identification: t.identification, capMissing: t.capMissing, capOpen: t.capOpen, capDamage: t.capDamage, judgeable: t.judgeable, personalData: t.personalData, note: t.note },
          cropRects, detections,
        };
        truth.images[image.id] = record;
        persist();
        appendFileSync(`${target}.history.jsonl`, `${JSON.stringify({ imageId: image.id, at, ...record })}\n`);
        return send(200, { record, state: truthState(image, record), expected: expectedOf(record.truth), progress: progress() });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, { error: 'METHOD' });
      if (pathname === '/api/state') return send(200, payload());
      const photo = /^\/images\/([a-z0-9-]{1,40})$/.exec(pathname);
      if (photo) { const file = set.files.get(photo[1]); return file ? send(200, readFileSync(file.file), file.type) : send(404, { error: 'UNKNOWN_IMAGE' }); }
      const file = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
      if (!file) return send(404, { error: 'NOT_FOUND' });
      return send(200, readFileSync(file), TYPES[path.extname(file)]);
    } catch { if (!response.headersSent) send(500, { error: 'UNAVAILABLE' }); else response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, truth, set, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : fallback; };
  try {
    const { url, truth } = await startTruthServer({ port: Number(option('port', 8211)), truthFile: option('truth', WASHER_PATHS.truth), data: { p12cResults: 'C:/CarScope-External/p12-c/run2/results.json' } });
    console.log(`Washer truth review on ${url} (127.0.0.1 only). ${Object.keys(truth.images).length} photos have a record. No model is called.`);
  } catch (error) { console.error(error.message); process.exit(2); }
}
