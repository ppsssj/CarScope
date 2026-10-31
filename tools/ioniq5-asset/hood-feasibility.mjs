#!/usr/bin/env node
// P3-A1: IONIQ 5 hood geometry and hinge feasibility on the converted OpenX GLB (P2-A6), unmodified.
//   node tools/ioniq5-asset/hood-feasibility.mjs --glb=<hyundai_ioniq_5_2022.glb> --out=<dir outside the repo>
//        [--svg-axis=A] [--svg-angles=0,15,30,45] [--quick]
// Writes hood-feasibility.json (hierarchy, hood geometry, axis candidates, exact mesh collision sweeps,
// under-hood probe, SVG pose metrics) and svg/*.svg. Everything model-derived stays outside the repo.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, trs, mul, apply } from "./analyze.mjs";
import { gltfToCarCm } from "./profile.mjs";
import { glbParts, buildIoniqSvg } from "./anatomy-svg.mjs";
import { fitMeshProjection, regionOutline } from "../anatomy-car/mesh-svg/mesh-svg.mjs";
import * as H from "./hood.mjs";
import { staticScene, meshClearance, baselineContacts } from "./collision.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const r = (v, d = 2) => (Array.isArray(v) ? v.map((x) => r(x, d)) : typeof v === "number" ? Math.round(v * 10 ** d) / 10 ** d + 0 : v);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Rise of the hood's front-most vertex (cm) when rotated by `deg`. */
export function frontLift(hood, axis, deg) {
  let k = 0;
  for (let i = 0; i < hood.length; i += 3) if (hood[i] > hood[k]) k = i;
  return H.rotatePoints(hood.subarray(k, k + 3), axis, deg)[2] - hood[k + 2];
}

/** Smallest angle (0.1 degree steps, up to 90) at which the front edge has risen `cm`, or null. */
export function angleForLift(hood, axis, cm) {
  for (let i = 0; i <= 900; i++) if (frontLift(hood, axis, i / 10) >= cm) return i / 10;
  return null;
}

/** Hood node, its group and their transforms, from the GLB alone (glTF frame and CarScope cm). */
export function hoodHierarchy(glbBytes) {
  const { json } = readGlb(glbBytes);
  const parent = new Map();
  json.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const world = (i) => { const n = json.nodes[i], l = trs(n.translation, n.rotation, n.scale); return parent.has(i) ? mul(world(parent.get(i)), l) : l; };
  const at = (name) => json.nodes.findIndex((n) => n.name === name);
  const hood = at(H.HOOD_NODE), group = at(H.HOOD_GROUP);
  if (hood < 0 || group < 0) throw new Error(`${H.HOOD_NODE} or ${H.HOOD_GROUP} missing`);
  const path = []; for (let k = hood; k !== undefined; k = parent.get(k)) path.unshift(json.nodes[k].name);
  const W = world(group), o = gltfToCarCm(apply(W, [0, 0, 0]));
  const axis = (v) => r(gltfToCarCm(apply(W, v)).map((x, i) => (x - o[i]) / 100), 6);
  const local = (i) => ({ translation: json.nodes[i].translation ?? null, rotation: json.nodes[i].rotation ?? null, scale: json.nodes[i].scale ?? null, matrix: json.nodes[i].matrix ?? null });
  return {
    path, hoodNode: { name: H.HOOD_NODE, index: hood, mesh: json.meshes[json.nodes[hood].mesh].name, primitives: json.meshes[json.nodes[hood].mesh].primitives.length, local: local(hood), children: json.nodes[hood].children ?? [] },
    group: { name: H.HOOD_GROUP, index: group, parent: json.nodes[parent.get(group)].name, local: local(group), worldGltf: r(W, 6), originCm: r(o, 3), gltfLocalAxesInCarFrame: { x: axis([1, 0, 0]), y: axis([0, 1, 0]), z: axis([0, 0, 1]) } },
    lateralAxisCar: axis([0, 1, 0]),
  };
}

