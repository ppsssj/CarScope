// P13-A: local entrypoint for part search + state analysis. 127.0.0.1 only, local test sessions only. Not imported by any Render entrypoint.
// Default: fixture detector (no Roboflow call) and the MOCK vision provider (no OpenAI call). Nothing leaves this machine.
//   node scripts/part-analysis-local.mjs
// A real OpenAI call needs all of: --real-openai, a key file outside the repository, a model id, and a call ledger with a hard limit.
//   OPENAI_API_KEY_FILE=... OPENAI_VISION_MODEL=... CARSCOPE_VISION_LEDGER=... node scripts/part-analysis-local.mjs --real-openai
// Paid calls need the owner's approval first. P13-A did not run this mode (REAL_PROVIDER_NOT_RUN).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { createCallLedger, ledgeredFetch } from '../src/call-ledger.mjs';
import { createMockVisionProvider, fixtureDetectionProvider } from '../src/mock-vision-provider.mjs';
import { openAiVisionProvider } from '../src/openai-vision.mjs';
import { readKeyFile } from './part-detection-local.mjs';

export const VISION_CALL_LIMIT = 5;
const repository = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))).toLowerCase() + path.sep;
// One washer cap candidate, as fractions. Replayed on any picture: it marks a place, it does not find anything.
// P13-D: one box per class the real model has for the four detectable bonnet parts. The washer stays first (P13-B tests read it).
// The other two parts have no class, as in the real model, and are marked by hand.
export const FIXTURE_PREDICTIONS = Object.freeze([
  { className: 'Windshield Wiper Fluid', score: 0.76, box: [0.42, 0.4, 0.12, 0.1] },
  { className: 'Engine Coolant Reservoir', score: 0.7, box: [0.15, 0.2, 0.14, 0.16] },
  { className: 'Brake Fluid', score: 0.68, box: [0.68, 0.18, 0.1, 0.12] },
  { className: 'Fuse Box', score: 0.66, box: [0.72, 0.55, 0.16, 0.14] },
]);

export function realOpenAiProvider({ env = process.env, fetchImpl } = {}) {
  const apiKey = readKeyFile(env.OPENAI_API_KEY_FILE, env);
  if (!env.OPENAI_VISION_MODEL) throw new Error('OPENAI_VISION_MODEL_REQUIRED');
  const ledgerFile = env.CARSCOPE_VISION_LEDGER;
  if (!ledgerFile) throw new Error('LEDGER_REQUIRED');
  if (path.resolve(ledgerFile).toLowerCase().startsWith(repository)) throw new Error('LEDGER_INSIDE_REPOSITORY');
  const ledger = createCallLedger({ file: ledgerFile, limit: VISION_CALL_LIMIT });
  return { ledger, provider: openAiVisionProvider({ apiKey, model: env.OPENAI_VISION_MODEL, fetchImpl: ledgeredFetch({ ledger, purpose: 'p13-a-manual', fetchImpl }) }) };
}

export async function startLocalAnalysis({ real = false, env = process.env, port = 0, now, predictions = FIXTURE_PREDICTIONS, vision } = {}) {
  if (env.RENDER) throw new Error('LOCAL_EXPERIMENT_ONLY');
  const chosen = vision ? { provider: vision, ledger: null } : real ? realOpenAiProvider({ env }) : { provider: createMockVisionProvider(), ledger: null };
  const server = await startMobileDevServer({ port, now, authorizer: new LocalTestSessionCreationAuthorizer(), partDetection: { provider: fixtureDetectionProvider(predictions) }, partAnalysis: { provider: chosen.provider } });
  return { ...server, provider: chosen.provider, ledger: chosen.ledger };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const real = process.argv.includes('--real-openai');
  const s = await startLocalAnalysis({ real, port: Number(process.env.SYNC_MOBILE_PORT || 4184) });
  console.log(`Local P13-A experiment on ${s.url}. Detector: fixture (no Roboflow call). Vision: ${real ? `OpenAI ${s.provider.model}, ${s.ledger.count}/${VISION_CALL_LIMIT} calls used` : 'MOCK (no outside call)'}.`);
}
