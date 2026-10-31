// Vehicle profile registry. The existing Pleos AVD reference profile is re-exported unchanged and
// stays the default; the IONIQ 5 profile only describes an external mesh and its provenance.
import { ENVELOPE_SUV } from "../anatomy-car/profiles/vehicle-profile.mjs";

const freeze = (x) => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const ref = (value, source, note) => ({ value, unit: "mm", source, ...(note ? { note } : {}) });

const SECONDARY = "SECONDARY_SPEC_AGGREGATOR";
export const SPEC_SOURCES = freeze({
  [SECONDARY]: ["https://www.carexpert.com.au/hyundai/ioniq-5/2022/dimensions", "https://www.evspecifications.com/en/model/558213f"],
  OEM_HYUNDAI_INDIA: ["https://www.hyundai.com/in/en/find-a-car/ioniq-5/specification"],
});

export const HYUNDAI_IONIQ5_2022 = freeze({
  profileId: "hyundai-ioniq5-2022",
  kind: "EXTERNAL_MESH",
  identity: { make: "Hyundai", model: "IONIQ 5", year: 2022, variant: "first generation, Long Range RWD", identityStatus: "SOURCE_DECLARED",
    basis: "OpenX .xoma metadata; a community model, not Hyundai CAD", oemGeometry: false },
  asset: {
    upstream: "https://github.com/vevalabs/openx-assets",
    path: "src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend",
    sourceSha256: "e8e8788dee08ae2885e829c860930b843f3c3471ff05dcd851fa5aaa006abd8a",
    license: "MPL-2.0 AND CC-BY-4.0",
    attribution: ["(c) 2026 Dogan Ulus <dogan.ulus@bogazici.edu.tr>", "(c) 2022 andikapratamaw <https://sketchfab.com/andikapratamaw>, licensed under CC-BY-4.0"],
    redistribution: "NOT_IN_REPOSITORY",
    localGlbEnv: "CARSCOPE_IONIQ5_GLB",
  },
  frames: {
    source: "+X forward, +Y left, +Z up, metres; origin = bounding-box centre on the ground (OpenX src/README.md)",
    gltf: "(x, y, z) -> (x, z, -y), metres, no scale node",
    carscopeWorld: "+X forward, +Y left, +Z up, centimetres; car = (gx, -gz, gy) * 100",
  },
  // No per-axis or uniform rescale is applied: differences are reported, never forced to match.
  calibration: { applied: false, scale: 1, policy: "REPORT_ONLY" },
  reference: {
    length: ref(4635, SECONDARY, "pre-facelift 2022; facelift is 4655 per OEM India"),
    widthExMirrors: ref(1890, "OEM_HYUNDAI_INDIA", "unchanged across facelift per Hyundai"),
    height: ref(1605, SECONDARY, "varies by market/roof rails (1605-1647)"),
    wheelbase: ref(3000, "OEM_HYUNDAI_INDIA"),
    groundClearance: ref(160, SECONDARY, "trim dependent"),
    frontTrack: { value: null, unit: "mm", source: "CONFLICTING", note: "secondary sources report 1552-1638 mm depending on trim and wheel" },
    rearTrack: { value: null, unit: "mm", source: "CONFLICTING", note: "secondary sources report 1564-1647 mm" },
  },
});

export const VEHICLE_PROFILES = freeze({ "pleos-avd-reference": ENVELOPE_SUV, "hyundai-ioniq5-2022": HYUNDAI_IONIQ5_2022 });
export const DEFAULT_VEHICLE_PROFILE = "pleos-avd-reference";

/** glTF metres (Y up) -> CarScope world centimetres (+X forward, +Y left, +Z up). Inverse of (x,y,z)->(x,z,-y)/100. */
export const gltfToCarCm = ([x, y, z]) => [x * 100, -z * 100, y * 100];
