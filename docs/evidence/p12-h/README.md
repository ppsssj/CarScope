# P12-H evidence index

Fresh local run: Windows, Node 22.16.0, Chrome 157.0.8103.38, Python 3.11.9. Raw photos, PDFs, logs and screenshots remain outside Git in `C:/CarScope-External/p12-h/`. Existing P12-G review file was read only. See [analysis and limitations](../../p12-h-assisted-identification.md).

## Verification

| Gate | Status | Reproduction / scope |
|---|---|---|
| Evaluation-set integrity | PASS | `npm run assisted:report`: all 26 image hashes and stored answers checked, P12-C reuse compared |
| Syntax | PASS | vision-poc `npm run check` |
| Vision unit/integration | PASS | vision-poc `npm test`: 131 tests |
| Existing vision browser | PASS | vision-poc `npm run test:browser`: 11 scripted-detector checks; no trained model |
| Existing review browser | PASS | `npm run test:browser:review`: 9 synthetic checks, not a human review |
| Assisted browser | PASS | `npm run test:browser:assisted`: synthetic import remains UNREVIEWED, no auto save |
| Real 26+1 browser | PASS | `CARSCOPE_REAL_ASSISTED=1`, `CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p12-h/screenshots`, same browser command: 26 existing photos load, separate IONIQ set, 5 boxes, battery UNKNOWN, no PUT/outbound requests |
| Mobile regression | PASS | mobile-ar-poc `npm test`: 150 tests |
| QR/WebXR browser | PASS | mobile-ar-poc `npm run test:browser:webxr`, `POC_EVIDENCE_DIR=C:/CarScope-External/p12-h/webxr`: fake XR, real Chrome; no device tracking claim |
| Core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 37 passed, 1 existing skipped external-asset test |
| Diff | PASS | `git diff --check`; no changes to original labels/evaluator/mobile/SDK/geometry |
| Android / AVD / real vehicle | NOT_RUN | Local review-tool change; no new runtime claim |
| New inference | NOT_RUN | Intentionally no new Roboflow or external vision API calls |
| Formal precision/recall | NOT_RUN | Assisted candidates are not final ground truth |

Initial checks failed because dependencies were absent; installed repository lockfiles via `npm ci --ignore-scripts` and reran. An intermediate server-default initialization defect was caught by existing tests and fixed; the final suite passes. WebXR first run lacked its required evidence environment variable; the configured rerun passes. These are fresh executions, not reused P12-G results.

## Immutable inputs

| File | Before = after SHA-256 |
|---|---|
| `C:/CarScope-External/p12-g/label-review.json` | `edac4920983ba408f50ee2da24a477cc199ab63d34c9df5f026830df97a77637` |
| `C:/CarScope-External/p12-f/calls.json` | `1c232ad4bbd3a0e86c1c3a9fce3829ce554f75d1cd90bf47a4a89afe79e64618` |
| `C:/CarScope-External/p12-f/run1/answers.json` | `d4ea96be6a061c2df49ee79b44a3aaf1e6e1be46f9808c2dddbafae91fb3aeda` |

Roboflow ledger remains **19/20**. Byte-identical ledger/answers, read-only report/server modules with no inference-client import, and browser request monitoring support zero additional calls. No external image service or image upload was used. The existing review contains one completed record; this work added zero human reviews.

## Local artifacts

| Relative file | SHA-256 |
|---|---|
| `assisted-labels.json` | `80c2a9887331c9bd42d4c8ce8787ed8550cbd1189a63cb61c4a2dfb9385adc10` |
| `comparison-report.json` | `4d6320ffddcacd170b1e48a177bf3515e87f6b79f32c124a720f72b5e2126b20` |
| `screenshots/assisted-ioniq5.png` | `e4a42d25672ff0791e75c0645afd222649b836442558ff6d29c749a72c261a13` |
| `screenshots/assisted-bolt.png` | `b718867f61f2754a2f1e7a2a6264110c361bc2c604b9605446f87a6f7b673e6b` |
| `screenshots/assisted-synthetic.png` | `add73e9eefd8ae29fb273bff33b2a233b690579c1dba9208201bc1d51a6531a7` |
| `vision-tests.log` | `920ac1fc63b05dc7784f00c91aa6555b713c3c0cdc5ba07a12f5d02f5ce98e60` |
| `review-browser.log` | `ffc75a28a8b73d0a84f07c15dc2ac9244905887b8ff1b0a7ac7bb474d57ac062` |
| `assisted-browser.log` | `fd4ed9c7074b5f48b81d228ee15eb640b0d7c2dff03b9b1144b70b0063e0aaca` |
| `mobile-tests.log` | `268f83592d9c418a6efff533dc2473540bca53cc2a270d3a9f00db3c4af59595` |
| `webxr-browser.log` | `09b8975bd1213e8f921ce0e076514afbf7c10abf0e8f7352b8883c8408e5c75c` |
| `core-tests.log` | `79b9e58bceaf65e29fa4013a6646a039578175d0a3e74d581df2882a898d106c` |

