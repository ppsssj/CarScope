// Only the separate Vision entrypoint imports hosted adapters. Default Render's import graph stays unchanged.
import { openAiVisionProvider } from '../../vision-poc/src/openai-vision.mjs';
import { inferImage } from '../../vision-poc/src/roboflow-client.mjs';
import { parseRoboflowResponse } from '../../vision-poc/src/roboflow-adapter.mjs';
import { hostedDetectionProvider } from './part-detection-route.mjs';
import { budgetedCall } from './vision-budget.mjs';

export function experimentVisionProvider({ env, budget, fetchImpl }) {
  if (env.CARSCOPE_VISION_APPROVAL !== 'OPERATOR_APPROVED' || !env.OPENAI_API_KEY || !env.OPENAI_VISION_MODEL) throw new Error('VISION_OPERATOR_CONFIGURATION_REQUIRED');
  const adapter = openAiVisionProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_VISION_MODEL, fetchImpl });
  return Object.freeze({ ...adapter, analyzePart: budgetedCall({ budget, provider: 'openai', call: adapter.analyzePart }) });
}

// Prepared for four supported parts, but never called by the Render CLI. Rights/data-processing approval is still pending.
export function approvedDetectionProvider({ rightsApproved = false, apiKey, budget, fetchImpl } = {}) {
  if (rightsApproved !== true) throw new Error('ROBOFLOW_RIGHTS_APPROVAL_REQUIRED');
  const adapter = hostedDetectionProvider({ apiKey, parseResponse: parseRoboflowResponse,
    inferImage: args => inferImage({ ...args, fetchImpl }) });
  return Object.freeze({ detect: budgetedCall({ budget, provider: 'roboflow', call: adapter.detect }) });
}
