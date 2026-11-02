// Only delete a directory this invocation created directly under the real OS temp directory.
import { mkdtempSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
export function tempFixture() {
  const parent = realpathSync(tmpdir());
  const dir = mkdtempSync(path.join(parent, 'carscope-ar02b2e-owned-'));
  let closed = false;
  return { dir, cleanup() {
    if (closed) return;
    if (path.dirname(dir) !== parent || !path.basename(dir).startsWith('carscope-ar02b2e-owned-') || lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== dir) throw new Error('UNSAFE_FIXTURE_CLEANUP');
    rmSync(dir, { recursive: true, force: false }); closed = true;
  } };
}
