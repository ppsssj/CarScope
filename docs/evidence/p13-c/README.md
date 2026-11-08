# P13-C evidence index

Fresh local run, 2026-11-08: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. Inputs were read only; outputs are outside Git in `C:/CarScope-External/p13-c/`. See [analysis and design](../../p13-c-vision-consistency.md).

## Status

| Item | Value |
|---|---|
| Verdict | `READY_FOR_NEXT_EVALUATION` (owner decisions and new data listed in section 9 of the doc) |
| OpenAI calls | **0**. Vision ledger 4/5, unchanged |
| Roboflow calls | **0**. Ledger 19/20, unchanged |
| Human truth, `real-001`, prepared crops, approval, ledgers | **47 files, SHA-256 identical before and after** (`C:/CarScope-External/p13-c/baseline-hashes.txt`) |
| Production | P13-A route, page, schema v1, prompt `p13-a-1`, crop profile and `PART_ANALYSIS_OFF` unchanged |

## Verification

| Gate | Status | Reproduction / scope |
|---|---|---|
| Syntax | PASS | vision-poc `npm run check` |
| New unit tests | PASS | `test/washer-consistency.test.mjs` 8, `test/washer-crop-compare.test.mjs` 7 |
| Vision unit suite | PASS | vision-poc `npm test`: 164 |
| Vision browser suites | PASS | `test:browser`, `test:browser:review`, `test:browser:assisted`, `test:browser:washer` (now with the three-arm comparison, synthetic, CI) |
| Mobile regression | PASS | mobile-ar-poc `npm test` 168; Chrome `part-analysis-browser` (P13-A flow), `part-detection-browser`, `browser` (QR v2, checklist) |
| Sync regression | PASS | inspection-sync-poc `part-analysis`, `part-detection`, `deployment-preflight` (OFF gates), `e2e`, `protocol`: 59 |
| `real-001` diagnosis | PASS (read only) | `node scripts/washer-eval.mjs diagnose real-001`. Rubric v1: 1 of 4 review, 029 pair flagged. Strict: 3 of 4 review, 029 pair flagged |
| `report real-001` | REFUSED as intended | `REPORT_EXISTS`: the stored report is never overwritten |
| Crop comparison | PASS | `npm run washer:compare`: 19 photos, 3 arms each, B/C byte-identical to the P13-B prepared crops 19/19 |
| Comparison page | PASS | `index.html` opened from file in Chrome: 19 images, 0 console errors, 0 non-file requests |
| Real evaluation | NOT_RUN | No call made by design |

## Artifacts (`C:/CarScope-External/p13-c/`)

| File | SHA-256 |
|---|---|
| `diagnostics/real-001.json` | `3c663c03847a8e776d80d75c124de8eaa037f8d13de7943f73252bb93ecd38e5` |
| `crop-compare/compare.json` | `539b35ea4b0c6c73c5a53e821efb840c9a7c9d1feeceeb82130b9028197c69ef` |
| `crop-compare/index.html` | `44bde177f759738c8f9e77f5c12271ddb8b4f5a551d293afbb0d3f03214608f0` |
| `crop-compare/sheets/commons-029.png` | `77d46242ecf0336c6c0593f809b58d1f16053225a67eec6a8e356e22205f0e9f` |
| `crop-compare/sheets/commons-036.png` | `b1366b02e0c820fc7ad77c453bf98ed8e9acd22b8c1a5c033d98161033c38ef1` |

19 sheets in `crop-compare/sheets/`. Sheets `commons-029` and `commons-036` were viewed directly.

Development notes: two fixture mistakes in the new crop tests (outward rounding to 65px, a "nearby" detection that actually fell inside the 40% crop) were found by the tests and fixed in the tests; the code was right. A first patch script failed on an escaped string and changed nothing; the edit was redone and every suite above ran after it.