export function sweep(hood, axis, scene, baseline, angles, cutoff = 10) {
  return angles.map((deg) => {
    const t0 = performance.now();
    const c = meshClearance(H.rotatePoints(hood, axis, deg), scene, { cutoff, baseline });
    const regions = Object.fromEntries(Object.entries(c.byRegion).filter(([, v]) => v.minCm < cutoff).map(([k, v]) => [k, { minCm: r(v.minCm, 3), intersectingPairs: v.intersectingPairs }]));
    return { deg, check: deg === 0 ? "CLOSED_BASELINE" : c.intersectingPairs ? "NEW_MESH_INTERSECTION" : "NO_NEW_INTERSECTION", method: c.method,
      newIntersectingPairs: c.intersectingPairs, baselineSeamPairs: c.baselineIntersectingPairs, minNewClearanceCm: c.minDistanceCm === null ? `>=${cutoff}` : r(c.minDistanceCm, 3),
      closest: c.closest && { region: c.closest.region, onHoodCm: r(c.closest.onMoving, 1), onStaticCm: r(c.closest.onStatic, 1) }, regions,
      intersectionsAt: [...new Set(c.intersections.map((x) => `${x.region}@${r(x.at, 0).join(",")}`))].slice(0, 12), ms: Math.round(performance.now() - t0) };
  });
}

/** Least-interference pivot inside a plausible hinge zone (lateral axis). A visual candidate only. */
export function searchAxis(hood, scene, baseline, { zone, step = 1.25, angles = [5, 10, 20, 30, 40, 50, 60], reference, minClearance = 0.25 }) {
  const rows = [];
  for (let x = zone.x[0]; x <= zone.x[1] + 1e-9; x += step)
    for (let z = zone.z[0]; z <= zone.z[1] + 1e-9; z += step) {
      const axis = H.orientOpening({ point: [x, 0, z], direction: [0, 1, 0] }, hood);
      let worst = Infinity, newPairs = 0;
      for (const a of angles) {
        const c = meshClearance(H.rotatePoints(hood, axis, a), scene, { cutoff: 5, baseline });
        newPairs += c.intersectingPairs;
        worst = Math.min(worst, c.minDistanceCm ?? 5);
      }
      rows.push({ x: r(x, 2), z: r(z, 2), newPairs, minClearanceCm: r(worst, 3), toReferenceCm: r(Math.hypot(x - reference[0], z - reference[2]), 2) });
    }
  // Smallest correction of the reference (B) that removes interference: among pivots with no new
  // intersection and at least `minClearance` cm to non-seam geometry, the one nearest B. (Ranking by
  // clearance alone just drifts to the zone boundary, since a pivot farther back lifts the panel away.)
  const ok = (x) => x.newPairs === 0 && x.minClearanceCm >= minClearance;
  rows.sort((a, b) => Number(ok(b)) - Number(ok(a)) || a.toReferenceCm - b.toReferenceCm || b.minClearanceCm - a.minClearanceCm);
  return { best: rows[0], feasible: ok(rows[0]), evaluated: rows.length, zeroNew: rows.filter((x) => x.newPairs === 0).length, qualifying: rows.filter(ok).length, top: rows.slice(0, 10), zone, step, angles, minClearanceCm: minClearance };
}

function rayCast(o, d, meshes) {
  let best = null;
  for (const m of meshes) {
    const T = m.triangles;
    for (let i = 0; i < T.length; i += 9) {
      const e1 = [T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]], e2 = [T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]];
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = [o[0] - T[i], o[1] - T[i + 1], o[2] - T[i + 2]], f = 1 / det, u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
      if (t > 1e-6 && (!best || t < best.t)) best = { t, mesh: m.name };
    }
  }
  return best;
}

