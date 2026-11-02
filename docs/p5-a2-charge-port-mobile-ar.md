# P5-A2 · EV 충전구 모바일 카메라 보조 점검

2026-11-03 KST. **웹/Node 합성 범위 READY_FOR_REVIEW**. 실제 스마트폰 카메라와 두 기기 E2E는 NOT_RUN, 충전구 Native 수신은 BLOCKED인 후속 작업이다. 객체 인식·공간 추적·정밀 측정·안전/충전 가능 판정은 구현하지 않았다.

## 기준과 조사

- `git fetch origin`으로 실제 `origin/main = 0a054ca1685cbe198247c278ab831d6eb4d614e1`, PR #52 MERGED를 확인했다.
- 기존 사본 `C:\dev\CarScope-p3i4-avd`는 clean, `test/p3-i4-avd-integration / a42444d`. 해당 파일은 변경하지 않았다.
- 독립 worktree `C:\dev\CarScope-charge-mobile-ar`, 브랜치 `feat/p5-a2-charge-port-mobile-ar`를 위 main에서 생성하고 시작 시 clean을 확인했다. origin은 `https://github.com/ppsssj/CarScope.git`.
- 열린 PR #51(Draft), #41(Draft), #12, #2를 확인했다. #51 브랜치/worktree를 가져오거나 변경하지 않았다. `app/**`, `vehicle-core/**`, `tools/three-poc/**`, `tools/ioniq5-asset/**`, 외부 GLB/AVD/adb는 수정·조작하지 않았다.
- PR 생성 전 다시 확인한 #51은 Ready 상태이며 변경 파일이 이번 모바일/Sync/문서와 겹치지 않았다. 해당 상태를 변경하지 않았다.
- 모바일 tasks/camera/ui/tire page/flow/result/app/marker, Sync protocol/entry/client/mobile-sync, 기존 타이어 및 Sync 계약을 조사했다. 차량 충전구 두 문서와 `inspection-flow.mjs`, `ev-charge-status.mjs`는 읽기만 했다.
- 차량 SDK `ev-charge.port-open` Boolean 보고는 USER_REPORTED 외관 기록과 다르다. 개방 보고가 충전 중/안전/고전압 정상/모델 일치의 증거가 아니다. 이번 모바일 코드는 SDK를 호출하지 않는다.

## 구현과 안전

작업은 `ev-charge.port` 한 개이며 덮개도 포함한다. `ev-charge.flap`은 독립 모바일 작업으로 등록하지 않는다. 참조 커뮤니티 IONIQ 5의 우측 후방 위치를 소개하되 현재 실제 차량과 프로필 일치가 확인되지 않았음을 명시하고 해당 사용설명서 확인을 안내한다.

흐름: 부품·위치·한계 안내 → **주차 확인 + 충전 중이 아님 별도 확인** → 카메라/수동 → 외관 세 항목 → 전체 검토/Back 수정 → 명시적 확정 → 별도 명시적 Node 전송 → Node 수신기 명시적 수락. 확인 둘 중 하나라도 없으면 시작할 수 없다. 카메라 권한 거부·미지원 시 수동 점검이 가능하다.

| 응답 키 | 항목 |
|---|---|
| `flapDamage` | 덮개와 주변 외관의 손상 |
| `debris` | 외부에서 보이는 이물질·오염 |
| `visibleDamage` | 접근 없이 보이는 변형·변색 등 징후 |

한 화면에 한 항목씩 `FOUND / NOT_FOUND / UNABLE`을 직접 선택한다. 미응답은 자동 채우지 않으며 다음 단계로 진행하지 않는다. 모두 검토한 후 확정한다. 상태는 FOUND 우선 REVIEW_NEEDED, 그 외 UNABLE 우선, 모두 NOT_FOUND일 때 NO_FINDINGS_REPORTED다. 어느 상태도 안전·정상 인증이 아니다.

