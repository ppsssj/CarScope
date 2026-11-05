# P9-A2.1 PR #82 병합 후 AVD 회귀 evidence index

실행일 2026-11-05. 기준 `main` `6077fdd`. AVD `CarScope_Pleos_API34`, `emulator-5554`, API 34, user 10. 재부팅, wipe, uninstall은 하지 않았다. 이 작업에서 Git 변경은 없었고, 이 문서는 후속 P9-UX-A PR에서 추가했다.

**범위:** 토스트 수정이 실제 Pleos WebView에서 동작하는지까지다. **Render, 운영 인증, enrollment, QR, 스마트폰 E2E는 NOT_RUN이다.**

원본은 작업 PC `C:\CarScope-External\p9-a2-regression\`에 있으며 Git에 넣지 않았다.

## 빌드와 설치 (PASS)

| 항목 | 결과 |
|---|---|
| APK | `carscope-debug-6077fdd.apk`, `e5041f594acfa085c7c26d80a92f65da55e7ef6e4122a62c7487c54995b0ccd5` |
| 세대 | `NEW_DECODER`. 설치 전후 모두 compat PASS |
| 설치 | `install --user 10 -r`, 서명 동일, 기기에서 다시 받은 파일과 해시 일치 |
| 토스트 자산 | APK 안의 `inspection-toast.mjs`가 소스와 해시 일치 |
| 테스트 | 토스트 6/6, three-poc 158/158, 자산 4/4, core 38개(실패 0, skip 1: 로컬 자산이 필요한 `VehicleVisualAssetTest`), app 229/229 |
| app-private | 파일 목록 변화 없음. endpoint와 GLB(`cfe0d754…`) 해시 동일 |

## 토스트 (AVD, 실제 터치)

JS를 실행하지 않고 프레임 캡처로 쟀다. 프레임 하나가 약 1초 구간이라 시간은 구간 값이며, 4.0초를 정확히 잰 것이 아니다. 클릭 시각이 0이고 Native 패널이 덮은 동안에는 측정할 수 없다.

| 항목 | 판정 | 근거 |
|---|---|---|
| 문구 | PASS | `Native 수신 화면을 요청했습니다 · 세션 생성 전입니다` |
| 자동 해제 (3회) | PASS | 마지막 표시 프레임이 시작한 시점 3.6~4.5초, 사라진 첫 프레임이 끝난 시점 5.5~6.7초 |
| 연속 클릭 (3.0초, 3.5초 재클릭) | PASS | 첫 타이머 시점을 지난 7.0~7.9초에도 표시되고, 이후 사라짐 |
| Back으로 힌트 화면 전환 | PASS | 5.4초에 새 힌트만 표시되고 9.6초에는 사라짐 |
| 전체 요약·종료로 전환 | PASS | 전환 프레임에 토스트 없음 |
| 3D와 기록 유지 | PASS | 렌더링 정상. 앞 왼쪽 타이어 기록이 토스트와 Native 패널 뒤에도 요약에 유지 |

**관측 (당시 결함 아님, UX 사항):** Native 패널이 클릭 후 약 1~2.4초에 3D를 덮어서 패널에 머무는 동안 토스트가 보이지 않았다. [P9-UX-A](../p9-ux-a/README.md)가 이 문제를 다룬다.

## ANR·Crash·서버 경계

| 항목 | 결과 |
|---|---|
| 새 ANR | 없음 (`lastanr`) |
| 앱 crash | 없음. crash 버퍼 줄 수 변화 없음, `io.carscope` 0건. 앱 종료 기록은 설치로 인한 `PACKAGE UPDATED`뿐 |
| 서버 요청 | 코드 경로상 same-origin RPC와 같은 Activity의 패널뿐. 인증 로그 0줄, 앱 TCP 소켓 표본 0, netstats 행 0. 패킷 캡처가 아니다 |

## 부하 수치 (참고용)

사용자가 CPU·메모리·Load Average만으로 테스트를 중단하지 않기로 결정했으므로 판정에 쓰지 않았고, **성능 PASS로 해석하지 않는다.** guest load 8.7~15.7(2코어), 호스트 가용 메모리 사후 약 3.1 GiB, `gfxinfo` 5377 frames, janky 98.27%, p50 125ms, 앱 PSS 약 134 MB.

## 측정 중 무효·이탈

- 초기 측정 2회는 프로브 오류로 무효 처리했다. 버튼을 못 맞혔거나 복귀 탭이 패널 표시 전에 도착했다.
- 측정 1회에서 탭이 `전체 점검 요약` 대신 `점검 종료`에 맞았다. 확정 기록이 없어 손실은 없었고, 결과는 힌트 없는 화면 전환 근거로만 썼으며 실제 요약 경로를 다시 측정했다.

## NOT_RUN

실패 문구의 AVD 표시(어댑터가 연결돼 있어 이 경로로 가지 않음, 브라우저로만 검증), 3회 이상 연속 클릭, Render, `/v1`, enrollment 발급, QR, 스마트폰 E2E.
