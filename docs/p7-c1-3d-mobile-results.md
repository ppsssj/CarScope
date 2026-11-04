# P7-C1 — 17개 모바일 사용자 점검 결과와 3D 소비자

2026-11-04. `C:\dev\CarScope-p7-ar`, 시작 working tree clean, 기존 브랜치 `feat/p7-mobile-ar` HEAD `a7086c2`. fetch 후 PR #72 병합 main `18403af449334f9bf830f3d9eaa4638bfdf313f6`에서 독립 브랜치 `feat/p7-c1-mobile-results-3d`를 생성했다. 로컬 main은 `ef6f2af`로 오래되어 기준으로 쓰지 않았다. origin `https://github.com/ppsssj/CarScope.git`. PR #71은 당시 OPEN/head `f9a61c2` 기준으로 읽기만 했다. 작업 중 PR #71/#73이 병합되어 최종 기준을 main `b396394695dcf47ccd17a9761b9b2fb374d7a4ba`로 재정렬했다. 미병합 PR을 가져오지는 않았다.

**프런트엔드 소비자·상태·UI는 구현했다. 실제 Native 전달은 미완료다.** 현재 배포는 어댑터가 없으므로 `INCOMPLETE_NATIVE`, 모바일 후보 0이다. 실제 Native ACCEPTED→3D E2E는 NOT_RUN이며 합성 테스트와 구분한다. 병합은 하지 않는다.

## 사전 조사

- `inspect.js`: 기존 GLB·생성 부품 로딩, Raycast 차폐, 카메라 이동, 선택 emissive, 세션 종료, 타이어 재질 상태 지도. 결과 수신 입구는 없었다.
- `inspection-flow.mjs`: overview/hood/tire/EV/visibility/summary와 한 단계 Back·보닛 종료 전환. 기존 geometry availability guard를 보존하고 별도 `PART_RESULT` 상태를 추가했다.
- `inspection-product.mjs`: 기존 전체 요약은 로컬 타이어 4개와 워셔액 미수집 안내였다. 17개 공통 결과 목록/집계를 앞에 추가하고 기존 로컬 입력 요약을 명시적으로 구분했다.
- `tire-inspection.mjs`: immutable local `USER_REPORTED`, 세션별 draft/확정 시각. 이 reducer·모델은 수정하지 않았다.
- 기존 [설계 v1](contracts/mobile-result-to-3d-session-v1.md), [신규 10 task](contracts/p7-b-mobile-tasks-v2.md), 기존 원본 validator/생성기와 canonical digest를 대조했다.
- PR #71의 `SyncInspection`, `SyncReceiverView`, `SyncChecklistInspection`과 병합된 PR #73의 17-task profiles를 확인했다. 원본 canonical/digest·17개 decoder는 재사용 가능하지만 현재 View가 받은 서버 수신/수락 시각을 보존하지 않고 3D binding/비공개 전달 경로도 없다. 이를 일반 JSON으로 우회하지 않는다.
- architecture/roadmap/setup/validation, Pleos/STALE, Anatomy/3D PoC 지침을 확인했다. SDK 5000ms STALE·출처·좌표·원본 GLB/Geometry·Release 정책을 바꾸지 않는다.

## 아키텍처 결정

| 선택 | 판단 |
|---|---|
| 모바일 JSON을 local tire row에 덮어쓰기 | 제외. 원문·출처·ID·draft·proof 손실과 응답 혼합 위험 |
| 3D가 Sync 서버에 직접 인증/polling | 제외. 토큰/차량 소유권·기존 인증 계약을 프런트엔드에 새로 만들게 됨 |
| 초기화 시 주입된 검토된 Native adapter → 엄격한 후보 저장소 → 사용자 선택 → 공통 projection | 채택. 전송 소유권은 Native, 로컬/모바일 저장은 별도, UI만 공통화. 실제 adapter가 없으면 연결 미완료 |

