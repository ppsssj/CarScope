# P5-A4 — 세션 기반 3D 점검 상태 지도

2026-11-03. `git fetch origin main` 후 PR #56과 #57의 merged 상태를 확인했다. 기준은 `bcfb83e90f5369803aa73f7450629eaed08aca5c`이며 독립 worktree `.tools/p5-a4-worktree`, 브랜치 `feat/p5-a4-inspection-state-map`에서 작업했다. 원래 충전구 브랜치/HEAD e9669af와 P5-A3 worktree/HEAD fb7da8b, 다른 worktree와 변경은 보존한다.

## 구현 범위와 데이터 경계

기존 `inspection-flow.mjs` 상태 머신, `tire-inspection.mjs`의 immutable 세션 기록, 모델 선택/카메라/요약과 SDK 소비자를 재사용한다. 새 저장소·결과 수신 endpoint·모바일/Native bridge를 만들지 않는다. **현재 3D 화면에는 모바일/Native 수신 결과가 전달되지 않는다.** 여기서 표시하는 결과는 이 3D 페이지의 체크리스트에서 직접 응답하고 확정한 USER_REPORTED 기록이다. 모바일에서 완료했다는 가정, QR 표시, Native 수신기의 성공, SDK 관측으로 이 기록을 채우지 않는다.

`inspection-state-map.mjs`는 기존 세션을 읽는 순수 projection이다. `INSPECTION_TARGETS`는 부품 ID/표시명/기록 collection/identity key/질문 계약을 등록한다. 첫 대상은 네 타이어다. 향후 부품은 실제 기록 생산·전달 경로와 검증 계약을 먼저 구현한 뒤 등록한다. 지금 등록하지 않은 워셔액·브레이크액·EV·와이퍼·조명 결과를 타이어 세션으로 추정하지 않는다.

| 상태 | 조건 | 화면 표시 |
|---|---|---|
| NOT_INSPECTED | 기록 없음, 미응답/응답 중, 수정 후 미확정, 잘못된 결과 | ○ 미점검 · 미확정이면 별도 진행 중 안내 |
| FINDINGS_REPORTED | 모든 질문에 응답하고 확정, FOUND가 하나 이상 | ! 이상 징후 보고 |
| UNABLE | 확정 결과에 FOUND가 없고 UNABLE이 하나 이상 | ? 확인 불가 |
| NO_FINDINGS_REPORTED | 확정 결과가 모두 NOT_FOUND | − 발견 사항 없음 |

COMPLETED여도 현재 session ID·부품 ID·USER_REPORTED 출처·정확한 행 필드/질문 키·문자열 enum·유효한 확정 시각이 맞지 않으면 미점검이다. 모바일 schema v2나 SDK snapshot을 전달해도 등록된 로컬 기록 형태가 아니므로 결과로 표시되지 않는다. 판정 우선순위는 FOUND > UNABLE > 전부 NOT_FOUND이며, FOUND와 UNABLE의 개별 응답은 기존 체크리스트에 그대로 남는다. 확정 시각은 기존 completedAt을 읽으며 렌더·SDK polling·부품 전환으로 갱신하지 않는다.

## 화면과 수명주기

기존 어두운 패널·타이어 고무 매핑·목록·선택 강조·카메라·뒤로 가기를 유지한다. 기존 복제된 고무 material의 base color만 상태에 맞춰 바꾸고, 선택은 기존 cyan emissive로 구분한다. 원본 GLB·world 좌표·노드/도어 ID·메시·법선·raycast 차폐를 바꾸지 않는다. 가려진 타이어를 투시하거나 관통 선택하지 않으며 목록으로 확인한다. 선택 상태에서는 선택 강조가 색에 더해지고, 상세 배지/문자로 기록 상태를 읽는다.

색에만 의존하지 않도록 네 상태에 기호·문자·개수를 제공한다. 타이어 목록과 타이어/전체 요약은 같은 projection의 배지와 출처·확정 시각을 표시한다. 부품 선택 시 해당 세션의 기록 카드와 기존 개별 응답을 보여 준다. SDK는 접기 영역에 별도로 남으며 capability·availability·관측 시각·단위를 사용자 결과에 합치지 않는다. 발견 사항 없음도 정상·안전·주행 가능 인증이 아니다.

기록 수정 시 기존 reducer가 IN_PROGRESS와 completedAt=null로 되돌린다. 지도·목록도 즉시 미점검으로 바뀌며 재확정 후 갱신된다. 다른 부위·요약·QR 안내 왕복은 같은 기록을 유지한다. 홈/점검 종료에서 새 세션을 만들고 원래 고무색으로 복원한다. renderer dispose에서도 기록을 비운다. 새로고침 후 복구·localStorage/sessionStorage·DB 영구 보존은 추가하지 않는다.

