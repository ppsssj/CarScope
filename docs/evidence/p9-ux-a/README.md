# P9-UX-A 3D 위 Native QR 오버레이 evidence index

기준 `main` `6077fdd`. **AVD 결과는 APK `5dcada60…`의 것이다. 이후 수정(`2aa51cc`)을 담은 APK `4c0dda6d…`는 AVD에 설치하지 않았다. 실제 QR, 스마트폰 E2E, Render는 NOT_RUN이다.**

## 변경

- `InspectionActivity`가 Native 패널을 표시할 때 WebView를 `GONE`하지 않는다. 같은 인스턴스가 보이는 채로 남아 카메라, 선택, 점검 상태가 유지된다.
- 패널은 터치를 소비하는 전체 창 레이어 안에 있다. 패널 밖을 눌러도 3D로 전달되지 않고 패널이 닫히지도 않는다. 열려 있는 동안 WebView의 포커스와 접근성도 막는다.
- 창 폭이 840dp 이상인 가로 화면은 우측 패널(폭의 34%, 380~520dp)이고, 그 외에는 토스트 아래에서 시작하는 중앙 패널이다.
- 패널 닫기 버튼은 패널만 닫는다. 세션, 폴링, QR은 `점검 요청 취소`, Activity 중지, 만료까지 유지된다. 버튼 문구는 요청이 없는 `IDLE`, `CANCELLED`, `EXPIRED`에서 `패널 닫기`, 그 외에는 `패널 닫기 · 점검 요청 유지`다.
- 상태 문구를 구체화했다. 생성 권한 없음, 생성 중, 스마트폰 연결 전(`CREATED`), 스마트폰 연결됨(`CLAIMED`)을 구분한다. `phoneClaimed`는 표시 전용이며 권한을 주지 않는다.
- 새 QR이나 수락 버튼이 생기면 패널이 그 위치로 스크롤한다.

## 바꾸지 않은 것

`SyncReceiverController`의 전이와 검증, QR 렌더러, origin·proof·generation·digest 검증, `FLAG_SECURE`(패널이 열린 동안), onStop 시 자격 폐기, DENY_DEFAULT, Native→3D 브리지 계약, 수락 후 3D 후보를 사용자가 직접 선택하는 규칙, Render, PostgreSQL, 서버 인증 정책, GLB Geometry. 테스트용 QR이나 세션은 프로덕션 코드에 없다.

## 검증

| 검사 | 환경 | 결과 |
|---|---|---|
| `NativeOverlayActivityTest` 12개 | Robolectric | PASS. 패널과 WebView 공존, 터치·포커스·접근성 차단, 닫기와 취소 구분, QR 표시·연결 상태·만료·제거, 명시적 Accept 뒤 브리지 전달과 토큰 미포함, 권한 없을 때 QR 없음, 중지 시 폐기, 우측·중앙 배치. `isClickable`을 끄면 차단 테스트 실패. AVD 결함용으로 추가한 2개는 수정 전 실패를 확인 |
| `:app:testDebugUnitTest` | JDK 17 | 241/241 PASS (`2aa51cc`) |
| `:vehicle-core:test` | JDK 17 | 38개, 실패 0, skip 1 (로컬 자산이 필요한 `VehicleVisualAssetTest`) |
| `:app:assembleDebug` | JDK 17 | PASS. AVD 설치본 `5dcada603b235c632d731478b110e341c2a8515a116c0dcd3046b6851e5ba137`, 수정본 `4c0dda6db41c9092dbcdaf70766e4098870abe3cd8ac9c5934a6d821d5dc2aab`. 둘 다 `NEW_DECODER`, 서명 인증서 `eb971c3a…` |
| `npm test`, `test:android-assets` | Node 22.16.0 | 158/158, 4/4 PASS. 웹 코드는 바꾸지 않음 |
| `check-boundary.py` | 로컬 | NOT_RUN. Release 빌드 산출물이 필요해 CI의 release boundary job으로 판정 |

합성 transport를 쓴 테스트이며, 실제 서버 응답이나 스캔이 아니다. Robolectric의 WebView는 실제 입력을 처리하지 않으므로 터치 차단은 오버레이 바로 아래의 프로브 View로 쟀다. 닫힌 상태에서 프로브가 터치를 받는 것도 함께 확인했다. 실제 WebView로의 차단은 아래 AVD 결과를 본다.

