import test from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../automotive/model.mjs";
import { generateGeometry } from "../geometry-export/generate.mjs";
import { sweepDoors, collisionFailures, insidePrism } from "../geometry-export/collision.mjs";
import { rotateZ } from "../geometry-export/mesh.mjs";
import { readFileSync } from "node:fs";
import { glbContractFailures, readGlb } from "../geometry-export/glb-contract.mjs";
import { VIEW } from "../automotive/camera.mjs";
import { meshFailures } from "../geometry-export/policy.mjs";

const bundle = generateGeometry(await buildModel());
test("original rear inner-trim fixture reproduces 5°/6° flare penetration; relieved trim clears it", () => {
  const current = bundle.parts.find((p) => p.parent === "door-rear-left" && p.materialId === "doorInner");
  // Frozen original prism, including its stations/chord approximation; not today's dimensions.
  const original = JSON.parse(readFileSync(new URL("./fixtures/rear-inner-poc.json", import.meta.url), "utf8"));
  for (const [deg, y] of [[5, 90], [6, 91.3]]) {
    const q = rotateZ([-92.9, y, 37.9], [-31, 90.05, 0], deg * Math.PI / 180);
    const oldDepth = insidePrism(original, q);
    assert.ok(oldDepth > 0.3 && oldDepth < 0.4, `${deg}° reproduces the original >3 mm defect: ${oldDepth}`);
    assert.equal(insidePrism(current.geo, q), 0, `${deg}° corrected inner trim`);
  }
});
test("current model has sound meshes and rigid door poses", () => assert.deepEqual(meshFailures(bundle.report), []));
test("actual GLB binary positions/normals/pivots preserve cm→m and physical axes", () => assert.deepEqual(glbContractFailures(bundle.glb, bundle.parts, bundle.doorDefs, VIEW), []));
test("GLB contract rejects wrong units and an actual binary position corruption", () => {
  const wrongUnit = Buffer.from(bundle.glb);
  wrongUnit.write("centim", wrongUnit.indexOf(Buffer.from('"metres"')) + 1);
  assert.ok(glbContractFailures(wrongUnit, bundle.parts, bundle.doorDefs, VIEW).some((f) => f.includes("units")));
  const wrongPosition = Buffer.from(bundle.glb), { json } = readGlb(bundle.glb);
  const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const offset = 20 + wrongPosition.readUInt32LE(12) + 8 + (json.bufferViews[accessor.bufferView].byteOffset ?? 0);
  wrongPosition.writeFloatLE(500, offset);
  assert.ok(glbContractFailures(wrongPosition, bundle.parts, bundle.doorDefs, VIEW).some((f) => f.includes("position/units")));
});
test("GLB contract rejects a world rotation even when local vertex buffers are unchanged", () => {
  const { json, bin } = readGlb(bundle.glb);
  json.nodes.find((n) => n.name === "car").rotation = [0, 0, 1, 0];
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const header = Buffer.from(bundle.glb.subarray(0, 20));
  header.writeUInt32LE(28 + text.length + bin.length, 8); header.writeUInt32LE(text.length, 12);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  assert.ok(glbContractFailures(Buffer.concat([header, text, binHeader, bin]), bundle.parts, bundle.doorDefs, VIEW).some((f) => f.includes("world transform")));
});
test("whole door sweep, including rear 5–6°, has no point or surface penetration above the existing envelope", () => {
  const report = sweepDoors(bundle);
  assert.deepEqual(collisionFailures(report), []);
});
