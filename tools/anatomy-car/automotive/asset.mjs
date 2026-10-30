// Output: the flattened app asset (painter-ordered sections) and kit-styled preview pages.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flatMarkup, kitMarkup, CAR_CSS } from "./materials.mjs";
import { VIEW, svgScreenMarkup, svgScreenPath } from "./camera.mjs";

export function writeAsset(ctx, sc, halo, { file, rev }) {
  const lines = ["#carscope-anatomy-car 1", `#viewbox ${VIEW.width} ${VIEW.height}`, `#source anatomy-kit ${rev}`, "@static", svgScreenMarkup(flatMarkup(ctx, halo))];
  let open = "@static";
  for (const it of sc.R.items) {
    const v = sc.variantOf(it);
    const key = v ? `@door ${v.door} ${v.variant}` : "@static";
    if (key !== open || v) {
      lines.push(key);
      open = key;
    }
    lines.push(svgScreenMarkup(flatMarkup(ctx, it.prims)));
    if (v) lines.push(`@accent ${v.door} ${v.variant}`, svgScreenPath(it.accent));
  }
  const text = lines.join("\n") + "\n";
  writeFileSync(file, text);
  return { bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
}

export const COMBOS = [[], ["door-front-left"], ["door-rear-left"], ["door-front-left", "door-rear-left"]];
export const comboName = (combo) => (combo.length ? combo.map((d) => d.replace("door-", "")).join("+") + "-open" : "closed");

export function writePreviews(ctx, sc, halo, dir) {
  const { k } = ctx;
  mkdirSync(dir, { recursive: true });
  for (const combo of COMBOS) {
    const body = sc.R.items.filter((it) => {
      const v = sc.variantOf(it);
      return !v || (v.variant === "open") === combo.includes(v.door);
    }).map((it) => it.svg).join("");
    const name = comboName(combo);
    for (const theme of ["light", "dark"]) {
      const svg = k.figureSvg({ width: VIEW.width, height: VIEW.height, label: `Isometric four-door sedan, ${name}`, body: svgScreenMarkup(kitMarkup(ctx, halo) + body) });
      const plate = k.plateHtml({ fig: "Fig 1", title: "CarScope sedan", hint: "Static doors: closed or open", readout: name, keys: [], caption: "Generated with the Anatomy kit for the CarScope door view.", body: svg });
      writeFileSync(join(dir, `car-${name}${theme === "light" ? "-light" : ""}.html`), k.pageHtml({ title: `CarScope sedan ${name}`, theme, body: `<style>${CAR_CSS}</style>${plate}`, width: 760 }));
    }
  }
}
