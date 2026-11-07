// P12-G: the local label review tool. 127.0.0.1 only. Serves fixed files and photos by id from the label file, and writes one review file outside the repository.
// It reads no API key and has no way to call a model: every model answer comes from what P12-C and P12-F stored.
//   node review/review-server.mjs [--port 8210] [--review C:/CarScope-External/p12-g/label-review.json]
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PATHS, loadEvaluationSet, loadReviewFile } from './review-data.mjs';
import { evaluateReview } from './review-evaluate.mjs';
import { draftOf, imageState, predictionsOf, progressOf, REVIEW_CASES, REVIEW_PARTS, saveProblems } from './review-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..').toLowerCase() + path.sep;
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
export const ROUTES = Object.freeze({
  '/': path.join(here, 'public/index.html'),
  '/review.mjs': path.join(here, 'public/review.mjs'),
  '/review.css': path.join(here, 'public/review.css'),
  '/review-model.mjs': path.join(here, 'review-model.mjs'),
});
export const HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});
const MAX_BODY = 256 * 1024;

export function assertReviewPath(file, env = process.env) {
  if (env.RENDER) throw new Error('LOCAL_TOOL_ONLY');
  const resolved = path.resolve(file);
  if (resolved.toLowerCase().startsWith(repository)) throw new Error('REVIEW_FILE_INSIDE_REPOSITORY');
  return resolved;
}

export async function startReviewServer({ port = 0, reviewFile = DEFAULT_PATHS.review, data = {}, synthetic = false, now = () => new Date(), env = process.env } = {}) {
  const target = assertReviewPath(reviewFile, env);
  const set = loadEvaluationSet(data);
  if (set.status !== 'READY') { const error = new Error(`BLOCKED: ${set.problems.join('; ')}`); error.problems = set.problems; throw error; }
  const review = loadReviewFile(target, { images: set.images, sourceLabelsSha256: set.sourceLabelsSha256, synthetic });
  const images = new Map(set.images.map(image => [image.id, image]));

  const persist = () => {
    mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(review, null, 1));
    renameSync(temp, target); // Whole file or nothing, even if the process dies here.
  };
  const payload = () => ({
    synthetic, sourceLabelsChanged: review.sourceLabelsSha256 !== set.sourceLabelsSha256, parts: REVIEW_PARTS, cases: REVIEW_CASES, progress: progressOf(set.images, review), evaluation: evaluateReview({ images: set.images, answers: set.answers, review }),
    images: set.images.map(image => {
      const answer = set.answers[image.id], record = review.images[image.id] ?? null;
      return { id: image.id, vehicle: image.vehicle, electrified: image.electrified, license: image.license, attribution: image.attribution, source: image.source, sha256: image.sha256, width: answer.image.width, height: answer.image.height, state: imageState(image, record), record,
        draft: Object.fromEntries(REVIEW_PARTS.map(({ key }) => [key, draftOf(image, key)])), predictions: predictionsOf(answer) };
    }),
  });

  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { ...HEADERS, 'Content-Type': type }); response.end(request.method === 'HEAD' ? undefined : type.startsWith('application/json') ? JSON.stringify(body) : body); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, { error: 'LOCAL_ONLY' });
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'PUT') {
        const match = /^\/api\/reviews\/([a-z0-9-]{1,40})$/.exec(pathname), image = match && images.get(match[1]);
        if (!image) return send(404, { error: 'UNKNOWN_IMAGE' });
        // A page elsewhere cannot send this header or this type without a preflight, and no preflight is answered.
        if (request.headers['x-carscope-review'] !== 'v1' || !/^application\/json\b/.test(request.headers['content-type'] ?? '')) return send(415, { error: 'NOT_THE_REVIEW_PAGE' });
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) return send(413, { error: 'TOO_LARGE' }); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'NOT_JSON' }); }
        const problems = saveProblems(body, image);
        if (problems.length) return send(422, { error: 'REVIEW_REFUSED', problems });
        const current = review.images[image.id];
        if ((current?.revision ?? 0) !== body.expectedRevision) return send(409, { error: 'REVISION_CONFLICT', revision: current?.revision ?? 0 });
        const at = now().toISOString();
        const record = { imageSha256: image.sha256, complete: body.complete, reviewer: body.reviewer.trim(), revision: (current?.revision ?? 0) + 1, savedAt: at, completedAt: body.complete ? at : null, parts: {} };
        for (const { key } of REVIEW_PARTS) {
          const part = body.parts[key], before = current?.parts?.[key];
          const same = before && JSON.stringify({ ...before, reviewedAt: null, reviewer: null }) === JSON.stringify({ ...part, reviewedAt: null, reviewer: null });
          record.parts[key] = { partId: part.partId, status: part.status, boxes: part.boxes, caps: part.caps, ignore: part.ignore, hv: part.hv, note: part.note, reference: part.reference, reviewedAt: same ? before.reviewedAt : at, reviewer: same ? before.reviewer : record.reviewer };
        }
        review.images[image.id] = record;
        persist();
        appendFileSync(`${target}.history.jsonl`, `${JSON.stringify({ imageId: image.id, at, ...record })}\n`); // Every save, for comparing later.
        return send(200, { record, state: imageState(image, record), progress: progressOf(set.images, review), evaluation: evaluateReview({ images: set.images, answers: set.answers, review }) });
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
  return { server, url: `http://127.0.0.1:${server.address().port}`, review, set, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : fallback; };
  try {
    const { url, review } = await startReviewServer({ port: Number(option('port', 8210)), reviewFile: option('review', DEFAULT_PATHS.review), data: { p12cResults: DEFAULT_PATHS.p12cResults } });
    console.log(`Label review on ${url} (127.0.0.1 only). ${Object.keys(review.images).length} photos have a saved record. No model is called.`);
  } catch (error) { console.error(error.message); process.exit(2); }
}
