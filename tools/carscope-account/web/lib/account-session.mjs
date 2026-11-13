// P15: who is signed in on this page, and when previous account data must disappear.
//
// * The page shows account data only for a user the Auth server confirmed (getUser), never for a user read from
//   storage alone (getSession).
// * Every identity change (sign-out, a different account signing in here or in another tab, a refresh failure that ends
//   the session) bumps `epoch` and emits `clear` synchronously, before any network call. Repositories capture the
//   epoch at the start of a request and drop the response if it changed, so a slow response for account A can never
//   be painted for account B.
// * Supabase recommends not awaiting other Supabase calls inside onAuthStateChange; the handler defers its work.
// Tokens are never stored on this object or passed to listeners: listeners get { status, user, epoch, reason }.

import { AUTH_REASONS, confirmUser } from './auth-flow.mjs';

export const STATUS = Object.freeze({
  RESTORING: 'RESTORING',
  SIGNED_OUT: 'SIGNED_OUT',
  SIGNED_IN: 'SIGNED_IN',
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
});

/** The display subset of a confirmed Supabase user. Metadata is display only, never used for access decisions. */
export function displayUser(user) {
  const meta = user?.user_metadata ?? {};
  const pick = (...values) => values.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim() ?? null;
  const name = pick(meta.full_name, meta.name);
  const avatar = pick(meta.avatar_url, meta.picture);
  return Object.freeze({
    id: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    displayName: name ? name.slice(0, 80) : null,
    avatarUrl: avatar && /^https:\/\/[^/\s]+\/\S*$/.test(avatar) && avatar.length <= 2048 ? avatar : null,
  });
}

export function createAccountSession({ client, defer = (fn) => setTimeout(fn, 0) }) {
  let state = { status: STATUS.RESTORING, user: null, epoch: 0, reason: null };
  const listeners = new Set();
  let subscription = null;
  let confirmSeq = 0;
  let inflight = null; // the one running confirmation, shared by start(), retry() and auth events

  const snapshot = () => state;
  function emit(type) { for (const listener of listeners) listener(type, state); }
  function set(next) { state = Object.freeze({ ...state, ...next }); emit('state'); }

  /** Drops everything that belonged to the previous identity, synchronously, and supersedes any running check. */
  function clear(reason) {
    confirmSeq += 1;
    inflight = null;
    state = Object.freeze({ status: STATUS.SIGNED_OUT, user: null, epoch: state.epoch + 1, reason: reason ?? null });
    emit('clear');
    emit('state');
  }

  function confirm() {
    if (inflight) return inflight;
    const run = confirmOnce().finally(() => { if (inflight === run) inflight = null; });
    inflight = run;
    return run;
  }

  async function confirmOnce() {
    const seq = ++confirmSeq;
    const result = await confirmUser(client);
    if (seq !== confirmSeq) return inflight ?? undefined; // a newer identity event superseded this check
    if (result.ok) {
      const user = displayUser(result.user);
      if (state.user && state.user.id !== user.id) clear('ACCOUNT_SWITCHED');
      set({ status: STATUS.SIGNED_IN, user, reason: null });
    } else if (result.reason === AUTH_REASONS.AUTH_UNAVAILABLE) {
      // Keep nobody on screen: an unconfirmed session must not show the last user's vehicles.
      if (state.user) clear(AUTH_REASONS.AUTH_UNAVAILABLE);
      set({ status: STATUS.AUTH_UNAVAILABLE, reason: AUTH_REASONS.AUTH_UNAVAILABLE });
    } else {
      clear(AUTH_REASONS.SESSION_INVALID);
    }
  }

  function onAuthEvent(event, session) {
    const incoming = session?.user?.id ?? null;
    if (event === 'SIGNED_OUT' || (!incoming && event !== 'INITIAL_SESSION')) {
      if (state.user) clear('SESSION_ENDED');
      // With nobody on screen, a running confirmation reports the outcome itself (it may have caused this event).
      else if (!inflight && state.status !== STATUS.SIGNED_OUT) set({ status: STATUS.SIGNED_OUT });
      return;
    }
    if (incoming && state.user && incoming !== state.user.id) {
      clear('ACCOUNT_SWITCHED');
      defer(() => { confirm(); });
      return;
    }
    if (event === 'SIGNED_IN' && incoming && !state.user) defer(() => { confirm(); });
  }

  async function start() {
    if (!subscription) subscription = client.auth.onAuthStateChange((event, session) => onAuthEvent(event, session)).data.subscription;
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session) {
      // A stored session whose refresh failed is gone; supabase-js removed it and we show the signed-out state.
      if (state.status === STATUS.RESTORING) set({ status: STATUS.SIGNED_OUT, reason: error ? AUTH_REASONS.SESSION_INVALID : null });
      return;
    }
    await confirm();
  }

  async function retry() { set({ status: STATUS.RESTORING, reason: null }); await confirm(); }

  /** Clears the screen first, then ends this browser's session on the Auth server (scope local). */
  async function signOut() {
    clear('USER_SIGNED_OUT');
    const { error } = await client.auth.signOut({ scope: 'local' });
    // supabase-js removes the local session even when the server call fails; report the server part separately.
    return { localCleared: true, serverConfirmed: !error };
  }

  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function stop() { subscription?.unsubscribe(); subscription = null; listeners.clear(); }

  return Object.freeze({ start, retry, signOut, subscribe, snapshot, stop, get epoch() { return state.epoch; } });
}
