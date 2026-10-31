// Builds the whole car once: the shared entry for the SVG build and the 3D geometry exporter.
import { loadAnatomy } from "./anatomy.mjs";
import { geometry } from "./geometry.mjs";
import { camera } from "./camera.mjs";
import { scene } from "./scene.mjs";
import { buildBody } from "./body.mjs";
import { buildGreenhouse } from "./greenhouse.mjs";
import { buildWheels } from "./wheels.mjs";
import { buildDoors } from "./doors.mjs";
import { HALF, X_REAR, X_FRONT } from "./dims.mjs";

export async function buildModel({ allowOtherRevision = false, projection } = {}) {
  const anatomy = await loadAnatomy({ allowOtherRevision });
  const P = projection ?? camera(anatomy.k);
  const ctx = { ...anatomy, P, ...geometry(anatomy, P) };
  const sc = scene(ctx);
  buildWheels(ctx, sc);
  buildBody(ctx, sc);
  buildGreenhouse(ctx, sc);
  buildDoors(ctx, sc);
  // The soft ground shadow is not a part: it is drawn first, outside the sorted items.
  const halo = [{ kind: "halo", d: anatomy.k.haloOf({ x: X_REAR + 8, y: -HALF + 6, w: X_FRONT - X_REAR - 14, d: 2 * HALF - 12, r: 40 }, 0, 4, P) }];
  sc.settle();
  return { anatomy, P, ctx, sc, halo };
}
