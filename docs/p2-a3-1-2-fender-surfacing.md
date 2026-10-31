# P2-A3-1.2 · Front fender surfacing

## Geometry audit and decision

Base is PR #10 merge `74ad2c64e2ff28dfa27c8c3b5ee7023a3444da30`. `envelope/model.mjs` builds both SUV sides from x-monotone `region()` prisms. The prior `suv.front-quarter.{±1}` outer skin is a constant-Y extrusion with a sampled circular lower boundary; the inner bands, doors and front fascia are separate solids. The P2-A3-1.1 hood is a closed `loftMesh` whose top, sides and caps are generated from aligned rectangular X/Y sections. Its outer edge lies at Y = ±98.4 cm. The front quarter's inner edge was Y = ±98.6 cm, a 2 mm nominal seam. The old panel side extended to Y = ±100.395 cm. Front-door hinge X = 84 cm; front quarter starts at X = 85.5 cm. Front fascia begins at X = 246.7 cm.

The hood loft requires identical Y stations at every X and cannot represent a wheel opening as its lower boundary. Extending it to arbitrary cross-sections would change the established hood contract. A second restricted primitive, `fenderMesh`, instead sweeps ordered ten-point Y/Z sections along increasing X. Each section follows the existing front wheel-arch bottom and hood mesh-edge height. It generates a closed indexed triangle mesh with outward winding, smooth side normals where valid, and flat normals around the tight inner seam and caps. X sections are limited to the front quarter; this is not an unrestricted freeform/NURBS engine. The preserved before variant uses `fenderSurface:false`.

`withGeo` attaches one `kind:"fender"` input to the SVG primitive. `generateGeometry` rebuilds exactly that mesh for GLB. The SVG draws its visible triangles; a convex hull fill would hide the actual wheel cutout, so only the true arch lip is outlined. Anatomy records thin triangle shapes for depth/audit from every swept band except the bottom lip face: the outer side, shoulder and top, the seam step and shelf under the hood edge, and the inner backing. The end caps are not recorded. The inner backing is included deliberately: without it the outer skin had no recorded support path to the front-quarter bands and the Anatomy audit failed. The inherited Sedan code and Anatomy upstream remain untouched.

### Front wheel-arch trim

The first P2-A3-1.2 revision dropped the front arch trim, leaving the rear arch trimmed and the front bare. The old trim is a planar `poly` inlay at Y = ±half-width, which only fits the Y-constant prism skin it was drawn on. On the curved fender it would either float up to 12.5 mm off the inset lip or cut into the skin, so it was not reused.

`archTrim` (in `geometry-export/fender.mjs`) builds the replacement from the fender mesh itself. It covers the same region as the rear trim: the annulus between `archRadius` 46 cm and `flareRadius` 48.5 cm about the front axle, cut at axle height. Every outward-facing fender skin triangle is clipped to that region strip by strip (one strip per fender section pair, where the region is convex), then offset along Y by 0.5 mm (inner face) and 2.0 mm (outer face). The inner face is therefore parallel to the skin everywhere, at an exact 0.5 mm clearance with no sag, so there is no penetration or Z-fighting. The result is a closed 1.5 mm shell, not a decal.

- The fender already has sections at axle ± 46 cm, so the trim's inner boundary is exactly the lip polyline and never hangs over the wheel opening.
- Adjacent strips share their boundary vertices (no T-junctions). The walls are generated from the inner face's boundary edges.
- A coverage check requires the clipped area to equal the region area, which proves a single layer without holes. The shell volume equals area × 1.5 mm exactly.
- The trim stays inside the body side (outer face ≤ half-width − 0.84 mm), so the observed width is unchanged.

A grid sampled on the skin was tried first and rejected. Near the arch feet the fender's inset lip runs vertically through a 2.2 mm-wide twisted strip, so planar trim triangles cut 3.3 mm into the skin. Lifting them clear made the trim stick out 2.75 mm past the body side.

In SVG the trim is a `poly` in the fender item, filled with the rear trim's `trim` palette and no stroke, drawn from the outer face's boundary loop. In GLB it is part `suv.front-fender.±1/1`, class `trimShell`, material `trim` (the same material as the rear trim). The SVG outline and the GLB mesh come from one `archTrim` result. The rear trim is unchanged: it is still the planar zero-thickness inlay on its flat skin. The two arches therefore match in colour, radial width and outline, but not in construction.

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

