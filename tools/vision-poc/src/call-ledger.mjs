// P12-F: every real call to the hosted model passes through here. The count lives in a file, so a limit holds across runs and scripts.
// Nothing about the request is stored: only when, why, and how it went. No image, no key, no URL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const CALL_LIMIT = 20;

export class CallLimitReached extends Error { constructor() { super('CALL_LIMIT_REACHED'); this.name = 'CallLimitReached'; } }

export function createCallLedger({ file, limit = CALL_LIMIT, now = () => new Date().toISOString() }) {
  const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { limit, calls: [] });
  return Object.freeze({
    get count() { return read().calls.length; },
    /** Counts a call before it goes out, so a crash can never under-count. */
    claim(purpose) {
      const state = read();
      if (state.calls.length >= limit) throw new CallLimitReached();
      const entry = { n: state.calls.length + 1, at: now(), purpose };
      state.calls.push(entry);
      writeFileSync(file, JSON.stringify(state, null, 1));
      return entry.n;
    },
    record(n, details) {
      const state = read();
      Object.assign(state.calls.find(call => call.n === n), details);
      writeFileSync(file, JSON.stringify(state, null, 1));
    },
  });
}

/** A fetch that spends one ledger entry per request and measures it. Same shape as fetch, so roboflow-client.mjs is unchanged. */
export function ledgeredFetch({ ledger, purpose, fetchImpl = fetch }) {
  return async (url, init) => {
    const n = ledger.claim(typeof purpose === 'function' ? purpose() : purpose);
    const started = performance.now();
    try {
      const response = await fetchImpl(url, init);
      const text = await response.text();
      ledger.record(n, { httpStatus: response.status, roundTripMs: Math.round(performance.now() - started), requestBytes: Buffer.byteLength(init.body ?? ''), responseBytes: Buffer.byteLength(text) });
      return new Response(text, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' } });
    } catch (error) {
      ledger.record(n, { error: error?.name ?? 'Error', roundTripMs: Math.round(performance.now() - started) });
      throw error;
    }
  };
}
