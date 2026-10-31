// mesh-svg: synthetic meshes only. Visibility, vectorisation and the reuse of the pinned kit's
// projection/tone rules are checked against independent expectations.
import test from "node:test";
import assert from "node:assert/strict";
import { rasterize } from "../mesh-svg/rasterize.mjs";
import { simplify, traceLabels, ringsFrom } from "../mesh-svg/trace.mjs";
import { meshAnatomySvg, mergeSpeckles, flattenTones, regionOutline, fillMarkup } from "../mesh-svg/mesh-svg.mjs";
import { loadAnatomy } from "../automotive/anatomy.mjs";
import { VIEW, svgScreenPoint } from "../automotive/camera.mjs";
import { PALETTES } from "../automotive/materials.mjs";

const quad = (x0, y0, x1, y1, z, extra = {}) => [
  { a: [x0, y0, z], b: [x1, y0, z], c: [x1, y1, z], ...extra },
  { a: [x0, y0, z], b: [x1, y1, z], c: [x0, y1, z], ...extra },
];

test("depth buffer keeps the nearer surface; equal depth goes to the higher priority", () => {
  const tris = [...quad(0, 0, 10, 10, 1), ...quad(5, 0, 15, 10, 2), ...quad(0, 0, 4, 4, 1.005, { priority: 1 }), { a: [0, 0, 0], b: [5, 5, 0], c: [10, 10, 0] }];
  const r = rasterize(tris, { width: 16, height: 10, samples: 2 });
  const at = (x, y) => r.owner[Math.floor(y * 2) * r.w + Math.floor(x * 2)];
  assert.ok([2, 3].includes(at(7, 5)), "nearer quad wins the overlap");
  assert.ok([0, 1].includes(at(2, 8)), "far quad visible where uncovered");
  assert.ok([4, 5].includes(at(1, 1)), "coplanar decal wins by priority");
  assert.ok([2, 3].includes(at(14.5, 0.5)), "near quad alone at its far end");
  assert.equal(at(15.8, 9.8), -1, "background stays -1");
  assert.ok(!r.owner.includes(6), "edge-on triangle covers nothing");
});

test("Douglas-Peucker removes a pixel staircase and keeps endpoints", () => {
  const stair = []; for (let i = 0; i <= 10; i++) stair.push([i, i], [i + 1, i]);
  const s = simplify(stair, 1);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s.at(-1), [11, 10]);
  assert.ok(s.length <= 3);
});

// Even-odd point test over all rings of a label.
const inside = (rings, x, y) => rings.reduce((acc, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return acc !== c;
}, false);

test("traced regions reproduce every pixel exactly without simplification, holes included", () => {
  const w = 24, h = 18, L = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    L[y * w + x] = (x - 8) ** 2 + (y - 9) ** 2 < 30 ? 1 : x > 13 && y > 3 && y < 15 ? 2 : (x + y) % 11 === 0 ? 3 : 0;
    if (x >= 6 && x <= 9 && y >= 8 && y <= 10) L[y * w + x] = 2; // island of 2 inside 1
  }
  const t = traceLabels(L, w, h, { tolerance: 0 });
  for (const label of [1, 2, 3]) {
    const rings = t.rings(label);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.equal(inside(rings, x + 0.5, y + 0.5), L[y * w + x] === label, `label ${label} at ${x},${y}`);
  }
  // Every chain is shared by exactly the two labels it separates.
  for (const c of t.chains) assert.notEqual(c.a, c.b);
});

test("ring linking fails loudly on an open boundary", () => {
  assert.throws(() => ringsFrom([[[0, 0], [1, 0]], [[1, 0], [1, 1]]]), /Open boundary/);
});

