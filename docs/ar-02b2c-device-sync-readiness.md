# AR-02B-2C — Native 진입과 기기 Sync 실행 준비

2026-11-02 KST. PR #37 merge `c89b6e4` 기준. 이 단계는 Debug 화면 연결과 실행 절차 준비다. 실제 차량 인증, 스마트폰↔Android HTTPS 동기화 성공을 의미하지 않는다. PR #37의 transport/decoder/QR/기본 거부 정책을 유지한다.

## Native 진입 및 상태 UX

`lab/InspectionActivity.kt`에 Native `InspectionSyncEntry`를 연결했다. 워셔액 전용 버튼과 기존 WebView를 세로 sibling으로 배치한다. 버튼은 explicit Intent로 SyncReceiverActivity를 열며 extras/data/auth 정보가 없다. 연속 클릭 잠금과 SINGLE_TOP으로 중복 실행을 방지한다. Android Back은 기존 InspectionActivity로 돌아온다. pause에서 버튼을 잠그고 resume에서 다시 활성화한다.

InspectionActivity의 기존 Tire lease start/stop 및 WebView resume/pause/destroy 호출 순서는 유지한다. DebugWebScreen, JavaScript interface, CSP, origin, navigation policy, Three.js, Tire SDK/Controller, AR-01 schema와 서버 API는 변경하지 않는다. Receiver 진입은 WebView 명령이나 타이어 동기화 기능이 아니다.

| Receiver 표시 | 의미 |
| --- | --- |
| 연결 설정 미완료 | private endpoint 파일이 없거나 HTTPS origin 검증 실패 |
| HTTPS 서비스 확인 중 | 기존 checkConnection 진행, 생성/차량 인증 성공 아님 |
| HTTPS 응답 확인 | 플랫폼 CA/hostname 및 API 401 계약 확인, 차량 인증과 별개 |
| 실제 차량 인증 미구현 | 기본 생성 credential 없음, 생성 차단 유지 |
| WAITING + QR | 초대 유효, 사용자 점검 대기 |
| WAITING + QR 초대 만료 | QR 제거, 새 스캔 불가. 이미 Claim한 점검은 계속 대기 가능 |
| RESULT_SUBMITTED | 검증된 사용자 보고 결과, 차량 측 명시적 수락 전 |
| ACCEPTED / CANCELLED / EXPIRED | 서버 처리 결과를 각각 구분 |
| NETWORK / TIMEOUT / INVALID | 연결/응답 시간 초과/응답·Digest 검증 실패. 수락 또는 취소 성공으로 표시하지 않음 |

초대 만료는 session 만료와 구분한다. 새 QR이 필요하면 명시적 Cancel 후 새 요청이 필요하다. 토큰 재발급/재노출은 없다. onStop에서 credential 참조, QR bitmap, polling/요청을 폐기하고 generation으로 이전 callback을 무효화한다. pause만으로 원격 취소나 세션 만료를 주장하지 않는다. Activity 종료 후 orphan session은 기존 서버 만료·보존 정책에 의존한다.

## 읽기 전용 사전 점검

`tools/inspection-sync-poc/android/device-readiness.py`는 기존 Tire health gate의 **정확한 대상 확인 원칙**을 따른 별도 Sync 도구다. Tire 도구 import, SDK 접근/변경, Activity 실행, install/reboot/kill/reverse/CA 설치를 하지 않는다. 자동 장치 선택도 없다.

```powershell
python tools/inspection-sync-poc/android/test-device-readiness.py
adb devices -l
# devices에 표시된 실제 대상 serial을 사람이 확인한 후 명시한다.
python tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial emulator-5554 --report C:/CarScope-External/ar-02b2c/run/readiness.json
# 검토한 HTTPS API origin이 있을 때만 선택적으로 host probe를 수행한다.
# --api-origin https://<검증한-host>/ --probe-host
```

도구는 serial 연결 확인 후 emu avd name이 CarScope_Pleos_API34인지 먼저 검사한다. 그 다음 boot/API/Android 버전, SystemUI PID, WebView provider, 현재 사용자별 Vehicle Service version/enabled 상태를 읽는다. 원본 dumpsys/logcat이나 payload를 보고서에 넣지 않는다. 이 PASS는 **읽기 전용 시점 inventory**이고, 장시간 SystemUI 안정성·SDK 연동·Runtime readiness 통과가 아니다. 실제 실행 전 RAM/저장 공간 여유, SystemUI 지속 안정성, 다른 Codex의 현재 실행 세션도 따로 확인한다. 부하가 높거나 기존 세션을 침범하면 중단한다.

