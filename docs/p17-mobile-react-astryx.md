# P17 React / Astryx mobile inspection

## Reference lock (before UI implementation)

Human Approval: `SKIPPED_BY_EXPLICIT_USER_INSTRUCTION` — the request explicitly delegates design selection and says to implement without additional approval.

Inspected on 2026-11-13:

| Reference | Observed evidence | Use |
| --- | --- | --- |
| [Astryx official showcase](https://astryx.atmeta.com/) | Product cards group image, title and one action; checkout separates fields and explicit choices; inventory is a dense alternative | ADAPT image-led cards to part selection; avoid dense tables during inspection |
| [Official core guide](https://github.com/meta/astryx/blob/main/packages/core/README.md) | React 19, prebuilt CSS, theme provider, local Vite integration | PRESERVE component/theme integration; no CDN |
| Installed CLI 0.7.15 `template form-wizard --skeleton` | One panel at a time, horizontal progress, validated advances | ADAPT to existing reducers and explicit user confirmation |
| Installed CLI `component Button`, `component CheckboxInput`, `component Badge`, `docs use-a-theme` | One primary action, explicit consent, badges reserved for meaningful status; neutral built theme with light/dark support | PRESERVE these semantics |
| [Official Storybook](https://astryx.atmeta.com/storybook/) | Web retrieval returned no readable content; interactive browser host unavailable | No visual claims based on Storybook; installed component docs are API authority |

The official gallery, form wizard and theme documentation are the useful product references here. Compared: (A) dark instrument console, (B) dense maintenance dashboard, (C) light inspection notebook. Select C: outdoor reading, long Korean safety instructions and photo inspection benefit from clear paper-like surfaces and a single task. A gives too much apparent diagnostic authority; B distracts from the current observation.

### Element and major visual decision map

| Decision | Treatment | Provenance / disposition |
| --- | --- | --- |
| Background, surfaces | Light neutral canvas, white reading surfaces, thin boundaries | Astryx neutral / ADAPT for daylight reading |
| Text and type | System Korean sans, large task heading, quiet metadata | ACCESSIBILITY / ADAPT no remote font dependency |
| Accent | Deep teal for actions, amber for caution; labels accompany colors | PRODUCT REQUIREMENT + ACCESSIBILITY / ADAPT neutral theme tokens |
| Entry | Part gallery with existing explanatory schematic, category filters | Official product gallery / ADAPT for 17 tasks |
| Navigation | Header, horizontal four-step progress, one current panel | Official form-wizard / PRESERVE full-width linear focus |
| Images | Existing licensed schematic assets; applicability caption | EXISTING SYSTEM / PRESERVE; no geometry changes |
| Observation | One question with three large explicit answer choices | Existing checklist contract + wizard / ADAPT |
| AI | Optional separate photo workspace, consent per request, distinct result panel | PRODUCT REQUIREMENT / INVENT: reference checkout alone does not distinguish experimental AI evidence from human observation |
| Delivery | Local completion → server receipt → vehicle receipt timeline | PRODUCT REQUIREMENT / INVENT: three separate facts cannot collapse into one success badge |
| Responsive layout | Single column on phone; supporting guide beside task on tablet | ACCESSIBILITY / ADAPT wizard full-width fields |
| Motion | Brief panel entrance, disabled under reduced motion | ACCESSIBILITY / ADAPT avoid disorientation |

Synthesis: an image-led inspection notebook. The part and immediate next action dominate; safety instructions stay beside the action they constrain. AI never answers the human checklist. Completed records are immutable and sending remains a separate explicit action.

## Contract inventory

The existing pure modules are authoritative: `inspection-tasks`, `self-inspection`, `checklist-profiles`, `checklist-flow`, result factories, `part-guides`, `part-detection`, `part-analysis`, `context-crop`, `takeMobileHandoff`, `MobileSync`, `SyncClient`. The legacy DOM renderers are not the React state owner.

- Implemented: washer, four tires, EV charge port, brake fluid, ordinary/low-conductivity coolant, 12V battery, fuse box, two wipers, four headlamps (17 tasks). All user reports, never SDK observations.
- Experimental: mapped bonnet detection (four classes); six bonnet analysis profiles. Exterior analysis is DRAFT and host approval remains required. No accuracy or vehicle diagnosis claim.
- Unsupported: detector classes for 12V, low-conductivity coolant and exterior parts; hidden measurements, fluid quality, braking, charging/high-voltage diagnosis.
- QR v1/local task remains local. QR v2 is consumed and erased before rendering; credentials remain private in existing clients. Google account authentication is separate.
- Existing schema-v1 washer and schema-v2 checklist records, safety gates, confirmation, idempotency, receipt digest and task checks remain authoritative.

## Execution evidence

See the [P17 evidence index](evidence/p17-react-astryx/README.md). Raw screenshots/logs stay outside Git. No production deploy, database mutation, real provider call or real vehicle API activation is part of this work.

## Implementation

Pinned versions: React / React DOM **19.3.1**, Astryx core / neutral theme / CLI **0.7.15**, StyleX **0.19.2**, TypeScript **7.0.2**, Vite **8.3.8**. These are the actual registry versions installed during this task. Astryx is beta; the installed CLI/component declarations, not guessed APIs, were used.

`src/main.tsx` mounts a React error boundary and Astryx's built neutral `Theme` in light mode. `App` owns the catalog, safety, location, observation, review, completion and delivery UI. `InfoApp` owns the existing read-only `/part-info.html#<partId>` route, which cannot claim a QR or create results. `Guide` owns drawings, enlargement and manual/safety references. `Camera` uses the existing `CameraSession`, color-candidate detector and 2D coordinate/marker helpers. Canvas drawing never replaces React DOM.

`domain.ts` gives the existing JavaScript reducers a typed boundary. No new result schema or duplicate domain state machine was introduced. `session.ts` consumes v2 credentials once, before rendering, and holds only the existing private `MobileSync` transport; React receives status-only snapshots. Completed results remain local immutable records until an explicit send. Google account auth is not imported or used as QR authorization.

`PhotoAnalysis` is a lazy React workspace. It validates file type and 15MB input bounds, decodes orientation, re-encodes without source metadata, offers only host-approved capabilities, validates detector boxes, crops the original with the existing context algorithm, obtains a separate analysis consent, and validates the response with `validateAnalysisResult`. A generation counter and abort signal reject stale answers. New photos and retries clear consent. AI findings never populate checklist responses or send a result.

Astryx `Button`, `CheckboxInput`, `Badge`, and `Theme` are used throughout the actual task flow. Plain semantic HTML and CSS supply product layout, exclusive observation choices, progress, and receipt timeline. No second component system, runtime CSS-in-JS engine, remote font or external CDN was added. Local CSS extends neutral with deep teal action tokens, readable Korean system typography, explicit caution panels and reduced-motion support. Direct component imports and a lazy photo workspace keep experiments outside the initial photo feature chunk; the main bundle and Astryx CSS remain sizable (see evidence), so real-device performance remains a release check.

## Build and serving

From `tools/mobile-ar-poc`:

```powershell
npm ci --ignore-scripts
npm run build
npm run serve
# Or Vite with HMR, bound to loopback (local-only, not the QR/API host):
npm run dev
```

Vite writes `build/react`, including `.vite/manifest.json`. Existing Node mobile, QR sync development and HTTPS services read the same built HTML. The QR service adds a server-controlled sync marker; only explicitly configured experiment hosts add AI flags. `react-build.mjs` serves **exact manifest entries**, including dynamic imports, with strict MIME types. No request path is joined to an unrestricted directory. Existing CSP, origin checks and authentication stay in place. Source maps and the manifest are not public endpoints. The host readiness probe uses HEAD for a built JS entry to avoid downloading large executable code into its bounded text probe.

The existing `npm run build:staging` first builds Vite, then copies the same React HTML, all manifest chunks, original allowlisted illustrations, local read-only entry, QR and build metadata. `vercel.json` keeps existing headers. No deploy was executed. Services must build before starting; a source-only checkout is no longer a deployable mobile frontend.

For a future service build (operator action, not performed here): install mobile build dependencies, run `npm run build --prefix tools/mobile-ar-poc`, then optionally `npm prune --prefix tools/mobile-ar-poc --omit=dev --ignore-scripts`. Keep `build/react` together with the runtime source. The production service environment must not rely on a frontend CDN.

Historical experimental renderers remain in **separate documents**: `/webxr-guide.html` only with the WebXR host flag, and `/vision-lab.html` only with an AI provider. They are regression/lab surfaces, not React's main renderer. The React WebXR link opens a separate local-only tab and does not forward a QR credential. Direct QR lab regression remains covered separately. Default hosts deny lab paths and experiment modules. Android's static SVG and debug/release asset boundary are unchanged.

## UX differences and regression mapping

| Before | New product behavior | Evidence |
| --- | --- | --- |
| Washer-first page with other tasks in a disclosure | Category-filtered, image-led 17-task catalog; QR goes straight to its locked task | React browser catalog + all-task loop |
| Long DOM-managed screens | Reducer-controlled current panel, clear four-stage progress and one main action | Full local journeys and review edit |
| Camera start coupled to initial action | Camera method selection, then an explicit permission action; denial/unsupported manual recovery | Four synthetic camera scenarios |
| Small guide illustration | Responsive guide, keyboard/Escape accessible zoom, applicability and manual references | Info-guide and accessibility checks |
| Experiment dialog coupled to legacy UI | Lazy optional React photo workspace; source-labelled AI findings and separate human answers | MOCK relay E2E, invalid response rejection |
| Completion and send UI assembled by legacy DOM code | Independent human completion, server receipt and exact vehicle receipt timeline | Real local HTTP, offline/lost ACK/retry, receiver acceptance |

`npm test` retains the original pure-domain tests. New `react-build.test.mjs` checks manifest/MIME/CSP/allowlist and staging contracts. `npm run test:browser` (also `test:browser:react`) is the new browser regression entry; `tools/inspection-sync-poc`'s `test:mobile-browser` points to the same integrated React suite. Old DOM-only scripts remain explicitly historical (`test:browser:legacy`, `test:mobile-browser:legacy`) and do not validate the React product. Their functional intent is covered by the new flow tests and unchanged reducer/client tests; the separate WebXR and Vision lab suites still run their original detailed experiment assertions against explicit lab routes. No domain/security tests were removed.

The existing feature-specific browser command names now run the unified React suite; their original implementations are retained under corresponding `:legacy` names. `test:browser:hosting` verifies Vite/HMR and the actual copied staging directory with the deployed CSP over loopback. The inspection-sync CI builds the mobile bundle before server surface tests and runs the React and hosting browser checks on Windows. WebXR/Vision CI also builds the frontend before hosting it.

## Fresh local verification

| Gate | Result | Scope / command |
| --- | --- | --- |
| Clean dependency install | PASS | `npm ci --ignore-scripts --no-audit --no-fund` in mobile |
| TypeScript / Vite | PASS | `npm run build`; locally bundled CSS/JS, no CDN |
| Mobile checks | PASS | `npm run check`; TS plus existing module syntax |
| Mobile unit / contracts | PASS | `npm test`: 185 passed, 0 failed |
| Sync checks | PASS | `npm run check` in inspection-sync |
| Sync unit / HTTP / SQLite / TLS | PASS within executed scope | `npm test`: 271 passed, 0 failed; 41 PostgreSQL-dependent tests skipped / NOT_RUN |
| Kotlin core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 38 tests, 0 failures |
| React Edge E2E | PASS | `npm run test:browser:react`: 17 local task journeys, QR, camera, all six bonnet MOCK AI profiles, failure/retry and receipts; see JSON for individual checks |
| Automated accessibility | PASS within tested states | axe WCAG 2 A/AA and 2.1 AA tags; catalog, read-only guide, review, completion, 320/768 observation, AI, vehicle receipt; not a full accessibility certification |
| Hosting browser | PASS | `npm run test:browser:hosting`: actual Vite dev and copied static staging, complete local flow, local drawings, no runtime/CSP errors |
| Historical WebXR | PASS | `test/webxr-browser.mjs` and `test/webxr-qr-browser.mjs`, retargeted to isolated lab; synthetic XR only |
| Browser visual inspection | PASS within local scope | 390×844 before/after, 320px phone and 768px tablet; refined Korean wrapping and collapsed completed-task guide |
| Geometry/Anatomy audit | NOT_RUN / not applicable | No generated geometry, Anatomy source, SVG artwork or GLB changed |
| Real phone / actual AI / Android runtime / deployed HTTPS | NOT_RUN | No LIVE claim; no deployments or production database writes |
| GitHub CI | Reported on PR | Local results above are separate from remote job conclusions |

The first remote run exposed a missing frontend build prerequisite in PostgreSQL ingress CI (500 instead of HTML). The PostgreSQL and geometry jobs now build the actual mobile artifact before HTTP assertions; assertions were retained. Remote PostgreSQL-backed MOCK Vision already passed that first run. Final conclusions are tracked against the latest PR SHA, not inherited from an older run.

The Vite build emits benign `use client` bundler warnings from Astryx/StyleX dependencies in this client-only app. Browser checks show no React/runtime/CSP console errors. Measured build sizes: initial entry about 497 kB (160 kB gzip), shared Astryx chunk 123 kB (39 kB gzip), CSS 320 kB (51 kB gzip), lazy photo workspace 37 kB (14 kB gzip). These are artifact sizes, not smartphone performance measurements.

## Release limits

Local browser screenshots and automated WCAG checks are evidence of the tested Edge/Chromium environment only. Real smartphone camera behavior, iOS/Safari, screen-reader usability, outdoor legibility, real AI accuracy, paid calls, Android/AVD runtime reception, deployed HTTPS and physical QR scanning remain unverified. PostgreSQL integration requires its existing isolated test database and is reported separately from local HTTP/memory/SQLite evidence. The frontend is implemented and reviewable; these remaining checks prevent a claim of production or LIVE validation.