test("speckles merge only into the same part and palette; flat palettes take one tone", () => {
  const info = [null, { part: 0, palette: "paint", tone: 1 }, { part: 0, palette: "paint", tone: 2 }, { part: 1, palette: "paint", tone: 2 }, { part: 0, palette: "glass", tone: 0 }, { part: 0, palette: "glass", tone: 3 }];
  const w = 10, h = 4, L = new Int32Array(w * h).fill(1);
  L[1 * w + 2] = 2; // 1-sample island of the same part -> merged into 1
  L[1 * w + 6] = 3; // island of another part -> kept
  assert.equal(mergeSpeckles(L, w, h, info, 4), 1);
  assert.equal(L[1 * w + 2], 1);
  assert.equal(L[1 * w + 6], 3);
  const G = Int32Array.from([4, 4, 4, 5, 1]);
  assert.equal(flattenTones(G, info, ["glass"]), 1);
  assert.deepEqual([...G], [4, 4, 4, 4, 1]);
});

// Two boxes: a body and a smaller "door" box in front of it on the visible (+Y, left) side.
function box([x0, y0, z0], [x1, y1, z1]) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return Float64Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}

test("synthetic mesh: kit projection and screen adapter, occlusion, kit tones and part groups", async () => {
  const anatomy = await loadAnatomy();
  const body = box([-200, -80, 20], [200, 80, 140]);
  const door = box([-40, 80, 40], [60, 90, 120]);
  const parts = [
    { id: "body", triangles: body, palettes: new Array(12).fill("paint") },
    { id: "door-front-left", triangles: door, palettes: new Array(12).fill("paint") },
  ];
  const r = meshAnatomySvg(parts, anatomy, { samples: 4, tolerance: 0.75, minRegion: 0 });
  // Screen position: the door's visible-region centroid sits where the existing adapter puts its
  // outer face centre (svgScreenPoint(k.iso(...))), i.e. same basis as the car SVG and GLB.
  const doorPx = []; r.labels.forEach((l, i) => { if (r.labelInfo[l]?.id === "door-front-left") doorPx.push([(i % r.raster.w + 0.5) / 4, (Math.floor(i / r.raster.w) + 0.5) / 4]); });
  const c = doorPx.reduce((a, p) => [a[0] + p[0] / doorPx.length, a[1] + p[1] / doorPx.length], [0, 0]);
  const expect = svgScreenPoint(anatomy.k.iso([10, 90, 80], r.P));
  assert.ok(Math.hypot(c[0] - expect[0], c[1] - expect[1]) < 6, `door centroid ${c} vs ${expect}`);
  assert.equal(VIEW.width - anatomy.k.iso([10, 90, 80], r.P)[0], expect[0]);
  // Occlusion: the body's left (+Y) face (triangles 8, 9) loses exactly the samples the door covers.
  const alone = meshAnatomySvg(parts.slice(0, 1), anatomy, { samples: 4, tolerance: 0.75, minRegion: 0, P: r.P });
  const leftFace = (res) => res.raster.owner.filter((o) => o === 8 || o === 9).length;
  const doorSamples = r.raster.owner.filter((o) => o >= 12).length;
  assert.ok(doorSamples > 0 && leftFace(r) < leftFace(alone));
  assert.ok(Math.abs(leftFace(alone) - leftFace(r) - doorSamples) / doorSamples < 0.25, "hidden body area ~ door's visible area");
  // Tones come from the kit rule: roof = top tone, left face = toneOf(+Y).
  const tone = (n) => anatomy.G.toneOf(n, r.P);
  const colour = (t) => (t < 4 ? PALETTES.paint.shades[t] : PALETTES.paint.top);
  assert.ok(r.fills.some((f) => f.id === "body" && f.color === colour(tone([0, 0, 1]))));
  assert.ok(r.fills.some((f) => f.id === "body" && f.color === colour(tone([0, 1, 0]))));
  // Markup: one group per part with data-part, evenodd fills; outline is a closed region.
  const markup = fillMarkup(r.fills, ["body", "door-front-left"]);
  assert.match(markup, /<g id="part-door-front-left" data-part="door-front-left">/);
  assert.match(markup, /fill-rule="evenodd"/);
  const outline = regionOutline(r.strokes, "door-front-left", anatomy.k);
  assert.match(outline, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
  // Back faces of the far (-Y) side are never visible.
  assert.ok(r.stats.visibleTriangles < r.stats.triangles);
});
