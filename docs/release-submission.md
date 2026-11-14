# 공모전 제출용 Release APK (차보담)

2026 현대자동차그룹 차량용 앱 개발 공모전 제출물. 브랜치 `release/contest-apk`, 기준 `main` `03756be`.

| 항목 | 값 |
| --- | --- |
| 파일 | [`apk/박성진_차보담_release.apk`](../apk/박성진_차보담_release.apk) (팀명 자리 = 개인 참가자 성명, 앱 이름 = 차보담) |
| 패키지 / 버전 | `io.carscope.app` / versionName `1.0.0`, versionCode `2` |
| 실행 Activity | `io.carscope.app/.lab.InspectionActivity` (런처 이름 **차보담 차량 점검**) |
| 서명 | 로컬 Release 키 1개, APK Signature Scheme v3, `apksigner verify` 통과. 인증서 SHA-256 `ce8926f6528e56b5506a4c6c72bc0b0b7eea07803d52a14ead3f1b5f8e3700db` |
| debuggable | 아니오 (Release 빌드 타입) |
| minSdk / targetSdk | 28 / 34 |

APK 크기와 SHA-256은 커밋된 파일 기준으로 README에 적었다. 서명 키, 키 비밀번호, AVD 등록 증명, 토큰, DB 접속 정보는 APK와 Git 어디에도 없다.

## 1. Debug와 Release의 차이 (변경 전 분석)

변경 전 `main`의 Release에는 `MainActivity`(정적 SVG 도어 화면)만 있었다. 시연 영상의 3D 점검, 보닛 개방, 부품 선택, 상태 카드, QR 연동은 모두 `src/debug`에만 있었다.

| 요소 | 변경 전 Release | 이유 |
| --- | --- | --- |
| `InspectionActivity`, WebView 호스트 | 없음 | `src/debug` 전용 |
| 3D 페이지 자산 (`inspection/`) | 없음 | 생성 자산이 debug 소스셋에만 들어감 |
| IONIQ 5 GLB | 없음 | `adb run-as`로 앱 전용 폴더에 넣는 방식이라 debuggable 빌드에서만 가능 |
| Pleos 상태 소스 (EV·와이퍼·조명·주행거리·타이어) | 없음 | debug 소스와 debug 매니페스트 권한 |
| QR 연동 (수신, HTTPS, AVD 운영자 등록) | 없음 | 운영자 등록 증명 파일도 `run-as`로만 넣을 수 있고, Vision origin은 debug `BuildConfig`에만 있음 |
| Gson / ZXing | 없음 | `debugImplementation` |

`assembleRelease` 결과의 이름만 바꾸면 시연 기능이 하나도 없는 APK가 된다. 그래서 아래처럼 Release에 정식으로 넣었다.

## 2. Release에 넣은 것과 넣지 않은 것

**공유 소스셋 `app/src/inspection/java`** (debug와 release 모두 컴파일): WebView 호스트(`DebugWebScreen`, `DebugWebOrigin`, `NativeInspectionOrigin`), 읽기 전용 Pleos 상태 소스(`component/*`, 타이어 상태 채널), 페이지와 Native 사이의 순수 브리지·결과 계약(`NativeInspectionBridge`, `SyncHttpDecoder`, `SyncServerClock`, `SyncReceiverContract`, `SyncChecklistInspection`, `SyncReceiverState`). 파일은 이름과 내용을 바꾸지 않고 옮겼고, Debug 동작은 같다.

**Release 전용** `app/src/release`: 새 `InspectionActivity`와 매니페스트. 같은 3D 페이지와 상태 채널을 쓰고, GLB는 APK 자산 `inspection/external/ioniq5.glb`에서 읽는다.

**Debug에만 남긴 것**: 수신 화면, HTTPS 전송, 등록·인증·AVD 시뮬레이터, ZXing QR 생성, 과거 기록 채널, 모든 probe/lab 화면, `INTERNET` 권한. CI의 경계 검사가 Release DEX에 이 클래스와 파일명(`sync-endpoint.json`, 등록 파일명, `/simulator/provision`)이 없음을 확인한다.

## 3. 권한 정책 변경과 이유

기존 정책은 "Release 권한은 `CAR_DOORS`·`VEHICLE_BINDING`만"이었다. 제출 APK가 시연과 같은 차량 상태를 보여 주도록, [AVD SDK→카드 E2E](pleos-avd-sdk-e2e.md)에서 실제 값 수신이 확인된 기능의 **읽기 전용** 권한만 추가했다.

