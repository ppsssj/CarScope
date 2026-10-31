// Local static server for the PoC: serves this folder, the pinned three.js from node_modules under
// ./vendor/three/, and car.glb from the geometry export. Binds to 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  ["/fender/", join(HERE, "..", "anatomy-car", "build", "fender")],
  ["/loft/", join(HERE, "..", "anatomy-car", "build", "loft")],
  ["/envelope.glb", join(HERE, "..", "anatomy-car", "build", "envelope", "car.glb")],
  ["/envelope/", join(HERE, "..", "anatomy-car", "build", "envelope")],
  ["/vendor/three/", join(HERE, "node_modules", "three")],
  ["/car.glb", join(HERE, "..", "anatomy-car", "build", "geometry", "car.glb")],
  // P2-A6: the converted third-party IONIQ 5 GLB lives outside the repo; served only when configured.
  ["/ioniq5-asset/parts.mjs", join(HERE, "..", "ioniq5-asset", "parts.mjs")],
  ...(process.env.CARSCOPE_IONIQ5_GLB ? [["/external/ioniq5.glb", resolve(process.env.CARSCOPE_IONIQ5_GLB)]] : []),
  // P2-A7: model-derived SVG output, also outside the repo.
  ...(process.env.CARSCOPE_IONIQ5_SVG_DIR ? [["/external/ioniq5-svg/", resolve(process.env.CARSCOPE_IONIQ5_SVG_DIR)]] : []),
  // P3-A1: hood modules shared with the Node report, and its output folder (outside the repo).
  ["/ioniq5-asset/hood.mjs", join(HERE, "..", "ioniq5-asset", "hood.mjs")],
  ["/ioniq5-asset/collision.mjs", join(HERE, "..", "ioniq5-asset", "collision.mjs")],
  // P3-A2.1: front compartment shell modules (layout + builder, no model-derived data).
  ["/ioniq5-asset/front-compartment.mjs", join(HERE, "..", "ioniq5-asset", "front-compartment.mjs")],
  ["/ioniq5-asset/front-compartment-layout.mjs", join(HERE, "..", "ioniq5-asset", "front-compartment-layout.mjs")],
  ["/ioniq5-asset/frunk.mjs", join(HERE, "..", "ioniq5-asset", "frunk.mjs")],
  ["/ioniq5-asset/service-components.mjs", join(HERE, "..", "ioniq5-asset", "service-components.mjs")],
  ...(process.env.CARSCOPE_P3A23_DIR ? [["/external/p3-a2-3/", resolve(process.env.CARSCOPE_P3A23_DIR)]] : []),
  ...(process.env.CARSCOPE_P3A22_DIR ? [["/external/p3-a2-2/", resolve(process.env.CARSCOPE_P3A22_DIR)]] : []),
  ...(process.env.CARSCOPE_P3A1_DIR ? [["/external/p3-a1/", resolve(process.env.CARSCOPE_P3A1_DIR)]] : []),
  ...(process.env.CARSCOPE_P3A21_DIR ? [["/external/p3-a2-1/", resolve(process.env.CARSCOPE_P3A21_DIR)]] : []),
  ["/", HERE],
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT ?? 8095);
createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  for (const [prefix, dir] of ROOTS) {
    if (!url.startsWith(prefix)) continue;
    const rest = prefix.endsWith("/") ? url.slice(prefix.length) : "";
    const file = normalize(join(dir, rest || (prefix === "/" ? "index.html" : "")));
    if (!file.startsWith(normalize(dir))) break;
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      return res.end(body);
    } catch {
      break;
    }
  }
  res.writeHead(404);
  res.end("not found");
}).listen(port, "127.0.0.1", () => console.log(`PoC on http://127.0.0.1:${port}/`));
