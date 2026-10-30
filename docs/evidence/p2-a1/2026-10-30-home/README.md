# P2-A1 증거 — 자동차 전용 kit 시각 개선, 집 PC, 2026-10-30

이 README만 Git에 포함합니다. Before/After 비교 PNG, 4× close-up, AVD 캡처, logcat, 벤치마크 페이지는 집 PC 로컬에 보존했습니다.

## 생성과 검증 (호스트)

| 항목 | 결과 |
| --- | --- |
| Anatomy | `~/.claude/skills/anatomy` @ `1482e84` (로더가 커밋을 검사) |
| `node tools/anatomy-car/build.mjs --audit` | `audit passed` (형상 112, item 40, 겹침 162, 규칙 162) |
| `scripts/lines.mjs` | closed / front-left-open / rear-left-open / both-open × light / dark: 모두 `line ends: 0` (선 27개, 끝 44개) |
| 결정성 | 연속 두 번 실행 SHA-256 `13d2d0d9d6d8c1380bf0039fe7599f385a81545da5539bab7e66012c7b7ca032` |
| `scripts/capture.mjs` | 1× 닫힘/열림, 4× 옆면, 4× 도어·힌지, 4× 휠·전면, 4× 개구부. console clean |

Before 이미지는 P2-A 자산(`a785c4c1…`)의 미리보기를 같은 구도로 캡처했습니다. Before/After를 좌우로 붙인 비교 5종(full-closed, full-open, z-side, z-door, z-wheel-front)을 만들어 직접 검토했습니다.

## 성능 측정

- **SVG 샘플**: 같은 `VehicleSvgRenderer`에 P2-A 자산과 P2-A1 자산을 차례로 넣어 `exportSvgSamples`로 뽑았습니다. 측정 후 자산은 P2-A1로 되돌렸고, 해시로 확인했습니다.
- **호스트 Chrome**: 1634×320 컨테이너에 SVG를 넣고, 동기 파싱+레이아웃 시간과 두 프레임 뒤까지의 시간을 20회씩 두 번 쟀습니다. 앞 3회는 버렸습니다.

  | 자산 | 노드 | 파싱+레이아웃 | 페인트까지 |
  | --- | --- | --- | --- |
  | P2-A | 288 | 2.0 / 3.5 ms | 33.5 / 33.5 ms |
  | P2-A1 | 554 | 3.0 / 3.8 ms | 33.5 / 33.6 ms |

- **호스트 JVM**: `VehicleSvgRenderer.render()`를 200회 예열한 뒤 200회 측정했습니다.
  - 중앙값: P2-A 0.178 / 0.180 ms, P2-A1 0.123 / 0.132 ms
  - 첫 호출(자산 로드 포함): P2-A 131 / 118 ms, P2-A1 124 / 124 ms

## AVD (Pleos 2.1.0, SDK 2.3.2, Service 2.3.22)

APK는 `ANDROID_USER_HOME=C:\Android\.android`로 빌드해 기존 설치본과 같은 debug key로 서명했고, `adb install -r`은 Success였습니다.

| 단계 | 결과 |
| --- | --- |
| cold launch | TotalTime 4,230 ms |
| MOCK 기본 | 새 모델, FL/RL 닫힘 초록 |
| 모의: 앞 왼쪽 열림 | FL 열린 형상(도어 두께, 창틀) 빨강 |
| PLEOS current | `current raw=0` → FL 닫힘 초록, RL UNAVAILABLE |
| Console OPEN | `event raw=1` → FL 열림 빨강 |
| Console CLOSE | `event raw=0` → FL 닫힘 초록 |
| 안정성 | ANR 0, PSS 124.7 MB, gfxinfo janky 100% (50% 지점 150 ms, P2-A와 같은 수준) |