| 권한 | 기능 | AVD 수신 근거 | Release |
| --- | --- | --- | --- |
| `CAR_ENERGY` | EV SoC, 충전 스위치, 충전구 개폐 | PASS (sdk/store/card) | 추가 |
| `CAR_WINDOWS` | 전면 와이퍼 상태 | PASS | 추가 |
| `CAR_LIGHTS` | 하향등·상향등 | PASS | 추가 |
| `CAR_DRIVE` | 주행거리 | PASS | 추가 |
| `CAR_SAFETY` | 워셔액 경고, 브레이크액, 타이어 저압 | AVD 미제공(서비스 오류 60001, capability 영역 없음) | **제외** |
| `PRIVATE_CAR_SAFETY` | 타이어 공기압 | AVD HAL에 속성 없음 | **제외** |
| `android.car` `CAR_INFO` | 식별 probe | debug 진단 전용 | 제외 |
| `INTERNET` | QR 연동 | Release에 연동 없음 | 제외 |

제어(`CONTROL_*`) 권한은 없다. 제외한 기능은 카드와 개발자 정보에 `PERMISSION_DENIED`로 표시된다. 미지원(`UNSUPPORTED`), 일시 오류(`ERROR`), 권한 없음(`PERMISSION_DENIED`), 오래된 값(`STALE`, 5000 ms)은 기존 계약대로 구분된다. MOCK 값은 Release 카드에 쓰이지 않는다. 추가한 4개 권한은 설치 시 자동 허용되었다(`dumpsys package`: `granted=true`).

## 4. QR 연동: Release는 BLOCKED

QR을 만들려면 운영자가 기기별로 발급한 등록 증명(`avd-*-enrollment.json`)이 앱 전용 폴더에 있어야 한다([P6-D3](p6-d3-avd-simulator-auth.md)). 공개 등록 엔드포인트나 공용 테스트 자격 증명은 설계상 없다. 그런데 Release 앱에는 이 파일을 넣을 정상 경로가 없다(`run-as` 불가, `allowBackup=false`, Intent 입력 금지). 그래서 보안 제한을 풀지 않는 한 심사자 기기에서 QR을 발급할 수 없다.

- Release는 이를 숨기지 않는다. "스마트폰으로 점검하기"를 누르면 `BUILD_UNSUPPORTED` 상태와 함께 "이 배포용(Release) 앱에는 스마트폰 점검 연동이 들어 있지 않습니다…"라고 표시하고, QR을 기다리게 하지 않는다. 재시도나 취소 버튼도 없다.
- 시연 영상의 QR·모바일 결과 수신은 **운영자 승인 AVD + Debug 빌드**에서 실행한 것이다. Release와 다른 빌드다.
- 안전한 대안(별도 승인 필요): ① 심사용 운영자 등록 절차. 심사 기간에만 유효한 기기별 등록을 발급하고, Release 앱이 사용자 확인 화면에서 1회용 등록 코드를 받도록 설계한다. 서버 승인과 보안 검토가 필요하다. ② 시연 영상과 Debug APK 재현 절차([P22](p22-avd-qr-auth-diagnostics.md))로 연동을 설명한다.

## 5. 모델 라이선스

