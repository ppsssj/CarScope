// WebXR guide experiment entrypoint. The default render-stateful.mjs never offers the guide, so deploying code changes
// nothing: only an operator who points the Render Start Command at this file turns it on, and pointing it back turns it off.
// Reads no environment of its own. Sessions, authorization and results are exactly what the same mode of the default
// command gives. The Build Command must also install tools/mobile-ar-poc for three.js: without it this refuses to start.
import { fileURLToPath } from 'node:url';
import { assertWebXrGuideFiles } from './mobile-page.mjs';
import { openRenderPool, renderEnvironment, startRenderStateful, stopOnSignal } from './render-stateful.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pool;
  try {
    const { connection, publicOrigin, port, expectedSchema, enableAvdSimulation } = renderEnvironment();
    await assertWebXrGuideFiles();
    pool = await openRenderPool(connection);
    const app = await startRenderStateful({
      pool, publicOrigin, host: '0.0.0.0', port, expectedSchema,
      enableAvdSimulation, webxrGuide: true,
    });
    console.log(`CarScope stateful service ready; WebXR guide EXPERIMENT on; creation=${enableAvdSimulation ? 'AVD simulation; OEM vehicle ownership NOT verified' : 'DENIED'}`);
    stopOnSignal(app);
  } catch (error) {
    if (pool) await pool.end().catch(() => {});
    // A fixed code in either case, never the error text: the configuration can hold a database URL.
    console.error(error?.message === 'WEBXR_GUIDE_ASSET_MISSING' ? 'WEBXR_GUIDE_ASSET_MISSING' : 'RENDER_STATEFUL_CONFIGURATION_FAILED');
    process.exitCode = 1;
  }
}
