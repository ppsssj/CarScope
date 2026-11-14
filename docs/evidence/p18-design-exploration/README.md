# P18 external evidence index

Capture date: 2026-11-13. Workspace: `C:\dev\CarScope-p18-design-exploration`, branch `feat/p18-mobile-design-exploration`, base `54a101ca74436c4ad721fa1657a477478ee63de1`.

Raw root: `C:\CarScope-External\qr-ar-01\p18-design-exploration\`. Raw screenshots, logs, downloaded reference images and generated builds are intentionally excluded from Git. Paths refer to the originating workstation, not public hosted artifacts.

| Folder/file | Meaning |
| --- | --- |
| `references/index.json`, `*-site.png`, selected official `*-ui.*` | Research evidence. Blank `flighty-ui.png` shell was rejected; use its actual site capture. See research limitations in the reference document. |
| `lab-iteration-1/`, `lab-iteration-2/`, `lab-iteration-3/` | Earlier runs, including documented failures; not final PASS evidence |
| `lab-final/report.json` | PASS: 9 simulated journeys, 54 screenshots, 54 axe checks, zero runtime/console errors; 3 viewport sizes |
| `lab-final/{scope,atlas,logbook}-{mobile,small,tablet}-01-explore.png` | Same initial washer-fluid subject, full-page catalogue/explorer |
| `lab-final/*-02-prepare.png` | Safety before activation |
| `lab-final/*-03-camera.png` | Simulated view, grid and manual mark active |
| `lab-final/*-04-analysis.png` | Uncertain mock analysis after recovery from failed mock analysis; human responses still empty |
| `lab-final/*-05-server.png` | Server accepted; vehicle receipt still pending |
| `lab-final/*-06-vehicle.png` | Explicit mock vehicle receipt after a separate action |
| `mobile-unit-final.log`, `mobile-check.log`, `product-build.log`, `lab-build.log` | Local syntax/types, unit and build runs |
| `product-regression/`, `product-browser.log`, `hosting-final.log`, `assets-final.log` | Existing production React journey, Vite/static staging and all asset-type browser regressions |
| `sync-unit.log`, `sync-check.log`, `sync-sqlite.log`, `ar01.log`, `core.log` | Local server contract, durable store, legacy and JVM checks; consult each log for skipped prerequisites |
| `claude-rerun/` (2026-11-13/14) | Handover re-run without code changes: `lab-final/` (PASS, 9 journeys, 54 captures), product/hosting/assets captures and reports, `*.log` for build, check, unit (192/192) and each browser suite. JVM core not re-run. |
| `comparison/compare-overview.png` | Concepts × steps (explore, prepare, camera, analysis, vehicle receipt), first 390×844 screen of each, from `claude-rerun/lab-final` mobile captures |
| `comparison/compare-0{1..6}-*.png`, `comparison/screens/{scope,atlas,logbook}/` | One full-page side-by-side sheet per step, and the per-concept source copies; `build-comparison.mjs` and `index.json` describe how they were composed |

All evidence is LOCAL / SYNTHETIC unless a row expressly states otherwise. Real phone/provider/vehicle, production deployment and Android runtime were NOT_RUN. The unchanged product captures are the P18 baseline; the three lab designs are candidates, not a replacement UI.
