# P18 — Three experiences for one inspection

Status: **prototype comparison; product adoption PENDING_USER_SELECTION**. The production React UI and QR/AI/camera/session/DTO contracts are unchanged. MIME hardening is the separate preceding commit `11da17a` ([technical note](p18-asset-hardening.md)).

## Run and compare

From `tools/mobile-ar-poc/` using Node 22.16 or newer:

```powershell
npm ci --ignore-scripts
npm run build
npm run build:design-lab
npm run serve:design-lab
```

Open the comparison entry at **http://127.0.0.1:4188/design-lab/**, or:

| Concept | Local URL | Experience |
| --- | --- | --- |
| A — SCOPE | http://127.0.0.1:4188/design-lab/scope | A field instrument: indexed subjects, a focused viewfinder, evidence readout, signal path |
| B — ATLAS | http://127.0.0.1:4188/design-lab/atlas | An object workspace: choose a zone, turn/reveal a part, separate visible and unknowable layers |
| C — LOGBOOK | http://127.0.0.1:4188/design-lab/logbook | An observation journal: plan several tasks, inspect one, annotate facts, close a dated receipt |

The server binds only to loopback and refuses production/Render/Vercel environments. The URLs are local previews, not deployed staging. Refresh resets the simulation. The A/B/C links restart each concept with the same washer-fluid task.

Try: select any of the 17 tasks → prepare → acknowledge safety → manipulate the simulated scene → capture or continue manually → consent to a mock analysis → choose finding/uncertain/failure → enter every observation yourself → confirm the report → start mock sending → advance server receipt → advance vehicle receipt. The two receipts never advance automatically. Network failure retries the same mock report. All controls, including the mock status advance buttons, are visibly labelled as simulation.

## Why three different designs

[Reference research and the decision map](p18-design-research.md) were written before the concept renderers. The research used official product screens and first-party explanations; it is not a hands-on review of installed native apps. The prototypes reinterpret interaction principles and ship none of the reference screenshots, logos or artwork.

SCOPE applies Halide's relationship between a dominant viewfinder and compact, contextual controls to a task requiring steady attention. It uses indexed subjects rather than a catalogue grid. AI evidence and human responses sit beside each other on a tablet, while delivery becomes a three-node signal path. Its amber cue consistently means an available action or selected tool, never a vehicle health score.

ATLAS takes the manipulable-object principle from Not Boring Weather. Selection changes one large original schematic. A zone selector, part dial, structural reveal and viewpoint range provide a spatial discovery model with a full text index as an alternative. The analysis screen switches between a visible surface and what the photograph cannot establish. No reveal is presented as an actual internal view or measured vehicle geometry.

LOGBOOK uses Things' grouped text hierarchy and Gentler Streak's contextual continuity. A separate plan toggle and current-task selector let users choose a small itinerary. Preparation shows that itinerary; the observation becomes a numbered note; AI is a provisional annotation, and transmission becomes a dated receipt. The history strip is explicitly mock context, with no invented genuine inspection history or safety score.

## Evaluation with evidence

These are design judgments from the rendered prototypes, not measured user-study outcomes.

