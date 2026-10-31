// Pure in-memory geometry generation. CLI output and validation live in export.mjs / verify.mjs.
import { createHash } from "node:crypto";
import { PALETTES } from "../automotive/materials.mjs";
import { VIEW } from "../automotive/camera.mjs";
import { LANDMARKS } from "../automotive/coordinates.mjs";
import { FRONT_DOOR, REAR_DOOR, HALF } from "../automotive/dims.mjs";
import { prismMesh, convexMesh, latheMesh, planeMesh, checkMesh, rotateZ, vec } from "./mesh.mjs";
import { writeGlb, toGltf, dirToGltf, quatAboutCarZ } from "./gltf.mjs";

export function generateGeometry(model) {
  const { anatomy, ctx, sc } = model;
  const V = ctx.V;
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
  const doorDefs = model.doorDefs ?? { [FRONT_DOOR.id]: FRONT_DOOR, [REAR_DOOR.id]: REAR_DOOR };
  const pivotOf = (def) => def.pivot ?? [def.hinge, HALF + 0.05, 0];
  const isFixedOpenPart = model.isFixedOpenPart ?? ((prim) => prim.kind === "poly" || (prim.paths?.geo?.kind === "lathe" && prim.palette === "trim"));

  for (const item of sc.R.items) {
    const v = variantOf(item);
    if (v && v.variant === "closed") continue; // doors are exported once, from the open pose
    item.prims.forEach((prim, i) => {
      const got = meshOf(prim);
      note(got.cls);
      if (!got.mesh) return;
      const part = { partId: `${item.name}/${i}`, item: item.name, cls: got.cls, materialId: prim.palette ?? "paint", mesh: got.mesh, closed: got.closed, parent: "body", geo: prim.paths?.geo };
      if (prim.measurementRole) part.measurementRole = prim.measurementRole;
      if (v) {
        const def = doorDefs[v.door];
        const theta = -(def.openSign ?? -1) * (def.open * Math.PI) / 180;
        if (isFixedOpenPart(prim)) {
          // hinge knuckles and the cabin seen through the window opening: fixed to the body, shown open
          part.partId = `${v.door}.fixed/${i}`;
          part.visibleWhen = "open";
          part.parent = "body";
        } else {
          // move the open pose back to closed, relative to the hinge pivot
          part.partId = `${v.door}/${i}`;
          part.parent = v.door;
          part.pivot = pivotOf(def);
          part.rotationSign = def.openSign ?? -1;
          part.mesh = mapMesh(got.mesh, (p) => rotateZ(p, part.pivot, theta), (n) => rotateZ(n, [0, 0, 0], theta));
          part.openOnly = prim.palette === "doorInner";
          const g = part.geo;
          const point = (q) => rotateZ(q, part.pivot, theta);
          const dir = (q) => rotateZ(q, [0, 0, 0], theta);
          if (g?.F) part.geo = { ...g, F: { o: point(g.F.o), u: dir(g.F.u), v: dir(g.F.v), a: dir(g.F.a) } };
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
    const pivot = pivotOf(def);
    nodes.push({
      name: id, translation: toGltf(pivot), rotation: quatAboutCarZ(0), children: [],
      extras: { partId: id, pivot: toGltf(pivot), axis: [0, 1, 0], states: { closed: 0, open: ((def.openSign ?? -1) * def.open * Math.PI) / 180 }, stateAngleUnit: "radians about glTF +Y (car +z)" },
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
  const glb = writeGlb({ nodes, roots: [0], materials, extras: { source: `anatomy-kit ${anatomy.rev}`, units: "metres", carAxes: "glTF X = car forward, Y = up, Z = car right", svgViewDirection: dirToGltf(V), svgCamera: { ...VIEW, projection: "orthographic", screenX: "camera-right" }, coordinateLandmarks: LANDMARKS.map((l) => ({ id: l.id, color: l.color, gltfMetres: toGltf(l.world) })), ...(model.profile ? { vehicleGeometryProfile: model.profile } : {}) } });


  const ir = {
    format: "carscope-geometry-ir", version: 1, units: "cm", axes: "x forward, y left, z up",
    source: { anatomyKit: anatomy.rev, anatomyCommit: anatomy.commit, generator: "tools/anatomy-car/geometry-export/export.mjs" },
    parts: parts.map((p) => ({
      partId: p.partId, item: p.item, cls: p.cls, classification: CLASS_NOTES[p.cls][0], materialId: p.materialId,
      parent: p.parent, pivot: p.pivot ?? null, axis: p.pivot ? [0, 0, 1] : null,
      states: p.pivot ? { closed: 0, open: ((doorDefs[p.parent].openSign ?? -1) * doorDefs[p.parent].open * Math.PI) / 180 } : null,
      visibleWhen: p.visibleWhen ?? null,
      vertices: p.mesh.positions.flat().map((v) => Number(v.toFixed(3))),
      normals: p.mesh.normals.flat().map((v) => Number(v.toFixed(4))),
      triangleIndices: p.mesh.indices,
    })),
  };


  const report = {
    anatomy: anatomy.rev,
    anatomyCommit: anatomy.commit,
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
    checks,
  };
  return { model, parts, doorDefs, glb, ir, report };
}
