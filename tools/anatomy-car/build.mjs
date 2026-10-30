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
import { loadAnatomy } from "./automotive/anatomy.mjs";
import { geometry } from "./automotive/geometry.mjs";
import { camera } from "./automotive/camera.mjs";
import { scene } from "./automotive/scene.mjs";
import { buildBody } from "./automotive/body.mjs";
import { buildGreenhouse } from "./automotive/greenhouse.mjs";
import { buildWheels } from "./automotive/wheels.mjs";
import { buildDoors } from "./automotive/doors.mjs";
import { writeAsset, writePreviews } from "./automotive/asset.mjs";
import { HALF, X_REAR, X_FRONT } from "./automotive/dims.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const anatomy = await loadAnatomy({ allowOtherRevision: process.argv.includes("--any-anatomy") });
const { k, A } = anatomy;
const P = camera(k);
const ctx = { ...anatomy, P, ...geometry(anatomy, P) };
const sc = scene(ctx);

buildWheels(ctx, sc);
buildBody(ctx, sc);
buildGreenhouse(ctx, sc);
buildDoors(ctx, sc);

// The soft ground shadow is not a part: it is drawn first, outside the sorted items.
const HALO = [{ kind: "halo", d: k.haloOf({ x: X_REAR + 8, y: -HALF + 6, w: X_FRONT - X_REAR - 14, d: 2 * HALF - 12, r: 40 }, 0, 4, P) }];

sc.settle();
A.auditOrExit(sc.R, P, {});

const out = writeAsset(ctx, sc, HALO, { file: join(REPO, "vehicle-core", "src", "main", "resources", "io", "carscope", "visualization", "anatomy-car.parts"), rev: anatomy.rev });
writePreviews(ctx, sc, HALO, join(HERE, "build"));
if (process.argv.includes("--sizes")) {
  const { flatMarkup } = await import("./automotive/materials.mjs");
  for (const it of [...sc.R.items].sort((a, b) => flatMarkup(ctx, b.prims).length - flatMarkup(ctx, a.prims).length).slice(0, 12)) console.log(`  ${flatMarkup(ctx, it.prims).length}	${it.name}`);
}
console.log(`asset: ${sc.R.items.length} items, ${sc.R.solids.length} recorded solids, ${out.bytes} bytes, sha256 ${out.sha256}`);
