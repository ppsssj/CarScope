// P12-C: downloads the photos of the exploratory manifest into a folder outside Git, checks each hash and keeps a slow pace.
//   node scripts/fetch-exploratory.mjs <manifest.json> <folder outside the repository>
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [manifestPath, folder] = process.argv.slice(2);
if (!manifestPath || !folder) { console.error('Usage: fetch-exploratory.mjs <manifest.json> <folder>'); process.exit(64); }
const repository = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase() + path.sep;
if ((path.resolve(folder).toLowerCase() + path.sep).startsWith(repository)) { console.error('Images do not belong in the repository'); process.exit(64); }
await mkdir(folder, { recursive: true });
const failures = [];
for (const image of JSON.parse(await readFile(manifestPath, 'utf8')).images) {
  const target = path.join(folder, path.basename(image.file));
  const have = await readFile(target).catch(() => null);
  if (have && createHash('sha256').update(have).digest('hex') === image.sha256) continue;
  await delay(2500);
  const response = await fetch(image.downloadUrl, { headers: { 'User-Agent': 'CarScope-research/0.1 (exploratory set, low rate)' } });
  const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  if (!bytes) { failures.push({ id: image.id, http: response.status }); continue; }
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) { failures.push({ id: image.id, problem: 'hash differs from the manifest' }); continue; }
  await writeFile(target, bytes);
}
console.log(JSON.stringify({ status: failures.length ? 'INCOMPLETE' : 'OK', failures }, null, 2));
if (failures.length) process.exitCode = 1;
