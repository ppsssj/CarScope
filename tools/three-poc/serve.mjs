// Local static server for the PoC: serves this folder, the pinned three.js from node_modules under
// ./vendor/three/, and car.glb from the geometry export. Binds to 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  ["/loft/", join(HERE, "..", "anatomy-car", "build", "loft")],
  ["/envelope.glb", join(HERE, "..", "anatomy-car", "build", "envelope", "car.glb")],
  ["/envelope/", join(HERE, "..", "anatomy-car", "build", "envelope")],
  ["/vendor/three/", join(HERE, "node_modules", "three")],
  ["/car.glb", join(HERE, "..", "anatomy-car", "build", "geometry", "car.glb")],
  ["/", HERE],
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json" };
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
