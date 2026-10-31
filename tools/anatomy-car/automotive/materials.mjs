// Materials: each palette is the kit's four facing tones plus a top tone (references/craft.md, tone
// hierarchy), so every material is lit by the same light. The app asset bakes them in as attributes.
// No red on the car body: red is reserved for the OPEN state accent.

export const LINE = { hi: "#26262a", mid: "#8a8a8f", lo: "#b4b4b8", faint: "#d4d4d6", dot: "#3a3a3e" };
export const LINE_W = 0.6;

export const PALETTES = {
  paint: { paper: "#eef1f4", shades: ["#c3cad3", "#d1d7de", "#dde2e8", "#e8ecf0"], top: "#f8fafc" },
  recess: { paper: "#e3e7ec", shades: ["#b4bcc6", "#c2c9d2", "#cfd5dc", "#dbe0e6"], top: "#eef2f6" },
  doorInner: { paper: "#5a5f67", shades: ["#43474e", "#4b5058", "#545961", "#5e636b"], top: "#6a7078" },
  glass: { paper: "#56626f", shades: ["#3f4954", "#47525e", "#505c69", "#5a6775"], top: "#6e7c8b" },
  frit: { paper: "#2f343a", shades: ["#24282d", "#2a2e34", "#30353b", "#373c42"], top: "#40464d" },
  tyre: { paper: "#2c2f33", shades: ["#1f2124", "#26292c", "#2e3135", "#363a3e"], top: "#41454a" },
  rim: { paper: "#d9dde2", shades: ["#a7aeb6", "#b7bdc4", "#c6cbd1", "#d3d7dc"], top: "#eceef1" },
  rimShadow: { paper: "#50555c", shades: ["#3c4046", "#44484e", "#4c5157", "#555a61"], top: "#5f646b" },
  brake: { paper: "#9aa0a7", shades: ["#7c828a", "#878d94", "#92989f", "#9da3aa"], top: "#aeb3b9" },
  caliper: { paper: "#4a4f56", shades: ["#363a40", "#3e4248", "#464b51", "#4f545a"], top: "#5a5f66" },
  trim: { paper: "#3b3f45", shades: ["#2b2e33", "#32363b", "#3a3e44", "#43474d"], top: "#50555c" },
  lamp: { paper: "#e9eef4", shades: ["#bcc6d1", "#c9d2db", "#d6dde5", "#e3e8ee"], top: "#f6f9fc" },
  lampSmoke: { paper: "#6b6e74", shades: ["#55585e", "#5d6066", "#65686e", "#6e7177"], top: "#7a7d83" },
  plate: { paper: "#f4f4f1", shades: ["#d8d8d4", "#e0e0dc", "#e8e8e4", "#efefeb"], top: "#ffffff" },
  amber: { paper: "#e3a64a", shades: ["#c98a2e", "#d39537", "#dc9f41", "#e6aa4c"], top: "#f0b85c" },
  interior: { paper: "#4a4e55", shades: ["#3a3e44", "#41454b", "#484c52", "#4f535a"], top: "#565a61" },
  seat: { paper: "#5b6068", shades: ["#454950", "#4d5158", "#555a61", "#5e636a"], top: "#686d75" },
  well: { paper: "#34373c" },
};

const fmt = (attrs) => Object.entries(attrs).filter(([, v]) => v !== undefined).map(([key, v]) => ` ${key}="${v}"`).join("");

