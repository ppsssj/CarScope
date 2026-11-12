// Disposable loopback DB and synthetic OpenAI response only. Never imported by runtime code.
import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDatabase } from '../preflight/database.mjs';
import { mockAnswer } from '../../vision-poc/src/mock-vision-provider.mjs';

export async function visionDatabase(url = process.env.PG_TEST_URL) {
  assertIsolatedTestDatabase(url);
  const { Pool } = await import('pg');
  const schema = 'cs_vision_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pools = [];
  return { schema, admin, pool() { const p = new Pool({ connectionString: url, max: 8, options: '-c search_path=' + schema }); p.on('error', () => {}); pools.push(p); return p; },
    async close() { await Promise.allSettled(pools.map(p => p.end())); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}

export function openAiFixture() {
  const fixture = { mode: 'answer', calls: [], release: null };
  fixture.fetch = async (url, options) => {
    if (url !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected external URL in MOCK');
    const request = JSON.parse(options.body), partId = request.text.format.schema.properties.partId.enum[0];
    // Evidence records no key and no pixels. The real adapter alone reads the synthetic image data URL.
    // P13-G: whether the prompt the real adapter sent names the outside of the car (no pixels, no key).
    fixture.calls.push({ partId, strict: request.text.format.strict, store: request.store, aborted: false, exterior: /on the outside of/.test(request.instructions ?? '') });
    const call = fixture.calls.at(-1);
    options.signal.addEventListener('abort', () => { call.aborted = true; }, { once: true });
    if (fixture.mode === 'error') return new Response('private upstream message', { status: 429 });
    if (fixture.mode === 'hold') await new Promise(resolve => { fixture.release = resolve; options.signal.addEventListener('abort', resolve, { once: true }); });
    const answer = mockAnswer(partId, fixture.mode === 'invalid' ? 'claims-safe' : 'indeterminate');
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
  };
  return fixture;
}
