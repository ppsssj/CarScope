# P20 evidence index

Fresh local run on 2026-11-14 in the `CarScope-p20-mobile` worktree (branch `feat/p20-chabodam-mobile-ui`). Windows 10, Node 22.16.0, Edge 157.0.4341.46 headless (Playwright 1.56.1). Camera input is a synthetic canvas stream, and AI is the local MOCK provider through the real relay. No real phone, AI provider, AVD or vehicle was used.

Raw artifacts are outside Git at `C:\CarScope-External\p20-chabodam\`.

| Folder / file | Command | Result |
| --- | --- | --- |
| `react/react-browser-report.json` + screenshots | `POC_EVIDENCE_DIR=… npm run test:browser:react` | PASS 23/23, 0 runtime/CSP errors, 0 axe (WCAG 2 A/AA, 2.1 AA) violations in 14 states |
| `hosting/` | `npm run test:browser:hosting` | PASS: Vite dev and copied static staging |
| `p19-lab-regression/` | `npm run build:toss-lab && npm run test:browser:toss-lab`; `npm run test:toss-lab:model` | PASS, model 6/6 |
| `webxr/` | `npm run test:browser:webxr` | PASS (all QR/WebXR scenarios) |
| `sync-tests.log` | `inspection-sync-poc`: `check`, `test:legacy`, `test`, `test:sqlite`, `test:ar01` | check OK; legacy 48/48; test 270 pass, 41 skipped (PostgreSQL, NOT_RUN), **1 FAIL environmental**; sqlite and ar01 pass |
| `gradle-core.log` | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS: 38 tests, 0 failures |
| — | `npm run build`, `npm run check`, `npm test` (mobile) | PASS; 188/188 |

The one sync failure is `avd-setup-script.test.mjs` ("the endpoint reaches the app only through stdin…"). The fake `adb.cmd` cannot resolve a temp path under a non-ASCII Windows profile (`C:\Users\<Korean name>\AppData\Local\Temp`). With `TEMP`/`TMP` set to an ASCII directory, the same file passes 4/4. It does not touch the mobile UI.

NOT_RUN: `test:browser:webxr:render` and `test:browser:vision:render` (both require an isolated PostgreSQL via `PG_TEST_URL`; their CI jobs provide one), real smartphone camera, iOS Safari, screen reader, Android/AVD reception, real AI provider, deployed HTTPS.

## Screenshots (`react/`)

Each name has a viewport image (what a 390×844 user sees first, unless noted) and a `-full` image made by growing the viewport, not Playwright fullPage stitching, so fixed and sticky bars sit where a user sees them.

| File | Shows |
| --- | --- |
| `after-catalog` | 차보담 catalog: grouped list of 17 tasks with location, method and honest AI tags |
| `after-intro` | Washer intro: safety block first, disabled CTA with its reason |
| `after-camera`, `p20-camera-marked` | Live synthetic camera, "색 후보 · 미검증" below the box, user mark "내가 지정한 위치", status "직접 표시 1곳 · 자동 인식 결과가 아니에요" |
| `after-observation-320`, `-768` | Observation at 320px and on a tablet |
| `after-review`, `after-completed` | Review with per-item 수정; local completion (no send) |
| `after-ai-result` | MOCK provenance, "참고 정보", headline → observations → acknowledgement |
| `after-server-receipt`, `after-vehicle-receipt`, `after-network-error` | Delivery: server receipt with the vehicle step still waiting; vehicle receipt; send error with same-record retry |
| `p20-intro-text130/200`, `p20-locate-text130/200`, `p20-done-320-text130/200` | Large text: no truncation; the CTA is inline at 200%, and the task bar scrolls with its title on its own row |
| `p20-intro-768`, `p20-catalog-768` | Tablet |

The screenshots were reviewed visually during development. Four issues were found and fixed before the final run:

1. The candidate label overlapped the user's marker label.
2. The bottom CTA alternated between fixed and inline at 200% text.
3. At 320px with 200% text, the sticky task bar split "브레이크액" inside the word and took a quarter of the screen.
4. The skip link showed at the top of the page at 200% text.
