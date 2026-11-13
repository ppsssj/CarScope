// Local static server for the PoC: serves this folder, the pinned three.js from node_modules under
// ./vendor/three/, and car.glb from the geometry export. Binds to 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { handoffTarget } from "./inspection-handoff.mjs";

// Reviewed inspection runtime only when mounted on an authenticated origin.
const PUBLIC_PATHS = new Set([
  '/inspect.js',
  '/inspection-flow.mjs',
  '/inspection-product.mjs',
  '/inspection-state-map.mjs',
  '/inspection-state-view.mjs',
  '/inspection-camera.mjs',
  '/inspection-tires.mjs',
  '/tire-inspection.mjs',
  '/tire-inspection-view.mjs',
  '/tire-targets.mjs',
  '/tire-status.mjs',
  '/component-status.mjs',
  '/ev-charge-status.mjs',
  '/charge-port-model.mjs',
  '/visibility-status.mjs',
  '/odometer-status.mjs',
  '/vehicle-status-card.mjs',
  '/external-vehicle-data.mjs',
  '/inspection-parts.mjs',
  '/part-labels.mjs',
  '/inspection-toast.mjs',
  '/android-native-inspection-adapter.mjs',
  '/native-bridge-diagnostics.mjs',
  '/mobile-result-contract.mjs',
  '/native-inspection-results.mjs',
  '/inspection-results.mjs',
  '/inspection-results-view.mjs',
  '/inspection-history-contract.mjs',
  '/inspection-history-store.mjs',
  '/inspection-history-view.mjs',
  '/inspection-history-client.mjs',
  '/native-history-provider.mjs',
  '/visibility-parts.mjs',
  '/visibility-targets.mjs',
  '/ioniq5-asset/ev-battery.mjs',
  '/ioniq5-asset/ev-charge-port.mjs',
  '/ioniq5-asset/front-compartment-layout.mjs',
  '/ioniq5-asset/front-compartment.mjs',
  '/ioniq5-asset/front-wiper.mjs',
  '/ioniq5-asset/frunk.mjs',
  '/ioniq5-asset/hood.mjs',
  '/ioniq5-asset/inspection-components.mjs',
  '/ioniq5-asset/service-components.mjs',
  '/vendor/three/build/three.module.js',
  '/vendor/three/examples/jsm/loaders/GLTFLoader.js',
  '/vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  '/vendor/three/examples/jsm/controls/OrbitControls.js',
  '/vendor/three/examples/jsm/environments/RoomEnvironment.js',
  '/mobile-ar-poc/public/part-capabilities.mjs',
  '/external/ioniq5.glb',
  '/inspection-handoff.json',
  '/inspection-qr.svg',
]);

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * P16: the request handler of this server, so the local account server can serve the same 3D page on its own origin
 * (the account web app, /inspect/). Behaviour of `node serve.mjs` is unchanged: same roots, fixtures and handoff.
 * @param {{env?: Record<string,string|undefined>}} [options]
 */