전달 인터페이스·정확한 키·시각/세션 정책·Native 잔여 조건은 [Codex A 인계 계약](contracts/native-to-3d-accepted-v1.md)에 고정했다. 생산 코드는 `createNativeInspectionResults()`로 생성한다. 실제 Native 구현이 준비될 때 **고정 import를 통한 composition 변경**이 필요하며 임의 window API나 메시지 listener로 등록할 수 없다.

## 구현

| 코드 | 책임 |
|---|---|
| `mobile-result-contract.mjs` | 정확한 17 task→part, schema v1/v2 키·타입·UUID·실재 날짜·집계 검증, canonical SHA-256, 4상태 매핑 |
| `native-inspection-results.mjs` | Native adapter capability, 생성 시점 binding/generation, monotonic 만료, 독립 digest/proof, 중복·충돌·지연 거부, immutable 후보·명시적 선택 |
| `inspection-results.mjs` | 기존 로컬 타이어 projection + 선택한 모바일 기록 하나를 17개 상태로 표시. 원본 응답·출처·완료 시각·proof 식별자 보존 |
| `inspection-results-view.mjs` | 17개 목록·집계, 문자/기호/색 배지, 부품 상세·원문/proof·출처·원본 시각, 명시적 기록 선택, 실패/미완료 안내 |
| `inspect.js`, flow/product/view/html | 기존 탐색과 카메라·강조 재사용, 기존 clone material 색만 변경, SDK 영역은 별도로 갱신, 종료/pagehide/dispose 시 정리 |
| builder 및 패키징 테스트 | 새 소비자 모듈만 debug 자산에 복사. 테스트 authority·GLB·release 자산 제외. 실제 app 경로가 아닌 OS 임시 사본에서 검사 |

워셔액은 `washer-fluid`→`washer-fluid-cap`, 브레이크액은 `brake-fluid`→`brake-fluid-reservoir`; 나머지 15개는 기존 exact partId와 taskId가 같다. 좌우 타이어/와이퍼와 네 등화 영역은 독립 기록이다. 충전구 덮개는 별도 task/완료 수로 복제하지 않는다. LCW는 기존 예약 부품 ID로 목록 상세에 접근하며 M.components에 새 형상을 넣지 않는다. 위치가 없는 모델 변형은 overview/bay 시점과 미구현 안내를 사용한다.

`NOT_INSPECTED`, `FINDINGS_REPORTED`, `UNABLE`, `NO_FINDINGS_REPORTED`는 기존 색·기호·한글 배지를 공유한다. 미점검·미수신·잘못된 proof를 사용자 UNABLE로 바꾸지 않는다. 워셔액 원문 OK는 보존하지만 표시 상태는 “발견 사항 없음”이며 정상 판정이 아니다. SDK 관측과 시각·source는 결과 저장소에 입력하지 않는다.

모바일 수신은 후보만 만든다. 완료 수/색은 기존 로컬 상태를 유지하고 사용자가 한 기록을 선택한 뒤에만 바뀐다. 새 inspectionId와 더 늦은 폰 시각도 자동 교체하지 않는다. 로컬 draft를 계속 편집해도 선택 중인 모바일 원문은 바뀌지 않으며 로컬로 돌아가면 별도 draft/확정을 볼 수 있다. 선택 전 만료/취소/검증 실패는 새 적용을 거절한다. 이미 선택한 ACCEPTED 사용자 보고는 전송 세션 만료 뒤에도 페이지 종료까지 남고 연결 종료를 명시한다.

홈·점검 종료·새로고침·pagehide/dispose는 후보/선택/binding/중복 index와 로컬 기록을 정리한다. BFCache 복귀는 새 페이지로 다시 시작한다. 해시/Native verifier await 전후와 선택 시에 current generation/live binding을 다시 검사한다. UUID 충돌을 다른 부품의 완료로 만들지 않는다. 원문 없이 digest만 받은 결과를 복구하지 않는다.

## UI 방향과 시각 검증

