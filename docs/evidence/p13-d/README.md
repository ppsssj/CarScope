# P13-D evidence index

Fresh local run, 2026-11-08: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. Screenshots and results are outside Git in `C:/CarScope-External/p13-d/`. All pictures are generated. See [integration](../../p13-d-multipart-vision.md).

## Status

| Item | Value |
|---|---|
| Engine bay parts with an AI analysis entry | **6 / 6** (4 from detector candidates, 2 from a marked region only) |
| OpenAI calls | **0**. Ledger 4/5 unchanged |
| Roboflow calls | **0**. Ledger 19/20 unchanged |
| P13-B/C files (truth, real-001, prepared crops, approval, ledgers) | 47 files hash-identical (`C:/CarScope-External/p13-c/baseline-hashes.txt`) |
| Detection statuses | Unchanged: 4 EXPERIMENTAL, 2 UNSUPPORTED, 0 VERIFIED |
| Render / production | Unchanged; `PART_DETECTION_OFF`, `PART_ANALYSIS_OFF` PASS |
| Accuracy | Not measured for any part |

## Verification

| Gate | Status | Scope |
|---|---|---|
| Syntax | PASS | `npm run check` in mobile-ar-poc, vision-poc, inspection-sync-poc |
| Mobile unit | PASS | 172 (new `multipart-analysis.test.mjs` 4; `part-analysis.test.mjs` updated to the six-part rules) |
| Six-part browser E2E | PASS | `npm run test:browser:multipart`, `POC_EVIDENCE_DIR=C:/CarScope-External/p13-d/run2`: 3 checks |
| P13-A analysis browser | PASS | 7 checks; its "draft parts not offered" check now asserts "offered as an experiment, nothing sent until asked" |
| Mobile browser regression | PASS | `browser` (QR v2, checklist), `tire`, `charge`, `brake`, `mobile-ar`, `ux`, `part-guide`, `part-detection`, `page-start`, `webxr`, `webxr-qr` |
| Vision unit / browser | PASS | 164; `test:browser`, `review`, `assisted`, `washer` |
| Sync | PASS except one pre-existing | 298 tests: 260 pass, 37 skipped (no Postgres), 1 fail `avd-setup-script` (non-ASCII user folder path in PowerShell; same on main, unrelated). Six-part relay test PASS. `mobile-browser`, `browser` PASS |
| Real calls, real phone, Render | NOT_RUN | See section 9 of the doc |

Found and fixed during the run: (1) `part-analysis.mjs` now imports the detection table, and the P13-B truth page did not serve that module, so its page failed to load; the module was added to its allow list. (2) An "experimental" note used the word "정확", which the P13-A copy rules forbid in the dialog; the note was reworded, the rule kept. (3) Comments mentioning the detector vendor by name tripped the `PART_DETECTION_OFF` source scan; the comments were reworded, the gate kept.

## Artifacts (`C:/CarScope-External/p13-d/run2/p13-d/`)

| File | SHA-256 |
|---|---|
| `results.json` | `7f346f8cc9c299e0fd174d3d2a280d02b5392974c192487df01ec0727c3b326e` |
| `battery-manual-picker.png` | `8e144f91500098e7bdb32af5c57cc13f2aa640650174d05cad833fc474182d33` |
| `battery-result.png` | `89044bf9d1b6ffb87d3c4b32847e2f3db66e93bb56a3cba4122337c9466908d4` |
| `coolant-result.png` | `63707f360fc42046b44ba893f24694e3d0a52abcdcd345eb1adcc52e8d9c1936` |
