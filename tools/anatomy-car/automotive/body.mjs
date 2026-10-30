// The lower body: a core behind the near wheels, a middle band, and a two-layer side skin (an inner
// recessed layer and an outer panel layer) so the shoulder crease and the rocker are real steps in
// the surface. Every piece is an x-monotone region of the side profile extruded along y, and no piece
// wraps a wheel (references/craft.md, painter's order). The door apertures are cut out of the side.
import { region, polyline } from "./geometry.mjs";
import {
  HALF, INNER, SKIN_Y, CORE_Y, AXLE, WHEEL_Z, ARCH_R, FLARE_R, SILL, BELT, ROCKER_TOP, X_REAR, X_FRONT,
  top, bottom, crease, STATIONS, ARCH_SPAN, FRONT_DOOR, REAR_DOOR, B_PILLAR, apertureBottom,
} from "./dims.mjs";
import { yFrame, xFrame } from "./scene.mjs";

export function buildBody(ctx, sc) {
  const { G, A, at, path3, W3 } = ctx;
  const { item, prism, solid, line, poly, record } = sc;
  const YF = yFrame(G);
  const owner = { owner: "body" };
  const piece = (name, outline, y0, y1, palette, inner = []) => {
    const shape = record(A.prism(YF, outline, y0, y1, { name, ...owner }));
    const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length;
    const cz = outline.reduce((a, p) => a + p[1], 0) / outline.length;
    return item(name, [cx, (y0 + y1) / 2, cz], [solid(ctx.prismPaths(YF, outline, y0, y1), { palette, tone: "hi", inner })], [shape]);
  };
  const st = (extra = []) => [...STATIONS, ...extra];
  const archIn = AXLE - ARCH_R - 0.5;
  const archOut = AXLE + ARCH_R + 0.5;
  const browZ = WHEEL_Z + ARCH_R + 1;
  const [bRear, bFront] = [B_PILLAR[1], B_PILLAR[0]];
  const flat = (z) => () => z;
  const coreBottom = (x) => (Math.abs(Math.abs(x) - AXLE) < ARCH_SPAN ? SILL : bottom(x));

  // ---- lines that sit on top faces (each split at piece joints so it lands on that piece)
  const hoodTop = (x) => top(x) + 0.1;
  const hoodLine = (y, x0, x1) => path3([x0, 62, 120, 178, x1].filter((x) => x >= x0 && x <= x1).map((x) => [x, y, hoodTop(x)]));
  const across = (x, y0, y1, z = top(x) + 0.1) => line(path3([[x, y0, z], [x, y1, z]]), { tone: "faint" });
  const trunkLine = (y, x0, x1) => line(path3([x0, -170, x1].filter((x) => x >= x0 && x <= x1).map((x) => [x, y, top(x) + 0.1])), { tone: "faint" });
  const TRUNK_FRONT = -153;
  const TRUNK_REAR = -197;

  // ---- core: floor, roof sill and the far side, with the well and cabin liners on its near face
  const liner = (x0, x1, b, t) => poly(region(x0, x1, b, t, st()).map(([x, z]) => [x, CORE_Y + 0.05, z]), "interior", { tone: "lo" });
  const wellOf = (cx) => poly(region(cx - ARCH_SPAN, cx + ARCH_SPAN, flat(SILL), bottom, st()).map(([x, z]) => [x, CORE_Y + 0.05, z]), "well", { tone: "none" });
  piece("body.core", region(X_REAR, X_FRONT, coreBottom, top, st()), -HALF, CORE_Y, "paint", [
    wellOf(AXLE), wellOf(-AXLE),
    liner(FRONT_DOOR.rear, FRONT_DOOR.hinge, flat(ROCKER_TOP), flat(BELT)),
    liner(REAR_DOOR.rear, REAR_DOOR.hinge, apertureBottom, flat(BELT)),
    line(hoodLine(-(HALF - 1.2), 44, 205), { tone: "faint" }),
    across(44, -HALF, CORE_Y),
    trunkLine(-82, TRUNK_REAR, TRUNK_FRONT),
    across(TRUNK_FRONT, -82, CORE_Y), across(TRUNK_REAR + 0.5, -82, CORE_Y),
  ]);

  // ---- middle band (CORE_Y..SKIN_Y): away from the arches, above them, and around the apertures
  // Each layer stops a little shorter at the nose and the tail than the one inside it, so the
  // corners wrap round in steps instead of meeting the front face at a right angle.
  const WRAP = { band: 1.5, inner: 3.5, outer: 6 };
  piece("body.band-nose", region(archOut, X_FRONT - WRAP.band, bottom, top, st()), CORE_Y, SKIN_Y, "paint");
  piece("body.band-front-brow", region(archIn, archOut, flat(browZ), top, st()), CORE_Y, SKIN_Y, "paint");
  piece("body.band-front", region(FRONT_DOOR.hinge, archIn, flat(SILL), top, st()), CORE_Y, SKIN_Y, "paint", [across(44, CORE_Y, SKIN_Y)]);
  piece("body.band-b-pillar", region(bRear, bFront, flat(ROCKER_TOP), flat(BELT)), CORE_Y, SKIN_Y, "paint");
  piece("body.band-sill", region(-archIn, FRONT_DOOR.hinge, flat(SILL), apertureBottom, st()), CORE_Y, SKIN_Y, "paint");
  piece("body.band-rear-brow", region(-archOut, REAR_DOOR.rear, flat(browZ), top, st()), CORE_Y, SKIN_Y, "paint", [
    trunkLine(82, -archOut, TRUNK_FRONT), across(TRUNK_FRONT, CORE_Y, 82),
  ]);
  piece("body.band-tail", region(X_REAR + WRAP.band, -archOut, bottom, top, st()), CORE_Y, SKIN_Y, "paint", [
    trunkLine(82, TRUNK_REAR, -archOut), across(TRUNK_REAR + 0.5, CORE_Y, 82),
  ]);

  // ---- inner skin layer (SKIN_Y..INNER): shows as the shoulder band and the recessed rocker
  piece("body.inner-front", region(FRONT_DOOR.hinge, X_FRONT - WRAP.inner, bottom, top, st()), SKIN_Y, INNER, "recess", [
    line(hoodLine(HALF - 1.8, 44, 205), { tone: "faint" }), across(44, SKIN_Y, INNER),
  ]);
  piece("body.inner-b-pillar", region(bRear, bFront, flat(ROCKER_TOP), flat(BELT)), SKIN_Y, INNER, "recess");
  piece("body.inner-sill", region(REAR_DOOR.rear, FRONT_DOOR.hinge, bottom, apertureBottom, st()), SKIN_Y, INNER, "recess");
  piece("body.inner-rear", region(X_REAR + WRAP.inner, REAR_DOOR.rear, bottom, top, st()), SKIN_Y, INNER, "recess", [
    trunkLine(83, TRUNK_REAR, TRUNK_FRONT > REAR_DOOR.rear ? REAR_DOOR.rear : TRUNK_FRONT),
  ]);

  // ---- outer panel layer (INNER..HALF): below the shoulder crease, above the rocker between wheels
  const rockerFront = (x) => (x < AXLE ? Math.max(ROCKER_TOP, bottom(x)) : bottom(x));
  const rockerRear = (x) => (x > -AXLE ? Math.max(ROCKER_TOP, bottom(x)) : bottom(x));
  const yOut = HALF + 0.05;
  const onSide = (pts) => path3(pts.map(([x, z]) => [x, yOut, z]));
  piece("body.outer-front", region(FRONT_DOOR.hinge, X_FRONT - WRAP.outer, rockerFront, crease, st()), INNER, HALF, "paint");
  piece("body.outer-b-pillar", region(bRear, bFront, flat(ROCKER_TOP), (x) => crease(x)), INNER, HALF, "paint");
  piece("body.outer-rear", region(X_REAR + WRAP.outer, REAR_DOOR.rear, rockerRear, crease, st()), INNER, HALF, "paint", [
    // fuel filler door on the rear quarter
    line(onSide([[-172, 64], [-156, 64], [-156, 77], [-172, 77], [-172, 64]]), { tone: "mid" }),
    // wrap-around rear lamp, smoked lens (red is reserved for the OPEN state)
    poly([[-223.5, 67.5], [-214, 71], [-214, 79], [-223, 75]].map(([x, z]) => [x, yOut, z]), "lampSmoke"),
  ]);

  // ---- wheel-arch flares, standing proud of the panel
  for (const [name, cx] of [["front", AXLE], ["rear", -AXLE]]) {
    const angle = (r) => Math.asin((SILL - WHEEL_Z) / r);
    const ring = (r, from, to, n) => Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n;
      return [cx + r * Math.cos(t), WHEEL_Z + r * Math.sin(t)];
    });
    const outer = ring(FLARE_R, angle(FLARE_R), Math.PI - angle(FLARE_R), 36);
    const inner = ring(ARCH_R, Math.PI - angle(ARCH_R), angle(ARCH_R), 36);
    prism(`body.flare-${name}`, YF, [...outer, ...inner], HALF, HALF + 1.3, { palette: "paint", tone: "hi" }, { meta: owner });
  }

  // ---- front end: lamps, grille, plate and intake as thin prisms 0.05 proud of the nose facets
  const facetFrame = ([xa, za], [xb, zb]) => {
    const len = Math.hypot(xb - xa, zb - za);
    const v = [(xb - xa) / len, 0, (zb - za) / len];
    const a = [v[2], 0, -v[0]];
    return { F: { o: [xa, 0, za], u: [0, 1, 0], v, a: G.dot3(a, [1, 0, 0]) > 0 ? a : G.mul3(a, -1) }, len };
  };
  const NOSE_A = facetFrame([229, 68], [221, 78]);
  const NOSE_B = facetFrame([231.5, 56], [229, 68]);
  const NOSE_C = facetFrame([231, 44], [231.5, 56]);
  const NOSE_D = facetFrame([228, 32], [231, 44]);
  const onFacet = (facet, pts) => pts.map(([y, t]) => [y, t * facet.len]);
  const inlay = (name, facet, pts, palette, extra = []) =>
    prism(name, facet.F, onFacet(facet, pts), 0.05, 0.6, { palette, tone: "hi", crease: "none" }, { extra, meta: owner });
  const atFacet = (facet, y, t) => W3(facet.F, 0.62, [y, t * facet.len]);
  for (const side of [1, -1]) {
    const tag = side > 0 ? "left" : "right";
    // headlamp: a lens with a daytime-running strip across it, edge to edge
    inlay(`lamp.head-${tag}`, NOSE_A, [[side * 46, 0.1], [side * 85, 0.06], [side * 85, 0.74], [side * 54, 0.9]], "lamp", [
      line(path3([atFacet(NOSE_A, side * (46 + 8 * (0.62 - 0.1) / 0.8), 0.62), atFacet(NOSE_A, side * 85, 0.62)]), { tone: "mid" }),
      line(path3([atFacet(NOSE_A, side * (46 + 8 * (0.3 - 0.1) / 0.8), 0.3), atFacet(NOSE_A, side * 85, 0.3)]), { tone: "faint" }),
    ]);
    inlay(`lamp.fog-${tag}`, NOSE_D, [[side * 62, 0.32], [side * 78, 0.32], [side * 78, 0.6], [side * 62, 0.6]], "trim");
  }
  inlay("grille", NOSE_B, [[-42, 0.1], [42, 0.1], [44, 0.9], [-44, 0.9]], "trim",
    [0.3, 0.5, 0.7].map((t) => {
      const h = 42 + (2 * (t - 0.1)) / 0.8;
      return line(path3([atFacet(NOSE_B, -h, t), atFacet(NOSE_B, h, t)]), { tone: "lo" });
    }));
  inlay("plate.front", NOSE_C, [[-17, 0.15], [17, 0.15], [17, 0.8], [-17, 0.8]], "plate",
    [line(path3([atFacet(NOSE_C, -13, 0.48), atFacet(NOSE_C, 13, 0.48)]), { tone: "faint", free: true })]);
  inlay("intake", NOSE_D, [[-56, 0.08], [56, 0.08], [56, 0.24], [-56, 0.24]], "trim");
  prism("lamp.marker", YF, [[196, 66], [208, 66], [208, 69], [196, 69]], HALF + 0.05, HALF + 0.5, { palette: "amber", tone: "hi", crease: "none" }, { meta: owner });

  // ---- seats, seen through an open door: cushion and backrest against the core's near face
  const seat = (name, cushion, back) => {
    prism(`${name}.cushion`, YF, cushion, CORE_Y + 0.05, 82, { palette: "seat", tone: "hi" }, { meta: { owner: "seats" } });
    prism(`${name}.back`, YF, back, CORE_Y + 0.05, 82, { palette: "seat", tone: "hi" }, { meta: { owner: "seats" } });
  };
  // Kept inside the apertures: clear of the B-pillar and of the sill that rises round the rear arch.
  seat("seat.front", [[-14, 34], [20, 34], [22, 43], [-12, 45]], [[-25, 38], [-15, 38], [-8, 90], [-18, 92]]);
  seat("seat.rear", [[-88, 34], [-50, 34], [-48, 43], [-86, 45]], [[-101, 52], [-91, 52], [-86, 90], [-96, 92]]);

  void xFrame;
  void polyline;
  void at;
}
