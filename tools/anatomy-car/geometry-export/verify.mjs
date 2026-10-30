// Mandatory failing gate. Independently reads exported artifacts, regenerates from the pinned
// model, validates the GLB, and runs sampled point + triangle-surface door collision checks.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import validator from "gltf-validator";
import { buildModel } from "../automotive/model.mjs";
import { VIEW } from "../automotive/camera.mjs";
import { generateGeometry } from "./generate.mjs";
import { meshFailures, requireValid, POLICY } from "./policy.mjs";
import { glbContractFailures } from "./glb-contract.mjs";
import { sweepDoors, collisionFailures } from "./collision.mjs";

export async function verifyArtifacts(out) {
  const verificationFile = join(out, "verification.json");
  try {
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    requireValid(meshFailures(report));
    const generated = generateGeometry(await buildModel());
    const glb = readFileSync(join(out, "car.glb"));
    const failures = [...meshFailures(generated.report), ...glbContractFailures(glb, generated.parts, generated.doorDefs, VIEW)];
    if (!glb.equals(generated.glb)) failures.push("car.glb is stale or differs from the current pinned model");
    if (readFileSync(join(out, "ir.json"), "utf8") !== JSON.stringify(generated.ir)) failures.push("ir.json is stale");
    if (JSON.stringify(report) !== JSON.stringify(generated.report)) failures.push("report.json is stale");
    const gltf = await validator.validateBytes(new Uint8Array(glb), { uri: "car.glb", maxIssues: 1000 });
    if (gltf.issues.numErrors || gltf.issues.numWarnings) failures.push(`Khronos validator: ${gltf.issues.numErrors} errors / ${gltf.issues.numWarnings} warnings`);
    requireValid(failures);
    const sweep = sweepDoors(generated);
    const collisions = collisionFailures(sweep);
    const verification = { status: collisions.length ? "FAIL" : "PASS", policy: POLICY, parts: generated.report.parts,
      triangles: generated.report.triangles, gltf: gltf.issues, sweep, failures: collisions };
    writeFileSync(join(out, "verification.json"), JSON.stringify(verification, null, 2));
    requireValid(collisions);
    console.log(`Geometry PASS: ${generated.report.parts} parts / ${generated.report.triangles} triangles; Khronos errors=0 warnings=0; sampled point/surface/independent-door checks passed.`);
    return verification;
  } catch (error) {
    // A rejected artifact must never leave a stale PASS from an earlier verification.
    if (existsSync(out)) writeFileSync(verificationFile, JSON.stringify({ status: "FAIL", failures: [error.message] }, null, 2));
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length && (args.length !== 2 || args[0] !== "--artifacts")) throw new Error("usage: node verify.mjs [--artifacts directory]");
    await verifyArtifacts(args.length ? resolve(args[1]) : join(dirname(fileURLToPath(import.meta.url)), "..", "build", "geometry"));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
