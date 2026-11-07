import { existsSync, readFileSync } from 'node:fs';
import { assistedProblems, safeSource } from './assisted-model.mjs';
import { sha256 } from './review-data.mjs';

export const DEFAULT_ASSISTED = 'C:/CarScope-External/p12-h/assisted-labels.json';
// Read JPEG SOF dimensions without decoding or trusting sidecar metadata.
export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 < bytes.length) {
    if (bytes[at++] !== 0xff) return null;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 8 ? { height: bytes.readUInt16BE(at + 3), width: bytes.readUInt16BE(at + 5) } : null;
    at += length;
  }
  return null;
}
export function loadAssisted(file, images) {
  if (!file || !existsSync(file)) return { status: 'NOT_AVAILABLE', images: [], problems: ['Assisted observations file missing'], files: new Map() };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const problems = assistedProblems(data, images), files = new Map();
    for (const row of data.images ?? []) if (row.dataset === 'IONIQ5_REFERENCE') {
      const bytes = readFileSync(row.file);
      const dimensions = jpegDimensions(bytes);
      if (sha256(bytes) !== row.sha256 || !dimensions || dimensions.width !== row.width || dimensions.height !== row.height || row.width <= 0 || row.height <= 0 || !row.license || !row.attribution || !safeSource(row.source)) problems.push(`${row.id}: reference photo missing, invalid or changed`);
      else files.set(row.id, { file: row.file, type: 'image/jpeg' });
    }
    return problems.length ? { status: 'BLOCKED', images: [], problems, files: new Map() } : { status: 'READY', images: data.images, problems: [], files };
  } catch { return { status: 'BLOCKED', images: [], problems: ['Assisted file or reference photo unreadable'], files: new Map() }; }
}