충전구 프로필에서 FOUND를 기록하면 카메라 관찰을 즉시 중지하고 수동 기록으로 바꾼다. 사용자의 ‘접근·관찰 중단’ 동작도 제공한다. 추가로 접근하지 않고 이미 본 내용과 나머지 확인 불가를 **개별적으로** 기록하도록 안내한다. 응답을 수정해도 관찰 중단 latch는 새 점검 전까지 유지한다. 의심되는 열을 손으로 확인하거나 단자 내부 접촉·도구/액체/손가락 청소·강제 탈착·분해·수리를 안내하지 않는다. 파손·변색·이상 발열 징후는 제조사 서비스로 연결하는 안내를 제공한다.

카메라는 기존 `InspectionCamera`, `CameraSession`, marker/contain 좌표를 재사용한다. 점선 사각형과 단계별 라벨은 수동 안내 그림이다. 탭 위치는 정규화한 2D 영상 좌표이며 3D 앵커가 아니다. 회전/크기·영상 해상도/단계 변경 시 위치 해제, 중지·pause·영상 오류/중단·frame stall·페이지 이탈/화면 숨김 시 세션 정리, 늦은 권한 응답 무효화 규칙을 공유한다. 카메라 재개는 사용자 동작으로 한다. 실제 기기 이동 자체를 탐지하지 않는다.

### 공식 안전 자료 대조

