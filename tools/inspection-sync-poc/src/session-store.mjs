// AR-02A session storage boundary. The service only talks to this interface, so a durable store (AR-02B) can replace
// the memory one without touching the protocol or state machine.
//
// interface SessionStore {
//   insert(session, { maxSessions }): Promise<boolean>   // ATOMIC capacity check + insert: false (nothing written) when
//                                                        // the store already holds >= maxSessions sessions
//   get(id): Promise<Session|null>                        // a copy
//   idByTokenHash(kind, hash): Promise<string|null>       // kind: 'invite' | 'submit' | 'receiver'
//   update(id, mutate(copy) => copy): Promise<Session|null>
//                                                         // ATOMIC read-modify-write of one session: mutate sees the
//                                                         // current stored value; if it throws, nothing is written and
//                                                         // the error propagates; null if the id does not exist
//   delete(id, predicate?(copy) => boolean): Promise<boolean>
//                                                         // ATOMIC conditional delete: only if predicate(current) holds
//   all(): Promise<Session[]>                             // sweep candidates only (may be stale by the time it is used)
//   count(): Promise<number>
// }
//
// Guarantees a durable store must provide (AR-02B), all per session and linearizable:
//   - update: a transaction or conditional write (compare-and-set on a version column / row lock). mutate may run more
//     than once on retry, so it must stay a pure function of its input (the service only reads the clock in it).
//   - insert: the capacity check and the insert in one transaction (e.g. a counter row updated in the same transaction,
//     or SERIALIZABLE isolation), plus unique constraints on id and on each token hash.
//   - delete with predicate: a conditional delete (DELETE ... WHERE id = ? AND <condition>) in one statement.
//   - token-hash indexes updated in the same transaction as the session row.
//
// MemorySessionStore is for a SINGLE local process only: no method body awaits, so each call is atomic on the one JS
// thread. Every session is lost when the process stops, and two instances never share state, so it must not back a
// multi-instance (e.g. serverless) deployment.

const clone = (s) => (s ? structuredClone(s) : null);

export class MemorySessionStore {
  #sessions = new Map();
  #index = { invite: new Map(), submit: new Map(), receiver: new Map() };
  kind = 'memory-single-process';

  async insert(session, { maxSessions = Infinity } = {}) {
    if (this.#sessions.has(session.id)) throw new Error('duplicate session id');
    if (this.#sessions.size >= maxSessions) return false;
    this.#sessions.set(session.id, clone(session));
    this.#reindex(null, session);
    return true;
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
  async delete(id, predicate = () => true) {
    const current = this.#sessions.get(id);
    if (!current || !predicate(clone(current))) return false;
    this.#sessions.delete(id);
    this.#reindex(current, null);
    return true;
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
