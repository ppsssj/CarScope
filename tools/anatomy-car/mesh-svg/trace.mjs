// Topology-preserving vectorisation of a label image. Every boundary between two labels is traced
// once as a chain between junctions and simplified once, then each label's outline is assembled from
// those shared chains. Neighbouring regions therefore keep exactly the same edge: no gaps, no overlap.
// Fill with fill-rule="evenodd": the parity of an edge set does not depend on how chains are linked.

/** Douglas-Peucker on [x,y] points with fixed endpoints. */
export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = points[i], [bx, by] = points[j];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, far = tolerance;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = points[k];
      const dist = len ? Math.abs(dx * (py - ay) - dy * (px - ax)) / len : Math.hypot(px - ax, py - ay);
      if (dist > far) { far = dist; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * @param {Int32Array} labels w*h, 0 = background
 * @returns {{chains:{pts:number[][],a:number,b:number}[], rings:(label:number)=>number[][][]}} in raster units
 */
export function traceLabels(labels, w, h, { tolerance = 0.75 } = {}) {
  const W = w + 1;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : labels[y * w + x]);
  const hEdge = new Int32Array(W * (h + 1)).fill(-1); // edge from corner (x,y) to (x+1,y)
  const vEdge = new Int32Array(W * (h + 1)).fill(-1); // edge from corner (x,y) to (x,y+1)
  const ea = [], eb = [], la = [], lb = [];
  const add = (c0, c1, p, q) => { ea.push(c0); eb.push(c1); la.push(Math.min(p, q)); lb.push(Math.max(p, q)); return ea.length - 1; };
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) { const p = at(x, y - 1), q = at(x, y); if (p !== q) hEdge[y * W + x] = add(y * W + x, y * W + x + 1, p, q); }
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) { const p = at(x - 1, y), q = at(x, y); if (p !== q) vEdge[y * W + x] = add(y * W + x, (y + 1) * W + x, p, q); }
  const incident = (c) => {
    const x = c % W, out = [];
    if (hEdge[c] >= 0) out.push(hEdge[c]);
    if (x > 0 && hEdge[c - 1] >= 0) out.push(hEdge[c - 1]);
    if (vEdge[c] >= 0) out.push(vEdge[c]);
    if (c >= W && vEdge[c - W] >= 0) out.push(vEdge[c - W]);
    return out;
  };
  const junction = (c) => {
    const e = incident(c);
    return e.length !== 2 || la[e[0]] !== la[e[1]] || lb[e[0]] !== lb[e[1]];
  };
  const seen = new Uint8Array(ea.length);
  const chains = [];
  const walk = (start, e0) => {
    const corners = [start];
    let c = start, e = e0;
    for (;;) {
      seen[e] = 1;
      c = ea[e] === c ? eb[e] : ea[e];
      corners.push(c);
      if (c === start || junction(c)) break;
      const next = incident(c).find((x) => x !== e && !seen[x]);
      if (next === undefined) break;
      e = next;
    }
    const pts = corners.map((k) => [k % W, Math.floor(k / W)]);
    let simple;
    if (corners[0] === corners.at(-1) && pts.length > 3) {
      // Closed loop: keep the start and its farthest point fixed, simplify both halves.
      let far = 1, best = -1;
      pts.forEach(([x, y], k) => { const d = Math.hypot(x - pts[0][0], y - pts[0][1]); if (d > best) { best = d; far = k; } });
      simple = [...simplify(pts.slice(0, far + 1), tolerance), ...simplify(pts.slice(far), tolerance).slice(1)];
    } else simple = simplify(pts, tolerance);
    chains.push({ pts: simple, a: la[e0], b: lb[e0] });
  };
  for (let c = 0; c < W * (h + 1); c++) {
    const e = incident(c);
    if (!e.length || !junction(c)) continue;
    for (const x of e) if (!seen[x]) walk(c, x);
  }
  for (let e = 0; e < ea.length; e++) if (!seen[e]) walk(ea[e], e); // closed loops without junctions

  const byLabel = new Map();
  chains.forEach((ch, i) => { for (const l of [ch.a, ch.b]) if (l) (byLabel.get(l) ?? byLabel.set(l, []).get(l)).push(i); });
  const key = ([x, y]) => `${x},${y}`;
  const rings = (label) => ringsFrom((byLabel.get(label) ?? []).map((i) => chains[i].pts), key);
  return { chains, rings, edges: ea.length };
}

/** Link open polylines that share endpoints into closed rings (any pairing is valid for evenodd). */
export function ringsFrom(polylines, key = ([x, y]) => `${x},${y}`) {
  const ends = new Map();
  polylines.forEach((p, i) => { for (const end of [p[0], p.at(-1)]) (ends.get(key(end)) ?? ends.set(key(end), []).get(key(end))).push(i); });
  const used = new Uint8Array(polylines.length);
  const out = [];
  for (let i = 0; i < polylines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const ring = polylines[i].slice();
    const start = key(ring[0]);
    while (key(ring.at(-1)) !== start) {
      const j = (ends.get(key(ring.at(-1))) ?? []).find((n) => !used[n]);
      if (j === undefined) throw new Error(`Open boundary at ${key(ring.at(-1))}`);
      used[j] = 1;
      const p = polylines[j];
      ring.push(...(key(p[0]) === key(ring.at(-1)) ? p.slice(1) : p.slice().reverse().slice(1)));
    }
    out.push(ring);
  }
  return out;
}
