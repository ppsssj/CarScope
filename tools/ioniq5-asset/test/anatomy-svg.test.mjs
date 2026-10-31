// P2-A7 binding tests: synthetic data only. Set IONIQ5_GLB to also run the real-asset test.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIAL_PALETTE, FLAT_PALETTES, partIds, partsAsset, buildIoniqSvg, threeCamera } from "../anatomy-svg.mjs";
import { PALETTES } from "../../anatomy-car/automotive/materials.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

test("every IONIQ 5 material maps to an existing shaded Anatomy palette, never red", () => {
  // Material names recorded by P2-A6 (docs evidence, no geometry).
  const names = JSON.parse(readFileSync(join(REPO, "docs", "visuals", "p2-a6", "ioniq5-conversion.json"), "utf8")).materials.map((m) => m.name);
  assert.equal(names.length, 30);
  for (const n of names) assert.ok(PALETTES[MATERIAL_PALETTE[n]]?.shades, `${n} -> ${MATERIAL_PALETTE[n]}`);
  for (const p of FLAT_PALETTES) assert.ok(PALETTES[p]?.shades);
  assert.equal(MATERIAL_PALETTE.Lamp_Red, "lampSmoke", "red stays reserved for the OPEN accent");
});

const node = (name, [x, y, z]) => ({ name, triangles: Float64Array.from([x - 1, y, z, x + 1, y, z, x, y + 1, z]), materials: ["Body"] });

test("door and wheel IDs come from position and must agree with the OpenX names", () => {
  const nodes = [node("Body", [0, 0, 80]), node("Door_Left_0", [30, 90, 90]), node("Door_Left_1", [-80, 90, 90]), node("Door_Right_0", [30, -90, 90]), node("Door_Right_1", [-80, -90, 90]),
    node("Wheel_0_0", [145, -77, 37]), node("Wheel_0_1", [145, 77, 37]), node("Wheel_1_0", [-156, -77, 37]), node("Wheel_1_1", [-156, 77, 37]), node("Door_Front_0", [150, 0, 100])];
  const { ids, problems } = partIds(nodes);
  assert.deepEqual(problems, []);
  assert.equal(ids.get("Door_Left_0"), "door-front-left");
  assert.equal(ids.get("Door_Right_1"), "door-rear-right");
  assert.equal(ids.get("Wheel_0_0"), "wheel-front-right");
  assert.equal(ids.get("Wheel_1_1"), "wheel-rear-left");
  assert.equal(ids.get("Door_Front_0"), "hood");
  // A mislabelled source is reported, not silently renamed.
  const swapped = nodes.map((n) => (n.name === "Door_Left_0" ? { ...n, name: "Door_Left_1" } : n.name === "Door_Left_1" ? { ...n, name: "Door_Left_0" } : n));
  assert.ok(partIds(swapped).problems.some((p) => /Door_Left_0: position says door-rear-left/.test(p)));
});

test("app asset text keeps the #carscope-anatomy-car 1 grammar and declares closed-only doors", () => {
  const k = { pathOf: (pts, closed) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + (closed ? "Z" : "") };
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const built = {
    order: ["body", "door-front-left"], halo: "<path d=\"M0 0Z\"/>", anatomy: { k },
    result: {
      fills: [{ id: "body", color: "#eee", d: "M0 0L20 0L20 20Z" }, { id: "door-front-left", color: "#ddd", d: "M0 0L10 0L10 10Z" }],
      strokes: [0, 1, 2, 3].map((i) => ({ tone: "hi", parts: ["door-front-left", "body"], pts: [sq[i], sq[i + 1]], d: k.pathOf([sq[i], sq[i + 1]]) })),
    },
  };
  const { text, missing } = partsAsset(built, { rev: "1482e84" });
  const lines = text.split("\n");
  assert.equal(lines[0], "#carscope-anatomy-car 1");
  assert.equal(lines[1], "#viewbox 640 330");
  assert.equal(lines[3], "#visual-profile hyundai-ioniq5-2022");
  assert.equal(lines[4], "#door-pose closed-only");
  assert.equal(lines[5], "@static");
  assert.deepEqual(missing, ["door-rear-left", "door-front-right", "door-rear-right"]);
  assert.equal(lines.indexOf("@door door-front-left open"), -1, "no fake open pose");
  for (const v of ["closed"]) {
    const at = lines.indexOf(`@door door-front-left ${v}`);
    assert.ok(at > 0);
    assert.equal(lines[at + 2], `@accent door-front-left ${v}`);
    assert.match(lines[at + 3], /^M0 0(L\d+ \d+){3,4}Z$/, "accent is one closed ring");
  }
  // Body lines never start with '@' or '#' (renderer parse rule): markup, or path data after @accent.
  lines.forEach((l, i) => { if (i > 4 && l && !/^[@#]/.test(l)) assert.match(l, lines[i - 1].startsWith("@accent") ? /^M/ : /^</); });
  assert.equal(lines.filter((l) => l.startsWith("@door")).length, 1);
});

test("the CLI refuses to write model-derived SVG into the repository", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "anatomy-svg.mjs"), "--glb=missing.glb", `--out=${join(REPO, "tools", "tmp-ioniq5-svg")}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to write model-derived SVG inside the CarScope repo/);
  assert.ok(!existsSync(join(REPO, "tools", "tmp-ioniq5-svg")));
});

const real = process.env.IONIQ5_GLB;
test("real IONIQ 5 GLB -> Anatomy SVG", { skip: !real || !existsSync(real) ? "IONIQ5_GLB not set" : false }, async () => {
  const built = await buildIoniqSvg(readFileSync(real));
  assert.deepEqual(built.problems, []);
  const s = built.result.stats;
  assert.equal(s.triangles, 37350);
  assert.ok(s.visibleTriangles > 5000 && s.visibleTriangles < s.triangles);
  assert.ok(Buffer.byteLength(built.svg) < 200_000, `SVG ${Buffer.byteLength(built.svg)} B`);
  for (const id of ["body", "glass", "hood", "door-front-left", "door-rear-left", "wheel-front-left", "wheel-rear-left"]) assert.ok(built.result.fills.some((f) => f.id === id), id);
  for (const id of ["door-front-right", "door-rear-right", "wheel-front-right"]) assert.ok(!built.result.fills.some((f) => f.id === id), `${id} is hidden from the front-left view`);
  // VehicleSvgRenderer inserts asset markup verbatim: only static path/group markup may appear.
  const tags = new Set([...built.svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...tags].sort(), ["g", "path", "svg"]);
  const attrs = new Set([...built.svg.matchAll(/\s([a-zA-Z-:]+)="/g)].map((m) => m[1]));
  for (const a of attrs) assert.ok(["xmlns", "viewBox", "role", "aria-label", "id", "data-part", "data-line", "d", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linejoin", "stroke-linecap"].includes(a), `attribute ${a}`);
  const cam = threeCamera(built.P, built.anatomy.G, built.bounds);
  assert.ok(cam.direction[0] > 0 && cam.direction[2] < 0, "camera on the front-left (glTF -Z = car left)");
});
