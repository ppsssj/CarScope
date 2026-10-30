// Doors: one solid object per door with real depth (inner structure, recessed layer, outer skin),
// a window frame that leans with the greenhouse, recessed glass, handle and (front) mirror. A door
// turns about the vertical axis through its outer front corner, so it swings clear of the fender; the
// open pose adds the hinge knuckles and the dark cabin seen through the window opening.
import { region } from "./geometry.mjs";
import { HALF, BELT, GH, SHUT_GAP, DOOR_DEPTH, crease, apertureBottom, STATIONS, FRONT_DOOR, REAR_DOOR } from "./dims.mjs";
import { sideFrame, tOf } from "./greenhouse.mjs";

/** Inset a convex polygon (x, z) by d on every edge. */
function insetConvex(poly, d) {
  const n = poly.length;
  const area = poly.reduce((a, [x, y], i) => a + x * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * y, 0);
  const sign = area > 0 ? 1 : -1;
  const lines = poly.map(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / len) * sign;
    const ny = ((x1 - x0) / len) * sign;
    return { p: [x0 + nx * d, y0 + ny * d], d: [(x1 - x0) / len, (y1 - y0) / len] };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n];
    const det = m.d[0] * l.d[1] - m.d[1] * l.d[0];
    const t = ((l.p[0] - m.p[0]) * l.d[1] - (l.p[1] - m.p[1]) * l.d[0]) / det;
    return [m.p[0] + m.d[0] * t, m.p[1] + m.d[1] * t];
  });
}

const WINDOWS = {
  [FRONT_DOOR.id]: {
    outline: [[FRONT_DOOR.hinge - SHUT_GAP, BELT], [-3.5, GH.edgeZ], [FRONT_DOOR.rear + SHUT_GAP, GH.edgeZ], [FRONT_DOOR.rear + SHUT_GAP, BELT]],
    black: [false, false, true, true], // A edge, top, B-pillar edge, belt moulding
  },
  [REAR_DOOR.id]: {
    outline: [[REAR_DOOR.hinge - SHUT_GAP, BELT], [REAR_DOOR.hinge - SHUT_GAP, GH.edgeZ], [-91, GH.edgeZ], [REAR_DOOR.rear + SHUT_GAP, 117], [REAR_DOOR.rear + SHUT_GAP, BELT]],
    black: [true, false, false, false, true],
  },
};

export function buildDoors(ctx, sc) {
  const { G, A, P, k, at, path3, W3, prismPaths, tilted } = ctx;
  const { item, solid, line, record } = sc;
  const sections = [];

  function door(def, variant) {
    const angle = variant === "open" ? (def.open * Math.PI) / 180 : 0;
    const F = { o: [def.hinge, HALF + 0.05, 0], u: [-Math.cos(angle), Math.sin(angle), 0], v: [0, 0, 1], a: [Math.sin(angle), Math.cos(angle), 0] };
    const toU = ([x, z]) => [def.hinge - x, z];
    const name = `${def.id}.${variant}`;
    const prims = [];
    const shapes = [];
    const part = (label, frame, poly, s0, s1, style) => {
      prims.push(solid(prismPaths(frame, poly, s0, s1), style));
      shapes.push(record(A.prism(frame, poly, s0, s1, { name: `${name}.${label}`, owner: def.id })));
    };
    const x0 = def.rear + SHUT_GAP;
    const x1 = def.hinge - SHUT_GAP;
    const bottom = (x) => apertureBottom(x) + SHUT_GAP;
    const full = region(x0, x1, bottom, () => BELT, STATIONS).map(toU);
    const skin = region(x0, x1, bottom, crease, STATIONS).map(toU);

    if (variant === "open") {
      // the cabin seen through the empty window opening on the greenhouse side
      const GF = sideFrame(G);
      prims.push({ kind: "poly", points: WINDOWS[def.id].outline.map(([x, z]) => W3(GF, 0.03, [x, tOf(z)])), palette: "interior", tone: "lo" });
    }
    // lower door: inner structure, recessed layer (shows above the shoulder crease), outer skin
    // The inner structure only shows when the door is open; closed, it would sit under the greenhouse.
    if (variant === "open") part("inner", F, full, -DOOR_DEPTH, -2.4, { palette: "doorInner", tone: "hi" });
    part("recess", F, full, -2.4, -1.2, { palette: "recess", tone: "hi" });
    const handle = [[def.hinge - def.rear - 19, 79.5], [def.hinge - def.rear - 7, 79.5], [def.hinge - def.rear - 7, 82], [def.hinge - def.rear - 19, 82]];
    prims.push(solid(prismPaths(F, skin, -1.2, 0), { palette: "paint", tone: "hi" }));
    shapes.push(record(A.prism(F, skin, -1.2, 0, { name: `${name}.skin`, owner: def.id })));
    part("handle", F, handle, 0, 0.7, { palette: "trim", tone: "hi", crease: "none" });

    // window frame and glass on a frame that leans with the greenhouse side
    const TF = tilted(F, W3(F, GH.baseHalf - HALF - 0.05 + 0.05, [0, BELT]), GH.lean);
    const win = WINDOWS[def.id];
    const outer = win.outline;
    const glass = insetConvex(outer, 3.2);
    const onTF = (pts) => pts.map(([x, z]) => [def.hinge - x, tOf(z)]);
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length];
      const strip = onTF([p, q, glass[(i + 1) % outer.length], glass[i]]);
      part(`frame-${i}`, TF, strip, 0, 1.0, { palette: win.black[i] ? "trim" : "paint", tone: "hi", crease: "none" });
    });
    part("glass", TF, onTF(glass), 0, 0.55, { palette: "glass", tone: "hi", crease: "none" });

    if (def.mirror) {
      part("mirror-arm", TF, [[5, 0.6], [10, 0.6], [10, 2.2], [5, 2.2]], 1.0, 4.6, { palette: "trim", tone: "hi", crease: "none" });
      part("mirror", TF, [[2.5, 1.2], [14.5, 1.2], [13.5, 10.5], [4, 11]], 4.6, 12.5, { palette: "paint", tone: "hi" });
    }
    if (variant === "open") {
      // hinge knuckles on the fixed axis just inboard of the door's front corner
      const hx = def.hinge - 0.95;
      const hy = HALF + 0.6;
      for (const [z0, z1] of [[44, 52], [72, 80]]) {
        prims.push(solid(k.cylinder(hx, hy, 0.85, z0, z1 - z0, P, 16), { palette: "trim", tone: "hi" }));
        shapes.push(record(A.cylinder(hx, hy, 0.85, z0, z1 - z0, { name: `${name}.hinge-${z0}`, owner: def.id })));
      }
    }
    const it = item(name, W3(F, -DOOR_DEPTH / 2, [(def.hinge - def.rear) / 2, 70]), prims, shapes, { section: { door: def.id, variant } });
    it.accent = k.pathOf(skin.map(([u, z]) => at(W3(F, 0.02, [u, z]))), true);
    sections.push(it);
  }
  for (const variant of ["closed", "open"]) {
    door(REAR_DOOR, variant);
    door(FRONT_DOOR, variant);
  }
  void line;
  void path3;
  return sections;
}
