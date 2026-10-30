// Loads the Anatomy kit from an installed checkout and checks it is the verified revision.
// The kit is not vendored into CarScope; ANATOMY_HOME points at it (default ~/.claude/skills/anatomy).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The Anatomy commit this car was built and audited with. */
export const ANATOMY_PIN = "1482e84";
export const ANATOMY_COMMIT = "1482e8469b0a9e0d8cc18ea2740a01423d29ae80";

export async function loadAnatomy({ allowOtherRevision = false } = {}) {
  const home = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
  let rev = "unknown";
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", home, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    rev = commit.slice(0, 7);
  } catch {
    // not a git checkout: fall through to the pin check
  }
  if (commit !== ANATOMY_COMMIT && !allowOtherRevision) {
    throw new Error(`Anatomy at ${home} is ${rev}, expected ${ANATOMY_PIN}. Check out the pinned commit or pass --any-anatomy.`);
  }
  if (execFileSync("git", ["-C", home, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()) {
    throw new Error(`Anatomy at ${home} has tracked modifications; use a clean pinned checkout.`);
  }
  const load = (path) => import(pathToFileURL(join(home, path)).href);
  const [k, G, A, tube] = await Promise.all([load("kit/iso-kit.mjs"), load("kit/lathe.mjs"), load("kit/audit.mjs"), load("kit/tube.mjs")]);
  return { k, G, A, tube, home, rev, commit };
}
