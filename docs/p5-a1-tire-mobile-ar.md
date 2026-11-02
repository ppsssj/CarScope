# P5-A1 · 타이어 4개 모바일 카메라 보조 점검

2026-11-03 KST. 구현·브라우저 합성 검증 완료. **실제 스마트폰/두 기기 E2E는 NOT_RUN**, 현재 기준 Native의 타이어 schema v2 수신은 **BLOCKED**. 카메라 2D 수동 안내이며 객체 인식·공간 추적·정밀 측정은 구현하지 않았다.

## 기준 및 조사

- 독립 작업 사본 `C:\dev\CarScope-tire-mobile-ar`, 브랜치 `feat/p5-a1-tire-mobile-ar`.
- 시작 시 기존 사본과 신규 사본의 clean 상태, remote `https://github.com/ppsssj/CarScope.git`, fetch 후 `origin/main = 5951b1ddbd1b63464b32db1093c36f4cde3c46d0` 확인. 시작 당시 열린 PR #41(Draft), #12, #2와 모바일 변경 중첩 없음. 다른 worktree를 수정하지 않았다.
- 기존 `app/camera/detector/marker/self-inspection/inspection-result/handoff`, Sync `mobile-dev-entry/protocol`, 차량 `inspection-tires/tire-inspection-view/tire-inspection` 및 AR/Sync 문서를 조사했다.
- 기존 워셔액: 카메라 수명주기, 파란색 휴리스틱 후보, 정규화한 2D 사용자 위치, 체크리스트, 명시적 결과 확정, schema v1, QR v1. Sync 별도 entry에서 QR v2·명시적 전송·서버 영수증·수신기 수락 지원. 이전 사용자 실기기 관측은 해당 기록의 근거이며 이번 실행으로 재검증하지 않았다.
- 기존 차량 타이어 육안 항목 `damage / debris / wear`, 응답 `FOUND / NOT_FOUND / UNABLE`을 유지한다. SDK 타이어 관측값과 결합하지 않는다.
- 작업 종료 전 열린 Codex B PR #51의 변경 파일을 확인했고 이번 모바일/Sync/문서 변경과 겹치는 파일은 없었다. Native 타이어 수신 계약은 별도 전달 문서로 남긴다.
- 기준 main의 Android `HttpsSyncReceiverTransport`, `SyncReceiverClient`, `SyncHttpDecoder`, `SyncReceiverContract`는 생성/QR/검증/직렬화에 `washer-fluid`와 schema v1을 고정한다. 이번 변경으로 Native 호환 완료를 주장하지 않는다. [Codex B 수신 명세](contracts/tire-mobile-result-v2.md) 참고.

## 구현된 사용자 흐름

| 작업 ID | 표시 위치(차량에 앉아 앞을 보는 기준) |
|---|---|
| `tire.front-left` | 앞 왼쪽 |
| `tire.front-right` | 앞 오른쪽 |
| `tire.rear-left` | 뒤 왼쪽 |
| `tire.rear-right` | 뒤 오른쪽 |

1. 선택한 타이어 위치·역할과 한계를 읽고 안전한 정차·주차 확인을 직접 체크한다. 체크 전 시작할 수 없다.
2. 카메라 또는 수동 경로를 선택한다. 카메라는 사용자 동작으로 실행하며 거부·미지원 시 수동 경로를 제공한다.
3. 점선 타원은 고정 안내 그림이다. 탭한 정규화 영상 좌표에 2D 위치를 표시하며 자동 탐지·3D 앵커로 표현하지 않는다.
4. 갈라짐/손상 → 이물질 → 고르지 않게 닳은 모습의 한 항목씩 세 응답 중 하나를 기록한다. 미응답은 다음으로 진행하지 않는다. `UNABLE`도 직접 선택해야 한다.
5. 전체 응답을 검토하고 Back으로 수정한 뒤 명시적으로 확정한다. 확정은 한 번이며 완료 후에는 기존 기록을 변경하지 않는다. 새 점검은 새 ID와 주차 재확인으로 시작한다.
6. 취소는 확인 후 미확정 기록을 지우고 처음으로 돌아간다. 취소 대화상자가 열리면 카메라부터 멈춘다. 계속 점검해도 카메라는 자동 재실행하지 않는다.

