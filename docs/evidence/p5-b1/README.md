# P5-B1 증거 인덱스

기준 `5951b1d`, branch `feat/p5-b1-vehicle-api-integration`. 외부 원본은 `C:/CarScope-External/p5-b1/`에만 저장하며 SDK/GLB/개인 로그/캡처/APK/서명 키를 Git에 넣지 않는다.

| Gate | 현재 상태 | 근거 |
| --- | --- | --- |
| AAR 공개 선언/권한/enum | PASS | `python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p5-b1/sdk-audit`, 고정 SHA e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937 |
| Node 계약 | PASS 67/67 | 기존 60 + Visibility 7, 기존 packet 형태 유지 |
| Debug asset packaging | PASS 1/1 | 신규 consumer 포함, GLB 제외 |
| Kotlin/JVM/Robolectric/Release | CI 예정 | 기존 26 + 신규 8개 Component/Visibility 검사, 실제 typed adapter compile 및 legacy/Tire/Sync 회귀 |
| 실제 Kotlin MOCK→JS | CI 예정 | 실제 serializer의 visibility-ui-v1.json, 다른 세 채널도 독립 검증 |
| 3D Chrome | UI 구현 후 실행 | 실제 외부 GLB 사용, 합성을 실차로 기록하지 않음 |
| AVD Health Gate | BLOCKED | `health-initial/health.json`: exact emulator-5554 absent/offline, 다른 target guest 명령·시작·재시작 없음 |
| 실제 SDK Capability/getter/listener/Android 종료 안정성 | BLOCKED/NOT_RUN | Health Gate 미통과. 기존 역사적 관측과 새 실행을 구분 |

## API별 실제 검증 단계

현재 문서의 PENDING은 최종 PR 결과에서 갱신한다. 공개 선언 존재·코드·합성·실기기를 같은 PASS로 합치지 않는다.

| API | 공개 존재 | Native 코드 | 단위/계약 | 실제 Capability | 실제 getter/listener | 3D 표시 | Android 실행/종료 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| washer warning | 확인 | 기존 유지 | 기존 + CI 예정 | BLOCKED | NOT_RUN | 기존 패널 | BLOCKED |
| brake fluid | 확인 | 기존 유지 | 기존 + CI 예정 | BLOCKED | NOT_RUN | 기존 패널 | BLOCKED |
| tire pressure/low-pressure | 확인, Float? | 기존 유지 | 기존 + CI 예정 | BLOCKED | NOT_RUN | metadata-only | BLOCKED |
| EV SoC/charge switch | 확인 | 기존 유지 | 기존 + CI 예정 | BLOCKED | NOT_RUN | raw SoC/Boolean | BLOCKED |
| charge-port open | 확인, deprecated WARNING | 기존 유지 | 기존 + CI 예정 | BLOCKED | NOT_RUN | 정적 모델/Boolean | BLOCKED |
| Wiper front | 확인 | 신규 readonly | 새 검사 작성, CI 예정 | BLOCKED | NOT_RUN | 구현 중 | BLOCKED |
| Light low/high | 확인 | 신규 readonly | 새 검사 작성, CI 예정 | BLOCKED | NOT_RUN | 구현 중 | BLOCKED |

Release에는 3D/API/권한을 도입하지 않는다. 타이어 단위·PRIVATE_CAR_SAFETY grant·raw 수치 전달 및 SoC %는 미검증으로 유지한다. 미지원 도메인/차량의 오류 처리는 합성으로 확인하며 실제 Android 안정성은 Health 통과 후 별도다.
