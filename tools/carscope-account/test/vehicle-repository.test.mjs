// P15 vehicle input rules and the identity guard of the repository (no network; a fake query builder records calls).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ERRORS, SCHEMA, classifyDataError, createVehicleRepository, toVehicle, validateVehicleInput } from '../web/lib/vehicle-repository.mjs';

const NOW = new Date('2026-11-13T00:00:00Z');

test('valid input is trimmed, NFC-normalised and reduced to the four user fields', () => {
  const r = validateVehicleInput({ manufacturer: '  현대 ', model: 'IONIQ 5', model_year: '2024', nickname: '' }, { now: NOW });
  assert.deepEqual(r, { ok: true, value: { manufacturer: '현대', model: 'IONIQ 5', model_year: 2024, nickname: null } });
  const nfd = '현대'; // 현대 decomposed
  assert.equal(validateVehicleInput({ manufacturer: nfd, model: 'x' }).value.manufacturer, '현대');
});

test('owner_id, verification fields, ids and unknown keys are rejected, not silently dropped', () => {
  for (const key of ['owner_id', 'verification_status', 'verified_at', 'verification_provider', 'id', 'created_at', 'vin', 'plate', 'location']) {
    const r = validateVehicleInput({ manufacturer: '현대', model: 'IONIQ 5', [key]: 'x' });
    assert.deepEqual(r, { ok: false, errors: [`${key}:not_allowed`] }, key);
  }
});

test('required, length, control-character and year rules', () => {
  const bad = (input) => validateVehicleInput({ manufacturer: '현대', model: 'IONIQ 5', ...input }, { now: NOW }).errors;
  assert.deepEqual(bad({ manufacturer: ' ' }), ['manufacturer:required']);
  assert.deepEqual(bad({ model: undefined }), ['model:required']);
  assert.deepEqual(bad({ model: 'x'.repeat(61) }), ['model:length']);
  assert.deepEqual(bad({ nickname: '가'.repeat(41) }), ['nickname:length']);
  assert.deepEqual(bad({ nickname: 'a\u202Eb'.replace('\u202E', '\u0007') }), ['nickname:control']);
  assert.deepEqual(bad({ nickname: 'line\u2028break' }), ['nickname:control']);
  for (const y of [1949, 2029, 20.5, '24', 'abcd', true]) assert.deepEqual(bad({ model_year: y }), ['model_year:range'], String(y));
  assert.equal(validateVehicleInput({ manufacturer: '현대', model: 'x', model_year: 2028 }, { now: NOW }).ok, true);
  assert.deepEqual(validateVehicleInput(null).errors, ['input:type']);
  assert.deepEqual(validateVehicleInput({ manufacturer: 1, model: 'x' }).errors, ['manufacturer:type']);
});

test('API errors map to page states', () => {
  assert.equal(classifyDataError({ code: '42501', message: 'permission denied' }), ERRORS.FORBIDDEN);
  assert.equal(classifyDataError({ code: 'PGRST301', message: 'JWT expired' }), ERRORS.SESSION_EXPIRED);
  assert.equal(classifyDataError({ code: '23514', message: 'vehicle limit reached' }), ERRORS.LIMIT_REACHED);
  assert.equal(classifyDataError({ code: '23514', message: 'violates check constraint' }), ERRORS.INVALID_INPUT);
  assert.equal(classifyDataError(new TypeError('fetch failed')), ERRORS.NETWORK);
  assert.equal(classifyDataError({ code: 'XX000', message: 'boom' }), ERRORS.SERVER);
});

test('unknown verification values from the API read as unverified, never as verified', () => {
  const row = { id: '00000000-0000-4000-8000-000000000000', manufacturer: 'a', model: 'b', model_year: null, nickname: null, created_at: 'x', updated_at: 'y' };
  assert.equal(toVehicle({ ...row, verification_status: 'VERIFIED' }).verification, 'SELF_REPORTED_UNVERIFIED');
  assert.equal(toVehicle({ ...row, verification_status: 'OEM_VERIFIED' }).verification, 'OEM_VERIFIED');
});

function fakeClient(respond) {
  const calls = [];
  const builder = (table) => {
    const chain = { table, steps: [] };
    const proxy = new Proxy(chain, {
      get(target, name) {
        if (name === 'then') { const p = Promise.resolve().then(() => respond(target)); return p.then.bind(p); }
        return (...args) => { target.steps.push([name, ...args]); return proxy; };
      },
    });
    calls.push(chain);
    return proxy;
  };
  return { calls, schema: (s) => { assert.equal(s, SCHEMA); return { from: builder }; } };
}

test('insert sends only the validated fields; update and delete are scoped by id and report NOT_FOUND on zero rows', async () => {
  const client = fakeClient((chain) => (chain.steps[0][0] === 'insert' ? { data: { id: '00000000-0000-4000-8000-000000000001', manufacturer: '현대', model: 'x', model_year: null, nickname: null, verification_status: 'SELF_REPORTED_UNVERIFIED', created_at: 'c', updated_at: 'u' }, error: null } : { data: [], error: null }));
  const repo = createVehicleRepository({ client, session: { epoch: 1 } });
  assert.equal((await repo.create({ manufacturer: '현대', model: 'x' })).ok, true);
  assert.deepEqual(client.calls[0].steps[0], ['insert', { manufacturer: '현대', model: 'x', model_year: null, nickname: null }]);
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await repo.update(id, { manufacturer: '현대', model: 'y' })).error, ERRORS.NOT_FOUND);
  assert.deepEqual(client.calls[1].steps.find((s) => s[0] === 'eq'), ['eq', 'id', id]);
  assert.equal((await repo.remove(id)).error, ERRORS.NOT_FOUND);
  assert.equal((await repo.remove('../../etc')).error, ERRORS.NOT_FOUND);
  assert.equal(client.calls.length, 3, 'a malformed id never reaches the API');
});

test('a response that arrives after the identity changed is dropped (STALE_IDENTITY), not returned', async () => {
  const session = { epoch: 1 };
  let release;
  const gate = new Promise((r) => { release = r; });
  const client = fakeClient(async () => { await gate; return { data: [{ id: '00000000-0000-4000-8000-000000000001', manufacturer: 'A의 차', model: 'x', verification_status: 'SELF_REPORTED_UNVERIFIED', created_at: 'c', updated_at: 'u' }], error: null }; });
  const repo = createVehicleRepository({ client, session });
  const pending = repo.list();
  session.epoch = 2; // sign-out or account switch happened while the request was in flight
  release();
  assert.deepEqual(await pending, { ok: false, error: ERRORS.STALE_IDENTITY });
});
