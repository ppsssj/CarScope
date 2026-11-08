# P13-B evidence index

Fresh local run, 2026-11-08: Windows 10, Node 22.16.0, Chrome 157.0.8103.38 (Playwright 1.56.1). Photos, crops, previews and screenshots stay outside Git in `C:/CarScope-External/p13-b/`. See [readiness](../../p13-b-vision-eval-readiness.md) and the [pre-registered criteria](../../p13-b-washer-vision-eval-criteria.md) (committed first, `f4e89e7`).

## Status

| Item | Value |
|---|---|
| Verdict | `READY_FOR_HUMAN_REVIEW` |
| Human truth | **0 / 26**. No truth file exists. Claude entered no answer |
| Real OpenAI calls | **0** (`REAL_PROVIDER_NOT_RUN`). No key file, approval file or vision ledger exists |
| Roboflow calls | **0 new**. Ledger 19/20 |
| P13-A contract / OFF gate | Unchanged; `PART_ANALYSIS_OFF` PASS |

## Verification

| Gate | Status | Reproduction / scope |
|---|---|---|
| Syntax | PASS | vision-poc `npm run check` |
| Washer unit tests | PASS | `node --test test/washer-eval.test.mjs`: 12 (rules, expected table, fixture refused as region, eligibility, pair planning and budget, scoring and gates, usage hook, paths, committed manifest, synthetic truth server + MOCK run/report, approval checklist) |
| Vision unit suite | PASS | vision-poc `npm test`: 149 |
| Vision browser suites | PASS | `test:browser`, `test:browser:review`, `test:browser:assisted`, `test:browser:washer` (new; synthetic pictures and answers, also in CI) |
| Mobile unit suite | PASS | mobile-ar-poc `npm test`: 168 (P13-A contract unchanged) |
| Relay, detection, deployment gates | PASS | inspection-sync-poc `node --test test/part-analysis.test.mjs test/part-detection.test.mjs test/deployment-preflight.test.mjs`: 50 |
| Real photos, read only | PASS | Truth page on the 26 real photos: all load, `commons-040` detection gives crops equal to the prepared candidate rects; 0 non-GET requests, no truth file created. Script: `C:/CarScope-External/p13-b/evidence/real-readonly-smoke.mjs` |
| Candidate crop previews | PASS | `npm run washer:prepare -- --candidates`: 12 regions (11 stored detections, 1 P12-G human box). Margin-isolated arm: 12/12 differ. P13-A product crop: 11/12 identical at 40% and 80% |
| Real evaluation | NOT_RUN | Needs human truth and owner approval |
| CI | see PR | Vision PoC CI runs the new synthetic browser step |

## Unchanged inputs

| File | SHA-256 (same as P12-H record) |
|---|---|
| `C:/CarScope-External/p12-f/calls.json` (Roboflow ledger, 19/20) | `1c232ad4bbd3a0e86c1c3a9fce3829ce554f75d1cd90bf47a4a89afe79e64618` |
| `C:/CarScope-External/p12-f/run1/answers.json` | `d4ea96be6a061c2df49ee79b44a3aaf1e6e1be46f9808c2dddbafae91fb3aeda` |
| `C:/CarScope-External/p12-g/label-review.json` | `edac4920983ba408f50ee2da24a477cc199ab63d34c9df5f026830df97a77637` |

## Local artifacts (`C:/CarScope-External/p13-b/`)

| File | SHA-256 |
|---|---|
| `prepared/candidates/candidates.json` | `cb7ff39e2f4693992a96867e27576fcd990c80ddf82340aa05b3b89c66c6f70c` |
| `evidence/real-readonly-commons-040.png` | `9d6fe6e566690b46a0371287692ef30fd2a1ba66c3e2ef5f5cd372ffeaba18e2` |
| `evidence/synthetic/washer-truth-synthetic.png` | `802b4c78e393e0c902614266608cba5f2168f1b1e22578495e420d57307380bc` |

Also: `prepared/candidates/preview/<id>-r1.png` (12 sheets: photo with region and both crop rectangles, then both crops) and the 24 candidate JPEGs. Candidates are previews, not sendable: `run` reads only `prepared/prepared.json`, which exists after a completed human truth.

Initial attempt note: a long shell heredoc for one edit failed to parse and applied nothing; the edits were then made directly and every suite above was run after them.