GLB는 “Hyundai Ioniq 5” © 2022 andikapratamaw ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) → [OpenX Assets](https://github.com/vevalabs/openx-assets) 수정본 © 2026 Dogan Ulus (`MPL-2.0 AND CC-BY-4.0`)을 CarScope가 변환한 파일이다(SHA-256 `cfe0d754…00139e1`, [P2-A6](p2-a6-ioniq5-asset.md)). 두 라이선스 모두 저작자 표시를 하면 재배포할 수 있다. 3D 화면 하단에 저작자·라이선스·수정 사실·"Hyundai 공식 자료 아님"을 상시 표시하고, GLB 자체의 asset 메타데이터에도 저작자 표시가 남아 있다. 소스 저장소에는 여전히 GLB 파일을 커밋하지 않는다. GLB는 제출 APK 안에만 들어 있다. Gradle은 `-PcarscopeSubmission=true` 빌드에서 GLB SHA-256이 다르거나 GLB가 없으면 실패한다. Three.js 라이선스는 `inspection/vendor/three/LICENSE`로 함께 들어 있다.

## 6. 빌드 재현

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
.\scripts\build-release-apk.ps1 -OutFile 'C:\dev\CarScope\apk\박성진_차보담_release.apk'
```

스크립트는 `C:\CarScope-External\release-signing`의 키스토어와 DPAPI로 보호된 비밀번호(현재 Windows 사용자만 복호화 가능)를 쓴다. 비밀번호는 프로세스 환경 변수로만 넘기고 끝나면 지운다. 서명 정보가 없으면 Gradle은 서명하지 않은 Release를 만든다(CI 경로).

## 7. 검증 결과 (2026-11-15 KST 새 실행)

환경: Windows 10, JDK 17.0.20, Node 22.16.0, Android build-tools 35.0.0, Emulator 37.2.13. 검증용 AVD는 **별도로 새로 만든** `CarScope_Release_Verify`(`emulator-5556`, 기존 `CarScope_Pleos_API34`와 같은 Pleos Connect v2.1.0 이미지·하드웨어 설정)를 썼다. 기존 AVD, Debug 앱, 앱 데이터, Vision 등록은 건드리지 않았다. Android user 10, 2560×1440, 160 dpi, Android 14, Vehicle Service 2.3.22(code 74), Pleos WebView 131.0.6752.0.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| Gradle Release 빌드 (서명) | PASS | `scripts/build-release-apk.ps1`, BUILD SUCCESSFUL |
| 서명 검증 | PASS | `apksigner verify --verbose --print-certs`: Verifies, v3, 서명자 1 |
| APK 내용 | PASS | Activity·권한(`aapt2 dump badging`), GLB SHA-256 일치, 페이지·저작자 표시·Three.js LICENSE 포함, lab 자산·네트워크/등록 문자열·ZXing 없음 |
| AVD 설치 | PASS | `adb install` Success, debuggable 아님, 4개 권한 granted |
| 점검 화면 실행 | PASS | `am start --user 10 -W …/.lab.InspectionActivity` Status ok |
| 3D 렌더링 | PASS | 로그 `loaded`/`ready` (WebGL 2.0, ANGLE), 화면 캡처 |
| 보닛 개방·부품 선택·상세 | PASS | 보닛 → 6부품 → 브레이크액·워셔액 상세, 캡처 |
| 타이어 선택·자가 점검 화면 | PASS (화면) | 타이어 강조와 응답 항목 표시. 응답 확정 입력은 실행하지 않음 |
| 전체 요약·과거 기록 | PASS | 요약과 주행거리 카드. 과거 기록은 "조회 경로 미연결"로 정직하게 표시 |
| SDK 상태 (EV·충전구·스위치·와이퍼·조명·주행거리) | PASS (수신) | `CarScopeComponent` 로그의 current/event 값, EV 카드 "출처 차량 SDK" |
| 권한 제외 기능 (타이어·워셔액·브레이크액) | PASS (PERMISSION_DENIED 표시) | 로그와 화면의 개발자 정보 |
| QR 연동 / 모바일 결과 수신 | **BLOCKED (설계상)** | `BUILD_UNSUPPORTED` 패널·토스트 캡처. 4절 참고 |
| 닫기 | PASS | `lifecycle pause finishing=true` → `destroy` |
| 기존 `MainActivity` | PASS | 실행, MOCK 도어 화면 |
| 런타임 크래시 | 앱 크래시 0건 | `logcat -b crash`에 `io.carscope` 없음, `FATAL EXCEPTION` 0건 |

**관측된 환경 이벤트:** 검증 중 한 번 에뮬레이터 `system_server`가 Watchdog으로 재시작했다. 원인은 GNSS HAL `native_stop_sv_status_collection`이 79초 멈춘 것이다. 앱은 위치 API를 쓰지 않으며, 같은 시각 앱 크래시는 없었다. 재시작 직후 다시 연 화면 하나에서 Native 브리지 채널이 닫힌 상태로 남았다("이 기기에서는 스마트폰 점검을 연결할 수 없습니다"). 이는 Debug와 공유하는 기존 fail-closed 동작이다. 화면을 다시 열자 정상 연결되었다. 또한 검증 중 에뮬레이터 창을 한 번 사용자가 실수로 닫아 다시 부팅했다.

**자동 검사 (같은 작업 트리):**
- `node --test tools/three-poc/test/*.test.mjs`: 355개 중 354 pass, 0 fail, 1 todo(기존 P2-9).
- Release 상태 신규 테스트 `release-build-unsupported.test.mjs` 5개, JVM `NativeInspectionBridgeTest`에 Release 응답 케이스를 추가했다.
- `inspection-sync-poc/test/deployment-preflight.test.mjs` 23/23. 같은 폴더의 모바일 UI 계열 테스트 일부는 이 PC에 `tools/mobile-ar-poc/build/react` 산출물이 없어 실패했다(ENOENT, 이번 변경과 무관, 이 PC에서 NOT_RUN 처리). CI의 해당 job 결과로 확인한다.
- Gradle `:app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug` 및 경계 검사 4종(identity, tire, sync, component)의 결과는 PR 본문과 CI에 기록한다.

증거 원본(캡처, 로그, UI 덤프)은 Git 밖 `C:\CarScope-External\release-verify\`에 있다.

## 8. 미검증 범위

- 실차, 실제 Pleos 차량 HAL에서의 권한 허용·값 수신: 미검증. AVD 결과만 있다.
- `CAR_SAFETY`/`PRIVATE_CAR_SAFETY` 기능(타이어 공기압, 워셔액·브레이크액 경고): Release에서 제외. 실차 제공 여부 미확인.
- 성능: 에뮬레이터 프레임 통계(평균 약 15–17 fps)는 개발 PC GPU 경로의 값이며 차량 성능을 뜻하지 않는다.
- 타이어 응답 확정·수정 입력은 이번 Release 실행에서 직접 누르지 않았다(같은 페이지 코드의 Node·브라우저 회귀 범위).
