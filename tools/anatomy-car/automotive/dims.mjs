// Dimensions of the CarScope sedan (world units ~ 1 cm; x forward, y to the car's left, z up).
// Every module reads its numbers from here, so body, doors and greenhouse always agree.
import { polyline } from "./geometry.mjs";
import { GENERIC_SEDAN_PARAMETERS as PARAMS } from "../profiles/vehicle-profile.mjs";

export const HALF = PARAMS.body.halfWidth; // body half width at the outer panel
export const INNER = HALF - 1.2; // recessed panel layer: shoulder band and rocker
export const SKIN_Y = HALF - 2.4; // inner face of the side skin
export const CORE_Y = HALF - 26; // near face of the core, behind the near wheels
export const AXLE = PARAMS.wheels.wheelbase / 2;
export const WHEEL_Z = PARAMS.wheels.centerZ;
export const TYRE_R = PARAMS.wheels.radius;
export const ARCH_R = PARAMS.wheels.archRadius;
export const FLARE_R = PARAMS.wheels.flareRadius;
export const SILL = 20;
export const BELT = PARAMS.body.beltHeight;
export const ROCKER_TOP = 26.5;
export const CHAR_DROP = 7; // the shoulder crease runs this far below the top edge

/** Top edge of the side profile (rear to front): deck, beltline, hood, nose. */
const TOP = [[-230, 58], [-226, 74], [-215, 86], [-197, 92], [-150, BELT], [40, BELT], [62, 93.5], [120, 90.5], [178, 86.5], [205, 83], [221, 78], [229, 68], [231.5, 56]];
/** Bottom edge outside the arches: tail and nose undersides. */
const TAIL_BOTTOM = [[-230, 58], [-229, 40], [-223, 26], [-214, SILL]];
const NOSE_BOTTOM = [[214, SILL], [222, 22], [228, 32], [231, 44], [231.5, 56]];
export const X_REAR = PARAMS.body.rearX;
export const X_FRONT = PARAMS.body.frontX;

export const top = polyline(TOP);
const archZ = (cx, r) => (x) => WHEEL_Z + Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
const archHalf = Math.sqrt(ARCH_R ** 2 - (SILL - WHEEL_Z) ** 2); // where an arch meets the sill
export const ARCH_SPAN = archHalf;
/** Bottom edge of the side profile, including both wheel arches. */
export function bottom(x) {
  if (x <= TAIL_BOTTOM[TAIL_BOTTOM.length - 1][0]) return polyline(TAIL_BOTTOM)(x);
  if (x >= NOSE_BOTTOM[0][0]) return polyline(NOSE_BOTTOM)(x);
  for (const cx of [AXLE, -AXLE]) if (Math.abs(x - cx) < archHalf) return archZ(cx, ARCH_R)(x);
  return SILL;
}
/** The shoulder crease: CHAR_DROP below the top edge, running out at the nose and the tail. */
export function crease(x) {
  const taper = x > 196 ? Math.max(0, 1 - (x - 196) / 18) : x < -205 ? Math.max(0, 1 - (-205 - x) / 9) : 1;
  return top(x) - CHAR_DROP * taper;
}
/** Sample stations: every profile knot plus dense samples along the arches. */
export const STATIONS = [
  ...TOP.map(([x]) => x), ...TAIL_BOTTOM.map(([x]) => x), ...NOSE_BOTTOM.map(([x]) => x),
  ...[AXLE, -AXLE].flatMap((cx) => Array.from({ length: 33 }, (_, i) => cx - archHalf + (2 * archHalf * i) / 32)),
  196, 200, 205, 210, 214, -205, -210, -214,
];
/** The closed side profile polygon, for the core and the middle band. */
export const PROFILE = [...TOP.map(([x, z]) => [x, z]), ...[...STATIONS].filter((x) => x > X_REAR && x < X_FRONT).sort((a, b) => b - a).map((x) => [x, bottom(x)])];

// ---------------------------------------------------------------- doors
export const SHUT_GAP = 0.5;
export const DOOR_DEPTH = 6.5; // outer skin to inner trim
export const NOTCH_R = 44.2; // the rear door clears the flare around the rear arch
export const REAR_INNER_NOTCH_R = 45.2; // P2-A2.1: relief of inner trim only during the early opening arc
export const notchZ = archZ(-AXLE, NOTCH_R);
const notchStart = -AXLE + Math.sqrt(NOTCH_R ** 2 - (ROCKER_TOP - WHEEL_Z) ** 2);
export const FRONT_DOOR = { id: "door-front-left", hinge: 38, rear: -26.5, open: 64, mirror: true };
export const REAR_DOOR = { id: "door-rear-left", hinge: -31, rear: -107, open: 58, mirror: false };
export const B_PILLAR = [FRONT_DOOR.rear, REAR_DOOR.hinge];
/** Bottom of the door aperture: the rocker top, and around the rear arch the notch. */
export const apertureBottom = (x) => (x < notchStart ? Math.max(ROCKER_TOP, notchZ(x)) : ROCKER_TOP);
export const NOTCH_START = notchStart;
// Stations along the rear-door notch and at every door, pillar and arch boundary.
STATIONS.push(
  notchStart, ...Array.from({ length: 13 }, (_, i) => REAR_DOOR.rear + ((notchStart - REAR_DOOR.rear) * i) / 12),
  ...[FRONT_DOOR.hinge, FRONT_DOOR.rear, REAR_DOOR.hinge, REAR_DOOR.rear].flatMap((x) => [x - SHUT_GAP, x, x + SHUT_GAP]),
  AXLE - ARCH_R - 0.5, AXLE + ARCH_R + 0.5, -(AXLE - ARCH_R - 0.5), -(AXLE + ARCH_R + 0.5),
);

// ---------------------------------------------------------------- greenhouse (tumblehome)
export const GH = {
  baseHalf: HALF - 2.4, // at the beltline the window frames start on the door's shoulder band
  roofHalf: PARAMS.greenhouse.roofHalfWidth,
  edgeZ: PARAMS.greenhouse.edgeZ,
  aBase: 40, // windshield base
  aTop: 1, // windshield top
  cBase: -150, // rear glass base
  cTop: -97, // rear glass top
  ridgeFront: [-4, PARAMS.greenhouse.frontRidgeZ],
  ridgeRear: [-90, 144.0],
};
GH.lean = Math.atan((GH.baseHalf - GH.roofHalf) / (GH.edgeZ - BELT));
/** x of the windshield edge and the rear-glass edge on the greenhouse side at height z. */
export const aLine = (z) => GH.aBase + ((GH.aTop - GH.aBase) * (z - BELT)) / (GH.edgeZ - BELT);
export const cLine = (z) => GH.cBase + ((GH.cTop - GH.cBase) * (z - BELT)) / (GH.edgeZ - BELT);
/** Greenhouse half width at height z (the side planes lean inward). */
export const ghHalf = (z) => GH.baseHalf - ((GH.baseHalf - GH.roofHalf) * (z - BELT)) / (GH.edgeZ - BELT);
