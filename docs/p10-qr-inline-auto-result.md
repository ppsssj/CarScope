# P10 AVD 인라인 QR 배치와 모바일 결과 자동 반영 안정화 (PR #120)

기준 `origin/main` `a360916` (PR #119 병합 후). 범위는 Debug 3D 점검 화면(`InspectionActivity` + `tools/three-poc/inspect.html`)이다. 서버 계약, 결과 검증 절차, Release 빌드는 바꾸지 않았다.

## A. QR이 슬롯 옆에 뜨던 문제

### 원인

페이지는 `#mobileQrSlot`의 `getBoundingClientRect()`(CSS px)를 보내고, Native는 그 값에 `resources.displayMetrics.density`를 곱해 배치했다. 이 변환은 "WebView의 CSS px 1 = dp 1"일 때만 맞다. Pleos AVD에서는 그렇지 않다.

| 값 | Pleos AVD 실측 |
|---|---|
| `wm density` | 160 → `displayMetrics.density` **1.0** |
| 창 / WebView | 1682×1210 px (`dumpsys window`: `[853,90][2535,1300]`) |
| 페이지 viewport | 1224×880 CSS px, `devicePixelRatio` **1.375** ([p3-a5-2](p3-a5-2-android-inspection.md)) |

그래서 QR의 위치와 크기가 1/1.375로 줄었다. 슬롯은 오른쪽 패널 안에 있는데 QR은 패널 왼쪽 차량 위에 그려졌고, 슬롯은 흰 사각형으로 남았다. 창 inset, 패널 스크롤, WebView 위치는 원인이 아니었다. WebView와 QR `ImageView`는 같은 `FrameLayout`의 (0,0)에 있고, inset은 0이다(`mGivenContentInsets=[0,0][0,0]`).

### 수정: 기준 하나, 변환 한 번

- **페이지** (`qrSlotReport`, `inspection-results-view.mjs`): 슬롯을 CSS px로 보내고 그 viewport 크기(`vw`=`innerWidth`, `vh`=`innerHeight`)를 함께 보낸다. 아래 경우에는 위치 없이 `HIDDEN`을 보낸다.
  - 슬롯 전체가 패널과 viewport 안에 있지 않음
  - 패널이 슬라이드 중임(`transform`≠`none`)
  - 핀치 확대 상태임(`visualViewport.scale`≠1)
  - 슬롯이 정사각형이 아님

  슬롯이 없으면 `NONE`이다. 1초 타이머 외에 패널 `scroll`·`transitionend`, 창·`visualViewport` `resize`, 패널 `ResizeObserver`가 다음 프레임에 다시 보고한다.
- **Bridge** (`NativeInspectionBridge`): `panel`은 정확히 `slot,x,y,size,vw,vh`만 받는다. 모두 0..10000이어야 하고, `SHOWN`이면 `vw,vh`>0이어야 한다. 예전 4개 키 형식과 추가 키(`qr`, `dpr` 등)는 거부한다.
- **Native** (`InlineQrPlacement`): `scale = WebView 실제 너비 / vw`로 **한 번** 변환하고 WebView의 frame 위치를 더한다.
  - density는 스캔 가능한 크기(120–600 dp) 판정에만 쓴다.
  - 가로 scale과 `높이/vh`가 2% 넘게 다르면 그리지 않는다. 크기가 바뀐 WebView에 예전 보고가 남은 경우다.
  - WebView 밖으로 나가는 위치는 그리지 않는다.
  - WebView 레이아웃이 바뀌면 다시 배치한다.
  - WebView가 아직 배치되지 않았으면 그리지 않는다. 예전에는 너비 0이면 크기 검사를 건너뛰었다.
- 임의의 x/y 보정값은 없다. `FLAG_SECURE`는 QR이 실제로 그려질 때(또는 관리 패널을 열었을 때)만 켜진다. Bitmap이 Native 밖으로 나가지 않는 정책과 입력 차단도 그대로다. 새 로그 `CARSCOPE_INLINE_QR`에는 좌표·scale·density만 남는다.

### Before / After (실제 Pleos AVD, 같은 부품 EV 충전구, 화면 좌표 px)

uiautomator 접근성 트리의 bounds로 비교했다. 화면 픽셀 캡처는 하지 않았다(`FLAG_SECURE` 우회 없음).

| | 페이지 슬롯 `mobileQrSlot` | Native QR `ImageView` | 중심 차이 |
|---|---|---|---|
| Before (설치돼 있던 APK) | `[2042,655][2457,1070]` 415 px | `[1719,502][2019,802]` 300 px | (−380, −210) — 패널(x≥1987) 왼쪽 차량 위 |
| After (이 브랜치 APK) | `[2042,655][2457,1070]` | `[2043,656][2455,1068]` 412 px | ≤0.5 px |

After 로그는 `CARSCOPE_INLINE_QR shown left=1190 top=566 size=412 scale=1.374 density=1.0`이다(창 원점 853,90 기준). 슬롯 300 CSS px는 412.5 px이다. 접근성 bounds 415는 바깥쪽으로 반올림한 값이다.

## B. 스마트폰 제출 후 차량에서 수락이 더 필요해 보이던 문제

AVD 자동 수신 확인(`autoConfirmReceivedResult() = usesAvdSimulator`)은 이미 동작한다. 기존 Robolectric 흐름 테스트와, 11-11에 남아 있던 AVD 화면의 `AVD 시뮬레이션 자동 수신` 결과가 그 근거다. 새로 구현하지 않고, 상황별로 경로를 나눠 확인했다.

| 상황 | 이전 동작 | 판정·수정 |
|---|---|---|
| 시뮬레이터 등록 유효 | 서버 Accept까지 자동 | 변경 없음 |
| 자동 확인 3회가 모두 실패한 뒤 poll 성공 | 새 상태가 `retryAvailable`을 지워 페이지는 "내용을 확인하는 중"에 멈춤. **남은 경로는 개발자 관리 패널의 수동 수락뿐** | **원인.** 시도를 다 쓰면 `retryAvailable=true`로 알림 → 페이지 `결과를 반영하지 못했습니다 · 다시 확인` + `다시 확인` 버튼. `retryPolling`이 시도 횟수를 초기화하고 같은 digest로 다시 자동 확인 |
| 서버 Accept는 됐지만 3D 전달 실패(시각 계약 없음 `ACCEPTED_NOT_BOUND`, binding 만료, digest·proof 거부, 채널 종료) | 서버 `ACCEPTED`만 보고 `스마트폰 결과를 받아 이 화면에 표시했습니다` | **성공이 아닌데 성공 문구.** 이제 페이지가 이 세션의 binding으로 검증된 결과를 실제로 저장했을 때만 `점검 결과가 반영되었습니다`를 보여 준다. 실패는 `결과를 반영하지 못했습니다 · 다시 확인`, 아직 오는 중이면 `결과 수신 중` |
| 결과는 받았지만 화면에 미반영 | 위와 같음 | 위와 같음. 검증된 최신 결과는 기존대로 선택 없이 표시된다(`selected.set`) |
| 개발자 관리 패널의 수락 버튼 | "Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요" | AVD: `검증을 통과한 결과는 수락 버튼 없이 3D에 반영됩니다. 차량 소유자 승인이 아닙니다.` 그 외: `이 패널에서 결과를 수락하면 3D에 반영됩니다.` 버튼은 Debug 영역에 그대로 둔다 |
| 일반 차량/OEM(시뮬레이터 아님) | 페이지가 `RESULT_RECEIVED` "확인하는 중" — 자동처럼 보임 | 명시적 수락 정책은 그대로다. 새 phase `AWAITING_CONFIRMATION` `결과를 받았습니다. 차량의 수신 관리 패널에서 수락해야 반영됩니다.` |

운전자 문구는 `스마트폰 점검 진행 중` → `결과 수신 중` → `점검 결과가 반영되었습니다` / `결과를 반영하지 못했습니다 · 다시 확인`이다. 자동 반영 기록에는 기존처럼 `AVD 시뮬레이션 자동 수신 · 차량 소유자 승인 아님`이 붙는다.

우회하지 않은 검증: 서버 digest, binding, 세션 시각(`serverNow`/`expiresAt`), task·part 매칭, 인증, 중복 결과(`DUPLICATE`)·충돌(`RESULT_CONFLICT`) 거부, `CONFIRMATIONS` 허용 목록.

## 검증

| 항목 | 결과 | 환경·명령 |
|---|---|---|
| 웹 단위 | PASS 332, FAIL 0, TODO 1(기존 P2-9) | Node 22, `npm test --prefix tools/three-poc`. 새 `test/qr-inline-auto-result.test.mjs` 10건 |
| 문법·패키징 | PASS | `npm run check:results`, `npm run test:android-assets` (4/4) |
| Android 단위 | PASS 281/281 | `node tools/three-poc/build-android-inspection.mjs && node tools/three-poc/build-android-lab.mjs`, `gradlew.bat :app:testDebugUnitTest` (새 `InlineQrPlacementTest` 7, Bridge·Controller·Activity 추가) |
| core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| 브라우저(실제 GLB) | PASS — consistency, panels, part-labels, results, history, toast | Chrome 157, `CARSCOPE_3D_TEST_URL=http://127.0.0.1:8199/inspect.html?capture=1`, `CARSCOPE_EVIDENCE_DIR=C:\CarScope-External\p10\pr120\<suite>`. Q1에 vw/vh·스크롤·잘림 숨김 추가 |
| AVD QR 배치 | **PASS** | 위 Before/After, 스크롤(top 566→547→…→166, 슬롯이 패널 밖이면 `HIDDEN`, 되돌리면 다시 표시), 표시 중 `FLAG_SECURE`, 취소 후 해제·오버레이 제거 |
| AVD 스마트폰 스캔 → 제출 → 3D 자동 반영 | **NOT_RUN** | 실제 휴대폰 광학 스캔이 필요하다. 초대값은 보호된 QR 안에만 있어 꺼내지 않았다. 자동 반영 경로는 Robolectric(`MobileRequestFlowActivityTest`)과 웹 단위 테스트로만 확인했다 |
| 화면 회전·창 크기 실제 변경 | NOT_RUN(AVD) | 단위·Robolectric·브라우저 테스트로만 확인 |

AVD 실행: `CarScope_Pleos_API34`, `emulator-5554`, user 10. 앱은 `adb install -r`로만 갱신했다. uninstall, 데이터 삭제, 재등록은 하지 않았다. 갱신 전후 private file 목록·크기·시각이 같다. 기존 enrollment(만료까지 약 86분 남음)를 그대로 썼다. 이 측정으로 테스트 서버에 세션 2개를 만들었고 둘 다 서버 취소를 확인했다. 설치·재시작 때문에 그 전에 화면에 있던 메모리상 점검 세션은 사라졌다. 저장 파일과 서버 기록은 그대로다.

증거 인덱스(저장소 밖):

- `C:\CarScope-External\p10\pr120\avd\`: 접근성 트리 XML 4개(QR·초대값 없음, `invite=|token` 검색 0건)
- `C:\CarScope-External\p10\pr120\<suite>\`: 브라우저 결과(합성 fixture, 실제 QR 없음)

## 남은 문제

- AVD 실기 스마트폰 E2E는 `NOT_RUN`이다(위).
- AVD에서 `점검 요청 취소`를 두 번 눌러도 반응이 없었고 세 번째에 취소됐다. `SyncReceiverController.cancel()`은 요청이 진행 중이면 조용히 무시하므로, 느린 서버 poll과 겹쳤을 가능성이 있다. **확인하지 않았고 이 PR에서 바꾸지 않았다.**
- `ACCEPTED_NOT_BOUND` 같은 3D 전달 실패에서 `다시 확인`은 새 점검을 다시 하는 것을 뜻한다. 서버 이력에는 결과가 남지만, 이 화면이 그 결과를 다시 받아 오지는 않는다.
