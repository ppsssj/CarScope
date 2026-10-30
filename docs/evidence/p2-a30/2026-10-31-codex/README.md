# P2-A3-0 evidence index — 2026-10-31 KST

공유본에는 비식별 결과와 인덱스만 포함한다. 원본 로그·화면·SDK/APK는 Git 제외 `.tools/p2-a30/` 및 `app/build/`에 있다. 자세한 API·판정·명령·한계는 [보고서](../../../p2-a3-0-vehicle-identity-probe.md)를 따른다.

기준 main `69db27d5c8c3ae3b4d2fac83c0a71d3cb884e65e`; PR #7 merged 확인 후 fast-forward. `Documents\CarScope` 변경 없음. SDK AAR SHA-256 `E11FDFE498CAD3ECC0D5A2A6992B0C4A4D135195F1455018127BC069FD5EF937`, API 34 optional public android.car.jar 사용. 신규 probe는 debug only이다.

## 실제 결과

AAOS 연결 CONNECTED. make `Hyundai 42dot`, model `Connect`, modelYear `2024`; dimensionsMm `[1776,4950,2008,2140,2984,1665,1667,11800]`. 네 항목은 config exposed / permission GRANTED / AVAILABLE / errorType null. trim은 NOT_IN_PUBLIC_API_34, 미조회. identityStatus PARTIAL, oemVisualMatch UNVERIFIED. Pleos SDK 2.3.2의 해당 다섯 metadata getter는 미노출이며 결과 UNAVAILABLE; CAR_INFO 권한은 미선언/DENIED, identifier/capability getter 호출 없음.

AVD `CarScope_Pleos_API34`, Pleos Connect 2.1.0 / image package revision 2, Android 14/API 34/x86_64, Vehicle Service 2.3.22/code 74. Android current user는 10. `osBuild=RELEASE.release_connect_v2.1.0 test-keys`, `deviceProduct=crp_avd`는 플랫폼 label이며 차량 모델이 아니다.

| 로컬 근거 | 관측 / SHA-256 |
| --- | --- |
| `.tools/p2-a30/final/vehicle-identity.json` | 최종 APK의 새 실행 결과. `DB21D1FF7B8EEA567E7F3CA66B749875E08FFBC89FF144B8851784AD4585BFE6` |
| `.tools/p2-a30/final/probe.png` | OEM 왼쪽 차량과 오른쪽 metadata가 같은 화면에 표시됨. `0336C42F96CB7CF7566A0839FF08CC6B41DF99A88E5AFED630FC30F378611589` |
| `.tools/p2-a30/final/environment.json` | allowlist OS version/build/product 및 AVD name만 수집 |
| `.tools/p2-a30/run2/vehicle-identity.json` | 수정 전 오류 분류 코드의 성공 실행; 최종 결과와 같은 metadata/hash. 별도 새 Activity에서도 같은 값 |
| `.tools/p2-a30/probe-side.png` | 초기 APK에서도 OEM+probe 동시 표시. `D8F209C0B3EA4B6C9A8DBC38CED0AC46B552BC1124AEE1E21CC3F5AE23CDA85A` |
| `.tools/p2-a30/settings.png` | 실제 내용은 기존 main MOCK/STALE SVG와 OEM 동시 화면이며 settings 화면이 아님. `D5503AB0DF57B33E7B8B0648F5D07FB82A1236E07A51F9F38B0448E5407F4E0E` |
| `app/build/outputs/apk/debug/app-debug.apk` | 최종 설치 debug APK. `D66FEF0481B65F0BE122D6021AE0E4AA53A7D2A5227CD49C389F73E15E3D3D27` |
| `app/build/outputs/apk/release/app-release-unsigned.apk` | release 경계 검사 대상. `ACF10C271AE5CD5466E4EF2E28F01D934F37A106DA22B814D8DD0E1D39B61B5D` |

화면 캡처로 차량 외관과 표시 메타데이터를 비교할 수 있지만 모델 일치의 증명은 아니다. proprietary OEM 3D asset은 추출하지 않았다. 사용자의 외부 이미지 유사성 관찰은 독립 검증된 mapping으로 승격하지 않는다.

## 기계 검증