Screenshots are review evidence only, not committed image assets. `assisted-ioniq5.png` shows the five candidates and source link; `assisted-bolt.png` shows Codex/P12-F/Roboflow layers. Photo attributions/licenses are displayed in the UI and preserved in the external manifests.

## Photo-by-photo summary

E = EVIDENCE_SUPPORTED, V = VISUAL_CANDIDATE, U = UNKNOWN, R = NEEDS_REFERENCE. Every row was inspected as pixels; these are not human approvals. S/M/C/U are provisional success/miss/confusion/undetermined list counts; U includes unmatched out-of-scope model predictions.

| Image | Vehicle (source metadata; year unverified) | Washer | Coolant | Brake | Fuse | 12V | LCW | Boxes | S/M/C/U |
|---|---|---|---|---|---|---|---|---:|---|
| commons-029 | Nissan President | V | U | U | U | U | R | 1 | 0/0/0/5 |
| commons-032 | Skoda Rapid | V | V | U | U | V | R | 3 | 3/0/0/8 |
| commons-040 | Kia K5 GT | V | V | V | V | V | R | 5 | 3/0/0/9 |
| commons-041 | Kia Sportage Hybrid | V | V | V | V | U | R | 4 | 2/2/0/11 |
| commons-045 | Toyota Corolla Hybrid | V | V | V | U | V | R | 4 | 2/2/0/8 |
| commons-086 | Dacia Spring | V | U | V | V | V | R | 4 | 0/2/1/2 |
| commons-094 | Toyota Yaris Hybrid GR Sport | V | V | V | U | U | R | 3 | 1/1/0/8 |
| commons-123 | Toyota Prius V | V | V | V | U | U | R | 3 | 1/2/0/3 |
| commons-159 | Mercedes-Benz C200 CGI Station Wagon | V | U | U | U | V | R | 2 | 0/1/0/16 |
| commons-170 | Ora Funky Cat | V | V | V | U | V | R | 4 | 2/2/0/5 |
| commons-171 | Peugeot e-208 | V | V | V | U | V | R | 4 | 1/3/0/3 |
| commons-066 | Skoda Fabia | U | U | E | U | U | R | 1 | 0/0/1/0 |
| commons-024 | Mitsubishi Galant | U | U | V | V | V | R | 3 | 3/0/0/12 |
| commons-031 | Nissan Tiida | U | U | U | V | V | R | 2 | 0/1/1/12 |
| commons-036 | Chevrolet Bolt EV | V | V | V | V | V | R | 7 | 2/5/0/7 |
| commons-037 | Chevrolet Bolt EV | V | V | V | V | V | R | 7 | 2/4/0/3 |
| commons-039 | Toyota Urban Cruiser Hyryder | V | V | V | U | V | R | 4 | 0/3/1/5 |
| commons-047 | BYD Dolphin G DM-i | V | V | V | U | U | R | 3 | 1/0/0/10 |
| commons-059 | Audi 80 B4 | V | V | V | U | U | R | 3 | 2/1/0/6 |
| new-00 | Nissan Leaf | V | V | V | U | V | R | 4 | 0/3/0/3 |
| new-03 | Ford Focus Electric | V | V | V | U | V | R | 4 | 1/3/0/0 |
| new-04 | Nissan Leaf | V | V | V | U | V | R | 4 | 0/1/0/10 |
| new-05 | Chevrolet Bolt EV | V | V | V | U | U | R | 5 | 0/4/0/7 |
| new-06 | unknown (fuse box close-up) | U | U | U | V | U | R | 1 | 0/1/0/0 |
| new-07 | Chevrolet Volt | E | V | V | U | U | R | 3 | 0/0/0/14 |
| new-08 | Mercedes-Benz 250S | U | U | U | U | V | R | 1 | 0/1/0/5 |
| ioniq5-reference | Hyundai IONIQ 5 (separate reference) | V | V | V | V | U | V | 5 | NOT_RUN |

## CI

Remote CI status is reported on the PR at the published HEAD. Synthetic CI proves contracts and UI behavior, not correctness of real vehicle identification. The added assisted-browser job uses synthetic photos only.
