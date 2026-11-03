# P5-A5 — 상태 지도 UX와 모바일 연결 준비

2026-11-03. origin/main을 fetch하고 PR #59 merged를 확인했다. 기준 `fdffd96bc77dc498889117e906898aaf95cec1d6`, 독립 브랜치 `feat/p5-a5-state-map-mobile-contract`, worktree `.tools/p5-a5-worktree`. 기존 충전구/P5-A3/P5-A4 작업 트리와 변경을 보존했다.

## 화면 검토와 구현

기준 main의 실제 GLB를 Chrome 420×860에서 실행하고 혼합 상태·선택 상세·전체 요약·스크롤 목록을 캡처했다. 기준 실행도 기능 검사20개가 통과했으나 두 가지 가독성 문제가 보였다.

| 관찰 | 변경 | 보존한 계약 |
|---|---|---|
| 확정된 타이어 선택의 cyan emissive 0.6이 기록 상태색을 거의 흰색으로 보이게 함 | 확정된 타이어만 선택 강조를0.12로 낮춤. 상태색과 선택 중임을 함께 읽음 | 미확정 타이어와 다른 부품의 기존 강조·raycast·선택·카메라·원본 재질/메시 유지 |
| 세로 타이어 요약에서 긴 안내가 결과 버튼을 첫 viewport 밖으로 밀어냄 | 네 상태/개수와 결과 목록을 먼저 표시. 기록 범위·모바일 연결 설명은 목록 뒤의 native details로 이동 | 출처·정상/안전 아님·미수신 안내를 유지하고 키보드로 펼칠 수 있음 |
| 상세의 모델 ID 정보와 중복 확정 시각이 사용자의 기록을 밀어냄 | 모델 위치·부품 ID를 펼침 영역으로 이동하고 확정 시각은 기록 카드에 한 번 표시 | ID/차량 기준 좌우·USER_REPORTED·원래 completedAt 값 유지 |
| 요약 카드의 완료 문구가 상태 배지와 반복됨 | 미확정일 때만 진행 중 안내, 출처와 확정 시각은 별도 줄 | 미점검/이상 징후 보고/확인 불가/발견 사항 없음 의미·집계 유지 |

날짜는 원래 로컬 completedAt에서 같은 UTC ISO를 표시하고 `<time datetime>`으로 의미를 부여한다. 렌더나 polling 시각으로 바꾸지 않는다. 기존 디자인의 어두운 패널·색상·기호·카메라·목록·Back/요약/종료를 유지한 작은 조정이며 새 디자인 체계나 3D geometry는 만들지 않는다.

## 모바일 연결 설계와 구현의 구분

[모바일 결과 → 3D 세션 연결 계약 v1](contracts/mobile-result-to-3d-session-v1.md)은 설계 제안이다. schema v1/v2의7개 task/정확한 부품·질문·상태 매핑, inspectionId/taskId, 로컬 sessionId와 syncSessionId namespace, 출처/확정·수신·수락 시각, 동일 digest·명시 수락 proof, 중복/내용 충돌·만료·지연 콜백·교체 선택 정책을 정의한다.

선택한 후속 구조는 검증된 수신 소유자 → 현재 세션 binding → 별도 모바일 후보/기록 → 사용자 선택 → 공통 projection이다. 원본 결과와 로컬 기록을 별도로 보존하고 SDK 관측은 입력으로 받지 않는다. 워셔액 v1 OK도 3D에서는 발견 사항 없음이며 안전/정상으로 번역하지 않는다. source=MOBILE과 confirmation=USER_REPORTED를 합치지 않고 원래 sync=NOT_SENT/digest를 유지한다.

**실제 receiver adapter·모바일 결과 수신·3D 적용은 구현하지 않았다.** 임의 결과를 UI에 넣는 endpoint·postMessage·URL/전역 setter·fixture mode를 만들지 않았다. 이번 UI의 기록은 계속 이 페이지에서 직접 응답/확정한 타이어 기록뿐이다. 새 `mobile-result-design-contract.test.mjs`는 문서 메타데이터를 기존 생산 코드와 대조하는 Node 테스트이며 browser에 import되지 않는다. 이 테스트의 합성 결과는 UI에 주입되지 않으며 수신 보안/중복/만료 정책의 실행 구현 증거가 아니다.

현재 Native receiver view가 수신/수락 시각을 보존하지 않는 점과 receipt 단독으로는 task/세션 binding이 충분하지 않은 점을 계약에 기록했다. 후속 host가 실제 proof·소유권·수명주기를 제공해야 한다. Native·서버·SDK·인증/TLS를 이번 작업에서 수정하지 않았다.

