// Geometry exporter: the same model the SVG build draws, exported as 3D meshes from the kit's own
// inputs (prism frames, convex vertices, lathe meridians, planar polygons) captured before projection.
//
//   node tools/anatomy-car/geometry-export/export.mjs
//
// Writes tools/anatomy-car/build/geometry/{car.glb, ir.json, report.json}. Read-only for the SVG asset.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../automotive/model.mjs";
import { PALETTES } from "../automotive/materials.mjs";
import { FRONT_DOOR, REAR_DOOR, HALF } from "../automotive/dims.mjs";
import { prismMesh, convexMesh, latheMesh, planeMesh, checkMesh, rotateZ, vec } from "./mesh.mjs";
import { writeGlb, toGltf, dirToGltf, quatAboutCarZ } from "./gltf.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "build", "geometry");
mkdirSync(OUT, { recursive: true });

const { anatomy, ctx, sc } = await buildModel();
const V = ctx.V; // the SVG camera's view direction: decals face this way

// ---------------------------------------------------------------- classification
// A: the kit input is a complete 3D solid. B: 3D input exists but needs supplementing (state,
// thickness, curve fidelity, openings). C: SVG-only marks with no 3D definition (lines, dots, halo).
const CLASS_NOTES = {
  prism: ["A", "exact: polygon, frame and extent are the drawn prism"],
  convex: ["A", "exact: vertices and faces are the drawn polyhedron"],
  lathe: ["A", "exact meridian and axis; facet count from the SVG build"],
  latheSmooth: ["B", "meridian is exact, but the SVG smooths runs of smooth knots with a Hermite curve; 3D joins knots straight and only shares normals"],
  plane: ["B", "a planar decal with no thickness (glass, frit, liner, lamp lens): exported double-sided"],
  line: ["C", "SVG stroke (shut line, crease mark, wiper, streak): no 3D definition"],
  dots: ["C", "SVG dots (wheel nuts, wiper pivots): no 3D definition"],
  halo: ["C", "screen-space ground shadow"],
};
const tally = {};
const note = (k) => { tally[k] = (tally[k] ?? 0) + 1; };

function meshOf(prim) {
  if (prim.kind === "solid" && prim.paths.geo) {
    const g = prim.paths.geo;
    if (g.kind === "prism") return { mesh: prismMesh(g), closed: true, cls: "prism" };
    if (g.kind === "convex") return { mesh: convexMesh(g), closed: true, cls: "convex" };
    if (g.kind === "lathe") return { mesh: latheMesh(g), closed: true, cls: g.meridian.some((p) => p[2]) ? "latheSmooth" : "lathe" };
  }
  if (prim.kind === "poly") return { mesh: planeMesh({ points: prim.points, toward: V }), closed: false, cls: "plane" };
  if (prim.kind === "line") return { cls: "line" };
  if (prim.kind === "dots") return { cls: "dots" };
  if (prim.kind === "solid") throw new Error("solid without a recorded 3D definition");
  return { cls: prim.kind };
}

// ---------------------------------------------------------------- parts
const parts = [];
const variantOf = sc.variantOf;
const doorDefs = { [FRONT_DOOR.id]: FRONT_DOOR, [REAR_DOOR.id]: REAR_DOOR };
const isFixedOpenPart = (prim) => prim.kind === "poly" || (prim.paths?.geo?.kind === "lathe" && prim.palette === "trim");

for (const item of sc.R.items) {
  const v = variantOf(item);
  if (v && v.variant === "closed") continue; // doors are exported once, from the open pose
  item.prims.forEach((prim, i) => {
    const got = meshOf(prim);
    note(got.cls);
    if (!got.mesh) return;
    const part = { partId: `${item.name}/${i}`, item: item.name, cls: got.cls, materialId: prim.palette ?? "paint", mesh: got.mesh, closed: got.closed, parent: "body" };
    if (v) {
      const def = doorDefs[v.door];
      const theta = (def.open * Math.PI) / 180;
      if (isFixedOpenPart(prim)) {
        // hinge knuckles and the cabin seen through the window opening: fixed to the body, shown open
        part.partId = `${v.door}.fixed/${i}`;
        part.visibleWhen = "open";
        part.parent = "body";
      } else {
        // move the open pose back to closed, relative to the hinge pivot
        part.partId = `${v.door}/${i}`;
        part.parent = v.door;
        part.pivot = [def.hinge, HALF + 0.05, 0];
        part.mesh = mapMesh(got.mesh, (p) => rotateZ(p, part.pivot, theta), (n) => rotateZ(n, [0, 0, 0], theta));
        part.openOnly = prim.palette === "doorInner";
      }
    }
    parts.push(part);
  });
}
function mapMesh(m, fp, fn) {
  return { positions: m.positions.map(fp), normals: m.normals.map(fn), indices: m.indices };
}

