// Turns the service database settings into pool options, or refuses them. Never logs or returns a reason with a value in it.
//   Plaintext is allowed only where a network cannot observe it: loopback, or a single-label private host such as
//   Render's Internal URL. Any other host needs a pinned CA, which turns on full verification of chain and hostname.
//   A Supabase host also needs a private schema, because tables created in `public` are exposed on its Data API.
const LOOPBACK = Object.freeze(['127.0.0.1', 'localhost', '[::1]', '::1']);
/** Managed or exposed by the platform: CarScope never lives in these. */
const RESERVED_SCHEMAS = Object.freeze(['public', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'information_schema']);
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertPrivateSchemaName(schema) {
  if (typeof schema !== 'string' || !SCHEMA_NAME.test(schema) || schema.startsWith('pg_') || schema.startsWith('supabase') || RESERVED_SCHEMAS.includes(schema)) throw new Error('DATABASE_SCHEMA_NOT_PRIVATE');
  return schema;
}

/** Decoded CA certificate. A private key in this value means the wrong file was pasted, so it is refused. */
export function decodeCaCertificate(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Error('DATABASE_CA_INVALID');
  const pem = Buffer.from(base64, 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN CERTIFICATE-----') || !pem.includes('-----END CERTIFICATE-----') || pem.includes('PRIVATE KEY')) throw new Error('DATABASE_CA_INVALID');
  return pem;
}

const isSupabaseHost = (host) => /(^|\.)supabase\.(co|com)$/i.test(host);

export function databasePoolOptions({ url, caPemBase64, schema }) {
  let u;
  try { u = new URL(url); } catch { throw new Error('INVALID_DATABASE_URL'); }
  if (!['postgresql:', 'postgres:'].includes(u.protocol) || !u.hostname || !u.username || !u.password ||
      !u.pathname || u.pathname === '/' || u.hash || u.search) throw new Error('INVALID_DATABASE_URL');
  const expectedSchema = schema ? assertPrivateSchemaName(schema) : null;
  if (isSupabaseHost(u.hostname) && !expectedSchema) throw new Error('DATABASE_SCHEMA_REQUIRED');
  const privateNetwork = LOOPBACK.includes(u.hostname) || !u.hostname.includes('.');
  if (!caPemBase64 && !privateNetwork) throw new Error('DATABASE_TLS_CA_REQUIRED');
  return {
    connectionString: url, expectedSchema,
    ...(caPemBase64 ? { ssl: { ca: decodeCaCertificate(caPemBase64), rejectUnauthorized: true } } : {}),
  };
}
