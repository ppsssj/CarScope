# AR-02B-2A — Mobile QR v2와 Android Debug Receiver

2026-11-01. PR #33 병합 `6eedb3b`에서 시작했고, 작업 중 main에 병합된 PR #34까지 반영했다
(`95806d8`). 같은 독립 worktree의 `feat/ar-02b2-mobile-receiver` 브랜치에서 작업했다.
외부 인프라·배포·Vercel 설정·운영 인증·차량 제어는 변경하지 않았다.

## 모바일 구성

기존 AR-01 화면, 카메라 모듈, 점검 상태 머신과 불변 schema v1 레코드를 재사용한다.
`public/app.mjs`는 기존 화면을 시작하는 `startInspectionPage` 함수를 제공하며 완료/새 점검 콜백만 추가했다.
카메라·체크리스트·확정 규칙은 변경하지 않았다.

| 진입점 | v1 / 직접 방문 | v2 |
| --- | --- | --- |
| 정적 `app-entry.mjs` (기존 서버/배포 빌드) | 기존 화면·로컬 결과·전송 없음 | 지원하지 않는 QR로 차단, fragment 제거, API 호출 없음 |
| loopback 개발 서버의 `mobile-dev-entry.mjs` | 같은 AR-01 화면, 전송 UI 없음 | strict parser → fragment 소거 → 명시적 연결 → 완료 뒤 명시적 전송 |

v2 개발 기능은 쿼리/브라우저 저장소의 flag로 켜지지 않는다. 개발 서버가 메모리에서 HTML의 진입점만 바꿔 제공한다.
정적 staging allow-list에는 개발 모듈/SyncClient/API 설정이 없다. `vercel.json`은 변경하지 않았다.
기존 `#done-sync`와 완료 레코드를 사용하고 기존 카드·버튼·48px 터치 영역·상태 안내 패턴을 유지한다.
상태 텍스트는 textContent와 aria-live로 제공하며 토큰·오류 body를 DOM에 넣지 않는다.

## 실제 연결 흐름

1. 합성 차량 역할인 기존 Node `ReceiverClient`가 로컬 세션을 만들고 QR v2 fragment를 생성한다.
2. 개발 모바일 페이지가 기존 strict v2 parser로 읽고 history.replaceState로 fragment를 즉시 지운다.
3. 사용자가 ‘차량 요청에 연결’을 누른다. 한 페이지에서 Claim은 한 번만 요청한다.
4. 기존 AR-01 수동/카메라 보조 점검으로 COMPLETED 레코드를 확정한다. 자동 업로드는 없다.
5. ‘결과 전송’은 같은 origin의 SyncClient를 호출한다. 중복 누름은 한 요청으로 처리한다.
6. inspectionId/Digest와 정확한 필드의 Receipt가 맞을 때만 SENT(서버 수신 확인·차량 수락 전)다.
7. 수신기가 결과를 조회하고 정확히 표시한 Digest를 명시적으로 수락하거나 취소한다.
8. 모바일이 서버 상태를 조회하고, 같은 레코드의 Receipt까지 검증해 ACCEPTED를 표시한다.

세션 상태와 화면의 상세 계약은 [inspection-sync-ui-v1](contracts/inspection-sync-ui-v1.md)에 있다.
결과의 `sync: NOT_SENT`는 변경하지 않는다. ‘사용자 보고’이며 센서 진단이 아니다.

## 토큰 수명과 재시도

| 정보 | 보관 위치 / 종료 |
| --- | --- |
| invite | 개발 진입점→MobileSync private field, Claim 호출 시 제거; URL/DOM/storage/log에 보관하지 않음 |
| submit | SyncClient private field; terminal/pagehide/연결 닫기/새 점검 때 dispose로 제거 |
| receiver | Node 시뮬레이터 또는 Kotlin client private field; QR에 포함하지 않음 |
| QR payload (invite만) | Android에서 렌더링에 필요한 메모리 값. wrapper toString은 REDACTED |

Claim 응답 유실은 재시도/재발급하지 않고 새 QR 안내로 끝난다. reload/BFCache 복귀로 Claim을 복구하지 않는다.
새 점검을 시작하면 기존 전송 연결을 닫는다. 모바일이 receiver 권한으로 서버 세션을 취소하는 기능은 없다.
남은 서버 세션은 수신기의 명시적 취소나 기존 expiry/retention 정책으로 정리된다.

