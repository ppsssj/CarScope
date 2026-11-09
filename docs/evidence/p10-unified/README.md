# P10 통합 3D 시각 UX 증거 인덱스

[설계](../../p10-unified-3d-visual-ux.md). 원본(캡처, `results.json`, `measured.json`, `roles.json`, `labels.json`, 브라우저 로그)은 `C:/CarScope-External/p10/p10-unified/`에 있고 Git에 넣지 않았다.

환경: 기준 main `5e96f2b`(PR #115), Windows 10, Node 22.16.0, 실제 참조 GLB(`hyundai_ioniq_5_2022.glb`), headless Chrome 157.0.8103.38. 화면 1600×1000, 1224×880, 1024×600, 420×860.

| 범위 | 판정 |
|---|---|
| 데스크톱 Chrome, 실제 GLB 페이지 | 실행 |
| Playwright 터치 에뮬레이션(420×860, `hasTouch`·`isMobile`) | 실행. 실제 손가락이 아니다 |
| 모바일 결과 수신 | 스크립트 어댑터(`test/native-results-browser-fixture.mjs`). 실제 Native 아님 |
| AVD, Android WebView, 실제 손가락 터치, 스마트폰, 실차, 운영 서버 | **NOT_RUN** |
| 수정 전후 변이 실행(일부러 실패시키기) | **NOT_RUN** |

## 실행

| 실행 | 코드 | 기준선 | 결과 | 폴더 |
|---|---|---|---|---|
| 수정 전 | main `5e96f2b` (별도 worktree, 포트 8198) | P10-2 기준선 | PASS, MATCH. FIXED 7, KNOWN_ISSUE 16, NOT_MEASURED 5 | `before-20261109/` |
| 1회차, 수정 미선언 | 1차 구현 | P10-2 기준선 | FAIL(의도): P0-4·P1-3·P1-4·P1-5·P1-6 `FIXED_UNDECLARED`. P2-6 불일치 8건, 라벨이 다른 부품 클릭을 가로챈 회귀 발견 | `run1-undeclared/` |
| 2회차, 5건 선언 | 라벨 배치·가림 판정 수정 | P10-2 기준선 | FAIL(의도): P2-6 `FIXED_UNDECLARED`(불일치 0/170), 차이 266건 | `run2-declared/` |
| 3회차 | P2-6 선언 | 기준선 기록 | PASS, `WRITTEN` | `run3-write-baseline/` |
| 4회차 | 같은 코드 | 갱신한 기준선 | **PASS, MATCH**. FIXED 13, KNOWN_ISSUE 12, NOT_MEASURED 3 | `run4-compare/` |
| 5회차, 최종 | 선택 외곽선을 로드 때 미리 생성 | 갱신한 기준선 | **PASS, MATCH**. FIXED 13, KNOWN_ISSUE 12, NOT_MEASURED 3 | `run5-final-compare/` |
| 라벨 검사 | 최종 코드, handoff 테스트 출처 `https://qr-test.invalid/`(접속 없음) | — | **PASS 64, NOT_RUN 0** | `labels-run3-final/` |
| 회귀 | 최종 코드 | — | 아래 표 | `regression/`, `ci-dom/` |

## 담당 Known Issue

| ID | 수정 전 | 수정 후 | 판정 |
|---|---|---|---|
| P0-4 개요가 강조된 부위를 말하지만 보닛만 강조 | 보이는 타이어 2·와이퍼 2 강조 없음 (4개 화면) | 0개 | **FIXED** |
| P1-3 워셔액만 3D 라벨 | 라벨 1개(워셔액) | 형상이 있는 18개 부품 모두 미리보기에서 라벨 표시 (4개 화면) | **FIXED** |
| P1-4 같은 선택이 재질마다 다르게 보임 | 선택 픽셀 휘도 편차 0.471 (0.383~0.854) | 0.222 (0.593~0.815), 기준 ≤ 0.25 | **FIXED**. 여유 0.028, 조명·시점 영향 |
| P1-5 선택이 결과 색을 덮음 | 측정값 없음(`NEEDS_P10`) | 결과가 있는 6개 부품(워셔액·냉각수·타이어·와이퍼·하향등·충전구)과 선택 중 도착한 결과 1건: 재질 색 = 결과 색, 외곽선, 발광 ≤ 결과 휘도 50%, 라벨 기호, 목록 배지 일치. 선택되지 않은 결과 부품은 발광 0 | **FIXED** (스크립트 어댑터 결과) |
| P1-6 미점검 타이어만 착색 | `tiresTinted: true` | `false` | **FIXED** |
| P1-13 얇은 부품의 작은 터치 대상 | 와이퍼 19×9px, 전조등 0~8px, 충전구 0px (1600×1000 개요) | 아래 표 | **OPEN** |
| P2-6 3D 라벨이 가림을 확인하지 않음 | 측정값 없음(`NEEDS_P10`) | 라벨 170건을 별도 광선으로 확인, 불일치 0 | **FIXED** (표본 화면, 모든 자세의 증명 아님) |

### P1-13이 열려 있는 이유

측정 부품과 부모 화면은 P10-0 그대로다(개요에서 와이퍼·전조등·충전구, 보닛 목록에서 보닛 부품). 3D 터치 대상(16px 보정 포함, 가운데 행·열)이나 그 부품을 선택하는 라벨 버튼 중 하나가 양방향 44px 이상이면 통과로 본다.

| 화면 | 44px 미만 |
|---|---|
| 1600×1000, 1224×880, 1024×600 | 오른쪽 와이퍼, 전조등 4개, 충전구 2개 |
| 420×860 | 와이퍼 2개, 전조등 4개, 충전구 2개, 퓨즈박스 |

- 보닛 5개 부품은 라벨과 3D 대상 모두 44px 이상이다(420×860의 퓨즈박스만 라벨 자리 부족).
- 개요에서 전조등 표식은 하우징에 가려 3D 대상이 0~40×8px이고, 충전구는 반대쪽이라 보이지 않는다. 개요 라벨은 영역당 하나라서 부품마다 대상을 주지 않는다(노출 수 제한).
- 각 영역 미리보기(전조등, 충전구, 와이퍼)에서는 부품별 44px 라벨이 있고 실제 클릭으로 선택된다(라벨 검사). 그러나 P10-0의 측정 경로가 아니므로 이것으로 FIXED라고 하지 않는다.

## 기준선 차이 (P10-2 기준선 → 이번 기준선, 470건)

**변화 없음:** 카메라 거리·위치·방향·점유율, 상태 전이(`state`, `backTo`), 뒤로 가기, 이름, QR·모바일 단계, 빈 터치 결과. PR #98 프레이밍·차체 통과·상태 전이 회귀 없음(P0-1, P0-2, P1-1, P1-9, P1-15, P2-4 FIXED 유지).

**새 필드:** `labels`(화면별 라벨 가림 확인), `select3d.*.touch`, `labelClickSelected`, `labelClickState`.

**의도한 변화:**

- `overview.*.highlightedMeshes`: 개요 힌트(P0-4).
- `preview.*.label`, `flows.bayLabel`: PartLabel(P1-3).
- `preview.*.selectionIntensity`, `preview.*.color`: 선택 세기 보정(P1-4).
- `paint.tiresTinted`: P1-6.
- **16px 터치 보정으로 바뀐 3D 선택 6건:** 1024×600에서 왼쪽 와이퍼 셀 클릭이 이제 와이퍼를 선택한다(이전에는 아무것도 선택 안 함). 개요의 전조등 표식 셀 클릭 4건(1600, 1224, 1024의 오른쪽 하향등, 420의 왼쪽 상향등)은 이전에는 아무 일도 없었고, 이제 반경 안에서 실제로 보이는 가장 가까운 대상인 보닛이 열린다. 승인된 규칙대로지만, 아주 작은 표식을 노린 터치가 이웃 영역으로 갈 수 있다(위험).

## 라벨 검사 (`test/browser-part-labels.mjs`, 64건 PASS)

화면마다: 보닛 라벨 5개(저전도 냉각수 없음), 화면 안·패널/상단 바 밖·서로 겹치지 않음·44px, 실제 클릭 선택, 네 번 드래그 회전 후 모든 라벨 주장과 별도 광선 일치, 개요 영역 라벨, 저전도 냉각수는 라벨 없이 목록 결과, 타이어·전조등·충전구·와이퍼 라벨, QR 진행 중 잠금(선택 라벨만, 클릭해도 화면 유지, 종료 후 복귀), 워셔액 QR 화면 라벨 1개. 420×860 터치 에뮬레이션: 라벨 탭 선택, 와이퍼 옆(메시 밖) 탭이 보정으로 선택.

| 화면 | 보닛 목록에 표시된 라벨 |
|---|---|
| 1600×1000, 1224×880 | 5/5 |
| 1024×600, 420×860 | 4/5. 퓨즈박스는 `NO_SPACE`(다른 부품을 덮지 않을 자리 없음). 목록에서 접근 |

## 회귀

| 검사 | 명령 | 결과 |
|---|---|---|
| Node 단위(CI 범위) | `npm test --prefix tools/three-poc` | 292건: 통과 289, TODO 3(P0-3·P1-7·P2-9 기존), 실패 0 |
| 문법 | `npm run check:results` | PASS |
| Android 자산 | `npm run test:android-assets` | 4/4 PASS |
| DOM 브라우저(CI 범위) | `test:results-browser`, `test:consistency-browser`, `test:history-browser` (URL 없음) | PASS |
| 실제 GLB 결과·일관성·이력·토스트 | 같은 명령 + `CARSCOPE_3D_TEST_URL` | 모두 PASS (일관성 18건) |
| Anatomy driver `check-inspection.mjs` | 1600×1000 | PASS 17단계, 콘솔 clean |
| Anatomy driver `check-inspection-state-map.mjs` | 1600×1000 | PASS 23단계, 콘솔 clean |

두 driver 검사는 수정 전 main에서도 실패했다(`check-inspection`: LCW가 비활성 행이라는 이전 조건, `state-map`: 중간 단계 `scrollIntoView` null). 이번에 고친 조건은 다음과 같다.

- `check-inspection`: `capLabel` → 라벨 5개·LCW 라벨 없음, LCW는 목록 결과 버튼(현재 계약).
- `state-map`: 미점검 타이어는 원래 재질(P1-6), 확정 타이어 선택 세기 `0.12` 고정 → 공통 규칙(결과 휘도 50% 상한 + 외곽선), GPU geometry 수는 첫 선택 외곽선이 그려진 뒤 다시 센다.

`avd-android-inspection.mjs`의 `planned === 1` 조건도 같은 이유로 현재 계약과 맞지 않을 수 있으나 AVD를 실행하지 않아 수정·판정하지 않았다(**NOT_RUN**).
