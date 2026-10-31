// Name-based part classification for the OpenX IONIQ 5 node tree (browser and Node safe, no imports).
// A category is a claim about the NAME only. Whether a real, precise part mesh exists is decided in
// analyze.mjs from geometry (triangle count, bounds, position), never from the name.

const RULES = [
  [/^Grp_/, "group"],
  [/^Body$/, "body-shell"],
  [/^Body_Glass$/, "glazing"],
  [/^Door_Front_\d+$/, "closure-hood"],
  [/^Door_Rear_\d+$/, "closure-tailgate"],
  [/^Door_(Left|Right)_\d+$/, "closure-side-door"],
  [/^Wheel_\d+_\d+$/, "wheel-assembly"],
  [/^Brake_Caliper_\d+_\d+$/, "brake-caliper"],
  [/^Mirror_Side_(Left|Right)_\d+$/, "side-mirror"],
  [/^Lamp_Housings$/, "lamp-housing"],
  [/^Light_/, "lamp-emitter"],
  [/^License_Plate_\d+$/, "license-plate"],
  [/^Interior_Static$/, "interior"],
  [/^Steering_Wheel$/, "steering-wheel"],
];

export function classifyName(name) {
  for (const [re, category] of RULES) if (re.test(name)) return category;
  return "unclassified";
}

/** Service-relevant parts CarScope may later ask for. None may be invented when absent. */
export const SERVICE_PARTS = Object.freeze([
  { id: "hv-battery", label: "High-voltage battery pack", pattern: /batter|hv_|cell|pack/i },
  { id: "drive-motor", label: "Drive motor / e-axle", pattern: /motor|e_?axle|inverter|drive_?unit/i },
  { id: "suspension", label: "Suspension (springs, dampers, links)", pattern: /suspens|damper|shock|spring|strut|control_?arm|knuckle/i },
  { id: "brake-disc", label: "Brake disc as separate mesh", pattern: /brake_?disc|rotor/i },
  { id: "brake-caliper", label: "Brake caliper", pattern: /caliper/i },
  { id: "seats", label: "Seats as separate meshes", pattern: /seat/i },
  { id: "charge-port", label: "Charge port", pattern: /charg|port/i },
  { id: "hvac-thermal", label: "Heat pump / thermal system", pattern: /hvac|heat_?pump|radiator|thermal/i },
]);