/** Flat markup for the app: paths and circles only, colours as attributes, no CSS, no groups. */
export function flatMarkup(ctx, prims) {
  const { k, at } = ctx;
  const out = [];
  for (const p of prims) {
    if (p.kind === "halo") out.push(`<path${fmt({ d: p.d, fill: "#8a8a80", "fill-opacity": "0.22" })}/>`);
    else if (p.kind === "poly") out.push(`<path${fmt({ d: k.pathOf(p.points.map(at), true), fill: PALETTES[p.palette].paper, stroke: p.tone === "none" ? undefined : LINE[p.tone ?? "hi"], "stroke-width": p.tone === "none" ? undefined : LINE_W, "stroke-linejoin": "round" })}/>`);
    else if (p.kind === "line") { if (p.d) out.push(`<path${fmt({ d: p.d, fill: "none", stroke: LINE[p.tone ?? "lo"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`); }
    else if (p.kind === "dots") {
      const opacity = { hi: 0.85, mid: 0.45, lo: 0.22, faint: 0.12 }[p.tone ?? "mid"];
      for (const [x, y] of p.points) out.push(`<circle${fmt({ cx: x.toFixed(1), cy: y.toFixed(1), r: p.size ?? 0.5, fill: LINE.dot, "fill-opacity": opacity })}/>`);
    } else if (p.kind === "solid") {
      const pal = PALETTES[p.palette ?? "paint"];
      const paths = p.paths;
      if(paths.loftFaces) {
        out.push(`<path${fmt({d:paths.fill,fill:pal.paper})}/>`);
        for(const face of paths.loftFaces) out.push(`<path${fmt({d:face.d,fill:face.color})}/>`);
        out.push(`<path${fmt({d:paths.outline,fill:"none",stroke:LINE[p.tone??"hi"],"stroke-width":LINE_W})}/>`);
        continue;
      }
      const seam = (colour) => (paths.seamless ? { stroke: colour, "stroke-width": 0.4 } : {});
      out.push(`<path${fmt({ d: paths.fill, fill: pal.paper })}/>`);
      paths.shades.forEach((d, i) => { if (d) out.push(`<path${fmt({ d, fill: pal.shades[i], ...seam(pal.shades[i]) })}/>`); });
      if (paths.top) out.push(`<path${fmt({ d: paths.top, fill: pal.top, ...seam(pal.top) })}/>`);
      if ((p.crease ?? "faint") !== "none" && paths.crease) out.push(`<path${fmt({ d: paths.crease, fill: "none", stroke: LINE[p.crease ?? "faint"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`);
      if (p.inner) out.push(flatMarkup(ctx, p.inner));
      out.push(`<path${fmt({ d: paths.outline, fill: "none", stroke: LINE[p.tone ?? "hi"], "stroke-width": LINE_W, "stroke-linecap": "round", "stroke-linejoin": "round" })}/>`);
    }
  }
  return out.join("");
}

/** Kit markup (iso-solid groups and classes) for the preview pages and the Anatomy checks. */
export function kitMarkup(ctx, prims) {
  const { k, at } = ctx;
  const out = [];
  for (const p of prims) {
    if (p.kind === "halo") out.push(`<path class="iso-halo" d="${p.d}"/>`);
    else if (p.kind === "poly") {
      const d = k.pathOf(p.points.map(at), true);
      out.push(k.solidSvg({ fill: d, outline: p.tone === "none" ? "" : d, crease: "", top: "", shades: ["", "", "", ""] }, { tone: p.tone === "none" ? "hi" : p.tone ?? "hi", flat: true, className: `car-${p.palette}` }));
    } else if (p.kind === "line") out.push(k.lineSvg(p.d, { tone: p.tone, free: p.free }));
    else if (p.kind === "dots") out.push(k.dotsSvg(p.points, { size: p.size, tone: p.tone }));
    else if (p.kind === "solid") {
      if(p.paths.loftFaces) {
        out.push(`<path d="${p.paths.fill}" fill="${PALETTES[p.palette??"paint"].paper}"/>`);
        for(const face of p.paths.loftFaces) out.push(`<path d="${face.d}" fill="${face.color}"/>`);
        out.push(`<path d="${p.paths.outline}" fill="none" stroke="${LINE[p.tone??"hi"]}" stroke-width="${LINE_W}"/>`);
      } else out.push(k.solidSvg(p.paths, { tone: p.tone, crease: p.crease, className: `car-${p.palette ?? "paint"}`, inner: p.inner ? kitMarkup(ctx, p.inner) : "" }));
    }
  }
  return out.join("");
}

/** Preview CSS mapping each palette onto the kit's solid classes, both themes. */
export const CAR_CSS = Object.entries(PALETTES).map(([name, pal]) =>
  `.iso .car-${name}>.iso-fill{fill:${pal.paper}}` +
  (pal.shades ? pal.shades.map((c, i) => `.iso .car-${name}>.iso-shade[data-shade="${i}"]{fill:${c};stroke:${c}}`).join("") + `.iso .car-${name}>.iso-top{fill:${pal.top};stroke:${pal.top}}` : "")).join("");
