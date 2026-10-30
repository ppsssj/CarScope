# P1-B 증거 — 2026-10-30

**G0 보안 분리:** 이 README만 Git에 포함합니다. 아래 원본 로그·XML·시스템 정보·이미지는 연구실 PC에 보존하고 업로드에서 제외했습니다. 집 PC clone에 원본이 없는 것은 의도된 결과이며, 집 PC 실행 증거는 새로 수집합니다. 기존 판정은 바꾸지 않았습니다.

판정: **BLOCKED / 미완료**. APK 빌드·설치와 36개 단위 테스트가 실제 SDK 이벤트→SVG 성공을 증명하지 않습니다. [연동 기록](../../../pleos-sdk-integration.md)의 T1~T10 및 제한을 함께 읽으세요.

| 파일 | 의미 |
| --- | --- |
| `core-tests-final.xml`, `adapter-tests-final.xml`, `final-regression.log` | 최종 실제 재실행: 17+19 PASS |
| `build-test-1.log`, `build-test-2.log` | 신규 테스트 작성 오류 및 offline 캐시 누락 실패 이력 |
| `build-test-3.log`, `final-offline-build-test.log` | online APK 성공 및 최종 offline UP-TO-DATE 검증 |
| `dependencies.log`, `merged-manifest.xml` | 공식 SDK dependency와 최소 permission 병합 |
| `environment.json`, `service-version-permissions.txt` | SDK/실제 Service/이미지 버전, APK hash, 권한 정의 |
| `apk-signature.log`, `apk-badging.log`, `apk-install.log` | 생성 APK의 서명/package와 설치 성공 |
| `app-launch.log`, `app-bring-forward.log`, `recovery-app-start.log` | Android 시작 명령 결과. 표시 성공/SDK 연결과 구별 |
| `recovery-app-package.txt`, `recovery-windows.txt` | 시스템 서비스 dump timeout |
| `system-errors.log`, `watchdog-and-sdk.txt`, `runtime-counts.json` | OEM/framework ANR, VHAL/system 사망, SDK 진단/앱 오류 일치 수 |
| `adb-steps.jsonl`, `guest-meminfo.txt`, `guest-uptime.txt` | 경계 있는 조작 명령과 환경 부하 관측 |
| `mock-stale-native.png`, `mock-stale-recovery-native.png` | 새 SDK 포함 APK의 MOCK 출처·STALE SVG 실제 native 화면. PLEOS 성공 화면 아님 |
| `system-failure-black.png` | VHAL/system 사망 부근의 검은 화면. 앱 renderer 단독 결함으로 단정하지 않음 |
| `initial-inventory.json`, `changed-files.json`, `cleanup.log` | 기존 파일 보존·변경 목록 및 작업 프로세스/forward 정리 |

원본 runtime 전체 로그, SDK AAR/POM, 조사 과정과 수정 전 파일은 Git 제외 `.tools/p1-b/20261030T084712Z/`에 있습니다. 이 디렉터리의 로그를 편집해 테스트 성공으로 만들지 않았습니다. 공개 SDK의 binary 자체는 저장소에 복제하지 않았습니다.