/** Under-hood space: vertical probe, horizontal probes from the bay centre, placeholder volume. */
export function interiorAssessment(hood, others, json) {
  const probe = H.underHoodProbe(hood, others, { step: 5 });
  const byHit = {};
  for (const s of probe) byHit[s.hit ?? "NONE"] = (byHit[s.hit ?? "NONE"] ?? 0) + 1;
  const centre = probe.filter((s) => Math.abs(s.y) <= 40 && s.hit);
  const free = centre.map((s) => s.freeCm).sort((a, b) => a - b);
  const bayCentre = [160, 0, 60];
  const dirs = { "+X (front)": [1, 0, 0], "-X (rear, toward cabin)": [-1, 0, 0], "+Y (left)": [0, 1, 0], "-Y (right)": [0, -1, 0], "-Z (down)": [0, 0, -1], "+Z (up)": [0, 0, 1] };
  const horizontal = Object.fromEntries(Object.entries(dirs).map(([k, d]) => { const h = rayCast(bayCentre, d, [{ name: H.HOOD_NODE, triangles: hood }, ...others]); return [k, h ? { mesh: h.mesh, distanceCm: r(h.t, 1) } : null]; }));
  const named = others.map((n) => n.name);
  return {
    probe: { stepCm: 5, samples: probe.length, firstHitBelowHood: byHit, centreBand: { halfWidthCm: 40, samples: centre.length, freeHeightCm: free.length ? { min: r(free[0], 1), p50: r(free[Math.floor(free.length / 2)], 1), max: r(free.at(-1), 1) } : null, hitZCm: centre.length ? { min: r(Math.min(...centre.map((s) => s.hitZ)), 1), max: r(Math.max(...centre.map((s) => s.hitZ)), 1) } : null } },
    raysFromBayCentre: { originCm: bayCentre, hits: horizontal },
    frontCompartmentMeshes: named.filter((n) => /frunk|trunk|motor|engine|radiator|coolant|washer|battery|reservoir|strut|hinge/i.test(n)),
    materialsDoubleSided: Object.fromEntries(json.materials.map((m) => [m.name, Boolean(m.doubleSided)])),
    placeholder: H.placeholderBox(probe),
  };
}

const boxTriangles = ({ min: a, max: b }) => {
  const v = (i) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return Float64Array.from(quads.flatMap(([p, q, s, t]) => [...v(p), ...v(q), ...v(s), ...v(p), ...v(s), ...v(t)]));
};
const pathBox = (d) => { const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number); const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const unionBox = (bs) => bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