// ---------------------------------------------------------------- door rigidity check
// The SVG builds each pose separately. Rotating the open pose back must land on the closed pose.
const rigidity = {};
for (const id of Object.keys(doorDefs)) {
  const closedItem = sc.R.items.find((it) => variantOf(it)?.door === id && variantOf(it).variant === "closed");
  const closedPrims = closedItem.prims.filter((p) => p.kind === "solid" && p.paths.geo);
  const back = parts.filter((p) => p.parent === id && !p.openOnly);
  let worst = 0;
  closedPrims.forEach((prim, i) => {
    const ref = meshOf(prim).mesh;
    const got = back[i]?.mesh;
    if (!got || got.positions.length !== ref.positions.length) { worst = Infinity; return; }
    ref.positions.forEach((p, j) => { worst = Math.max(worst, vec.len(vec.sub(p, got.positions[j]))); });
  });
  rigidity[id] = { comparedParts: closedPrims.length, maxDeviation: worst };
}

// ---------------------------------------------------------------- mesh checks
const checks = parts.map((p) => ({ partId: p.partId, cls: p.cls, ...checkMesh(p.mesh, { closed: p.closed }) }));
const sum = (k) => checks.reduce((a, c) => a + (c[k] ?? 0), 0);
const closedChecks = checks.filter((c) => c.closed);

