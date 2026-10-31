// Dependency-free reader for Blender .blend files (read-only). Handles the container (plain, gzip,
// Zstandard incl. Blender's multi-frame seekable layout) and the SDNA-described block structure.
// It never executes anything from the file and never writes next to the source.
import zlib from "node:zlib";

const ZSTD_MAGIC = 0xfd2fb528;
const SEEK_TABLE_FOOTER = 0x8f92eab1;
const SKIPPABLE_SEEK_TABLE = 0x184d2a5e;

/** Classify a file from its first bytes. Never assumes corruption: an unknown result stays UNKNOWN. */
export function detectContainer(bytes) {
  const head = bytes.subarray(0, 64);
  if (head.subarray(0, 7).toString("latin1") === "BLENDER") return "BLEND_UNCOMPRESSED";
  if (head.length >= 4 && head.readUInt32LE(0) === ZSTD_MAGIC) return "ZSTD";
  if (head[0] === 0x1f && head[1] === 0x8b) return "GZIP";
  if (head.toString("latin1").startsWith("version https://git-lfs.github.com/spec/")) return "GIT_LFS_POINTER";
  return "UNKNOWN";
}

/** Decode a Zstandard stream. Blender writes independent frames plus a seek table, so decode frame by frame. */
export function zstdDecompress(bytes) {
  if (typeof zlib.zstdDecompressSync !== "function") throw new Error("This Node.js has no zlib.zstdDecompressSync (needs >= 22.15)");
  const n = bytes.length;
  if (n >= 17 && bytes.readUInt32LE(n - 4) === SEEK_TABLE_FOOTER) {
    const frames = bytes.readUInt32LE(n - 9);
    const entry = bytes[n - 5] & 0x80 ? 12 : 8;
    const skipStart = n - (frames * entry + 9) - 8;
    if (skipStart < 0 || bytes.readUInt32LE(skipStart) !== SKIPPABLE_SEEK_TABLE || bytes.readUInt32LE(skipStart + 4) !== frames * entry + 9) throw new Error("Malformed zstd seek table");
    const parts = [];
    let offset = 0;
    for (let i = 0; i < frames; i++) {
      const compressed = bytes.readUInt32LE(skipStart + 8 + i * entry);
      const size = bytes.readUInt32LE(skipStart + 12 + i * entry);
      const out = zlib.zstdDecompressSync(bytes.subarray(offset, offset + compressed));
      if (out.length !== size) throw new Error(`zstd frame ${i}: ${out.length} bytes, seek table says ${size}`);
      parts.push(out);
      offset += compressed;
    }
    if (offset !== skipStart) throw new Error("zstd frames do not end at the seek table");
    return { data: Buffer.concat(parts), frames };
  }
  return { data: zlib.zstdDecompressSync(bytes), frames: 1 };
}

/** Return the uncompressed .blend bytes plus a provenance record of how they were obtained. */
export function openBlend(bytes) {
  const container = detectContainer(bytes);
  let data = bytes;
  let frames = 0;
  if (container === "ZSTD") ({ data, frames } = zstdDecompress(bytes));
  else if (container === "GZIP") data = zlib.gunzipSync(bytes);
  else if (container !== "BLEND_UNCOMPRESSED") throw new Error(`Not Blender data: ${container}`);
  const header = data.subarray(0, 17).toString("latin1");
  if (!header.startsWith("BLENDER")) throw new Error(`Decompressed data is not Blender data: ${JSON.stringify(header.slice(0, 12))}`);
  return { container, frames, data, header };
}

const ID_CODES = new Set(["OB", "ME", "MA", "SC", "WO", "WS", "SN", "WM", "IM", "TE", "NT", "CA", "LA", "GR", "AC", "KE", "LI", "BR", "PA", "GD", "LS", "CF", "CV", "PT", "VO", "GP"]);

/**
 * Parse blocks and SDNA. Supports the Blender 5.x header `BLENDER17-01v####` (64-bit block headers).
 * Older 12-byte headers are rejected explicitly rather than misread.
 */
export function parseBlend(d) {
  const header = d.subarray(0, 17).toString("latin1");
  const m = /^BLENDER17-01([v])(\d{4})$/.exec(header);
  if (!m) throw new Error(`Unsupported .blend header ${JSON.stringify(header)} (only the Blender 5.x little-endian large-header format is implemented)`);
  const blocks = [];
  let p = 17;
  let scope = -1;
  while (p + 32 <= d.length) {
    const code = d.subarray(p, p + 4).toString("latin1").replace(/\0+$/, "");
    const block = { code, sdna: d.readInt32LE(p + 4), old: d.readBigUInt64LE(p + 8), len: Number(d.readBigInt64LE(p + 16)), nr: Number(d.readBigInt64LE(p + 24)), off: p + 32 };
    if (block.len < 0 || block.off + block.len > d.length) throw new Error(`Block ${code} at ${p} overruns the file`);
    if (ID_CODES.has(code)) scope = blocks.length;
    block.scope = code === "DATA" ? scope : blocks.length;
    blocks.push(block);
    p = block.off + block.len;
    if (code === "ENDB") break;
  }
  if (blocks.at(-1)?.code !== "ENDB") throw new Error("Missing ENDB block (truncated file)");
  const dna = blocks.find((b) => b.code === "DNA1");
  if (!dna) throw new Error("Missing DNA1 block");
  const sdna = parseSdna(d, dna.off);
  // Blender 5.x writes per-ID stable pseudo-addresses; they are NOT unique across the file.
  const byOld = new Map();
  for (const b of blocks) if (b.old) (byOld.get(b.old) ?? byOld.set(b.old, []).get(b.old)).push(b);
  return { version: m[2], blocks, ...sdna, byOld, d };
}

