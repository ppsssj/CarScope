// Asymmetric diagnostic fixtures, never part of the production car or its part-count baseline.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VIEW, svgScreenPoint } from "./camera.mjs";
export const LANDMARKS = [
  { id: "FRONT", world: [260, 0, 0], color: "#b93817" },
  { id: "REAR", world: [-240, 0, 0], color: "#856000" },
  { id: "LEFT", world: [0, 120, 0], color: "#14765b" },
  { id: "RIGHT", world: [0, -111, 0], color: "#3e63dd" },
  { id: "UP", world: [0, 0, 166], color: "#8844aa" },
];
export function coordinateLandmarks(k, P) {
  return LANDMARKS.map((l) => ({ ...l, anatomyScreen: k.iso(l.world, P), svgScreen: svgScreenPoint(k.iso(l.world, P)), gltfMetres: [l.world[0] / 100, l.world[2] / 100, -l.world[1] / 100] }));
}
export function writeCoordinateDiagnostics(k, dir) {
  const P = k.fitProjection([[0, 0, 0], ...LANDMARKS.map((l) => l.world)], VIEW.width, VIEW.height, { ...VIEW, pad: 50 });
  const landmarks = coordinateLandmarks(k, P), origin = svgScreenPoint(k.iso([0, 0, 0], P));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" style="width:960px;max-width:100%">` +
    landmarks.map((l, i) => `<path d="M${origin.join(" ")}L${l.svgScreen.join(" ")}" stroke="${l.color}" stroke-width="${i + 1}"/><circle cx="${l.svgScreen[0]}" cy="${l.svgScreen[1]}" r="${4 + i}" fill="${l.color}"/><text x="${l.svgScreen[0] + 10}" y="${l.svgScreen[1]}" fill="${l.color}">${l.id}</text>`).join("") + "</svg>";
  writeFileSync(join(dir, "coordinate-contract.json"), JSON.stringify({ axes: "+X front, +Y vehicle-left, +Z up (cm)", camera: VIEW, landmarks }, null, 2));
  writeFileSync(join(dir, "coordinate-contract.html"), `<!doctype html><meta charset="utf-8"><title>CarScope physical coordinate landmarks</title><body style="background:#fff;font:16px sans-serif"><h1>Physical axes / SVG screen basis</h1>${svg}<p>FRONT/REAR and LEFT/RIGHT are physical vehicle directions. The screen coordinates are separate.</p>`);
}
