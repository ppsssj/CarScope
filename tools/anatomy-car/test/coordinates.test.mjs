import test from "node:test";
import assert from "node:assert/strict";
import { loadAnatomy } from "../automotive/anatomy.mjs";
import { camera, VIEW, svgScreenPoint, svgScreenMarkup, svgScreenPath } from "../automotive/camera.mjs";
import { LANDMARKS, coordinateLandmarks } from "../automotive/coordinates.mjs";
import { FRONT_DOOR, REAR_DOOR, HALF } from "../automotive/dims.mjs";
import { toGltf, dirToGltf, quatAboutCarZ } from "../geometry-export/gltf.mjs";
import { vec } from "../geometry-export/mesh.mjs";

const { k } = await loadAnatomy(), P = camera(k);
const a = VIEW.azimuth * Math.PI / 180, e = VIEW.elevation * Math.PI / 180;
const viewer = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
const right = vec.unit(vec.cross([0, 0, 1], viewer));
const up = vec.cross(viewer, right);
test("asymmetric SVG landmarks agree with an independent right-handed camera oracle", () => {
  const origin = svgScreenPoint(k.iso([0, 0, 0], P));
  const scale = k.cameraOf(P).k;
  for (const l of coordinateLandmarks(k, P)) {
    assert.ok(Math.abs((l.svgScreen[0] - origin[0]) / scale - vec.dot(l.world, right)) < 1e-10, l.id);
    assert.ok(Math.abs((l.svgScreen[1] - origin[1]) / scale + vec.dot(l.world, up)) < 1e-10, l.id);
  }
  assert.equal(new Set(LANDMARKS.map((l) => vec.len(l.world))).size, 5);
  assert.ok(viewer[0] > 0 && viewer[1] > 0, "camera is physically front-left");
});
test("FRONT_LEFT/REAR_LEFT stay at physical +Y; front hinge remains +X of rear", () => {
  assert.equal(FRONT_DOOR.id, "door-front-left"); assert.equal(REAR_DOOR.id, "door-rear-left");
  assert.ok(HALF > 0 && FRONT_DOOR.hinge > REAR_DOOR.hinge);
  assert.deepEqual(toGltf([100, 200, 300]), [1, 3, -2]);
  assert.deepEqual(dirToGltf([0, 1, 0]), [0, 0, -1]);
  assert.deepEqual(quatAboutCarZ(Math.PI), [0, 1, 0, Math.cos(Math.PI / 2)]);
  const det = vec.dot(vec.cross(dirToGltf([1, 0, 0]), dirToGltf([0, 1, 0])), dirToGltf([0, 0, 1]));
  assert.equal(det, 1, "winding preserved");
});
test("screen adapter changes path/circle X only, keeps text/card markup and is involutive", () => {
  const raw = '<path d="M10 20L300.2 90Z" fill="#fff"/><circle cx="12.3" cy="45"/><text x="10">LEFT</text>';
  assert.equal(svgScreenMarkup(svgScreenMarkup(raw)), raw);
  assert.ok(svgScreenMarkup(raw).includes('d="M630 20L339.8 90Z"'));
  assert.ok(svgScreenMarkup(raw).includes('<text x="10">LEFT</text>'));
  assert.throws(() => svgScreenPath("M0 0C1 2 3 4 5 6"), /Unsupported/);
});
