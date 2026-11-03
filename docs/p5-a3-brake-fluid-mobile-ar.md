# P5-A3 — 브레이크액 모바일 AR 보조 점검

2026-11-03. origin/main을 fetch하고 PR #51~#55가 모두 병합됐음을 GitHub에서 확인했다. 기준 main은 `158a619218ba7ff97b5bc94945ceeda99f75d276`. 기존 `feat/p5-a2-charge-port-mobile-ar`/HEAD e9669af 작업 트리와 나머지 worktree는 보존하고 `.tools/p5-a3-worktree`의 독립 브랜치 `feat/p5-a3-brake-fluid-mobile-ar`에서 작업했다.

직접 진입은 `/#task=brake-fluid`이며 워셔액·타이어·충전구 화면의 부품 선택 링크에서도 선택한다. 공통 checklist profiles/result/flow/page와 InspectionCamera를 재사용한다. 별도 카메라 엔진·객체 인식·3D 공간 추적을 만들지 않는다. 보닛 내부 배치도와 실제 리저버 표기를 대조하도록 안내하며 차종·연식·운전석 방향의 차이를 명시한다. 현재 차량과 참조 모델의 일치나 정확한 위치를 인증하지 않는다.

주차·전원 꺼짐·보닛 지지·관찰 환경을 사용자가 확인한 뒤 시작한다. 리저버 옆면의 액면 표시, 주변 누출 의심 흔적, 리저버·캡 외관의 세 응답을 각각 기록한다. 위치나 표시를 읽을 수 없으면 UNABLE을 직접 고른다. 캡 개방·직접 보충·분해·접촉을 안내하지 않는다. 이상 징후 발견 또는 사용자 관찰 중단은 카메라를 정리하며 미응답을 채우지 않는다. 모든 항목의 검토·수정과 명시적 확정 후에만 완료된다. 결과는 제동 성능·안전·주행 가능 판정이 아니다.