| Gate | 결과 / 증거 |
| --- | --- |
| Full initial build | PASS: `.tools/p2-a30-build.log`; core 24 + 기존 app 19 + 초기 probe 5, assembleDebug/Release/lintDebug, 97 tasks executed |
| Final debug build | PASS: `.tools/p2-a30/final-build.log`; 새 오류 분류를 포함한 probe 7 + adapter 19 tests, 16 tasks executed / 36 up-to-date. core/release 코드는 그 사이 변경 없음 |
| JUnit XML | `vehicle-core/build/test-results/test/TEST-*.xml`: 24; `app/build/test-results/testDebugUnitTest/TEST-*.xml`: 26. failures/errors/skipped=0 |
| Lint | PASS: `app/build/reports/lint-results-debug.txt`: 0 errors, 기존 main/Lab/build 설정의 9 warnings. 신규 probe 경고 없음 |
| Manifest / DEX | PASS: `python tools/identity-probe/check.py build-contract`; release identity 클래스/activity/library/CAR_INFO 없음, 기존 permission 두 개만 유지 |
| Actual Android smoke | PASS: 최종 APK `adb install -r` Success, `check.py capture` 새 결과 수집·allowlist/보수적 identity 계약 검사, 위 screenshot 육안 확인 |
| Actionlint | PASS: actionlint 1.7.12로 신규 workflow 검사 |
| Diff boundary | 기존 main Android/SDK 처리, vehicle-core 및 SVG/GLB/Geometry CI 변경 없음 |

[Identity probe CI](https://github.com/ppsssj/CarScope/actions/workflows/identity-probe-ci.yml), [JVM CI](https://github.com/ppsssj/CarScope/actions/workflows/jvm-ci.yml), [Geometry CI](https://github.com/ppsssj/CarScope/actions/workflows/geometry-ci.yml)의 **현재 PR head** 결과는 PR checks 및 최종 PR 본문에 기록한다. 이 인덱스의 로컬 PASS를 CI 실행 성공으로 대체하지 않는다. 신규 CI는 Pleos AVD 또는 실차를 실행하지 않는다. PR #2는 병합/수정하지 않았다.

## 실패·미실행 기록

- 첫 [Identity probe CI](https://github.com/ppsssj/CarScope/actions/runs/41088849053): FAIL, head `8f35e97`, `sdkmanager: command not found` / exit 127. 빌드·테스트 이전 SDK 설치 단계의 PATH 문제이다. 공식 runner의 `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager`를 명시하고 public stub 존재까지 검사하도록 후속 커밋에서 수정했다. 새 head의 CI 결과를 이 실패와 구분한다.
- 첫 host capture: FAIL (120초 timeout). `run-as`가 기본 Android user 0을 보았으나 앱은 user 10에서 실행됐다. probe UI/API read는 성공했지만 파일 회수가 실패했다. 현재 user 조회 + `--user` 수정 후 run2와 final 모두 PASS. 이전 실패를 SDK/API 실패로 분류하지 않는다.
- 초기 fullscreen/black home 캡처는 부팅·화면 전환 중 frame이어서 OEM 비교 PASS 근거로 사용하지 않는다. 최종 `probe.png`는 OEM 영역과 metadata가 실제 합성된 화면이다.
- Windows browser access host unavailable. CUA의 Chrome 선택은 현재 URL을 충분히 판별하지 못해 Computer Use가 중단됐다. 이후 Windows/browser 입력 없음; Virtual Console GUI는 NOT_RUN이다. 공식 Console 문서와 현재 AVD config만 확인했다.
- 실제 AAOS permission denial/서비스 장애 주입 및 Pleos CarInfo identifier callback: NOT_RUN. SecurityException/unsupported/unavailable/internal error 분류는 JVM 합성 테스트이다.
- Release APK runtime SDK 호출 / 실차 / OEM resource mapping / 모든 관리자 설정의 모델 선택 여부: NOT_RUN 또는 미확인. release 격리는 manifest·DEX·동일 SDK 의존성·기존 adapter 테스트로 확인했다.
- Android instrumentation suite는 기존 저장소에 없으며 새로 실행했다고 주장하지 않는다. 실제 Activity 및 public API의 Android 검증은 `check.py capture` device smoke와 캡처이다.

최종 판단은 **CONDITIONAL GO (수동 reference만)**, **NO-GO (OEM 모델 자동 식별/일치 주장)**이다. 원본 screenshot을 공유하려면 저장소의 raw evidence 제외 규칙을 유지하며 별도 전달한다. PR 자동 병합 없음.
