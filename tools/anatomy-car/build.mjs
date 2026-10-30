// CarScope sedan, built with the Anatomy kit (https://github.com/wheresryan22/anatomy, MIT).
//
// Writes:
//   vehicle-core/src/main/resources/io/carscope/visualization/anatomy-car.parts
//     Flattened, painter-ordered SVG markup (paths and circles only, colours as attributes, no CSS,
//     no script). VehicleSvgRenderer picks one closed/open variant per visible door from it.
//   tools/anatomy-car/build/*.html
//     Kit-styled preview pages for Anatomy's own checks (scripts/capture.mjs, scripts/lines.mjs).
//
// The kit is not vendored. Point ANATOMY_HOME at an Anatomy checkout (default ~/.claude/skills/anatomy).
//   node tools/anatomy-car/build.mjs [--audit]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ANATOMY = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
const kit = (path) => import(pathToFileURL(join(ANATOMY, path)).href);
const k = await kit("kit/iso-kit.mjs");
const G = await kit("kit/lathe.mjs");
const A = await kit("kit/audit.mjs");

// ---------------------------------------------------------------- world (units ~ 1 cm)
// x forward, y to the car's left, z up. The camera looks at the left side and the front, so
// FRONT_LEFT (the one door the Pleos SDK reads) faces the viewer. Right-side doors are hidden by the
// body and are reported in the renderer's plan inset instead of being drawn distorted.
const W = 640;
const H = 330;
const AZIMUTH = 56;
const ELEVATION = 28;

const HALF = 90; // body half width
const CAB = 78; // cabin half width (tumblehome)
const AXLE = 136;
const WHEEL_Z = 33;
const TYRE_R = 32.5;
const ARCH_R = 40;
const SILL = 20;
const BELT = 95;
const FRONT_OPEN = 64; // degrees
const REAR_OPEN = 58;

const FRONT_DOOR = { id: "door-front-left", hinge: 38, length: 64, open: FRONT_OPEN };
const REAR_DOOR = { id: "door-rear-left", hinge: -31, length: 76, open: REAR_OPEN };

const deg = (d) => (d * Math.PI) / 180;
const archPoints = (cx, r, from, to, steps) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = deg(from + ((to - from) * i) / steps);
    return [cx + r * Math.cos(t), WHEEL_Z + r * Math.sin(t)];
  });
const archCut = (cx, r) => {
  const t = Math.asin((SILL - WHEEL_Z) / r) * (180 / Math.PI); // below the axle line
  return archPoints(cx, r, t, 180 - t, 18);
};

// Side profile of the lower body, (x, z), front to rear along the sill, then back over the top.
const BODY = [
  [214, SILL],
  ...archCut(AXLE, ARCH_R),
  ...archCut(-AXLE, ARCH_R),
  [-214, SILL], [-223, 26], [-229, 40], [-230, 58], [-226, 74], [-215, 86], [-197, 92], [-150, BELT],
  [40, BELT], [62, 93.5], [120, 90.5], [178, 86.5], [205, 83], [221, 78], [229, 68], [231.5, 56], [231, 44], [228, 32], [222, 22],
];
// Cabin profile, (x, z): rear glass, roof, windshield.
const CABIN = [[-150, BELT], [-97, 140], [-86, 143.4], [-12, 144.6], [1, 142.5], [40, BELT]];
const ROOF_Z = 144.6;

// ---------------------------------------------------------------- camera
const doorReach = (door) => {
  const t = deg(door.open);
  return [door.hinge - door.length * Math.cos(t), HALF + door.length * Math.sin(t)];
};
const [fx, fy] = doorReach(FRONT_DOOR);
const [rx, ry] = doorReach(REAR_DOOR);
const P = k.fitProjection(
  [
    ...k.boxCorners({ x: -232, y: -HALF, w: 464, d: 2 * HALF, r: 0 }, 0, BELT),
    ...k.boxCorners({ x: -100, y: -CAB, w: 104, d: 2 * CAB, r: 0 }, BELT, ROOF_Z + 3),
    [fx, fy, 0], [fx, fy, 142], [rx, ry, 0], [rx, ry, 142],
  ],
  W, H, { pad: 18, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const at = (p) => k.iso(p, P);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

// ---------------------------------------------------------------- prisms along any axis
// prismPaths is adapted from Anatomy's examples/arcade-cabinet/build.mjs (MIT, (c) 2026 Ryan; see ANATOMY-LICENSE):
// a concave polygon in a frame's (u, v) plane extruded along F.a, shaded by facing like k.extrude.
const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}
const W3 = (F, s, [x, y]) => G.add3(G.add3(G.add3(F.o, G.mul3(F.a, s)), G.mul3(F.u, x)), G.mul3(F.v, y));
function prismPaths(F, poly, s0, s1) {
  const ring = signed(poly) > 0 ? poly : [...poly].reverse();
  const n = ring.length;
  const capNear = G.dot3(F.a, V) > 0;
  const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
  const near = ring.map((p) => at(W3(F, nearS, p)));
  const far = ring.map((p) => at(W3(F, farS, p)));
  const normals = ring.map(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % n];
    return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
  });
  const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
  const outline = [];
  const crease = [];
  for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
  for (const run of runsOf(facing, true)) {
    crease.push(k.pathOf(run.map((i) => near[i])));
    outline.push(k.pathOf(run.map((i) => far[i])));
  }
  for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
  const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
  const buckets = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
    parts.push(k.pathOf(quad, true));
    buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
  }
  buckets[G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P)].push(k.pathOf(screenOriented(near), true));
  return { fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
}