export async function createThreePocHandler({ env = process.env, publicOnly = false } = {}) {
  const ROOTS = [
    ["/fender/", join(HERE, "..", "anatomy-car", "build", "fender")],
    ["/loft/", join(HERE, "..", "anatomy-car", "build", "loft")],
    ["/envelope.glb", join(HERE, "..", "anatomy-car", "build", "envelope", "car.glb")],
    ["/envelope/", join(HERE, "..", "anatomy-car", "build", "envelope")],
    ["/vendor/three/", join(HERE, "node_modules", "three")],
    ["/car.glb", join(HERE, "..", "anatomy-car", "build", "geometry", "car.glb")],
    // P2-A6: the converted third-party IONIQ 5 GLB lives outside the repo; served only when configured.
    ["/ioniq5-asset/parts.mjs", join(HERE, "..", "ioniq5-asset", "parts.mjs")],
    // P11: the phone's part capability table, read by the results view at its repository path (pure data, no imports).
    ["/mobile-ar-poc/public/part-capabilities.mjs", join(HERE, "..", "mobile-ar-poc", "public", "part-capabilities.mjs")],
    ...(env.CARSCOPE_IONIQ5_GLB ? [["/external/ioniq5.glb", resolve(env.CARSCOPE_IONIQ5_GLB)]] : []),
    // P2-A7: model-derived SVG output, also outside the repo.
    ...(env.CARSCOPE_IONIQ5_SVG_DIR ? [["/external/ioniq5-svg/", resolve(env.CARSCOPE_IONIQ5_SVG_DIR)]] : []),
    // P3-A1: hood modules shared with the Node report, and its output folder (outside the repo).
    ["/ioniq5-asset/hood.mjs", join(HERE, "..", "ioniq5-asset", "hood.mjs")],
    ["/ioniq5-asset/collision.mjs", join(HERE, "..", "ioniq5-asset", "collision.mjs")],
    // P3-A2.1: front compartment shell modules (layout + builder, no model-derived data).
    ["/ioniq5-asset/front-compartment.mjs", join(HERE, "..", "ioniq5-asset", "front-compartment.mjs")],
    ["/ioniq5-asset/front-compartment-layout.mjs", join(HERE, "..", "ioniq5-asset", "front-compartment-layout.mjs")],
    ["/ioniq5-asset/frunk.mjs", join(HERE, "..", "ioniq5-asset", "frunk.mjs")],
    ["/ioniq5-asset/service-components.mjs", join(HERE, "..", "ioniq5-asset", "service-components.mjs")],
    ["/ioniq5-asset/inspection-components.mjs", join(HERE, "..", "ioniq5-asset", "inspection-components.mjs")],
    ["/ioniq5-asset/ev-battery.mjs", join(HERE, "..", "ioniq5-asset", "ev-battery.mjs")],
    ["/ioniq5-asset/ev-charge-port.mjs", join(HERE, "..", "ioniq5-asset", "ev-charge-port.mjs")],
    ["/ioniq5-asset/front-wiper.mjs", join(HERE, "..", "ioniq5-asset", "front-wiper.mjs")],
    ...(env.CARSCOPE_P3A23_DIR ? [["/external/p3-a2-3/", resolve(env.CARSCOPE_P3A23_DIR)]] : []),
    ...(env.CARSCOPE_P3A22_DIR ? [["/external/p3-a2-2/", resolve(env.CARSCOPE_P3A22_DIR)]] : []),
    ...(env.CARSCOPE_P3A1_DIR ? [["/external/p3-a1/", resolve(env.CARSCOPE_P3A1_DIR)]] : []),
    ...(env.CARSCOPE_P3A21_DIR ? [["/external/p3-a2-1/", resolve(env.CARSCOPE_P3A21_DIR)]] : []),
    ["/", HERE],
  ];
  // P3-A4: the inspection UI's mobile handoff. The origin is configuration, never a constant in the page.
  const handoff = handoffTarget(env.CARSCOPE_QR_AR_BASE_URL);
  const handoffQr = handoff.configured ? await QRCode.toString(handoff.url, { type: "svg", margin: 2, errorCorrectionLevel: "M" }) : null;
  // Explicit local synthetic UI test only. No native endpoint fallback and no bundled fixture.
  const componentFixture = env.CARSCOPE_COMPONENT_UI_FIXTURE ? resolve(env.CARSCOPE_COMPONENT_UI_FIXTURE) : null;
  const chargeFixture = env.CARSCOPE_CHARGE_UI_FIXTURE ? resolve(env.CARSCOPE_CHARGE_UI_FIXTURE) : null;
  const visibilityFixture=env.CARSCOPE_VISIBILITY_UI_FIXTURE?resolve(env.CARSCOPE_VISIBILITY_UI_FIXTURE):null;
  const tireFixture = env.CARSCOPE_TIRE_UI_FIXTURE ? resolve(env.CARSCOPE_TIRE_UI_FIXTURE) : null;
  // P14: explicit local synthetic Odometer packet; MOCK only, like the others.
  const odometerFixture = env.CARSCOPE_ODOMETER_UI_FIXTURE ? resolve(env.CARSCOPE_ODOMETER_UI_FIXTURE) : null;
  const TYPES ={ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json", ".svg": "image/svg+xml" };
  return async function handle(req, res) {
    let url;
    try { url = decodeURIComponent(new URL(req.url, "http://x").pathname); }
    catch { res.writeHead(400); return res.end('Bad request'); }
    if (publicOnly && !PUBLIC_PATHS.has(url)) { res.writeHead(404); return res.end('not found'); }
    if (url === '/component-status.json' && componentFixture && req.method === 'GET' && !new URL(req.url, 'http://x').search) {
      try { const body = await readFile(componentFixture); const packet = JSON.parse(body); if (!Array.isArray(packet.readings) || packet.readings.some(r => r.source !== 'MOCK')) throw Error('Fixture must be MOCK'); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(body); }
      catch { res.writeHead(503); return res.end('Unavailable'); }
    }
    if (url === '/odometer-status.json' && odometerFixture && req.method === 'GET') {
      try { const packet = JSON.parse(await readFile(odometerFixture, 'utf8')); if (!Array.isArray(packet.readings) || packet.readings.some(r => r.source !== 'MOCK')) throw Error('Fixture must be MOCK');
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(packet)); }
      catch { res.writeHead(503, { 'cache-control': 'no-store' }); return res.end(); }
    }
    if (url === '/tire-status.json' && tireFixture && req.method === 'GET') {
      try {
        const body = await readFile(tireFixture);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(body);
      } catch { res.writeHead(503); return res.end('Unavailable'); }
    }
    if(url==='/visibility-status.json'&&visibilityFixture&&req.method==='GET'){
      try{const body=await readFile(visibilityFixture),p=JSON.parse(body);if(p.readings?.length!==3||!p.readings.every(r=>r.source==='MOCK'))throw Error('MOCK_ONLY');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(body);}catch{res.writeHead(503);return res.end('Unavailable');}
    }
    if (url === '/ev-charge-status.json' && chargeFixture && req.method === 'GET') {
      try {
        const body = await readFile(chargeFixture), packet = JSON.parse(body);
        if (packet.readings?.length !== 1 || packet.readings[0].source !== 'MOCK') throw Error('MOCK_ONLY');
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(body);
      } catch { res.writeHead(503); return res.end('Unavailable'); }
    }
    if (url === "/inspection-handoff.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ configured: handoff.configured, url: handoff.url, reason: handoff.reason }));
    }
    if (url === "/inspection-qr.svg" && handoffQr) {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
      return res.end(handoffQr);
    }
    for (const [prefix, dir] of ROOTS) {
      if (!url.startsWith(prefix)) continue;
      const rest = prefix.endsWith("/") ? url.slice(prefix.length) : "";
      const file = normalize(join(dir, rest || (prefix === "/" ? "index.html" : "")));
      if (file !== normalize(dir) && !file.startsWith(normalize(dir) + sep)) break;
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
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8095);
  createServer(await createThreePocHandler()).listen(port, "127.0.0.1", function () { console.log(`PoC on http://127.0.0.1:${this.address().port}/`); });
}