| 관측 위치 | 확인할 항목 | 이 단계의 한계 |
| --- | --- | --- |
| Host | SDK 도구, 명시한 serial, APK/AAB 격리, 승인된 API/mobile origin, DNS/체인/SAN/유효기간 | optional host probe는 시스템 CA/hostname 검증한 GET만. Android/폰 신뢰를 보증하지 않음 |
| Android | 실제 AVD 이름, boot/API/WebView/SystemUI/Vehicle Service, native checkConnection, 네트워크 경로와 trust | 연결 장치 없으면 BLOCKED. PC 127.0.0.1은 Android 자신과 다름 |
| Phone | mobile HTTPS 주소 도달성, CA/SAN/보호 정책, 카메라 QR, 동일 origin API/CSP | Host나 Node TLS PASS로 대신할 수 없음 |
| Auth | Android credential provider와 서버 verifier의 실제 연동/수명/scope/폐기 | 현재 양쪽 기본 거부: BLOCKED |

host probe는 명시적 opt-in이며 credential 없이 고정 dummy session GET을 보낸다. redirect를 따라가지 않고 HTTP cleartext를 받지 않는다. 결과는 HOST_TLS_AND_API_ONLY로 표시한다. AndroidHttps/phoneHttps/creationAuthorization/twoDeviceE2E는 이 보고서에서 자동 PASS로 바뀌지 않는다. JSON은 저장소 밖 경로에만 기록한다. endpoint 인자에 userinfo/token/query/fragment/path를 허용하지 않는다.

## 두 기기 E2E 수동 절차

**진입 조건:** 승인된 실행 시간/장치, 다른 Codex의 세션을 덮어쓰지 않는 조건, 기존 Health Gate, 서명·격리 검증한 Debug APK, Android/폰 각각의 CA·hostname·네트워크 검증, 인증된 제한 테스트 서비스, Android 생성 credential 공급자, server verifier가 모두 필요하다. 현재 일반 Debug APK는 DenyByDefault이므로 4단계에서 진행할 수 없다. 불충족 단계를 NOT_RUN/BLOCKED로 기록하고 우회하지 않는다.

| 단계 | 조작/검증 | 토큰 없는 근거 |
| --- | --- | --- |
| 1 | 기존 앱/3D 점검 화면이 정상이며 다른 실행을 침범하지 않는지 확인 | 장치 alias, APK commit, 시각, 기존 화면 상태 |
| 2 | Native 워셔액 수신 버튼 → Receiver, Back → Inspection, 다시 진입 | 화면 이름·전환 횟수, 3D 복귀 및 lease pause/resume 별도 관측 |
| 3 | 검토한 private HTTPS endpoint 설정과 서비스 연결 확인 | API/mobile origin, CA chain/SAN/기간 검토, Android HTTPS 응답 상태. 토큰/개인키 없음 |
| 4 | 실제 제한된 생성 권한 공급자/서버 verifier로 생성 | 인증 방식·scope/만료 검증 결과 boolean, 거부 시 BLOCKED. credential 원문 없음 |
| 5 | QR v2와 두 만료 시각 확인 | QR 표시 여부/기한, receiver token 미포함 검사 결과. QR screenshot 원본 공개 금지 |
| 6 | 폰 카메라 광학 스캔, fragment 즉시 제거 | 폰 OS/browser, 신뢰 TLS와 URL에서 토큰 제거 여부 boolean |
| 7 | AR-01 워셔액 점검 수행 | UI 단계, 사용자 확인 항목; 센서 진단으로 기록하지 않음 |
| 8 | 완료 결과를 사용자 확정 | COMPLETED/schema v1/SELF/USER_REPORTED 확인, 개인정보·미디어 없음 |
| 9 | 사용자가 결과 전송 | 전송 요청 1회, Receipt id/Digest 일치 boolean, SENT이며 수락 전 |
| 10 | Android polling 결과 조회 | RESULT_SUBMITTED, 보고 상태/완료 시각, decoder/Digest 검증 결과 |
| 11 | 차량 화면에서 명시적 수락 | 표시한 Digest 검증 후 Accept 1회, 서버 ACCEPTED 확인. 실제 차량 상태 정상 판정 아님 |
| 12 | 폰 polling ACCEPTED 확인 | 같은 결과 Receipt/최종 상태 일치, 시각. 두 기기 화면을 합성 결과와 구분 |

