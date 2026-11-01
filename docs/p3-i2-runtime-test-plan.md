# P3-I2 Android Tire 런타임 재실행 계획

이 문서는 **실행 절차**이며 실제 기동 PASS 기록이 아니다. 현재 결과는 [보고서](p3-i2-tire-avd-runtime.md), 원본 위치는 [증거 인덱스](evidence/p3-i2/README.md)를 따른다.

## 1. 작업·장치 격리

1. Tire 전용 Worktree의 status/HEAD와 Debug APK hash를 기록한다. AR 서버·모바일 페이지·Receiver 작업 사본을 사용하지 않는다.
2. 기존 SDK/AVD를 사용한다. AVD 생성, 이미지 재설치, emulator/system server 재시작, Windows 가상화 변경, SystemUI 우회, SDK worker 종료를 하지 않는다.
3. 대상은 명시적 serial과 **CarScope_Pleos_API34** 이름이 일치해야 한다. 다른 장치가 연결돼 있어도 명령을 보내지 않는다.
4. 실행 중인 `io.carscope.app` 프로세스가 있으면 도구는 BLOCKED다. 다른 작업의 Receiver/SDK 세션을 설치나 화면 전환으로 중단하지 않는다. 소유자가 정상 종료한 격리된 실행 시점에서 다시 진행하며 무단 force-stop하지 않는다.
5. 매 실행마다 새로운 외부 evidence 디렉터리를 사용한다. 도구는 기존 health/results와 다른 run ID의 WebView 결과를 재사용하지 않는다.

## 2. Health Gate와 준비

```powershell
python -B tools/tire-probe/runtime/run.py --out=C:/CarScope-External/p3-i2/health-NEW
```

기본 호출은 읽기 전용이다. SDK 파일·PC 환경, `adb devices -l`, 정확한 AVD/boot/API34, CPU/load·메모리·저장 공간, SystemUI PID 안정성, 현재 WebView provider, 현재 Android user의 활성 Vehicle Service package/version을 수집한다. 대상이 없으면 guest 조회도 중단한다. BLOCKED는 exit 2이며 정상 실행 PASS가 아니다.

Gate 예산: 3개 표본에서 1분 load/CPU ≤1, 5분 load/CPU ≤1.5, ADB echo ≤1s, service 조회 ≤2s, MemAvailable ≥512MiB, /data 여유 ≥256MiB, SystemUI PID 단일·불변 및 최근 fatal/ANR 없음. OEM 성능 보증값이 아니라 기존 Tire probe 예산을 확장한 보수적 실행 조건이다. 값 미수집/파싱 실패도 BLOCKED다.

