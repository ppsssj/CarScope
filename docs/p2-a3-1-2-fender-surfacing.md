# P2-A3-1.2 · Front fender surfacing

## Geometry audit and decision

Base is PR #10 merge `74ad2c64e2ff28dfa27c8c3b5ee7023a3444da30`. `envelope/model.mjs` builds both SUV sides from x-monotone `region()` prisms. The prior `suv.front-quarter.{±1}` outer skin is a constant-Y extrusion with a sampled circular lower boundary; the inner bands, doors and front fascia are separate solids. The P2-A3-1.1 hood is a closed `loftMesh` whose top, sides and caps are generated from aligned rectangular X/Y sections. Its outer edge lies at Y = ±98.4 cm. The front quarter's inner edge was Y = ±98.6 cm, a 2 mm nominal seam. The old panel side extended to Y = ±100.395 cm. Front-door hinge X = 84 cm; front quarter starts at X = 85.5 cm. Front fascia begins at X = 246.7 cm.

The hood loft requires identical Y stations at every X and cannot represent a wheel opening as its lower boundary. Extending it to arbitrary cross-sections would change the established hood contract. A second restricted primitive, `fenderMesh`, instead sweeps ordered ten-point Y/Z sections along increasing X. Each section follows the existing front wheel-arch bottom and hood mesh-edge height. It generates a closed indexed triangle mesh with outward winding, smooth side normals where valid, and flat normals around the tight inner seam and caps. X sections are limited to the front quarter; this is not an unrestricted freeform/NURBS engine. The preserved before variant uses `fenderSurface:false`.

`withGeo` attaches one `kind:"fender"` input to the SVG primitive. `generateGeometry` rebuilds exactly that mesh for GLB. The SVG draws its visible triangles; a convex hull fill would hide the actual wheel cutout, so only the true arch lip is outlined. Anatomy records the outer surface as actual thin triangle shapes for depth/audit. The inherited Sedan code and Anatomy upstream remain untouched.

## Boundary and design estimates

All figures below are **DESIGN_ESTIMATE**, not AAOS measurements or OEM shape claims.

| Construction value | Value | Role |
| --- | ---: | --- |
| Hood centre crown | 55 mm | P2-A3-1.1 value, unchanged |
| Hood/fender lateral seam | 2 mm | Y 98.4 to 98.6 cm at either side |
| Fender inner backing inset from half-width | 50 mm | Inner support around wheel opening |
| Arch lip inset from half-width | 12.5 mm | Outer wheel-cut edge |
| Shoulder drop | 22 mm | From hood edge toward outer side; profile estimate |
| Shoulder transition near seam | 0.8 mm | Restrains visible tangent break |
| Rear fender X start / front X stop | 85.5 / 246.7 cm | Door clearance / fascia contact |

The nominal hood-edge height is taken from **the generated hood mesh**, not from the earlier piecewise profile line: the two differed by up to 3.19 cm near X = 237 cm before this correction. The new fender includes every hood edge X knot. At those stations the Z gap is 0 and the Y seam is 0.2 cm. In 55 adjacent face comparisons the normal angle is 5.5° mean and 8.2° maximum. This evaluates visual alignment across a deliberate gap; it does not prove G1. C0 means the intended seam position and width match at the sampled knots. G1 and G2 mathematical continuity are **not claimed**. The fascia and front door retain separate panel boundaries.

The wheel arch and shoulder now have genuinely different Y/Z coordinates, mirrored left/right. The observed length 4950 mm, body width 2008 mm, height 1776 mm, mirror width 2140 mm, wheelbase 2984 mm, tracks 1665/1667 mm are unchanged. Turning diameter 11800 mm is metadata only; steering geometry is not modeled.

## Validation

| Gate | Fresh result / scope |
| --- | --- |
| `node --test tools/anatomy-car/test/fender.test.mjs` | PASS 3/3: before SUV GLB byte hash, actual bilateral curved vertices and closed topology, SVG/GLB shared input, 2 mm seam and sampled normal angle, no hood/fascia penetration |
| `npm test --prefix tools/anatomy-car` | PASS 51/51; includes Sedan SVG/GLB byte regression and three new fender tests |
| `npm run build`, `npm run export`, `npm run verify --prefix tools/anatomy-car` | PASS; Sedan audit 0, original asset SHA-256 `a6f19a53…`, GLB 91 parts / 7,573 triangles, Khronos errors/warnings 0 |
| `npm run envelope --prefix tools/anatomy-car` | PASS; Anatomy audit 0, 141 parts / 13,068 triangles, 139/139 closed meshes watertight/outward, degenerate/flipped 0, seven observed dimensions 0 mm error, four-door sampled sweep 0 violations at unchanged 0.3 cm policy |
| `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS, 24/24 JVM tests, BUILD SUCCESSFUL |
| Actual SVG/GLB captures | [Ten committed PNGs](visuals/p2-a3-1-2/README.md), captured from CarScope source and visually inspected |

Closed fender meshes are individually watertight with zero degenerate/flipped triangles and consistent outward winding. The sampled hood/fender and fascia/fender surface tests have zero penetration. Fascia contact can produce coincident triangle intersections at the panel boundary with **zero volumetric depth**; this is not counted as mesh penetration. The older interior bands retain their shared support/contact with the outer skin. The current checks do not constitute a general proof of all possible inter-part or continuous door-motion intersections.

Before comparison is 143 parts / 11,340 triangles / 688 front-quarter triangles. After is 141 parts / 13,068 triangles / 2,312 front-fender triangles; total +1,728 triangles. One final-code local run measured model generation 9,133 vs 10,275 ms and export 329 vs 228 ms. No repeated benchmark or AVD frame timing was performed.

The [actual Before/After gallery](visuals/p2-a3-1-2/README.md) shows softer front wheel volume in GLB and SVG. At full-car scale the change remains modest; the front fascia, doors and rear quarter still give the car a boxy appearance. SVG face shading is discrete, and wheel-arch trim is simplified. Next work can evaluate separate roof/rear-quarter patches after equivalent shared-geometry, boundary, collision and visual evidence; it should not infer OEM accuracy from this reference model.
