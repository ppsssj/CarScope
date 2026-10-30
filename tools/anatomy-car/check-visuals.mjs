// Reproducible static SVG captures and line checks. Inspect the PNGs; exit 0 is not visual approval.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMBOS, comboName } from "./automotive/asset.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const anatomy = process.env.ANATOMY_HOME ?? join(homedir(), ".claude", "skills", "anatomy");
const out = join(here, "build", "visual"); mkdirSync(out, { recursive: true });
const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(anatomy, "scripts", script), ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${script} failed (${r.status})`);
};
for (const combo of COMBOS) for (const theme of ["light", "dark"]) {
  const name = `car-${comboName(combo)}${theme === "light" ? "-light" : ""}`;
  const page = join(here, "build", `${name}.html`);
  for (const scale of [1, 4]) run("capture.mjs", [page, "--out", join(out, `${name}-x${scale}.png`), "--width", "1100", "--height", "650", "--scale", String(scale), "--wait", "2000"]);
  run("lines.mjs", [page]);
}
run("capture.mjs", [join(here, "build", "coordinate-contract.html"), "--out", join(out, "coordinate-contract.png"), "--width", "1100", "--height", "650", "--scale", "1", "--wait", "100"]);
