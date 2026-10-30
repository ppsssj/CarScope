// Generation only: verify.mjs is the mandatory, separate failing validation gate.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../automotive/model.mjs";
import { generateGeometry } from "./generate.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "geometry");
const { glb, ir, report } = generateGeometry(await buildModel());
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "car.glb"), glb);
writeFileSync(join(out, "ir.json"), JSON.stringify(ir));
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`Generated ${report.parts} parts / ${report.triangles} triangles; run geometry-export/verify.mjs before accepting.`);