/** Hood pose frames with one shared camera, plus checks on projection, occlusion and determinism. */
export async function svgFrames(glbBytes, nodes, axis, angles, { placeholder = null } = {}) {
  const posed = (deg, extra = []) => [...nodes.map((n) => (n.name === H.HOOD_NODE ? { ...n, triangles: H.rotatePoints(n.triangles, axis, deg) } : n)), ...extra];
  const reference = await buildIoniqSvg(glbBytes);
  const closedDefault = await buildIoniqSvg(glbBytes, { nodes: posed(0) });
  const { k, G } = reference.anatomy;
  // Shared camera: the CarScope view fitted to the closed car plus the hood at the largest angle.
  const fitParts = [...nodes.map((n) => ({ triangles: n.triangles })), { triangles: H.rotatePoints(nodes.find((n) => n.name === H.HOOD_NODE).triangles, axis, Math.max(...angles)) }];
  const projection = fitMeshProjection(fitParts, k);
  const frames = [];
  for (const deg of angles) {
    const t0 = performance.now();
    const built = await buildIoniqSvg(glbBytes, { nodes: posed(deg), projection });
    const ms = performance.now() - t0;
    const hoodFills = built.result.fills.filter((f) => f.id === "hood");
    // Projection check: the hood's projected vertex bounds against the traced hood regions (screen u' = width - u).
    const T = H.rotatePoints(nodes.find((n) => n.name === H.HOOD_NODE).triangles, axis, deg);
    let pb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < T.length; i += 3) { const [u, v] = k.iso([T[i], T[i + 1], T[i + 2]], projection.P); const x = 640 - u; pb = [Math.min(pb[0], x), Math.min(pb[1], v), Math.max(pb[2], x), Math.max(pb[3], v)]; }
    const fb = hoodFills.length ? unionBox(hoodFills.map((f) => pathBox(f.d))) : null;
    const outline = regionOutline(built.result.strokes, "hood", k);
    const highlighted = built.svg.replace("</svg>", `<path d="${outline}" fill="none" stroke="#2563eb" stroke-width="1.6" stroke-linejoin="round" data-highlight="hood"/></svg>`);
    frames.push({ deg, built, highlighted, ms, hoodRegions: hoodFills.length, projectedHoodBox: r(pb, 1), tracedHoodBox: fb && r(fb, 1),
      boxDeltaPx: fb && r(Math.max(...fb.map((v, i) => Math.abs(v - pb[i]))), 2), visibleTriangles: built.result.stats.visibleTriangles });
  }
  const again = await buildIoniqSvg(glbBytes, { nodes: posed(angles.at(-1)), projection });
  let withPlaceholder = null;
  if (placeholder) {
    const extra = [{ name: H.PLACEHOLDER_TAG, id: "synthetic-debug-placeholder", triangles: boxTriangles(placeholder), materials: Array(12).fill(H.PLACEHOLDER_TAG), palettes: Array(12).fill("amber") }];
    const built = await buildIoniqSvg(glbBytes, { nodes: posed(angles.at(-1), extra), projection });
    withPlaceholder = { built, regions: built.result.fills.filter((f) => f.id === "synthetic-debug-placeholder").length,
      svg: built.svg.replace("</svg>", `<text x="8" y="16" font-family="monospace" font-size="10" fill="#b45309">${H.PLACEHOLDER_TAG} (not a real part)</text></svg>`) };
  }
  return { reference, closedDefault, projection, frames, again, withPlaceholder };
}

