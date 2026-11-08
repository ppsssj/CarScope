// P12-C: one call per image to a Roboflow-compatible endpoint: the hosted API, or a self-hosted server on this machine.
// The key is only ever sent as a header and never appears in a URL, a log line or a result file.
export const HOSTED_API_URL = 'https://serverless.roboflow.com';
// Low on purpose: the evaluator applies thresholds later, so no second paid run. A fraction: the hosted API answered with scores down to 0.052.
export const REQUEST_CONFIDENCE = 0.05;

export const CALL_STATUS = Object.freeze({
  BLOCKED_API_KEY_REQUIRED: 'BLOCKED_API_KEY_REQUIRED',
  BLOCKED_AUTH_REJECTED: 'BLOCKED_AUTH_REJECTED', // Wrong key, or the plan or model does not allow this call.
  BLOCKED_RATE_OR_CREDIT: 'BLOCKED_RATE_OR_CREDIT',
  FAILED: 'FAILED',
  OK: 'OK',
});
const STOPS_THE_RUN = new Set([CALL_STATUS.BLOCKED_AUTH_REJECTED, CALL_STATUS.BLOCKED_RATE_OR_CREDIT]);
export const stopsTheRun = status => STOPS_THE_RUN.has(status);

export function classifyHttpStatus(status) {
  if (status >= 200 && status < 300) return CALL_STATUS.OK;
  if (status === 401 || status === 403) return CALL_STATUS.BLOCKED_AUTH_REJECTED;
  if (status === 402 || status === 429) return CALL_STATUS.BLOCKED_RATE_OR_CREDIT;
  return CALL_STATUS.FAILED;
}

export async function inferImage({ apiUrl = HOSTED_API_URL, modelId, apiKey, image, fetchImpl = fetch, timeoutMs = 60000, signal }) {
  const url = `${apiUrl.replace(/\/+$/, '')}/${modelId}?confidence=${REQUEST_CONFIDENCE}`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Buffer.from(image).toString('base64'),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    const status = classifyHttpStatus(response.status);
    if (status !== CALL_STATUS.OK) return { status, httpStatus: response.status };
    return { status, httpStatus: response.status, body: await response.json() };
  } catch (error) {
    // An error text could quote the request, so only its name leaves this function.
    return { status: CALL_STATUS.FAILED, error: error?.name ?? 'Error' };
  }
}
