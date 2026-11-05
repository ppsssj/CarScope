# P9-A2 AVD 실제 환경 검증 evidence index

실행일 2026-11-05. 기준 `main` `dfc63bd`. AVD `CarScope_Pleos_API34`, `emulator-5554`, API 34, Android 14, user 10, `release_connect_v2.1.0`, Vehicle Service 2.3.22(code 74), WebView `ai.pleos.android.webview` 131.0.6752.0. 시작 옵션은 `-gpu host -no-snapshot`이고 wipe와 uninstall은 하지 않았다.

**범위:** AVD의 앱 화면과 로컬 상태까지다. **Render 서버 동작, 운영 인증, 스마트폰 E2E는 NOT_RUN이다.** AVD 통과는 실차나 소유권의 증거가 아니다. 수정 전 기기 결과와 수정 후 브라우저 결과는 아래에서 분리했다.

원본은 작업 PC `C:\CarScope-External\p9-a2\`에 있으며 Git에 넣지 않았다. 캡처, 로그, APK, enrollment 원문은 저장소에 없다.

## 설치와 배치 (AVD, PASS)

| 항목 | 결과 |
|---|---|
| 이전 설치본 | `d47f3907ba999774922b14b49ca5465316069fabfc6e595279124da3fbdce2a9`, `LEGACY_DECODER` |
| 설치 APK | `b11f3a799a9970b541aa9a114e405d8cbce6e13b89896f6610a94c70be7dd3d4`, `NEW_DECODER`. `install --user 10 -r`, 서명 인증서 동일. 기기에서 다시 받은 파일과 해시 일치 |
| 코드 일치 | APK는 `8a6f559` 빌드. `8a6f559..dfc63bd`는 문서만 변경 |
| app-private 데이터 | 설치 전후 파일 목록 동일 |
| Endpoint | `files/sync-endpoint.json` 101 bytes, 요청 값과 바이트 일치, `0666`에서 `0600`으로 변경. 앱 표시 `HTTPS 주소 설정됨 · 연결/TLS 미확인 · 생성 인증 기본 거부`. 인증 성공이 아니다 |
| GLB | `files/debug-3d-assets/ioniq5.glb` 1,902,820 B, `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`. 입력과 기기 일치, 로그 `external/ioniq5.glb:1902820` |

## 화면 검증 (AVD, 실제 터치. 수정 전 APK)

| 항목 | 판정 | 근거 |
|---|---|---|
| 3D 차량 | PASS | WebGL 2, 화면 확인, 닫기 후 COLD 재실행에서도 렌더링 |
| 타이어 | PASS (앞 왼쪽만) | 선택, 강조, 카메라 이동, 체크리스트 3개, 확정, 상태색 변경, 완료 1/4 |
| 보닛 | PASS | 60° 개방과 닫힘. 개방 중 프레임은 시작 직후 1장이라 연속 동작을 눈으로 확인한 것은 아니다 |
| 부품 표시 | PASS | 워셔액(3D 터치), 브레이크액, 냉각수, EV 배터리, 충전구, 와이퍼, 전조등 |
| SDK 표시 | PASS | `STALE`과 원래 callback 시각 유지 |
| 전체 요약 | PASS | 17개 부품 기준, 이상 징후 1, 출처 `USER_REPORTED` |
| History | PASS | `점검 기록 조회 경로가 연결되지 않았습니다`, `저장된 기록이 없다는 뜻이 아닙니다`. 빈 목록과 데모 데이터 없음 |
| Back과 상태 유지 | PASS | 단계별 복귀, 기록 유지, 홈 복귀 시 삭제 |
| Settings 전환 후 복귀 | PASS | `pause finishing=false`, `resume`, 새 `create` 없음, 기록과 입력 유지. 1회 관측 |
| Native 수신 기본 상태 | PASS | 위 endpoint 문구, `점검 요청 생성` 비활성. `FLAG_SECURE`라 캡처 대신 uiautomator 트리로 기록 |
| 3D 전달 문구 (D1) | PASS | `전달 어댑터 연결 · 실제 Native E2E 검증과 별개` |

## ANR과 Crash

| 항목 | 판정 | 내용 |
|---|---|---|
| 새 ANR | 없음 | `lastanr`: `<no ANR has occurred since boot>`. exit-info의 `reason=6 (ANR)`은 2026-11-04 00:20의 과거 기록이다 |
| 앱 crash | 없음 | crash 버퍼에 `io.carscope` 언급 0건, `AndroidRuntime` FATAL 없음 |
| 시스템 tombstone | 앱 실행 전부터 있음 | 시스템 HAL `ai.pleos.hardware.*` SIGABRT 36건. 원인은 조사하지 않았다 |
| 작업자 명령 crash | 1건 | 만료 시각을 읽으려고 실행한 `run-as … sed`가 SIGSEGV로 종료했다. 앱 프로세스가 아니고 파일은 바뀌지 않았다. 토큰 형태 값은 0건이었다. 이후 이 방식을 쓰지 않았다 |
| RenderThread | 존재 | 프로세스 유지. 성능 결론으로 쓰지 않는다 |

## 원인 미확인: `tire.pressure ERROR`

화면에 `tire.pressure`의 Capability와 Availability가 `ERROR`, `tire.low-pressure`가 `UNVERIFIED`로 표시됐다. P7-A의 capability timeout 기록과 같은 표시지만 **이번 실행의 원인은 로그로 확인하지 못했다.** 오류를 CLOSED나 정상으로 바꾸지 않고 그대로 표시한 것까지만 확인했다.

## 토스트 결함과 수정

**재현 (수정 전, AVD):** 차량 점검 → 보닛 → 워셔액 → `이 부품 모바일 점검 요청` → `3D로 돌아가기`. 생성 요청이 없었는데 `Native에 점검 생성을 요청했습니다. 검증된 연결 응답을 기다리세요.`가 남았다. `request-mobile` 분기가 토스트를 켜면서 해제 타이머를 걸지 않아 다음 `render()`까지 유지됐다.

**수정:** `inspection-toast.mjs`가 `#toast`의 유일한 소유자가 된다. `render()`와 요청 분기가 같은 함수를 쓰며, 새 안내는 이전 안내와 타이머를 대체한다. 시작 문구는 `Native 수신 화면을 요청했습니다 · 세션 생성 전입니다`로 바꿨다. 요청 시작은 Native에 수신 화면을 요청할 뿐이며, 세션은 그 화면에서 생성 버튼을 눌러야 만들어진다.

