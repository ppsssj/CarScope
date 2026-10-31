#!/usr/bin/env node
// P2-A7: converted IONIQ 5 GLB -> Anatomy-style SVG with the CarScope view, palettes and part IDs.
//   node tools/ioniq5-asset/anatomy-svg.mjs --glb=<hyundai_ioniq_5_2022.glb> --out=<dir outside the repo>
// Writes ioniq5.svg (preview), ioniq5-ids.svg (flat part colours for comparison), ioniq5.parts (the
// app asset format, for local evaluation only), camera.json and svg-report.json. Geometry derived from
// the third-party model is never written into the repository.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, trs, mul, apply } from "./analyze.mjs";
import { gltfToCarCm } from "./profile.mjs";
import { loadAnatomy } from "../anatomy-car/automotive/anatomy.mjs";
import { VIEW, svgScreenPath } from "../anatomy-car/automotive/camera.mjs";
import { meshAnatomySvg, fillMarkup, strokeMarkup, fitMeshProjection, regionOutline } from "../anatomy-car/mesh-svg/mesh-svg.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Source material -> existing Anatomy palette. Red stays reserved for the OPEN accent, so red lamps
// use the smoked-lens palette as the existing sedan does. Glass is drawn opaque, as in the kit car.
export const MATERIAL_PALETTE = Object.freeze({
  Body: "paint", Body_Glass: "glass", Mirror_Glass: "glass", Lens_Smoked: "lampSmoke",
  Black_Gloss: "trim", Black_Matte: "trim", Black_Plastic: "trim", Pixel_Trim: "trim", Trim_Grey: "trim", Grey_Plastic: "trim",
  Chrome: "rim", Chrome_Satin: "rim", Garnish_Silver: "rim", Rim_Machined: "rim", Rim_Aero: "rimShadow", Rim_Black: "rimShadow",
  Tire: "tyre", Brake_Disc: "brake", Brake_Caliper: "caliper",
  Lamp_White: "lamp", Lamp_Projector: "lamp", Pixel_Clear: "lamp", White_Matte: "lamp", Lamp_Amber: "amber", Lamp_Red: "lampSmoke", Reflector_Red: "lampSmoke",
  License_Plate_White: "plate", License_Plate_Blue: "glass", License_Plate_Black: "trim", Seat_Fabric: "seat",
});

/** Mesh nodes as world triangles in CarScope cm, one entry per node, materials per triangle. */
export function glbParts(bytes) {
  const { json, accessor } = readGlb(bytes);
  const parent = new Map();
  json.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const world = (i) => { const n = json.nodes[i], l = trs(n.translation, n.rotation, n.scale); return parent.has(i) ? mul(world(parent.get(i)), l) : l; };
  const out = [];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const m = world(i), tris = [], mats = [];
    for (const p of json.meshes[n.mesh].primitives) {
      const pos = accessor(p.attributes.POSITION), idx = accessor(p.indices);
      const mat = p.material === undefined ? null : json.materials[p.material].name;
      for (let t = 0; t < idx.length; t += 3) {
        for (let j = 0; j < 3; j++) { const v = idx[t + j]; tris.push(...gltfToCarCm(apply(m, [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]))); }
        mats.push(mat);
      }
    }
    out.push({ name: n.name, triangles: Float64Array.from(tris), materials: mats });
  });
  return out;
}

const centre = (T) => { const s = [0, 0, 0]; for (let i = 0; i < T.length; i++) s[i % 3] += T[i]; return s.map((v) => v / (T.length / 3)); };
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** CarScope part IDs. Doors and wheels come from where the mesh sits; the OpenX name must agree. */
export function partIds(nodes) {
  const ids = new Map(), problems = [];
  const where = (c) => `${c[0] > 0 ? "front" : "rear"}-${c[1] > 0 ? "left" : "right"}`;
  const sideDoors = nodes.filter((n) => /^Door_(Left|Right)_\d$/.test(n.name)).map((n) => ({ n, c: centre(n.triangles) }));
  for (const n of nodes) {
    const c = centre(n.triangles);
    let id;
    if (/^Door_(Left|Right)_\d$/.test(n.name)) {
      const [, side, idx] = /^Door_(Left|Right)_(\d)$/.exec(n.name);
      // Of the doors on the same side (by centre Y), the one further forward (+X) is the front door.
      const sameSide = sideDoors.filter((d) => (d.c[1] > 0) === (c[1] > 0));
      if (sameSide.length !== 2) problems.push(`${n.name}: expected 2 side doors on its side, found ${sameSide.length}`);
      id = `door-${c[0] === Math.max(...sameSide.map((d) => d.c[0])) ? "front" : "rear"}-${c[1] > 0 ? "left" : "right"}`;
      const byName = `door-${idx === "0" ? "front" : "rear"}-${side.toLowerCase()}`;
      if (byName !== id) problems.push(`${n.name}: position says ${id}, name says ${byName}`);
    } else if (/^Wheel_\d_\d$/.test(n.name)) {
      id = `wheel-${where(c)}`;
      const [, axle, wheel] = /^Wheel_(\d)_(\d)$/.exec(n.name); // OpenX: axles front->rear, wheels right->left
      const byName = `wheel-${axle === "0" ? "front" : "rear"}-${wheel === "0" ? "right" : "left"}`;
      if (byName !== id) problems.push(`${n.name}: position says ${id}, name says ${byName}`);
    } else id = { Body: "body", Body_Glass: "glass", Door_Front_0: "hood", Door_Rear_0: "tailgate" }[n.name] ?? slug(n.name);
    if ([...ids.values()].includes(id)) problems.push(`duplicate part id ${id}`);
    ids.set(n.name, id);
  }
  return { ids, problems };
}

