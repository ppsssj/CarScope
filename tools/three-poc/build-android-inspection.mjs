// P3-A5.2: packages the P3-A4 inspection page for the DEBUG-only Android screen (InspectionActivity).
// Output: app/src/debug/assets/inspection/ (git-ignored, regenerate with this script).
//   npm ci --ignore-scripts --prefix tools/three-poc
//   $env:CARSCOPE_QR_AR_BASE_URL = 'https://<qr-ar origin>/'   # optional; without it the QR step shows "not configured"
//   node tools/three-poc/build-android-inspection.mjs
// The page and its modules are copied unchanged; the only addition is android-inspect-shell.js. The IONIQ 5 GLB is
// NOT copied: the activity serves it from app-private storage (push-android-lab-model.mjs) at ./external/ioniq5.glb.
// The QR target uses the same validation and contract as serve.mjs (inspection-handoff.mjs -> #v=1&task=washer-fluid).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { prepareLabHtml } from "./lab-assets.mjs";
import { handoffTarget } from "./inspection-handoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_SRC = join(HERE, "..", "ioniq5-asset");
const OUT = join(HERE, "..", "..", "app", "src", "debug", "assets", "inspection");
const THREE = join(HERE, "node_modules", "three");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Page: the P3-A4 document plus one script tag for the Android shell.
const source = readFileSync(join(HERE, "inspect.html"), "utf8");
const tag = '<script type="module" src="./inspect.js"></script>';
if (!source.includes(tag)) throw new Error("inspect.html: page script tag not found");
const { html, csp } = prepareLabHtml(source.replace(tag, `${tag}\n<script type="module" src="./android-inspect-shell.js"></script>`));
writeFileSync(join(OUT, "index.html"), html);
for (const file of ["inspect.js", "inspection-flow.mjs", "inspection-camera.mjs", "inspection-tires.mjs", "tire-targets.mjs", "android-inspect-shell.js"]) cpSync(join(HERE, file), join(OUT, file));

// Geometry modules the page imports, followed transitively (layout + builders only: no model-derived data).
const modules = new Set();
const relImports = (text) => [...text.matchAll(/^import[^;]*?from\s+["']\.\/([\w.-]+\.mjs)["']/gm)].map((m) => m[1]);
const pending = [...readFileSync(join(HERE, "inspect.js"), "utf8").matchAll(/from\s+"\.\/ioniq5-asset\/([\w.-]+\.mjs)"/g)].map((m) => m[1]);
while (pending.length) {
  const name = pending.pop();
  if (modules.has(name)) continue;
  modules.add(name);
  pending.push(...relImports(readFileSync(join(ASSET_SRC, name), "utf8")));
}
mkdirSync(join(OUT, "ioniq5-asset"), { recursive: true });
for (const name of modules) cpSync(join(ASSET_SRC, name), join(OUT, "ioniq5-asset", name));

const vendor = ["build/three.module.js", "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/environments/RoomEnvironment.js", "LICENSE"];
for (const file of vendor) {
  mkdirSync(dirname(join(OUT, "vendor", "three", file)), { recursive: true });
  cpSync(join(THREE, file), join(OUT, "vendor", "three", file));
}

// QR handoff: same contract and validation as the browser server; the origin is configuration, never a constant.
const handoff = handoffTarget(process.env.CARSCOPE_QR_AR_BASE_URL);
writeFileSync(join(OUT, "inspection-handoff.json"), JSON.stringify({ configured: handoff.configured, url: handoff.url, reason: handoff.reason }));
if (handoff.configured) writeFileSync(join(OUT, "inspection-qr.svg"), await QRCode.toString(handoff.url, { type: "svg", margin: 2, errorCorrectionLevel: "M" }));
writeFileSync(join(OUT, "csp.txt"), csp);
console.log(`android inspection assets -> ${OUT}\nmodules: ${[...modules].sort().join(", ")}\nhandoff: ${handoff.configured ? handoff.url : `not configured (${handoff.reason})`}\nCSP: ${csp}`);
