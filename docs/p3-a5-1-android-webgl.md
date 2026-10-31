# P3-A5.1 — Android WebView 3D 렌더링 타당성

2026-11-01, 기준 main `cf8496d`. Pleos AVD의 WebView에서 IONIQ 5 참조 모델을 Three.js로 그리고, 기본 조작(회전·확대/축소·부품 선택)과 Activity 수명주기를 검증했다. **차량 점검 UX(P3-A4) 이식과 Pleos 상태 연동은 이번 범위가 아니다.**

판정: **AVD 기준 PASS** (렌더링·조작·수명주기·회귀·Debug/Release 분리). 성능은 측정했지만 AVD의 WebView 프레임 상한(약 12–15 fps)에 묶여 있어 실기기 성능을 뜻하지 않는다. 핀치 줌과 실기기 실행은 미검증이다(§6).

## 1. 구조

| 구성 | 위치 | 비고 |
| --- | --- | --- |
| 디버그 화면 | [Ioniq5LabActivity](../app/src/debug/java/io/carscope/app/lab/Ioniq5LabActivity.kt) | `src/debug`에만 있음. 런처 항목 없음, adb로만 실행 |
| 페이지 소스 | [android-lab.html/.js/.css](../tools/three-poc/android-lab.js) | Three.js 0.160.0, GLTFLoader, OrbitControls, RoomEnvironment |
| 디버그 자산 생성 | [build-android-lab.mjs](../tools/three-poc/build-android-lab.mjs) | `app/src/debug/assets/ioniq5-lab/` (git 무시). GLB는 복사하지 않음 |
| 모델 주입 | [push-android-lab-model.mjs](../tools/three-poc/push-android-lab-model.mjs) | `run-as`로 앱 전용 `files/debug-3d-assets/ioniq5.glb`. SHA-256 확인 |
| AVD 검증 자동화 | [avd-android-lab.mjs](../tools/three-poc/avd-android-lab.mjs) | 결과·캡처는 저장소 밖 `--out`에만 기록 |
| 경계 검사 | [check.py](../tools/identity-probe/check.py) `lab_boundary` | CI `build-contract`에서 실행 |

기존 [WebGlLabActivity](../app/src/debug/java/io/carscope/app/lab/WebGlLabActivity.kt)(P2-A2)와 같은 방식이다. 이 화면에서만 JavaScript를 켜고, 비공개 origin `https://carscope-ioniq5-lab.invalid/`의 요청을 `shouldInterceptRequest`로 처리한다.

- 페이지 파일은 디버그 자산에서 읽는다. `model.glb` **한 경로만** 앱 전용 파일로 응답하고(최대 32 MB), 나머지는 모두 404다. `..` 경로, 다른 host·scheme, 외부 네트워크도 404다.
- CSP는 `default-src 'none'; script-src 'self' 'sha256-<import map>'; connect-src 'self'`다. 파일·콘텐츠 접근과 DOM storage는 끄고, 페이지 이동은 모두 막는다.
- 주 화면 `MainActivity`의 WebView 설정(JavaScript 비활성, 네트워크 차단)은 바꾸지 않았다.
- 모델의 좌표계·메시·머티리얼은 바꾸지 않았다. 선택 강조를 위해 선택한 메시의 머티리얼만 런타임에 복제한다.

수명주기:
- `onPause`/`onResume`은 `WebView.onPause/onResume`으로 전달한다.
- `onDestroy`에서는 WebView를 떼어내고 `destroy()`한다.
- 페이지의 **닫기** 버튼은 `dispose()`(geometry·material·env map·renderer 해제, `forceContextLoss`)를 **동기적으로** 먼저 실행한다. 그다음 `./close`로 이동하고, Activity가 이를 가로채 `finish()`한다. JS 브리지(`addJavascriptInterface`)는 쓰지 않는다.
- `onPause(isFinishing)`에서도 `dispose`를 요청하지만, 이 호출은 보조 수단일 뿐이다(§5-2).
- 렌더러 프로세스가 죽으면 `onRenderProcessGone`에서 WebView를 정리하고 화면을 닫는다. 앱은 종료되지 않는다.

