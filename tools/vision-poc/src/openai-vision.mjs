// P13-A: the OpenAI adapter of the vision provider interface (tools/inspection-sync-poc/src/part-analysis-route.mjs). Local experiments only.
// Responses API, one user message with the prompt text and the cropped JPEG as a data URL, strict JSON-schema output, store:false.
// Shape checked against developers.openai.com/api/docs (images-vision, structured-outputs, responses create) on 2026-11-08.
// The model id is required configuration: no default, so no old id is ever used by accident. The key stays in this closure.
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_LIMITS = Object.freeze({ maxResponseBytes: 256 * 1024, maxOutputTokens: 4000, timeoutMs: 40_000 });
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** The request body. Pure: tests read it, and nothing in it is secret. */
export function buildOpenAiRequest(input, { model, maxOutputTokens = OPENAI_LIMITS.maxOutputTokens, detail = 'high' } = {}) {
  if (!MODEL.test(model ?? '')) fail('OPENAI_MODEL_REQUIRED');
  if (!Buffer.isBuffer(input?.image) || !input.instructions || !input.userText || !input.schema) fail('OPENAI_INPUT_INVALID');
  return {
    model,
    store: false, // not kept as application state on OpenAI's side. Abuse-monitoring retention still applies (docs: up to 30 days).
    instructions: input.instructions,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: input.userText },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${input.image.toString('base64')}`, detail },
    ] }],
    text: { format: { type: 'json_schema', name: 'carscope_part_analysis', schema: input.schema, strict: true } },
    max_output_tokens: maxOutputTokens,
  };
}

/** The model's JSON object from a raw Responses API body, or a fixed error code. Refusals and cut-off answers are failures. */
export function parseOpenAiResponse(body) {
  if (!body || typeof body !== 'object') fail('OPENAI_RESPONSE_INVALID');
  if (body.status !== 'completed') fail(body.status === 'incomplete' ? 'OPENAI_INCOMPLETE' : 'OPENAI_NOT_COMPLETED');
  const parts = (Array.isArray(body.output) ? body.output : []).filter(item => item?.type === 'message').flatMap(item => (Array.isArray(item.content) ? item.content : []));
  if (parts.some(part => part?.type === 'refusal')) fail('OPENAI_REFUSED');
  const texts = parts.filter(part => part?.type === 'output_text' && typeof part.text === 'string');
  if (texts.length !== 1) fail('OPENAI_NO_TEXT');
  try { return JSON.parse(texts[0].text); } catch { return fail('OPENAI_JSON_INVALID'); }
}

/** Only the counts: input, output, and the reasoning share of output when reported. */
export function pickUsage(usage) {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return null;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, ...(Number.isFinite(reasoning) ? { reasoning_tokens: reasoning } : {}) };
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) fail('OPENAI_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); fail('OPENAI_RESPONSE_TOO_LARGE'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A provider for the route. Errors carry a fixed code only: never the key, the request, or OpenAI's own message.
 * @param o.fetchImpl  e.g. a ledgered fetch, so every real call is counted before it goes out
 */
export function openAiVisionProvider({ apiKey, model, fetchImpl = fetch, timeoutMs = OPENAI_LIMITS.timeoutMs, maxResponseBytes = OPENAI_LIMITS.maxResponseBytes, maxOutputTokens, detail }) {
  if (!apiKey || typeof apiKey !== 'string') fail('OPENAI_KEY_REQUIRED');
  if (!MODEL.test(model ?? '')) fail('OPENAI_MODEL_REQUIRED');
  return Object.freeze({
    id: 'openai', model,
    /** `onResponse` (P13-B, optional) receives the token counts and status OpenAI reported, for latency and cost records. Never the body. */
    async analyzePart(input, { signal, onResponse } = {}) {
      const body = JSON.stringify(buildOpenAiRequest(input, { model, maxOutputTokens, detail }));
      const ctrl = new AbortController(), stop = () => ctrl.abort();
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      const timer = setTimeout(stop, timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(OPENAI_RESPONSES_URL, { method: 'POST', signal: ctrl.signal, redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body });
        } catch { fail(ctrl.signal.aborted ? 'OPENAI_ABORTED' : 'OPENAI_NETWORK'); }
        if (ctrl.signal.aborted) fail('OPENAI_ABORTED');
        if (!response.ok) { await response.body?.cancel().catch(() => {}); fail(`OPENAI_HTTP_${response.status}`); }
        let text;
        try { text = await readLimited(response, maxResponseBytes); } catch (error) { fail(error?.code === 'OPENAI_RESPONSE_TOO_LARGE' ? error.code : 'OPENAI_NETWORK'); }
        let json;
        try { json = JSON.parse(text); } catch { fail('OPENAI_RESPONSE_INVALID'); }
        // Reported before parsing, so a refused or cut-off answer still shows what it cost.
        try { onResponse?.({ usage: pickUsage(json?.usage), status: typeof json?.status === 'string' ? json.status : null }); } catch { /* a reporting hook cannot break the call */ }
        return parseOpenAiResponse(json);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    },
  });
}