기존 어두운 우측/하단 패널, 44px 이상 버튼, 네 상태 배지·색, cyan 선택 강조, camera framing/Back을 보존했다. 새 디자인 시스템·형상·세계 좌표 변경은 없다. 새 결과 목록은 같은 item 스타일을 확장하고 metadata/원문은 접힌 상세에 둔다. 영문 오류 코드 대신 한국어 실패 이유를 보여 준다. 1440×960, 430×900에서 새 상세/집계와 선택 버튼, 원래 시각, 가로 overflow 없음, 선택 후 재질 색과 종료 복원을 확인했다.

새 브라우저 검사의 실제 GLB는 기존 외부 `hyundai_ioniq_5_2022.glb`, SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` 그대로다. Native 어댑터의 합성 authority는 Playwright의 **테스트 context 안에서만** module 응답을 대체한다. 저장소 생산 `inspect.js`와 Android 자산에는 fake receiver가 없다. 이 화면 캡처를 실제 Native 수신 증거로 보고하지 않는다.

## 재현과 검증

Windows / Node22.16.0 / Chrome156.0.8078.80 / Three0.160.0. Anatomy driver를 사용하는 기존 회귀는 `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`를 확인하고 사용했다. 형상을 재생성하거나 `--any-anatomy`를 쓰지 않았다.

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm run check:results --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_EVIDENCE_DIR='C:/CarScope-External/p7-c1/NEW-RUN'
npm run test:results-browser --prefix tools/three-poc # DOM_ONLY, 합성 authority

# 실제 참조 GLB와 페이지 연결 검사는 별도 터미널의 기존 서버 사용
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://poc.example/'
$env:PORT='8135'
node tools/three-poc/serve.mjs
# 다른 터미널
$env:CARSCOPE_3D_TEST_URL='http://127.0.0.1:8135/inspect.html?capture=1'
npm run test:results-browser --prefix tools/three-poc
node tools/three-poc/check-inspection-state-map.mjs C:/CarScope-External/p7-c1/NEW-STATE 'http://127.0.0.1:8135/inspect.html?capture=1' 1600 1000
node tools/three-poc/check-inspection-product.mjs C:/CarScope-External/p7-c1/NEW-PRODUCT 'http://127.0.0.1:8135/inspect.html?capture=1' 430 900
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

새 Node 검사는 17개 mapping, 실제 모바일 생산기가 만든 16개 v2 task×27 응답 조합·v1 세 상태와 digest 일치, strict schema/proof, 중복·내용 충돌·다른 task, 만료/취소/종료, generation/늦은 해시·proof, 로컬/모바일 분리를 검사한다. 기존 tire/geometry 선택 Node 회귀를 함께 유지한다. 새 CI는 **DOM_ONLY** Desktop/모바일 검사를 실행하며 외부 GLB나 Native 연결이 없는 범위를 이름과 결과에 명시한다.

초기 회귀는 QR origin 미설정으로 QR 버튼을 찾지 못해 FAIL했다. `https://poc.example/`를 설정한 새 서버에서 같은 state-map/product 검사가 PASS했다. 초기 문법 명령의 중복 상대 경로도 수정한 `check:results`로 PASS했다. 검사 제외나 기준 완화는 없다. 최종 실행 수치/CI와 원본 로그 위치는 [증거 인덱스](evidence/p7-c1/README.md) 및 PR checks에 기록한다.

Native 17 task decoder는 PR #73으로 병합됐으며, 실제 Native 전달·server clock anchor·수락 시각 보존/채널 소유권이 Codex A의 잔여 작업이다. 실제 Native ACCEPTED→3D, AVD, 스마트폰 광학 QR/실물 점검은 NOT_RUN. 로컬에서 실제 app 빌드/설치·운영 Render 변경·모바일/Sync 서버 변경·원본 모델/Geometry 변경은 하지 않았다. CI 빌드 성공도 각 job 범위로만 보고한다.
