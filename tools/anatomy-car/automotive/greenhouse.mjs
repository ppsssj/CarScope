// The greenhouse: one convex polyhedron whose sides lean in (tumblehome), with a crowned roof, a
// recessed windshield in a dark frit border, wipers, roof mouldings, a quarter light and a black
// B-pillar applique. The kit's audit has no general polyhedron shape, so the greenhouse is recorded
// as a staircase of y-prisms that lies inside it: never larger than what is drawn.
import { HALF, BELT, GH, aLine, cLine, ghHalf, B_PILLAR } from "./dims.mjs";
import { yFrame } from "./scene.mjs";

/** The greenhouse side plane on the near side: polygon (x, t), t measured up the leaning face. */
export function sideFrame(G) {
  const c = Math.cos(GH.lean);
  const s = Math.sin(GH.lean);
  return { o: [0, GH.baseHalf, BELT], u: [1, 0, 0], v: G.unit3([0, -s, c]), a: G.unit3([0, c, s]) };
}
export const tOf = (z) => (z - BELT) / Math.cos(GH.lean);

export function buildGreenhouse(ctx, sc) {
  const { G, A, path3, convexPaths, prismPaths } = ctx;
  const { item, prism, solid, line, dots, poly, record } = sc;
  const V = [
    [GH.aBase, GH.baseHalf, BELT], [GH.aBase, -GH.baseHalf, BELT], [GH.cBase, -GH.baseHalf, BELT], [GH.cBase, GH.baseHalf, BELT],
    [GH.aTop, GH.roofHalf, GH.edgeZ], [GH.aTop, -GH.roofHalf, GH.edgeZ], [GH.cTop, -GH.roofHalf, GH.edgeZ], [GH.cTop, GH.roofHalf, GH.edgeZ],
    [GH.ridgeFront[0], 0, GH.ridgeFront[1]], [GH.ridgeRear[0], 0, GH.ridgeRear[1]],
  ];
  const FACES = [[0, 3, 2, 1], [0, 1, 5, 4], [4, 5, 8], [3, 0, 4, 7], [1, 2, 6, 5], [2, 3, 7, 6], [6, 7, 9], [4, 8, 9], [4, 9, 7], [5, 6, 9], [5, 9, 8]];
  const lift = (p, n, d) => G.add3(p, G.mul3(n, d));
  const lerp3 = (a, b, t) => G.add3(a, G.mul3(G.sub3(b, a), t));

  // windshield: frit border and the recessed glass, both a hair proud of the face
  const wsNormal = G.unit3(G.cross3(G.sub3(V[4], V[0]), G.sub3(V[1], V[0])));
  const ws = (inset, bottomInset) => {
    const across = (a, b, t) => lerp3(a, b, t);
    const bl = across(V[0], V[1], inset / (2 * GH.baseHalf));
    const br = across(V[1], V[0], inset / (2 * GH.baseHalf));
    const tl = across(V[4], V[5], inset / (2 * GH.roofHalf));
    const tr = across(V[5], V[4], inset / (2 * GH.roofHalf));
    const up = (a, b, t) => lerp3(a, b, t);
    return [up(bl, tl, bottomInset), up(br, tr, bottomInset), up(tr, br, inset / 46), up(tl, bl, inset / 46)];
  };
  const n = G.dot3(wsNormal, [1, 0, 0]) > 0 ? wsNormal : G.mul3(wsNormal, -1);
  const frit = ws(1.2, 0.02).map((p) => lift(p, n, 0.12));
  const glass = ws(5, 0.08).map((p) => lift(p, n, 0.18));
  const streak = [lerp3(glass[0], glass[1], 0.22), lerp3(glass[3], glass[2], 0.12)];
  const wipers = [0.3, 0.72].flatMap((t) => {
    const pivot = lift(lerp3(V[0], V[1], t), n, 0.3);
    const tip = lift(lerp3(lerp3(V[0], V[1], t - 0.2), lerp3(V[4], V[5], t - 0.2), 0.16), n, 0.3);
    return [line(path3([pivot, tip]), { tone: "hi", free: "end" }), dots([ctx.at(pivot)], { size: 1.1, tone: "hi" })];
  });
  // roof ditch mouldings along both roof edges
  const moulding = (edgeA, edgeB, ridgeA, ridgeB) => {
    const qa = lerp3(V[edgeA], V[ridgeA], 2.6 / G.len3(G.sub3(V[ridgeA], V[edgeA])));
    const qb = lerp3(V[edgeB], V[ridgeB], 2.6 / G.len3(G.sub3(V[ridgeB], V[edgeB])));
    return poly([V[edgeA], V[edgeB], qb, qa].map((p) => G.add3(p, [0, 0, 0.08])), "trim");
  };
  // staircase of y-prisms inside the greenhouse, for the audit
  const YF = yFrame(G);
  const levels = [BELT, 104.5, 114, 123.5, 133, GH.edgeZ];
  const shapes = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const z1 = levels[i + 1];
    const h = ghHalf(z1);
    shapes.push(record(A.prism(YF, [[cLine(z1), levels[i]], [aLine(z1), levels[i]], [aLine(z1), z1], [cLine(z1), z1]], -h, h, { name: `greenhouse.step-${i}`, owner: "body" })));
  }
  shapes.push(record(A.prism(YF, [[-86, GH.edgeZ], [-8, GH.edgeZ], [-8, 142.6], [-86, 142.6]], -40, 40, { name: "greenhouse.roof-1", owner: "body" })));
  shapes.push(record(A.prism(YF, [[-86, 142.6], [-8, 142.6], [-8, 143.9], [-86, 143.9]], -2.8, 2.8, { name: "greenhouse.roof-2", owner: "body" })));
  item("greenhouse", [-50, 0, 120], [
    solid(convexPaths(V, FACES), { palette: "paint", tone: "hi" }),
    poly(frit, "frit", { tone: "hi" }),
    poly(glass, "glass", { tone: "mid" }),
    line(path3(streak), { tone: "faint" }),
    ...wipers,
    moulding(4, 7, 8, 9),
    moulding(5, 6, 8, 9),
  ], shapes);

  // near side: quarter light behind the rear door and the black B-pillar applique between the doors
  const GF = sideFrame(G);
  const onSide = (pts) => pts.map(([x, z]) => [x, tOf(z)]);
  prism("glass.quarter-frame", GF, onSide([[-108.3, 96.8], [-108.3, 114.6], [-129.5, 96.8]]), 0.05, 0.6, { palette: "trim", tone: "hi", crease: "none" }, { meta: { owner: "body" } });
  prism("glass.quarter", GF, onSide([[-110, 98.6], [-110, 110.5], [-123.8, 98.6]]), 0.6, 0.85, { palette: "glass", tone: "hi", crease: "none" }, { meta: { owner: "body" } });
  prism("trim.b-pillar", GF, onSide([[B_PILLAR[1] - 0.45, 95.2], [B_PILLAR[0] + 0.45, 95.2], [B_PILLAR[0] + 0.45, GH.edgeZ - 0.2], [B_PILLAR[1] - 0.45, GH.edgeZ - 0.2]]), 0.05, 0.55, { palette: "trim", tone: "hi", crease: "none" }, { meta: { owner: "body" } });

  // shark-fin antenna on the ridge
  const ridgeZ = (x) => GH.ridgeRear[1] + ((GH.ridgeFront[1] - GH.ridgeRear[1]) * (x - GH.ridgeRear[0])) / (GH.ridgeFront[0] - GH.ridgeRear[0]);
  prism("roof.antenna", YF, [[-84, 143.95], [-70, 143.95], [-75, ridgeZ(-75) + 5.4], [-81, ridgeZ(-81) + 5.8]], -2.4, 2.4, { palette: "trim", tone: "hi" }, { meta: { owner: "body" } });

  void HALF;
  void prismPaths;
}