const Y_FRAME = (y = 0) => G.frameOf([0, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]); // poly (x, z), s along +y
const X_FRAME = (x = 0) => G.frameOf([x, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); // poly (y, z), s along +x

// ---------------------------------------------------------------- items
// Every drawn item keeps primitive records so it can be emitted twice: as kit markup for the
// preview/audit and as flat attribute-coloured markup for the app.
const R = A.recorder(P);
const record = R.solid;
const ITEMS = [];
function item(name, ref, prims, shapes, { section = "static", bias = 0 } = {}) {
  const it = R.put({ name, at: ref, bias, svg: kitMarkup(prims), shapes, piece: "car", section, prims });
  ITEMS.push(it);
  return it;
}
const solid = (paths, style = {}) => ({ kind: "solid", paths, ...style });
const line = (d, style = {}) => ({ kind: "line", d, ...style });
const dots = (points, style = {}) => ({ kind: "dots", points, ...style });

function prismItem(name, F, poly, s0, s1, style, opts = {}) {
  const shape = record(A.prism(F, poly, s0, s1, { name, ...(opts.meta ?? {}) }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = W3(F, (s0 + s1) / 2, [cx, cy]);
  const prims = [solid(prismPaths(F, poly, s0, s1), style), ...(opts.extra ?? [])];
  return opts.collect ? { prims, shapes: [shape], centre } : item(name, opts.ref ?? centre, prims, [shape], opts);
}

// ---------------------------------------------------------------- halo
// The soft ground shadow is not a part: it is drawn first, outside the sorted items.
const HALO = [{ kind: "halo", d: k.haloOf({ x: -222, y: -HALF + 6, w: 448, d: 2 * HALF - 12, r: 40 }, 0, 4, P) }];

// ---------------------------------------------------------------- wheels
const spokes = (F, s) => G.spokesOf(F, s, 7, 19.5, 5, P, { phase: 0.3 });
function wheel(name, x, side) {
  const y0 = side > 0 ? HALF - 25 : -(HALF - 25);
  const F = G.frameOf([x, y0, WHEEL_Z], [0, side, 0], [1, 0, 0], [0, 0, 1]);
  const tyreProfile = [[0, 22], [0.6, 28.5, 1], [2.4, TYRE_R, 1], [19.6, TYRE_R, 1], [21.4, 28.5, 1], [22, 22]];
  const tyre = G.solidOf(tyreProfile, F, P);
  // the hub carrier between the well wall (the body core) and the tyre: hidden, but it is what
  // holds the body up, so it is recorded as a real part
  const shapes = [record(A.solid(F, tyreProfile, { name: `${name}.tyre`, owner: name, ground: true })), record(A.disc(F, -0.95, 0, 9, { name: `${name}.hub-carrier`, owner: name }))];
  const prims = [solid(tyre, { palette: "tyre", tone: "hi", crease: "none" })];
  if (side > 0) {
    prims.push(solid(G.disc(21.2, 22.4, 21.4, F, P), { palette: "rim", tone: "hi" }));
    prims.push(line(G.spokesOf(F, 22.4, 6.5, 20, 10, P, { phase: 0.15 }), { tone: "mid" }));
    prims.push(solid(G.disc(22.4, 24, 6.5, F, P), { palette: "rim", tone: "hi" }));
    prims.push(dots(G.dotsOf(F, 22.4, 10.5, 5, P, { all: true }), { size: 0.7, tone: "hi" }));
    prims.push(line(G.arcOf(F, 22.4, 20, P, { least: -1 }), { tone: "mid" }));
    shapes.push(record(A.disc(F, 21.2, 24, 21.4, { name: `${name}.rim`, owner: name })));
  }
  item(name, [x, y0 + side * 11, WHEEL_Z], prims, shapes);
}
// The right-hand wheels are hidden by the body at this camera and are not drawn.

// ---------------------------------------------------------------- body
// The body is cut into pieces so no piece wraps a wheel (craft.md, painter's order): a core behind
// the near wheels, a middle band that only exists away from the arches (and above them), and a thin
// outer skin in front of the wheels. Each piece is one prism along y.
const clip = (poly, keep) => {
  // Sutherland-Hodgman against one half-plane; the subject may be concave.
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ka = keep.inside(a);
    const kb = keep.inside(b);
    if (ka) out.push(a);
    if (ka !== kb) out.push(keep.cross(a, b));
  }
  return out;
};
const xAtLeast = (x0) => ({ inside: ([x]) => x >= x0, cross: ([ax, az], [bx, bz]) => [x0, az + ((bz - az) * (x0 - ax)) / (bx - ax)] });
const xAtMost = (x0) => ({ inside: ([x]) => x <= x0, cross: ([ax, az], [bx, bz]) => [x0, az + ((bz - az) * (x0 - ax)) / (bx - ax)] });
const zAtLeast = (z0) => ({ inside: ([, z]) => z >= z0, cross: ([ax, az], [bx, bz]) => [ax + ((bx - ax) * (z0 - az)) / (bz - az), z0] });
const band = (x0, x1, z0 = -Infinity) => {
  let poly = clip(clip(BODY, xAtLeast(x0)), xAtMost(x1));
  if (z0 > -Infinity) poly = clip(poly, zAtLeast(z0));
  return poly;
};
const CORE_Y = HALF - 26; // just behind the near tyres
const SKIN_Y = HALF - 2.4;
const BROW_Z = WHEEL_Z + ARCH_R + 1;
const ARCH_X = AXLE + ARCH_R + 0.5;
const ARCH_IN = AXLE - ARCH_R - 0.5;
const yNear = HALF + 0.05;
const onSide = (pts, y = yNear) => path3(pts.map(([x, z]) => [x, y, z]));
const bodyPiece = (name, poly, y0, y1, extra = []) => {
  const shape = record(A.prism(Y_FRAME(0), poly, y0, y1, { name, owner: "body" }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return item(name, [cx, (y0 + y1) / 2, cz], [solid(prismPaths(Y_FRAME(0), poly, y0, y1), { palette: "paint", tone: "hi", inner: extra })], [shape]);
};
// hood shut lines and the cowl line on the hood top
const hoodZ = (x) => {
  for (let i = 0; i < BODY.length - 1; i++) {
    const [x0, z0] = BODY[i];
    const [x1, z1] = BODY[i + 1];
    if (z0 >= 80 && z1 >= 80 && x0 >= 40 && x1 >= 40 && x0 > x1 === false && x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0) + 0.1;
  }
  return BELT;
};
const hoodLine = (y, x0 = 44, x1 = 205) => path3([62, 120, 178].filter((x) => x > x0 && x < x1).concat([x0, x1]).sort((a, b) => a - b).map((x) => [x, y, hoodZ(x)]));
// The core holds the floor between the wheel wells, so it carries no arches (the far wells are
// never visible from this camera). The near wells are the gap between the core and the skin.
const BODY_FILLED = BODY.filter(([, z], i) => !(z > SILL + 1e-6 && i > 0 && i < BODY.findIndex(([x]) => x < -200)));
// the wheel-well liners: the part of the core face that shows through each near arch
const WELL = (cx) => [...archPoints(cx, ARCH_R, Math.asin((SILL - WHEEL_Z) / ARCH_R) * (180 / Math.PI), 180 - Math.asin((SILL - WHEEL_Z) / ARCH_R) * (180 / Math.PI), 24)];
const wells = [AXLE, -AXLE].map((cx) => ({ kind: "poly", points: WELL(cx).map(([x, z]) => [x, CORE_Y + 0.05, z]), palette: "well" }));
bodyPiece("body.core", BODY_FILLED, -HALF, CORE_Y, [
  ...wells,
  line(hoodLine(-(HALF - 1.2)), { tone: "faint" }),
  line(path3([[44, -HALF, BELT + 0.1], [44, CORE_Y, BELT + 0.1]]), { tone: "faint" }),
]);
bodyPiece("body.band-front", band(ARCH_X, 240), CORE_Y, SKIN_Y);
bodyPiece("body.band-front-brow", band(ARCH_IN, ARCH_X, BROW_Z), CORE_Y, SKIN_Y);
bodyPiece("body.band-mid", band(-ARCH_IN, ARCH_IN), CORE_Y, SKIN_Y, [line(path3([[44, CORE_Y, BELT + 0.1], [44, SKIN_Y, BELT + 0.1]]), { tone: "faint" })]);
bodyPiece("body.band-rear-brow", band(-ARCH_X, -ARCH_IN, BROW_Z), CORE_Y, SKIN_Y);
bodyPiece("body.band-rear", band(-240, -ARCH_X), CORE_Y, SKIN_Y);
bodyPiece("body.skin", BODY, SKIN_Y, HALF, [
  // shoulder character line, front fender to tail
  line(onSide([[-215 - (11 * 4) / 12, 82], [-150, 86], [40, 86], [120, 84], [221 - (16 * 1.5) / 5, 79.5]]), { tone: "mid" }),
  // rocker crease
  line(onSide([[-(AXLE - Math.sqrt(ARCH_R ** 2 - (25 - WHEEL_Z) ** 2)), 25], [AXLE - Math.sqrt(ARCH_R ** 2 - (25 - WHEEL_Z) ** 2), 25]]), { tone: "mid" }),
  // hood shut line along the fender top, cowl to the hood's front crease
  line(hoodLine(HALF - 1.2, 44, 205), { tone: "faint" }),
  line(path3([[44, SKIN_Y, BELT + 0.1], [44, HALF, BELT + 0.1]]), { tone: "faint" }),
  // fuel door on the rear quarter
  line(onSide([[-170, 72], [-154, 72], [-154, 84], [-170, 84], [-170, 72]]), { tone: "mid" }),
]);

// ---------------------------------------------------------------- cabin (greenhouse)
const CAB_F = Y_FRAME(0);
const cabPaths = prismPaths(CAB_F, CABIN, -CAB, CAB);
const cabShape = record(A.prism(CAB_F, CABIN, -CAB, CAB, { name: "cabin" }));
// windshield: glass inlay on the sloped front facet, inset from the A-pillars
const shield = (inset) => {
  const lerp = (a, b, t) => a + (b - a) * t;
  const [x0, z0] = [40, BELT];
  const [x1, z1] = [1, 142.5];
  const p = (t, y) => [lerp(x0, x1, t) + 0.15, y, lerp(z0, z1, t) + 0.15];
  return [p(0.04, CAB - inset), p(0.96, CAB - inset - 3), p(0.96, -CAB + inset + 3), p(0.04, -CAB + inset)];
};
const glassFill = { kind: "poly", points: shield(7), palette: "glass" };
const shieldLines = [line(path3(shield(7), true), { tone: "hi" }), line(path3([shield(7)[0], shield(7)[1]].map(([x, y, z]) => [x, y - 14, z])), { tone: "faint" })];
// wipers resting at the base of the glass
const wipers = [0, 1].flatMap((i) => [
  line(path3([[39.6, 10 - i * 46, BELT + 1.6], [33.5, 52 - i * 46, BELT + 9]]), { tone: "hi", free: "end" }),
  dots([at([39.6, 10 - i * 46, BELT + 1.6])], { size: 1.1, tone: "hi" }),
]);
item("cabin", [-50, 0, 120], [solid(cabPaths, { palette: "paint", tone: "hi" }), glassFill, ...shieldLines, ...wipers], [cabShape]);

// fixed side glass and pillars on the near cabin face (y = CAB)
const sideGlass = (name, poly) => prismItem(name, Y_FRAME(0), poly, CAB + 0.05, CAB + 0.5, { palette: "glass", tone: "hi", crease: "none" });
sideGlass("glass.quarter", [[-112, 99], [-112, 122], [-128, 108.5], [-128, 99]]);
prismItem("trim.c-pillar", Y_FRAME(0), [[-108.2, 98], [-108.2, 120], [-112, 120], [-112, 98]], CAB + 0.05, CAB + 0.6, { palette: "trim", tone: "hi", crease: "none" });
prismItem("trim.b-pillar", Y_FRAME(0), [[-26.3, 97], [-26.3, 141.5], [-30.7, 141.5], [-30.7, 97]], CAB + 0.05, CAB + 0.6, { palette: "trim", tone: "hi", crease: "none" });
// roof fin antenna
const roofZ = (x) => 143.4 + ((144.6 - 143.4) * (x + 86)) / 74; // the roof chord from (-86, 143.4) to (-12, 144.6)
prismItem("roof.antenna", Y_FRAME(0), [[-80, roofZ(-80) + 0.03], [-66, roofZ(-66) + 0.03], [-74, ROOF_Z + 5], [-79, ROOF_Z + 5.4]], -3, 3, { palette: "trim", tone: "hi" });

// ---------------------------------------------------------------- front end
// Lamps, grille, intake and plate are thin prisms standing 0.05 proud of the nose facet they sit on.
// A facet frame: u across the car (y), v up the facet, a out of it.
function facetFrame([xa, za], [xb, zb]) {
  const len = Math.hypot(xb - xa, zb - za);
  const v = [(xb - xa) / len, 0, (zb - za) / len];
  const a = [v[2], 0, -v[0]];
  return { F: { o: [xa, 0, za], u: [0, 1, 0], v, a: G.dot3(a, [1, 0, 0]) > 0 ? a : G.mul3(a, -1) }, len };
}
const NOSE_A = facetFrame([229, 68], [221, 78]); // upper nose: headlamps
const NOSE_B = facetFrame([231.5, 56], [229, 68]); // grille
const NOSE_C = facetFrame([231, 44], [231.5, 56]); // plate
const NOSE_D = facetFrame([228, 32], [231, 44]); // intake, fog lamps
const onFacet = (facet, pts) => pts.map(([y, t]) => [y, t * facet.len]);
const inlay = (name, facet, pts, palette, extra = []) =>
  prismItem(name, facet.F, onFacet(facet, pts), 0.05, 0.6, { palette, tone: "hi", crease: "none" }, { extra, meta: { owner: "body" } });
for (const side of [1, -1]) {
  const tag = side > 0 ? "left" : "right";
  inlay(`lamp.head-${tag}`, NOSE_A, [[side * 50, 0.12], [side * 84, 0.08], [side * 84, 0.7], [side * 56, 0.86]], "lamp", [
    // a divider across the lens, edge to edge (the lens sides run (50,.12)-(56,.86) and (84,.08)-(84,.7))
    line(path3([W3(NOSE_A.F, 0.62, [side * (50 + 6 * (0.4 - 0.12) / 0.74), 0.4 * NOSE_A.len]), W3(NOSE_A.F, 0.62, [side * 84, 0.4 * NOSE_A.len])]), { tone: "mid" }),
  ]);
  inlay(`lamp.fog-${tag}`, NOSE_D, [[side * 62, 0.3], [side * 78, 0.3], [side * 78, 0.62], [side * 62, 0.62]], "trim");
}
inlay("grille", NOSE_B, [[-42, 0.1], [42, 0.1], [44, 0.9], [-44, 0.9]], "trim",
  [0.3, 0.5, 0.7].map((t) => { const h = 42 + (2 * (t - 0.1)) / 0.8; return line(path3([W3(NOSE_B.F, 0.62, [-h, t * NOSE_B.len]), W3(NOSE_B.F, 0.62, [h, t * NOSE_B.len])]), { tone: "lo" }); }));
inlay("plate.front", NOSE_C, [[-17, 0.15], [17, 0.15], [17, 0.8], [-17, 0.8]], "plate",
  [line(path3([W3(NOSE_C.F, 0.62, [-13, 0.48 * NOSE_C.len]), W3(NOSE_C.F, 0.62, [13, 0.48 * NOSE_C.len])]), { tone: "faint", free: true })]);
inlay("intake", NOSE_D, [[-56, 0.1], [56, 0.1], [56, 0.24], [-56, 0.24]], "trim");
// side marker on the front fender
prismItem("lamp.marker", Y_FRAME(0), [[196, 66], [208, 66], [208, 69], [196, 69]], HALF + 0.05, HALF + 0.5, { palette: "amber", tone: "hi", crease: "none" }, { meta: { owner: "body" } });

// ---------------------------------------------------------------- near wheels (in front of the far side)
wheel("wheel.rear-left", -AXLE, 1);
wheel("wheel.front-left", AXLE, 1);

// ---------------------------------------------------------------- doors
// A door is built in its own frame: u runs from the hinge toward the door's rear edge, v is up,
// a points out of the car. Opening rotates u and a about the vertical hinge axis.
function doorFrame(door, angle) {
  const t = deg(angle);
  return {
    o: [door.hinge, HALF, 0],
    u: [-Math.cos(t), Math.sin(t), 0],
    v: [0, 0, 1],
    a: [Math.sin(t), Math.cos(t), 0],
  };
}
const toU = (door, x) => door.hinge - x;
const INBOARD = CAB - HALF + 0.05; // the window frame sits on the cabin face

function frontDoorShapes(door) {
  const L = door.length;
  const panel = [[0, 30], [2, 26.5], [L - 2, 26.5], [L, 30], [L, 95], [0, 95]];
  // window opening follows the A-pillar line from the beltline to the roof
  const glass = [[toU(door, 33), 98], [toU(door, 4), 137.5], [L - 1.5, 137.5], [L - 1.5, 98]];
  const frame = [[toU(door, 38.5), 96.65], [toU(door, 3), 141.6], [L, 141.6], [L, 96.65]];
  return { panel, glass, frame, handle: [L - 16, 82], mirror: true };
}
function rearDoorShapes(door) {
  const L = door.length;
  const r = ARCH_R + 2.2;
  // the rear-bottom corner follows the front of the rear arch, from the door bottom to the rear edge
  const t0 = Math.asin((26.5 - WHEEL_Z) / r);
  const t1 = Math.acos((door.hinge - L + AXLE) / r);
  const notch = [];
  for (let i = 0; i <= 12; i++) {
    const t = t0 + ((t1 - t0) * i) / 12;
    notch.push([toU(door, -AXLE + r * Math.cos(t)), WHEEL_Z + r * Math.sin(t)]);
  }
  const panel = [[0, 30], [2, 26.5], ...notch, [L, 95], [0, 95]];
  const glass = [[1.5, 98], [1.5, 137.5], [toU(door, -91), 137.5], [toU(door, -104), 121], [toU(door, -104), 98]];
  const frame = [[0, 96.65], [0, 141.6], [toU(door, -90), 141.6], [L, 120], [L, 96.65]];
  return { panel, glass, frame, handle: [L - 18, 82], mirror: false };
}

const DOOR_SECTIONS = [];
function doorItem(door, shapesOf, variant) {
  const angle = variant === "open" ? door.open : 0;
  const F = doorFrame(door, angle);
  const s = shapesOf(door);
  const name = `${door.id}.${variant}`;
  const prims = [];
  const shapes = [];
  const centre = W3(F, 0, [door.length / 2, 70]);
  if (variant === "open") {
    // the door aperture left in the body side: dark trim, the sill plate and a seat back
    const ap = s.panel.map(([u, v]) => [door.hinge - u, yNear + 0.05, v]).concat(s.frame.slice().reverse().map(([u, v]) => [door.hinge - u, CAB + 0.7, v]));
    prims.push({ kind: "poly", points: s.panel.map(([u, v]) => [door.hinge - u, yNear + 0.05, v]), palette: "interior" });
    prims.push({ kind: "poly", points: s.frame.map(([u, v]) => [door.hinge - u, CAB + 0.7, v]), palette: "interior" });
    const seatX = door === FRONT_DOOR ? -10 : -84;
    prims.push({ kind: "poly", points: [[seatX + 8, CAB + 0.75, 98], [seatX - 2, CAB + 0.75, 98], [seatX - 6, CAB + 0.75, 132], [seatX + 2, CAB + 0.75, 134]], palette: "seat" });
    prims.push(line(path3([[door.hinge - 2, yNear + 0.1, 29], [door.hinge - door.length + 2, yNear + 0.1, 29]]), { tone: "lo" }));
    void ap;
  }
  const meta = (part) => ({ name: `${name}.${part}`, owner: door.id });
  const frameShape = A.prism(F, s.frame, INBOARD, INBOARD + 0.75, meta("frame"));
  const glassShape = A.prism(F, s.glass, INBOARD + 0.75, INBOARD + 1.05, meta("glass"));
  const panelShape = A.prism(F, s.panel, 0.05, 1.6, meta("panel"));
  const capPoly = [[0, 95.05], [door.length, 95.05], [door.length, 96.6], [0, 96.6]];
  // cap: the beltline strip joining the panel to the window frame, extruded inboard
  const capF = { o: F.o, u: F.u, v: F.a, a: G.mul3(F.v, 1) };
  void capF;
  const capShape = A.prism(F, capPoly, INBOARD, 1.6, meta("cap"));
  shapes.push(...[frameShape, glassShape, panelShape, capShape].map(record));
  prims.push(solid(prismPaths(F, s.frame, INBOARD, INBOARD + 0.75), { palette: "trim", tone: "hi", crease: "none" }));
  prims.push(solid(prismPaths(F, s.glass, INBOARD + 0.75, INBOARD + 1.05), { palette: "glass", tone: "hi", crease: "none" }));
  prims.push(solid(prismPaths(F, capPoly, INBOARD, 1.6), { palette: "trim", tone: "hi", crease: "none" }));
  const P3 = (u, v, a = 1.65) => W3(F, a, [u, v]);
  const accentPts = s.panel.map(([u, v]) => P3(u, v));
  prims.push(solid(prismPaths(F, s.panel, 0.05, 1.6), {
    palette: "paint", tone: "hi",
    inner: [line(path3([[0, 86], [door.length, 86]].map(([u, v]) => P3(u, v, 1.6))), { tone: "mid" })],
  }));
  // handle: a recessed pull with its lever
  prims.push(solid(prismPaths(F, [[s.handle[0], s.handle[1]], [s.handle[0] + 11, s.handle[1]], [s.handle[0] + 11, s.handle[1] + 2.6], [s.handle[0], s.handle[1] + 2.6]], 1.6, 2.4), { palette: "trim", tone: "hi", crease: "none" }));
  shapes.push(record(A.prism(F, [[s.handle[0], s.handle[1]], [s.handle[0] + 11, s.handle[1]], [s.handle[0] + 11, s.handle[1] + 2.6], [s.handle[0], s.handle[1] + 2.6]], 1.6, 2.4, meta("handle"))));
  if (s.mirror) {
    const mirror = [[3, 99.05], [17, 99.05], [16, 107], [5, 108]];
    prims.push(solid(prismPaths(F, [[4, 96.65], [10, 96.65], [10, 99], [4, 99]], 1.6, 4), { palette: "trim", tone: "hi", crease: "none" }));
    prims.push(solid(prismPaths(F, mirror, 4, 12.5), { palette: "paint", tone: "hi" }));
    shapes.push(record(A.prism(F, mirror, 4, 12.5, meta("mirror"))));
    shapes.push(record(A.prism(F, [[4, 96.65], [10, 96.65], [10, 99], [4, 99]], 1.6, 4, meta("mirror-arm"))));
  }
  const it = item(name, centre, prims, shapes, { section: { door: door.id, variant } });
  it.accent = k.pathOf(accentPts.map(at), true);
  DOOR_SECTIONS.push(it);
}
for (const variant of ["closed", "open"]) {
  doorItem(REAR_DOOR, rearDoorShapes, variant);
  doorItem(FRONT_DOOR, frontDoorShapes, variant);
}

// ---------------------------------------------------------------- order
// Both variants of a door are recorded so one key order serves every combination; a door is never
// drawn in both poses at once, so pairs of its own variants are skipped.
const variantOf = (it) => (typeof it.section === "object" ? it.section : null);
const skip = (a, b) => {
  const va = variantOf(a);
  const vb = variantOf(b);
  return (va && vb && va.door === vb.door) || A.sameRun(a, b);
};
const settled = A.settle(R, P, { skip });
R.items.sort((a, b) => a.key - b.key);
if (process.argv.includes("--audit")) {
  console.log(`items ${R.items.length}, cycles ${settled?.cycles?.length ?? "?"}, dropped ${settled?.dropped?.length ?? "?"}`);
}
A.auditOrExit(R, P, {});

// ---------------------------------------------------------------- emit
const LIGHT = {
  hi: "#26262a", mid: "#8a8a8f", lo: "#b4b4b8", faint: "#d4d4d6", dot: "#3a3a3e",
};
const PALETTES = {
  paint: { paper: "#eef1f4", shades: ["#c3cad3", "#d1d7de", "#dde2e8", "#e8ecf0"], top: "#f8fafc" },
  glass: { paper: "#56626f", shades: ["#3f4954", "#47525e", "#505c69", "#5a6775"], top: "#6e7c8b" },
  tyre: { paper: "#2c2f33", shades: ["#1f2124", "#26292c", "#2e3135", "#363a3e"], top: "#41454a" },
  rim: { paper: "#d9dde2", shades: ["#a7aeb6", "#b7bdc4", "#c6cbd1", "#d3d7dc"], top: "#eceef1" },
  trim: { paper: "#3b3f45", shades: ["#2b2e33", "#32363b", "#3a3e44", "#43474d"], top: "#50555c" },
  lamp: { paper: "#e9eef4", shades: ["#bcc6d1", "#c9d2db", "#d6dde5", "#e3e8ee"], top: "#f6f9fc" },
  plate: { paper: "#f4f4f1", shades: ["#d8d8d4", "#e0e0dc", "#e8e8e4", "#efefeb"], top: "#ffffff" },
  amber: { paper: "#e3a64a", shades: ["#c98a2e", "#d39537", "#dc9f41", "#e6aa4c"], top: "#f0b85c" },
  interior: { paper: "#4a4e55" },
  well: { paper: "#34373c" },
  seat: { paper: "#5b6068" },
};
const fmt = (attrs) => Object.entries(attrs).filter(([, v]) => v !== undefined).map(([key, v]) => ` ${key}="${v}"`).join("");
const LINE_W = 0.6;

function flatMarkup(prims) {
  const out = [];
  for (const p of prims) {
    if (p.kind === "halo") out.push(`<path${fmt({ d: p.d, fill: "#8a8a80", "fill-opacity": "0.22" })}/>`);
    else if (p.kind === "poly") out.push(`<path${fmt({ d: k.pathOf(p.points.map(at), true), fill: PALETTES[p.palette].paper, stroke: LIGHT.hi, "stroke-width": LINE_W, "stroke-linejoin": "round" })}/>`);
    else if (p.kind === "line") { if (p.d) out.push(`<path${fmt({ d: p.d, fill: "none", stroke: LIGHT[p.tone ?? "lo"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`); }
    else if (p.kind === "dots") {
      const opacity = { hi: 0.85, mid: 0.45, lo: 0.22, faint: 0.12 }[p.tone ?? "mid"];
      for (const [x, y] of p.points) out.push(`<circle${fmt({ cx: x.toFixed(1), cy: y.toFixed(1), r: p.size ?? 0.5, fill: LIGHT.dot, "fill-opacity": opacity })}/>`);
    } else if (p.kind === "solid") {
      const pal = PALETTES[p.palette ?? "paint"];
      const paths = p.paths;
      out.push(`<path${fmt({ d: paths.fill, fill: pal.paper })}/>`);
      paths.shades.forEach((d, i) => { if (d) out.push(`<path${fmt({ d, fill: pal.shades[i], stroke: paths.seamless ? pal.shades[i] : undefined, "stroke-width": paths.seamless ? 0.4 : undefined })}/>`); });
      if (paths.top) out.push(`<path${fmt({ d: paths.top, fill: pal.top, stroke: paths.seamless ? pal.top : undefined, "stroke-width": paths.seamless ? 0.4 : undefined })}/>`);
      if ((p.crease ?? "faint") !== "none" && paths.crease) out.push(`<path${fmt({ d: paths.crease, fill: "none", stroke: LIGHT[p.crease ?? "faint"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`);
      if (p.inner) out.push(flatMarkup(p.inner));
      out.push(`<path${fmt({ d: paths.outline, fill: "none", stroke: LIGHT[p.tone ?? "hi"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`);
    }
  }
  return out.join("");
}
function kitMarkup(prims) {
  const out = [];
  for (const p of prims) {
    if (p.kind === "halo") out.push(`<path class="iso-halo" d="${p.d}"/>`);
    else if (p.kind === "poly") out.push(k.solidSvg({ fill: k.pathOf(p.points.map(at), true), outline: k.pathOf(p.points.map(at), true), crease: "", top: "", shades: ["", "", "", ""] }, { tone: "hi", flat: true, className: `car-${p.palette}` }));
    else if (p.kind === "line") out.push(k.lineSvg(p.d, { tone: p.tone, free: p.free }));
    else if (p.kind === "dots") out.push(k.dotsSvg(p.points, { size: p.size, tone: p.tone }));
    else if (p.kind === "solid") out.push(k.solidSvg(p.paths, { tone: p.tone, crease: p.crease, className: `car-${p.palette ?? "paint"}`, inner: p.inner ? kitMarkup(p.inner) : "" }));
  }
  return out.join("");
}

// Asset for the app: sections in painter order.
const lines = ["#carscope-anatomy-car 1", `#viewbox ${W} ${H}`, `#source anatomy-kit ${(() => { try { return execFileSync("git", ["-C", ANATOMY, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })()}`];
lines.push("@static", flatMarkup(HALO));
let open = "@static";
for (const it of R.items) {
  const v = variantOf(it);
  const key = v ? `@door ${v.door} ${v.variant}` : "@static";
  if (key !== open || v) {
    lines.push(key);
    open = key;
  }
  lines.push(flatMarkup(it.prims));
  if (v) lines.push(`@accent ${v.door} ${v.variant}`, it.accent);
}
const assetDir = join(REPO, "vehicle-core", "src", "main", "resources", "io", "carscope", "visualization");
mkdirSync(assetDir, { recursive: true });
writeFileSync(join(assetDir, "anatomy-car.parts"), lines.join("\n") + "\n");

// Preview pages for Anatomy's capture and line checks: every visible door combination, both themes.
const outDir = join(HERE, "build");
mkdirSync(outDir, { recursive: true });
const CAR_CSS = Object.entries(PALETTES).map(([name, pal]) => `.iso .car-${name}>.iso-fill{fill:${pal.paper}}` + (pal.shades ? pal.shades.map((c, i) => `.iso .car-${name}>.iso-shade[data-shade="${i}"]{fill:${c};stroke:${c}}`).join("") + `.iso .car-${name}>.iso-top{fill:${pal.top};stroke:${pal.top}}` : "")).join("");
for (const combo of [[], ["door-front-left"], ["door-rear-left"], ["door-front-left", "door-rear-left"]]) {
  const body = R.items.filter((it) => {
    const v = variantOf(it);
    return !v || (v.variant === "open") === combo.includes(v.door);
  }).map((it) => it.svg).join("");
  const halo = kitMarkup(HALO);
  const name = combo.length ? combo.map((d) => d.replace("door-", "")).join("+") + "-open" : "closed";
  for (const theme of ["light", "dark"]) {
    const svg = k.figureSvg({ width: W, height: H, label: `Isometric four-door sedan, ${name}`, body: halo + body });
    const plate = k.plateHtml({ fig: "Fig 1", title: "CarScope sedan", hint: "Static doors: closed or open", readout: name, keys: [], caption: "Generated with the Anatomy kit for the CarScope door view.", body: svg });
    writeFileSync(join(outDir, `car-${name}${theme === "light" ? "-light" : ""}.html`), k.pageHtml({ title: `CarScope sedan ${name}`, theme, body: `<style>${CAR_CSS}</style>${plate}`, width: 760 }));
  }
}
console.log(`asset: ${R.items.length} items, ${DOOR_SECTIONS.length} door variants -> anatomy-car.parts`);
