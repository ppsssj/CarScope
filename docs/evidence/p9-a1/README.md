# P9-A1 실행 절차 정정 evidence index

문서 수정만 있다. 앱·서버·테스트·차량 모델 코드는 바꾸지 않았다. **AVD 실행, APK 설치, Render 배포, 운영 DB 접근은 하지 않았으므로 절차의 기기 동작은 NOT_RUN이다.**

기준: `main` `8a6f559`. 실행일 2026-11-05, Windows 10, Node 22.16.0, PowerShell 5.1.19041.

## 고친 오류

| 오류 | 수정 |
|---|---|
| `sync-endpoint.json` 배치 누락 | 위치, 규칙, 명령, 확인 방법 추가 (B2) |
| GLB 배치 누락 | 실행 위치, 입력, 대상, 명령, 확인, 복구 추가 (B3) |
| DENY_DEFAULT에서 세션 생성 성공을 기대 | 기본 상태와 시뮬레이터, enrollment, 세션, `serverNow`, Native→3D 분리 (C1~C6). 배포 순서 수정 |
| `serverNow` 설명이 현재 상태와 다름 | main 병합, Render 미배포로 갱신 |
| `serverNow`를 앱 진단으로 확인한다는 근거 없는 표현 | 기기에는 값이 나오지 않으므로 간접 판정으로 수정 (C5) |
| DevTools 전제 미기재, `/proc/net/unix` 의존 | 기존 사용 기록의 PID 소켓 방식과 BLOCKED 처리로 수정 (D) |
| 작업 위치가 섞인 명령 | 저장소 루트 기준으로 통일 |

## 코드 대조

| 검사 | 결과 | 범위 |
|---|---|---|
| 상대 링크와 GitHub 앵커 (변경 문서 5개) | PASS | 일회성 스크립트. 저장소에 추가하지 않음 |
| 문서의 스크립트 경로, `avd-simulator-admin`·`deployment-preflight` 인자 | PASS | 실제 파서 호출. 운영 연결 없음 |
| 인용한 화면 문구·도구 출력 24개 | PASS | 소스 문자열 대조 |
| PowerShell 5.1 인자 확장 | PASS | 실제 셸. adb는 실행하지 않음 |
| PowerShell 5.1 파이프 바이트 | ASCII, BOM 없음, CRLF 추가 | 실제 셸 |
| endpoint 형식과 실제 Kotlin 파서 (Git 밖 복사본, 임시 JVM 테스트) | 문서 값 + CRLF 로드, 시뮬레이터 허용. `http`, 경로, query, 추가 키, 2048 bytes 초과 거부. 다른 origin은 로드되나 미허용 | JVM. 기기 아님 |
| enrollment 형식과 실제 Kotlin 파서 | LF·CRLF 통과, 만료·다른 endpoint 거부 | JVM. 합성 값 |
| `deployment-preflight.test.mjs` (문서-DDL 일치 포함) | PR 체크 참조 | CI 범위 |

코드 대조에서 작성 중 오류도 찾았다. grant "만료 전 재요청"은 코드에 없어 삭제했다. 자동 재요청이 없으므로 120초 뒤 생성 버튼이 비활성이 된다.

## 미검증

- 기기에서의 `run-as`, `pm path`, `pull`, DevTools 소켓, 화면 전환: NOT_RUN.
- 호스트 메모리·load 중단 기준은 과거 관측에서 정한 제안값이며 측정으로 조정하지 않았다.
- Render 재배포 화면이 어떤 커밋을 배포하는지, 정확한 현재 배포 커밋: NOT_VERIFIED.
- 운영 `serverNow` 숫자 값을 직접 보는 도구는 없다. 간접 판정만 가능하다.

원본 로그는 작업 PC `C:\carscope-external\p9-a1\logs\`에 있으며 Git에 포함하지 않는다.
