// CarScope sedan, built with the Anatomy kit (https://github.com/wheresryan22/anatomy, MIT) and the
// automotive extensions in ./automotive (body, greenhouse, doors, wheels, materials, camera).
//
//   node tools/anatomy-car/build.mjs [--audit] [--any-anatomy]
//
// Writes vehicle-core/src/main/resources/io/carscope/visualization/anatomy-car.parts (the app asset,
// read by VehicleSvgRenderer) and tools/anatomy-car/build/*.html (preview pages for Anatomy's
// scripts/capture.mjs and scripts/lines.mjs). The kit itself is not vendored: see automotive/anatomy.mjs.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "./automotive/model.mjs";
import { writeAsset, writePreviews } from "./automotive/asset.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const { anatomy, P, ctx, sc, halo: HALO } = await buildModel({ allowOtherRevision: process.argv.includes("--any-anatomy") });
anatomy.A.auditOrExit(sc.R, P, {});

const out = writeAsset(ctx, sc, HALO, { file: join(REPO, "vehicle-core", "src", "main", "resources", "io", "carscope", "visualization", "anatomy-car.parts"), rev: anatomy.rev });
writePreviews(ctx, sc, HALO, join(HERE, "build"));
if (process.argv.includes("--sizes")) {
  const { flatMarkup } = await import("./automotive/materials.mjs");
  for (const it of [...sc.R.items].sort((a, b) => flatMarkup(ctx, b.prims).length - flatMarkup(ctx, a.prims).length).slice(0, 12)) console.log(`  ${flatMarkup(ctx, it.prims).length}	${it.name}`);
}
console.log(`asset: ${sc.R.items.length} items, ${sc.R.solids.length} recorded solids, ${out.bytes} bytes, sha256 ${out.sha256}`);
