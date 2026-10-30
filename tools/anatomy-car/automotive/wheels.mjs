// A road wheel: a tyre with rounded shoulders (an annulus, so the rim sits in its hole), a barrel and
// lip, five spokes with real gaps, and behind them the brake disc and caliper. A hub carrier joins
// the wheel to the body core, which is what holds the body up for the kit's support check.
import { HALF, CORE_Y, WHEEL_Z, TYRE_R, AXLE } from "./dims.mjs";

export function buildWheels(ctx, sc) {
  const { G, A, P } = ctx;
  const { item, solid, line, dots, record } = sc;
  const WIDTH = 22;
  const BEAD = 21.2; // tyre inner radius at the rim seat
  const STEPS = 48; // facets round the tyre and rim edges: ~3 px each at this scale
  const HIDDEN = 32; // discs mostly seen through the spokes need fewer

  function wheel(name, x) {
    const y0 = CORE_Y + 1; // inner face of the tyre, 1 clear of the core
    const F = G.frameOf([x, y0, WHEEL_Z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    const meta = (part, more = {}) => ({ name: `${name}.${part}`, owner: name, ...more });
    const shapes = [];
    const prims = [];
    // tyre: a closed meridian (section) turned round the axle
    const section = [
      [0, BEAD], [0.3, 25.5, 1], [1.4, 29.8, 1], [3.6, 32.1, 1], [6, TYRE_R, 1], [WIDTH - 6, TYRE_R, 1], [WIDTH - 3.6, 32.1, 1],
      [WIDTH - 1.4, 29.8, 1], [WIDTH - 0.3, 25.5, 1], [WIDTH, BEAD], [WIDTH - 0.4, BEAD], [0.4, BEAD],
    ];
    prims.push(solid(G.lathe(section, F, P, { steps: STEPS }), { palette: "tyre", tone: "hi", crease: "none" }));
    shapes.push(record(A.lathe(F, section, meta("tyre", { ground: true }))));
    // the dark inside of the rim barrel, seen between the spokes
    prims.push(solid(G.disc(6, 6.6, BEAD - 0.4, F, P, { steps: HIDDEN }), { palette: "rimShadow", tone: "lo", crease: "none" }));
    shapes.push(record(A.disc(F, 6, 6.6, BEAD - 0.4, meta("barrel-back"))));
    // brake disc and caliper (the caliper sits above and behind the axle)
    prims.push(solid(G.disc(8, 9.4, 15.5, F, P, { steps: HIDDEN }), { palette: "brake", tone: "mid" }));
    prims.push(line(G.arcOf(F, 9.4, 9.5, P, { least: -1 }), { tone: "mid" }));
    shapes.push(record(A.disc(F, 8, 9.4, 15.5, meta("brake-disc"))));
    const caliperArc = (r) => Array.from({ length: 7 }, (_, i) => {
      const t = Math.PI * (0.58 + 0.24 * (i / 6));
      return [r * Math.cos(t), r * Math.sin(t)];
    });
    const caliper = [...caliperArc(18.4), ...caliperArc(11.6).reverse()];
    prims.push(solid(ctx.prismPaths(F, caliper, 9.45, 14.5), { palette: "caliper", tone: "hi" })); // concave: the kit prism is convex-only
    shapes.push(record(A.prism(F, caliper, 9.45, 14.5, meta("caliper"))));
    // barrel: only its visible facets are filled, so the hub and spokes show through its middle
    prims.push(solid(G.ringBand(6.6, 20.4, 19.4, BEAD - 0.4, F, P, { fill: "facets", steps: STEPS }), { palette: "rimShadow", tone: "hi" }));
    shapes.push(record(A.ring(F, 6.6, 20.4, 19.4, BEAD - 0.4, meta("barrel"))));
    // hub and the five spokes, each a tapered bar from the hub to the barrel
    prims.push(solid(G.disc(6.6, 19.6, 6.2, F, P, { steps: HIDDEN }), { palette: "rim", tone: "hi" }));
    shapes.push(record(A.disc(F, 6.6, 19.6, 6.2, meta("hub"))));
    for (let i = 0; i < 5; i++) {
      const t = (2 * Math.PI * i) / 5 + 0.3;
      const c = [Math.cos(t), Math.sin(t)];
      const n = [-c[1], c[0]];
      const pt = (r, w) => [c[0] * r + n[0] * w, c[1] * r + n[1] * w];
      const spoke = [pt(5.6, -2.6), pt(19.4, -1.7), pt(19.4, 1.7), pt(5.6, 2.6)];
      prims.push(solid(G.prismOf(F, spoke, 17.8, 19.6, P), { palette: "rim", tone: "hi", crease: "faint" }));
      shapes.push(record(A.prism(F, spoke, 17.8, 19.6, meta(`spoke-${i}`))));
    }
    // the polished lip that the tyre bead seats on
    prims.push(solid(G.ringBand(20.4, 21.4, 19.4, BEAD + 0.6, F, P, { fill: "facets", steps: STEPS }), { palette: "rim", tone: "hi" }));
    shapes.push(record(A.ring(F, 20.4, 21.4, 19.4, BEAD + 0.6, meta("lip"))));
    // centre cap and the five wheel nuts on the hub face
    prims.push(solid(G.disc(19.6, 20.6, 3.2, F, P, { steps: 24 }), { palette: "trim", tone: "hi" }));
    shapes.push(record(A.disc(F, 19.6, 20.6, 3.2, meta("cap"))));
    prims.push(dots(G.dotsOf(F, 19.6, 4.6, 5, P, { all: true, phase: 0.3 + Math.PI / 5 }), { size: 0.6, tone: "hi" }));
    // hub carrier: the hidden link from the hub to the core
    shapes.push(record(A.disc(F, -0.95, 6.6, 5.5, meta("hub-carrier"))));
    item(name, [x, y0 + 11, WHEEL_Z], prims, shapes);
  }
  wheel("wheel.rear-left", -AXLE);
  wheel("wheel.front-left", AXLE);
  void HALF;
}
