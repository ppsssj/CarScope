#!/usr/bin/env node
// Convert the OpenX hyundai_ioniq_5_2022.blend to GLB without Blender.
//   node tools/ioniq5-asset/convert.mjs --input=<.blend> --out=<dir outside the repo> [--xoma=<.xoma>]
// Writes <out>/hyundai_ioniq_5_2022.glb and <out>/conversion.json. The source file is only read.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContainer, openBlend, parseBlend } from "./blend-reader.mjs";
import { extractScene } from "./blend-scene.mjs";
import { SOURCE_TO_GLTF, sceneToGlb } from "./to-gltf.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const inside = (child, parent) => { const r = relative(parent, child); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

export function convertBlend(bytes, { sourceName = "source.blend", xoma = null } = {}) {
  const container = detectContainer(bytes);
  const opened = openBlend(bytes);
  const parsed = parseBlend(opened.data);
  const scene = extractScene(parsed);
  const issues = scene.objects.flatMap((o) => o.issues.map((i) => `${o.name}: ${i}`));
  const meta = xoma?.metadata ?? null;
  const provenance = {
    sourceFile: sourceName,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceBytes: bytes.length,
    container, zstdFrames: opened.frames, decompressedBytes: opened.data.length,
    blendHeader: opened.header, blenderFileVersion: `${+parsed.version.slice(0, 2)}.${+parsed.version.slice(2)}`,
    license: meta?.license ?? "UNKNOWN", copyrights: meta?.copyrights ?? [], authors: meta?.authors ?? [], uuid: meta?.uuid ?? null, name: meta?.name ?? null,
  };
  const { glb, meshStats } = sceneToGlb(scene, { carscope: { sourceFrame: "Blender Z-up, +X forward, +Y left, metres", axisMap: SOURCE_TO_GLTF, dimensionCalibration: "NONE", provenance } });
  return {
    glb,
    report: {
      tool: "tools/ioniq5-asset/convert.mjs", provenance, axisMap: SOURCE_TO_GLTF,
      counts: { objects: scene.objects.length, meshObjects: scene.objects.filter((o) => o.mesh).length, empties: scene.objects.filter((o) => o.type === "EMPTY").length, meshes: scene.meshes.length, materials: scene.materials.length,
        triangles: Object.values(meshStats).reduce((a, s) => a + s.triangles, 0), sourceVertices: scene.meshes.reduce((a, m) => a + m.counts.point, 0), sourceFaces: scene.meshes.reduce((a, m) => a + m.counts.face, 0) },
      issues,
      meshes: scene.meshes.map((m) => ({ name: m.name, ...m.counts, ...meshStats[m.name], materials: m.materials, sharpFaces: m.sharpFace.filter(Boolean).length,
        uvMaps: m.uvMaps, shapeKeys: m.shapeKeys, customNormals: m.customNormals, sharpEdges: m.sharpEdges, ignoredAttributes: m.ignoredAttributes.map((a) => a.name) })),
      materials: scene.materials,
      limits: [
        "No modifier/constraint evaluation (none present in this source; any would be listed in issues).",
        "Shading normals are derived (face normal for sharp faces, angle-weighted smooth normals otherwise).",
        "Blender custom split normals (custom_normal, int16x2 in corner normal space) are NOT decoded; meshes listing it shade slightly differently from Blender. Positions and topology are unaffected.",
        "No UV maps or textures exist in this source, so none are exported.",
        "Lights, cameras and animation are not exported.",
      ],
    },
  };
}

/** Integrity summary of a .blend without converting it (used by get-openx-source.ps1). */
export function checkBlend(bytes) {
  const opened = openBlend(bytes);
  const parsed = parseBlend(opened.data);
  const codes = {};
  for (const b of parsed.blocks) codes[b.code] = (codes[b.code] ?? 0) + 1;
  return { container: opened.container, zstdFrames: opened.frames, sourceBytes: bytes.length, decompressedBytes: opened.data.length,
    blendHeader: opened.header, blenderFileVersion: `${+parsed.version.slice(0, 2)}.${+parsed.version.slice(2)}`, sdnaStructs: parsed.structs.length,
    blocks: parsed.blocks.length, endb: parsed.blocks.at(-1).code === "ENDB", objects: codes.OB ?? 0, meshes: codes.ME ?? 0, materials: codes.MA ?? 0,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

function main(argv) {
  const args = Object.fromEntries(argv.map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  if (args.check && args.input) {
    console.log(JSON.stringify(checkBlend(readFileSync(resolve(args.input))), null, 2));
    return 0;
  }
  if (!args.input || !args.out) {
    console.error("usage: node tools/ioniq5-asset/convert.mjs --input=<.blend> --out=<dir outside the repo> [--xoma=<.xoma>]\n       node tools/ioniq5-asset/convert.mjs --check --input=<.blend>");
    return 2;
  }
  const input = realpathSync(resolve(args.input));
  const out = resolve(args.out);
  if (inside(out, REPO)) throw new Error(`Refusing to write converted third-party geometry inside the CarScope repo: ${out}`);
  if (inside(out, dirname(input))) throw new Error(`Refusing to write next to the source asset: ${out}`);
  const xomaPath = args.xoma ? resolve(args.xoma) : input.replace(/\.blend$/, ".xoma");
  const xoma = existsSync(xomaPath) ? JSON.parse(readFileSync(xomaPath, "utf8")) : null;
  const { glb, report } = convertBlend(readFileSync(input), { sourceName: basename(input), xoma });
  mkdirSync(out, { recursive: true });
  const glbPath = join(out, basename(input).replace(/\.blend$/, ".glb"));
  writeFileSync(glbPath, glb);
  report.output = { glb: basename(glbPath), bytes: glb.length, sha256: createHash("sha256").update(glb).digest("hex") };
  writeFileSync(join(out, "conversion.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`CONVERTED ${glbPath} (${glb.length} bytes, ${report.counts.meshes} meshes, ${report.counts.triangles} triangles, ${report.issues.length} issues)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`FAILED: ${e.message}`); process.exitCode = 1; }
}
