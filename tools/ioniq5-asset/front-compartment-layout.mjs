// P3-A2.1: front compartment layout for the hyundai-ioniq5-2022 profile (CarScope cm: +X forward,
// +Y left, +Z up). Browser-safe, no geometry from the third-party model is stored here.
//
// Two kinds of numbers:
//   MODEL_REFERENCES  a few single clearance values MEASURED on the converted OpenX GLB (bounding values of
//                     the same kind as the bounds in docs/p2-a6, no vertex or surface data). They are facts
//                     about that model, not the vehicle; tests re-measure them when IONIQ5_GLB is set.
//   Hood surface      the panels follow the hood's underside, which is measured at run time from the local
//                     GLB (measureHoodSurface); only the sampling grid is stored here.
//   PARTS / ZONES     new panel and reserved-space parameters chosen here. Their shapes are ESTIMATED from
//                     the owner's manual figure (Maintenance p.9-3, ONE1091001); nothing is Hyundai CAD.

export const COORDINATE_FRAME = "CarScope cm (+X forward, +Y left, +Z up)";
export const VEHICLE_VARIANT = "hyundai-ioniq5-2022 (OpenX community model, Long Range RWD); front trunk target: non-North-America 2WD, 57 L (Hyundai spec)";

/** Accuracy classes. A model measurement can be VERIFIED for the model; a new panel never is for the vehicle. */
export const CONFIDENCE = Object.freeze({ VERIFIED: "VERIFIED_GEOMETRY", ESTIMATED: "ESTIMATED_GEOMETRY", PLACEHOLDER: "SYNTHETIC_DEBUG_PLACEHOLDER", UNVERIFIED: "UNVERIFIED" });

export const SOURCES = Object.freeze({
  maintenance: "Hyundai IONIQ 5 2022 owner's manual (UK), Maintenance p.9-3, figure ONE1091001 'Motor compartment' (the manual notes the actual compartment may differ from the illustration)",
  cabinFilter: "same manual, Maintenance 'Cabin air filter' (filter under the front trunk cover, reached through the front trunk)",
  frunk: "Hyundai IONIQ 5 2022 owner's manual (UK), Convenience features p.5-48 'Front trunk'; Hyundai newsroom: 57 L (2WD, non-NA) / 24 L (AWD, NA)",
  model: "converted OpenX GLB, measured by tools/ioniq5-asset (P3-A1 probe, P3-A2.1 bay map)",
});

/** Measured on the converted OpenX GLB (VERIFIED for the model only). */
export const MODEL_REFERENCES = Object.freeze({
  floorZ: { value: 23.0, what: "Body underbody plate under the bay (first downward hit)" },
  interiorFrontX: { value: 104.0, what: "Interior_Static front face (dashboard), z 74-94, |y| <= 75" },
  cowlBodyMinZ: { value: 98.2, what: "lowest Body vertex of the cowl strip, x 97-122.7, |y| <= 69.4" },
  wheelhouseInnerY: { value: 58.0, what: "Body wheelhouse inner walls, |y| 58-63.8, x 101.5-189.6, z 24.9-81.9" },
  wheelTopZ: { value: 75.1, what: "front wheels, x 108.3-183.4, |y| 64.7-89.7" },
  frontAxleX: { value: 145.86, what: "Grp_Wheel_0_x origin" },
  lampHousingBay: { min: [184.8, 43.0, 71.8], max: [212.4, 63.2, 84.0], what: "Lamp_Housings + DRL inside the bay (mirrored in y)" },
  indicatorTopZ: { value: 45.0, what: "Light_Indicator_*_0, x 206.9-225.1, |y| 54.8-84.8" },
  windshieldBottom: { x: 106.8, z: 109.7, what: "Body_Glass lowest/most forward point" },
});

/**
 * Where the hood surface is sampled (our sampling plan, not model data): x 110..225 step 5, |y| rows.
 * The heights themselves are NOT stored in the repository: they are model-derived surface samples, so
 * measureHoodSurface() (front-compartment.mjs) measures them at run time from the local GLB's hood mesh,
 * and synthetic tests pass a synthetic hood.
 */