The nominal hood-edge height is taken from **the generated hood mesh**, not from the earlier piecewise profile line: the two differed by up to 3.19 cm near X = 237 cm before this correction. The new fender includes every hood edge X knot. At those stations the Z gap is 0 and the Y seam is 0.2 cm.

The normal angle is measured on 55 samples, one per fender strip whose mid-X lies within the hood's X range. Each sample compares two triangles:

- the fender seam triangle (ring point 6 at section i, ring point 7 at section i, ring point 7 at section i+1);
- the hood's outermost top triangle in the first hood row at or beyond the strip's mid-X (second-to-last point of the previous row, second-to-last point of that row, last point of that row).

With this choice the angle is 5.5° mean and 8.2° maximum (5.47°/8.16°). Using the other triangle of the same hood quad gives 5.8°/8.5°. The test gates the first measure at < 10°. This evaluates visual alignment across a deliberate gap; it does not prove G1. C0 means the intended seam position and width match at the sampled knots. G1 and G2 mathematical continuity are **not claimed**. The fascia and front door retain separate panel boundaries.

The wheel arch and shoulder now have genuinely different Y/Z coordinates, mirrored left/right. The observed length 4950 mm, body width 2008 mm, height 1776 mm, mirror width 2140 mm, wheelbase 2984 mm, tracks 1665/1667 mm are unchanged. Turning diameter 11800 mm is metadata only; steering geometry is not modeled.

## Validation

| Gate | Fresh result / scope |
| --- | --- |
| `node --test tools/anatomy-car/test/fender.test.mjs` | PASS 4/4: before SUV GLB byte hash, actual bilateral curved vertices and closed topology, SVG/GLB shared input, 2 mm seam and sampled normal angle, no hood/fascia penetration; arch trim closed/mirrored/shared SVG-GLB build, volume = area × 1.5 mm, no fender penetration, inside body side, above the lip |
| `npm test --prefix tools/anatomy-car` | PASS 52/52; includes Sedan SVG/GLB byte regression and four fender tests |
| `npm run build`, `npm run export`, `npm run verify --prefix tools/anatomy-car` | PASS; Sedan audit 0, original asset SHA-256 `a6f19a53…`, GLB 91 parts / 7,573 triangles, Khronos errors/warnings 0 |
| `npm run envelope --prefix tools/anatomy-car` | PASS; Anatomy audit 0, 143 parts / 14,988 triangles, 141/141 closed meshes watertight/outward (2 open parts are the planar rear trims), degenerate/flipped 0, seven observed dimensions 0 mm error, four-door sampled sweep 0 violations at unchanged 0.3 cm policy |
| `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS, 24/24 JVM tests, BUILD SUCCESSFUL |
| Actual SVG/GLB captures | [Ten committed PNGs](visuals/p2-a3-1-2/README.md), captured from CarScope source and visually inspected |

Closed fender meshes are individually watertight with zero degenerate/flipped triangles and consistent outward winding. The sampled hood/fender and fascia/fender surface tests have zero penetration. Fascia contact can produce coincident triangle intersections at the panel boundary with **zero volumetric depth**; this is not counted as mesh penetration. The older interior bands retain their shared support/contact with the outer skin. The current checks do not constitute a general proof of all possible inter-part or continuous door-motion intersections.

Before comparison is 143 parts / 11,340 triangles / 688 front-quarter triangles. After is 143 parts / 14,988 triangles: 2,312 front-fender and 1,920 front arch trim triangles; total +3,648 triangles. One final-code local run measured model generation 9,159 vs 10,569 ms and export 287 vs 272 ms. No repeated benchmark or AVD frame timing was performed.

The [actual Before/After gallery](visuals/p2-a3-1-2/README.md) shows softer front wheel volume in GLB and SVG. At full-car scale the change remains modest; the front fascia, doors and rear quarter still give the car a boxy appearance. SVG face shading is discrete. The front arch trim now matches the rear in colour and radial width. It follows the fender's 12.5 mm inset lip roll, so in GLB 3/4 views it sits slightly deeper than the flush rear inlay. Its feet are cut at axle height, like the rear trim. Next work can evaluate separate roof/rear-quarter patches after equivalent shared-geometry, boundary, collision and visual evidence; it should not infer OEM accuracy from this reference model.
