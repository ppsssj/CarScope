# P1-B2 증거 — 집 PC, 2026-10-30

이 README만 Git에 포함합니다. 원본 logcat, emulator 로그, SurfaceFlinger/window dump, 화면 캡처는 집 PC 로컬에 보존하고 업로드하지 않았습니다. 아래 로그 발췌는 판정에 필요한 줄만 옮겼고, 사용자 경로·계정·기기 식별자는 제거했습니다. 시각은 게스트 logcat 시계(에뮬레이터 시간대) 기준이며, Windows 시각이나 화면의 UTC 표시와 섞어서 지연을 계산하지 않았습니다.

연구실 PC의 [P1-B 증거](../../p1-b/2026-10-30/README.md)와 BLOCKED 판정은 당시 결과로 그대로 보존합니다.

## 환경

| 항목 | 값 |
| --- | --- |
| 호스트 | Windows 10 22H2, Intel Core i5-4690 (4C/4T, Android Studio 공식 최소 CPU 미만), RAM 16GB, GTX 1060 6GB |
| 가속 | `emulator -accel-check`: `WHPX(10.0.19045) is installed and usable`. 부팅 로그 `CPU Acceleration: working` |
| GPU | `-gpu host`, `Graphics Adapter Android Emulator OpenGL ES Translator (NVIDIA GeForce GTX 1060 6GB)` |
| SDK 도구 | cmdline-tools 22.0, platform-tools 37.0.1, emulator 37.2.13, build-tools 35.0.0, platform 34. Android Studio IDE 미설치 |
| 이미지 | `system-images;android-34;pleos_car_emulator;x86_64` rev 2, fingerprint `.../release_connect_v2.1.0:user/test-keys` |
| AVD | Pleos_Connect_v2_0 장치, RAM 4096MB, 2 cores, cold boot (`-no-snapshot`) |
| Vehicle SDK / Service | 앱 의존성 `Vehicle:2.3.2` / `ai.pleos.playground.service.vehicle` **2.3.22 (code 74)** |
| 앱 권한 | `CAR_DOORS: granted=true`, `VEHICLE_BINDING: granted=true` |
| 런타임 APK | 소스 `c555c58`, SHA-256 `C192F7B75BE832715574AB5E9FF9F74AC8928F6A3F4811E70FB2BC087AB825B6` |

## 세션 기록

| 세션 | 결과 |
| --- | --- |
| H1 (boot1) | 54초 부팅. 부팅 중 SystemUI ANR 1건(`executing service SystemUIService`), 이후 추가 없음. T1~T7, T9 앱 측 확인. 호스트 여유 RAM 최저 0.8GB |
| P1-B2 boot2 | 44초 부팅, ANR 0. **OEM 홈의 오른쪽 앱 패널이 어떤 앱도 표시하지 않음**: CarScope 창은 `HAS_DRAWN`, 733 frames였으나 SurfaceFlinger layer가 hidden(VisibleRegion 비어 있음)으로 합성 제외. 내비게이션 앱도 동일. 입력도 전달되지 않음. 이 부팅의 화면은 판정에 쓰지 않음 |
| P1-B2 boot3 (복구 1회) | 첫 실행은 게스트 시작 전 exit 5(원인 미확인, 로그 없음), 재실행 성공. 부팅 후 load 최고 18.7 → 7~9 유지, **세션 전체 ANR 0**. T8, T10 및 재생성 후 T4~T7 재확인 |

## T1~T7: SDK 데이터 수신 (H1, boot1)

```text
04:30:22.628 [Pleos][SDK] Service Connect Api called Intent { act=ai.pleos.playground.vehicle.VEHICLE_START ... }
04:30:22.693 CarScopeDoor: PLEOS · ROW_1_LEFT · initialize returned (connection not yet proven)
04:30:24.802 CarScopeDoor: PLEOS · ROW_1_LEFT · capability access=READ_WRITE range=0..1
04:30:24.812 CarScopeDoor: PLEOS · ROW_1_LEFT · listener registered (SDK call returned)
04:30:24.829 CarScopeDoor: PLEOS · ROW_1_LEFT · current raw=0 · access=READ_WRITE range=0..1
04:32:00.776 CarScopeDoor: PLEOS · ROW_1_LEFT · event raw=1 · ...   (Console PUT door_fl=true, HTTP 200)
04:32:08.725 CarScopeDoor: PLEOS · ROW_1_LEFT · event raw=0 · ...   (Console PUT door_fl=false, HTTP 200)
```

H1에서는 단계마다 logcat 버퍼를 비워 저장 파일에 위 줄이 남지 않았고, 당시 명령 출력과 화면 캡처로 기록했습니다. P1-B2 boot3에서는 logcat을 비우지 않고 연속 기록했으며 같은 흐름(initialize → capability → listener → raw 값, Console OPEN/CLOSE 이벤트)을 다시 확인했습니다.

화면(로컬 보존): raw=1 직후 SVG FRONT_LEFT 빨간색 OPEN, OEM 차량 모델도 문 열림 및 "도어를 닫으세요". raw=0 직후 초록색 CLOSED. 나머지 세 도어는 UNAVAILABLE (UNSUPPORTED).

