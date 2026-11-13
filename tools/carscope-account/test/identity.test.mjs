// P15 server-side identity verification (JWKS, claims) and the boundary to the P14-B external data service.
// Keys are generated per run; no Supabase project is contacted. LOCAL_PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { randomUUID, webcrypto } from 'node:crypto';
import { REASONS, bearerToken, createSupabaseIdentityVerifier, isVerifiedIdentity, supabaseProjectOrigin } from '../src/supabase-identity.mjs';
import { EXTERNAL_DATA_STATUS, carscopeSessionKey } from '../src/external-data-identity.mjs';
import { vehicleDataAvailability } from '../../vehicle-data-api/src/availability.mjs';
import { ExternalVehicleDataService } from '../../vehicle-data-api/src/service.mjs';
import { OAuthStateStore, Secret, TestOnlyMemoryTokenStore } from '../../vehicle-data-api/src/credentials.mjs';
import { AVAILABILITY } from '../../vehicle-data-api/src/model.mjs';

const { subtle } = webcrypto;
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const ISS = `${URL_}/auth/v1`;
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const SALT = 's'.repeat(32);

async function keys() {
  const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rsa = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const ecKid = randomUUID(), rsaKid = randomUUID();
  const jwks = { keys: [
    { ...(await subtle.exportKey('jwk', ec.publicKey)), kid: ecKid, alg: 'ES256', use: 'sig' },
    { ...(await subtle.exportKey('jwk', rsa.publicKey)), kid: rsaKid, alg: 'RS256', use: 'sig' },
  ] };
  return { ec, rsa, ecKid, rsaKid, jwks };
}

