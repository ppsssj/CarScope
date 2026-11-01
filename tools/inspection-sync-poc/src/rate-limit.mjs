// Fixed-window request limiter per client key and route class. In-memory, single process (like the session store).
export const DEFAULT_RATES = Object.freeze({
  create: { limit: 10, windowMs: 60_000 },
  claim: { limit: 20, windowMs: 60_000 },
  submit: { limit: 30, windowMs: 60_000 },
  read: { limit: 120, windowMs: 60_000 },
  static: { limit: 240, windowMs: 60_000 },
});

export class RateLimiter {
  #windows = new Map();
  constructor({ rates = DEFAULT_RATES, now = Date.now, maxKeys = 10_000 } = {}) { this.rates = rates; this.now = now; this.maxKeys = maxKeys; }

  /** { ok:true } or { ok:false, retryAfterS } */
  check(clientKey, routeClass) {
    const rate = this.rates[routeClass];
    if (!rate) return { ok: true };
    const t = this.now(), key = `${routeClass}|${clientKey}`;
    let w = this.#windows.get(key);
    if (!w || t >= w.start + rate.windowMs) {
      if (this.#windows.size >= this.maxKeys) this.#prune(t);
      w = { start: t, count: 0 };
      this.#windows.set(key, w);
    }
    w.count++;
    return w.count <= rate.limit ? { ok: true } : { ok: false, retryAfterS: Math.ceil((w.start + rate.windowMs - t) / 1000) };
  }

  #prune(t) {
    for (const [k, w] of this.#windows) {
      const rate = this.rates[k.split('|')[0]];
      if (!rate || t >= w.start + rate.windowMs) this.#windows.delete(k);
    }
  }
}
