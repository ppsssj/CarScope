// Debug AVD demonstration entrypoint. The default render-stateful.mjs never opens /simulator/inspection-records, so
// deploying code changes nothing: only an operator who points the Render Start Command at this file opens it.
// Reads no environment of its own, and refuses to start outside the operator-approved simulator mode.
// An enrollment proof reads the records of its own registration. That is not user, vehicle or ownership authentication.
import { fileURLToPath } from 'node:url';
import { openRenderPool, renderEnvironment, startRenderStateful, stopOnSignal } from './render-stateful.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pool;
  try {
    const { connection, publicOrigin, port, expectedSchema, enableAvdSimulation } = renderEnvironment();
    if (!enableAvdSimulation) throw new Error('AVD_HISTORY_READ_REQUIRES_SIMULATION');
    pool = await openRenderPool(connection);
    const app = await startRenderStateful({
      pool, publicOrigin, host: '0.0.0.0', port, expectedSchema,
      enableAvdSimulation: true, enableAvdHistoryRead: true,
    });
    console.log('CarScope AVD history demonstration ready; registration-scoped reads; OEM vehicle ownership NOT verified');
    stopOnSignal(app);
  } catch {
    if (pool) await pool.end().catch(() => {});
    console.error('RENDER_STATEFUL_CONFIGURATION_FAILED'); process.exitCode = 1;
  }
}