function parseSdna(d, start) {
  let q = start;
  const tag = (want) => { const t = d.subarray(q, q + 4).toString("latin1"); q += 4; if (t !== want) throw new Error(`SDNA: expected ${want}, got ${t}`); };
  const int = () => { const v = d.readInt32LE(q); q += 4; return v; };
  const align = () => { q = start + ((q - start + 3) & ~3); }; // relative to the SDNA start, not the file
  const strings = (n) => { const a = []; for (let i = 0; i < n; i++) { let e = q; while (d[e]) e++; a.push(d.subarray(q, e).toString("latin1")); q = e + 1; } return a; };
  tag("SDNA"); tag("NAME"); const names = strings(int()); align();
  tag("TYPE"); const types = strings(int()); align();
  tag("TLEN"); const tlen = types.map(() => { const v = d.readInt16LE(q); q += 2; return v; }); align();
  tag("STRC");
  const count = int();
  const structs = [];
  for (let i = 0; i < count; i++) {
    const type = types[d.readInt16LE(q)];
    const nf = d.readInt16LE(q + 2);
    q += 4;
    const fields = [];
    let off = 0;
    for (let j = 0; j < nf; j++) {
      const ftype = types[d.readInt16LE(q)];
      const name = names[d.readInt16LE(q + 2)];
      q += 4;
      const ptr = name.startsWith("*") || name.startsWith("(*");
      const dims = [...name.matchAll(/\[(\d+)\]/g)].map((x) => +x[1]);
      const size = (ptr ? 8 : tlen[types.indexOf(ftype)]) * dims.reduce((a, b) => a * b, 1);
      fields.push({ type: ftype, name, bare: name.replace(/^[*(]+/, "").replace(/[)[].*$/, ""), ptr, dims, off, size });
      off += size;
    }
    const size = tlen[types.indexOf(type)];
    if (off !== size) throw new Error(`SDNA: struct ${type} fields sum to ${off}, TLEN says ${size}`);
    structs.push({ type, size, fields, byName: new Map(fields.map((f) => [f.bare, f])) });
  }
  return { structs, byType: new Map(structs.map((s) => [s.type, s])) };
}

/** Typed accessors over a parsed file. Pointers resolve inside the owning ID first, then file-wide. */
export function blendAccess(B) {
  const { d } = B;
  const field = (type, name) => {
    const f = B.byType.get(type)?.byName.get(name);
    if (!f) throw new Error(`SDNA has no ${type}.${name}`);
    return f;
  };
  const resolve = (ptr, scope, expectLen) => {
    if (!ptr) return null;
    const cands = B.byOld.get(ptr) ?? [];
    const fits = (b) => expectLen === undefined || b.len === expectLen;
    return cands.find((b) => b.scope === scope && fits(b)) ?? cands.find(fits) ?? null;
  };
  const at = (block, type, base = block.off) => ({
    block, base, type,
    i32: (n) => d.readInt32LE(base + field(type, n).off),
    i16: (n) => d.readInt16LE(base + field(type, n).off),
    i8: (n) => d.readInt8(base + field(type, n).off),
    f32: (n) => d.readFloatLE(base + field(type, n).off),
    f32s: (n) => { const f = field(type, n); return Array.from({ length: f.size / 4 }, (_, i) => d.readFloatLE(base + f.off + 4 * i)); },
    str: (n) => { const f = field(type, n); let e = base + f.off; const end = e + f.size; while (e < end && d[e]) e++; return d.subarray(base + f.off, e).toString("utf8"); },
    ptr: (n) => d.readBigUInt64LE(base + field(type, n).off),
    sub: (n, subType) => at(block, subType ?? field(type, n).type, base + field(type, n).off),
    deref: (n, expectLen) => resolve(d.readBigUInt64LE(base + field(type, n).off), block.scope, expectLen),
  });
  const cstring = (block) => { let e = block.off; while (e < block.off + block.len && d[e]) e++; return d.subarray(block.off, e).toString("utf8"); };
  const listBase = (owner, name, type) => {
    const out = [];
    let ptr = owner.ptr(name); // ListBase.first is at offset 0
    const seen = new Set();
    while (ptr && !seen.has(ptr)) {
      seen.add(ptr);
      const b = resolve(ptr, owner.block.scope);
      if (!b) break;
      const node = at(b, type);
      out.push(node);
      ptr = d.readBigUInt64LE(b.off); // Link.next
    }
    return out;
  };
  const idName = (block) => at(block, "ID").str("name");
  return { d, field, resolve, at, cstring, listBase, idName, structName: (b) => B.structs[b.sdna]?.type };
}
