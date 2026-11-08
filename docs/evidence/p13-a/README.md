# P13-A evidence index

Fresh local run, 2026-11-08: Windows 10, Node 22.16.0, Chrome 157.0.8103.38 (Playwright 1.56.1, headless). Screenshots and result files are outside Git in `C:/CarScope-External/p13-a/`. All pictures are generated (grey canvas with coloured squares). No car photo was used. See [design and limitations](../../p13-a-hybrid-vision-inspection.md).

## Verdict

`IMPLEMENTED_LOCAL_POC`. The pipeline, contract and screens are verified with a fixture detector and the MOCK vision provider. **Real image-analysis accuracy is not measured: `REAL_PROVIDER_NOT_RUN`.**

## Verification

| Gate | Status | Reproduction / scope |
|---|---|---|
| Syntax | PASS | `npm run check` in mobile-ar-poc, inspection-sync-poc, vision-poc |
| Crop geometry | PASS | mobile-ar-poc `node --test test/context-crop.test.mjs`: 9 |
| Result contract, profiles, page states | PASS | mobile-ar-poc `node --test test/part-analysis.test.mjs`: 9 |
| Analysis relay | PASS | inspection-sync-poc `node --test test/part-analysis.test.mjs`: 8. Real HTTP on 127.0.0.1, MOCK provider |
| OpenAI adapter | PASS | vision-poc `node --test test/openai-vision.test.mjs`: 6. Fake fetch only |
| Mobile unit suite | PASS | mobile-ar-poc `npm test`: 168 |
| Vision unit suite | PASS | vision-poc `npm test`: 137 |
| Sync unit suite | FAIL (pre-existing, unrelated) | inspection-sync-poc `npm test`: 297 total, 259 pass, 37 skipped (Postgres not configured), 1 fail: `avd-setup-script.test.mjs` "the endpoint reaches the app only through stdin". The fake adb path under the non-ASCII Windows user folder is mis-encoded in PowerShell. Fails the same way on the unmodified copy; files unchanged from `main` |
| Static gates | PASS | `PART_ANALYSIS_OFF` (new) and `PART_DETECTION_OFF` PASS; `deployment-preflight` "static gates pass" PASS |
| P13-A browser E2E | PASS | mobile-ar-poc `npm run test:browser:analysis`, `POC_EVIDENCE_DIR=C:/CarScope-External/p13-a/run2`: 7 checks (below) |
| Browser regression | PASS | Each script run alone with its evidence directory: mobile `browser`, `tire`, `charge`, `brake`, `mobile-ar`, `ux`, `part-guide`, `part-detection`, `part-analysis`, `page-start`, `webxr`, `webxr-qr`; sync `mobile-browser`, `browser`. 14/14 exit 0 |
| Core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| Diff | PASS | `git diff --check` |
| Real OpenAI call | NOT_RUN | `REAL_PROVIDER_NOT_RUN`. Paid call, not approved |
| New Roboflow call | NOT_RUN | Intentionally none |
| Real image accuracy | NOT_RUN | No evaluation set, no real provider |
| Real phone, AVD, Render | NOT_RUN | Local PoC |

The first combined `npm run test:browser` attempts failed before any test because each script needs its own evidence directory variable. They were rerun one by one as listed. During development the E2E found two real defects that were then fixed: `MobileSync` lacked the analysis call, and the dev proxy did not pass a phone's cancel upstream.

## Browser E2E checks (run2)

1. Analysis off, and draft parts (coolant, brake, fuse box): no section, file or request. The P12-E search is unchanged.
2. Candidate, change of candidate, context crop cut from the 1600x1200 original (not the 1280 search copy), part whole with surroundings, consent naming the service, one send of the crop (double tap included), structured result, continue only after confirmation. Inspection answers, record and sent result are unchanged, and no AI text is in the result.
3. Suspected, indeterminate and wrong-part screens with evidence, limitations and retake tips. A safety claim, an extra `confidence` key and non-JSON are refused and not shown. Failure, retry with new consent, and 429 all end in words. Retake returns to a new photo and consent.
4. No candidate, or a failed search, offers manual marking. The crop is centred on the tap and the request says `MANUAL`.
5. Cancel returns to the preview and asks consent again. A late answer after cancel, or after leaving the screen, shows nothing. Both abort the provider call.
6. EXIF orientation 6: the search and the crop both read 300x400, and the box means the displayed place.
7. The result fits at 320x568, 344x882 and 844x390, with buttons at least 44px tall.

## External calls

| Ledger | Before = after |
|---|---|
| Roboflow `C:/CarScope-External/p12-f/calls.json` | 19/20, SHA-256 `1c232ad4bbd3a0e86c1c3a9fce3829ce554f75d1cd90bf47a4a89afe79e64618` (same as P12-H) |
| OpenAI | No key file, no ledger, no call |

## Local artifacts (`C:/CarScope-External/p13-a/run2/p13-a/`)

| File | SHA-256 |
|---|---|
| `results.json` | `d5d718e3b494a9aa8b4f29484a317c2d6faf4698ab2d59766be2e117cad6728f` |
| `crop-preview.png` | `cb53186789966f54aaa7b5775463f67b376b63604e532a5a8ab81290b6c5b6b8` |
| `result-suspected.png` | `28574b0e21b9398d4431c4da747c31363f41f9800d241f4310d4fcaa3cd5f678` |
| `manual-region.png` | `b8535581f2bb250525e3e9626e26c60e8c4076380c990b030faa0c1785d597f5` |

Also in that folder: `region-choice`, `analyzing`, `result-no-visible-issue`, `result-indeterminate`, `failed-invalid`, `size-320`, `size-flip-cover-344`, `size-landscape-844`.
