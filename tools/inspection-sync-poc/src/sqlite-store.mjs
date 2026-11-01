// Experimental Node 22.16 SQLite adapter: one local disk, multiple processes; never a network filesystem/serverless DB.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RATES } from './rate-limit.mjs';
import { createHash } from 'node:crypto';

const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const inside = (root, target) => { const rel = path.relative(root, target); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
const decode = (row) => row ? JSON.parse(row.data) : null;
const transitions = {
  CREATED: ['CREATED', 'CLAIMED', 'CANCELLED', 'EXPIRED'],
  CLAIMED: ['CLAIMED', 'RESULT_SUBMITTED', 'CANCELLED', 'EXPIRED'],
  RESULT_SUBMITTED: ['RESULT_SUBMITTED', 'ACCEPTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['ACCEPTED'], CANCELLED: ['CANCELLED'], EXPIRED: ['EXPIRED'],
};

export class SQLiteSessionStore {
  kind = 'sqlite-experimental-single-host';
  #db;
  constructor({ filename, timeoutMs = 5000 } = {}) {
    if (!filename || !path.isAbsolute(filename)) throw new Error('An absolute external database filename is required');
    // Resolve the existing parent (including symlinks); never create DB files inside this checkout.
    const parent = realpathSync(path.dirname(filename));
    for (let cursor = parent; ; cursor = path.dirname(cursor)) {
      if (existsSync(path.join(cursor, '.git'))) throw new Error('Database must be outside any repository');
      if (path.dirname(cursor) === cursor) break;
    }
    const resolved = path.join(parent, path.basename(filename));
    let target = resolved;
    try { target = realpathSync(resolved); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (inside(repo, target) || inside(repo, resolved)) throw new Error('Database must be outside the repository');
    this.#db = new DatabaseSync(resolved, { timeout: timeoutMs, allowExtension: false });
    try {
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      const version = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw new Error('Unsupported database schema');
      this.transaction(() => this.#db.exec(readFileSync(new URL('./sqlite-schema.sql', import.meta.url), 'utf8')));
    } catch (e) { this.#db.close(); throw e; }
  }
  // No await inside a transaction: mutate/predicate must be synchronous, as in MemorySessionStore.
  transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      if (out?.then) throw new Error('Asynchronous transaction callback is forbidden');
      this.#db.exec('COMMIT');
      return out;
    } catch (e) { this.#db.exec('ROLLBACK'); throw e; }
  }
  #get(id) { return decode(this.#db.prepare('SELECT data FROM sessions WHERE id=?').get(id)); }
  #tokens(s) {
    this.#db.prepare('DELETE FROM session_tokens WHERE session_id=?').run(s.id);
    for (const kind of ['invite', 'submit', 'receiver']) {
      if (s[`${kind}Hash`]) this.#db.prepare('INSERT INTO session_tokens VALUES (?, ?, ?)').run(s[`${kind}Hash`], kind, s.id);
    }
  }
  async insert(session, { maxSessions = Infinity } = {}) {
    return this.transaction(() => {
      if (this.#get(session.id)) throw new Error('duplicate session id');
      if (this.#db.prepare('SELECT count(*) AS n FROM sessions').get().n >= maxSessions) return false;
      this.#db.prepare('INSERT INTO sessions VALUES (?, ?)').run(session.id, JSON.stringify(session));
      this.#tokens(session);
      return true;
    });
  }
  async get(id) { return this.#get(id); }
  async idByTokenHash(kind, hash) { return hash ? this.#db.prepare('SELECT session_id FROM session_tokens WHERE kind=? AND hash=?').get(kind, hash)?.session_id ?? null : null; }
  async update(id, mutate) {
    return this.transaction(() => {
      const before = this.#get(id);
      if (!before) return null;
      const next = mutate(structuredClone(before));
      if (!next || next.then || next.id !== id || !transitions[before.state]?.includes(next.state)) throw new Error('Invalid store transition');
      if (['RESULT_SUBMITTED', 'ACCEPTED'].includes(before.state) && next.resultDigest !== before.resultDigest && next.state !== 'CANCELLED') throw new Error('Result digest is immutable');
      if (before.result && next.result && JSON.stringify(before.result) !== JSON.stringify(next.result)) throw new Error('Submitted result is immutable');
      this.#db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(next), id);
      this.#tokens(next);
      return structuredClone(next);
    });
  }
  async delete(id, predicate = () => true) {
    return this.transaction(() => {
      const current = this.#get(id);
      if (!current) return false;
      const decision = predicate(current);
      if (decision?.then) throw new Error('Asynchronous predicate is forbidden');
      if (!decision) return false;
      return this.#db.prepare('DELETE FROM sessions WHERE id=?').run(id).changes === 1;
    });
  }
  async all() { return this.#db.prepare('SELECT data FROM sessions').all().map(decode); }
  async count() { return this.#db.prepare('SELECT count(*) AS n FROM sessions').get().n; }
  // Bounded shared fixed windows. Hash keys so client addresses and bearer tokens are not persisted verbatim.
  rateCheck(client, route, { rates = DEFAULT_RATES, now = Date.now, maxKeys = 10000 } = {}) {
    const rate = rates[route];
    if (!rate) return { ok: true };
    return this.transaction(() => {
      const t = now();
      this.#db.prepare('DELETE FROM rate_windows WHERE expires_at<=?').run(t);
      const key = createHash('sha256').update(`${route}|${client}`).digest('hex');
      const row = this.#db.prepare('SELECT count, expires_at FROM rate_windows WHERE key=?').get(key);
      if (!row && this.#db.prepare('SELECT count(*) AS n FROM rate_windows').get().n >= maxKeys) return { ok: false, retryAfterS: Math.ceil(rate.windowMs / 1000) };
      if (row && row.count >= rate.limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((row.expires_at - t) / 1000)) };
      if (row) this.#db.prepare('UPDATE rate_windows SET count=count+1 WHERE key=?').run(key);
      else this.#db.prepare('INSERT INTO rate_windows VALUES (?, 1, ?)').run(key, t + rate.windowMs);
      return { ok: true };
    });
  }
  close() { this.#db.close(); }
}

export class SQLiteRateLimiter {
  constructor({ store, ...options }) { this.store = store; this.options = options; }
  check(client, route) { return this.store.rateCheck(client, route, this.options); }
}
