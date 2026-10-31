# tools/ioniq5-asset — OpenX IONIQ 5 external mesh (P2-A6)

Converts the OpenX Assets `hyundai_ioniq_5_2022.blend` to GLB **without Blender**, analyses it and
prepares a separate `hyundai-ioniq5-2022` vehicle profile. Node.js >= 22.15 (built-in zstd), no npm
dependencies; tests reuse the locked `gltf-validator` from `tools/anatomy-car`.
Findings, measurements and limits: [docs/p2-a6-ioniq5-asset.md](../../docs/p2-a6-ioniq5-asset.md).

The source and every derived GLB stay **outside this repository**. `convert.mjs` refuses to write into
the repo or next to the source.

```powershell
# 1. fetch or re-verify the source (Git LFS, byte-level container check, SHA-256 = LFS oid, structure parse)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/get-openx-source.ps1 -Destination C:\CarScope-External\openx-assets
$blend = 'C:\CarScope-External\openx-assets\src\vehicles\hyundai_ioniq_5_2022\hyundai_ioniq_5_2022.blend'
# 2. convert (writes hyundai_ioniq_5_2022.glb + conversion.json)
node tools/ioniq5-asset/convert.mjs --input=$blend --out=C:\CarScope-External\ioniq5-carscope
# 3. analyse (writes .analysis.json; exits 1 on any FAIL check)
node tools/ioniq5-asset/analyze.mjs --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb --blend=$blend
# 4. tests (synthetic; set IONIQ5_BLEND to include the real-asset integration test)
$env:IONIQ5_BLEND = $blend; node --test tools/ioniq5-asset/test/ioniq5-asset.test.mjs
# 5. browser PoC (debug only)
$env:CARSCOPE_IONIQ5_GLB = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'; node tools/three-poc/serve.mjs
#    http://127.0.0.1:8095/ioniq5.html ; automated check: node tools/three-poc/check-ioniq5.mjs
```

| File | Role |
|---|---|
| `blend-reader.mjs` | Container detection (plain / gzip / seekable multi-frame zstd / LFS pointer), Blender 5.x block + SDNA parser, ID-scoped pointer resolution |
| `blend-scene.mjs` | Objects (hierarchy, loc / XYZ Euler / scale), meshes (`position`, `.corner_vert`, face offsets, `material_index`, `sharp_face`), Principled BSDF constants |
| `to-gltf.mjs` | Triangulation, derived normals, axis layer `(x,y,z) -> (x,z,-y)` (metres, no scale node), GLB writer |
| `convert.mjs` | CLI + `--check` integrity mode |
| `analyze.mjs` | Independent GLB reader, CarScope-cm world bounds, spec comparison, part availability, cross-checks against `.xoma` and the `.blend` |
| `parts.mjs` | Name-based categories (browser-safe); service parts that must report `NOT_AVAILABLE` when absent |
| `profile.mjs` | `VEHICLE_PROFILES` registry: `pleos-avd-reference` (default, unchanged) and `hyundai-ioniq5-2022` |

## P2-A7: Anatomy-style SVG from the GLB

Details and measurements: [docs/p2-a7-ioniq5-anatomy-svg.md](../../docs/p2-a7-ioniq5-anatomy-svg.md). The generic
mesh adapter lives in [tools/anatomy-car/mesh-svg/](../anatomy-car/mesh-svg/); this folder only binds the IONIQ 5
materials and part IDs. Output is model-derived and stays outside the repository.

```powershell
$glb = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
node tools/ioniq5-asset/anatomy-svg.mjs --glb=$glb --out=C:\CarScope-External\ioniq5-svg   # --tolerance=1.5 --min-region=12
# SVG vs GLB with the same camera (GPU part-ID comparison, hit tests, paint timing)
$env:CARSCOPE_IONIQ5_GLB = $glb; $env:CARSCOPE_IONIQ5_SVG_DIR = 'C:\CarScope-External\ioniq5-svg'; node tools/three-poc/serve.mjs
node tools/three-poc/check-ioniq5-svg.mjs http://127.0.0.1:8095/ioniq5-svg.html C:\CarScope-External\ioniq5-svg\compare.png
# existing Kotlin renderer with the IONIQ 5 asset, local only (swaps and restores the resource, SHA-checked)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/eval-android-renderer.ps1 -Parts C:\CarScope-External\ioniq5-svg\ioniq5.parts -Out C:\CarScope-External\android-eval
# tests (IONIQ5_GLB enables the real-asset test)
node --test tools/ioniq5-asset/test/*.test.mjs; node --test tools/anatomy-car/test/mesh-svg.test.mjs
```

## P2-A8: Android debug runtime

Details and AVD measurements: [docs/p2-a8-android-runtime-validation.md](../../docs/p2-a8-android-runtime-validation.md).
`ioniq5.parts` now declares `#visual-profile hyundai-ioniq5-2022` and `#door-pose closed-only` (closed sections only).

```powershell
.\gradlew.bat :app:assembleDebug; adb install -r app\build\outputs\apk\debug\app-debug.apk
powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/push-debug-asset.ps1 -Parts C:\CarScope-External\ioniq5-svg\ioniq5.parts
adb shell am start -n io.carscope.app/.profile.VisualProfileActivity --es profile hyundai-ioniq5-2022
node tools/ioniq5-asset/avd-validate.mjs --out=C:\CarScope-External\p2-a8\run1   # captures + timings, outside the repo
```

## P3-A1: hood hinge feasibility

Details, sources and measurements: [docs/p3-a1-hood-hinge-feasibility.md](../../docs/p3-a1-hood-hinge-feasibility.md).
`hood.mjs` and `collision.mjs` are browser-safe and shared by the Node report and the PoC page. Hinge axes are
candidates (A: OpenX group origin, UNVERIFIED; B/C: ESTIMATED), never a verified Hyundai hinge.

```powershell
$glb = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
node tools/ioniq5-asset/hood-feasibility.mjs --glb=$glb --out=C:\CarScope-External\p3-a1\report   # --quick for a coarse run
$env:CARSCOPE_IONIQ5_GLB = $glb; $env:CARSCOPE_P3A1_DIR = 'C:\CarScope-External\p3-a1\report'; node tools/three-poc/serve.mjs
#    http://127.0.0.1:8095/ioniq5-hood.html
node tools/three-poc/check-ioniq5-hood.mjs C:\CarScope-External\p3-a1\captures
$env:IONIQ5_GLB = $glb; node --test tools/ioniq5-asset/test/hood.test.mjs
```

Not implemented (reported, not guessed): modifier/constraint evaluation (none in this source),
Blender custom split normals (`custom_normal` is stored relative to Blender's corner normal spaces),
UVs/textures (none in this source), older `.blend` header formats.
