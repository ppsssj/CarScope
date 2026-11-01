# P3-A5.2 — Android 3D 차량 점검 흐름 이식

2026-11-01, 기준 main `d114223`(PR #23 병합 포함). P3-A4 브라우저 점검 UI(`tools/three-poc/inspect.html`)를 P3-A5.1의 Android WebView 경계 위에서 **디버그 전용 화면**으로 실행한다. 기존 UX, 상태 머신, Geometry 모듈은 그대로 쓰고 Android 전용 부분만 덧붙였다.

**판정: AVD 기준 PASS.**
- 실제 Pleos AVD에서 전체 점검 흐름 15/15 확인
- P3-A5.1 랩 회귀 PASS
- 주 화면 Mock/Pleos 도어 회귀 PASS
- Debug/Release 분리 PASS

실기기, 핀치 줌, 휴대폰 실제 스캔은 이번 범위에서 미검증이다(§6).

## 1. 구성

| 구성 | 위치 | 역할 |
| --- | --- | --- |
| 화면 | [InspectionActivity](../app/src/debug/java/io/carscope/app/lab/InspectionActivity.kt) | `src/debug` 전용. 런처 항목 없음. `adb shell am start -n io.carscope.app/.lab.InspectionActivity` |
| 공용 호스트 | [DebugWebScreen](../app/src/debug/java/io/carscope/app/lab/DebugWebScreen.kt) | P3-A5.1 `Ioniq5LabActivity`의 호스팅을 분리. 두 화면이 같은 보안 모델을 씀 |
| 자산 생성 | [build-android-inspection.mjs](../tools/three-poc/build-android-inspection.mjs) | `inspect.html`/`inspect.js`/`inspection-flow.mjs`/Geometry 모듈 5개/Three.js를 `app/src/debug/assets/inspection/`(git 무시)에 복사하고 Android shell 스크립트를 추가 |
| Android shell | [android-inspect-shell.js](../tools/three-poc/android-inspect-shell.js) | 닫기·줌 버튼, 외부 링크 차단, logcat 이벤트(전이·화면 좌표·상태별 프레임 통계) |
| 웹 모듈 추가 | [inspect.js](../tools/three-poc/inspect.js) `window.__inspect` | `zoom()`, `view()`, `dispose()`, `renderInfo` 추가. 기존 흐름과 화면은 변경 없음 |
| AVD 검증 | [avd-android-inspection.mjs](../tools/three-poc/avd-android-inspection.mjs) | 실제 터치 입력으로 흐름을 진행. 결과는 저장소 밖에만 기록 |
| 경계 검사 | [check.py](../tools/identity-probe/check.py) `lab_boundary` | `InspectionActivity`와 `assets/inspection/`, 비공개 host가 release에 없는지 검사 |

보안과 자산은 P3-A5.1과 같다.
- JavaScript는 이 화면에서만 켠다. 비공개 origin은 `https://carscope-inspection.invalid/`다.
- 응답마다 CSP를 붙이고, 그 밖의 요청은 모두 404, 페이지 이동은 모두 차단한다.
- GLB는 저장소에 넣지 않는다. 앱 전용 `files/debug-3d-assets/ioniq5.glb`(P3-A5.1과 같은 파일, `push-android-lab-model.mjs`로 주입)를 페이지가 원래 쓰던 경로 `external/ioniq5.glb` 하나로만 응답한다.
- QR 대상은 빌드 시 `CARSCOPE_QR_AR_BASE_URL`에서 받는다. 브라우저 서버와 같은 검증(`inspection-handoff.mjs` → `mobile-ar-poc/public/handoff.mjs`)을 거쳐 `inspection-handoff.json`과 `inspection-qr.svg`를 만든다. 계약은 `#v=1&task=washer-fluid` 그대로다. 설정이 없으면 QR 단계가 "설정되지 않음"으로 표시된다.
- 주 화면 `MainActivity`, Pleos SDK 경로, release WebView 설정은 변경하지 않았다. 차량 데이터와 3D 객체의 연동, 휴대폰 결과 동기화는 하지 않는다.

## 2. 실행

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
$env:CARSCOPE_QR_AR_BASE_URL = 'https://<QR-AR HTTPS origin>/'   # 선택
node tools/three-poc/build-android-inspection.mjs
.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
node tools/three-poc/push-android-lab-model.mjs --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb
adb shell am start -n io.carscope.app/.lab.InspectionActivity
# 검증: npm ci --prefix tools/mobile-ar-poc (QR 디코드용) 후
node tools/three-poc/avd-android-inspection.mjs --out=C:\CarScope-External\p3-a5-2\runN --expectQr=https://<origin>/#v=1&task=washer-fluid
```

## 3. 웹 화면과 Android 구현의 차이

| 항목 | 브라우저 (P3-A4) | Android 디버그 화면 |
| --- | --- | --- |
| 점검 흐름·UI·Geometry | `inspect.html` | 같은 파일. 수정 없이 복사 |
| 화면 닫기 | 탭 닫기 | 상단 **✕ 닫기**: GL 해제 후 `./close` → `finish()`. Pleos 홈이 태스크 루트의 Back을 가로채기 때문 |
| 확대·축소 | 휠·핀치 | **+/− 버튼** 추가(`__inspect.zoom`). 휠·핀치 코드는 그대로 |
| QR 대상 | `serve.mjs` 실행 시 환경 변수 | 자산 빌드 시 같은 환경 변수와 같은 검증. 정적 파일로 포함 |
| "직접 열기"·설명서 링크 | 새 탭으로 열림 | WebView 밖으로 이동하지 않음(shell이 막고 `external-link-blocked` 기록). 휴대폰 연결은 QR로만 |
| 모델 경로 | `serve.mjs`가 `CARSCOPE_IONIQ5_GLB` 제공 | 앱 전용 저장 공간 파일. 같은 URL 경로 |
| 모델 오류 문구 | 서버 설정 안내 | 디버그 저장 공간 안내로 교체 |
| 개발자 패널 | `?dev=1`, `` ` `` 키 | 같음(키보드 없음). 대신 logcat 이벤트 |
| 수명주기 | 해당 없음 | 닫기·다른 앱 전환·설정 변경 재생성 처리, 매번 GL 해제 |

## 4. AVD 검증 결과

환경:
- `CarScope_Pleos_API34`(Android 14, `release_connect_v2.1.0`), WebView `ai.pleos.android.webview 131.0.6752.0`
- 창 `[853,90]–[2535,1300]`, devicePixelRatio 1.375 → CSS 1224×880(넓은 화면 레이아웃)
- 원본은 `C:\CarScope-External\p3-a5-2\run1\`(`results.json`, `logcat.txt`, 캡처)에 있다.

**측정 조건(중요):** 이번 콜드 부팅 후 AVD 자체가 과부하였다. 게스트 1분 부하는 12.7–14.2였고, CarScope와 무관하게 Pleos 내비게이션과 DrivingView가 각각 CPU 약 60%를 썼으며 게스트 메모리 여유는 170 MB 미만이었다. 첫 부팅은 홈 셸이 그리기 전에 화면이 비거나 `screencap`이 멈췄다. 이는 기록된 AVD 증상이라 한 번 재부팅으로 복구했다. 기능 판정은 이 조건에서 했고, 프레임 수치는 환경 영향을 받은 값이다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 홈: 3D 차량, 차량 점검 버튼 | PASS | 페이지 시작 후 1,275 ms에 준비. Draw call 126, 삼각형 38,213. 캡처 `01-home` |
| 터치 드래그 회전 | PASS | 방위각 138.6° → 26.1° |
| 확대·축소(버튼) | PASS | 거리 7.40 → 4.74 → 7.40 |
| 점검 모드: 보닛 하이라이트 | PASS | 캡처 `04-overview-hood-highlight` |
| 3D 보닛 터치 2회 연속 | PASS | 전이 1회만 발생(중복 무시) |
| 보닛 열리는 중 취소(상단 뒤로) | PASS | `HOOD_CLOSING`을 거쳐 보닛 0°로 점검 모드 복귀 |
| 보닛 선택 → 카메라 이동·개방 | PASS | 60°, 워셔액 캡 라벨, 준비 중 5개 비활성. 개방 구간 18.1 fps(1.57 s). 캡처 `06` |
| 워셔액 캡 터치 → 점검 안내 | PASS | 캡처 `07-washer-detail` |
| QR 표시와 주소 | PASS | AVD 화면 캡처에서 QR 디코드 → `https://carscope-qr-ar-staging.vercel.app/#v=1&task=washer-fluid`. 링크와 일치 |
| 뒤로 단계별 복귀, 점검 종료 | PASS | 상세 → 항목 → 보닛 닫힘 → 점검 모드 → 홈. 깊은 단계에서 종료해도 보닛 0°로 홈 복귀 |
| 다른 앱 전환 후 복귀 | PASS | `pause finishing=false` → `resume`, 재생성 없음. 이후 조작 정상 |
| 닫기 → 재실행 3회 | PASS | 매회 GL 해제 → `destroy` → 앱 프로세스·렌더러 0. 재실행 준비 1,071–1,310 ms |
| 설정 변경 재생성 2회 | PASS | `destroy` → `create` 2회. 매번 다시 준비됨 |
| JS 오류 | 0 | |

상태 전이 구간 평균 fps는 8.4–19.6이었다. P3-A5.1에서 확인했듯이 이 AVD의 WebView 프레임 상한(약 12–15 fps)과 이번 과부하가 겹친 값이다. chromium 오류 로그는 컨텍스트를 해제할 때마다 찍히는 `eglDestroyContext … EGL_BAD_MATCH`(기존 SVG 화면에서도 나옴)와 `variations_seed_loader` 경고뿐이다.

## 5. 회귀

| 항목 | 결과 |
| --- | --- |
| 브라우저 점검 UI(`check-inspection.mjs`, 1600×1000·420×860) | 각 17/17 PASS, console clean |
| 단위 테스트 | three-poc 9/9, QR-AR 16/16, ioniq5-asset 45 PASS(7 skip) |
| P3-A5.1 랩(`avd-android-lab.mjs`, 공용 호스트 리팩터링 후) | 상호작용 6/6, 앱 전환·복귀, 닫기·재실행 2회 해제 PASS |
| 주 화면 Mock | `모의: 앞 왼쪽 열림` → SVG `FRONT_LEFT: OPEN`, `모두 닫힘` → CLOSED |
| 주 화면 Pleos | 초기화 → Console `door_fl=true`(200) → `event raw=1` → SVG OPEN. `false` → CLOSED. MOCK 전환 시 해제. 크래시 0 |
| Gradle(CI와 같은 옵션) | `testDebugUnitTest assembleDebug assembleRelease bundleRelease lintDebug` 성공, JVM 30/30. `:vehicle-core:test` 성공 |
| `check.py build-contract` | PASS 3/3. 점검 자산을 포함한 debug APK로 검사 |
| 산출물 | debug APK: 점검 자산 18개와 `InspectionActivity` 포함. release APK/AAB: 점검 자산 0, `lab` 패키지 클래스 없음, GLB 없음 |

## 6. 미검증과 제한

- 실기기(Pleos 하드웨어) 실행과 성능: NOT_RUN.
- 핀치 줌과 휠: NOT_RUN(AVD `input`은 단일 포인터만 지원). 버튼 줌만 검증했다.
- 실제 휴대폰으로 Android 화면 QR 스캔: NOT_RUN. 디코드 결과가 PR #18에서 사용자가 실기기 확인한 스테이징 계약과 같은 것까지만 확인했다.
- "직접 열기" 링크 차단: 코드 경로만 있고 AVD에서 링크를 누르지는 않았다.
- 휴대폰 결과 동기화, 차량 데이터와 3D 연동: 이번 범위 아님.
- 이번 측정은 AVD 과부하 상태였다. 프레임 수치는 비교 기준으로 쓰지 않는다.
