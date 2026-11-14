# P19 evidence index

Fresh local run on 2026-11-14 in the `CarScope-p19-toss` worktree, on Windows with Node 22.16.0 and Edge 157.0.4341.46 (headless). All screens show MOCK data. No real camera, AI, storage or network path was used.

Raw artifacts are outside Git at `C:\CarScope-External\p19-toss-lab\`. To regenerate them, run `npm run build:toss-lab && npm run test:browser:toss-lab` in `tools/mobile-ar-poc`. Set `TOSS_LAB_OUTPUT` to change the folder.

| Artifact | What it shows |
| --- | --- |
| `p19-idle-390.png`, `-full` | Camera off. Explicit "카메라 켜기" primary and a manual secondary |
| `p19-requesting-390.png`, `-full` | Mock permission wait. The loading CTA keeps its fill and width, and the manual path is disabled |
| `p19-live-390.png`, `-full` | Mock picture, "모의 화면" label, the unverified color-candidate box, and in-picture controls |
| `p19-marked-390.png`, `-full` | User-placed marker "내가 표시한 곳", and a status line saying it is not automatic recognition |
| `p19-flow-marked-by-tap.png`, `p19-flow-toast.png` | Real tap marking. The toast explains that the lab does not advance or record |
| `p19-denied-390.png`, `-full` | Positive recovery copy, numbered permission steps, manual primary and retry secondary |
| `p19-unsupported-390.png`, `-full` | Unsupported camera. Manual primary only |
| `p19-live-320.png`, `-full` | 320px phone |
| `p19-live-390-text130*.png`, `p19-denied-390-text200*.png` | 130% and 200% text. Labels wrap with no truncation and no horizontal overflow |
| `toss-lab-browser-report.json` | Per-state checks and axe results |
| `product-regression/` | Product React E2E artifacts from the same run |

Screenshots were reviewed visually during development. Three issues were found and fixed before the final run: the finder pushed the status line below the fold, the candidate label collided with a chip at 320px, and CTA labels were truncated at 200% text. These results cover local emulation only. They do not establish device performance, real-camera behavior or usability.