| Criterion | SCOPE | ATLAS | LOGBOOK |
| --- | --- | --- | --- |
| Visual finish | Consistent instrument grid, quiet metadata and amber control vocabulary; the 390px shutter now fits within the first screen | Strongest single-object identity and layered analysis; long real-world position guidance still takes space below the object | Rules, serif Korean headings, ink schematics and margin annotations create an editorial whole; long task lists remain deliberately text-heavy |
| Product identity | A focused inspection tool rather than a generic dashboard; repeated rails could become dense as the catalogue grows | Most distinctive learning environment; original art must stay clearly schematic to avoid false location confidence | Care and continuity feel approachable; less immediately recognisable as a camera tool |
| Information structure | One subject → briefing → evidence → report → independent receipts | Zone → part → visible/unknown layers; full index prevents spatial navigation becoming a barrier | Region → plan → current task → report trail; selecting and adding are intentionally separate actions |
| Usability | Direct sequence, obvious shutter and clear recovery; horizontal subject rail requires discovery | Dial/ranges encourage exploration; some users may mistake exploration for required preparation | Familiar rows and an explicit plan summary; more scrolling before reaching a distant part |
| Camera work | Best fit: edge-to-edge scene, compact control bay, optional grid/marker, thumb shutter | Contextual object matching is useful for learning; circular framing gives less rectangular image area | Photography feels like a field note; explanatory text reduces camera immersion |
| AI uncertainty | Separate evidence/unknowns and human answers are easy to compare, especially on tablet | Strongest explanation of what an image cannot reveal; layer toggles must retain text equivalents | Annotation is visually subordinate to the user's report; long prose can delay the next action |
| React / Astryx | Real Theme, Button and CheckboxInput; shared mock reducer, scoped visual overrides | Same core/state contract, local-only object-control state; SVG avoids a WebGL dependency | Same core/state contract, explicit plan state; no browser storage pretending to be history |
| Accessibility | Text labels, 44px targets, visible focus, reduced motion, zero automated WCAG A/AA violations in tested states | Range controls and text index provide alternatives to spatial interaction; same automated result | Semantic groups/fieldsets and text rows; sticky plan header keeps its natural document position; same automated result |
| Performance / expansion | No external requests, video processing or animation loop in the lab; real camera performance remains untested | Original SVG instead of 3D runtime; substantial illustration maintenance cost for future parts | Primarily text and static SVG; future history requires pagination, provenance and actual data contracts |
| Integration effort | Lowest of the three: maps directly to existing camera, consent, result and transport phases | Highest: needs verified per-part visual guidance and user research on spatial discovery | Medium/high: single-task QR sessions must remain distinct from a multi-task plan and future account history |

**Recommendation: SCOPE** as the next product candidate. Camera inspection is the demanding part of the current supported journey, and its focused control model improves that work while mapping cleanly to existing contracts. ATLAS is a strong candidate for an optional educational part explorer. LOGBOOK merits a later history/planning project after genuine history provenance and multi-session behaviour are designed. This is a recommendation only; none is selected or installed as the main product UI.

## Applying a selected concept later

