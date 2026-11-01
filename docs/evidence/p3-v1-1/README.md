# P3-V1.1 증거 인덱스

원본은 `C:\CarScope-External\p3-v1-1`에 보관한다. AAR/JAR/APK/AAB, 로그, 캡처, 개인 설정은 Git에 넣지 않는다. 아래 파일은 해당 PC의 로컬 증거이며 CI에서 접근 가능한 링크가 아니다.

| 로컬 경로 | 내용 |
|---|---|
| `health/health.json` | 2026-11-01 UTC gate BLOCKED, emulator-5554 없음, get-state 63ms/exit1 |
| `health/host-inventory.json` | 빈 ADB 장치 목록, AVD 설정 파일 존재, emulator/qemu 프로세스 없음 |
| `sdk-audit/sdk-audit.json` | 이번 AAR hash, 7개 Tire method/권한 선언 검증 |
| `sdk-audit/*.javap.txt` | Tire / listener / wheel enum 공개 선언 |
| `Vehicle.javap.txt` | initialize/release 공개 bytecode, 서비스 manager 위임 확인 |
| `baseline.log` | 수정 전 core/app 단위 테스트 실행 |
| `focused.log` | Tire 집중 단위 테스트 첫 실행 |
| `full.log` | 변경 후 core/app 테스트 및 debug/release 빌드·lint |
| `final-debug.log` | 이전 Activity의 증거 파일 덮어쓰기 방지 추가 후 Debug 테스트/APK/lint 재검증 |
| `core-only.log` | coreOnly JVM 독립 실행 |
| `verification.json` | 최종 suite별 결과와 빌드/격리 명령 결과 |

실제 AVD Tire 호출/화면/이벤트 캡처는 **없다**. gate에서 중단했으므로 미실행 항목을 기존 PR의 캡처로 대체하지 않았다. 현재 SDK 지원 여부와 raw 값을 입증하는 런타임 자료도 없다. [보고서](../../p3-v1-1-tire-runtime.md)의 T1–T10을 참고한다.
