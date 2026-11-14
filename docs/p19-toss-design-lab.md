# P19 Toss-principles design lab: one camera inspection screen

Status: **awaiting user review**. This is an isolated design experiment. It does not replace the product UI. It is not merged and is not part of the product build or staging.

Context: the three P18 concepts (SCOPE, ATLAS, LOGBOOK) were not adopted after user review. They live only on the unmerged `feat/p18-mobile-design-exploration` branch. This branch starts from `main` (`54a101c`) and neither contains nor changes them.

## 1. Source assessment

Reference: [oh-my-design `references/toss/DESIGN.md`](https://github.com/kwakseongjae/oh-my-design/blob/main/web/references/toss/DESIGN.md). It is a third-party compilation, not an official Toss document. It was read in full on 2026-11-14 (≈28 KB). Its own verification dates run from 2026-07-11 to 2026-10-20. Each claim below was checked against official pages on 2026-11-14.

| Claim in DESIGN.md | Official source | Result |
| --- | --- | --- |
| Grey/blue/red/green/orange/yellow 50–900 hex values | [TDS Colors](https://tossmini-docs.toss.im/tds-mobile/foundation/colors/) | VERIFIED. The official page also has greyOpacity tokens, which DESIGN.md omits, and semantic `background`, `greyBackground`, `layeredBackground` and `floatedBackground` tokens. No dark-mode tokens were found. |
| Type tokens t1–t7 (30/40 … 13/19.5) and st1–st13 | [TDS Typography](https://tossmini-docs.toss.im/tds-mobile/foundation/typography/) | VERIFIED. Weights are named Light to Bold, with no numbers. The page advises against hard-coding sizes, because text follows the OS "larger text" setting. |
| Button `size` small–xlarge, `variant` fill/weak, `color` primary/danger/light/dark, loading keeps the width, disabled | [TDS Button](https://tossmini-docs.toss.im/tds-mobile/components/button/) | VERIFIED. fill marks the primary action and weak marks secondary actions. Icon-only and loading-without-text buttons need `aria-label`. |
| Button pixel heights (32/38/48/56), radii (8/10/14/16), pressed `scale(0.96)`, focus ring values | Not in the documentation text | DESIGN.md says itself that these come from a computed-style capture. NOT treated as rules. |
| Badge is for status only: fill/weak, four sizes | [TDS Badge](https://tossmini-docs.toss.im/tds-mobile/components/badge/) | VERIFIED |
| Spacing 4/6/8/16/24/32, radii 4/6 | None | Not TDS tokens (DESIGN.md says so). NOT used as rules. |
| Shadow, duration and easing tokens | None | DESIGN.md says none are published. CONFIRMED absent. |
| ListRow left/contents/right; vertical padding 8/12/16/24; horizontal padding 20/24 | [ListRow](https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/) | VERIFIED (DESIGN.md lacks these) |
| BottomCTA single or double | [BottomCTA](https://tossmini-docs.toss.im/tds-mobile/components/BottomCTA/check-first/) | VERIFIED |
| Toast: action feedback, 3000 ms (5000 ms with a button), `aria-live` polite | [Toast](https://tossmini-docs.toss.im/tds-mobile/components/toast/) | VERIFIED |
| Writing: 해요체, active voice, positive phrasing, 닫기 rather than 취소, a predictable CTA, no loading animation without a wait, no exclamation icon for non-errors | [Consumer UX guide](https://developers-apps-in-toss.toss.im/design/consumer-ux-guide.md) | VERIFIED. The guide also lists dark patterns: an entry bottom sheet, blocking the back button, and a forced partner CTA. |
| "Easy to answer", "Value first, cost later", personas, brand narrative | No link | UNSOURCED. Not used. |
| White on `#3182f6` = 3.71:1 | Computed again locally | VERIFIED. This is below WCAG AA 4.5:1 for 17px text. |
| UI Kit licence: use only inside Apps-in-Toss; assets, logos and visuals belong to Viva Republica | [Figma UI licence](https://developers-apps-in-toss.toss.im/design/prepare/figma-ui-license.md) | VERIFIED. This is why no kit, font, icon, logo or brand blue is copied here. |

Pages not read: Progress Stepper, Loader, Skeleton, and toss.tech writing articles. No claim relies on them.

## 2. Principles extracted for CarScope mobile web

These are principles only. CarScope keeps React 19, Astryx 0.7.15, its own tokens and system fonts.

- **Information hierarchy**: one question per screen. The screen leads with a short step label, then a title saying what to do now, then one supporting sentence. The task object (the camera picture) comes next. Checks and safety notes follow, and the action sits at the bottom. Data source labels ("모의 데이터", "색 후보 · 미검증", "직접 표시") stay next to the thing they qualify.
- **Typography**: a size ladder based on the TDS step structure, in **rem** so the user's text-size setting scales everything: title 24/33, section 18/27, body 17/25.5, secondary 15/22.5, caption 13/19.5. Weights 700/600/400 only. Korean uses `word-break: keep-all`. CarScope uses the system Korean font stack and no Toss Product Sans.
- **Spacing**: a 20px side gutter (ListRow small horizontal padding). Rows are 12px apart vertically (ListRow medium). Blocks have 24–32px rhythm. Surfaces are flat with no shadows, because TDS publishes no elevation token. Surfaces use 12–20px radii (a CarScope choice, not a TDS token).
- **Component states**: exactly one fill primary per state, plus at most one weak/ghost secondary. Loading keeps the button full width and fully colored. Only a truly disabled control is dimmed. Badges describe status and are not interactive. Every touch target is at least 44px. CTAs are 56px tall and wrap instead of truncating at large text sizes.
- **Interaction**: a fixed bottom CTA whose label predicts the next step. Toasts confirm actions, are polite and dismiss after 3 s. The camera starts only on an explicit tap. Permission denial is phrased positively and points to the manual path. No loading animation appears in the picture while CarScope waits on the user. Press feedback is a light `scale(0.98)`, which is a local extension, not a TDS value. All motion is disabled under `prefers-reduced-motion`.
- **Accessibility over brand**: CarScope does not use Toss blue (3.71:1). The action color is CarScope `#1c5fd4`, with 5.77:1 for white text. Muted text is never lighter than `#636e7a` (≥4.67:1 on the surfaces used).

## 3. Experiment: washer cap camera step ("위치 찾기")

There is exactly one screen, with six MOCK states that can be reached by interaction or by URL hash: `#idle`, `#requesting`, `#live`, `#marked`, `#denied` and `#unsupported`.

- `src/toss-lab/model.ts` is a pure reducer and holds all copy and MOCK data. The guide copy mirrors the existing washer `part-guides` content. It has no imports.
- `src/toss-lab/CameraLab.tsx` contains the screen. It uses Astryx `Theme`, `Button` (primary/ghost, `isLoading`, `isDisabled`) and `Badge`, plus semantic HTML. The tap surface and the overlay controls are siblings, so no interactive element is nested inside another.
- `src/toss-lab/MockScene.tsx` is a generic hand-drawn SVG labelled "모의 화면". It is not a photo, not a specific vehicle and not derived from the Anatomy/GLB geometry. The "색 후보 · 미검증" box is a fixed MOCK rectangle, not detector output.
- `toss-lab.html`, `vite.toss-lab.config.ts` and `build/toss-lab` (git-ignored) form a separate entry and output.
- `toss-lab-server.mjs` is loopback only and refuses `NODE_ENV=production`, `RENDER` and `VERCEL`. It enforces the Host/Origin check, GET/HEAD only and no query strings. It serves manifest entries only. It applies the existing mobile CSP plus `Permissions-Policy: camera=()`.

Unchanged: `CameraSession`, the detector, the marker helpers, QR/handoff, AI photo analysis, sync/transmission, product `App`/`Camera`, `vite.config.ts`, staging, Android and Anatomy/SVG/GLB. The lab never calls `getUserMedia`, and the browser test enforces this.

```powershell
cd tools/mobile-ar-poc
npm ci --ignore-scripts
npm run build:toss-lab
npm run serve:toss-lab        # http://127.0.0.1:4189/toss-lab/#live
```

## 4. Verification (fresh local run, 2026-11-14)

Environment: Windows 10, Node 22.16.0, Edge 157.0.4341.46 (Playwright 1.56.1, headless).

| Gate | Result | Command / scope |
| --- | --- | --- |
| Lab typecheck + build | PASS | `npm run build:toss-lab` (tsc + Vite). Shows only the existing `use client` bundler warnings. |
| Lab model | PASS 6/6 | `npm run test:toss-lab:model`: permission flow, marker only on a live picture and inside bounds, allow-listed hash, one primary per state, 해요체 copy, MOCK labelling |
| Lab browser | PASS 10/10 | `npm run test:browser:toss-lab`: all 6 states at 390×844; axe WCAG 2 A/AA + 2.1 AA; one primary; CTA ≥56px; targets ≥44px; computed action color; no off-origin requests, runtime errors or `getUserMedia` calls; tap/keyboard marking; toast; 320px; 130% and 200% text with no horizontal overflow and no truncated CTA |
| Product isolation | PASS 3/3 | `test/toss-lab-isolation.test.mjs` (in `npm test`): product bundle contains no lab marker; mobile and sync hosts return 404 for lab paths; copied staging excludes the lab; no product source imports it |
| Mobile check / unit | PASS | `npm run check`; `npm test`: 188 passed, 0 failed (185 existing + 3 isolation) |
| Product React E2E | PASS | `npm run test:browser:react` with `POC_EVIDENCE_DIR` external: shows existing product flows are unchanged |
| Kotlin core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 38 tests, 0 failures |
| Geometry/Anatomy audit | NOT_RUN / not applicable | No geometry, Anatomy source, SVG artwork or GLB changed |
| Real phone, iOS Safari, screen reader, outdoor legibility | NOT_RUN | Only the local Edge emulation was used |
| GitHub CI | NOT_RUN | Nothing has been pushed, and no CI job was added for the lab |

Screenshots and report: see the [evidence index](evidence/p19-toss-design-lab/README.md).

## 5. Known limits and open review questions

- At 200% text, the fixed CTA takes about 35% of the viewport. Content stays reachable by scrolling, and no label is lost. A real-device check should decide whether to un-fix the CTA at large text sizes.
- The 6:5 viewfinder is a crop chosen so that the status line stays above the CTA on a 390×844 screen. The real camera aspect and the product's coordinate helpers (`containRect`, `tapToVideoPoint`) were not exercised.
- The lab's "실험 도구" state links are review tooling. They are not a proposed product element.
- Pending decision: whether to carry these principles into the product's camera step. That would be a separate, approved task.
- Follow-up: [P20](p20-chabodam-mobile-ui.md) applied this design language to the whole product as 차보담. The tokens now live in `src/design/tokens.css`, and this lab aliases them. The lab itself is unchanged and still excluded from the product build.
