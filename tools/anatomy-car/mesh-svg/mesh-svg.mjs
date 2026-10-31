// Arbitrary triangle mesh -> Anatomy-style flat SVG, for geometry the kit cannot record itself
// (imported meshes have no analytic solids for the kit's depth order and audit).
//
// Reused from the pinned kit and the CarScope car kit, unchanged:
//   projection  k.fitProjection / k.iso / k.depthOf with the CarScope VIEW (azimuth 56, elevation 28)
//   screen      the P2-A2.1 basis adapter u' = width - u, applied exactly once
//   tone        G.toneOf (kit light and bands): 0-3 = shades[0-3], 4 = top
//   colours     automotive/materials.mjs PALETTES and LINE, LINE_W
// Added here: depth-buffer visibility (rasterize.mjs) and shared-chain vectorisation (trace.mjs), so
// 37k triangles become a few hundred region paths instead of one path per triangle.
import { rasterize } from "./rasterize.mjs";
import { traceLabels, ringsFrom } from "./trace.mjs";
import { PALETTES, LINE, LINE_W } from "../automotive/materials.mjs";
import { VIEW } from "../automotive/camera.mjs";

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Projection fitted to the meshes' world bounding box with the CarScope view. */
export function fitMeshProjection(parts, k, view = VIEW) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.triangles.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p.triangles[i]); hi[i % 3] = Math.max(hi[i % 3], p.triangles[i]); }
  const corners = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) corners.push([x, y, z]);
  return { P: k.fitProjection(corners, view.width, view.height, { pad: view.pad, azimuth: view.azimuth, elevation: view.elevation }), bounds: { lo, hi } };
}

/**
 * @param {{id:string,triangles:ArrayLike<number>,palettes:string[],priority?:number}[]} parts
 *   triangles: 9 numbers per triangle, CarScope world cm (+X forward, +Y left, +Z up)
 * @param {{k:object,G:object}} anatomy pinned kit modules (automotive/anatomy.mjs)
 */
export function meshAnatomySvg(parts, { k, G }, { view = VIEW, samples = 4, tolerance = 0.75, P = null, minRegion = 6, flatPalettes = [] } = {}) {
  const t0 = performance.now();
  P ??= fitMeshProjection(parts, k, view).P;
  const V = G.viewOf(P);
  const screen = (p) => { const [u, v] = k.iso(p, P); return [view.width - u, v, k.depthOf(p, P)]; };
  const labelKey = new Map(), labelInfo = [null];
  const tris = [], triLabel = [];
  parts.forEach((part, pi) => {
    const T = part.triangles;
    for (let t = 0; t < T.length / 9; t++) {
      const a = [T[9 * t], T[9 * t + 1], T[9 * t + 2]], b = [T[9 * t + 3], T[9 * t + 4], T[9 * t + 5]], c = [T[9 * t + 6], T[9 * t + 7], T[9 * t + 8]];
      let n = cross(sub(b, a), sub(c, a));
      if (!(n[0] || n[1] || n[2])) continue;
      if (G.dot3(n, V) < 0) n = [-n[0], -n[1], -n[2]]; // double-sided: shade the side facing the viewer
      const palette = part.palettes[t];
      if (!PALETTES[palette]?.shades) throw new Error(`${part.id}: no shaded Anatomy palette "${palette}"`);
      const tone = G.toneOf(n, P);
      const key = `${pi}|${palette}|${tone}`;
      let label = labelKey.get(key);
      if (label === undefined) { label = labelInfo.length; labelKey.set(key, label); labelInfo.push({ part: pi, id: part.id, palette, tone, color: tone < 4 ? PALETTES[palette].shades[tone] : PALETTES[palette].top }); }
      tris.push({ a: screen(a), b: screen(b), c: screen(c), priority: part.priority ?? 0 });
      triLabel.push(label);
    }
  });
  const raster = rasterize(tris, { width: view.width, height: view.height, samples });
  const labels = new Int32Array(raster.owner.length);
  const visibleTris = new Set();
  for (let i = 0; i < labels.length; i++) { const o = raster.owner[i]; if (o >= 0) { labels[i] = triLabel[o]; visibleTris.add(o); } }
  const flat = flattenTones(labels, labelInfo, flatPalettes);
  const merged = mergeSpeckles(labels, raster.w, raster.h, labelInfo, Math.round(minRegion * samples * samples));
  const tTrace = performance.now();
  const traced = traceLabels(labels, raster.w, raster.h, { tolerance });
  const toSvg = (pts) => {
    const out = [];
    for (const [x, y] of pts) {
      const q = [Math.round((x / samples) * 10) / 10, Math.round((y / samples) * 10) / 10];
      if (!out.length || out.at(-1)[0] !== q[0] || out.at(-1)[1] !== q[1]) out.push(q);
    }
    return out;
  };
  const fills = [];
  for (let l = 1; l < labelInfo.length; l++) {
    const rings = traced.rings(l).map(toSvg).filter((r) => r.length >= 3);
    if (rings.length) fills.push({ ...labelInfo[l], label: l, d: rings.map((r) => k.pathOf(r, true)).join("") });
  }
  // hi: silhouette and part boundaries; lo: material change inside a part; tone bands: no line.
  const strokes = [];
  for (const ch of traced.chains) {
    const A = labelInfo[ch.a], B = labelInfo[ch.b];
    const tone = !A || !B || A.part !== B.part ? "hi" : A.palette !== B.palette ? "lo" : null;
    if (!tone) continue;
    const pts = toSvg(ch.pts);
    if (pts.length >= 2) strokes.push({ tone, parts: [A?.id ?? null, B?.id ?? null], d: k.pathOf(pts), pts });
  }
  return {
    P, fills, strokes, raster, labels, labelInfo,
    stats: { triangles: tris.length, visibleTriangles: visibleTris.size, labels: labelInfo.length - 1, regions: fills.length, flattenedSamples: flat, mergedSpeckles: merged, boundaryEdges: traced.edges,
      chains: traced.chains.length, points: traced.chains.reduce((a, c) => a + c.pts.length, 0), msRaster: Math.round(tTrace - t0), msTrace: Math.round(performance.now() - tTrace) },
  };
}