## 새 검증 결과

Windows / Node22.16.0 / Chrome156.0.8078.80 / Three0.160.0. [증거 인덱스](evidence/p5-a5/README.md). 원본 GLB SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` 불변. 아래는 이번 새 실행이며 SDK 브라우저 입력만 기존 Kotlin MOCK fixture를 사용했다.

| Gate | 상태 | 범위·명령 |
|---|---|---|
| Node 단위/계약 | PASS | `npm test --prefix tools/three-poc`,81/81. 기존77+UX1+문서/생산 코드 일치3 |
| Debug 패키징 계약 | PASS | `npm run test:android-assets --prefix tools/three-poc`,1/1. 임시 사본에서 모듈/CSP 검사, 실제 app 자산 생성 없음 |
| syntax/diff | PASS | 변경 JS/MJS `node --check`, `git diff --check` |
| 상태 지도/새 UX | PASS | `check-inspection-state-map.mjs`,1600×1000/420×860 각23 assertions. 첫 viewport 결과·낮춘 선택 강조·native details 키보드·원래 시각/출처·재확정/요약·종료/새로고침 |
| 기존 제품·타이어 | PASS | desktop/portrait: product 각17,checklist 각34,raycast/카메라39/36. 키보드/44px·실제 child viewport resize 포함 |
| 기존 보닛 네 부품 | PASS | `check-inspection-components.mjs`,desktop/portrait 각35 |
| 보닛·워셔액·QR | PASS | `check-inspection.mjs`,desktop17 |
| SDK 상태·EV·충전구·와이퍼/조명 | PASS 합성 | 기존 component10/EV8/charge14/visibility21. 이전 Kotlin MOCK 입력+새 browser, 실제 Native 실행 아님 |
| Core JVM | PASS (1 skip) | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`:38 total/37 pass/0 fail·error/1 기존 IONIQ5_PARTS 미설정 skip |
| 시각·접근성 QA | PASS 범위 한정 | 기준/변경 후 캡처 비교, 문자·상태 배지·첫 목록/상세·선택색 직접 확인. 실제 스크린리더는 NOT_RUN |
| 모바일→수신기→3D E2E | NOT_RUN / 미구현 | 문서/일치 테스트만 제공. 실제 수신·binding·proof·교체 선택 구현 후 필요 |
| 실제 폰·Android Native 빌드·AVD·실차 | NOT_RUN | 범위 밖, 합성 browser/패키징과 구분 |
| 외부 GLB·SDK·인증/TLS·서버 변경 | 없음 | 기존 파일과 정책 보존. geometry 생성/audit은 형상 변경이 없어 NOT_RUN |

최종 선택된 browser 실행은15개·363 assertions PASS다. 기준20개와 run01 중간 UX 검사 결과는 중복 합산하지 않는다. 최초 UI/회귀 실패는 없었다. 후속 CSS 변경은 native disclosure 표시를 유지하기 위한 것이며 run02 지도 검사를 두 화면에서 새로 실행했다.

## 재실행과 남은 조건

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://poc.example/'
$env:PORT='8146'
node tools/three-poc/serve.mjs
# 다른 터미널, 저장소 루트에서 매번 새 외부 경로:
node tools/three-poc/check-inspection-state-map.mjs C:/CarScope-External/p5-a5/NEW/desktop 'http://127.0.0.1:8146/inspect.html?capture=1' 1600 1000
node tools/three-poc/check-inspection-state-map.mjs C:/CarScope-External/p5-a5/NEW/portrait 'http://127.0.0.1:8146/inspect.html?capture=1' 420 860
```

기존 product/tire/components/inspection checker는 같은 URL/외부 출력 경로/viewport 인자를 사용한다. component/EV/charge/visibility checker는 기존 방식으로 실제 Kotlin MOCK JSON을 별도 인자로 제공한다. 원본 입력은 이번에 재생성하지 않았다.

남은 조건은 실제 수신 소유자와 전달 경로, create 시점의 3D/Sync 세션 binding·generation, 엄격한 v1/v2 경계와 digest/proof, 로컬·모바일 후보의 별도 보존/명시 선택, 중복/만료/지연·취소 회귀와 실제 두 기기→3D E2E다. 현재 페이지의 메모리 정책과 SDK 관측/STALE을 유지하며 영구 보존은 별도 과제다. PR만 생성하고 병합하지 않는다.
