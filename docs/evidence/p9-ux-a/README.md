# P9-UX-A 3D 위 Native QR 오버레이 evidence index

기준 `main` `6077fdd`. **이 문서의 결과는 JVM·Robolectric과 빌드 범위다. 오버레이의 AVD 실행은 NOT_RUN이다.**

## 변경

- `InspectionActivity`가 Native 패널을 표시할 때 WebView를 `GONE`하지 않는다. 같은 인스턴스가 보이는 채로 남아 카메라, 선택, 점검 상태가 유지된다.
- 패널은 터치를 소비하는 전체 창 레이어 안에 있다. 패널 밖을 눌러도 3D로 전달되지 않고 패널이 닫히지도 않는다. 열려 있는 동안 WebView의 포커스와 접근성도 막는다.
- 창 폭이 840dp 이상인 가로 화면은 우측 패널(폭의 34%, 380~520dp)이고, 그 외에는 토스트 아래에서 시작하는 중앙 패널이다.
- `패널 닫기 · 점검 요청 유지`는 패널만 닫는다. 세션, 폴링, QR은 `점검 요청 취소`, Activity 중지, 만료까지 유지된다.
- 상태 문구를 구체화했다. 생성 권한 없음, 생성 중, 스마트폰 연결 전(`CREATED`), 스마트폰 연결됨(`CLAIMED`)을 구분한다. `phoneClaimed`는 표시 전용이며 권한을 주지 않는다.
- 새 QR이나 수락 버튼이 생기면 패널이 그 위치로 스크롤한다.

## 바꾸지 않은 것

`SyncReceiverController`의 전이와 검증, QR 렌더러, origin·proof·generation·digest 검증, `FLAG_SECURE`(패널이 열린 동안), onStop 시 자격 폐기, DENY_DEFAULT, Native→3D 브리지 계약, 수락 후 3D 후보를 사용자가 직접 선택하는 규칙, Render, PostgreSQL, 서버 인증 정책, GLB Geometry. 테스트용 QR이나 세션은 프로덕션 코드에 없다.

## 검증

| 검사 | 환경 | 결과 |
|---|---|---|
| `NativeOverlayActivityTest` 10개 | Robolectric | PASS. 패널과 WebView 공존, 터치·포커스·접근성 차단, 닫기와 취소 구분, QR 표시·연결 상태·만료·제거, 명시적 Accept 뒤 브리지 전달과 토큰 미포함, 권한 없을 때 QR 없음, 중지 시 폐기, 우측·중앙 배치. `isClickable`을 끄면 차단 테스트 실패 |
| `:app:testDebugUnitTest` | JDK 17 | 239/239 PASS |
| `:vehicle-core:test` | JDK 17 | 38개, 실패 0, skip 1 (로컬 자산이 필요한 `VehicleVisualAssetTest`) |
| `:app:assembleDebug` | JDK 17 | PASS. `5dcada603b235c632d731478b110e341c2a8515a116c0dcd3046b6851e5ba137`, `NEW_DECODER`, 서명 인증서 `eb971c3a…`. 이 PR의 코드와 같은 트리에서 빌드 |
| `npm test`, `test:android-assets` | Node 22.16.0 | 158/158, 4/4 PASS. 웹 코드는 바꾸지 않음 |
| `check-boundary.py` | 로컬 | NOT_RUN. Release 빌드 산출물이 필요해 CI의 release boundary job으로 판정 |

합성 transport를 쓴 테스트이며, 실제 서버 응답이나 스캔이 아니다. Robolectric의 WebView는 실제 입력을 처리하지 않으므로 터치 차단은 오버레이 바로 아래의 프로브 View로 쟀다. 닫힌 상태에서 프로브가 터치를 받는 것도 함께 확인했다. 실제 WebView로의 차단은 AVD 확인 항목이다.

## NOT_RUN과 한계

| 항목 | 상태 |
|---|---|
| 오버레이의 실제 AVD 표시, 배치, 터치, 포커스 | NOT_RUN. 새 APK 설치는 별도 승인 후 진행 |
| 실제 QR 생성, 스캔, 제출, 수락 | NOT_RUN. 현재 서버는 DENY_DEFAULT이며 G5~G8 승인이 필요 |
| 수락 후 실제 3D 반영 | NOT_RUN. 브리지 RPC까지만 합성 transport로 확인 |
| 패널이 열린 동안 3D의 시각적 유지 | 스크린샷으로 증명할 수 없음. `FLAG_SECURE`가 창 전체를 가린다. AVD에서는 에뮬레이터 화면을 눈으로 확인하고 uiautomator 트리를 기록한다 |
| 성능 | 측정 안 함. 이전에는 WebView가 `GONE`이었으나 이제 패널 뒤에서 계속 렌더링한다 |

## 남은 동작

- 패널을 닫은 동안 스마트폰이 결과를 제출해도 3D 화면에 알림은 없다. 같은 부품의 요청 버튼으로 다시 열어야 한다. 이전과 같다.
- 대기 중인 요청이 있을 때 다른 부품을 요청하면 브리지가 거부한다. 이때 토스트는 요청 시작 문구를 잠시 보여 줄 수 있다. 브리지 동작은 이전과 같으며, 토스트 문구는 이번 범위에서 바꾸지 않았다.