## AVD 검증 (APK `5dcada60…`)

실행일 2026-11-05. `CarScope_Pleos_API34`, `emulator-5554`, API 34, user 10, `install --user 10 -r`. 서명 동일, 기기 APK 해시 일치, endpoint와 GLB 해시 동일. uninstall, wipe, 재부팅은 하지 않았다. 원본은 작업 PC `C:\CarScope-External\p9-ux-avd\`에 있고 Git에 넣지 않았다.

`FLAG_SECURE`가 켜지면 `screencap`이 0바이트를 돌려준다. 그래서 패널이 열린 동안은 접근성 트리, View 계층, 로그, 프레임 수로 판정했고, 패널 전후 프레임을 비교했다. 에뮬레이터 콘솔 캡처처럼 `FLAG_SECURE`를 우회할 수 있는 방법은 쓰지 않았다. **아래의 `눈 확인 필요`는 PASS가 아니다.**

| 항목 | 판정 | 근거 |
|---|---|---|
| 1. 3D 유지와 오버레이 표시 | 구조 PASS, 눈 확인 필요 | WebView `VISIBLE`, 같은 인스턴스, 오버레이가 그 위. 열린 동안 프레임 수 4152→4348 |
| 2. 패널 크기와 가독성 | 크기 PASS, 가독성 눈 확인 필요 | 520×1210px, 창 1682×1210의 31%, density 1.0. 본문 18sp, 제목 24sp. IDLE 내용 높이 893px로 스크롤 없이 들어감 |
| 3. 터치 차단 | PASS | 패널 밖 확대, 뒤로, 드래그와 패널 아래의 요약 버튼 위치에 입력. 3D 로그 0건, 닫은 뒤 픽셀 차이 0 |
| 3. 접근성 차단 | PASS | `uiautomator dump --compressed`에 WebView 노드 0개. 일반 덤프에는 나타나지만 이는 중요하지 않은 노드까지 포함하는 모드다 |
| 3. 키 포커스 | **FAIL → 수정, AVD 재확인 전** | 3D로 키가 새지는 않음. 첫 `DPAD_DOWN`이 보이지 않는 오버레이에 멈추고 `DPAD`로 패널에 들어갈 수 없었음(`TAB`은 가능) |
| 4. 닫은 뒤 카메라, 부품 선택, 기록 | PASS | Back으로 닫기와 터치로 닫기 모두 비교 영역의 차이 0. 터치 경로는 Web 창 전체 비교. `앞 왼쪽 타이어 ! 이상 징후 보고` 유지 |
| 5. 토스트와 패널 겹침 | 좌표 PASS, 눈 확인 필요 | 토스트 x 1455~1933, 패널 왼쪽 2015. 82px 간격. 두 요소를 함께 찍은 화면은 얻을 수 없음 |
| 6. 생성 권한 없음 | PASS | `IDLE · 생성 권한 없음 또는 확인 중 · QR을 만들 수 없습니다.` `점검 요청 생성`, 부품 선택, `이 결과 수락`, `점검 요청 취소`, `처리 상태 다시 확인` 비활성. QR 없음 |
| 6. 요청 없을 때 닫기 문구 | **FAIL → 수정, AVD 재확인 전** | 요청이 없는데 `점검 요청 유지`와 비활성인 `점검 요청 취소`를 안내함 |
| 7. Back | PASS | 패널이 열려 있으면 패널만 닫고 상태 유지. 닫혀 있으면 3D 이전 단계로 이동 |
| 7. 생명주기 | PASS | 패널을 연 채 설정 화면으로 갔다가 복귀. 같은 Activity, 새 `create` 없음, 패널 닫힘, `FLAG_SECURE` 해제, 카메라와 기록 유지 |
| 7. 복귀 후 모바일 요청 | PASS (fail-closed) | `Native 전달 불가 · 새 결과 적용 중단`. 요청이 시작되지 않음. 새 Activity에서 패널이 다시 열림. 브리지 코드는 이 PR에서 바꾸지 않음 |
| 8. ANR, Crash | PASS | `lastanr` 없음, `/data/anr` 새 파일 없음. `exit-info`의 이번 설치 이후 종료는 `PACKAGE UPDATED`, 화면 닫기의 `REMOVE TASK`뿐 |
| 서버 요청 | 요청 경로 없음 | `서비스 연결 확인`, `점검 요청 생성`을 누르지 않음. 앱 TCP 소켓 표본 0, netstats 트래픽 행 0. 패킷 캡처가 아니다 |

### 관측 (이 PR에서 바꾸지 않음)

- **결과 카드 갱신 지연:** 로컬 타이어 기록을 확정한 직후 `이 부품의 사용자 점검 결과`가 `○ 미점검`으로 남고, 화면이 다시 그려져야 `! 이상 징후 보고`로 바뀐다. 같은 화면 위쪽 기록과 목록은 바로 갱신된다. 이 PR은 Web 코드를 바꾸지 않았다.
- **다른 부품 요청의 토스트:** 대기 중 다른 타이어를 요청하면 패널이 열리지 않는데 토스트는 `Native 수신 화면을 요청했습니다`를 표시한다. AVD에서 재현했다.
- **키 조작 뒤 포커스:** 키로 포커스를 옮긴 상태에서 패널을 닫으면 Web 포커스 링이 요청 버튼이 아니라 `← 뒤로`에 생긴다. 터치로만 쓰면 생기지 않는다.
- **숨은 토스트 노드:** 토스트가 사라진 뒤에도 일반 접근성 덤프에 문구가 남는다. 실제 스크린 리더 동작은 확인하지 않았다.

### 측정 중 이탈

- 측정 중 쓴 `logcat -c`가 crash 버퍼까지 비웠다. 이 때문에 crash 버퍼 줄 수 비교는 근거로 쓰지 않았고, `exit-info`, `lastanr`, `/data/anr`로 판정했다.
- 복귀 후 시험에서 패널이 열리지 않아, 패널을 닫으려던 Back이 3D의 이전 단계로 이동했다. 시험 기록 외의 손실은 없다. 시험 끝에 화면을 닫아 메모리 안의 시험 기록은 지워졌다.
- 화면을 다시 띄우면서 WebView 내부 파일 `AwOriginVisitLoggerPrefs.xml` 해시가 바뀌었다. 나머지 앱 전용 파일 5개는 동일하다.

### 부하 수치 (참고용)

판정에 쓰지 않으며 **성능 PASS로 해석하지 않는다.** guest load 약 9~12(2코어), 앱 PSS 약 131 MB. 새 프로세스 기준 `gfxinfo` 3647 frames, janky 99.53%, p50 125ms. 패널이 없는 상태와 비교 측정하지 않았다.

## NOT_RUN과 한계

| 항목 | 상태 |
|---|---|
| 수정본 APK `4c0dda6d…`의 AVD 실행 (키 포커스, 요청 없을 때 문구) | NOT_RUN. 별도 승인 필요. Robolectric으로만 확인 |
| 패널이 열린 동안의 시각 확인 (3D 표시, 가독성, 토스트) | 사용자 확인 필요. 스크린샷으로 증명할 수 없음 |
| 실제 QR 생성, 스캔, 제출, 수락, QR 크기와 스크롤 | NOT_RUN. 현재 서버는 DENY_DEFAULT이며 G5~G8 승인이 필요 |
| 수락 후 실제 3D 반영 | NOT_RUN. 브리지 RPC까지만 합성 transport로 확인 |
| 화면 회전, 좁은 창의 중앙 패널 | NOT_RUN. Robolectric으로만 확인 |
| 성능 | 측정 안 함. 이전에는 WebView가 `GONE`이었으나 이제 패널 뒤에서 계속 렌더링한다 |

## 남은 동작

- 패널을 닫은 동안 스마트폰이 결과를 제출해도 3D 화면에 알림은 없다. 같은 부품의 요청 버튼으로 다시 열어야 한다. 이전과 같다.
- 패널을 연 채 또는 닫은 채 Activity가 중지되면 브리지가 폐기되어, 복귀 후에는 화면을 다시 시작해야 모바일 요청을 할 수 있다. 이전과 같다.