실기기 로그는 최소한의 phase/error enum/시간/요청 횟수/검증 boolean만 수집한다. Authorization header, token, fragment, QR 원문, 개인키, raw HTTP body를 로그로 남기지 않는다. 이미지가 필요하면 초대가 유효한 QR 영역과 주소를 마스킹하고 저장소 외부 evidence에 보관한다. digest/record 검증은 decoder와 Client가 수행하며 UI에서 raw token이나 body를 출력해 확인하지 않는다.

### 실패 시나리오

| 상황 | 기대 처리/필요 근거 |
| --- | --- |
| QR 만료 | QR 제거·새 스캔 차단, 이미 Claim한 세션과 구분; 두 expiry와 phase |
| 연결 종료/페이지 reload | 성공 복구 추정 금지, 새 QR 안내; token storage 없음 |
| 네트워크 단절/timeout | NETWORK/TIMEOUT, 수락 성공 금지; 에러 enum/재시도 횟수 |
| Claim 응답 유실 | 재Claim/초대 재발급 금지, 새 QR; Claim 요청 횟수 |
| submit 응답 유실/중복 전송 | 동일 완료 record의 제한 재시도, Receipt 일치; 전송 횟수/검증 boolean |
| Cancel | 명시적 요청 및 서버 응답 후 CANCELLED. 실패하면 취소 성공 표시 금지 |
| Accept 응답 유실 | ACCEPTED 추정 금지, 서버 상태 재조회로만 확인 |
| Digest 불일치/손상 응답 | INVALID, 수락 버튼 차단; mismatch boolean. 실제 서비스에 손상 데이터 주입 금지, fixture로 검증 |
| 다른 점검 결과 재사용 | 기존 Receipt 재사용 금지, 409 CONFLICT, schema/washer task 검사 |
| Activity 종료/재생성 | QR/credential 폐기, 이전 callback 무효화, 새 IDLE. 원격 Cancel 성공 추정 금지 |

네트워크 중단/응답 유실/손상 주입 자동화는 기존 Node·JVM·브라우저 fixture로만 수행한다. 공개 서버나 다른 개발자의 서버를 변경/종료하지 않는다. 실제 두 기기 실패 시험은 승인된 격리 서비스에서 별도 실행한다.

## 인증된 테스트 서비스를 위한 승인 가능한 대안

현재 loopback Fake authorizer를 LAN/인터넷에 노출해 두 기기 성공으로 만들 수 없다. mobile-dev-server도 loopback 전용이며 기존 Vercel 정적 페이지가 v2 API를 제공하지 않는다. 이 경계를 변경하지 않았다.

후속 제안은 별도 검토·승인 후, 제한된 네트워크의 HTTPS API + same-origin v2 모바일 자산, 각 기기가 기본 신뢰하는 검증된 인증서, 단기·단일 목적 credential과 verifier/폐기 정책, APK 밖의 안전한 provision 설계를 갖추는 것이다. 현재 credential provider 추가/서버 authorizer 구현은 별도 인증 과제다. 시험 앱 인증과 실제 차량 소유권 인증은 서로 구분해야 한다. Intent/URL 토큰 주입, fixed key, 일반 Debug APK의 test credential, trust-all 또는 Android 전체 CA 설치로 대체하지 않는다. 그 전에는 기존 loopback Node/JVM/브라우저 합성 검증까지만 PASS로 인정한다.

## 검증 결과

새 실행 명령·결과, 기존 110개 회귀와 추가 테스트, 중간 실패, CI, 실제 실행하지 못한 항목은 [evidence index](evidence/ar-02b2c/README.md)에 기록한다. 본 PR은 앱 화면 연결과 실행 준비 완료를 목표로 하며 실제 두 기기 동기화는 계속 BLOCKED다.
