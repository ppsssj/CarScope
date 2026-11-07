// P12-F: the only place where the real hosted model meets the inspection server. Local experiments only: not imported by any Render entrypoint.
// 127.0.0.1 only, local test sessions only, the key from a file outside the repository, and every real call counted in a ledger with a hard limit.
//   ROBOFLOW_API_KEY_FILE=... CARSCOPE_CALL_LEDGER=... node scripts/part-detection-local.mjs
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { hostedDetectionProvider } from '../../inspection-sync-poc/src/part-detection-route.mjs';
import { createCallLedger, ledgeredFetch } from '../src/call-ledger.mjs';
import { parseRoboflowResponse, ROBOFLOW_MODEL_ID } from '../src/roboflow-adapter.mjs';
import { inferImage } from '../src/roboflow-client.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase() + path.sep;

export function readKeyFile(file, env = process.env) {
  if (env.RENDER) throw new Error('LOCAL_EXPERIMENT_ONLY');
  if (!file) throw new Error('KEY_FILE_REQUIRED');
  if (path.resolve(file).toLowerCase().startsWith(repository)) throw new Error('KEY_FILE_INSIDE_REPOSITORY');
  const key = readFileSync(file, 'utf8').trim();
  if (!key) throw new Error('KEY_FILE_EMPTY');
  return key;
}

/** A provider with measured steps. The list holds sizes and times, never an image, a key or a response. */
export function measuredProvider({ apiKey, ledger, purpose = 'local', fetchImpl = fetch, timeoutMs }) {
  const timings = [];
  let current = null;
  const provider = hostedDetectionProvider({
    apiKey, timeoutMs, modelId: ROBOFLOW_MODEL_ID,
    inferImage: async args => {
      current = { imageBytes: args.image.length, base64Bytes: Math.ceil(args.image.length / 3) * 4 };
      timings.push(current);
      const started = performance.now();
      const answer = await inferImage({ ...args, fetchImpl: ledgeredFetch({ ledger, purpose, fetchImpl }) });
      current.roundTripMs = Math.round(performance.now() - started);
      current.status = answer.status;
      return answer;
    },
    parseResponse: body => {
      const started = performance.now();
      const parsed = parseRoboflowResponse(body);
      current.parseMs = Number((performance.now() - started).toFixed(2));
      current.predictions = parsed.predictions.length;
      return parsed;
    },
  });
  return { provider, timings };
}

export async function startLocalDetection({ keyFile, ledgerFile, purpose, fetchImpl, port = 0, now, limits, env = process.env, timeoutMs } = {}) {
  const apiKey = readKeyFile(keyFile, env);
  if (!ledgerFile) throw new Error('LEDGER_REQUIRED');
  const ledger = createCallLedger({ file: ledgerFile });
  const { provider, timings } = measuredProvider({ apiKey, ledger, purpose, fetchImpl, timeoutMs });
  const server = await startMobileDevServer({ port, now, authorizer: new LocalTestSessionCreationAuthorizer(), partDetection: { provider, limits } });
  return { ...server, timings, ledger };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startLocalDetection({ keyFile: process.env.ROBOFLOW_API_KEY_FILE, ledgerFile: process.env.CARSCOPE_CALL_LEDGER, purpose: 'manual', port: Number(process.env.SYNC_MOBILE_PORT || 4183) });
  console.log(`Local experiment on ${s.url}. Real model calls, local test sessions, ${s.ledger.count} calls used so far.`);
}