// ---------------------------------------------------------------- door sweep collision check
// Exact point-in-solid tests against the drawn prisms and the greenhouse polyhedron (not the audit
// proxies). Door points are the door mesh vertices plus triangle centroids.
const insidePrism = (g, p) => {
  const d = vec.sub(p, g.F.o);
  const s = vec.dot(d, g.F.a);
  const u = vec.dot(d, g.F.u);
  const w = vec.dot(d, g.F.v);
  if (s <= g.s0 || s >= g.s1) return 0;
  let inside = false;
  let edge = Infinity;
  for (let i = 0, j = g.poly.length - 1; i < g.poly.length; j = i++) {
    const [xi, yi] = g.poly[i];
    const [xj, yj] = g.poly[j];
    if ((yi > w) !== (yj > w) && u < ((xj - xi) * (w - yi)) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi;
    const ey = yj - yi;
    const t = Math.max(0, Math.min(1, ((u - xi) * ex + (w - yi) * ey) / (ex * ex + ey * ey || 1)));
    edge = Math.min(edge, Math.hypot(u - (xi + t * ex), w - (yi + t * ey)));
  }
  return inside ? Math.min(edge, s - g.s0, g.s1 - s) : 0;
};
const insideConvex = (g, p) => {
  const centre = vec.mul(g.vertices.reduce((a, q) => vec.add(a, q), [0, 0, 0]), 1 / g.vertices.length);
  let depth = Infinity;
  for (const face of g.faces) {
    const [a, b, c] = face.map((i) => g.vertices[i]);
    let n = vec.unit(vec.cross(vec.sub(b, a), vec.sub(c, a)));
    if (vec.dot(n, vec.sub(a, centre)) < 0) n = vec.mul(n, -1);
    const d = -vec.dot(n, vec.sub(p, a));
    if (d <= 0) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
};
const obstacles = [];
for (const item of sc.R.items) {
  if (variantOf(item) || item.name.startsWith("wheel.")) continue;
  for (const prim of item.prims) {
    const g = prim.paths?.geo;
    if (g?.kind === "prism") obstacles.push({ name: item.name, depth: (p) => insidePrism(g, p) });
    if (g?.kind === "convex") obstacles.push({ name: item.name, depth: (p) => insideConvex(g, p) });
  }
}
// door sample points: vertices, triangle centroids and points every 2 units along every edge
const doorPoints = (id) => parts.filter((p) => p.parent === id).flatMap((p) => {
  const pts = [...p.mesh.positions];
  for (let t = 0; t < p.mesh.indices.length; t += 3) {
    const tri = [0, 1, 2].map((k) => p.mesh.positions[p.mesh.indices[t + k]]);
    pts.push(vec.mul(vec.add(vec.add(tri[0], tri[1]), tri[2]), 1 / 3));
    for (let e = 0; e < 3; e++) {
      const [a, b] = [tri[e], tri[(e + 1) % 3]];
      const n = Math.floor(vec.len(vec.sub(b, a)) / 2);
      for (let i = 1; i < n; i++) pts.push(vec.add(a, vec.mul(vec.sub(b, a), i / n)));
    }
  }
  return pts;
});
const sweep = {};
const PENETRATION = 0.3; // 3 mm: anything deeper is a collision
for (const id of Object.keys(doorDefs)) {
  const def = doorDefs[id];
  const pivot = [def.hinge, HALF + 0.05, 0];
  const pts = doorPoints(id);
  const hits = [];
  for (let deg = 0; deg <= def.open; deg += 1) {
    const angle = (-deg * Math.PI) / 180;
    let worst = { depth: 0 };
    for (const p0 of pts) {
      const p = rotateZ(p0, pivot, angle);
      for (const o of obstacles) {
        const d = o.depth(p);
        if (d > worst.depth) worst = { depth: d, obstacle: o.name };
      }
    }
    if (worst.depth > PENETRATION) hits.push({ deg, ...worst, depth: Number(worst.depth.toFixed(2)) });
  }
  // reverse direction: body vertices that end up inside the swinging door (door prisms, open pose)
  const theta = (def.open * Math.PI) / 180;
  const openItem = sc.R.items.find((it) => variantOf(it)?.door === id && variantOf(it).variant === "open");
  const doorGeos = openItem.prims.filter((p) => p.paths?.geo?.kind === "prism").map((p) => p.paths.geo);
  const bodyPts = parts.filter((p) => p.parent === "body" && !p.visibleWhen && p.cls !== "plane").flatMap((p) => p.mesh.positions.map((q) => ({ q, part: p.item })));
  const reverse = [];
  for (let deg = 0; deg <= def.open; deg += 1) {
    const phi = (-deg * Math.PI) / 180;
    let worst = { depth: 0 };
    for (const { q, part } of bodyPts) {
      // the door at angle phi is the open pose turned by (phi + theta), so turn the point back
      const inOpenPose = rotateZ(q, pivot, -phi - theta);
      for (const g of doorGeos) {
        const d = insidePrism(g, inOpenPose);
        if (d > worst.depth) worst = { depth: d, bodyPart: part, point: q.map((v) => Number(v.toFixed(1))), doorLayer: [g.s0, g.s1] };
      }
    }
    if (worst.depth > PENETRATION) reverse.push({ deg, ...worst, depth: Number(worst.depth.toFixed(2)) });
  }
  sweep[id] = { points: pts.length, obstacles: obstacles.length, bodyPoints: bodyPts.length, steps: def.open + 1, collisions: hits, bodyIntoDoor: reverse };
}
// both doors at the same opening fraction
{
  // bounding boxes of the two doors at equal fractions: if they never overlap, they cannot collide
  const box = (pts) => pts.reduce((b, p) => [vec.add([0, 0, 0], [Math.min(b[0][0], p[0]), Math.min(b[0][1], p[1]), Math.min(b[0][2], p[2])]), [Math.max(b[1][0], p[0]), Math.max(b[1][1], p[1]), Math.max(b[1][2], p[2])]], [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
  const overlaps = [];
  const fPts = doorPoints(FRONT_DOOR.id);
  const rPts = doorPoints(REAR_DOOR.id);
  for (let k = 0; k <= 20; k++) {
    const bf = box(fPts.map((p) => rotateZ(p, [FRONT_DOOR.hinge, HALF + 0.05, 0], (-(FRONT_DOOR.open * k) / 20) * (Math.PI / 180))));
    const br = box(rPts.map((p) => rotateZ(p, [REAR_DOOR.hinge, HALF + 0.05, 0], (-(REAR_DOOR.open * k) / 20) * (Math.PI / 180))));
    const gap = Math.max(br[0][0] - bf[1][0], bf[0][0] - br[1][0]); // along x, the doors sit side by side
    if (gap < 0) overlaps.push({ fraction: k / 20, xOverlap: Number((-gap).toFixed(2)) });
  }
  sweep.bothDoors = { method: "x extents of both doors at equal opening fractions (they are side by side along x)", xOverlaps: overlaps };
}

// ---------------------------------------------------------------- GLB + IR
const MATERIALS = {
  paint: { metallic: 0.25, roughness: 0.42 }, recess: { metallic: 0.25, roughness: 0.48 }, doorInner: { roughness: 0.85 },
  glass: { roughness: 0.08, metallic: 0.1 }, frit: { roughness: 0.6 }, tyre: { roughness: 0.95 }, rim: { metallic: 0.85, roughness: 0.3 },
  rimShadow: { metallic: 0.5, roughness: 0.5 }, brake: { metallic: 0.7, roughness: 0.35 }, caliper: { metallic: 0.3, roughness: 0.5 },
  trim: { metallic: 0.1, roughness: 0.7 }, lamp: { metallic: 0.1, roughness: 0.15 }, lampSmoke: { metallic: 0.1, roughness: 0.25 },
  plate: { roughness: 0.5 }, amber: { roughness: 0.35 }, interior: { roughness: 0.9 }, seat: { roughness: 0.9 }, well: { roughness: 1 },
};
const materials = {};
for (const p of parts) {
  const pal = PALETTES[p.materialId];
  materials[p.materialId] ??= { color: pal.paper, ...MATERIALS[p.materialId], doubleSided: p.cls === "plane" || MATERIALS[p.materialId]?.doubleSided };
  if (p.cls === "plane") materials[p.materialId].doubleSided = true;
}
const nodes = [{ name: "car", children: [] }, { name: "body", children: [] }];
nodes[0].children.push(1);
const doorNode = {};
for (const id of Object.keys(doorDefs)) {
  const def = doorDefs[id];
  const pivot = [def.hinge, HALF + 0.05, 0];
  nodes.push({
    name: id, translation: toGltf(pivot), rotation: quatAboutCarZ(0), children: [],
    extras: { partId: id, pivot: toGltf(pivot), axis: [0, 1, 0], states: { closed: 0, open: (-def.open * Math.PI) / 180 }, stateAngleUnit: "radians about glTF +Y (car +z)" },
  });
  doorNode[id] = nodes.length - 1;
  nodes[0].children.push(doorNode[id]);
}
for (const p of parts) {
  const local = p.pivot ? (q) => toGltf(vec.sub(q, p.pivot)) : toGltf;
  const prim = { positions: p.mesh.positions.map(local), normals: p.mesh.normals.map(dirToGltf), indices: p.mesh.indices, material: p.materialId };
  nodes.push({ name: p.partId, mesh: { primitives: [prim] }, extras: { partId: p.partId, cls: p.cls, materialId: p.materialId, ...(p.visibleWhen ? { visibleWhen: p.visibleWhen } : {}) } });
  const idx = nodes.length - 1;
  (p.parent === "body" ? nodes[1] : nodes[doorNode[p.parent]]).children.push(idx);
}
const glb = writeGlb({ nodes, roots: [0], materials, extras: { source: `anatomy-kit ${anatomy.rev}`, units: "metres", carAxes: "glTF X = car forward, Y = up, Z = car right", svgViewDirection: dirToGltf(V), svgCamera: { azimuth: 56, elevation: 28, projection: "orthographic" } } });
writeFileSync(join(OUT, "car.glb"), glb);

const ir = {
  format: "carscope-geometry-ir", version: 1, units: "cm", axes: "x forward, y left, z up",
  source: { anatomyKit: anatomy.rev, generator: "tools/anatomy-car/geometry-export/export.mjs" },
  parts: parts.map((p) => ({
    partId: p.partId, item: p.item, cls: p.cls, classification: CLASS_NOTES[p.cls][0], materialId: p.materialId,
    parent: p.parent, pivot: p.pivot ?? null, axis: p.pivot ? [0, 0, 1] : null,
    states: p.pivot ? { closed: 0, open: (-doorDefs[p.parent].open * Math.PI) / 180 } : null,
    visibleWhen: p.visibleWhen ?? null,
    vertices: p.mesh.positions.flat().map((v) => Number(v.toFixed(3))),
    normals: p.mesh.normals.flat().map((v) => Number(v.toFixed(4))),
    triangleIndices: p.mesh.indices,
  })),
};
writeFileSync(join(OUT, "ir.json"), JSON.stringify(ir));

const report = {
  anatomy: anatomy.rev,
  glb: { bytes: glb.length, sha256: createHash("sha256").update(glb).digest("hex") },
  primitives: Object.fromEntries(Object.entries(tally).map(([k, n]) => [k, { count: n, classification: CLASS_NOTES[k]?.[0], note: CLASS_NOTES[k]?.[1] }])),
  parts: parts.length,
  triangles: sum("triangles"),
  degenerateTriangles: sum("degenerate"),
  flippedNormals: sum("flippedNormals"),
  closedParts: closedChecks.length,
  closedWatertight: closedChecks.filter((c) => c.watertight).length,
  closedOutward: closedChecks.filter((c) => c.outward).length,
  openPlanes: checks.filter((c) => !c.closed).length,
  windingConflicts: sum("windingConflicts"),
  notWatertight: closedChecks.filter((c) => !c.watertight).map((c) => ({ partId: c.partId, boundaryEdges: c.boundaryEdges, nonManifoldEdges: c.nonManifoldEdges })),
  inward: closedChecks.filter((c) => !c.outward).map((c) => c.partId),
  doorRigidity: rigidity,
  doorSweep: sweep,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify({ ...report, checks }, null, 1));
console.log(JSON.stringify(report, null, 1));