SyncClient는 기존 제한 재시도(네트워크/timeout, 최대 추가 2회)를 유지하고 같은 snapshot만 재전송한다.
다른 레코드는 이전 SENT Receipt를 재사용하지 않고 서버 CONFLICT를 받는다.
dispose는 실행 중 요청을 abort하며 늦은 응답이 토큰/성공 상태를 복구하지 못한다.
Receipt의 receivedAt까지 필수/유한 숫자로 확인하도록 기존 6필드 계약 검사를 보완했다.

모바일 polling은 중복 실행 없이 2초, 실패 시 4/8초 backoff이고 연속 3회 실패 후 자동 polling을 멈춘다.
사용자는 상태 다시 확인을 누를 수 있다. hidden에서 중지하고 visible에서 재개하며 terminal/pagehide에서 멈춘다.
이미 확인한 서버 Receipt와 최종 차량 처리를 구분해 네트워크 오류 시 수락 성공을 추정하지 않는다.

## Android Debug 구성요소

신규 소스는 `app/src/debug/java/io/carscope/app/sync/`, 테스트는 `app/src/testDebug/.../sync/`다.
Android/SDK 네트워크 호출 없이 JVM에서 검증할 수 있는 typed transport 경계다.

| 구성요소 | 역할 |
| --- | --- |
| SyncReceiverTransport | create/view/accept/cancel callback, 취소 handle. 실제 HTTP 구현 없음 |
| SyncReceiverClient | private receiver credential, HTTPS QR target 검증, 생성 응답/세션/Digest 검증, expiry·세대 무효화 |
| SyncReceiverController | 명시적 생성/수락/취소, 중복 실행 방지, polling/backoff, close/lifecycle |
| SyncReceiverState | 토큰 없는 표시 모델, 사용자 보고 요약, 수락/취소 가능 여부 |
| CompletedInspection | 고정된 schema v1 typed record, canonical JSON/SHA-256, Node golden Digest와 일치 검증 |

이 단계는 **구성요소 준비**다. 등록된 수신 Activity·QR bitmap 렌더러·실제 JSON/HTTP decoder·auth verifier를 만들었다고 주장하지 않는다.
wire decoder를 후속 구현할 때 unknown/추가 필드 reject를 해야 하며 typed Fake 검증이 이를 대신하지 않는다.
공통 Activity/manifest/Gradle 변경은 Codex A와 충돌하지 않도록 후속 단계로 남겼다.
실제 네트워크 권한도 추가하지 않았고 실패 시 Fake로 자동 전환하는 경로도 없다.

소유 Activity는 onStop/onDestroy에 close해야 한다. close는 timer/request를 취소하고 private credential을 버리며
generation으로 늦은 create/view/accept callback을 무효화한다. 재생성된 소유자는 IDLE부터 새 QR로 시작한다.
일반 savedInstanceState/preferences에 토큰을 저장하지 않는다. 후속 Activity 연결 자체는 미구현이다.
수신기의 polling도 2/4/8초, 3회 실패 뒤 수동 재개이며 terminal에 중지한다.
제출 이후 상태 역행/다른 Digest를 거부하고, accept 응답은 표시한 Digest와 ACCEPTED 상태까지 일치해야 한다.

## 재현

```powershell
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
cd tools/inspection-sync-poc
# 아래 부모는 checkout 밖에 미리 준비. HTTP는 동일 PC 합성용 loopback뿐이다.
$env:SYNC_DB_PATH='C:/CarScope-External/ar-02b2/local/sync.sqlite'
$env:SYNC_LOCAL_TEST_AUTH='1'
npm run serve:mobile-dev  # 127.0.0.1:4182만, host override 없음
# 별도 터미널, 같은 package:
npm run receiver -- --server=http://127.0.0.1:4182 --mobile-base=http://127.0.0.1:4182/
```

기본 authorizer는 거부한다. 위 opt-in은 실제 차량 인증이 아니며 외부 bind는 제공하지 않는다.
개발 서버는 별도 loopback API를 같은 origin으로 중계하며 Host/Origin도 검사한다.
Android HTTPS transport가 준비됐다는 의미가 아니다.

검증 명령·결과·초기 실패와 미검증 구분은 [evidence](evidence/ar-02b2/README.md)에 기록한다.
인증/TLS/실기기 진입 조건은 [network boundary](ar-02b2-network-boundary.md)를 따른다.