/** Three.js orthographic camera (glTF metres, Y up) that reproduces the SVG projection exactly. */
export function threeCamera(P, G, bounds, view = VIEW) {
  const r = Math.PI / 180, a = P.azimuth * r, e = P.elevation * r;
  const k = P.scale * Math.sqrt(1.6); // SVG units per cm (kit cameraOf)
  const R = [Math.sin(a), -Math.cos(a), 0], D = [Math.cos(a) * Math.sin(e), Math.sin(a) * Math.sin(e), -Math.cos(e)], V = G.viewOf(P);
  const mid = bounds.lo.map((v, i) => (v + bounds.hi[i]) / 2);
  const rc = (view.width / 2 - P.origin[0]) / k, dc = (view.height / 2 - P.origin[1]) / k, vc = G.dot3(V, mid);
  const c = [0, 1, 2].map((i) => R[i] * rc + D[i] * dc + V[i] * vc);
  const g = ([x, y, z]) => [x / 100, z / 100, -y / 100];
  return { target: g(c), direction: [V[0], V[2], -V[1]], up: [0, 1, 0], halfWidth: view.width / 2 / k / 100, halfHeight: view.height / 2 / k / 100, distance: 20, width: view.width, height: view.height };
}

export const FLAT_PALETTES = Object.freeze(["glass", "lamp", "lampSmoke", "plate", "amber"]);

/**
 * `nodes` (P3-A1): use these mesh nodes instead of the GLB's own, e.g. with a rotated hood; extra
 * nodes may carry an explicit `id`. `projection` ({ P, bounds }): keep one camera across poses.
 */
export async function buildIoniqSvg(glbBytes, { samples = 4, tolerance = 1.5, minRegion = 12, nodes: given = null, projection = null } = {}) {
  const anatomy = await loadAnatomy();
  const nodes = given ?? glbParts(glbBytes);
  const { ids, problems } = partIds(nodes.filter((n) => !n.id));
  for (const n of nodes) if (n.id) ids.set(n.name, n.id);
  const unmapped = [...new Set(nodes.filter((n) => !n.palettes).flatMap((n) => n.materials))].filter((m) => !MATERIAL_PALETTE[m]);
  if (unmapped.length) throw new Error(`Materials without an Anatomy palette: ${unmapped.join(", ")}`);
  // Small emitters lie on their housings: on equal depth the smaller part wins.
  const parts = nodes.map((n) => ({ id: ids.get(n.name), source: n.name, triangles: n.triangles, palettes: n.palettes ?? n.materials.map((m) => MATERIAL_PALETTE[m]), priority: -n.triangles.length / 9 }));
  const { P, bounds } = projection ?? fitMeshProjection(parts, anatomy.k);
  const result = meshAnatomySvg(parts, anatomy, { P, samples, tolerance, minRegion, flatPalettes: FLAT_PALETTES });
  const order = parts.map((p) => p.id);
  const plan = { x: bounds.lo[0], y: bounds.lo[1], w: bounds.hi[0] - bounds.lo[0], d: bounds.hi[1] - bounds.lo[1], r: 45 };
  const halo = `<path d="${svgScreenPath(anatomy.k.haloOf(plan, 0, 0.1, P))}" fill="#8a8a80" fill-opacity="0.22"/>`;
  const fills = fillMarkup(result.fills, order), strokes = strokeMarkup(result.strokes);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" role="img" aria-label="Hyundai IONIQ 5 (OpenX community model), Anatomy-style view">${halo}${fills}${strokes}</svg>`;
  const idColor = (i) => `#${(((i + 1) * 5) & 255).toString(16).padStart(2, "0")}0000`;
  const idSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" shape-rendering="crispEdges">` +
    order.map((id, i) => result.fills.filter((f) => f.id === id).map((f) => `<path d="${f.d}" fill="${idColor(i)}" fill-rule="evenodd"/>`).join("")).join("") + "</svg>";
  return { anatomy, P, bounds, parts, order, ids, problems, result, svg, idSvg, halo, idColors: order.map((id, i) => ({ id, source: parts[i].source, color: idColor(i) })) };
}