async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  if (!args.glb || !args.out) { console.error("usage: node tools/ioniq5-asset/hood-feasibility.mjs --glb=<.glb> --out=<dir outside the repo> [--svg-axis=A|B|C] [--svg-angles=0,15,30,45] [--quick]"); return 2; }
  const out = resolve(args.out);
  const rel = relative(REPO, out);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`Refusing to write model-derived output inside the CarScope repo: ${out}`);
  const glb = readFileSync(resolve(args.glb));
  const t0 = performance.now();
  const { json } = readGlb(glb);
  const hierarchy = hoodHierarchy(glb);
  const nodes = glbParts(glb);
  const id = H.identifyHood(nodes.map((n) => (n.name === H.HOOD_NODE ? { ...n, parent: hierarchy.path.at(-2) } : n)));
  if (id.problems.length) throw new Error(`hood identification: ${id.problems.join("; ")}`);
  const hood = id.hood.triangles;
  const others = nodes.filter((n) => n.name !== H.HOOD_NODE);
  const scene = staticScene(others, { region: H.bodyRegion });
  const baseline = baselineContacts(hood, scene);
  const seamRegions = {};
  for (const i of baseline) { const s = scene.items[i]; const g = (seamRegions[s.region] ??= { triangles: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }); g.triangles++; s.tri.flat().forEach((v, j) => { g.lo[j % 3] = Math.min(g.lo[j % 3], v); g.hi[j % 3] = Math.max(g.hi[j % 3], v); }); }
  const { candidates: AB, rearMost, hoodBounds } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: hierarchy.group.originCm, groupLateralCm: hierarchy.lateralAxisCar });
  const B = AB.find((c) => c.id === "B");
  // Hinge zone: at or behind the hood's rear-most point, at or below its top there (a pivot cannot float
  // above the panel skin), and forward of the windshield base region.
  const zone = { x: [r(rearMost.rearX - 7.5, 2), r(rearMost.rearX + 12.5, 2)], z: [r(rearMost.rearZ - 15, 2), r(rearMost.rearZ, 2)] };
  const search = searchAxis(hood, scene, baseline, { zone, step: args.quick ? 2.5 : 1.25, reference: B.point });
  const { candidates } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: hierarchy.group.originCm, groupLateralCm: hierarchy.lateralAxisCar, searched: { point: [search.best.x, 0, search.best.z] } });
  const angles = args.quick ? [0, 5, 15, 30, 45, 60] : Array.from({ length: 61 }, (_, i) => i);
  const sweeps = Object.fromEntries(candidates.map((c) => [c.id, sweep(hood, c, scene, baseline, angles)]));
  const beyond = Object.fromEntries(candidates.map((c) => [c.id, sweep(hood, c, scene, baseline, [75, 90, 105, 120])]));
  // Rigid-motion checks on the real hood: pairwise distances, restore, direction.
  const rigidity = candidates.map((c) => {
    const m = H.rotatePoints(hood, c, 45), back = H.rotatePoints(m, c, -45);
    let dd = 0, rb = 0;
    const nv = hood.length / 3;
    for (let i = 0; i < hood.length; i += 3 * 97) { const j = ((i / 3 + 389) % nv) * 3; dd = Math.max(dd, Math.abs(Math.hypot(hood[i] - hood[j], hood[i + 1] - hood[j + 1], hood[i + 2] - hood[j + 2]) - Math.hypot(m[i] - m[j], m[i + 1] - m[j + 1], m[i + 2] - m[j + 2]))); }
    for (let i = 0; i < hood.length; i++) rb = Math.max(rb, Math.abs(back[i] - hood[i]));
    return { id: c.id, maxPairDistanceChangeCm: dd, maxRestoreErrorCm: rb, zeroDegreeIdentical: H.rotatePoints(hood, c, 0).every((v, i) => v === hood[i]), frontEdgeLiftAt45Cm: r(frontLift(hood, c, 45), 1) };
  });
  // Owner's manual p.5-47: "Lower the hood halfway (lifted approximately 30 cm (12 in.) from the closed
  // position)". Read as half of the full lift, the full front-edge lift is about 60 cm. The reading and
  // the angles are ESTIMATED; the manual gives no angle.
  const manualLift = candidates.map((c) => ({ id: c.id, angleAt30cmLiftDeg: angleForLift(hood, c, 30), angleAt60cmLiftDeg: angleForLift(hood, c, 60) }));
  const interior = interiorAssessment(hood, others, json);
  const analysisMs = Math.round(performance.now() - t0);

  const svgAxis = candidates.find((c) => c.id === (args["svg-axis"] ?? "A"));
  const svgAngles = String(args["svg-angles"] ?? "0,15,30,45").split(",").map(Number);
  const svg = await svgFrames(glb, nodes, svgAxis, svgAngles, { placeholder: interior.placeholder });
  mkdirSync(join(out, "svg"), { recursive: true });
  const files = [];
  const write = (name, text) => { writeFileSync(join(out, name), text); files.push({ file: name, bytes: Buffer.byteLength(text), sha256: sha(text) }); return files.at(-1); };
  const frameReport = svg.frames.map((f) => ({ deg: f.deg, ms: Math.round(f.ms), hoodRegions: f.hoodRegions, visibleTriangles: f.visibleTriangles, projectedHoodBox: f.projectedHoodBox, tracedHoodBox: f.tracedHoodBox, boxDeltaPx: f.boxDeltaPx,
    svg: write(`svg/hood-${svgAxis.id}-${f.deg}.svg`, f.built.svg), highlighted: write(`svg/hood-${svgAxis.id}-${f.deg}-highlight.svg`, f.highlighted) }));
  const placeholderSvg = svg.withPlaceholder && write(`svg/hood-${svgAxis.id}-${svgAngles.at(-1)}-${H.PLACEHOLDER_TAG}.svg`, svg.withPlaceholder.svg);

  const report = {
    tool: "tools/ioniq5-asset/hood-feasibility.mjs", glbSha256: sha(glb), frame: "CarScope cm: +X forward, +Y left, +Z up (glTF (x,y,z) m -> (100x, -100z, 100y), profile.mjs gltfToCarCm)",
    hierarchy,
    hood: { identification: { node: H.HOOD_NODE, rule: "name Door_Front_0 AND centroid in the front half AND ahead of Door_Rear_0 AND upward-facing panel (mean normal z >= 0.7)", centroidCm: r(id.centroid), meanNormal: r(id.meanNormal, 3), tailgate: H.TAILGATE_NODE, problems: id.problems },
      triangles: hood.length / 9, worldBoundsCm: { min: r(hoodBounds.lo), max: r(hoodBounds.hi), size: r(hoodBounds.hi.map((v, i) => v - hoodBounds.lo[i])) },
      localFrameNote: "Door_Front_0 has no own transform: its vertices are in the glTF-local frame of Grp_Door_Front_0 (glTF local X = car +X, local Y = car -Y, local Z = car -Z)",
      edgeProfile: H.edgeProfile(hood).map((e) => r(e, 1)), rearMost: r(rearMost, 2),
      closedContact: { method: "static triangles within 0.05 cm of, or intersecting, the closed hood (exact triangle distance)", triangles: baseline.size, byRegion: Object.fromEntries(Object.entries(seamRegions).map(([k, v]) => [k, { triangles: v.triangles, min: r(v.lo, 1), max: r(v.hi, 1) }])) },
      boundaryEdges: H.boundaryEdges(hood).length },
    candidates: candidates.map((c) => ({ ...c, point: r(c.point, 2), direction: r(c.direction, 6) })),
    search: { ...search, criterion: "no new intersection and >= minClearanceCm to non-seam geometry at every search angle; among those, the pivot nearest B" },
    sweeps, beyond60: beyond, rigidity, interior,
    manualLiftReference: { quote: "Lower the hood halfway (lifted approximately 30 cm (12 in.) from the closed position)", source: "Hyundai IONIQ 5 2022 owner's manual (UK), Convenience features p.5-47",
      reading: "ESTIMATED: halfway = 30 cm front-edge lift, so a full opening of about 60 cm; no opening angle is published", byAxis: manualLift },
    svg: { axis: svgAxis.id, angles: svgAngles, projection: svg.projection.P, closedEqualsP2A7: sha(svg.closedDefault.svg) === sha(svg.reference.svg), p2a7Sha256: sha(svg.reference.svg),
      deterministic: sha(svg.again.svg) === sha(svg.frames.at(-1).built.svg), frames: frameReport, placeholder: placeholderSvg && { ...placeholderSvg, regions: svg.withPlaceholder.regions } },
    timingsMs: { analysis: analysisMs, total: Math.round(performance.now() - t0) },
  };
  write("hood-feasibility.json", JSON.stringify(report, null, 2) + "\n");
  const s = (id) => sweeps[id].filter((x) => [0, 5, 15, 30, 45, 60].includes(x.deg)).map((x) => `${x.deg}°:${x.newIntersectingPairs}/${x.minNewClearanceCm}`).join(" ");
  for (const c of candidates) console.log(`${c.id} pivot=${r(c.point, 2)} dir=${r(c.direction, 3)}  ${s(c.id)}`);
  console.log(`search best ${JSON.stringify(search.best)} (${search.zeroNew}/${search.evaluated} zero-new)`);
  console.log(`svg closed==P2-A7 ${report.svg.closedEqualsP2A7}, deterministic ${report.svg.deterministic}, frames ${frameReport.map((f) => `${f.deg}°:${f.svg.bytes}B/${f.ms}ms/Δ${f.boxDeltaPx}px`).join(" ")}`);
  console.log(`REPORT ${join(out, "hood-feasibility.json")} (${report.timingsMs.total} ms)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`FAILED: ${e.stack ?? e.message}`); process.exitCode = 1; });
}