PASS일 때만 로컬 Debug 자산과 필수 빌드를 수행한 뒤 설치·실행한다. 런타임 도구 자체가 빌드/다운로드/AVD 준비를 자동 수행하지 않는다.

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain
python -B tools/tire-probe/runtime/run.py --run --install --out=C:/CarScope-External/p3-i2/device-NEW --serial=emulator-5554 --apk=app/build/outputs/apk/debug/app-debug.apk --glb=C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb
```

`--run`도 gate를 새로 수집한다. `--install` 없이 실행하려면 이미 설치된 APK hash가 검증된 로컬 Debug APK와 같아야 한다. aapt의 package/debuggable, APK의 debug 클래스·필수 자산·GLB 미포함을 확인한다. 모델은 기존 `run-as` app-private 주입 절차와 SHA 대조를 사용하며 이번 실행의 유일한 temp 파일만 삭제한다. 호스트 원본/다른 모델/공유 저장소는 수정하지 않는다.

## 3. 자동 관측 범위

실행 도구는 이 앱 PID의 기존 `webview_devtools_remote_<pid>` socket만 찾아 일시적인 loopback forward로 연결한다. private origin의 보이는 Inspection page가 하나여야 한다. 소켓이 없거나 여러 page가 모호하면 BLOCKED이며 debug flag·CSP·native bridge를 추가하지 않는다.

- 기존 WebView에서 모델 ready/render, 네 ID, 목록 선택·고무 강조·타이어 전환·camera 복원을 확인한다. 입력은 CDP pointer이며 물리 터치 검증으로 표시하지 않는다.
- 실제 Network response의 private GET 주소, HTTP200, no-store, **검증된 APK와 동일한 CSP**, 정확한 status-only JSON 및 JS store의 일치를 대조한다. 응답 header/status, metadata snapshot과 Android screencap을 외부에 저장한다.
- PLEOS 외 source로 실제 런타임 PASS를 만들지 않는다. Capability는 8개 행을 모두 지원/미지원으로 확인해야 aggregate PASS다. 일부 ERROR/UNVERIFIED/권한 거부는 API 미지원으로 바꾸지 않는다.
- Probe를 foreground한 뒤 Inspection으로 돌아와 새 UI lease 세대를 관측한다. 이 결과를 OS 회전/SavedInstanceState 복원이나 실제 늦은 SDK callback 검증으로 확대하지 않는다.
- 부하/부팅/AVD identity가 나빠지면 중단한다. 정리 대상은 이번 forward와 호스트 도구뿐이며 강제 app/SDK 종료를 하지 않는다. 중단 후 화면이 남을 수 있다.

## 4. 실제 AVD에서 개별 완료할 체크리스트

| 시나리오 | 필요한 증거 | 자동/수동 및 판정 주의 |
|---|---|---|
| A 초기 실행/종료 | Activity log, 모델 PNG, Network status JSON, close/pause/destroy log | close 요청 반환은 원격 SDK release ack가 아님 |
| B Probe ↔ Inspection | 두 화면 PNG, 이전/새 UI sessionId, lifecycle log, 새 소유자 상태 | 이전 Activity stop이 현재 lease를 중지하지 않는지 별도 확인 |
| C Activity 회전/재생성 | 격리된 emulator UI에서 회전/재생성, create/destroy, 새 sessionId/sequence, 이전 관측 없음 | 자동 도구의 화면 전환과 구분. 전역 rotation/개발자 설정을 도구가 변경하지 않음 |
| D 실제 SDK 무응답 | 실제 timeout log, pending/UNRESOLVED, 재진입에도 initialize가 중복되지 않는 구간 | backend callback을 조작하거나 SDK/서비스를 강제 중단해 결과를 만들지 않음. 미관측이면 NOT_RUN |
| E WebView/화면 경계 | visibility/pause/resume, late response 폐기, renderer 종료 시 finish/lease 정리 | renderer 종료는 건강한 격리 환경의 별도 수동 DevTools 시나리오. SDK worker/process kill로 대체하지 않음 |
| 원시 데이터/출처 | 8행의 두 feature 상태와 실제 observedAt, PLEOS label | raw 수치·단위·압력 판정은 UI에 표시하지 않음. MOCK을 실제 수신으로 기록하지 않음 |
| 보안 경로 | private GET 응답/header, query/POST 거부, 원래 CSP/자산/권한 | 외부 요청을 전송하거나 정책을 완화하지 않음. fragment는 실제 요청 URL 정규화와 parser 검증을 구분 |
| 기존 3D | 네 바퀴 실제 선택·회전/확대·뒤로, resize, 보닛/부품/QR | SDK 실패와 UI 선택 실패를 분리 기록 |

## 5. SDK 관측 표

각 `tire.pressure` / `tire.low-pressure` × 4개 ID에 대해 capabilityStatus, availabilityStatus, observedAt 유무, source, 최초/최종 관측 시각과 근거 파일을 기록한다. 예상 SDK2.3.2 / Service2.3.22는 실행 전제일 뿐 실제 버전 증거가 아니다. `health.json`의 실제 serviceVersion을 사용한다.

`initialize()` 호출 반환, capability 응답, getter 응답, register 호출 반환, 실제 listener callback을 별도로 구분한다. 초기화 완료 callback이나 원격 release acknowledgement가 관측됐다고 추정하지 않는다. 새로운 데이터/이벤트가 없으면 NOT_RUN 또는 BLOCKED로 남기고 기본 0/정상 상태/자동 MOCK으로 채우지 않는다.

STALE은 실제 관측이 있을 때 기존 >5000ms 정책으로만 확인한다. 값이 없으면 STALE 실측 PASS를 주지 않는다. 정상/저압/안전 판정과 단위 환산은 금지한다. 후속 수치 표시는 공식 단위·의미, getter/listener 관계·업데이트 주기, 실차 영역 매핑과 실제 관측이 추가 검증된 뒤 별도 과제로 진행한다.
