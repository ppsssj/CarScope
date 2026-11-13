// P16: "내 차량 → 차량 선택 → 3D 점검". The only thing that travels to the 3D page is the vehicle's UUID in the query
// (?vehicle=<uuid>). It is not a credential: the 3D page reads the vehicle again through RLS with the browser's own
// session on the same origin, so a tampered, foreign or deleted UUID simply finds nothing. Display values (name,
// model, year) never come from the URL. No access or refresh token is put in a URL, fragment, postMessage or storage
// by this module.

export const INSPECT_PATH = '/inspect/inspect.html';
export const VEHICLES_PATH = '/account/vehicles.html';
export const VEHICLE_PARAM = 'vehicle';
// gen_random_uuid() output: lowercase RFC 4122 version 4.
export const VEHICLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Same-origin tabs hear about deletions here at once (a vehicle id only, never a token or user id).
export const SELECTION_CHANNEL = 'carscope-account-vehicles';

/** @returns {{present: false} | {present: true, valid: false} | {present: true, valid: true, id: string}} */
export function parseVehicleParam(search) {
  let params;
  try { params = new URLSearchParams(search); } catch { return Object.freeze({ present: true, valid: false }); }
  const values = params.getAll(VEHICLE_PARAM);
  if (values.length === 0) return Object.freeze({ present: false });
  if (values.length !== 1 || !VEHICLE_ID.test(values[0])) return Object.freeze({ present: true, valid: false });
  return Object.freeze({ present: true, valid: true, id: values[0] });
}

export function inspectHref(id) {
  if (!VEHICLE_ID.test(id)) throw new Error('INVALID_VEHICLE_ID');
  return `${INSPECT_PATH}?${VEHICLE_PARAM}=${id}`;
}

/** The same URL without the vehicle parameter (other parameters and the fragment are kept). */
export function withoutVehicleParam(href) {
  const url = new URL(href);
  url.searchParams.delete(VEHICLE_PARAM);
  return url.pathname + url.search + url.hash;
}

/** Same-origin path accepted from config.json for the 3D page mounted on the account server. */
export function validateInspectPath(value) {
  return value === INSPECT_PATH ? INSPECT_PATH : null;
}

export const SELECTION = Object.freeze({
  NONE: 'NONE', // trial: no vehicle requested
  CHECKING: 'CHECKING',
  SELECTED: 'SELECTED',
  INVALID: 'INVALID', // malformed parameter
  NOT_FOUND: 'NOT_FOUND', // deleted, another account's, or never existed (RLS cannot tell these apart, by design)
  SIGNED_OUT: 'SIGNED_OUT',
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  UNCONFIRMED: 'UNCONFIRMED', // network or server error while reading the vehicle
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  EMBEDDED: 'EMBEDDED', // Android WebView: no account features at all
});

/** States that end a selection for good: the page drops ?vehicle and never re-reads that id. */
export const TERMINAL = Object.freeze(new Set([SELECTION.INVALID, SELECTION.NOT_FOUND, SELECTION.SIGNED_OUT, SELECTION.ACCOUNT_CHANGED, SELECTION.NOT_CONFIGURED]));

/**
 * The 3D side's selection logic, without DOM. `session` is createAccountSession(); `repo` is createVehicleRepository().
 * `onChange(state, vehicle|null)` is called synchronously when a selection ends, before any network call.
 */
export function createSelectionController({ id, session, repo, onChange }) {
  let state = SELECTION.CHECKING;
  let vehicle = null;
  let checking = null;
  let stopped = false;
  const set = (next, v = null) => { state = next; vehicle = v; onChange(state, vehicle); };
  const ended = () => stopped || TERMINAL.has(state);

  async function verify() {
    if (ended()) return state;
    if (session.snapshot().status !== 'SIGNED_IN') return state;
    if (checking) return checking;
    const epoch = session.epoch;
    checking = (async () => {
      const r = await repo.get(id);
      if (ended() || session.epoch !== epoch) return state; // identity changed meanwhile: that event decided
      if (r.ok) set(SELECTION.SELECTED, r.vehicle);
      else if (r.error === 'NOT_FOUND') set(SELECTION.NOT_FOUND);
      else if (r.error === 'SESSION_EXPIRED') set(SELECTION.SIGNED_OUT);
      else if (r.error !== 'STALE_IDENTITY') set(SELECTION.UNCONFIRMED);
      return state;
    })().finally(() => { checking = null; });
    return checking;
  }

  function end(next) { if (!ended()) set(next); }

  const unsubscribe = session.subscribe((type, s) => {
    if (type === 'clear') {
      // Synchronous: the vehicle disappears before anything else happens.
      end(s.reason === 'ACCOUNT_SWITCHED' ? SELECTION.ACCOUNT_CHANGED : SELECTION.SIGNED_OUT);
      return;
    }
    if (ended()) return;
    if (s.status === 'SIGNED_OUT') end(SELECTION.SIGNED_OUT);
    else if (s.status === 'AUTH_UNAVAILABLE') { if (state !== SELECTION.AUTH_UNAVAILABLE) set(SELECTION.AUTH_UNAVAILABLE); }
    else if (s.status === 'SIGNED_IN' && state !== SELECTION.SELECTED) verify();
  });

  return Object.freeze({
    verify,
    /** Another tab deleted a vehicle. */
    removed(removedId) { if (removedId === id) end(SELECTION.NOT_FOUND); },
    stop() { stopped = true; unsubscribe(); },
    get state() { return state; },
    get vehicle() { return vehicle; },
  });
}