| 검사 | 환경 | 결과 |
|---|---|---|
| `inspection-toast.test.mjs` 6개 | Node 22.16.0 | PASS. `clearTimer`를 빼면 2개 실패 |
| `npm test` | Node 22.16.0 | 158/158 PASS |
| `npm run test:android-assets` | Node 22.16.0 | 4/4 PASS |
| `npm run test:toast-browser` | Chrome 156, 실제 GLB 페이지 | PASS: 실패 안내 자동 해제, 연속 클릭, 화면 전환 뒤 힌트 유지, History `UNAVAILABLE`, 시작 안내 1440·430px. 시작 경로는 합성 어댑터 |
| `npm run test:history-browser` (3D 포함) | Chrome 156, 실제 GLB 페이지 | PASS (DOM 2개, 실제 페이지 3개). 데모 provider는 테스트 안에서만 사용 |
| `npm run test:results-browser` (3D 포함) | Chrome 156, 실제 GLB 페이지 | PASS (DOM 2개, 실제 페이지 2개). 합성 authority이며 실제 Native 수락이 아니다 |

**수정 후 AVD 확인은 NOT_RUN이다.** AVD에는 수정 전 APK가 설치돼 있다. 새 APK 빌드와 설치는 이 작업에서 하지 않았다.

## 부하 수치와 한계

참고용 관측값이다. 사용자가 P9-A2에서 CPU·메모리·Load Average를 자동 중단 조건으로 쓰지 않도록 승인했으므로 판정에 사용하지 않았고, **성능 PASS로 해석하지 않는다.**

| 항목 | 값 |
|---|---|
| guest load 1분값 (2코어) | 6.67~11.58 |
| 호스트 가용 메모리 | 부팅 전 약 6.1 GiB, 실행 중 약 2.1~2.7 GiB |
| `gfxinfo` | 532 frames, janky 99.25%, p50 97ms |
| 앱 PSS | 약 126 MB |

- 서버 요청이 없었다는 근거는 해당 버튼 미클릭, `CarScopeAvdAuth` 0줄, 앱 uid TCP 소켓 표본 0, netstats 행 없음이다. 패킷 캡처가 아니다.
- HOME keyevent는 이 패널의 앱을 pause시키지 않아 검증으로 인정하지 않았다. [절차](../../p9-e2e-checklist.md#포커스-전환-절차)에 대체 방법을 적었다.
- Settings 전환은 P7-A focus-event ANR의 재현이나 해결을 뜻하지 않는다.

## NOT_RUN

| 범위 | 항목 |
|---|---|
| Render·서버 | `/healthz`(C1a), `서비스 연결 확인`·`/v1`(C1d·C1e, G2), 백업·배포(G3·G4), 시뮬레이터·enrollment(G5·G6), 세션 생성(G7), 제출·Accept(G8), 복원(G9), `serverNow`(C5) |
| 스마트폰 E2E | QR, 광학 스캔, 제출, Native→3D(C6), 취소·만료(F) |
| WebView | Referer, 첫 RPC(D2·D3) |
| AVD UI 일부 | 나머지 타이어 3개 입력, 이전/다음 타이어, 드래그 회전, 확대·축소, 보닛 애니메이션 중 취소, 12V, 퓨즈박스, 저전도 냉각수, History 필터, 화면 회전, renderer 종료, `avd-android-inspection.mjs` |
| 수정 후 | 토스트 수정의 AVD 확인 |

## Enrollment 정리

값과 원문은 기록하지 않는다. 운영 DB 접근과 신규 발급은 하지 않았으므로 **등록의 서버 측 폐기 여부는 NOT_VERIFIED다.**

| 위치 | 상태 | 조치 |
|---|---|---|
| AVD `files/avd-simulator-enrollment.json` | 만료, 앱이 거부, grant 요청 로그 0줄 | 이 파일 하나만 삭제. 다른 파일의 목록·권한·GLB 해시 변화 없음 |
| PC `avd-enrollment.json` | 만료 | 보존. 삭제 전 사용자 확인 필요 |
| PC `avd-enrollment-20261104-154408712.json` | 만료. AVD 파일과 같은 등록 추정(만료 시각 동일) | 보존. 삭제 전 사용자 확인 필요 |