카메라 마모 깊이/공기압/균열 심각도 측정, 교체 시기·정상·주행 가능 판정은 없다. 접근하기 어려운 부분은 `UNABLE`, 박힌 이물질 제거·분해·주행 중 점검은 안내하지 않는다. 모든 결과는 `SELF / MOBILE / USER_REPORTED`다.

## 공통 구조와 수명주기

| 모듈 | 책임 및 재사용 범위 |
|---|---|
| `inspection-tasks.mjs` | 워셔액 + 네 타이어 위치/링크, 정확한 작업 분기. 향후 작업은 명시적 등록 필요 |
| `camera.mjs`, `marker.mjs` | 기존 CameraSession, contain/letterbox 정규화 좌표 변환 재사용. 워셔액 동작 보존 |
| `inspection-camera.mjs` | 부품에 독립적인 카메라/오버레이 세션. `drawGuide`, `targetLabel`, `canRun`, `onAids`, `onStatus` 주입. 현재 타이어에서 사용 |
| `tire-flow.mjs` | DOM 없는 상태 머신. 작업/시도 격리, 현재 항목 답변만 허용, 중복 NEXT/CONFIRM/이전 시도 이벤트 차단 |
| `tire-result.mjs` | 타이어 체크리스트와 엄격한 schema v2 검증, 불변 완료 결과 |
| `inspection-ui.mjs` | 워셔액/타이어 공통 결과 요약 렌더러, 타이어 탐색 중복 입력 게이트 |
| `tire-page.mjs` | 타이어 화면과 명시적 결과 확정, 기존 Sync callbacks 연결 |
| `public-modules.mjs` | 정적 서버·staging·same-origin 서비스의 명시적 모듈 목록. 임의 파일 제공 금지 |

워셔액의 기존 체크박스/결과 선택 상태 머신과 schema v1은 유지한다. 카메라 컨트롤러 전체를 강제 이관하지 않고 기존 CameraSession·좌표 모듈부터 공유한다. EV 충전구·브레이크액·전면 와이퍼·전조등은 후속 profile(안전 안내, 항목, 결과 validator, Sync 지원 행렬)이 필요하며 이번 등록/활성화 대상이 아니다.

타이어는 화면 회전/크기·영상 해상도 변경, 항목/단계 이동 시 위치 표시를 해제한다. 중지·수동 전환·취소·권한 대기 중 Back·pause/stalled/ended/error·pagehide·화면 숨김에는 세션/타이머를 정리한다. 영상 시각이 2초 넘게 갱신되지 않아도 중지한다. 늦은 권한 응답의 스트림은 generation 확인 후 종료한다. 기기 이동 자체를 감지하지 않으므로 이동 후 사용자가 재지정해야 한다. 위치 좌표는 결과에 포함하지 않는다.

## QR·Sync 호환성 및 저장

