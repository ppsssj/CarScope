// The scene: a kit recorder plus the drawing primitives every builder uses. Every item keeps its
// primitives so it can be emitted twice (kit preview, flat app asset) and records its true shapes.
import { kitMarkup } from "./materials.mjs";

export function scene(ctx) {
  const { A, P, prismPaths, W3 } = ctx;
  const R = A.recorder(P);
  const record = R.solid;
  const items = [];

  const solid = (paths, style = {}) => ({ kind: "solid", paths, ...style });
  const line = (d, style = {}) => ({ kind: "line", d, ...style });
  const dots = (points, style = {}) => ({ kind: "dots", points, ...style });
  const poly = (points, palette, style = {}) => ({ kind: "poly", points, palette, ...style });

  /** One drawn item: its primitives, its recorded shapes and its section (static or a door pose). */
  function item(name, ref, prims, shapes, { section = "static", bias = 0 } = {}) {
    const it = R.put({ name, at: ref, bias, svg: kitMarkup(ctx, prims), shapes, piece: "car", section, prims });
    items.push(it);
    return it;
  }

  /** A prism of `poly` in frame F from s0 to s1, recorded as its true shape. */
  function prism(name, F, poly, s0, s1, style, { meta = {}, extra = [], collect = false, ...opts } = {}) {
    const shape = record(A.prism(F, poly, s0, s1, { name, ...meta }));
    const prims = [solid(prismPaths(F, poly, s0, s1), style), ...extra];
    if (collect) return { prims, shape };
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    return item(name, opts.ref ?? W3(F, (s0 + s1) / 2, [cx, cy]), prims, [shape], opts);
  }

  const variantOf = (it) => (typeof it.section === "object" ? it.section : null);
  /** Both poses of a door are recorded; they are never drawn together, so they are never compared. */
  const skip = (a, b) => {
    const va = variantOf(a);
    const vb = variantOf(b);
    return Boolean(va && vb && va.door === vb.door) || A.sameRun(a, b);
  };
  function settle() {
    A.settle(R, P, { skip });
    R.items.sort((a, b) => a.key - b.key);
  }

  return { R, record, items, item, prism, solid, line, dots, poly, variantOf, settle };
}

/** Frames: a prism along +y with its polygon in (x, z); along +x with its polygon in (y, z). */
export const yFrame = (G, y = 0) => G.frameOf([0, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
export const xFrame = (G, x = 0) => G.frameOf([x, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