/**
 * Kit-style flat palettes (glass, lenses, plates are flat `poly` fills in the car kit): every visible
 * label of a (part, palette) takes the tone covering most of its visible area. Only the tone changes.
 */
export function flattenTones(labels, labelInfo, palettes) {
  if (!palettes.length) return 0;
  const area = new Float64Array(labelInfo.length);
  for (const l of labels) area[l]++;
  const best = new Map();
  labelInfo.forEach((info, l) => {
    if (!info || !palettes.includes(info.palette)) return;
    const key = `${info.part}|${info.palette}`;
    if (!best.has(key) || area[l] > area[best.get(key)]) best.set(key, l);
  });
  const to = new Int32Array(labelInfo.length).map((_, l) => (labelInfo[l] && best.has(`${labelInfo[l].part}|${labelInfo[l].palette}`) ? best.get(`${labelInfo[l].part}|${labelInfo[l].palette}`) : l));
  let changed = 0;
  for (let i = 0; i < labels.length; i++) if (to[labels[i]] !== labels[i]) { labels[i] = to[labels[i]]; changed++; }
  return changed;
}

/**
 * Tone speckles: connected regions smaller than `least` samples join the neighbouring region of the
 * same part and palette they share the longest boundary with. Part and material borders never move.
 */
export function mergeSpeckles(labels, w, h, labelInfo, least) {
  const comp = new Int32Array(labels.length).fill(-1);
  let merged = 0;
  const queue = new Int32Array(labels.length);
  for (let s = 0; s < labels.length; s++) {
    if (comp[s] >= 0 || !labels[s]) continue;
    const l = labels[s];
    let head = 0, tail = 0;
    queue[tail++] = s; comp[s] = s;
    const touch = new Map();
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0) continue;
        if (labels[j] === l) { if (comp[j] < 0) { comp[j] = s; queue[tail++] = j; } } else touch.set(labels[j], (touch.get(labels[j]) ?? 0) + 1);
      }
    }
    if (tail >= least) continue;
    const me = labelInfo[l];
    let target = 0, most = 0;
    for (const [n, count] of touch) {
      const o = labelInfo[n];
      if (o && o.part === me.part && o.palette === me.palette && count > most) { most = count; target = n; }
    }
    if (!target) continue;
    for (let q = 0; q < tail; q++) labels[queue[q]] = target;
    merged++;
  }
  return merged;
}

/**
 * Closed outline of one part's visible region from its boundary strokes (for state accents).
 * Rings are oriented for the default nonzero fill: the largest is the outside, the rest are holes.
 */
export function regionOutline(strokes, id, k) {
  const area = (r) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const rings = ringsFrom(strokes.filter((s) => (s.parts[0] === id) !== (s.parts[1] === id)).map((s) => s.pts)).filter((r) => r.length >= 3);
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  return rings.map((r, i) => k.pathOf((area(r) > 0) === (i === 0) ? r : r.slice().reverse(), true)).join("");
}

const attr = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([a, v]) => ` ${a}="${v}"`).join("");

/** Flat markup (attributes only, like the app asset): one group per part, strokes on top. */
export function fillMarkup(fills, partIds) {
  return partIds.map((id) => {
    const own = fills.filter((f) => f.id === id);
    if (!own.length) return "";
    // A same-colour hairline hides anti-aliasing seams between abutting regions (kit "seamless").
    return `<g${attr({ id: `part-${id}`, "data-part": id })}>` + own.map((f) => `<path${attr({ d: f.d, fill: f.color, "fill-rule": "evenodd", stroke: f.color, "stroke-width": 0.3, "stroke-linejoin": "round" })}/>`).join("") + "</g>";
  }).join("");
}

export function strokeMarkup(strokes) {
  return ["hi", "lo"].map((tone) => {
    const d = strokes.filter((s) => s.tone === tone).map((s) => s.d).join("");
    return d ? `<path${attr({ d, fill: "none", stroke: LINE[tone], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round", "data-line": tone })}/>` : "";
  }).join("");
}
