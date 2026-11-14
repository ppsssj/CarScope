# P20 차보담 mobile web: the P19 design language on the real product

Status: implemented on `feat/p20-chabodam-mobile-ui`, based on the P19 lab commit `0604122`. The user accepted the P19 design, so this task does not explore new designs. It applies that language to every mobile screen and keeps the existing, tested product logic.

## 1. What was reused, and what was not

| From P19 | Use in the product |
| --- | --- |
| Tokens: neutral ladder, action `#1c5fd4` (5.77:1), rem type ladder 24/18/17/15/13, 20px gutter | Moved to `src/design/tokens.css`. The product and the lab both read this one file; the lab keeps its `--tl-*` names as aliases, so there is no second copy of the values. |
| Top bar (back, title, `n/4`), thin progress bar, eyebrow → title → one line | `ui/kit.tsx` `TaskBar`, `Heading` on every inspection step |
| Dark rounded viewfinder, corner guides, in-picture chips, status line under the picture | `Camera.tsx` `CameraView`, now fed by the real `CameraSession` |
| ListRow-like rows, quiet/caution blocks instead of repeated cards | `Rows`, `Section`, catalog list |
| Fixed bottom CTA, one fill primary + at most one ghost secondary, 56px, wrapping labels | `Dock`, with the P19 open issue fixed (§3) |
| MOCK reducer, `MockScene`, fake permission timer, hash-jump states | **Not used.** They stay in `src/toss-lab/` only. The product uses `flowFor` (self-inspection / checklist-flow), `CameraSession`, the detector, the marker helpers, `MobileSync`/`SyncClient`, and the `PhotoAnalysis` pipeline unchanged. |

No TDS package, Toss font, logo, icon or brand blue was added. React 19 + Astryx 0.7.15 remain; only small presentation components were written.

## 2. Screens

`App.tsx` (868 lines with every step inline) is now a shell that owns the reducer, the session subscription and the exit dialog. Screens live in `src/screens/`, presentation primitives in `src/ui/kit.tsx`. No domain state or DTO was added or changed.

- **Catalog**: all 17 tasks, grouped by area (보닛 내부 6 · 타이어 4 · 시야·조명 6 · 충전 1) with filter toggles. Each row shows the name, the location (`guide.area`) and the method ("눈으로 살펴보기 · 질문 3개"). The "AI 사진 보조 · 실험" tag appears only on the six parts whose photo method is `EXPERIMENTAL` in `part-capabilities` (washer, brake fluid, coolant, low-conductivity coolant, 12V, fuse box). DRAFT exterior profiles are offered by no default host, so they are not advertised. A note says the AI works only through a vehicle QR and is reference information.
- **Intro / safety**: the safety block (task points, help text, the existing acknowledgement checkboxes including "not charging") comes directly under the title, then the limitation and the part picture. The CTA stays visible and says why it is disabled. No safety text was removed.
- **Locate (real camera)**: the camera starts only on "카메라 켜기". Titles and the CTA follow the session's real state: idle, requesting (loading CTA), live, user mark, denied (positive copy, numbered re-enable steps, retry), unsupported, and other failures (`cameraError` text). "카메라 없이 계속하기" stays enabled while the permission prompt is open, as the product required before. A late stream is discarded by the session. Colour candidates are labelled "색 후보 · 미검증" and are drawn below their box, so they never cover the user's "내가 지정한 위치" marker. The status line says "직접 표시 1곳 · 자동 인식 결과가 아니에요". The live region announces only user or permission events. The candidate count is a quiet caption.
- **Photo AI**: the same validation, crop, consents, abort/generation guard and `validateAnalysisResult`. The result is reordered: provenance (`로컬 시험용 MOCK` or the service) and "참고 정보", then the headline, "먼저 살펴볼 점" (each with its 근거), "사진에서 보인 것", "이 결과의 한계" and "다시 찍는다면". Every line is a field of the validated response. It still never fills or confirms the checklist.
- **Observation, review, completion**: exclusive answer buttons, review with per-item 수정, explicit "직접 확인한 결과로 확정". The hint says confirming does not send.
- **Delivery**: four separate facts. 점검 확정 → 서버로 보내기 → 서버 접수 → 차량 앱 수신, each `done/active/waiting/error`. A server receipt leaves the vehicle step "active", never "done". A network failure marks the send step "error" and offers "같은 결과 다시 보내기". The `data-sync-state` status line, the double-submit guard, idempotent retry, cancel and expiry come from the unchanged `MobileSync`.