/**
 * App asset text (#carscope-anatomy-car 1). Doors have no verified hinge, so only closed sections are
 * written and the asset says so (`#door-pose closed-only`); VehicleVisualAsset rejects open sections.
 */
export function partsAsset(built, { rev }) {
  const doors = ["door-front-left", "door-rear-left", "door-front-right", "door-rear-right"];
  const { result, order, halo } = built;
  const touches = (s, id) => s.parts.includes(id);
  const staticIds = order.filter((id) => !doors.includes(id));
  const staticStrokes = result.strokes.filter((s) => !doors.some((d) => touches(s, d)));
  const lines = ["#carscope-anatomy-car 1", `#viewbox ${VIEW.width} ${VIEW.height}`, `#source anatomy-kit ${rev} mesh-svg openx-ioniq5`, "#visual-profile hyundai-ioniq5-2022", "#door-pose closed-only", "@static", halo + fillMarkup(result.fills, staticIds) + strokeMarkup(staticStrokes)];
  const assigned = new Set();
  const missing = [];
  for (const door of doors) {
    if (!result.fills.some((f) => f.id === door)) { missing.push(door); continue; } // not visible from this view
    const own = result.strokes.filter((s) => touches(s, door) && !assigned.has(s));
    own.forEach((s) => assigned.add(s));
    const markup = fillMarkup(result.fills, [door]) + strokeMarkup(own);
    // Accent = the door's visible region as closed rings (chains with the door on exactly one side).
    const accent = regionOutline(result.strokes, door, built.anatomy.k);
    lines.push(`@door ${door} closed`, markup, `@accent ${door} closed`, accent);
  }
  return { text: lines.join("\n") + "\n", missing };
}

async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  if (!args.glb || !args.out) { console.error("usage: node tools/ioniq5-asset/anatomy-svg.mjs --glb=<.glb> --out=<dir outside the repo> [--samples=4] [--tolerance=1.5] [--min-region=12]"); return 2; }
  const out = resolve(args.out);
  const rel = relative(REPO, out);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`Refusing to write model-derived SVG inside the CarScope repo: ${out}`);
  const glb = readFileSync(resolve(args.glb));
  const t0 = performance.now();
  const built = await buildIoniqSvg(glb, { samples: Number(args.samples ?? 4), tolerance: Number(args.tolerance ?? 1.5), minRegion: Number(args["min-region"] ?? 12) });
  const ms = Math.round(performance.now() - t0);
  if (built.problems.length) throw new Error(built.problems.join("; "));
  const asset = partsAsset(built, { rev: built.anatomy.rev });
  mkdirSync(out, { recursive: true });
  const write = (name, text) => { writeFileSync(join(out, name), text); return { file: name, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") }; };
  const files = [write("ioniq5.svg", built.svg), write("ioniq5-ids.svg", built.idSvg), write("ioniq5.parts", asset.text)];
  const camera = threeCamera(built.P, built.anatomy.G, built.bounds);
  files.push(write("camera.json", JSON.stringify({ projection: built.P, view: VIEW, three: camera, idColors: built.idColors }, null, 2)));
  const report = {
    tool: "tools/ioniq5-asset/anatomy-svg.mjs", anatomy: built.anatomy.commit, glbSha256: createHash("sha256").update(glb).digest("hex"), view: VIEW, projection: built.P,
    stats: { ...built.result.stats, msTotal: ms, svgElements: (built.svg.match(/<(path|g|circle)\b/g) ?? []).length },
    parts: built.order.map((id) => ({ id, source: built.parts.find((p) => p.id === id).source, regions: built.result.fills.filter((f) => f.id === id).length })),
    hiddenFromView: built.order.filter((id) => !built.result.fills.some((f) => f.id === id)),
    partsAsset: { missingDoorSections: asset.missing, note: "closed sections only (#door-pose closed-only): hinge axes UNVERIFIED, no open pose" },
    files,
  };
  files.push(write("svg-report.json", JSON.stringify(report, null, 2) + "\n"));
  console.log(`SVG ${join(out, "ioniq5.svg")}: ${files[0].bytes} B, ${report.stats.regions} regions, ${report.stats.svgElements} elements, ${report.stats.visibleTriangles}/${report.stats.triangles} triangles visible, ${ms} ms`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`FAILED: ${e.message}`); process.exitCode = 1; });
}
