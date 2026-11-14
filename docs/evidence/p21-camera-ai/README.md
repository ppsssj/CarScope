# P21 evidence index

Fresh local run on 2026-11-14 in the `CarScope-p21` worktree (branch `feat/p21-camera-ai-inspection-flow`, base `797c466`). Windows 10, Node 22.16.0, Edge 157 headless (Playwright 1.56.1). Camera input is a synthetic canvas stream, detection is a fixture provider, and analysis is the MOCK vision provider over the real local QR v2 relay. No Roboflow, OpenAI, phone, AVD or Render was used.

Raw artifacts are outside Git at `C:\CarScope-External\p21-camera-ai\`.

| Folder / file | Command | Result |
|---|---|---|
| `camera-ai/camera-ai-browser-report.json` + `p21-*.png` | `npm run test:browser:camera-ai` | PASS 15/15, 0 console errors, axe 0 (candidates, manual region, result) |
| `react/` | `npm run test:browser:react` (existing suite + P21 suite) | PASS 23/23 + 15/15 |
| `hosting/`, `webxr/` | `test:browser:hosting`, `test:browser:webxr` | PASS |
| `logs/mobile.log` | `check`, `build`, `npm test` | PASS (unit 201/201 after adding `vision-host-page.test.mjs`) |
| `logs/sync.log` | inspection-sync `check`, `test:https-e2e`, `npm test`, `test:legacy` (ASCII `TEMP`) | PASS; 3/3, 271 pass + 41 PostgreSQL skipped (NOT_RUN), 48/48 |
| `logs/gradle-core.log` | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS |

NOT_RUN: `vision-render-browser.mjs` and the PostgreSQL budget suites (need `PG_TEST_URL`; their CI jobs run them), real smartphone camera, real Roboflow, real OpenAI, Vision Render deployment.

| Screenshot | Shows |
|---|---|
| `p21-01-ready` | Camera live, the two consents, `AI로 부품 찾기` |
| `p21-02-candidates` | Two fixture candidates on the still, selected one highlighted, "AI 탐지 후보 · 확정되지 않음" |
| `p21-03-result` | Result first: provenance, 참고 정보, suspected issue with evidence, observations, limits |
| `p21-04-manual-region` | Dragged region over the part, `이 영역이 맞아요` / `다시 선택` |
| `p21-05-analyzing` | Crop that was sent, loading CTA, `분석 취소` |
| `p21-06-budget` | 429 budget message, no retry, manual inspection offered |
| `p21-07-result-320-text200` | 320px at 200% text, no overflow, inline CTA |
