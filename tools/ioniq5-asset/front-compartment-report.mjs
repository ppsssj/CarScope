#!/usr/bin/env node
// P3-A2.1: validate the front compartment shell against the converted OpenX GLB (unmodified).
//   node tools/ioniq5-asset/front-compartment-report.mjs --glb=<hyundai_ioniq_5_2022.glb> --out=<dir outside the repo> [--quick]
// Writes front-compartment.json and svg/*.svg. Exact triangle tests (collision.mjs) only: every crossing is
// classified as a declared joint or a defect; nothing is decided from bounding boxes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { glbParts, buildIoniqSvg } from "./anatomy-svg.mjs";
import { fitMeshProjection, regionOutline } from "../anatomy-car/mesh-svg/mesh-svg.mjs";
import * as H from "./hood.mjs";
import { staticScene, meshClearance, baselineContacts, tri, crossingPoint } from "./collision.mjs";
import { hoodHierarchy, searchAxis } from "./hood-feasibility.mjs";
import { buildFrontCompartment, panelStats } from "./front-compartment.mjs";
import { MODEL_REFERENCES } from "./front-compartment-layout.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const r = (v, d = 2) => (Array.isArray(v) ? v.map((x) => r(x, d)) : typeof v === "number" ? Math.round(v * 10 ** d) / 10 ** d + 0 : v);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const centroid = (t) => [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
const inBox = (p, b) => p.every((v, k) => v >= b.min[k] && v <= b.max[k]);

/** Is a crossing between `part` and mesh `other` at point p a declared joint? */
export function jointFor(joints, part, other, p) {
  return joints.find((j) => (j.part === part || j.part === "*" || (j.with === part && j.part === other)) && (j.with === other || j.part === other) && inBox(p, j)) ?? null;
}

/** Crossings of one moving mesh against a scene, split into declared joints and defects. */
export function classifyCrossings(partId, moving, scene, joints, { cutoff = 2 } = {}) {
  const c = meshClearance(moving, scene, { cutoff });
  const defects = [], jointHits = {};
  for (const x of c.intersections) {
    const s = scene.items[x.static];
    const at = crossingPoint(tri(moving, x.moving), s.tri); // exact point on the intersection
    const j = jointFor(joints, partId, s.mesh, at);
    if (j) jointHits[`${s.mesh}: ${j.why}`] = (jointHits[`${s.mesh}: ${j.why}`] ?? 0) + 1;
    else defects.push({ with: s.mesh, at: r(at, 1) });
  }
  // Closest approach to anything that is not a declared joint for this part.
  return { method: c.method, pairs: c.narrowPhasePairs, crossings: c.intersectingPairs, jointCrossings: jointHits, defects: defects.length, defectSamples: defects.slice(0, 8), minDistanceCm: c.minDistanceCm === null ? `>=${cutoff}` : r(c.minDistanceCm, 3), closest: c.closest?.mesh ?? null };
}

/** Ray against meshes; first hit or null. */
function cast(o, d, meshes) {
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
      if (t > 1e-6 && (!best || t < best.t)) best = { t, mesh: m.name, p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] };
    }
  }
  return best;
}

/** What the eye meets in the open compartment: first hits classified, before and after the shell. */
export function exposure(meshes) {
  const cls = (h) => (!h ? "nothing (ground / sky)" : h.mesh === "Body" && h.p[2] < MODEL_REFERENCES.floorZ.value + 3 ? "underbody floor" : h.mesh === "Interior_Static" ? "cabin interior" : h.mesh.startsWith("fc-") ? "shell" : h.mesh);
  const tally = (rays) => { const o = {}; for (const [p, d] of rays) { const k = cls(cast(p, d, meshes)); o[k] = (o[k] ?? 0) + 1; } return { rays: rays.length, ...o }; };
  const down = [], rear = [], bay = [];
  for (let x = 110; x <= 210; x += 5) for (let y = -55; y <= 55; y += 5) down.push([[x, y, 112], [0, 0, -1]]);
  for (let y = -55; y <= 55; y += 5) for (let z = 30; z <= 94; z += 4) rear.push([[170, y, z], [-1, 0, 0]]);
  // Oblique view into the bay from above-front-left (the PoC "BAY" camera direction in car axes).
  const v = [-0.55, -0.55, -1], n = Math.hypot(...v), d = v.map((x) => x / n);
  for (let x = 120; x <= 215; x += 5) for (let y = -50; y <= 50; y += 5) { const target = [x, y, 70]; bay.push([[target[0] - d[0] * 80, target[1] - d[1] * 80, target[2] - d[2] * 80], d]); }
  return { downFromAbove: tally(down), rearwardFromBay: tally(rear), obliqueBayView: tally(bay) };
}