## 3. Large text and small screens

The fixed CTA measures the height it would have when fixed. If that is more than 30% of the viewport, it joins the page flow at the end of the content. Deciding on the fixed height prevents the two layouts from flipping back and forth; the first run showed exactly that oscillation, and the cause was fixed. While it is fixed, the footer reserves its height, so nothing can sit behind it. The sticky task bar uses the same rule at 12%: with large text it scrolls with the page and the title gets its own row, so a part name is never split inside a word. The skip link is hidden by a transform, so it no longer shows at 200% text.

## 4. Brand

The user-visible name is 차보담 (title, wordmark, footer with the brand line, boot/error screens, info page). The mark is a plain CarScope-drawn lens glyph, not a third-party logo. Two brand mentions in the shared guide data (`part-guides.mjs`: picture source, battery note) became brand-neutral. Package names, API paths, headers (`X-CarScope-*`), QR contract, server logs and the repository keep the CarScope name for compatibility.

## 5. Verification (fresh local run, 2026-11-14)

Environment: Windows 10, Node 22.16.0, Edge 157 headless via Playwright 1.56.1. Evidence: [index](evidence/p20-chabodam-mobile-ui/README.md).

| Gate | Result | Scope / command |
| --- | --- | --- |
| TypeScript / Vite | PASS | `npm run build`, `npm run check` |
| Mobile unit / contracts | PASS 188/188 | `npm test` (includes P19 isolation; the source check now scans every product file) |
| React browser E2E | PASS 23/23, 0 runtime errors, 0 axe violations in 14 scanned states | `npm run test:browser:react`: 17 tasks, QR v1/v2, invalid QR, camera grant/denied/unsupported/pending, exit stops camera, MOCK detection/analysis on all six bonnet profiles, malformed AI rejected, completion ≠ send, server vs vehicle receipt, offline retry, lost response, cancel, expiry; **new**: brand, honest AI tags, 130%/200% text at 390 and 320, one primary per screen, keyboard-only journey, keyboard camera marking, 768 tablet |
| Hosting browser | PASS | `npm run test:browser:hosting`: Vite dev and copied static staging with the deployed CSP |
| P19 lab | PASS (model 6/6, browser all states) | `test:toss-lab:model`, `test:browser:toss-lab` after the token move |
| WebXR QR browser | PASS | `npm run test:browser:webxr` (product selectors updated) |
| Sync service, Kotlin core | see evidence index | `inspection-sync-poc`: check, legacy, test, sqlite, ar01; `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| WebXR render, Vision render | NOT_RUN locally | Both require an isolated PostgreSQL (`PG_TEST_URL`); they run in their CI jobs |
| Real phone camera, iOS Safari, screen reader, AVD/real vehicle reception, real AI provider | NOT_RUN | Only local emulation with a synthetic camera stream and MOCK AI |

Test changes: selectors moved to the new `cb-*` hooks, and copy moved to 해요체 ("부품을 화면 가운데에 맞춰 주세요.", "가운데에 표시", "색 후보 1곳", "이 브라우저에서는 카메라를 쓸 수 없어요."). With the camera off, the AI flow continues with "카메라 없이 계속하기", because the P19 layout shows "위치 확인 후 관찰하기" only on a live picture. Every original assertion was kept; none was removed or loosened.

## 6. Known limits

- The viewfinder is 6:5 (4:3 on tablets) with `object-fit: contain`, which the coordinate helpers assume. A real phone's portrait stream will letterbox. Real-device framing is unverified.
- With the camera on, moving from 위치 찾기 to 관찰 restarts the camera, as before. The observation screen offers its own "카메라 켜기".
- The CTA (30%) and task-bar (12%) thresholds are local design choices tested in emulation. A real-device check at OS text sizes is still needed.
