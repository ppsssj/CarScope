import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../geometry-export/verify.mjs", import.meta.url));
const good = () => ({ checks: [{ partId: "fixture", cls: "prism", closed: true, degenerate: 0, flippedNormals: 0,
  windingConflicts: 0, nonManifoldEdges: 0, boundaryEdges: 0, watertight: true, outward: true, signedVolume: 8 }],
  doorRigidity: { "door-front-left": { comparedParts: 1, maxDeviation: 0 }, "door-rear-left": { comparedParts: 1, maxDeviation: 0 } } });
for (const [name, corrupt] of [
  ...["degenerate", "flippedNormals", "windingConflicts", "nonManifoldEdges", "boundaryEdges"].map((key) => [key, (r) => { r.checks[0][key] = 1; }]),
  ["not watertight", (r) => { r.checks[0].watertight = false; }],
  ["inward", (r) => { r.checks[0].outward = false; r.checks[0].signedVolume = -8; }],
  ["rigidity", (r) => { r.doorRigidity["door-rear-left"].maxDeviation = 0.001; }],
  ["missing checks", (r) => { r.checks = []; }],
]) test(`verification CLI exits nonzero for ${name}`, () => {
  const dir = mkdtempSync(join(tmpdir(), "carscope-bad-geometry-"));
  try {
    const r = good(); corrupt(r); writeFileSync(join(dir, "report.json"), JSON.stringify(r));
    writeFileSync(join(dir, "verification.json"), JSON.stringify({ status: "PASS" }));
    const result = spawnSync(process.execPath, [cli, "--artifacts", dir], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Geometry validation failed/);
    assert.equal(JSON.parse(readFileSync(join(dir, "verification.json"), "utf8")).status, "FAIL");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