function fetchFrom(state) {
  return async (url, init) => {
    state.calls.push({ url, init });
    if (state.down) throw new TypeError('fetch failed');
    if (state.status && state.status !== 200) return new Response('{}', { status: state.status });
    return new Response(JSON.stringify(state.jwks), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function sign(k, claims, { alg = 'ES256', kid = k.ecKid, header = {} } = {}) {
  const h = b64u({ alg, typ: 'JWT', kid, ...header });
  const p = b64u(claims);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = alg === 'RS256' ? await subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, k.rsa.privateKey, data) : await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.ec.privateKey, data);
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

const now = () => Date.parse('2026-11-13T00:00:00Z');
const nowS = Math.floor(now() / 1000);
const base = (over = {}) => ({ iss: ISS, aud: 'authenticated', role: 'authenticated', sub: randomUUID(), exp: nowS + 600, iat: nowS - 10, session_id: randomUUID(), aal: 'aal1', is_anonymous: false, ...over });

async function setup() {
  const k = await keys();
  const state = { jwks: k.jwks, calls: [], down: false };
  const verifier = createSupabaseIdentityVerifier({ supabaseUrl: URL_, fetchImpl: fetchFrom(state), now });
  return { k, state, verifier };
}

test('a valid ES256 or RS256 Supabase access token yields the verified user id and nothing else', async () => {
  const { k, verifier, state } = await setup();
  const claims = base({ email: 'a@example.com', user_metadata: { sub: randomUUID(), role: 'service_role' }, app_metadata: { provider: 'google' } });
  for (const alg of ['ES256', 'RS256']) {
    const r = await verifier.verify(await sign(k, claims, { alg, kid: alg === 'RS256' ? k.rsaKid : k.ecKid }));
    assert.equal(r.ok, true, alg);
    assert.equal(r.identity.userId, claims.sub, 'sub from the signed claims, not user_metadata');
    assert.deepEqual(Object.keys(r.identity).sort(), ['aal', 'expiresAt', 'issuer', 'provider', 'sessionId', 'userId']);
    assert.ok(isVerifiedIdentity(r.identity));
  }
  assert.equal(state.calls.length, 1, 'JWKS fetched once and cached');
  assert.equal(state.calls[0].url, `${ISS}/.well-known/jwks.json`);
  assert.equal(state.calls[0].init.redirect, 'manual');
});

test('every malformed, forged or out-of-contract token is refused with a specific reason', async () => {
  const { k, verifier } = await setup();
  const other = await keys();
  const c = base();
  const cases = [
    ['', REASONS.MALFORMED], ['a.b', REASONS.MALFORMED], ['x'.repeat(9000), REASONS.MALFORMED],
    [`${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(c)}.`, REASONS.MALFORMED],
    [`${b64u({ alg: 'none', typ: 'JWT', kid: k.ecKid })}.${b64u(c)}.${b64u('x')}`, REASONS.UNSUPPORTED_ALGORITHM],
    [`${b64u({ alg: 'HS256', typ: 'JWT', kid: k.ecKid })}.${b64u(c)}.${b64u('x')}`, REASONS.UNSUPPORTED_ALGORITHM],
    [await sign(k, c, { header: { jku: 'https://evil.example/jwks' } }), REASONS.UNSUPPORTED_ALGORITHM],
    [await sign(k, c, { kid: 'nope' }), REASONS.UNKNOWN_KEY],
    [await sign(k, c, { alg: 'ES256', kid: k.rsaKid }), REASONS.UNKNOWN_KEY],
    [await sign(other, c, { kid: k.ecKid }), REASONS.BAD_SIGNATURE],
    [await sign(k, base({ iss: 'https://other.supabase.co/auth/v1' })), REASONS.WRONG_ISSUER],
    [await sign(k, base({ aud: 'anon' })), REASONS.WRONG_AUDIENCE],
    [await sign(k, base({ role: 'anon' })), REASONS.NOT_AUTHENTICATED_ROLE],
    [await sign(k, base({ role: 'service_role' })), REASONS.NOT_AUTHENTICATED_ROLE],
    [await sign(k, base({ is_anonymous: true })), REASONS.ANONYMOUS_USER],
    [await sign(k, base({ exp: nowS })), REASONS.EXPIRED],
    [await sign(k, base({ exp: undefined })), REASONS.EXPIRED],
    [await sign(k, base({ nbf: nowS + 120 })), REASONS.NOT_YET_VALID],
    [await sign(k, base({ sub: 'not-a-uuid' })), REASONS.BAD_SUBJECT],
  ];
  for (const [token, reason] of cases) assert.equal((await verifier.verify(token)).reason, reason, `${reason}: ${token.slice(0, 40)}`);
  // A tampered payload under an otherwise valid signature.
  const good = await sign(k, c);
  const [h, , s] = good.split('.');
  assert.equal((await verifier.verify(`${h}.${b64u({ ...c, sub: randomUUID() })}.${s}`)).reason, REASONS.BAD_SIGNATURE);
});

test('Auth server / JWKS outage is AUTH_UNAVAILABLE, not "invalid token"; unknown kids cannot force refetch storms', async () => {
  const { k, verifier, state } = await setup();
  state.down = true;
  assert.equal((await verifier.verify(await sign(k, base()))).reason, REASONS.AUTH_UNAVAILABLE);
  state.down = false; state.status = 503;
  assert.equal((await verifier.verify(await sign(k, base()))).reason, REASONS.AUTH_UNAVAILABLE);
  state.status = 200;
  assert.equal((await verifier.verify(await sign(k, base()))).ok, true);
  const before = state.calls.length;
  for (let i = 0; i < 20; i += 1) assert.equal((await verifier.verify(await sign(k, base(), { kid: randomUUID() }))).reason, REASONS.UNKNOWN_KEY);
  assert.equal(state.calls.length, before, 'no refetch within 30 s of the last fetch');
});

test('JWKS entries carrying private or symmetric material are never imported', async () => {
  const { k, state, verifier } = await setup();
  const priv = await subtle.exportKey('jwk', k.ec.privateKey);
  state.jwks = { keys: [{ ...priv, kid: k.ecKid, alg: 'ES256' }, { kty: 'oct', k: 'c2VjcmV0', kid: 'hs', alg: 'HS256' }] };
  assert.equal((await verifier.verify(await sign(k, base()))).reason, REASONS.UNKNOWN_KEY);
});

test('only a bare https project origin (or loopback http) is accepted, and TLS verification must be on', () => {
  for (const bad of ['http://x.supabase.co', 'https://x.supabase.co/rest', 'https://u:p@x.supabase.co', 'https://x.supabase.co?a', 'ftp://x', 'nope', '']) {
    assert.throws(() => supabaseProjectOrigin(bad), /SUPABASE_URL_INVALID/, bad);
  }
  assert.equal(supabaseProjectOrigin('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  const prior = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try { assert.throws(() => createSupabaseIdentityVerifier({ supabaseUrl: URL_ }), /TLS_VERIFICATION_DISABLED/); }
  finally { if (prior === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prior; }
});

test('bearerToken reads only a strict Authorization header', () => {
  assert.equal(bearerToken('Bearer a.b.c'), 'a.b.c');
  for (const bad of ['bearer a.b.c', 'Bearer  a.b.c', 'Bearer a.b', 'Basic a.b.c', 'Bearer a.b.c ', undefined]) assert.equal(bearerToken(bad), null);
});

test('the CarScope session key needs a verified identity, hides the Supabase id, and is stable per user', async () => {
  const { k, verifier } = await setup();
  const claims = base();
  const { identity } = await verifier.verify(await sign(k, claims));
  const key = carscopeSessionKey(identity, { salt: SALT, now });
  assert.match(key, /^csu_[A-Za-z0-9_-]{43}$/);
  assert.ok(!key.includes(claims.sub) && !key.includes(claims.sub.replace(/-/g, '')));
  const again = (await verifier.verify(await sign(k, { ...claims, session_id: randomUUID() }))).identity;
  assert.equal(carscopeSessionKey(again, { salt: SALT, now }), key, 'same user, new session → same CarScope key');
  assert.notEqual(carscopeSessionKey(identity, { salt: 't'.repeat(32), now }), key);
  assert.throws(() => carscopeSessionKey({ ...identity }, { salt: SALT, now }), /UNVERIFIED_IDENTITY/, 'a copied / client-built object is refused');
  assert.throws(() => carscopeSessionKey({ provider: 'SUPABASE_AUTH', userId: claims.sub, issuer: ISS, expiresAt: Date.now() + 1e6 }, { salt: SALT, now }), /UNVERIFIED_IDENTITY/);
  assert.throws(() => carscopeSessionKey(identity, { salt: 'short', now }), /SALT_TOO_SHORT/);
  assert.ok(!inspect(identity).includes('eyJ'));
});

test('Google / Supabase sign-in grants no external vehicle data: providers stay DISABLED and nothing is called', async () => {
  const { k, verifier } = await setup();
  const { identity } = await verifier.verify(await sign(k, base()));
  const sessionKey = carscopeSessionKey(identity, { salt: SALT, now });
  assert.deepEqual(EXTERNAL_DATA_STATUS, { HYUNDAI_DEVELOPERS: 'BLOCKED', PLEOS_VEHICLE_DATA: 'BLOCKED', reason: 'SEPARATE_PROVIDER_LOGIN_CONSENT_AND_OWNERSHIP_REQUIRED' });
  const availability = vehicleDataAvailability({});
  for (const p of ['HYUNDAI_DEVELOPERS', 'PLEOS_VEHICLE_DATA']) {
    assert.equal(availability[p].availability, AVAILABILITY.DISABLED);
    assert.equal(availability[p].provider, null);
  }
  // Even a test-mode service with a provider object refuses to read for a signed-in user without provider login,
  // consent and an owner-confirmed binding; the provider is never called.
  const calls = [];
  const provider = new Proxy({}, { get: (_t, name) => (...args) => { calls.push(name); throw new Error('provider must not be called'); } });
  const service = new ExternalVehicleDataService({ providers: { HYUNDAI_DEVELOPERS: provider }, tokenStore: new TestOnlyMemoryTokenStore({}), keySalt: new Secret('fixture-salt'), states: new OAuthStateStore({}), testMode: true });
  const readings = await service.read({ sessionKey, provider: 'HYUNDAI_DEVELOPERS', carscopeVehicleId: randomUUID(), features: ['odometer'] });
  assert.equal(readings[0].availability, AVAILABILITY.NOT_CONNECTED);
  assert.equal(readings[0].reason, 'NO_OWNER_CONFIRMED_BINDING');
  assert.deepEqual(calls, []);
});
