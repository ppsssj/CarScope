# P2-A3-1 evidence index

Fresh recovery run on `feat/p2-a3-1-vehicle-geometry-profile`, base `0885734`, Windows PowerShell, Node 22 and JDK 17:

| Gate | Result | Command / local evidence |
| --- | --- | --- |
| Sedan Anatomy SVG audit | PASS | `npm run build --prefix tools/anatomy-car`; zero audit problems, asset SHA-256 `a6f19a53bf6b6453a2255a67de1ab15b976e68b07facf0e4a527558a3d7c2197` |
| Sedan GLB | PASS | `npm run export --prefix tools/anatomy-car` and `npm run verify --prefix tools/anatomy-car`; 91 parts, 7,573 triangles, Khronos 0 errors / 0 warnings |
| SUV SVG/GLB | PASS | `npm run envelope --prefix tools/anatomy-car`; 143 parts, 11,120 triangles, Anatomy audit zero problems, observed dimensions and sampled collisions pass. Generated evidence is Git ignored under `tools/anatomy-car/build/envelope/`. |
| Node regression | PASS | `npm test --prefix tools/anatomy-car`; 45 passed, 0 failed/skipped |
| Kotlin core | PASS | `.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`; BUILD SUCCESSFUL |
| Browser visual capture | PASS for committed views | PR HEAD `2d525c0`에서 `compare.mjs`와 `check-visuals.mjs`로 새 캡처. 실제 이미지를 열어 모델·방향·도어·음영·clipping을 확인하고 [11개 PNG 갤러리](../../../visuals/p2-a3-1/README.md)에 게시. Capture console clean. |
| AVD / OEM match | NOT_RUN / UNVERIFIED | No fresh AVD run or OEM visual identity proof. `turningDiameter` is retained as metadata, not implemented steering geometry. |

The SVG and GLB are generated from the same SUV model recorder. `envelope.test.mjs` checks the GLB binary dimensions, vehicle axes, four door pivots, and SVG projection bounds. The 0.3 cm penetration limit in `geometry-export/policy.mjs` is unchanged. Sampling does not prove continuous rotation free of collision.

Visual publication rerun: `npm run build`, `npm run export`, `npm run envelope`, `npm test`, `npm run verify` (all under `tools/anatomy-car`) and `.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` all PASS. Node 45/45, Kotlin BUILD SUCCESSFUL. The 11 published PNGs total 693,489 bytes. No AVD or OEM visual matching run was performed.