공유 페이지가 이미 Debug 패키징 대상이므로 `build-android-inspection.mjs`의 복사 목록에 새 순수 모듈 두 개를 추가했다. 이는 Native 구현 변경이 아니다. 패키징 회귀는 임시 소스 사본에서 실행해 작업 트리의 app 자산을 생성하지 않으며, 모듈 원본 동일성과 import 해석/CSP를 확인한다. app/**·Android Native·Node 서버·모바일 코드·SDK/STALE 정책은 수정하지 않았다.

## 재실행

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://poc.example/'
$env:PORT='8144'
node tools/three-poc/serve.mjs
```

다른 터미널, 저장소 루트에서 외부 증거 경로를 매 실행 새로 지정한다.

```powershell
node tools/three-poc/check-inspection-state-map.mjs C:/CarScope-External/p5-a4/NEW/desktop 'http://127.0.0.1:8144/inspect.html?capture=1' 1600 1000
node tools/three-poc/check-inspection-state-map.mjs C:/CarScope-External/p5-a4/NEW/portrait 'http://127.0.0.1:8144/inspect.html?capture=1' 420 860
# 기존 check-inspection-product / check-tire-inspection / check-tires / check-inspection-components / check-inspection도 같은 서버에서 실행한다.
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

기존 component/EV/charge/visibility 브라우저 검사는 각 `check-*.mjs`의 인자로 이전에 추출한 Kotlin MOCK JSON을 넣는다. 이번 fresh browser 실행과 기존 입력 fixture를 구분한다. 해당 파일이 없다면 실제 serializer 산출물을 준비하고, 임의 JSON을 Kotlin 산출물로 부르지 않는다. AVD·실차 관측을 대신하는 검사가 아니다.

## 검증 보고

환경: Windows, Node 22.16.0, Chrome 156.0.8078.80, Three.js 0.160.0. 외부 GLB SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`. 이번 새 실행과 기존 Kotlin MOCK 입력 fixture를 구분한다. [증거 인덱스](evidence/p5-a4/README.md).

| Gate | 상태 | 명령 / 관찰 |
|---|---|---|
| Node 단위·계약 | PASS | `npm test --prefix tools/three-poc`: 77/77 (기존72+신규5), 27 응답 조합·완료 전 집계 차단·수정·출처/세션/타입/시각 검증 |
| 모듈 syntax·diff | PASS | 변경 JS/MJS의 `node --check`, `git diff --check` |
| Debug 패키징 계약 | PASS | `npm run test:android-assets --prefix tools/three-poc`: 1/1. 임시 사본에서 새 모듈 포함·원본 동일성·상대 import·CSP 검사. 작업 트리의 app 자산 생성 없음 |
| 새 상태 지도 browser | PASS | `check-inspection-state-map.mjs`, 1600×1000/420×860. 실제 GLB와 UI 입력, 네 상태·키보드/실제 canvas 클릭·출처·원래 시각·재확정·요약·메시 자원 수·종료/재진입/새로고침/dispose |
| 기존 제품·타이어 | PASS | `check-inspection-product.mjs`, `check-tire-inspection.mjs`, `check-tires.mjs`, desktop/portrait. 선택·강조·카메라 복원·키보드·연속 전환·실제 child viewport resize |
| 기존 보닛 네 부품 | PASS | `check-inspection-components.mjs`, desktop/portrait. 기준 main에서도 보정 하네스 PASS. 아래 정정 참조 |
| 보닛·워셔액·QR | PASS | `check-inspection.mjs`, desktop, 개폐·취소·강조·QR·복귀 |
| SDK/EV/충전구/와이퍼·조명 | PASS 합성 | 기존 `check-component-status.mjs`/`check-ev-status.mjs`/`check-charge-port.mjs`/`check-visibility.mjs`, desktop. 기존 Kotlin MOCK 입력 + 새 실제 GLB browser. Native pause/resume 신호는 desktop simulation |
| Core JVM | PASS (1 skip) | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 38 tests,37 PASS,fail/error0,기존 IONIQ5_PARTS 미설정 자산 검사1 skip |
| 렌더·접근성 | PASS 범위 한정 | desktop/portrait 혼합 상태·전체 요약·상세·스크롤 목록 캡처 육안 확인. 기호/문자·키보드·44px 기존 검사·가로 넘침 검증. 스크린리더 실측 NOT_RUN |
| 실제 모바일 결과 수신→3D | NOT_RUN / 미구현 | 수신 경로를 만들지 않음. 이 페이지 직접 입력/확정 결과만 표시 |
| Android 빌드·AVD·실차·실제 폰 | NOT_RUN | 범위 밖. desktop shell simulation·패키징 통과와 구분 |
| Geometry/Anatomy 생성·audit | NOT_RUN | 형상·좌표·카메라 수식 변경 없음, 원본/생성 자산 미수정 |

초기 실패와 정정:

- 새 browser run01의 한국어 assertion이 Windows 기본 파이프 인코딩으로 손실돼 실패했다. UTF-8로 고쳤고 제품 한국어 문자열은 손상되지 않았다. run02/03 새 실행 PASS.
- 기존 네 부품 하네스는 전역 부품이5개이고 원래 재질 발광이 모두0이라는 오래된 가정 때문에 실패했다. 기준 main bcfb83e를 archive한 독립 소스에서도 첫 실패를 재현했다. 전체 비타이어 등록 부품의 정확한 집합/중복 없음 검사를 추가하고 기존 네 부품10개 메시 검사를 유지했다. 선택 외 부품은 시작 시 원래 발광과 같아야 하며 기존 워셔액 안내 강조만 원래 의도대로 분리한다. 임계값 상향·형상 제외·제품 수정 없이 기준 main과 현재 코드에서 각각 PASS했다. run02/03 실패와 run04 기준/현재 PASS는 별도 보존한다.

이번 구현 완료 범위는 세션 내 타이어 상태 지도다. 영구 보존, 다른 부품의 사용자 결과 생산/수신, 모바일/Native 결과의 세션·차량 정합성 검증과 실제 기기 통합은 후속이다.