## 2. 실행

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
node tools/three-poc/push-android-lab-model.mjs --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb
adb shell am start -n io.carscope.app/.lab.Ioniq5LabActivity --es query "'sampleMs=10000'"
# 로그: adb logcat -s CarScopeIoniq5Lab   (CARSCOPE_LAB {...} JSON)
node tools/three-poc/avd-android-lab.mjs --out=C:\CarScope-External\p3-a5-1\runN
```

`--es query`의 값은 **작은따옴표로 감싸야 한다**. `adb shell`은 인자를 기기 shell 명령 한 줄로 합치므로, 따옴표가 없으면 `&` 뒤가 잘린다(§5-1). query 옵션은 다음과 같다.
- `sampleMs`: 프레임 측정 시간
- `sample=0`: 측정 끔
- `dpr=<n>`: 픽셀 비율
- `hide=1`: 측정 전용. 모델을 로드하되 그리지 않는다

## 3. 실행 환경

`CarScope_Pleos_API34`(Android 14, SDK 34, `release_connect_v2.1.0`), 2560×1440, density 160, 앱 사용자 10이다. 에뮬레이터 옵션은 `-gpu host -no-snapshot-save`, 콜드 부팅이다.

- WebView: `ai.pleos.android.webview 131.0.6752.0`
- WebGL: `WebGL 2.0 (OpenGL ES 3.0 Chromium)`
- Renderer: `ANGLE (Android Emulator OpenGL ES Translator (NVIDIA GeForce GTX 1060 6GB), OpenGL ES 3.1)`
- MAX_TEXTURE_SIZE: 4096
- 호스트: 집 PC(i5-4690, GTX 1060). 측정 전에 Gradle 데몬을 정지했다.
- 모델: 1,902,820 B, SHA-256 `cfe0d754…0139e1`. 메시 노드 44, 렌더 메시 117, 텍스처 없음.

원본 결과는 `C:\CarScope-External\p3-a5-1\`의 `run4/results.json`, `run4/logcat.txt`, 캡처에 있다. 아래 수치는 최종 코드로 실행한 **run4** 기준이다.

## 4. 결과

### 4-1. 렌더링과 조작 (실제 AVD 화면 캡처로 확인)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 3D 차량 표시 | PASS | `cold-*.png`, `interact-0-start.png`. 첫 프레임 후 `gl.finish()` 기준 시각 기록 |
| 터치 드래그 회전 | PASS | `input swipe` 2회 → OrbitControls 방위각 75.4° → 42.0°, 측면 시점 캡처 |
| 확대·축소 | PASS (화면 버튼) | +2회 거리 7.198 → 5.758 → 4.607, −2회 → 5.758 → 7.198, 캡처 확인 |
| 핀치 줌 | NOT_RUN | AVD `input`에는 단일 포인터만 있음. 다중 터치는 실기기에서 확인 필요 |
| 부품 선택 Raycasting | PASS | 보닛 → `Door_Front_0`(강조·라벨 캡처), 앞바퀴 → `Wheel_0_1`, 배경 → 없음 |
| 로딩·실패 상태 | 구현 | 로딩 문구. 모델 404·로드 실패·WebGL 불가 시 오류 문구와 `model-error`/`webgl-unavailable` 로그. 실패 경로를 AVD에서 일부러 재현하지는 않음 |
| JS Console 수집 | PASS | `console.*`, `error`, `unhandledrejection`, 컨텍스트 손실을 logcat `CarScopeIoniq5Lab`로 전달. 전체 실행에서 JS 오류 0 |

선택 좌표는 페이지가 보고한 버튼 위치와 투영한 부품 중심(CSS px × devicePixelRatio 1.375)을 창 원점 `[853,90]`에 더해 계산했다.

### 4-2. 수명주기

| 경로 | 결과 |
| --- | --- |
| 다른 앱(설정)으로 전환 후 복귀 | PASS: `pause finishing=false` → `resume`, 재생성 없음. 복귀 후 선택 정상 |
| 닫기 → 재실행 5회 | PASS: 매회 `dispose`(geometry 129 → 1, texture 2 → 1) → `context-released` → `pause finishing=true` → `destroy`. 이후 Pleos 홈이 태스크를 제거하고 시스템이 프로세스를 종료함. 닫은 뒤 앱 프로세스 0, WebView 렌더러 0. 재실행 첫 프레임 1,406–1,712 ms, PSS 113.4–113.9 MB(증가 없음) |
| 설정 변경 재생성 (`cmd uimode night yes/no`) | PASS: 같은 PID에서 `destroy` → `create` 2회. 매번 새 첫 프레임(2,761 / 2,319 ms), 렌더러 1개 유지. 야간 모드는 `no`로 원복 |
| 시스템 Back | 해당 없음(관측): Pleos 홈이 태스크 루트의 Back을 처리함(`onBackPressedOnTaskRoot … do not hide task`). Activity가 종료되지 않음 |

### 4-3. 성능 (AVD, 10초 자동 회전 표본, 조건별 콜드 실행 3회)

| 조건 | 캔버스 | GLB 로드 (fetch+parse) | 첫 프레임 (페이지 시작 기준) | 평균 fps | 중앙 / p95 프레임 간격 | 1% / 5% low | Draw call / 삼각형 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 기본 (dpr 1.375) | 1683×1210 | 414–710 ms | 1,800–2,133 ms | 11.0 / 11.5 / 12.3 | 83 / 117–133 ms | 6.0–7.5 / 7.5–8.6 | 124 / 37,861 |
| dpr 1 | 1224×880 | 380–495 ms | 1,474–1,897 ms | 12.3 / 11.7 / 12.2 | 67–83 / 133 ms | 6.7 / 7.5 | 124 / 37,861 |
| dpr 0.75 | 918×660 | 345–502 ms | 1,596–1,968 ms | 11.4 / 12.6 / 14.0 | 67–83 / 100–133 ms | 6.0–7.5 / 7.5–10 | 124 / 37,861 |
| 모델 숨김 (`hide=1`) | 1683×1210 | 314–377 ms | 1,321–1,809 ms | 13.9 / 12.0 / 13.4 | 67–83 / 100–117 ms | 6.0–7.5 / 8.6–10 | 0 / 0 |

- 모델 준비부터 첫 프레임까지 362–624 ms가 걸렸다. `am start -W` TotalTime은 2,086–2,523 ms다.
- geometry 129, 셰이더 프로그램 7, 앱 PSS 약 110 MB다.
- 프레임 간격이 16.7 ms 배수(66.7·83.3 ms)로 끊긴다. 즉 vsync 4–5회마다 한 번 표시된다. 가끔 530–780 ms 정지가 있다.
- **해석:** 캔버스 면적을 1/3로 줄여도, 모델을 아예 그리지 않아도(draw call 0) 같은 약 12–15 fps 범위다. 병목은 모델이나 fill rate가 아니라 이 AVD의 WebView 합성·프레임 전달이다. 실기기 fps는 측정하지 않았으며, 이 값으로 추정하지 않는다.
- 측정하지 못한 것: GPU 시간과 GPU 메모리. 이 에뮬레이터 이미지는 `dumpsys meminfo`의 `GL/EGL mtrack`을 보고하지 않는다. 발열·배터리도 측정하지 않았다.

### 4-4. 기존 기능 회귀

| 항목 | 결과 |
| --- | --- |
| `:app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug` (CI 동일 옵션) | BUILD SUCCESSFUL. 앱 JVM 테스트 30/30 |
| `-PcoreOnly=true :vehicle-core:test` | BUILD SUCCESSFUL |
| `tools/identity-probe/check.py build-contract` | PASS 3/3(기존 2 + P3-A5.1 `lab_boundary`). 로컬은 랩 자산이 **포함된** debug APK로 검사 |
| AVD 주 화면 Mock | 기본 MOCK, `모의: 앞 왼쪽 열림` → SVG `FRONT_LEFT: OPEN`, `모두 닫힘` → 모두 CLOSED |
| AVD Pleos | `initialize` → capability `READ_WRITE 0..1` → listener → `event raw=0`. Console `door_fl=true`(HTTP 200) → `event raw=1`, SVG FRONT_LEFT OPEN(빨간색, 캡처). `door_fl=false` → `event raw=0`, CLOSED. MOCK 전환 시 `unregistered → pending=0 → released` |
| 크래시 | `AndroidRuntime` 0 |

Pleos 회귀의 첫 시도에서는 OPEN 직후 약 3초 만에 보낸 CLOSE에 이벤트가 오지 않았다. Console 상태는 `false`로 바뀌었다. 같은 요청을 다시 보내자 `event raw=0`이 왔고, 도어 변경 사이에 3초 간격을 둔 재실행에서는 전 과정이 통과했다. 앱 코드 변경과는 무관한 Console/VHAL 쪽 현상으로 보이며, 원인은 확인하지 않았다.

## 5. 발견한 문제와 처리

1. **adb query 잘림:** `am start --es query a&b`에서 기기 shell이 `&` 뒤를 백그라운드 명령으로 처리했다. 그래서 초기 run1·run2의 dpr 비교는 실제로 모두 기본값이었다. **이 결과는 폐기했다.** 지금은 query를 작은따옴표로 감싸고, 검증 스크립트가 페이지가 보고한 dpr과 요청값을 대조한다.
2. **onPause에서 요청한 dispose의 경쟁:** Pleos 홈은 마지막 Activity가 끝나면 태스크를 수백 ms 안에 제거한다. 그래서 `evaluateJavascript`로 요청한 해제가 `WebView.destroy()` 전에 실행되지 않는 경우가 있었다(run3, 5회 중 5회). 닫기 버튼에서 동기적으로 해제하도록 바꾼 뒤 5/5회 해제됐다(run4). 어느 경우든 이후 프로세스가 종료되어 자원이 회수된다.
3. **logcat 버퍼 회전:** chromium·시스템 로그가 많아 `logcat -d`로는 앞선 lifecycle 줄이 사라졌다. 검증 스크립트는 logcat을 처음부터 끝까지 스트리밍해 판정한다.
4. **시스템 Back이 무효:** Pleos 홈이 태스크 루트의 Back을 처리한다. 랩에는 화면 내 닫기를 두었다. P3-A5.2 UI에서도 Back에 기대지 않는 닫기·뒤로 흐름이 필요하다.
5. **경계 검사 오탐:** 기존 `check.py`는 모든 APK에서 `andikapratamaw`를 모델 파생 데이터의 표지로 금지한다. 랩 페이지의 CC BY 저작자 표시가 debug APK에서 이 검사에 걸렸다. 예외는 debug APK의 `assets/ioniq5-lab/` 경로, 이 표지 하나로만 좁혔다. release는 예외 없이 검사한다.
6. **chromium 오류 로그:** `eglDestroyContext … EGL_BAD_MATCH`가 GL 컨텍스트를 해제할 때마다 1쌍씩 찍힌다. **기존 SVG 주 화면(JS·WebGL 없음)에서도 같은 로그가 나온다.** 그 밖에는 마지막 닫기 때 프로세스 종료 중 `Renderer process crash detected (code -1)` 1회가 있다. `destroy` 이후 태스크 제거 단계의 로그이며, 사용 중 `onRenderProcessGone`은 0회였다.

## 6. 미검증과 제한

- 실기기(Pleos 하드웨어) 실행과 성능: NOT_RUN. 위 fps는 에뮬레이터 상한에 묶인 값이다.
- 핀치 줌 다중 터치: NOT_RUN. 마우스 휠 줌도 AVD `input`에 휠 명령이 없어 NOT_RUN이다.
- GPU 메모리·GPU 시간: 이 이미지에서 보고되지 않아 측정할 수 없었다.
- 의도적 실패 경로(모델 없음, WebGL 불가, 렌더러 크래시) 재현: NOT_RUN. 코드 경로와 표시 문구만 있다.
- 수 분 이상의 장시간 실행·메모리 추세: 미측정. 닫기/재실행 5회와 설정 재생성 2회까지만 확인했다.

## 7. P3-A5.2로

WebView + Three.js 경로는 AVD에서 동작한다. 렌더링, 조작, 선택, 수명주기, 자원 해제, Debug/Release 분리를 확인했으므로 P3-A5.2(점검 UI 이식)에 들어갈 수 있다. 다만 다음을 전제로 한다.

1. 성능 판단은 실기기에서 다시 한다. AVD의 약 12–15 fps는 모델 비용이 아니라 플랫폼 상한으로 확인됐다. 보닛·카메라 애니메이션의 체감은 AVD에서 판단하지 않는다.
2. 닫기·뒤로는 화면 내 동작으로 설계하고, GL 해제는 사용자 동작 시점에 동기적으로 한다.
3. 주 화면 WebView는 계속 JS를 끈 상태로 두고, 3D 화면은 별도 경계(비공개 origin, 단일 모델 경로, CSP)를 유지한다.
4. release 배포 방식(모델 파일 공급·라이선스 고지)은 별도로 결정해야 한다. 지금은 debug `run-as` 주입만 있다.
