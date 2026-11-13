// P15: "My Vehicles" data access. The database decides what a user may see or change (RLS on auth.uid());
// this module only validates input, never sends owner_id or verification fields, and drops responses that arrive
// after the signed-in identity changed.

export const SCHEMA = 'carscope_account';
export const VEHICLE_COLUMNS = 'id,manufacturer,model,model_year,nickname,verification_status,created_at,updated_at';
export const VERIFICATION = Object.freeze({ SELF_REPORTED_UNVERIFIED: 'SELF_REPORTED_UNVERIFIED', OEM_VERIFIED: 'OEM_VERIFIED' });
export const VEHICLE_LIMIT = 20;
const FIELDS = ['manufacturer', 'model', 'model_year', 'nickname'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const ERRORS = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  LIMIT_REACHED: 'LIMIT_REACHED',
  NETWORK: 'NETWORK',
  SERVER: 'SERVER',
  STALE_IDENTITY: 'STALE_IDENTITY',
});

function text(value, { field, max, required }) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return required ? { error: `${field}:required` } : { value: null };
  }
  if (typeof value !== 'string') return { error: `${field}:type` };
  const trimmed = value.trim().normalize('NFC');
  if (CONTROL.test(trimmed)) return { error: `${field}:control` };
  if ([...trimmed].length > max) return { error: `${field}:length` };
  return { value: trimmed };
}

/** Accepts only the four user fields. Anything else (owner_id, verification_status, id, ...) is an error, not ignored. */
export function validateVehicleInput(input, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['input:type'] };
  const extra = Object.keys(input).filter((k) => !FIELDS.includes(k));
  if (extra.length) return { ok: false, errors: extra.map((k) => `${k}:not_allowed`) };
  const errors = [];
  const manufacturer = text(input.manufacturer, { field: 'manufacturer', max: 40, required: true });
  const model = text(input.model, { field: 'model', max: 60, required: true });
  const nickname = text(input.nickname, { field: 'nickname', max: 40, required: false });
  let modelYear = null;
  const rawYear = input.model_year;
  if (!(rawYear === undefined || rawYear === null || rawYear === '')) {
    const year = typeof rawYear === 'string' && /^\d{4}$/.test(rawYear.trim()) ? Number(rawYear.trim()) : rawYear;
    if (!Number.isInteger(year) || year < 1950 || year > now.getFullYear() + 2) errors.push('model_year:range');
    else modelYear = year;
  }
  for (const r of [manufacturer, model, nickname]) if (r.error) errors.push(r.error);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { manufacturer: manufacturer.value, model: model.value, model_year: modelYear, nickname: nickname.value } };
}

export function classifyDataError(error) {
  if (!error) return ERRORS.SERVER;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  if (code === '42501') return ERRORS.FORBIDDEN;
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || /JWT/i.test(message)) return ERRORS.SESSION_EXPIRED;
  if (code === '23514' && /vehicle limit/.test(message)) return ERRORS.LIMIT_REACHED;
  if (code === '23514' || code === '22001' || code === '22P02' || code === '23502') return ERRORS.INVALID_INPUT;
  if (error.name === 'TypeError' || /fetch|network/i.test(message) || code === '' && Number(error.status) === 0) return ERRORS.NETWORK;
  return ERRORS.SERVER;
}

/** A row from the API, reduced to what the page shows. Unknown verification values read as unverified. */
export function toVehicle(row) {
  return Object.freeze({
    id: String(row.id),
    manufacturer: String(row.manufacturer),
    model: String(row.model),
    modelYear: Number.isInteger(row.model_year) ? row.model_year : null,
    nickname: typeof row.nickname === 'string' ? row.nickname : null,
    verification: row.verification_status === VERIFICATION.OEM_VERIFIED ? VERIFICATION.OEM_VERIFIED : VERIFICATION.SELF_REPORTED_UNVERIFIED,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  });
}

/**
 * @param {object} deps
 * @param {object} deps.client   supabase-js client
 * @param {{epoch: number}} deps.session  account session; its epoch changes on every identity change
 */
export function createVehicleRepository({ client, session }) {
  const table = () => client.schema(SCHEMA).from('vehicles');

  async function guarded(run) {
    const epoch = session.epoch;
    let result;
    try { result = await run(); } catch (e) { return session.epoch === epoch ? { ok: false, error: classifyDataError(e) } : { ok: false, error: ERRORS.STALE_IDENTITY }; }
    if (session.epoch !== epoch) return { ok: false, error: ERRORS.STALE_IDENTITY };
    if (result.error) return { ok: false, error: classifyDataError(result.error) };
    return { ok: true, data: result.data };
  }

  async function list() {
    const r = await guarded(() => table().select(VEHICLE_COLUMNS).order('created_at', { ascending: false }).limit(VEHICLE_LIMIT));
    return r.ok ? { ok: true, vehicles: (r.data ?? []).map(toVehicle) } : r;
  }

  async function create(input) {
    const v = validateVehicleInput(input);
    if (!v.ok) return { ok: false, error: ERRORS.INVALID_INPUT, fields: v.errors };
    const r = await guarded(() => table().insert(v.value).select(VEHICLE_COLUMNS).single());
    return r.ok ? { ok: true, vehicle: toVehicle(r.data) } : r;
  }

  async function update(id, input) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: ERRORS.NOT_FOUND };
    const v = validateVehicleInput(input);
    if (!v.ok) return { ok: false, error: ERRORS.INVALID_INPUT, fields: v.errors };
    const r = await guarded(() => table().update(v.value).eq('id', id).select(VEHICLE_COLUMNS));
    if (!r.ok) return r;
    return r.data?.length === 1 ? { ok: true, vehicle: toVehicle(r.data[0]) } : { ok: false, error: ERRORS.NOT_FOUND };
  }

  async function remove(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: ERRORS.NOT_FOUND };
    const r = await guarded(() => table().delete().eq('id', id).select('id'));
    if (!r.ok) return r;
    return r.data?.length === 1 ? { ok: true } : { ok: false, error: ERRORS.NOT_FOUND };
  }

  async function get(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: ERRORS.NOT_FOUND };
    const r = await guarded(() => table().select(VEHICLE_COLUMNS).eq('id', id).maybeSingle());
    if (!r.ok) return r;
    return r.data ? { ok: true, vehicle: toVehicle(r.data) } : { ok: false, error: ERRORS.NOT_FOUND };
  }

  return Object.freeze({ list, create, update, remove, get });
}

/** Creates the caller's profile row on first sign-in. Display name and avatar come from the confirmed user. */
export async function ensureProfile({ client, user }) {
  const profiles = () => client.schema(SCHEMA).from('profiles');
  const existing = await profiles().select('id').eq('id', user.id).maybeSingle();
  if (existing.error) return { ok: false, error: classifyDataError(existing.error) };
  if (existing.data) return { ok: true, created: false };
  const inserted = await profiles().insert({ id: user.id, display_name: user.displayName, avatar_url: user.avatarUrl });
  if (inserted.error && inserted.error.code !== '23505') return { ok: false, error: classifyDataError(inserted.error) };
  return { ok: true, created: !inserted.error };
}
