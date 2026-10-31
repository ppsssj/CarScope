// Visibility for arbitrary triangle meshes in an Anatomy view. The kit's own depth order works on
// recorded analytic solids; an imported mesh has none, so hidden surfaces are removed with a
// supersampled depth buffer instead. Output: the triangle visible at each sample (-1 = background).

/**
 * @param {{a:number[],b:number[],c:number[],priority?:number}[]} tris
 *   a/b/c = [screenX, screenY, depth] in SVG units; larger depth is nearer the viewer (kit depthOf).
 * @param {{width:number,height:number,samples:number,epsilon?:number}} opts
 *   samples = raster pixels per SVG unit. Depths within epsilon (cm) go to the higher priority, so a
 *   lamp lens lying on its housing is not decided by floating-point noise.
 */
export function rasterize(tris, { width, height, samples, epsilon = 0.02 }) {
  const w = Math.round(width * samples), h = Math.round(height * samples);
  const owner = new Int32Array(w * h).fill(-1);
  const depth = new Float32Array(w * h).fill(-Infinity);
  const prio = new Float32Array(w * h).fill(-Infinity);
  tris.forEach((t, i) => {
    const [ax, ay, az] = t.a, [bx, by, bz] = t.b, [cx, cy, cz] = t.c;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return; // edge-on: covers no sample
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) * samples)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) * samples));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) * samples)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) * samples));
    const p = t.priority ?? 0;
    for (let py = y0; py <= y1; py++) {
      const sy = (py + 0.5) / samples;
      for (let px = x0; px <= x1; px++) {
        const sx = (px + 0.5) / samples;
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area;
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const k = py * w + px;
        const d = z - depth[k];
        if (d > epsilon || (d >= -epsilon && p > prio[k])) { depth[k] = z; prio[k] = p; owner[k] = i; }
      }
    }
  });
  return { owner, depth, w, h, samples };
}
