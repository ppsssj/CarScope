import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'node:test';
import { MemorySessionStore } from '../src/session-store.mjs';

const active = [];
const SQLiteSessionStore = process.env.SYNC_TEST_STORE === 'sqlite' ? (await import('../src/sqlite-store.mjs')).SQLiteSessionStore : null;
afterEach(() => { for (const s of active.splice(0)) s.close(); });
export function testStore() {
  if (!SQLiteSessionStore) return new MemorySessionStore();
  const dir = mkdtempSync(path.join(tmpdir(), 'carscope-ar02b1-'));
  const store = new SQLiteSessionStore({ filename: path.join(dir, 'session.sqlite') });
  active.push(store);
  return store;
}