Virtual Console 조작은 브라우저 클릭 대신 Console 웹 UI와 같은 요청(1초 간격 `POST /browser/session` heartbeat + `PUT /vehicle/body?door_fl=true|false`)을 보냈습니다. heartbeat 없이는 `503 emulator_inactive`가 반환됐습니다.

## T8: SDK 모드 Activity 재생성 (boot3)

방법: PLEOS 모드에서 `cmd uimode night yes/no`로 설정 변경을 일으켜 시스템이 Activity를 재생성하게 했습니다. 앱 코드는 변경하지 않았고, force-stop/재실행은 사용하지 않았습니다. 3회 수행했습니다.

```text
05:14:13.141 wm_on_stop_called: [173509481,io.carscope.app.MainActivity,handleRelaunchActivity,2]
05:14:13.183 wm_on_destroy_called: [173509481,...,performDestroy,35]
05:14:13.184 (TID 6612)  CarScopeDoor: listener unregistered (SDK call returned)
05:14:13.185 (TID 6612)  CarScopeDoor: stopping · pending=0
05:14:13.185 [Service]   unregisterPropertyCallback() applicationId = io.carscope.app, propKey = DOOR_POS
05:14:13.193 [Service]   callbacks.unregister: isEmptyApp = true
05:14:13.215 (TID 6612)  CarScopeDoor: released
05:14:13.481 wm_on_create_called: [173509481,...,performCreate,143]
05:14:13.507 (TID 11474) CarScopeDoor: initialize returned (connection not yet proven)
05:14:14.893 (TID 11474) CarScopeDoor: capability access=READ_WRITE range=0..1
05:14:14.895 [Service]   registerCommonCallback() applicationId = io.carscope.app, propKey = DOOR_POS
05:14:14.904 (TID 11474) CarScopeDoor: event raw=0
05:14:14.908 (TID 11474) CarScopeDoor: late initial read ignored after event
05:14:42.914 (TID 11474) CarScopeDoor: event raw=1      (Console OPEN)
05:14:49.434 (TID 11474) CarScopeDoor: event raw=0      (Console CLOSE)
```

- 앱 PID는 세 번 모두 같았습니다 (프로세스 재시작 아님).
- 각 세션은 별도 worker TID(6612 → 11474 → 20298 → 31371)로 구분됩니다. 이전 TID에서는 해제 후 이벤트가 기록되지 않았고, Console 이벤트 1건당 `event` 로그는 1줄이었습니다.
- Service 측 로그는 등록 → 해제(`removePropertyKey`) → 재등록 순서이며 CarScope 등록이 겹친 구간은 없었습니다.
- 재생성 후 화면: 출처 PLEOS 복원, FRONT_LEFT CLOSED(재생성 약 4초 후 캡처). 같은 화면을 8초 후 캡처하면 STALE로 바뀝니다 (아래 STALE 정책 참고).

## T9: 구독 해제·release

- 앱 측: `listener unregistered (SDK call returned)` → `stopping · pending=0` → `released` (PLEOS→MOCK 버튼, 시나리오 버튼, 재생성 모두).
- Service 측 구독 해제: Vehicle Service의 debug 로그 `unregisterPropertyCallback`, `removePropertyKey`, `isEmptyApp = true`로 처리가 관측됐습니다. 이것은 Service의 진단 로그이며 SDK가 제공하는 공식 완료 응답(acknowledgement) API는 아닙니다.
- release: SDK 클라이언트 측 `disconnectService` 로그만 있고, Service 측 unbind 확인 로그는 관측되지 않았습니다. release의 Service 측 완료는 **미확인**입니다.

## T10: Mock 전체 회귀 (boot3 화면 기준)

| 단계 | 화면 |
| --- | --- |
| 실행 직후 기본 | 출처 MOCK, 4개 도어 CLOSED(초록) |
| 7초 후 | 4개 도어 STALE (기존 Mock 정책) |
| 모의: 앞 왼쪽 열림 | FRONT_LEFT OPEN(빨강), 나머지 CLOSED |
| 모의: 조회 불가 | 4개 도어 UNAVAILABLE (DISCONNECTED) |
| 모의: 모두 닫힘 | 4개 도어 CLOSED |
| MOCK → PLEOS 버튼 | 출처 PLEOS, FRONT_LEFT는 SDK `raw=0` CLOSED, 나머지 UNAVAILABLE (UNSUPPORTED). Mock 값이 이어지지 않음 |
| PLEOS에서 모의 버튼 | 출처 MOCK, Mock FRONT_LEFT OPEN. SDK 세션 해제 로그 확인 |
| PLEOS → MOCK 버튼 | 출처 MOCK. SDK 세션 해제 로그 확인 |

상단 안내문, "데이터 출처" 표시, SVG 색이 각 단계의 출처·상태와 일치했습니다.

## JVM 및 빌드

브랜치 `fix/p1-b2-runtime-closure`에서 `:vehicle-core:test --rerun :app:testDebugUnitTest --rerun :app:assembleDebug` 실행: core 17 + app 19 = 36, failures/errors/skipped 0, BUILD SUCCESSFUL. 이 재빌드 APK의 SHA-256은 `EE4F821A2CF6DE51A8EFDAEFF672F3498DCD1F0867451A80F361E5B69EAE3E03`으로 런타임 APK와 다릅니다. 소스는 같고 debug 빌드가 비트 단위로 재현되지 않기 때문이며, 런타임 판정은 위 런타임 APK 기준입니다.