[Hyundai USA 2022 IONIQ 5 공식 사용설명서](https://sweb2-owners.hyundaiusa.com/content/dam/hyundai/us/myhyundai/manuals/glovebox-manual/2022/ioniq5/2022-Ioniq-5-Owners-Manual.pdf)의 검색 색인 제공 본문 **1-18(V2L 경고)** 및 **1-48(휴대용 충전기 주의)**를 확인했다. PDF 전체 직접 fetch는 timeout이었으며 전체 페이지/전 시장·연식을 검토했다고 주장하지 않는다.

1-18의 단자 접촉·금속 물체 삽입·오염/수분 및 손상 관련 경고, 1-48의 AC 단자 접촉·분해 금지와 과열/타는 냄새 시 사용 중단 안내에 맞춰 **관찰만 하는 UI**로 제한했다. 충전 중 시작 금지, 강제 탈착/액체·손가락 청소 금지, FOUND 시 추가 관찰 중단은 사용자가 요구한 CarScope의 보수적 범위 제한이다. 원문이 모바일 검사를 승인하거나 모델 위치·충전 가능을 보증한다는 의미가 아니다. 실제 차량 사용설명서가 우선이다.

## 공통화와 보존 범위

| 모듈 | 책임 |
|---|---|
| `checklist-result.mjs` | schema v2 공통 strict 검증·불변 결과·응답 enum·집계. 정확한 task/항목 키는 프로필별 고정 |
| `checklist-flow.mjs` | DOM 없는 전이, 부분 완료/중복 NEXT·확정/이전 시도 차단. 추가 안전 정책은 충전구에서만 opt-in |
| `checklist-profiles.mjs` | 부품명·위치·설명·안전 문구·질문·오버레이·validator/flow 등록 |
| `checklist-page.mjs` | 공통 카메라/수동/항목/검토/확정 화면, 접근성 label/fieldset/focus, 기존 Sync callbacks |
| `charge-result.mjs` | 충전구 task와 세 개의 정확한 응답 키 |
| `inspection-tasks.mjs` | 정확한 task hint/링크/label. QR v1 parser는 변경하지 않음 |
| 기존 Camera/Overlay/UI | 카메라 엔진·2D 좌표·요약 렌더러/입력 gate 재사용. 별도 카메라 엔진 없음 |

타이어의 기존 export·작업 ID·schema v2·응답 키·상태 전이는 보존하고 공통 구현에 위임한다. 기존 tire-page adapter도 tire-only 입력을 유지한다. 워셔액 상태 머신/schema v1·파란색 휴리스틱은 이관하거나 변경하지 않았다. 브레이크액/와이퍼/조명 작업은 활성화하지 않았다. 후속 브레이크액은 안전 근거·질문·validator·프로필·테스트를 추가하여 공통 모듈을 재사용할 수 있으나 이번 PR에서 해당 안전 절차를 정의하지 않는다.

모바일 기록·토큰은 메모리 전용이며 refresh/종료 시 복구하지 않는다. 영구 이력·삭제·재진입 보존 정책은 후속 과제로 남긴다. 명시적으로 전송한 결과의 서버 저장은 기존 TTL/store 그대로다. 영상·사진·GPS·VIN·탭 좌표·SDK 원시 값은 결과/저장/로깅에 추가하지 않았다.

## 최소 Sync 확장

- `src/protocol.mjs`: ev-charge.port supported task 및 엄격한 validator 분기만 추가. QR v2/protocolVersion 1·Digest·영수증 계약 유지.
- `src/server.mjs`: 기존 debug 페이지의 protocol import를 위해 `checklist-result.mjs`, `charge-result.mjs` 두 파일을 명시적 debug-only 목록에 추가. HTTP API·인증·TLS·세션 저장·만료·역할 권한 변경 없음.
- `bin/receiver.mjs`: 정확한 부품명과 schema v2 개별 응답 표시, `--task=ev-charge.port` 옵션(기존 washer 기본값 유지). 기존 명시적 수락 재사용.
- 기존 `mobile-dev-entry`, `MobileSync`, `SyncClient`는 P5-A1의 기대 task 전달·일치 검증·영수증 로직 그대로 사용했다. 서버를 재작성하거나 새로 만들지 않았다.

[충전구 결과 JSON·Kotlin 후속 모델·QR/Digest·디코더 계약](contracts/charge-port-mobile-result-v2.md). Native는 현재 main에서 워셔액/schema v1 고정이다. 이번 성공 범위는 Node 수신기 합성 E2E이며 실제 Android 수신이 아니다.

## 검증 결과

Windows / Node 22.16.0 / Edge 156.0.4314.58 / Chrome 156.0.8078.79. [외부 증거 인덱스](evidence/p5-a2/README.md). CI는 PR 해당 HEAD의 별도 결과다.

| 범위 | 결과 | 근거 |
|---|---|---|
| 모바일 syntax / 단위 | PASS | 기존 명령 check, 47/47 (기존 40 + 충전구 7) |
| Sync 전체 | PASS 합성 | 95/95 (기존 89 + 충전구 6), Node HTTP E2E 포함 |
| Sync legacy / SQLite / AR-01 wrapper | PASS 합성 | 48/48 / 21/21 / 47/47. 중복 실행이며 전체 수에 합산하지 않음 |
| 워셔액 Edge / 네 타이어 Chrome | PASS 합성 | 기존 16 / 7 검사 그룹 그대로 실행 |
| 충전구 Chrome | PASS 합성 | 6 검사 그룹, 390×844/844×390, 수동·권한 거부·회전·재시작·가상 background/pause·부분/수정/취소/새 시도·중복 입력·관찰 중단·Node 수락 |
| 기존 Sync debug / 워셔액 v2 통합 Edge | PASS 합성 | 11 / 19 검사 그룹, 기존 보안·영수증·SQLite·레이스 회귀 |
| 실제 폰 카메라/권한 UI/OS 회전·백그라운드 | NOT_RUN | canvas.captureStream/주입 오류·이벤트는 실제 폰을 대체하지 않음 |
| 충전구·타이어 Android Native Sync | BLOCKED | strict schema v2 수신 후속 구현 필요, 이번 app 수정 없음 |
| AVD/adb/실차/로컬 Android 빌드·JVM | NOT_RUN | 이번 작업에서 실행하지 않음. 기존 GitHub CI의 검증 범위와 구분 |

새 하네스 초기 실패도 기록했다. 최초 제출 응답을 200/전체 응답 동일로 가정한 검사는 기존 201/200 및 duplicate 플래그와 동일 영수증을 정확히 검증하도록 고쳤다. pause는 비동기 이벤트 완료 후 스트림 정리를 확인한다. 동일 fragment로의 재탐색은 페이지 초기화를 의미하지 않아 새 시도 fixture에 명시적 reload를 추가했다. 기존 검사 삭제/완화나 제품의 성공 조건 변경은 없다.

| 부품 | 모바일 점검 | 카메라 안내 | Node Sync | Android Native Sync | 실기기 |
|---|---|---|---|---|---|
| 워셔액 | PASS 회귀 | PASS 합성 | PASS 합성 | 기존 구현, 이번 NOT_RUN | 이번 NOT_RUN; 이전 사용자 관측과 분리 |
| 타이어 4개 | PASS 회귀 | PASS 합성 | PASS 합성 | BLOCKED schema v2 후속 | NOT_RUN |
| EV 충전구 | 구현/PASS 합성 | PASS 합성 | PASS 합성 | BLOCKED 후속 계약 | NOT_RUN |

## 재실행 및 실제 폰 후속

저장소 루트 PowerShell, 실행마다 새 외부 증거 경로를 사용한다.

```powershell
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm run check --prefix tools/mobile-ar-poc
npm test --prefix tools/mobile-ar-poc
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a2/YOUR-NEW-RUN/mobile'
npm run test:browser --prefix tools/mobile-ar-poc
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a2/YOUR-NEW-RUN/sync'
npm run verify:local --prefix tools/inspection-sync-poc
npm run test:browser --prefix tools/inspection-sync-poc
npm run test:mobile-browser --prefix tools/inspection-sync-poc
```

충전구만 검증하려면 `npm run test:browser:charge --prefix tools/mobile-ar-poc`를 실행한다.

직접 점검 화면은 `npm run serve --prefix tools/mobile-ar-poc` 후 `http://127.0.0.1:4174/#task=ev-charge.port`. 루트와 타이어의 부품 선택 링크에서도 진입한다. 실제 폰은 기존 HTTPS runbook에 따라 폰이 신뢰하는 HTTPS/접근 가능한 주소가 필요하다. PC localhost나 LAN HTTP를 폰 카메라 성공 근거로 사용하지 않는다. 기존 static staging에도 공통 모듈과 충전구가 포함되며 staging의 기본 QR은 계속 washer v1이다.

Node 합성 연결을 직접 볼 때는 기존 `serve:mobile-dev`의 **명시적 로컬 테스트 설정**을 사용하고 `npm run receiver --prefix tools/inspection-sync-poc -- --server=http://127.0.0.1:4182 --mobile-base=http://127.0.0.1:4182/ --task=ev-charge.port`로 생성한다. 별도 터미널에 `SYNC_LOCAL_TEST_AUTH=1`을 설정해 `npm run serve:mobile-dev --prefix tools/inspection-sync-poc`를 실행하는 기존 방식이다. 테스트 서버만 loopback으로 사용하며 실제 인증/공개 서비스 설정을 자동 변경하지 않는다. QR 토큰은 공유/로그에 복사하지 않는다. 수신기에서 결과를 직접 검토하고 수락한다.

실제 폰 후속: 폰/OS/브라우저/HTTPS 신뢰/실제 후면 카메라를 기록한다. 정차·충전 중 아님을 실제 확인하고 정확한 차량 사용설명서로 위치를 확인한다. 비접촉·무분해 관찰 범위에서 세 응답/수정/확정, 권한 거부, 실제 회전·잠금/복귀·영상 종료와 수동 대체를 검사한다. Native 구현 후 정확한 작업 초대·동일 Digest·명시적 수락까지 두 기기 E2E로 별도 기록한다. 기기/실차 미검증을 합성 PASS로 대체하지 않는다.
