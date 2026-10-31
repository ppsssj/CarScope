// P3-A5.1: copies the IONIQ 5 WebGL lab page and the pinned Three.js files into the app's DEBUG-only
// assets. Output: app/src/debug/assets/ioniq5-lab/ (git-ignored, regenerate with this script).
//   npm ci --ignore-scripts --prefix tools/three-poc && node tools/three-poc/build-android-lab.mjs
// The IONIQ 5 GLB is NOT copied: it is a third-party asset pushed into app-private storage on the
// device (push-android-lab-model.mjs) and served by the debug activity at ./model.glb only.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLabHtml } from "./lab-assets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "app", "src", "debug", "assets", "ioniq5-lab");
const THREE = join(HERE, "node_modules", "three");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const { html, csp } = prepareLabHtml(readFileSync(join(HERE, "android-lab.html"), "utf8"));
writeFileSync(join(OUT, "index.html"), html);
for (const file of ["android-lab.js", "android-lab.css"]) cpSync(join(HERE, file), join(OUT, file));
const vendor = ["build/three.module.js", "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/environments/RoomEnvironment.js", "LICENSE"];
for (const file of vendor) {
  mkdirSync(dirname(join(OUT, "vendor", "three", file)), { recursive: true });
  cpSync(join(THREE, file), join(OUT, "vendor", "three", file));
}
// Same policy as the P2-A2 lab: scripts from the lab origin plus the one inline import map by hash; no network.
writeFileSync(join(OUT, "csp.txt"), csp);
console.log(`android lab assets -> ${OUT}\nCSP: ${csp}`);