- `#v=1&task=washer-fluid` 그대로 지원. v1 타이어는 거절한다.
- 독립 수동 선택용 `#task=tire.front-left` 등은 **작업 힌트**이며 QR v1 확장이나 인증이 아니다. 루트 화면에서 네 링크로 선택 가능하다.
- QR v2 문법/토큰 길이/인증 경계는 그대로 유지하고 supported task 네 개만 추가했다. 연결된 타이어 화면은 작업을 바꿀 수 없다. claim 응답과 결과 제출 모두 초대의 정확한 task와 일치해야 한다.
- 프로토콜은 `inspection-sync` / `protocolVersion: 1`. 워셔액 schema v1을 보존하고 타이어 schema v2만 별도 validator로 분기한다. canonical JSON·digest·영수증·멱등 제출·명시적 수락은 기존 구현을 사용한다.
- 확정만으로 전송하지 않는다. `SENT`는 일치하는 서버 영수증 확인, `ACCEPTED`는 수신기의 명시적 수락 확인이다. 원본 결과의 `sync`는 `NOT_SENT`로 보존한다.
- 모바일 응답/영상/사진/좌표/토큰을 localStorage/sessionStorage에 저장하지 않는다. 새로고침·종료 시 모바일 메모리 기록과 자격 증명은 사라진다. 재진입 복구·점검 이력·삭제 UI는 보존 정책 확정 후 별도 과제다. 명시적으로 전송한 결과의 서버 보관은 기존 세션 store/TTL 정책이며 변경하지 않았다.
- 토큰은 public handoff/DOM/결과에 노출하지 않고 QR v2 fragment를 즉시 제거한다. 결과는 정확한 필드 집합만 허용하고 차량 식별자·위치·미디어·SDK 값을 거절한다.

### Sync 파일 변경 이유

| 파일 (`tools/inspection-sync-poc/` 기준) | 이유 |
|---|---|
| `src/protocol.mjs` | 네 작업 ID와 task별 결과 validator 추가 |
| `public/mobile-handoff.mjs` | 토큰과 분리된 타이어 task 전달, 기존 v1 보존 |
| `public/mobile-dev-entry.mjs` | 타이어 DOM 준비 후 기존 연결/전송 버튼 삽입, 정확한 task 전달 |
| `public/mobile-sync.mjs`, `public/sync-client.mjs` | washer 기본값 보존, claim/결과의 요청 task 일치 검증 |
| `src/mobile-page.mjs` | 신규 공용 모듈의 same-origin 명시적 목록 사용 |
| `src/server.mjs` | 기존 debug 페이지의 protocol import에 필요한 순수 검증 모듈 3개만 debug 전용 목록에 추가 |
| `test/tire-e2e.test.mjs` | 네 작업 HTTP 흐름, 부분/불일치 거절, debug 전용 import 회귀 |

HTTP 라우트·인증·TLS·세션 저장·receiver 권한은 변경하지 않았다. Android Native/Pleos/3D/Geometry/외부 GLB 및 다른 Codex의 worktree/서버는 변경하지 않았다. 원본 Sync 서버를 중단하거나 재작성하지 않고 테스트 소유의 임시 loopback 서버만 사용했다.

## 검증 결과

환경: Windows, Node `22.16.0`, Edge `156.0.4314.58`, Chrome `156.0.8078.79`. 원본 로그/캡처는 [외부 증거 인덱스](evidence/p5-a1/README.md)에만 참조한다. CI는 PR의 해당 HEAD 결과를 별도로 확인한다.

| 범위 | 결과 | 근거 |
|---|---|---|
| 모바일 syntax / 단위 | PASS | `npm run check`, `npm test` 40/40 (기존 31 + 타이어 9) |
| 타이어 상태/스키마 | PASS 합성 | 네 ID, 세 응답의 27조합, 부분 완료 차단, 취소/Back/새 시도, 완료 불변/멱등, 잘못된 이벤트/시간/추가 개인정보 필드 거절 |
| 기존 워셔액 Edge | PASS 합성 | 브라우저 16개 검사 그룹, 기존 UI·후보·수동·결과·v1 QR 보존 |
| 타이어 Chrome | PASS 합성 | 390×844 / 844×390, 7개 검사 그룹. 네 ID, 3개 개별 응답, 수정/확정/새 점검, 키보드 초점, 권한 거부, 2D 탭/회전/중지·재시작, 늦은 권한 응답, frame stall, pagehide, QR v2 연결/전송/수락 |
| Sync check / 전체 테스트 | PASS 합성 | 89/89, 네 타이어의 실제 loopback HTTP 요청 → Node 수신기 명시적 수락 포함 |
| Sync legacy / SQLite / AR-01 wrapper | PASS 합성 | 48/48, 21/21, 40/40. 동일 테스트 중복 실행으로 합계에 더하지 않음 |
| 기존 Sync debug Edge | PASS 합성 | 11개 검사 그룹 |
| 기존 워셔액 v2 통합 Edge | PASS 합성 | 19개 검사 그룹, 기존 auth/TLS/영수증/SQLite/레이스 경계 보존 |
| 실제 폰/후면 카메라/OS 권한·회전·백그라운드 | NOT_RUN | canvas.captureStream과 주입 오류/이벤트는 실제 기기를 대체하지 않음 |
| 실제 폰 ↔ Android 타이어 E2E | BLOCKED / NOT_RUN | 현재 Native의 washer/schema v1 고정 계약, 후속 B 구현 및 별도 두 기기 검증 필요 |
| Android 빌드/JVM/AVD/adb | NOT_RUN | 이번 웹 변경 검증에서 로컬 실행하지 않음. Native 변경 없음, 기존 GitHub Android CI 범위와 구분 |