export const HOOD_SAMPLE_GRID = Object.freeze({
  x: Object.freeze(Array.from({ length: 24 }, (_, i) => 110 + 5 * i)),
  y: Object.freeze([0, 20, 30, 40, 50, 55, 58, 62, 70, 78]),
});

/** Lowest hood surface over the rectangle [x0,x1] x [y0,y1], sampled every 2.5 cm; null if no hood above. */
export function hoodClearanceOver(surface, x0, x1, y0, y1, step = 2.5) {
  let min = null;
  for (let x = x0; x <= x1 + 1e-9; x += step)
    for (let y = y0; y <= y1 + 1e-9; y += step) { const z = hoodUndersideAt(surface, x, y); if (z !== null && (min === null || z < min)) min = z; }
  return min;
}

/**
 * Hood underside at (x, |y|) by bilinear interpolation of a measured surface `{ x, y, z }` (z[row][col],
 * null where no hood is above); null outside the hood.
 */
export function hoodUndersideAt(surface, x, y) {
  if (!surface?.z) throw new Error("hood surface required: measure it from the hood mesh (measureHoodSurface)");
  const t = surface, ay = Math.abs(y);
  const fi = (arr, v) => { if (v <= arr[0]) return [0, 0, 0]; for (let i = 0; i < arr.length - 1; i++) if (v <= arr[i + 1]) return [i, i + 1, (v - arr[i]) / (arr[i + 1] - arr[i])]; const n = arr.length - 1; return [n, n, 0]; };
  const [c0, c1, u] = fi(t.x, x), [r0, r1, v] = fi(t.y, ay);
  const q = [t.z[r0][c0], t.z[r0][c1], t.z[r1][c0], t.z[r1][c1]];
  if (q.some((z) => z === null)) return null;
  return (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v;
}

const common = (extra) => ({ coordinateFrame: COORDINATE_FRAME, vehicleVariant: VEHICLE_VARIANT, isSynthetic: true, ...extra });

/**
 * Panel parameters (cm). Every panel stays below the closed hood with HOOD_GAP and in front of the
 * dashboard; contacts with existing meshes happen only inside declared `joints`.
 */
export const HOOD_GAP = 3.0;

export const PARTS = Object.freeze([
  common({
    id: "fc-rear-bulkhead", name: "Rear bulkhead (compartment / cabin boundary)", group: "RearBoundary", palette: "doorInner",
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED, boundary: "ESTIMATED_BOUNDARY",
    source: [SOURCES.maintenance, SOURCES.model],
    note: "visual boundary that hides the dashboard; not a verified firewall shape. Two horizontal beads; widens above the wheelhouses",
    visibility: "visible-when-hood-open", futureInteraction: "none (boundary)",
    params: { xBottom: 108.0, xTop: 106.2, zBottom: 26.0, zTop: 95.5, halfWidthLow: 57.0, halfWidthHigh: 74.0, widenFromZ: 74.0, widenToZ: 80.0, beads: [{ z: 50, depth: 1.2, height: 4 }, { z: 66, depth: 1.2, height: 4 }] },
  }),
  common({
    id: "fc-cowl-cover", name: "Cowl cover (upper rear panel)", group: "RearBoundary", palette: "trim",
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED, boundary: "ESTIMATED_BOUNDARY",
    source: [SOURCES.maintenance, SOURCES.model],
    note: "dark strip across the rear of the compartment as in ONE1091001; kept under the Body cowl strip (z >= 98.2) and the hood's rear flange",
    visibility: "visible-when-hood-open", futureInteraction: "none",
    params: { xRear: 106.2, xFront: 122.0, zRear: 95.5, zFront: 95.5, lipZ: 92.5, halfWidth: 66.0 },
  }),
  ...[1, -1].map((s) => common({
    id: `fc-apron-${s > 0 ? "left" : "right"}`, name: `${s > 0 ? "Left" : "Right"} fender apron`, group: "Aprons", palette: "paint", side: s,
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED,
    source: [SOURCES.maintenance, SOURCES.model],
    note: "upper apron wall above the model's wheelhouse wall, bending outward under the hood edge; mirrored (symmetry ASSUMED, the real left/right aprons carry different service parts)",
    visibility: "visible-when-hood-open", futureInteraction: s > 0 ? "mount:service-left" : "mount:service-right",
    params: { x: [107, 115, 125, 135, 145, 155, 165, 175, 183], wallY: 57.0, zBottom: 66.0, zKnee: 86.0, bendY: 60.0, bendZ: 89.0, flangeY: 72.0, topCap: 97.0 },
  })),
  ...[1, -1].map((s) => common({
    id: `fc-strut-tower-${s > 0 ? "left" : "right"}`, name: `${s > 0 ? "Left" : "Right"} strut tower cap`, group: "Aprons", palette: "paint", side: s,
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED,
    source: [SOURCES.maintenance, "x at the model's front axle (MODEL_REFERENCES.frontAxleX)"],
    note: "round tower top as drawn in ONE1091001, standing on the model's wheel-arch top; radius, height and lateral position are estimates",
    visibility: "visible-when-hood-open", futureInteraction: "none",
    params: { x: 145.86, y: 63.0, radius: 6.0, zBottom: 85.0, zTop: 93.0, segments: 20 },
  })),
  common({
    id: "fc-lower-liner", name: "Lower compartment liner", group: "LowerLiner", palette: "trim",
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED,
    source: [SOURCES.model],
    note: "thin tray that closes the view to the underbody plate: a lower centre well (future frunk) and raised side shelves (future service parts), following the centre/side split of ONE1091001. It marks the lower edge of the reserved volume, above the unmodelled drive unit. Not a real part shape",
    visibility: "visible-when-hood-open", futureInteraction: "support for P3-A2.2 frunk and service parts",
    params: { xRear: 108.6, xFront: 213.4, halfWidth: 56.5, zCentre: 46.0, wellHalfWidth: 28.0, rampTo: 33.0, zShelf: 52.0, zEdge: 52.6, lip: 4.0, lipZ: 56.0 },
  }),
  common({
    id: "fc-front-upper-support", name: "Front upper support (latch crossmember)", group: "FrontUpperSupport", palette: "paint",
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED,
    source: [SOURCES.maintenance, SOURCES.model],
    note: "hat-section crossmember under the hood's front edge with a latch boss, as drawn in ONE1091001; no latch mechanism",
    visibility: "visible-when-hood-open", futureInteraction: "none (latch not modelled)",
    params: { xRear: 198.0, xFront: 214.0, topRear: 199.5, topFront: 212.5, zTop: 82.5, zRearFoot: 74.0, zFrontFoot: 71.0, halfWidth: 42.0, boss: { x: [204, 210], y: 4, h: 1.6 } },
  }),
  common({
    id: "fc-front-shroud", name: "Front lower shroud", group: "FrontUpperSupport", palette: "trim",
    geometryConfidence: CONFIDENCE.ESTIMATED, positionConfidence: CONFIDENCE.ESTIMATED,
    source: [SOURCES.model],
    note: "vertical closing panel between the upper support, the lamp housings and the liner, so the bumper interior is not seen",
    visibility: "visible-when-hood-open", futureInteraction: "none",
    params: { x: 214.0, zBottom: 49.0, zTopCentre: 71.0, halfWidthCentre: 42.0, halfWidth: 56.5, zTopSide: 70.5 },
  }),
]);

/**
 * Reserved volumes for P3-A2.2 (SYNTHETIC_DEBUG_PLACEHOLDER). A reservation envelope is not a storage
 * capacity: the 57 L front trunk is a target profile, its tub shape and mounts are not available.
 */
export const ZONES = Object.freeze([
  common({ id: "zone-frunk", name: "FrunkZone (reserved envelope)", group: "ReservedZones", kind: "frunk", geometryConfidence: CONFIDENCE.PLACEHOLDER, positionConfidence: CONFIDENCE.PLACEHOLDER,
    source: [SOURCES.maintenance, SOURCES.frunk], visibility: "debug-only", futureInteraction: "P3-A2.2 front trunk tub and cover",
    note: "centre of the compartment as in ONE1091001 (item 7); target 57 L (2WD, non-NA). The envelope is larger than 57 L on purpose; it is not the tub shape",
    min: [126, -27, 52], max: [196, 27, null], topGap: HOOD_GAP + 1 }),
  common({ id: "zone-service-left", name: "LeftServiceZone (reserved envelope)", group: "ReservedZones", kind: "service", geometryConfidence: CONFIDENCE.PLACEHOLDER, positionConfidence: CONFIDENCE.PLACEHOLDER,
    source: [SOURCES.maintenance], visibility: "debug-only", futureInteraction: "P3-A2.2 service parts",
    note: "ONE1091001 places coolant / LCW coolant / washer on one side and brake fluid / fuse box / 12V battery on the other; which side is which on this variant is UNVERIFIED",
    min: [124, 33, 53], max: [180, 55, null], topGap: HOOD_GAP + 1 }),
  common({ id: "zone-service-right", name: "RightServiceZone (reserved envelope)", group: "ReservedZones", kind: "service", geometryConfidence: CONFIDENCE.PLACEHOLDER, positionConfidence: CONFIDENCE.PLACEHOLDER,
    source: [SOURCES.maintenance], visibility: "debug-only", futureInteraction: "P3-A2.2 service parts",
    note: "mirror of the left zone; side assignment of the service parts UNVERIFIED",
    min: [124, -55, 53], max: [180, -33, null], topGap: HOOD_GAP + 1 }),
]);

/** Zone boxes with the top resolved against the measured hood surface (lowest over the footprint minus topGap). */
export function zoneBoxes(surface) {
  return ZONES.map((z) => {
    const top = hoodClearanceOver(surface, z.min[0], z.max[0], z.min[1], z.max[1]);
    return { ...z, max: [z.max[0], z.max[1], z.max[2] ?? Math.round((top - z.topGap) * 10) / 10] };
  });
}

/**
 * Intended contacts: crossings with these meshes inside these boxes are joints (panel meets structure),
 * anything else is a defect. Boxes are generous by a few cm around the designed seam.
 */
export const JOINTS = Object.freeze([
  { part: "fc-rear-bulkhead", with: "fc-cowl-cover", min: [104, -80, 90], max: [110, 80, 99], why: "bulkhead top meets the cowl cover" },
  { part: "fc-cowl-cover", with: "fc-apron-left", min: [104, 54, 86], max: [124, 78, 99], why: "cowl cover end on the apron flange" },
  { part: "fc-cowl-cover", with: "fc-apron-right", min: [104, -78, 86], max: [124, -54, 99], why: "cowl cover end on the apron flange" },
  { part: "fc-rear-bulkhead", with: "fc-lower-liner", min: [104, -60, 44], max: [112, 60, 56], why: "liner rear lip on the bulkhead" },
  { part: "fc-rear-bulkhead", with: "fc-apron-left", min: [103, 54, 60], max: [110, 78, 100], why: "apron rear edge on the bulkhead" },
  { part: "fc-rear-bulkhead", with: "fc-apron-right", min: [103, -78, 60], max: [110, -54, 100], why: "apron rear edge on the bulkhead" },
  { part: "fc-strut-tower-left", with: "fc-apron-left", min: [137, 54, 78], max: [155, 76, 95], why: "tower passes through the apron" },
  { part: "fc-strut-tower-right", with: "fc-apron-right", min: [137, -76, 78], max: [155, -54, 95], why: "tower passes through the apron" },
  { part: "fc-front-shroud", with: "fc-lower-liner", min: [208, -60, 44], max: [218, 60, 56], why: "liner front lip on the shroud" },
  { part: "fc-front-shroud", with: "fc-front-upper-support", min: [208, -46, 66], max: [218, 46, 76], why: "shroud under the support" },
  { part: "*", with: "Body", min: [100, -66, 20], max: [192, -50, 104], why: "panels meet the model's right wheelhouse wall" },
  { part: "*", with: "Body", min: [100, 50, 20], max: [192, 66, 104], why: "panels meet the model's left wheelhouse wall" },
  { part: "*", with: "Lamp_Housings", min: [180, -66, 60], max: [218, 66, 90], why: "shroud and support edges meet the lamp housing backs" },
]);
