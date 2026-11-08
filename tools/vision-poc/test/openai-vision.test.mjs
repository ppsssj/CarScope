// P13-A: the OpenAI adapter with a fake fetch. Nothing here reaches OpenAI: the request shape and the failure handling are checked,
// not the model. A real call was not made (REAL_PROVIDER_NOT_RUN).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnalysisPrompt, validateAnalysisResult } from '../../mobile-ar-poc/public/part-analysis.mjs';
import { buildOpenAiRequest, OPENAI_RESPONSES_URL, openAiVisionProvider, parseOpenAiResponse } from '../src/openai-vision.mjs';
import { MOCK_SCENARIOS, createMockVisionProvider, fixtureDetectionProvider } from '../src/mock-vision-provider.mjs';
import { realOpenAiProvider, startLocalAnalysis, VISION_CALL_LIMIT } from '../scripts/part-analysis-local.mjs';

const KEY = 'sk-test-key-must-never-appear';
const W = 'washer-fluid-cap';
const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const input = { partId: W, image, imageSize: { width: 640, height: 480 }, ...buildAnalysisPrompt(W, { targetInCrop: [0.3, 0.3, 0.4, 0.4], regionSource: 'AI_CANDIDATE' }) };
const completed = answer => ({ id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('the request: Responses API, text then the crop as a data URL, strict schema, not stored, a required model id', () => {
  const body = buildOpenAiRequest(input, { model: 'configured-model' });
  assert.equal(body.model, 'configured-model');
  assert.equal(body.store, false);
  assert.equal(body.instructions, input.instructions);
  const [message] = body.input;
  assert.equal(message.role, 'user');
  assert.deepEqual(message.content.map(part => part.type), ['input_text', 'input_image']);
  assert.equal(message.content[1].image_url, `data:image/jpeg;base64,${image.toString('base64')}`);
  assert.equal(message.content[1].detail, 'high');
  assert.deepEqual(body.text.format, { type: 'json_schema', name: 'carscope_part_analysis', schema: input.schema, strict: true });
  assert.ok(Number.isInteger(body.max_output_tokens));
  assert.ok(!('temperature' in body), 'not set: support differs between reasoning models');
  for (const model of [undefined, '', 'has space', 'x'.repeat(80)]) assert.throws(() => buildOpenAiRequest(input, { model }), /OPENAI_MODEL_REQUIRED/);
  assert.throws(() => openAiVisionProvider({ apiKey: KEY }), /OPENAI_MODEL_REQUIRED/, 'no default model id');
  assert.throws(() => openAiVisionProvider({ model: 'm' }), /OPENAI_KEY_REQUIRED/);
});

test('one POST to the fixed endpoint with the key only in the header; the answer passes the contract', async () => {
  const seen = [];
  const provider = openAiVisionProvider({ apiKey: KEY, model: 'configured-model', fetchImpl: async (url, init) => { seen.push({ url, init }); return reply(completed(MOCK_SCENARIOS['no-visible-issue'])); } });
  assert.equal(provider.id, 'openai');
  const answer = await provider.analyzePart(input);
  assert.equal(validateAnalysisResult(W, answer).ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, OPENAI_RESPONSES_URL);
  assert.equal(seen[0].init.method, 'POST'); assert.equal(seen[0].init.redirect, 'error');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!seen[0].init.body.includes(KEY), 'the key is not in the body');
  assert.ok(!JSON.stringify(provider).includes(KEY), 'nor on the provider object');
});

test('refusals, cut-off answers, bad JSON and HTTP errors become fixed codes that quote nothing', async () => {
  const cases = [
    [reply({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }), 'OPENAI_INCOMPLETE'],
    [reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), 'OPENAI_REFUSED'],
    [reply({ status: 'completed', output: [] }), 'OPENAI_NO_TEXT'],
    [reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"partId":' }] }] }), 'OPENAI_JSON_INVALID'],
    [reply('<html>gateway</html>'), 'OPENAI_RESPONSE_INVALID'],
    [reply({ error: { message: `invalid key ${KEY}` } }, 401), 'OPENAI_HTTP_401'],
    [reply({ error: { message: 'quota' } }, 429), 'OPENAI_HTTP_429'],
    [reply({ error: { message: 'down' } }, 500), 'OPENAI_HTTP_500'],
    [reply('x'.repeat(10), 200, { 'content-length': String(10 * 1024 * 1024) }), 'OPENAI_RESPONSE_TOO_LARGE'],
  ];
  for (const [response, code] of cases) {
    const provider = openAiVisionProvider({ apiKey: KEY, model: 'm', fetchImpl: async () => response });
    await assert.rejects(provider.analyzePart(input), error => { assert.equal(error.message, code); assert.ok(!String(error.stack).includes(KEY)); return true; });
  }
  // A streamed body past the limit is cut off while reading, not after.
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(32 * 1024)); c.close(); } });
  const streamed = openAiVisionProvider({ apiKey: KEY, model: 'm', maxResponseBytes: 64 * 1024, fetchImpl: async () => new Response(big, { status: 200 }) });
  await assert.rejects(streamed.analyzePart(input), /OPENAI_RESPONSE_TOO_LARGE/);
  const network = openAiVisionProvider({ apiKey: KEY, model: 'm', fetchImpl: async () => { throw new Error(`socket ${KEY}`); } });
  await assert.rejects(network.analyzePart(input), error => error.message === 'OPENAI_NETWORK');
  assert.throws(() => parseOpenAiResponse(null), /OPENAI_RESPONSE_INVALID/);
});