발견/수정: 기존 워셔액 테스트 하나가 고정 완료 시각과 실제 시작 시각을 섞어 실행일에 따라 실패했다. 시작에도 동일 fixture clock을 주입하는 테스트 전용 수정으로 원래 random UUID 검증을 유지했다. 초기 Sync debug 브라우저 회귀에서 누락된 타이어 validator import 3개를 확인하고 debug 전용 allowlist 회귀 테스트를 추가했다. 새 브라우저 하네스의 hashchange 재탐색 대기 누락은 정확한 task/intro 로드 대기로 수정했다. 추가 재시작 검사에서 가로 화면 밖 영상 좌표를 탭한 타임아웃은 재생 준비/영상 스크롤 대기로 수정했고 7개 그룹이 다시 통과했다. 실패 로그도 외부에 남겼다.

## 재실행

저장소 루트 PowerShell에서 실행한다. 외부 증거 폴더는 실행마다 새 이름을 사용한다.

```powershell
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm run check --prefix tools/mobile-ar-poc
npm test --prefix tools/mobile-ar-poc
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a1/YOUR-NEW-RUN/mobile'
npm run test:browser --prefix tools/mobile-ar-poc
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/p5-a1/YOUR-NEW-RUN/sync'
npm run verify:local --prefix tools/inspection-sync-poc
npm run test:browser --prefix tools/inspection-sync-poc
npm run test:mobile-browser --prefix tools/inspection-sync-poc
```

브라우저 테스트는 설치된 Edge(기존 회귀)와 Chrome(타이어)을 사용한다. 타이어만 실행하려면 `npm run test:browser:tire --prefix tools/mobile-ar-poc`. 테스트 의존성/서버는 기존 스크립트를 사용하며 AVD/adb는 실행하지 않는다.

직접 확인: `npm run serve --prefix tools/mobile-ar-poc` → `http://127.0.0.1:4174/#task=tire.front-left`. 나머지 세 작업도 intro 링크로 이동한다. 실제 폰은 [기존 HTTPS 준비](../tools/mobile-ar-poc/HTTPS_STAGING.md)에 따라 **폰이 신뢰하는 HTTPS**에서 연다. PC loopback이나 신뢰되지 않는 LAN HTTP로 폰 카메라 성공을 가정하지 않는다. TLS/네트워크 설정을 자동 변경하지 않는다.

실기기 후속: 폰/OS/브라우저·후면 렌즈·HTTPS 신뢰를 기록하고, 각 타이어 위치를 직접 확인 → 주차 확인 → 카메라/수동 → 세 응답 → 수정/확정 → 새 점검을 수행한다. 권한 거부·실제 회전·기기 잠금/복귀·취소·영상 중단 시 표시 해제와 수동 복구를 확인한다. B의 Native 지원 후 정확한 task 초대와 동일 digest의 명시적 수락까지 별도 두 기기 E2E로 기록한다. 토큰·영상·사진·위치·차량 식별자는 검증 로그에 남기지 않는다.
