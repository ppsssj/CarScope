// Copies the PoC into the app's debug-only assets for the WebGL lab screen (P2-A2 experiment).
// Output: app/src/debug/assets/webgl-lab/ (git-ignored, regenerate with this script).
//   node tools/three-poc/build-lab.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLabHtml } from "./lab-assets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(REPO, "app", "src", "debug", "assets", "webgl-lab");
const THREE = join(HERE, "node_modules", "three");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const { html, csp } = prepareLabHtml(readFileSync(join(HERE, "index.html"), "utf8"));
writeFileSync(join(OUT, "index.html"), html);
cpSync(join(HERE, "main.js"), join(OUT, "main.js"));
cpSync(join(REPO, "tools", "anatomy-car", "build", "geometry", "car.glb"), join(OUT, "car.glb"));
for (const file of ["build/three.module.js", "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/helpers/VertexNormalsHelper.js", "LICENSE"]) {
  mkdirSync(dirname(join(OUT, "vendor", "three", file)), { recursive: true });
  cpSync(join(THREE, file), join(OUT, "vendor", "three", file));
}
// CSP: scripts only from the lab origin, plus the one inline import map by hash. No eval, no network.
writeFileSync(join(OUT, "csp.txt"), csp);
console.log(`lab assets -> ${OUT}\nCSP: ${csp}`);
