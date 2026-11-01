// AR-02A session storage boundary. The service only talks to this interface, so a durable store (AR-02B) can replace
// the memory one without touching the protocol or state machine.
//
// interface SessionStore {
//   insert(session): Promise<void>                       // new session; ids and token hashes are unique
//   get(id): Promise<Session|null>                        // a copy
//   idByTokenHash(kind, hash): Promise<string|null>       // kind: 'invite' | 'submit' | 'receiver'
//   update(id, mutate(copy) => copy): Promise<Session|null>  // ATOMIC read-modify-write per session; if mutate
//                                                         // throws, nothing is written and the error propagates
//                                                         // (a durable store needs a transaction or conditional write)
//   delete(id): Promise<void>
//   all(): Promise<Session[]>                             // sweep only
//   count(): Promise<number>
// }
//
// MemorySessionStore is for a SINGLE local process only. Every session is lost when the process stops, and two
// instances never share state, so it must not back a multi-instance (e.g. serverless) deployment.

const clone = (s) => (s ? structuredClone(s) : null);

export class MemorySessionStore {
  #sessions = new Map();
  #index = { invite: new Map(), submit: new Map(), receiver: new Map() };
  kind = 'memory-single-process';

  async insert(session) {
    if (this.#sessions.has(session.id)) throw new Error('duplicate session id');
    this.#sessions.set(session.id, clone(session));
    this.#reindex(null, session);
  }
  async get(id) { return clone(this.#sessions.get(id)); }
  async idByTokenHash(kind, hash) { return (hash && this.#index[kind]?.get(hash)) ?? null; }
  async update(id, mutate) {
    const current = this.#sessions.get(id);
    if (!current) return null;
    const next = mutate(clone(current));
    this.#sessions.set(id, clone(next));
    this.#reindex(current, next);
    return clone(next);
  }
  async delete(id) {
    const current = this.#sessions.get(id);
    if (!current) return;
    this.#sessions.delete(id);
    this.#reindex(current, null);
  }
  async all() { return [...this.#sessions.values()].map(clone); }
  async count() { return this.#sessions.size; }

  #reindex(before, after) {
    for (const kind of ['invite', 'submit', 'receiver']) {
      const key = `${kind}Hash`;
      if (before?.[key] && before[key] !== after?.[key]) this.#index[kind].delete(before[key]);
      if (after?.[key]) this.#index[kind].set(after[key], after.id);
    }
  }
}
