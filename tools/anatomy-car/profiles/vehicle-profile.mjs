// All observations retain their source unit. No SDK calls or model-name inference here.
const freeze = (x) => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const fields = ["height", "length", "width", "widthWithMirrors", "wheelbase", "frontTrack", "rearTrack", "turningDiameter"];
const values = [1776, 4950, 2008, 2140, 2984, 1665, 1667, 11800];
const estimated = (value, basis) => ({ value, unit: "mm", source: "DESIGN_ESTIMATE", basis });

/**
 * @typedef {Object} VehicleGeometryProfile
 * @property {string} profileId Stable reference ID, never an inferred OEM identity.
 * @property {"AAOS_SIMULATED_METADATA"} source Source of the envelope observations.
 * @property {"UNVERIFIED"} oemVisualMatch Independent of observed metadata availability.
 * @property {Object} metadata Public make/model/year strings; actualVehicleIdentity stays null.
 * @property {Object} provenance AVD/image/date and sanitized evidence reference.
 * @property {Object<string,{value:number,unit:"mm",source:string,property:string,index:number}>} dimensions
 * @property {Object<string,null>} unknown Values not exposed by the identity probe.
 * @property {Object<string,{value:number,unit:"mm",source:"DESIGN_ESTIMATE",basis:string}>} estimates
 * @property {Object} design Original procedural construction, all lengths in its declared unit.
 */
/** @type {Readonly<VehicleGeometryProfile>} */
export const ENVELOPE_SUV = freeze({
  profileId: "manual-pleos-avd-envelope-v1",
  source: "AAOS_SIMULATED_METADATA", oemVisualMatch: "UNVERIFIED", identityStatus: "PARTIAL",
  metadata: { make: "Hyundai 42dot", model: "Connect", year: 2024, actualVehicleIdentity: null },
  provenance: { observedOn: "2026-10-31", avd: "CarScope_Pleos_API34", image: "Pleos Connect 2.1.0 / API 34",
    evidence: "docs/evidence/p2-a30/2026-10-31-codex/README.md",
    sanitizedResultSha256: "DB21D1FF7B8EEA567E7F3CA66B749875E08FFBC89FF144B8851784AD4585BFE6" },
  dimensions: Object.fromEntries(fields.map((name, index) => [name, { value: values[index], unit: "mm",
    source: "AAOS_SIMULATED_METADATA", property: "INFO_EXTERIOR_DIMENSIONS", index }])),
  unknown: { wheelRadius: null, frontOverhang: null, rearOverhang: null, groundClearance: null,
    bodyCurvature: null, hoodOpeningGeometry: null, internalPartPlacements: null },
  estimates: {
    wheelRadius: estimated(380, "Reference crossover wheel; not an AAOS observation"),
    tyreWidth: estimated(250, "Reference road tyre section"),
    frontOverhang: estimated(983, "Equal split of length minus wheelbase; distribution unknown"),
    groundClearance: estimated(230, "Reference sill height; no underbody/under-hood layout inferred"),
    beltHeight: estimated(1160, "High crossover shoulder and extended cabin"),
    roofEdgeHeight: estimated(1726, "50 mm crown below the observed overall height"),
    roofHalfWidth: estimated(830, "Estimated greenhouse tumblehome"),
    windshieldBaseX: estimated(900, "Relative to axle midpoint, +X forward"),
    roofFrontX: estimated(270, "Estimated windshield rake"),
    roofRearX: estimated(-1840, "Extended SUV roof; independent of the Sedan"),
    rearGlassBaseX: estimated(-2280, "Short rear deck / steep hatch"),
    archRadius: estimated(460, "80 mm tyre clearance before flare"),
    flareRadius: estimated(485, "Reference wheel-arch cladding"),
    doorNotchRadius: estimated(510, "Clearance around the estimated rear flare"),
    panelThickness: estimated(18, "Reference panel solid, not OEM construction"),
    doorThickness: estimated(24, "Reference rigid shell thickness"),
    doorSill: estimated(310, "Reference door aperture bottom"),
    hoodCrownRise: estimated(55, "P2-A3-1.1 original surface study; not an AAOS or OEM measurement"),
    fenderShoulderDrop: estimated(22, "P2-A3-1.2 front-fender shoulder below the hood edge; not an AAOS or OEM measurement"),
  },
  design: { kind: "procedural-crossover", source: "DESIGN_ESTIMATE", unit: "cm",
    unobservedConstruction: "Every procedural constant not in dimensions is an original design estimate, including panel bands, hinges, hub supports, lamps, windows and trim. No OEM layout inferred.",
    curvature: "sampled quadratic roof crown and sampled circular wheel arches; arch trim is a planar inlay",
    hoodOpeningGeometry: null, internalPartPlacements: null,
    doorApertures: { source: "DESIGN_ESTIMATE", unit: "cm", front: { hinge: 84, rear: -21, openDegrees: 64 }, rear: { hinge: -35, rear: -111, openDegrees: 58 } } },
});

export function envelopeParameters(profile = ENVELOPE_SUV) {
  const cm = {};
  for (const [name, d] of Object.entries(profile.dimensions)) {
    if (d.unit !== "mm" || !(d.value > 0) || !Number.isFinite(d.value)) throw new Error(`Invalid observed ${name}`);
    cm[name] = d.value / 10;
  }
  if (!(cm.wheelbase < cm.length && cm.widthWithMirrors >= cm.width && cm.frontTrack < cm.width && cm.rearTrack < cm.width)) throw new Error("Invalid envelope relationships");
  const estimates = Object.fromEntries(Object.entries(profile.estimates).map(([name, d]) => {
    if (d.unit !== "mm" || d.source !== "DESIGN_ESTIMATE" || !Number.isFinite(d.value)) throw new Error(`Invalid estimate ${name}`);
    return [name, d.value / 10];
  }));
  return { ...cm, ...estimates, unit: "cm", axleFront: cm.wheelbase / 2, axleRear: -cm.wheelbase / 2,
    xFront: cm.wheelbase / 2 + estimates.frontOverhang,
    xRear: cm.wheelbase / 2 + estimates.frontOverhang - cm.length,
    rearOverhang: cm.length - cm.wheelbase - estimates.frontOverhang };
}

/** Reusable dimension contract; legacy values are design constants, never AAOS measurements. */
export const GENERIC_SEDAN_PARAMETERS = freeze({ source: "LEGACY_GENERIC_DESIGN", unit: "cm",
  body: { halfWidth: 90, rearX: -230, frontX: 231.5, beltHeight: 95 },
  wheels: { wheelbase: 272, centerZ: 33, radius: 32.5, archRadius: 40, flareRadius: 43.4 },
  greenhouse: { roofHalfWidth: 77, edgeZ: 141.3, frontRidgeZ: 144.4 },
});