async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  if (!args.glb || !args.out) { console.error("usage: node tools/ioniq5-asset/front-compartment-report.mjs --glb=<.glb> --out=<dir outside the repo> [--quick]"); return 2; }
  const out = resolve(args.out);
  const rel = relative(REPO, out);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`Refusing to write model-derived output inside the CarScope repo: ${out}`);
  const glb = readFileSync(resolve(args.glb));
  const t0 = performance.now();
  const nodes = glbParts(glb);
  const hierarchy = hoodHierarchy(glb);
  const hood = nodes.find((n) => n.name === H.HOOD_NODE).triangles;
  const others = nodes.filter((n) => n.name !== H.HOOD_NODE);
  const tb = performance.now();
  const shell = buildFrontCompartment();
  const buildMs = performance.now() - tb;
  const panels = shell.panels;

  // 1. Shell vs the source model (all meshes except the hood), and vs the closed hood.
  const modelScene = staticScene(others);
  // cutoff 10 cm so the gap to the nearest existing mesh is reported (a floating panel would show here).
  const vsModel = Object.fromEntries(panels.map((p) => [p.id, classifyCrossings(p.id, p.triangles, modelScene, shell.joints, { cutoff: 10 })]));
  const hoodScene = staticScene([{ name: H.HOOD_NODE, triangles: hood }]);
  const vsClosedHood = Object.fromEntries(panels.map((p) => { const c = meshClearance(p.triangles, hoodScene, { cutoff: 15 }); return [p.id, { crossings: c.intersectingPairs, minDistanceCm: c.minDistanceCm === null ? ">=15" : r(c.minDistanceCm, 3) }]; }));
  // 2. Shell vs shell (each pair once).
  const vsShell = [];
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const c = classifyCrossings(panels[i].id, panels[i].triangles, staticScene([{ name: panels[j].id, triangles: panels[j].triangles }]), shell.joints);
    if (c.crossings || (typeof c.minDistanceCm === "number" && c.minDistanceCm < 0.5)) vsShell.push({ a: panels[i].id, b: panels[j].id, ...c });
  }
  // 3. Hood opening against the shell, axes A and C, 0-60 deg in 1-deg steps (SIMULATION_ONLY angles).
  const { candidates: AB, rearMost } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: hierarchy.group.originCm, groupLateralCm: hierarchy.lateralAxisCar });
  const B = AB.find((c) => c.id === "B");
  const zone = { x: [r(rearMost.rearX - 7.5, 2), r(rearMost.rearX + 12.5, 2)], z: [r(rearMost.rearZ - 15, 2), r(rearMost.rearZ, 2)] };
  const others0 = staticScene(others, { region: H.bodyRegion });
  const baseline = baselineContacts(hood, others0);
  const search = searchAxis(hood, others0, baseline, { zone, step: args.quick ? 2.5 : 1.25, reference: B.point });
  const { candidates } = H.axisCandidates({ hoodTriangles: hood, groupOriginCm: hierarchy.group.originCm, groupLateralCm: hierarchy.lateralAxisCar, searched: { point: [search.best.x, 0, search.best.z] } });
  const axes = candidates.filter((c) => c.id === "A" || c.id === "C");
  const shellScene = staticScene(panels.map((p) => ({ name: p.id, triangles: p.triangles })));
  const angles = args.quick ? [0, 5, 15, 30, 45, 60] : Array.from({ length: 61 }, (_, i) => i);
  const hoodSweeps = {};
  for (const ax of axes) {
    const ts = performance.now();
    const rows = angles.map((deg) => { const c = meshClearance(H.rotatePoints(hood, ax, deg), shellScene, { cutoff: 10 }); return { deg, check: c.intersectingPairs ? "NEW_MESH_INTERSECTION" : deg === 0 ? "CLOSED" : "NO_NEW_INTERSECTION", crossings: c.intersectingPairs, minDistanceCm: c.minDistanceCm === null ? ">=10" : r(c.minDistanceCm, 3), closest: c.closest?.mesh ?? null }; });
    const num = rows.filter((x) => typeof x.minDistanceCm === "number");
    hoodSweeps[ax.id] = { pivot: r(ax.point, 2), evidence: ax.evidence, angles: "SIMULATION_ONLY", firstCrossingDeg: rows.find((x) => x.crossings)?.deg ?? null, minDistanceCm: num.length ? Math.min(...num.map((x) => x.minDistanceCm)) : ">=10",
      closestAt: num.length ? num.reduce((m, x) => (x.minDistanceCm < m.minDistanceCm ? x : m)) : null, msPerAngle: Math.round((performance.now() - ts) / angles.length), rows };
  }
  // 4. Reserved zones: inside the shell, clear of model, shell, closed and opening hood, and of each other.
  const zones = shell.zones.map((z) => {
    const m = classifyCrossings(z.id, z.triangles, modelScene, []), s = classifyCrossings(z.id, z.triangles, shellScene, []), h = meshClearance(z.triangles, hoodScene, { cutoff: 15 });
    const vol = (z.box.max[0] - z.box.min[0]) * (z.box.max[1] - z.box.min[1]) * (z.box.max[2] - z.box.min[2]) / 1000;
    const hoodOpen = Object.fromEntries(axes.map((ax) => [ax.id, angles.filter((d) => meshClearance(z.triangles, staticScene([{ name: "hood", triangles: H.rotatePoints(hood, ax, d) }]), { cutoff: 1 }).intersectingPairs > 0).length]));
    return { id: z.id, box: z.box, envelopeLitres: r(vol, 1), note: "reservation envelope; not storage capacity", vsModel: { crossings: m.crossings, minDistanceCm: m.minDistanceCm, closest: m.closest }, vsShell: { crossings: s.crossings, minDistanceCm: s.minDistanceCm, closest: s.closest },
      vsClosedHood: { crossings: h.intersectingPairs, minDistanceCm: h.minDistanceCm === null ? ">=15" : r(h.minDistanceCm, 3) }, hoodCrossingAnglesCount: hoodOpen };
  });
  const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
  const zoneOverlaps = [];
  for (let i = 0; i < shell.zones.length; i++) for (let j = i + 1; j < shell.zones.length; j++) if (overlap(shell.zones[i].box, shell.zones[j].box)) zoneOverlaps.push([shell.zones[i].id, shell.zones[j].id]);
  // Frunk cover clearance: gap between the frunk envelope top and the hood as it opens.
  const frunk = shell.zones.find((z) => z.id === "zone-frunk");
  const frunkTop = { name: "frunk-top", triangles: Float64Array.from([frunk.box.min[0], frunk.box.min[1], frunk.box.max[2], frunk.box.max[0], frunk.box.min[1], frunk.box.max[2], frunk.box.max[0], frunk.box.max[1], frunk.box.max[2],
    frunk.box.min[0], frunk.box.min[1], frunk.box.max[2], frunk.box.max[0], frunk.box.max[1], frunk.box.max[2], frunk.box.min[0], frunk.box.max[1], frunk.box.max[2]]) };
  const topScene = staticScene([frunkTop]);
  const frunkCoverClearance = Object.fromEntries(axes.map((ax) => [ax.id, [0, 15, 30, 45, 60].map((deg) => { const c = meshClearance(H.rotatePoints(hood, ax, deg), topScene, { cutoff: 80 }); return { deg, minDistanceCm: c.minDistanceCm === null ? ">=80" : r(c.minDistanceCm, 1) }; })]));
  // 5. Exposure with the hood removed from view (as when open), before and after the shell.
  const shellMeshes = panels.map((p) => ({ name: p.id, triangles: p.triangles }));
  const te = performance.now();
  const before = exposure(others), after = exposure([...others, ...shellMeshes]);
  const exposureMs = performance.now() - te;

  // 6. SVG: shared camera fitted to the car with the hood at 45 deg (axis A, SIMULATION_ONLY).
  const axisA = axes.find((a) => a.id === "A");
  const posed = (deg, extra = []) => [...nodes.map((n) => (n.name === H.HOOD_NODE ? { ...n, triangles: H.rotatePoints(n.triangles, axisA, deg) } : n)), ...extra];
  const reference = await buildIoniqSvg(glb);
  const projection = fitMeshProjection([...nodes, { triangles: H.rotatePoints(hood, axisA, 45) }], reference.anatomy.k);
  const svgNodes = panels.map((p) => ({ name: p.id, id: p.id, triangles: p.triangles, materials: p.materials, palettes: p.palettes }));
  const frunkNode = { name: frunk.id, id: frunk.id, triangles: frunk.triangles, materials: Array(12).fill(frunk.id), palettes: Array(12).fill("amber") };
  const timed = async (label, ns) => { const t = performance.now(); const b = await buildIoniqSvg(glb, { nodes: ns, projection }); return { label, b, ms: performance.now() - t }; };
  const frames = [
    await timed("closed-no-shell", posed(0)), await timed("closed-shell", posed(0, svgNodes)),
    await timed("open45-no-shell", posed(45)), await timed("open45-shell", posed(45, svgNodes)), await timed("open45-shell-frunkzone", posed(45, [...svgNodes, frunkNode])),
  ];
  const again = await buildIoniqSvg(glb, { nodes: posed(45, svgNodes), projection });
  const hoodD = (b) => b.result.fills.filter((f) => f.id === "hood").map((f) => f.d).join("|");
  const byLabel = Object.fromEntries(frames.map((f) => [f.label, f]));
  const zoneOutline = regionOutline(byLabel["open45-shell-frunkzone"].b.result.strokes, frunk.id, reference.anatomy.k);
  mkdirSync(join(out, "svg"), { recursive: true });
  const files = [];
  const write = (name, text) => { writeFileSync(join(out, name), text); files.push({ file: name, bytes: Buffer.byteLength(text), sha256: sha(text) }); return files.at(-1); };
  const svgReport = frames.map((f) => {
    let svg = f.b.svg;
    if (f.label.endsWith("frunkzone")) svg = svg.replace("</svg>", `<path d="${zoneOutline}" fill="none" stroke="#b45309" stroke-width="1.4"/><text x="8" y="16" font-family="monospace" font-size="10" fill="#b45309">${frunk.id}: SYNTHETIC_DEBUG_PLACEHOLDER (envelope, not the 57 L tub)</text></svg>`);
    if (f.label.startsWith("open")) svg = svg.replace("</svg>", `<text x="8" y="${f.label.endsWith("frunkzone") ? 28 : 16}" font-family="monospace" font-size="10" fill="#57606a">hood 45 deg axis A: SIMULATION_ONLY; shell ESTIMATED_GEOMETRY</text></svg>`);
    const ids = [...new Set(f.b.result.fills.map((x) => x.id))];
    return { label: f.label, ms: Math.round(f.ms), elements: (svg.match(/<(path|g|circle)\b/g) ?? []).length, shellIdsVisible: ids.filter((i) => i.startsWith("fc-")), zoneVisible: ids.includes(frunk.id), file: write(`svg/${f.label}.svg`, svg) };
  });

  const stats = panels.map(panelStats).map((s) => ({ ...s, areaCm2: r(s.areaCm2, 0), min: r(s.min, 1), max: r(s.max, 1) }));
  const report = {
    tool: "tools/ioniq5-asset/front-compartment-report.mjs", glbSha256: sha(glb), frame: "CarScope cm (+X forward, +Y left, +Z up)", angles: "SIMULATION_ONLY",
    shell: { panels: panels.length, triangles: panels.reduce((a, p) => a + p.triangles.length / 9, 0), buildMs: r(buildMs, 2), stats, meta: panels.map((p) => p.meta), zones: shell.zones.map((z) => ({ id: z.id, box: z.box, meta: z.meta })), joints: shell.joints },
    checks: {
      shellVsModel: vsModel, shellVsClosedHood: vsClosedHood, shellVsShell: vsShell,
      totals: { modelDefects: Object.values(vsModel).reduce((a, x) => a + x.defects, 0), modelJointCrossings: Object.values(vsModel).reduce((a, x) => a + Object.values(x.jointCrossings).reduce((s, v) => s + v, 0), 0), shellShellDefects: vsShell.reduce((a, x) => a + x.defects, 0), closedHoodCrossings: Object.values(vsClosedHood).reduce((a, x) => a + x.crossings, 0) },
    },
    hoodVsShell: hoodSweeps, search: { best: search.best, criterion: "same as P3-A1" },
    zones, zoneOverlaps, frunkCoverClearance,
    exposure: { before, after, ms: Math.round(exposureMs), note: "hood excluded from the rays (open-compartment view); 'shell' = any new panel" },
    svg: { axis: "A", deg: 45, projection: projection.P, frames: svgReport, deterministic: sha(again.svg) === sha(byLabel["open45-shell"].b.svg),
      closedHoodUnchanged: hoodD(byLabel["closed-shell"].b) === hoodD(byLabel["closed-no-shell"].b), closedIdenticalWithShell: sha(byLabel["closed-shell"].b.svg) === sha(byLabel["closed-no-shell"].b.svg) },
    timingsMs: { total: Math.round(performance.now() - t0) },
  };
  write("front-compartment.json", JSON.stringify(report, null, 2) + "\n");
  const t = report.checks.totals;
  console.log(`shell ${report.shell.panels} panels / ${report.shell.triangles} tri; model defects ${t.modelDefects}, joint crossings ${t.modelJointCrossings}, shell-shell defects ${t.shellShellDefects}, closed-hood crossings ${t.closedHoodCrossings}`);
  for (const [id, s] of Object.entries(hoodSweeps)) console.log(`hood ${id}: first crossing ${s.firstCrossingDeg ?? "none"}, min ${s.minDistanceCm} cm @${s.closestAt?.deg} (${s.closestAt?.closest})`);
  for (const z of zones) console.log(`${z.id}: ${z.envelopeLitres} L, model ${z.vsModel.crossings}/${z.vsModel.minDistanceCm}, shell ${z.vsShell.crossings}/${z.vsShell.minDistanceCm}, hood ${z.vsClosedHood.minDistanceCm}, hoodOpenCrossAngles ${JSON.stringify(z.hoodCrossingAnglesCount)}`);
  console.log("exposure before", JSON.stringify(before)); console.log("exposure after ", JSON.stringify(after));
  console.log(`svg ${svgReport.map((f) => `${f.label}:${f.file.bytes}B/${f.ms}ms/[${f.shellIdsVisible.length}]`).join(" ")} deterministic ${report.svg.deterministic} hoodUnchanged ${report.svg.closedHoodUnchanged}`);
  console.log(`REPORT ${join(out, "front-compartment.json")} (${report.timingsMs.total} ms)`);
  return t.modelDefects || t.shellShellDefects || t.closedHoodCrossings ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`FAILED: ${e.stack ?? e.message}`); process.exitCode = 1; });
}