Do not connect the lab reducer to production credentials. It intentionally models only a comparison journey. A future implementation should reuse the existing production session reducer, camera hook, validated image/AI adapters and result builders. Its task-specific observation semantics (including washer-fluid's distinct flow), stop advice, extra safety conditions, consent, invalid session handling and transport retry/polling contracts must remain authoritative.

SCOPE would replace presentation around those states, with actual MediaStream cleanup on every exit and evidence/source semantics retained. ATLAS additionally needs validated visual assets and fallbacks for unknown vehicle models; its schematic reveal must never imply engineering verification. LOGBOOK needs an explicit boundary between local planning and an authenticated single-task QR session, plus real account/history permissions before saving any itinerary or record. The current mock choices are not new DTO values or an endorsement of new AI-supported parts.

## Architecture and isolation

`src/design-lab/main.tsx` is a separate Vite entry; `vite.design-lab.config.ts` emits only to `build/design-lab/`. The ordinary `vite.config.ts`, product entry, production server routes and static staging copier are unchanged. `design-lab-server.mjs` serves exact local routes and only its own manifest assets, rejects query strings, disables camera/microphone/geolocation and uses the existing CSP/nosniff headers. It has no proxy, API endpoint, credential loading, storage or real AI/camera path. Any fragment is discarded without interpretation before rendering.

`model.ts` reuses only the pure task catalogue and checklist copy for the 17 current tasks. `useLab.ts` owns the reducer and cleans up its simulated analysis timer. `Concepts.tsx` contains three independent screen compositions; `shared.tsx` holds safety, evidence, direct-report and simulated delivery controls so the comparison uses the same meanings. `PartObject.tsx` contains original interface schematics for eight part families. It does not modify Anatomy, vehicle world coordinates, SVG generation or GLB assets.

The prototype bundle is approximately 578KB JS / 184KB gzip and 328KB CSS / 52KB gzip (all three concepts together, Astryx included). Vite warns about its 500KB chunk threshold; no threshold was raised. This is a local comparison bundle, not a production performance result. Before adoption, measure a single chosen renderer on a real phone and split optional discovery code. Astryx's existing client-only directive warnings remain build warnings, with no observed browser runtime error.

Production exclusion is tested at three levels: the product manifest and JS contents, live mobile/sync HTTP 404 responses for all lab entry/source paths, and the copied staging directory. The lab server also rejects a production environment before opening a listener. No production deployment was made.

## Visual verification and iteration

Raw captures/logs are outside Git under `C:\CarScope-External\qr-ar-01\p18-design-exploration\` ([evidence index](evidence/p18-design-exploration/README.md)).

1. `lab-iteration-1`: direct screenshot inspection exposed black theme-reset headings on SCOPE. The automated contrast check failed. Explicit heading colors and the correct Astryx dark mode corrected it.
2. `lab-iteration-2`: contrast checking caught inherited light text on a light primary button. Scoped concept button treatments corrected the control contrast; the test was retained.
3. `lab-iteration-3`: inspected SCOPE camera, ATLAS explorer/evidence and LOGBOOK plan captures. The 320px ATLAS evidence surface overflowed by its desktop negative margin; adjusted the small-screen margin. Camera controls extended below the 844px screen; shortened the viewfinder/header in observation mode. LOGBOOK's sticky footer obscured catalogue rows in the full-page capture; moved its plan summary before the list with a top sticky position. Object/evidence captions received more separation.
4. `lab-final`: 54 captures across 390×844, 320×780 and 834×1112. Directly inspected the revised camera, 320px evidence, journal catalogue/receipt and tablet split evidence/receipt. All nine complete mock journeys passed, with no horizontal overflow, no sub-44px tested action targets and zero automated WCAG A/AA violations across 54 captured states. Automated results are not a manual screen-reader certification or real-camera test.

## Reproduce verification

```powershell
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p18-design-exploration'
npm run build
npm test
npm run build:design-lab
npm run test:browser:design-lab
npm run test:browser
npm run test:browser:hosting
npm run test:browser:assets
```

Lab tests cover all 17 selectors in each concept/viewport, safety gating, mock camera aids, permission rejection/manual recovery, AI failure then uncertain response, absence of AI-filled answers, direct confirmation, failed-send retry, server versus vehicle receipt, keyboard focus, forbidden requests and empty browser storage. Unit tests cover reducer guards and production isolation. The existing product browser suite continues to exercise actual local QR/sync HTTP with synthetic images/camera and MOCK AI. It is not a live provider pass.

Real smartphone, native reference-app interaction, real AI provider, Android/AVD runtime, real vehicle, operating DB and deployed HTTPS: **NOT_RUN**. Local JVM and CI jobs are reported only within their tested scope.

### Handover re-run (2026-11-13/14)

After the session handover, the uncommitted lab was rebuilt and re-tested without code changes, writing to a new external folder `claude-rerun/` so the original `lab-final/` stays intact. Node 22.16.0, Windows 10, Edge channel.

| Command | Result |
| --- | --- |
| `npm run build`, `npm run build:design-lab`, `npm run check` | PASS (existing 500KB chunk and Astryx directive warnings only) |
| `npm test` (includes `design-lab-isolation` and `design-lab-model`) | PASS, 192/192 |
| `npm run test:browser:design-lab` | PASS, 9 journeys, 54 captures |
| `npm run test:browser`, `:hosting`, `:assets` | PASS |

A first attempt with `POC_EVIDENCE_DIR` outside `C:\CarScope-External\` was rejected by the tests' own path guard (expected, not a defect). The JVM `vehicle-core` suite was not re-run in this pass; only the earlier `core.log` exists.

## CI coverage and status

CI has not run at the time these documents were committed; this branch had never been pushed. Results belong to the PR checks, not to this file. The relevant jobs and their scope:

- `Inspection sync infrastructure CI` (Ubuntu + Windows): sync contracts, SQLite, TLS, AR-01, mobile syntax; on Windows additionally the React product Edge E2E, Vite/static hosting, MIME asset decoding (`test:browser:assets`, from `11da17a`), the design-lab build and the three-concept browser journeys.
- `Vision mobile experiment CI` (Ubuntu): React product build and the full mobile `npm test`, which includes the design-lab production-exclusion and reducer tests.

A green CI run proves only the synthetic/local scope above. It is not a phone, AVD, provider or vehicle result.

## Comparison sheets for selection

For choosing a direction, the mobile (390×844) captures of the re-run are arranged side by side outside Git at `C:\CarScope-External\qr-ar-01\p18-design-exploration\comparison\`: `compare-overview.png` (first screen of each step, concepts as rows), `compare-0N-*.png` (one full-page sheet per step) and `screens/{scope,atlas,logbook}/`. They were composed from existing captures by `comparison/build-comparison.mjs`; no new UI states were produced.

Observed while composing them: the camera step shares the same control set (scene/grid/mark toggles, framing range, shutter) in all three concepts, so the concepts differ least at that step; and on 390px ATLAS truncates its first camera toggle label to "모의 장면 끄…". Both are open review points, not fixed in this PR.
