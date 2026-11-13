# P17 evidence index

Fresh local run: 2026-11-13, Windows, Node 22.16.0, Edge 157.0.4341.46, worktree `CarScope-p17-mobile-astryx`.

Raw artifacts are outside Git at `C:\CarScope-External\qr-ar-01\p17-react-astryx\`. They contain synthetic camera/photo inputs, local test sessions and MOCK AI only. Do not upload database files, credentials or raw logs into Git.

| Artifact | What it demonstrates |
| --- | --- |
| `before-intro.png` | Original washer entry, 390×844 |
| `after-intro.png` | Redesigned washer entry at the same viewport |
| `after-catalog.png` | 17-task catalog with all drawings loaded |
| `after-camera.png` | Synthetic camera, manual 2D marker and unverified color candidates |
| `after-observation-320.png`, `after-observation-768.png` | Phone/tablet observation layout |
| `after-review.png`, `after-completed.png` | Explicit review and local completion |
| `after-server-receipt.png`, `after-vehicle-receipt.png` | Server receipt distinct from vehicle app receipt |
| `after-network-error.png` | Failed transmission with retry |
| `after-ai-result.png` | MOCK AI evidence distinct from human responses |
| `react-browser-report.json`, `react-e2e.log` | React journeys, accessibility, runtime/CSP checks |
| `mobile-unit.log`, `sync-unit-final.log`, `tls-focused.log` | Unit and server/TLS regression outputs |
| `build.log`, `core-test.log`, `webxr-e2e.log` | Build, pure Kotlin core, isolated synthetic WebXR regression |

The before/after comparison changes the entry from a camera-oriented worksheet to a clearly staged inspection notebook. Catalog, observation, review and receipt screens share typography, spacing, control shapes and status language. Screenshots were visually inspected; this is not a real-device performance or accuracy claim.

Final gate counts and CI URL are recorded in the main [P17 report](../../p17-mobile-react-astryx.md) after the final run.
