# P2-A 증거 — Anatomy 차량 시각화, 집 PC, 2026-10-30

이 README만 Git에 포함합니다. 화면 캡처, logcat, emulator 로그, Anatomy 미리보기와 선 검사 PNG는 집 PC 로컬에 보존했습니다. 아래 로그 발췌는 판정에 필요한 줄만 옮겼습니다. 시각은 게스트 logcat 시계 기준입니다.

## 환경

P1-B2와 같은 환경입니다. Windows 10, i5-4690, 16GB, GTX 1060, WHPX + `-gpu host`, Pleos Connect 2.1.0 AVD(4096MB/2 cores/cold boot), Vehicle SDK 2.3.2, Vehicle Service 2.3.22 (code 74). 부팅부터 종료까지 ANR 0건, 게스트 load는 7~8에서 유지됐습니다.

런타임 APK는 브랜치 `feat/p2-anatomy-vehicle-visual` 작업 트리에서 빌드했고, SHA-256은 `C227A29503F9C078AB5472D66FCC7F7A2B4044586A37A8FA0568CCCD7C38ED3A`입니다. APK 안의 `io/carscope/visualization/anatomy-car.parts`를 확인했습니다.

### 설치 실패 1회와 원인

처음 빌드한 APK는 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`(서명 불일치)로 설치되지 않았습니다. Gradle을 `ANDROID_USER_HOME` 없이 실행하면 AGP가 사용자 홈의 `.android/debug.keystore`를 쓰고, `ANDROID_USER_HOME=C:\Android\.android`로 실행하면 그쪽 keystore를 씁니다. 두 keystore는 서로 다른 키입니다. 앱 데이터를 지우는 uninstall 대신, AVD에 설치된 앱과 같은 keystore를 쓰도록 `ANDROID_USER_HOME`을 지정해 다시 빌드했고 `adb install -r`이 Success였습니다.

P1-B2 증거에서 런타임 APK와 재빌드 APK의 해시 차이를 "debug 빌드 비재현성"으로 설명했는데, 같은 원인(다른 debug keystore로 서명)이었을 가능성이 큽니다.

## 앱 화면 (WebView 영역, 1634×320)

| 단계 | 확인한 화면 |
| --- | --- |
| MOCK 기본 | 출처 MOCK, 차량의 FL/RL 도어 닫힘 + 초록 accent, inset 네 도어 CLOSED |
| 모의: 앞 왼쪽 열림 | FL 도어가 열린 형상 + 빨강 accent, RL 닫힘 초록, inset FL OPEN |
| 모의: 조회 불가 | 두 도어 닫힌 형상 + 회색 파선 accent, inset 모두 UNAVAILABLE |
| 5초 후 | 두 도어 황색 점선 accent, inset 모두 STALE (기존 Mock 정책) |
| PLEOS 선택 | 출처 PLEOS, FL 닫힘 초록, RL 회색 파선(UNAVAILABLE, 읽지 않는 도어), inset FR/RR UNAVAILABLE |
| Console FL OPEN | FL 도어 열린 형상 + 빨강 |
| Console FL CLOSE | FL 도어 닫힌 형상 + 초록 |
| CLOSE 6초 후 | FL 황색 STALE (알려진 정책 문제) |

첫 그림은 cold launch 후 약 2~4초 사이에 나타났습니다. 그 전 캡처 1장은 WebView가 비어 있었습니다.

## SDK 이벤트

```text
06:13:30.763 CarScopeDoor: PLEOS · ROW_1_LEFT · initialize returned (connection not yet proven)
06:13:32.455 CarScopeDoor: PLEOS · ROW_1_LEFT · capability access=READ_WRITE range=0..1
06:13:32.461 CarScopeDoor: PLEOS · ROW_1_LEFT · listener registered (SDK call returned)
06:13:32.473 CarScopeDoor: PLEOS · ROW_1_LEFT · event raw=0 · access=READ_WRITE range=0..1
06:13:32.475 CarScopeDoor: PLEOS · ROW_1_LEFT · late initial read ignored after event
06:13:49.264 CarScopeDoor: PLEOS · ROW_1_LEFT · event raw=1   (Console PUT door_fl=true, HTTP 200)
06:13:54.467 CarScopeDoor: PLEOS · ROW_1_LEFT · event raw=0   (Console PUT door_fl=false, HTTP 200)
```

Console 조작은 P1-B2와 같은 방식으로 했습니다. 브라우저 세션 heartbeat를 보내면서 `PUT /vehicle/body`를 호출했고, 두 요청 모두 Console 상태가 실제로 바뀐 것을 확인했습니다.

## 성능 관측 (같은 세션)

- cold launch TotalTime: 3,734ms
- 앱 TOTAL PSS: 117MB(WebView 1개 포함), Java heap 9.7MB, Native heap 23.9MB
- gfxinfo(재실행 후 약 10초): frames 21, janky 100%, 50/90/99% 150/350/800ms, GPU 3/12/17ms

P1-B2의 이전 평면 도식도 같은 AVD에서 janky 100%였습니다. 이 수치만으로 Anatomy 도식이 느려졌다고도, 빨라졌다고도 판단하지 않습니다.

## Anatomy 검증 (호스트)

- `node tools/anatomy-car/build.mjs --audit`: `audit passed` (형상 50, item 26, 겹침 77, 순서 규칙 77)
- `scripts/lines.mjs`: closed / front-left-open / rear-left-open / both-open × light / dark 모두 `line ends: 0`
- `scripts/capture.mjs`: 1× 전체와 4× 뒷도어 열림 close-up, console clean
