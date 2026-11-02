# P5-B1 증거 인덱스

기준 `5951b1d`, branch `feat/p5-b1-vehicle-api-integration`. 외부 원본은 `C:/CarScope-External/p5-b1/`에만 저장하며 SDK/GLB/개인 로그/캡처/APK/서명 키를 Git에 넣지 않는다.

| Gate | 현재 상태 | 근거 |
| --- | --- | --- |
| AAR 공개 선언/권한/enum | PASS | `python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p5-b1/sdk-audit`, 고정 SHA e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937 |
| Node 계약/좌표/선택 | PASS 72/72 | 기존 60 + Visibility 7 + 상태·source/marker·투명 lens 차폐 5, skip 0. 기존 packet 형태 유지 |
| Debug asset packaging | PASS 1/1 | 신규 consumer 포함, GLB 제외 |
| Kotlin/JVM/Robolectric/Release | PASS 36/36 계열 | 기존 26 + 신규 10개 Component/Visibility 검사, typed adapter compile 및 전체 기존 app JVM·Debug/Release APK/AAB/lint/boundary PASS. 실제 SDK 호출 성공 주장 아님 |
| 실제 Kotlin MOCK→JS | PASS | 실제 serializer의 visibility-ui-v1.json, 다른 세 채널도 독립 검증. CI의 MOCK 전용 prefix 줄을 외부 JSON으로 추출 |
| 3D Chrome | PASS 21 assertions × 2 | `browser-final/results.json` 1600×1000, `browser-portrait-final/results.json` 900×1200. 원본 GLB와 A builder, 6개 부품 실제 canvas pointer/state dispatch·강조·전역/전면 shared 상태·ON/SERVICE 불변 pose·invalid UNKNOWN·pause/resume·summary/end/dispose. 캡처 직접 확인 |
| 기존 SDK/UI 회귀 | PASS | `safety-browser` 10, `ev-browser` 8, `charge-browser` 14, `tire-browser` 14, `product-browser` 17 assertions. 기존 스크립트 그대로 실행 |
| AVD Health Gate | BLOCKED | `health-initial/health.json`: exact emulator-5554 absent/offline, 다른 target guest 명령·시작·재시작 없음 |
| 실제 SDK Capability/getter/listener/Android 종료 안정성 | BLOCKED/NOT_RUN | Health Gate 미통과. 기존 역사적 관측과 새 실행을 구분 |

## API별 실제 검증 단계

공개 선언 존재·코드·합성·실기기를 같은 PASS로 합치지 않는다. 아래 3D PASS는 실제 GLB의 **desktop Chrome + Kotlin MOCK** 범위이며 Android Runtime이 아니다.

| API | 공개 존재 | Native 코드 | JVM/계약 테스트 | 실제 Capability | 실제 getter/listener | 3D 표시 | 실제 Android 실행/종료 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| washer warning | 확인 | 기존 유지 | PASS | BLOCKED | NOT_RUN | PASS 기존 패널 | BLOCKED |
| brake fluid | 확인 | 기존 유지 | PASS | BLOCKED | NOT_RUN | PASS 기존 패널 | BLOCKED |
| tire pressure/low-pressure | 확인, Float? | 기존 유지 | PASS | BLOCKED | NOT_RUN | PASS metadata-only | BLOCKED |
| EV SoC/charge switch | 확인 | 기존 유지 | PASS | BLOCKED | NOT_RUN | PASS raw SoC/Boolean | BLOCKED |
| charge-port open | 확인, deprecated WARNING | 기존 유지 | PASS | BLOCKED | NOT_RUN | PASS 정적 모델/Boolean | BLOCKED |
| Wiper front | 확인 | 신규 readonly | PASS | BLOCKED | NOT_RUN | PASS 좌우 하나의 전면 보고 | BLOCKED |
| Light low/high | 확인 | 신규 readonly | PASS | BLOCKED | NOT_RUN | PASS 4 marker/전역 보고 | BLOCKED |

Release에는 3D/API/권한을 도입하지 않는다. 타이어 단위·PRIVATE_CAR_SAFETY grant·raw 수치 전달 및 SoC %는 미검증으로 유지한다. 미지원 도메인/차량의 오류 처리는 합성으로 확인하며 실제 Android 안정성은 Health 통과 후 별도다.

실제 SDK Capability/getter/listener 호출 성공은 이번에 관측하지 않았다. low-pressure/charge-switch에는 공개 범위를 벗어난 listener를 추가하지 않았다. SDK release의 반환과 Service 측 정리 완료도 구분하며 후자는 NOT_RUN이다. Health harness의 local APK preflight BLOCKED는 집 PC에서 Gradle/APK 생성을 하지 않았다는 뜻으로, CI의 APK 빌드 PASS와 다른 범위다.

## 실행 버전과 실패 조사

구현 `e566797`의 [Android/Kotlin](https://github.com/ppsssj/CarScope/actions/runs/41484696352), [Geometry/Node](https://github.com/ppsssj/CarScope/actions/runs/41484696373), [Core JVM](https://github.com/ppsssj/CarScope/actions/runs/41484696369), [Sync 양 OS](https://github.com/ppsssj/CarScope/actions/runs/41484696293), [Tire](https://github.com/ppsssj/CarScope/actions/runs/41484696292), GitGuardian 모두 PASS. 최종 문서/main 병합 후 HEAD는 [PR #51](https://github.com/ppsssj/CarScope/pull/51)의 checks/SHA에서 확인한다.

초기 Chrome probe에서 조명 표식이 보이는데 실제 picking point가 null임을 발견했다. raw 첫 hit는 Lens_Smoked/opacity 0.25였고, 상향등 초기 시점은 Body/Black_Plastic에 가렸다. 공개 GLB의 투명 lens만 허용하고 불투명 body/housing과 알 수 없는 투명 재질의 차폐 검사를 유지했다. 상향등은 실제 외부 ray 시점과 orbit 범위를 수정해 선택 가능하게 했으며 원본 geometry/opacity는 그대로다. `probe-light*.png`, `probe-high-light.png` 및 외부 로그에 조사 근거가 있다. 모든 회전/모델 변형에서의 가시성 증명은 아니다.

시작 main 5951b1d 이후 A의 PR #52가 main 0a054ca에 병합되어 충돌 없이 반영했다. A의 모바일·Sync 파일은 main 그대로 보존하며 PR diff에 포함하지 않는다. 새 모바일 USER_REPORTED 타이어 v2와 SDK pressure metadata v1도 혼합하지 않는다. 원본 GLB SHA cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1 불변. A worktree/PR #41 보존. 자동 병합 없음.