test('a timeout or a cancel from the route aborts the outgoing request', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(openAiVisionProvider({ apiKey: KEY, model: 'm', timeoutMs: 30, fetchImpl: hang }).analyzePart(input), /OPENAI_ABORTED/);
  const ctrl = new AbortController();
  const pending = openAiVisionProvider({ apiKey: KEY, model: 'm', fetchImpl: hang }).analyzePart(input, { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(pending, /OPENAI_ABORTED/);
});

test('the local entrypoint: MOCK by default; the real mode refuses without key file, model, ledger, or on Render, and counts calls', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'p13a-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'openai.key'); writeFileSync(keyFile, KEY);
  const ledgerFile = join(dir, 'vision-calls.json');
  assert.throws(() => realOpenAiProvider({ env: {} }), /KEY_FILE_REQUIRED/);
  assert.throws(() => realOpenAiProvider({ env: { OPENAI_API_KEY_FILE: keyFile } }), /OPENAI_VISION_MODEL_REQUIRED/);
  assert.throws(() => realOpenAiProvider({ env: { OPENAI_API_KEY_FILE: keyFile, OPENAI_VISION_MODEL: 'm' } }), /LEDGER_REQUIRED/);
  assert.throws(() => realOpenAiProvider({ env: { OPENAI_API_KEY_FILE: keyFile, OPENAI_VISION_MODEL: 'm', CARSCOPE_VISION_LEDGER: 'calls.json' } }), /LEDGER_INSIDE_REPOSITORY/);
  assert.throws(() => realOpenAiProvider({ env: { RENDER: 'true', OPENAI_API_KEY_FILE: keyFile } }), /LOCAL_EXPERIMENT_ONLY/);
  await assert.rejects(startLocalAnalysis({ env: { RENDER: 'true' } }), /LOCAL_EXPERIMENT_ONLY/);
  let calls = 0;
  const { provider, ledger } = realOpenAiProvider({ env: { OPENAI_API_KEY_FILE: keyFile, OPENAI_VISION_MODEL: 'm', CARSCOPE_VISION_LEDGER: ledgerFile }, fetchImpl: async () => { calls++; return reply(completed(MOCK_SCENARIOS['no-visible-issue'])); } });
  for (let i = 0; i < VISION_CALL_LIMIT; i++) await provider.analyzePart(input);
  await assert.rejects(provider.analyzePart(input), /OPENAI_NETWORK/, 'the ledger refuses the sixth before it goes out');
  assert.equal(calls, VISION_CALL_LIMIT); assert.equal(ledger.count, VISION_CALL_LIMIT);
  assert.ok(existsSync(ledgerFile) && !readFileSync(ledgerFile, 'utf8').includes(KEY), 'the ledger holds no key');
  const local = await startLocalAnalysis({ env: {} });
  t.after(() => local.stop());
  assert.equal(local.provider.id, 'mock'); assert.equal(local.ledger, null);
  assert.match(await (await fetch(`${local.url}/`)).text(), /data-part-analysis-service="mock"/);
});

test('the fixture detector replays fractions at the uploaded size and calls nothing outside', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(16), Buffer.from([0xff, 0xd9])]);
  const parsed = await fixtureDetectionProvider([{ className: 'Windshield Wiper Fluid', score: 0.7, box: [0.25, 0.5, 0.1, 0.2] }]).detect({ image: jpeg });
  assert.deepEqual({ w: parsed.imageWidth, h: parsed.imageHeight }, { w: 640, h: 480 });
  assert.deepEqual(parsed.predictions[0], { className: 'Windshield Wiper Fluid', score: 0.7, x: 192, y: 288, width: 64, height: 96 });
  const mock = createMockVisionProvider();
  assert.equal(mock.model, 'mock-fixture-1');
});
