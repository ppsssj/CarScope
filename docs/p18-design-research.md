# P18 — Product design exploration / reference lock

Prototype approval: `SKIPPED_BY_EXPLICIT_USER_INSTRUCTION`. The user specifically asks for three working prototypes **before** selecting one. Product adoption: `PENDING_USER_SELECTION`. Nothing here authorizes replacement of the production UI.

## Evidence inspected on 2026-11-13

Official pages were retrieved with web tools, opened in Edge via Playwright, and official screen imagery downloaded outside Git and visually inspected. Marketing pages are not evidence of hands-on native use. No native app was installed. Research captures: `C:\CarScope-External\qr-ar-01\p18-design-exploration\references\`.

| Product and exact source | Observation / why it works | Transfer and limit |
| --- | --- | --- |
| [Halide Mark II, original Lux introduction](https://www.lux.camera/pro-camera-action-introducing-halide-mark-ii/) and [current site](https://halide.cam/) | The Mark II screen puts the photograph above a compact thumb control area. Lux describes focus aids appearing while adjusting focus and disappearing on release. Specialized control is contextual, so expertise does not occupy the viewfinder all the time. Brief feedback teaches what a control changed. | ADAPT camera-first composition and contextual aids in SCOPE. Our controls adjust a labelled synthetic scene, not exposure or focus on real hardware. Current Halide is Mark III; the historical 2020 article is the Mark II evidence. `/mark2/` was inaccessible and was not used. |
| [Flighty official product page](https://flighty.com/) | The visible app separates a map/context from a compact list of flights; announcements name concrete changes such as gate changes or a later departure. Its preflight/airport/after-landing phases filter information by when action is useful. State is useful because it answers what changed and what happens next. | ADAPT distinct human/server/vehicle events and interruption recovery. No time estimate is invented for a real vehicle. The downloaded blank phone-shell image was rejected as screen evidence; `flighty-site.png` shows the actual composited UI. |
| [Not Boring Weather](https://notbor.ing/product/weather), redirected from the requested official domain | A large physical-looking weather object and a small scrub strip make time directly manipulable. Scrubbing changes the thing being inspected, rather than opening another dashboard. The official image shows pronounced object depth and a compact time bar. | ADAPT object selection and spatial reveals in ATLAS. No copied weather object/skin. CarScope's original schematic symbols and range controls explain a selected part; they are not engineering geometry or AR tracking. |
| [Things 3 official features](https://culturedcode.com/things/features/) | The iPhone Today screen groups compact text rows under strong headings; secondary context sits under the task rather than in a surrounding card. The features page describes expanding a task to reveal optional detail. Project headings establish structure before checkboxes ask for action. | PRESERVE grouped list hierarchy; ADAPT to a planned inspection itinerary in LOGBOOK. Completion means a user report, not an all-clear. No gesture-only action or hidden essential safety condition. |
| [Gentler Streak official screen and product page](https://gentlerstories.com/gentlerstreak) | The inspected Streak image pairs a daily narrative with an Activity Path, dated points and a colored history strip. History provides context for the next action instead of being a score alone. The narrative is more prominent than the raw metrics. | ADAPT a dated observation trail and human-readable report in LOGBOOK. Never translate fitness zones into vehicle health/safety scores. Separate MOCK history from today's unconfirmed observations. The documentation subpages timed out; their full contents are not claimed as read. |

The five sources are design evidence, not copied brand assets. Reference screenshots are not shipped in a prototype. All prototype artwork is original SVG interface illustration; no existing vehicle geometry, Anatomy source, SVG generator or GLB is changed.

## Element and major visual decision map (before source implementation)

| Decision | SCOPE — field instrument | ATLAS — object workspace | LOGBOOK — observation journal |
| --- | --- | --- | --- |
| Primary experience | Operate a focused inspection instrument | Understand a part by manipulating its representation | Plan, observe and close a small body of work |
| Discovery | Indexed part rail, category and quick target selection | Zone selector → one large selected object → next/previous part dial; full text index always available | Grouped 17-row plan with multi-selection and a current itinerary |
| Composition | Edge-to-edge scene with a bottom control bay | Central object on an open spatial field, annotations at its perimeter | Editorial page, rules, margin numbers, compact rows; no repeated card shell |
| Type | Strong sans task labels; monospaced instrument metadata | Oversized index and geometric sans; small object annotations | Serif display + system Korean text; tabular dates and folio numbers |
| Surface / accent | Near-black instrument field, bone text, warm amber action cue | Pale lavender field, violet object shadows, saturated violet action | Warm white paper, ink text and ultramarine annotations |
| Camera | Viewfinder first; manual point, optional grid and framing adjustment | Match an outline / reveal region layers; explicitly schematic | Capture a numbered observation and attach it to the report |
| AI | Evidence readout with separate unknowns and direct user response | Switch between visible/unknown layers on the object | AI annotation in the margin beside the user's account |
| Confirmation | Deliberate acknowledgement before leaving evidence mode | Explicit user observation under the layer analysis | Review the itinerary answers and sign the user report |
| Delivery | Signal path: report → server → vehicle, independent events | Three progressively revealed handoff layers | Dated receipt entries attached to a closed report |
| Interaction / motion | Contextual aids only while needed; steady controls | Object motion explains selection/reveal; range + buttons provide alternatives | Expand/collapse rows and dated context; restrained completion feedback |
| Provenance | Halide / Flighty, ADAPT; data meanings from PRODUCT REQUIREMENT | Weather object/scrub principle, ADAPT; part relationship display INVENT for learning the inspection target | Things / Gentler, ADAPT; report semantics from PRODUCT REQUIREMENT |

All three preserve meaningful labels alongside color, focus visibility, keyboard alternatives, reduced motion, explicit safety and AI consent. These are ACCESSIBILITY / TECHNICAL CONSTRAINT decisions. Original object art, annotation locations and report receipts are product-specific inventions: the references do not distinguish provisional AI evidence from a confirmed user report and two separate receiving systems. They are prospective design needs, not retroactive style justifications.

## Synthesis

Build three separate React renderers on one credential-free simulation state model. Same 17 task names, same selected part and same mock findings/unknowns make comparison fair. Layout, discovery model, navigation and interaction remain concept-specific. Each provides exploration, preparation, camera simulation, AI evidence, human confirmation, failure/retry and distinct server/vehicle receipt. Every apparent camera, AI and receipt is persistently labelled as simulation.

Production choice remains open until the user compares the working prototypes. A recommendation and integration assessment will follow visual iteration and browser evidence.