[현대 IONIQ 5 공식 설명서](https://www.hyundai.com/content/dam/hyundai/in/en/data/connect-to-service/owners-manual/new/ioniq5oct2022-present.pdf)의 BRAKE FLUID, 인쇄 10-13/PDF 519쪽은 리저버 옆면 액면 표시와 이상 시 서비스 확인의 근거다. [공식 웹 설명서](https://ownersmanual.hyundai.com/full_webhelp/NE1a/2026/en_US/idd8698816963.html)에서도 확인했다. 원문의 보충 절차는 이 모바일 흐름에 포함하지 않았다. 외부 관찰·비접촉·무분해와 UNABLE 정책은 CarScope의 제한이며, 해당 문서가 모바일 검사를 승인하거나 현재 차량 위치를 보증한다는 의미는 아니다.

schema v2와 Node Sync 상세는 [결과 계약](contracts/brake-fluid-mobile-result-v2.md). Sync 변경은 protocol의 정확한 task/validator 등록, debug-only 모듈 제공, Node receiver 항목 표시와 테스트로 한정한다. 인증·TLS·영수증·저장/만료 정책을 바꾸지 않았다. 워셔액 schema v1, 네 타이어와 충전구 schema v2를 보존한다. app/**, Android Native, 3D Geometry, AVD, SDK·STALE 정책은 변경하지 않았다.

공통 관찰 중단 정책을 충전 중 아님 확인과 분리해 브레이크액에서도 사용한다. 충전구의 이중 확인과 중단 동작은 그대로다. 긴 브레이크액 항목명이 모바일 결과 요약을 가로로 넘쳐 Sync 확정 버튼의 포인터 위치를 방해하는 문제를 브라우저에서 재현했다. checklist 요약의 두 열을 가용 너비 안에서 줄바꿈하도록 수정하고 실제 클릭과 가로 넘침 검사를 추가했다. 강제 클릭으로 우회하지 않았다.

## 검증

실행 결과와 원본 위치는 [증거 인덱스](evidence/p5-a3/README.md)를 따른다. 합성 Chrome/Edge·Node 결과이며 실제 스마트폰 카메라·차량·Android 수신 성공이 아니다.

환경: Windows, Node 22.16.0, Edge 156.0.4314.58, Chrome 156.0.8078.80. 아래는 이번 작업의 새 실행 결과다. CI는 별도로 PR HEAD에서 확인한다.

| Gate | 상태 | 명령·관찰·범위 |
|---|---|---|
| 모바일 syntax | PASS | `npm run check --prefix tools/mobile-ar-poc` |
| 모바일 단위·staging | PASS | `npm test --prefix tools/mobile-ar-poc`, 57/57. 새 브레이크액 9개 포함, staging public 파일 동일성·CSP·기존 작업 회귀 |
| Sync 전체 | PASS 합성 | `npm run verify:local --prefix tools/inspection-sync-poc`, check / 전체 101/101. 새 브레이크액 HTTP E2E 6개 포함 |
| Sync legacy·SQLite·AR-01 wrapper | PASS 합성 | 같은 wrapper: 48/48, 21/21, 57/57. 중복 실행이므로 전체 수에 합산하지 않음 |
| 모바일 브라우저 | PASS 합성 | `npm run test:browser --prefix tools/mobile-ar-poc`: 워셔액 Edge 16 / 타이어 Chrome 7 / 충전구 Chrome 6 / 브레이크액 Chrome 6 검사 그룹 |
| 브레이크액 화면 | PASS 합성·육안 | 390×844/844×390, 수동 2D 위치·회전 초기화·stop/restart·가상 background/pause·권한 거부·지연 권한·취소·검토 수정·중복 입력·FOUND 중단·모든 UNABLE·QR v2/명시 전송/Node 수락. 카메라·가로 화면·결과 캡처를 직접 확인 |
| Sync debug·모바일 통합 브라우저 | PASS 합성 | `npm run test:browser --prefix tools/inspection-sync-poc` 11 / `npm run test:mobile-browser --prefix tools/inspection-sync-poc` 19 검사 그룹. SQLite 재시작·영수증·오류·토큰 회귀 |
| Core JVM | PASS (1 skip) | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 38 tests, 37 실행 성공, 실패/오류 0, IONIQ5_PARTS 미설정인 기존 외부 자산 검사 1 skip |
| diff·작업 범위 | PASS | `git diff --check`, 모바일·최소 Sync·문서만 변경. 자산/자격정보/원본 캡처 미포함 |
| 실제 폰·카메라·OS 권한/회전/백그라운드·실차 | NOT_RUN | 합성 canvas stream과 이벤트 주입으로 대체했다고 주장하지 않음 |
| 브레이크액 Android Native Sync | NOT_RUN / 후속 필요 | 이번 구현 없음. Node ACCEPTED는 Native 수신/수락이 아님 |
| Android 빌드·AVD·Geometry audit | NOT_RUN | 요청 범위 밖이며 파일·자산 변경 없음. core JVM 결과와 구분 |

초기 실패: Windows 파이프의 기본 인코딩으로 새 한글 문자열이 손실돼 테스트가 실패했고 UTF-8로 고친 뒤 재실행했다. 브레이크액 browser run01/run02는 앞의 요약 가로 넘침 때문에 Sync review 클릭이 실패했다. run03은 CSS 수정 후 모든 모바일 브라우저를 새로 실행해 PASS했다. 실패 원본을 덮어쓰거나 성공 결과에 합산하지 않았다.

## 재실행

저장소 루트 PowerShell:

```powershell
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm run check --prefix tools/mobile-ar-poc
npm test --prefix tools/mobile-ar-poc
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a3/YOUR-NEW-RUN/mobile'
npm run test:browser --prefix tools/mobile-ar-poc
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a3/YOUR-NEW-RUN/sync'
npm run verify:local --prefix tools/inspection-sync-poc
npm run test:browser --prefix tools/inspection-sync-poc
npm run test:mobile-browser --prefix tools/inspection-sync-poc
```

브레이크액만 실행하려면 `npm run test:browser:brake --prefix tools/mobile-ar-poc`를 쓴다. 직접 화면은 `npm run serve --prefix tools/mobile-ar-poc` 후 `http://127.0.0.1:4174/#task=brake-fluid`이다.

Node 연결은 기존 로컬 테스트 전용 `SYNC_LOCAL_TEST_AUTH=1`과 `npm run serve:mobile-dev --prefix tools/inspection-sync-poc`를 사용한다. 다른 터미널에서 `npm run receiver --prefix tools/inspection-sync-poc -- --server=http://127.0.0.1:4182 --mobile-base=http://127.0.0.1:4182/ --task=brake-fluid`로 초대하고, 모바일에서 연결·점검·결과 전송 후 Node에서 검토하고 명시적으로 수락한다. 토큰을 로그·문서에 복사하지 않는다. 공개 서버의 인증 정책을 바꾸지 않는다.

실제 폰 후속에는 신뢰하는 HTTPS·기기/OS/브라우저·실제 후면 카메라를 기록한다. 올바른 차량 사용설명서와 위치를 확인하고 외부 관찰만으로 세 항목·가려짐/불확실 UNABLE·권한 거부·회전·백그라운드/복귀·수동 대체를 검증한다. Native 브레이크액 수신은 별도 구현 후 동일 digest/명시적 수락까지 두 기기 E2E로 검증한다.
