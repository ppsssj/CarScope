# P9-I1 — 차량 앱 ↔ 모바일 웹 ↔ Render/Supabase 흐름

운영자가 승인한 Pleos AVD 시뮬레이션 전용이다. **실제 차량 인증이나 소유권 확인이 아니며**, Release에는 이 경로가 없다.

## 연결된 흐름

| 단계 | 동작 | 코드 |
|---|---|---|
| 1 | Launcher의 `CarScope 차량 점검 (debug)` | Debug `AndroidManifest.xml`, `InspectionActivity` |
| 2~3 | 부품 선택 → `모바일로 점검하기` | `inspection-results-view.mjs`, `native-inspection-results.mjs` |
| 4 | 같은 부품 패널에서 grant를 받아 세션을 만든다 | `NativeInspectionBridge`, `SyncReceiverActivity.createWhenAuthorized` |
| 5 | 부품 패널의 빈 자리에 Native가 QR을 그린다. 상태: 권한 확인 → QR 생성 중 → QR 스캔 → 스마트폰 연결됨 → 결과 수신 / 만료 | `InspectionActivity`, `inspection-results-view.mjs` |
| 6~8 | 스캔 → 해당 부품 페이지 → 자동 연결 → 점검 | `mobile-dev-entry.mjs`, `mobile-handoff.mjs` |
| 9 | `결과 전송`. 서버 영수증을 확인해야 전송 완료로 표시한다 | `mobile-sync.mjs`, `sync-client.mjs` |
| 10~11 | 차량 폴링으로 결과 수신 → 같은 digest를 자동 수신 확인(시뮬레이터 한정) → 부품 패널에 표시 | `SyncReceiverController`, `native-inspection-results.mjs` |
| 12 | 수락과 같은 트랜잭션에서 `cs_inspection_records`에 저장 (`AVD_SIMULATOR`) | `postgres-store.mjs` |
| 13 | 차량 `ACCEPTED`, 모바일 폴링으로 완료 표시, 3D에서 기록 선택 | `SyncReceiverActivity`, `mobile-sync.mjs` |

직접 URL로 접속하면 fragment가 없으므로 기존 셀프 점검이 그대로 동작한다.

## 이번에 바꾼 규칙

- **세션 생성:** 3D의 `모바일로 점검하기` 한 번이 세션을 만든다. 이전에는 패널에서 `점검 요청 생성`을 한 번 더 눌렀다. 패널이 보일 때만 만들고, 같은 요청을 다시 열어도 새로 만들지 않는다. 수락은 계속 Native 버튼으로만 한다. 단독 `SyncReceiverActivity`는 전과 같이 버튼으로 만든다.
- **Grant 시점:** 3D 화면은 시작할 때 grant를 받지 않는다. 2분 뒤 만료되어 나중의 요청이 거부됐기 때문이다. 이제 요청할 때 받고, 패널이 열린 동안 권한이 없으면 30초 간격으로 다시 시도한다(서버 제한 분당 4회). 단독 화면의 시작 시 갱신은 그대로다.

- **QR 위치 (P9-UX):** 페이지는 빈 자리의 좌표만 보내고 Native가 그 위에 비트맵을 그린다. QR과 토큰은 WebView로 넘어가지 않는다. QR이 보이는 동안만 창이 `FLAG_SECURE`다. 기존 Native 패널은 `Debug 관리`에서만 열린다.
- **자동 수신 확인 (P9-UX):** 시뮬레이터 자격으로 동작할 때만, 받은 결과의 digest를 검증하고 같은 digest로 서버 수락을 호출한다. 3회 실패하면 멈추고 `다시 확인`을 기다린다. proof에는 `AVD_SIMULATION_AUTO`가 남고 화면에는 "차량 소유자 승인 아님"으로 표시한다. 다른 자격에서는 Native 버튼의 수락을 계속 요구한다.
- **표시 기록 (P9-UX):** 가장 최근의 유효한 모바일 결과를 표시한다. 다른 기록은 `이전 기록`에서 고른다.
- **모바일 연결 (P9-UX):** 보이는 페이지에서만 자동으로 연결한다. 초대의 일회용 제한은 서버가 그대로 적용한다.

인증, TLS, 서버 API, 스키마는 바꾸지 않았다.

## 운영자 절차

순서대로 실행하며, 각 단계는 [P9 승인 게이트](p9-e2e-checklist.md#승인-게이트)를 따른다.

1. **Render (G5):** `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`를 추가하고 재배포한다. 이 PR을 포함한 main이 필요하다. `/healthz`가 `STATEFUL_AVD_SIMULATION`, `OPERATOR_APPROVED_AVD_ONLY`인지 확인한다. 시작할 때 `carscope` 스키마에 `cs_avd_*` 테이블이 만들어진다.
2. **APK (G1):** 이 커밋의 Debug APK를 AVD에 설치한다.
3. **등록 (G6):** 저장소 루트에서 실행한다. `carscope_app`의 Session Pooler URL은 숨김 입력으로 받는다.

   ```powershell
   cd tools\inspection-sync-poc
   npm install --ignore-scripts --no-audit --no-fund --package-lock=false
   .\android\setup-avd-simulator.ps1 -Serial emulator-5554 -CaPemFile C:\CarScope-External\supabase-ca.pem -GlbPath C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb
   ```

   Render가 시뮬레이션 모드가 아니면 아무것도 발급하지 않고 중단한다. proof는 앱 private 파일로만 들어가고 로컬 사본은 지워진다. 기본 유효 시간은 2시간(최대 24시간)이다.
4. **실행 (G7, G8):** 위 표대로 진행한다. 실제 세션과 기록이 운영 DB에 생긴다. 기록 삭제 도구는 없다.
5. **복원 (G9):** `.\android\setup-avd-simulator.ps1 -Serial emulator-5554 -Action Remove`로 등록을 폐기하고 proof를 지운 뒤, Render에서 변수를 제거하고 재배포한다.

상태 확인은 `-Action Status`다. 파일 내용은 읽지 않는다.

## 알려진 한계

- 페이지를 실제로 표시해 초대를 쓰는 미리보기 앱이 있으면 그 앱이 연결을 차지하고, 사용자에게는 새 QR 안내가 나온다.
- 수락된 기록의 소유자는 `AVD_SIMULATOR`이고 `userId`와 `vehicleId`가 없다. 소유자 History 경로는 시뮬레이션 모드에서 계속 거부된다. [P9-H1](p9-h1-inspection-history-read.md)의 등록 범위 조회 채널이 있지만 아직 `inspect.js`에 연결되지 않아, 차량 앱의 부품 패널은 이번 세션의 결과를 표시한다.
- 시뮬레이션 모드가 켜져 있으면 등록된 AVD는 인터넷 어디서든 proof로 세션을 만들 수 있다. proof가 없는 요청은 거부된다.
- 실제 차량(OEM) 인증은 구현되지 않았다.
