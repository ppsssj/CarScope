# P3-A7 증거 인덱스

2026-11-01 KST. 새 worktree `C:\dev\CarScope-p3-a7`, 기준 `8c00b3fdfc72a9aecc7b599fafe9cf0998312264`.
전용 외부 루트: `C:\CarScope-External\p3-a7\`.

| 외부 파일/폴더 | 내용 |
|---|---|
| `baseline-ui-tests.txt`, `baseline-geometry-tests.txt` | 변경 전 최신 main 기준 9/9, 실제 자산 58/58 |
| `unit-final.txt`, `packaging-final.txt` | 최종 단위 12/12, Android 자산 통합 1/1 |
| `final-gates.json`, `final-*.txt` | 최종 브라우저·워셔액·빌드·Release 격리 명령과 종료 상태. 초기 unit 13개는 이후 12개 단위 + 1개 통합으로 분리 |
| `final-wide/`, `final-portrait/`, `final-landscape/` | 실제 CDP 클릭·그룹 강조·카메라·정확성 안내·복원·빠른 입력 검사 34/34씩. 각 results.json, browser-log.txt, actions.json 및 캡처 6장(목록/네 부품/종료) |
| `washer-wide/`, `washer-portrait/` | 기존 보닛·워셔액·QR 17/17씩, 캡처·원본 로그 |
| `browser-portrait*`, `portrait-*` | 초기 실패와 진단 실행. 최종 판정은 위 final-* 결과 |
| `geometry/inspection-components.json`, `geometry/svg/`, `geometry/inspection-*.glb` | P3-A6 기존 생성기의 새 실행: 361 충돌 행, SVG 동일성, GLB 0/0 |
| `apk-inspection.json` | debug 자산 20개 바이트 대조·APK SHA, release APK/AAB 자산·DEX·GLB 격리 |
| `avd-health.json` | 실제 emulator-5554 guest CPU 2개·loadavg·메모리 관측과 **BLOCKED** 사유. 신규 UI를 실행하지 않음 |
| `source-sha.json` | 원본 GLB/Blender 실행 전후 SHA 동일 |

Debug APK는 새 worktree의 무시되는 `app/build/outputs/apk/debug/app-debug.apk`에 있다. 생성 debug 자산과 Gradle 출력도 이 worktree 안에만 있다. 다른 작업 사본을 사용하지 않는다. 원본·파생 GLB/SVG·APK/AAB·로그·스크린샷은 Git에 넣지 않는다.

범위·명령·미검증 조건은 [검증 보고서](../../p3-a7-inspection-components-ui.md)에 있다. 브라우저 PASS와 Android 빌드 PASS를 AVD/실차 PASS로 해석하지 않는다.
