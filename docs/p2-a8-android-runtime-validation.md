# P2-A8 · IONIQ 5 Android 런타임 검증과 프로필별 SVG 자산 로딩

판정: **P2A8_VALIDATED**.
- 기존 렌더러 경로로 IONIQ 5 SVG가 Pleos AVD의 Android WebView에 실제로 표시된다. 진입점은 debug 전용 화면이다.
- 기본 차량(`pleos-avd-reference`)의 SVG 출력은 PR #14 이전과 바이트 단위로 같다.
- Release APK/AAB에는 모델 파생 자산과 debug 로딩 경로가 없다.
- 이 판정은 **배포 승인이 아니다**. IONIQ 자산은 라이선스 미확정이라 로컬 debug 검증에만 썼다.

기준: main `00162c5`(PR #14 병합). 저장소 `C:\dev\CarScope`. 홈 PC(i5-4690, Windows 10), 2026-10-31.

## 1. 현재 Android 렌더링 아키텍처 (사전 감사)

```text
VehicleDataSource(Mock | Pleos) → VehicleSnapshot → VehicleDiagramMapper(STALE 5000ms) → VehicleDiagram
  → VehicleSvgRenderer.render(diagram, VehicleVisualAsset) → CSP HTML → WebView.loadDataWithBaseURL
                                    ↑ P2-A8: 자산이 렌더러 입력이 됨 (이전: AnatomyCarAsset.instance 싱글턴 고정)
```

| 항목 | 확인 내용 |
|---|---|
| Geometry 경로 | `tools/anatomy-car/build.mjs` → `vehicle-core/src/main/resources/.../anatomy-car.parts` → `AnatomyCarAsset.instance`(lazy, internal) → 렌더러 |
| 4개 상태 | 도어마다 `@door id open/closed` 섹션 중 `section.open == (state == OPEN)`을 고르고 상태 색 accent를 덧칠함. STALE/UNAVAILABLE은 닫힌 형상 + 점선·투명도 |
| 프로필 정의 | JS `tools/ioniq5-asset/profile.mjs`(`VEHICLE_PROFILES`)와 `tools/anatomy-car/profiles`만 있었고 Kotlin 쪽에는 없었음 |
| WebView 보안 | JavaScript off, file/content access off, `blockNetworkLoads`, CSP `default-src 'none'; style-src 'unsafe-inline'`, URL 이동 차단. **변경 없음** |
| Debug 경계 | `src/debug`의 adb 전용 Activity(launcher 없음)와 `tools/identity-probe/check.py build-contract`(release manifest·DEX 검사, CI) |
| AVD | `CarScope_Pleos_API34`(Pleos Connect v2.1.0, API 34, 2560×1440 @160dpi, RAM 4 GB, 2코어, host GPU). 기존 설치 재사용, 추가 설치 없음 |
| P2-A7 평가 방식 | 리소스를 임시로 교체해 `exportSvgSamples` 실행 후 SHA로 원복(로컬 전용) |

## 2. 변경한 자산 로딩 구조

[VehicleVisualAsset.kt](../vehicle-core/src/main/kotlin/io/carscope/visualization/VehicleVisualAsset.kt)

| 타입 | 역할 |
|---|---|
| `VisualProfile` | `PLEOS_AVD_REFERENCE("pleos-avd-reference", OPEN_AND_CLOSED)` = `DEFAULT`, `HYUNDAI_IONIQ5_2022("hyundai-ioniq5-2022", CLOSED_ONLY)`. 프로필은 명시적으로 선택하며 데이터 소스나 AVD 식별자(`Hyundai 42dot / Connect / 2024`)에서 추론하지 않음 |
| `DoorPose` | `CLOSED / OPEN / UNAVAILABLE`. 상태(`DoorVisualState`, 실제 데이터)와 그려진 형상을 분리 |
| `VehicleVisualAsset` | `default` = 번들 자산(기존 파서와 `AnatomyCarAsset.instance` 그대로). `parseExternal(profile, bytes)` = 외부 자산 검증 후 파싱 |
| `VehicleAssetResolver` | 기본 프로필은 항상 번들 자산을 사용하고 외부 로더를 호출하지 않음. 그 외 프로필은 로더 결과가 없거나 잘못되면 `Fallback(reason)`으로 기본 도면 표시 |

외부 자산 검증(`parseExternal`):
- 1 B ~ 2 MB, 엄격한 UTF-8.
- `#visual-profile <id>` 일치, 닫힌 형상만 있는 프로필은 `#door-pose closed-only` 선언.
- 기존 `AnatomyCarAsset.parse` 재사용, viewBox 1–4096.
- 마크업은 `g/path/circle` 태그 + 허용 속성 + 값 문자 `[A-Za-z0-9 #.,-]`만 허용. 텍스트 노드, 스크립트, `on*`, `url()`, `href`는 불가.
- accent는 `M/L/Z` 경로 데이터만.
- closed-only 자산에 `open` 섹션이 있으면 거부.

렌더러([VehicleSvgRenderer.kt](../vehicle-core/src/main/kotlin/io/carscope/visualization/VehicleSvgRenderer.kt)):
- `render(diagram)`은 `render(diagram, VehicleVisualAsset.default)`에 위임한다. 출력은 기존과 동일하다.
- 기본이 아닌 프로필일 때만 다음을 추가한다:
  - `PROFILE <id>` 표시
  - 도어 그룹의 `data-pose` 속성
  - OPEN이 닫힌 형상 위에 그려지면 `OPEN · 개폐 형상 미지원` 안내(빨강, inset 하단)와 설명(`desc`)의 "open shape unavailable"
- closed-only 프로필에서는 OPEN 상태여도 `closed` 섹션을 그리고 상태 색 accent만 바꾼다. 칩의 첫 텍스트는 실제 상태(`OPEN`)다.

생성기([anatomy-svg.mjs](../tools/ioniq5-asset/anatomy-svg.mjs)): P2-A7의 "open = closed 반복" 섹션을 없앴다. 대신 `#visual-profile hyundai-ioniq5-2022`와 `#door-pose closed-only`를 쓰고 `closed` 섹션만 낸다. 미리보기 SVG는 그대로다(SHA `7562f740…` 동일).

앱:
- [MainActivity](../app/src/main/java/io/carscope/app/MainActivity.kt)는 `open` 클래스가 되었고, no-op 훅 세 개(`visualAsset()` = 기본, `visualStatus()` = null, `onDiagramLoaded()`)와 `redrawDiagram()`만 추가했다.
- Debug 전용 [VisualProfileActivity](../app/src/debug/java/io/carscope/app/profile/VisualProfileActivity.kt)는 MainActivity를 상속한다. `--es profile <id>`로 프로필을 선택하고, `singleTop`이라 같은 화면에서 프로필을 전환할 수 있다. 측정용 extra `repaint`/`bench`가 있다.
- [DebugVisualAssetStore](../app/src/debug/java/io/carscope/app/profile/DebugVisualAssetStore.kt)는 `files/debug-visual-assets/<id>.parts`(앱 전용 내부 저장소)만 읽는다.

## 3. 기본 프로필 호환성

- `VehicleVisualAssetTest`는 `exportSvgSamples`와 같은 4개 fixture의 SHA-256을 main `00162c5` 기준값과 비교한다. closed `48653AC2…`, front-left-open `5EF068EB…`, stale `FA4DE260…`, unavailable `70E042AF…`이며 **모두 일치**했다. `render(d) == render(d, default)`도 성립한다.
- `anatomy-car.parts` SHA `a6f19a53…2197`은 변경되지 않았다. Anatomy audit 결과도 같다.
- release 진입점(MainActivity)은 항상 번들 도면을 사용하고, 파일을 읽는 코드가 없다.

## 4. 로컬 Debug 자산 주입

```powershell
node tools/ioniq5-asset/anatomy-svg.mjs --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb --out=C:\CarScope-External\ioniq5-svg
.\gradlew.bat :app:assembleDebug; adb install -r app\build\outputs\apk\debug\app-debug.apk
powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/push-debug-asset.ps1 -Parts C:\CarScope-External\ioniq5-svg\ioniq5.parts
adb shell am start -n io.carscope.app/.profile.VisualProfileActivity --es profile hyundai-ioniq5-2022
node tools/ioniq5-asset/avd-validate.mjs --out=C:\CarScope-External\p2-a8\runN    # 측정·캡처 자동화
```

- [push-debug-asset.ps1](../tools/ioniq5-asset/push-debug-asset.ps1)의 동작:
  1. `adb push`로 `/data/local/tmp`에 보낸다.
  2. shell이 그 파일을 읽어 `run-as io.carscope.app --user <현재 사용자>`로 파이프한다. 그래서 앱은 `/data/local/tmp`를 직접 읽지 않는다.
  3. 앱 전용 디렉터리에 0600 권한으로 저장한다.
  4. 임시 파일을 삭제하고 기기 쪽 SHA-256을 대조한다.
- `run-as`는 Android가 debuggable 앱에만 허용한다. 저장소 권한 요청, 공유 저장소, 다운로드는 없다.
- 발견 1: AAOS는 앱을 **사용자 10**으로 실행한다(`u10_a175`). `run-as`의 기본값은 사용자 0이라, 처음에는 파일이 다른 사용자 디렉터리에 들어가 `ASSET_MISSING`이 됐다. 이 이미지의 사용법은 `run-as <pkg> --user <uid> <cmd>`(옵션이 패키지 뒤)다.
- 발견 2: Windows PowerShell 5.1에서 adb의 stderr 진행 메시지가 `Stop` 정책 아래 오류로 처리되었다. 그래서 네이티브 호출은 종료 코드로만 판정하도록 바꿨다.

## 5. AVD 실행 환경

`CarScope_Pleos_API34`, `RELEASE.release_connect_v2.1.0 test-keys`, WebView `ai.pleos.android.webview 131.0.6752.0`, 앱 사용자 10, `emulator -gpu host -no-snapshot-save`(cold boot). 호스트 여유 메모리는 측정 중 1.9–3.9 GB였다. 마지막 측정 전 Gradle 데몬을 정지했다. 캡처·로그는 모두 `C:\CarScope-External\p2-a8\` 아래에 있다.

## 6. 실제 표시 결과

| 구분 | 결과 |
|---|---|
| **A 기본 차량** | Mock CLOSED/OPEN(열린 도어 형상)/UNAVAILABLE/STALE(5 s 후) 표시 PASS |
| A Pleos 실연동 | Pleos 모드에서 `initialize → capability READ_WRITE 0..1 → listener`. Console `PUT door_fl=true` → `event raw=1` → FRONT_LEFT OPEN(열린 형상), `false` → `raw=0` → CLOSED. 나머지 도어는 UNAVAILABLE(UNSUPPORTED) PASS |
| A 재생성 | `cmd uimode night yes/no`로 재생성: 리스너 해제·재등록, Pleos 모드와 도면 복원 PASS |
| **B IONIQ 5** | debug 프로필에서 전체 SVG 표시. 앞-왼쪽 시점, 후드·도어·휠·미러·램프, 팔레트, 바닥 그림자. 잘림·반전·색 손실 없음 PASS |
| B 상태 4종 | CLOSED(녹색 accent), OPEN(빨강 accent + `OPEN · 개폐 형상 미지원` 표시와 요약 줄), UNAVAILABLE(회색 점선), STALE(갈색) PASS |
| B 화면 밀도 | `wm density 120`: 재생성 후 viewBox에 맞춰 벡터로 다시 그림, 흐림 없음 PASS. 기본 160으로 복원 |
| 대체 경로 | 자산 없음 → `FALLBACK (ASSET_MISSING)`, 알 수 없는 프로필 → `UNKNOWN → FALLBACK`, 손상 자산 → `FALLBACK (ASSET_INVALID: missing '#visual-profile …')`. 모두 기본 세단 표시와 이유 표시. 원복 후 `LOADED` |
| 프로필 전환 | 실행 중 화면에서 10회 왕복: 잘못 그려진 프로필 0회. 전환 후 이전 도면 흔적 없음(JVM 테스트 포함) |
| 크래시 | crash 버퍼에 앱 항목 없음 |

### 시각 비교 (모델 파생 이미지는 저장소 밖 `C:\CarScope-External\p2-a8\visual-compare-3.png`)

| 비교 | 결과 |
|---|---|
| IONIQ 브라우저 SVG ↔ Android WebView | 차량 영역 실루엣 bbox 정렬 IoU 0.944(Android 621×320 px 대 1280×660 px, 안티앨리어싱 차이), 종횡비 1.613 대 1.611(0.13%), 중심 차이 < 1% |
| 방향 반전 대조 | 좌우 반전한 브라우저 이미지와의 IoU 0.440. 반전 없음 |
| 기존 세단 ↔ IONIQ | 같은 카메라(56°/28°), 같은 팔레트·선 굵기(0.6), 같은 상태 accent. 차량 bbox가 차량 영역에서 차지하는 비율 65% 대 46%: 세단 카메라는 열린 도어의 회전 범위까지 포함해 맞춰져 있음 |

## 7. 성능 측정 (AVD, 실기기 아님)

방법:
- 측정은 [avd-validate.mjs](../tools/ioniq5-asset/avd-validate.mjs)와 logcat `CarScopeProfile`로 했다.
- 시간은 `SystemClock.elapsedRealtimeNanos`로 쟀다. "visible"은 `WebView.postVisualStateCallback` 완료 시점이다.
- p95는 표본에서 `floor((n−1)·0.95)` 위치 값이다. n이 작으면(5–7) 사실상 최댓값 근처다.
- 두 실행을 그대로 싣는다. 실행 사이 편차가 크며(호스트 부하, 에뮬레이터 상태), 같은 실행 안의 프로필 비교만 의미가 있다.

| 지표 (단위 ms) | 반복 | run2 기준 p50/p95 | run2 IONIQ p50/p95 | run4 기준 p50/p95 | run4 IONIQ p50/p95 |
|---|---|---|---|---|---|
| 콜드 시작 `am start -W` TotalTime | 7 | 2277 / 2487 | 2528 / 2775 | 4384 / 4593 | 4182 / 4933 |
| 콜드 Activity 생성 → 첫 표시 | 7 | 2370 / 2603 | 2279 / 2794 | 4818 / 5448 | 5142 / 5404 |
| 첫 WebView load → 표시 | 7 | 1617 / 1804 | 1421 / 1851 | 3587 / 4554 | 3749 / 4347 |
| 자산 해석(읽기+검증+파싱), 콜드 | 7 | 1.0 / 1.1 | 146 / 196 | 1.0 / 1.1 | 183 / 253 |
| 첫 렌더(SVG 문자열 생성) | 7 | 5.0 / 5.5 | 3.8 / 4.9 | 8.1 / 10.9 | 4.9 / 8.3 |
| 반복 표시(같은 SVG 재로드 → 표시) | 20 | 215 / 384 | 192 / 396 | 402 / 727 | 362 / 711 |
| 반복 렌더(별도 스레드, 4상태×50) | 200 | 2.5 / 21.7 | 2.9 / 35.7 | 2.7 / 30.5 | 3.2 / 41.7 |
| 반복 파싱(웜, 50) | 50 | 번들(측정 안 함) | 32 / 58 | — | 32 / 73 |
| 프로필 전환 → 표시 | 각 5 | 133 / 176 | 201 / 320 | 267 / 363 | 240 / 441 |
| 재생성(구성 변경) → 표시, IONIQ | 4 | — | 1038 / 1087 | — | 1564 / 1916 |

메모리(`dumpsys meminfo <pid>` TOTAL PSS, 각 프로필 콜드 실행 3회 + run4 1회): 기준 110–128 MB, IONIQ 110–129 MB. GC 시점에 따른 편차보다 큰 차이는 없었다.

정리:
- 첫 표시 시간의 대부분은 WebView 첫 로드(1.4–3.7 s)다. 렌더(수 ms)와 SVG 크기(IONIQ 161 KB, 세단 177 KB)는 작은 비중이다.
- IONIQ의 추가 비용은 외부 자산 콜드 검증·파싱(약 150–180 ms, 메인 스레드)이다.

## 8. 실패한 테스트와 수정 내역

| 실패 | 원인 | 수정 |
|---|---|---|
| Kotlin 테스트 4개 실패 | fixture의 여러 줄 `$header`가 `trimIndent`를 깨뜨려 헤더 앞에 공백이 생김 | 줄 목록을 명시적으로 결합 |
| AVD `ASSET_MISSING`(파일은 있음) | AAOS 사용자 10 대 `run-as` 기본 사용자 0 | `run-as <pkg> --user <현재 사용자>` |
| 주입 스크립트 오류 종료 | PS 5.1에서 adb stderr가 `Stop` 오류로 처리됨 | 네이티브 호출은 종료 코드로만 판정 |
| IONIQ 파싱 p50 175 ms(웜) | 수십 kB의 path 값에 정규식을 적용하는 비용(데스크톱 대비 ART 약 30배) | 단일 패스 스캐너로 교체. 웜 32 ms, 데스크톱 6.4 → 3.3 ms. 같은 거부 규칙 유지, 경계 사례 테스트 4개 추가 |
| 측정 PSS 0 | 다중 사용자에서 패키지명 조회가 사용자 0 프로세스를 가리킴 | PID로 조회 |
| 드라이버 캡처 순서 | "closed" 캡처가 STALE, 손상 자산 캡처가 첫 페인트 전 | 캡처 전 "모두 닫힘" 탭, 첫 표시 이벤트 대기. 손상 자산 대체 표시는 수동 재현으로 세단 표시 확인 |
| `uiautomator dump` 간헐 비정상 종료 | 덤프 후에도 비정상 종료 코드 | 파일 내용으로 판정, 3회 재시도 |

## 9. 보안·라이선스 검증

| 항목 | 결과 |
|---|---|
| WebView 설정·CSP | 변경 없음(JS off, file/content off, network block) |
| 외부 마크업 | 화이트리스트 검증. 악성 사례 17종을 JVM 테스트로 거부 확인(스크립트, 이벤트 핸들러, `url()`, `image`, 텍스트 노드, 따옴표 없는 값, 미종결 태그 등). 실제 IONIQ 자산은 통과 |
| 권한 | 추가 권한 없음. 공유 저장소·네트워크 사용 없음 |
| Release 경계 (`check.py build-contract`, CI) | release manifest에 `VisualProfileActivity` 없음. release DEX에 `io/carscope/app/profile/` 클래스와 `debug-visual-assets` 문자열 없음 |
| 패키징 | debug APK, release APK, **release AAB**(CI에 `:app:bundleRelease` 추가): `.parts`는 번들 1개뿐이고 SHA가 저장소 파일과 같음. 모델 파생 표식(`mesh-svg openx-ioniq5`, `#visual-profile hyundai-ioniq5-2022`, 원저작자명) 없음. release에는 `.glb/.gltf/.blend/.svg` 없음 |
| Git | 추적 `.parts`는 번들 1개. `.gitignore`에 `*.parts`(번들 제외)와 `*.glb` 추가. 원본·GLB·파생 SVG·`.parts`·AVD 캡처 미커밋 |
| release 설치에서 `run-as` 차단 | Android 플랫폼 규칙(debuggable 전용)에 근거. release APK를 서명·설치해 확인하지는 않음(NOT_RUN) |
| 라이선스 | OpenX `MPL-2.0 AND CC-BY-4.0`, 원저작 andikapratamaw(CC BY 4.0). 배포 승인 전이므로 APK/AAB 미포함, 렌더 이미지 미커밋. debug 화면의 상태 줄에 "not for distribution" 표시 |

## 10. 다음 단계에 필요한 변경

1. 라이선스 결정 전에는 IONIQ 자산을 제품에 넣을 수 없다. 승인되면 자산 배포 방식(APK 리소스 또는 별도 다운로드 금지 정책 유지)을 정하고, `VehicleAssetResolver`에 번들 로더를 추가한다.
2. 프로필 선택 UI와 설정 저장: 제품 기본은 계속 `pleos-avd-reference`.
3. 콜드 외부 자산 파싱(약 150–180 ms)을 백그라운드로 옮기거나 검증 결과를 캐시한다.
4. 열린 도어 형상: 힌지 축 검증 전에는 `DoorPose.UNAVAILABLE`을 유지한다.
5. 실기기 성능과 release 서명 설치 경계 확인(NOT_RUN).

## P3-A Front Compartment 사전 검토 (구현하지 않음)

보닛 열림과 앞 구획 내부 부품 선택·줌인을 위한 렌더링 방식 비교. 근거는 P2-A2 WebGL lab, P2-A6/A7, 이번 AVD 측정이다.

| 기준 | ① 고정 SVG 상태별 프레임 전환 | ② 카메라·부품 자세별 SVG 사전 생성 | ③ GLB 실시간 3D |
|---|---|---|---|
| 보닛 열림 애니메이션 | 닫힘/열림 2프레임 전환만 가능. 중간 프레임이 없어 애니메이션이라 보기 어려움 | 각도별(예 0/15/30/45/60°) 프레임을 미리 생성해 전환. 프레임 수만큼 자산이 늘어남. 힌지 축 검증 필요 | 연속 회전 가능. 힌지 축 검증 필요(OpenX `Grp_Door_Front_0` 원점은 있으나 축 미문서화) |
| 내부 부품 선택·줌인 | 고정 시점 하나라 줌은 벡터 확대뿐이고 가려진 부품은 볼 수 없음 | 시점별 생성으로 줌 시점 추가 가능. 부품 ID는 mesh-svg가 이미 지원(히트 테스트 9/9) | 자유 시점·레이캐스트 선택(P2-A6 PoC 8/8) |
| 필요한 내부 형상 | 공통: 현재 OpenX 모델에는 프렁크·모터·12V·냉각계 메시가 없음(NOT_AVAILABLE). 어떤 방식이든 출처가 분명한 내부 자산이 먼저 필요 | 동일 | 동일 |
| AVD 성능 | 이번 측정: 렌더 수 ms, 표시는 WebView가 좌우(반복 약 0.2–0.4 s) | 프레임 전환은 ①과 같음. 사전 생성은 빌드 시간(프레임당 약 1 s) | P2-A2 lab에서 WebGL 동작 확인. 실제 IONIQ 37k tri 프레임률은 미측정. JS·WebGL 필요 |
| 개발 복잡도 | 낮음(현재 계약 그대로) | 중간: 생성기 반복 + 프레임 선택 + 자산 크기 관리 | 높음: 3D 뷰어, 카메라 UX, 상태 동기화, 성능 튜닝 |
| 외관 Geometry 재사용 | P2-A7 출력 그대로 | P2-A7 파이프라인(mesh-svg)을 자세별로 재실행. 직접 재사용 | GLB 직접 재사용 |
| 현재 보안 구조 호환 | 완전 호환(JS off, CSP none) | 완전 호환(정적 SVG만) | **비호환**: 메인 WebView는 JS를 끔. 별도 JS 화면(현재 debug lab만 존재)과 보안 검토 필요 |

권고 근거:
- ②가 현재 보안 계약(JS off)과 검증된 파이프라인(mesh-svg, 프로필 자산 로딩)을 그대로 쓰면서 보닛 단계 표시와 줌 시점을 제공한다. 위험이 가장 작다.
- ③은 자유 시점이 필요해지거나 내부 부품이 많아질 때 검토한다. 그때는 JS 활성 화면의 보안 검토와 AVD·실기기 프레임률 측정이 선행되어야 한다.
- 어느 방식이든 다음 두 가지가 먼저다:
  - **힌지 축 검증**
  - **출처가 분명한 내부 부품 자산**: 현재 원본에는 없음
