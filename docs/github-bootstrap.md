# G0 — GitHub bootstrap 및 두 PC 공유

대상: [ppsssj/CarScope](https://github.com/ppsssj/CarScope). 확인일: 2026-10-30. **P1-B는 BLOCKED**이며 소스 업로드는 SDK 초기화·데이터 수신·P2 진입 성공을 의미하지 않습니다. SDK 2.3.2 / 연구실 AVD Service 2.3.22/code 74를 유지합니다.

## 업로드 전 감사

- 로컬 main은 unborn HEAD였으며 기존 commit 객체는 0개, index의 tracked 파일도 0개였습니다. 원격 URL이 대상과 일치했고 `git ls-remote --symref origin`은 exit 0/빈 refs, GitHub metadata는 size 0/default main/Private이었습니다. fetch 후에도 원격 commit이 없었습니다.
- 로컬 툴의 checkpoint/capture refs·tree/blob는 존재했습니다. 기존 PNG 11개와 일치하는 캡처 객체를 포함하지만 main의 commit 이력은 아닙니다. 이를 삭제하거나 원격 이력으로 편입하지 않습니다. **main만 명시적으로 push**하고 `--all`, `--mirror`, `--tags`, force는 사용하지 않습니다.
- 기존 파일 inventory/hash 및 수정 전 사본, Git/보안 감사 결과는 Git 제외 `.tools/g0/`에 보존합니다. 제품 소스, 버전 설정, 기존 core 테스트, 이전 로컬 증거 파일은 삭제하지 않습니다.
- 저장소 공개 범위는 **Private 유지**입니다. 저장소 생성·삭제·공개 범위 변경·PR·merge·Android 재설치·AVD 실행을 수행하는 단계가 아닙니다.

## 업로드 범위와 보안

포함: app/vehicle-core 소스와 36개 테스트, Gradle 8.14 Wrapper 네 파일, 공통 Gradle 설정, README·architecture·feasibility·roadmap·validation·설정 가이드. evidence에는 설명 README만 공유합니다.

제외: local.properties, SDK/JDK 개인 설치 설정, .gradle/.kotlin/.idea/.tools/build, APK/AAB/AAR/JAR(공식 Wrapper 예외), keystore/jks/private key, .env, 원본 시스템 로그·환경 JSON·JUnit XML·스크린샷, SDK·AVD 이미지. 각 PC에서 생성·설정해야 합니다. 기존 evidence 파일은 연구실 PC에 그대로 남고 clone으로 전송되지 않습니다. 공유 문서의 개인 절대경로와 제외 파일 직접 링크를 이식 가능한 표기로 바꿨습니다. 결과 판정과 과거 실패는 유지합니다.

고신뢰 토큰 형식, credential URL, private key marker, 비밀값 대입, 개인 이메일과 개인 절대경로를 후보 파일·staged blob에서 검사하고 파일명/크기/바이너리를 별도로 검토합니다. 정규식 검사는 모든 비밀의 부재를 수학적으로 증명하지 않으므로 최종 staged diff도 검토합니다. 기존 Git text blob에서도 해당 비밀값 패턴은 발견되지 않았습니다. Wrapper는 실행 클래스와 내장 license, 공식 SHA-256 `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`을 확인했습니다. Vendor SDK binary는 포함하지 않습니다.

최초 commit은 기존 작성자 이름을 유지하고 해당 GitHub 계정의 noreply 이메일을 이 명령에만 지정합니다. 개인 전역 Git 설정·인증 token을 저장소에 복제하지 않습니다.

## 검증과 이력

G0에서 JDK 17 / Wrapper 8.14를 실제 실행하고 `:vehicle-core:test :app:testDebugUnitTest --rerun-tasks --offline`을 재실행했습니다. **core 17 + app 합성 19 = 36 PASS**, failures/errors/skipped=0입니다. 제품 로직/AGP/Kotlin 버전 변경 및 에뮬레이터 반복 실행은 없습니다. P1-B의 APK build/install PASS는 당시 기록이며 G0에서 APK를 업로드하거나 SDK 실연동을 재검증하지 않습니다.

| P1-B 실행 항목 | 판정 |
| --- | --- |
| SDK initialization | BLOCKED |
| Door capability / current state | BLOCKED / BLOCKED |
| Door event | NOT_RUN |
| 실제 SDK SVG | BLOCKED |
| OEM/framework | ANR/VHAL/system 사망 기록 있음 |
| CarScope FATAL/ANR | 수집 범위에서 미발견, 안정성 PASS로 확대하지 않음 |

최초 commit 메시지: `feat: bootstrap CarScope Android app and Pleos SDK integration`. local main과 원격 refs/heads/main SHA를 대조하고, 원격을 별도 경로에 다시 clone하여 source/Wrapper/tests/docs 포함과 제외 파일 부재를 확인합니다. 확정 SHA와 push 결과는 작업 최종 보고 및 GitHub main 이력에서 확인합니다. 원격 확인 영수증은 `.tools/g0/`에 보존합니다. CI workflow는 이번에 추가하지 않았으므로 CI PASS를 주장하지 않습니다.

## 이후 작업

[development-setup](development-setup.md)에 따라 각 PC에서 JDK 17, SDK API 34/Build Tools 35.0.0, 인증 및 Pleos AVD를 준비합니다. 새 clone에는 로컬 설정이나 원본 증거가 없는 것이 정상입니다. 최초 네트워크 다운로드·집 PC 하드웨어·실제 Service 버전은 집 PC에서 확인해야 합니다.

다음 권장 브랜치는 `fix/p1-b2-pleos-runtime`입니다. 최신 main에서 분기하고 안정적인 Pleos 환경에서 T1~T10을 먼저 완료합니다. 기능 브랜치 → 검증 → commit/push → PR/CI·변경 검토 → 승인 후 merge → 다른 PC의 `git pull --ff-only` 흐름을 사용합니다. G0는 이 후속 PR이나 P2 기능을 만들지 않습니다.
