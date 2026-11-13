# P16 실행 증거 인덱스

2026-11-13, Windows / Node 22.16.0 / Chrome 157.0.8103.78. 이 문서는 이번 새 실행의 인덱스이다. P15 운영 검증 결과를 이번 실행의 LIVE_PASS로 재사용하지 않는다. 원본 캡처·로그·GLB·키는 Git에 넣지 않았다.

| Gate | 결과 | 명령 / 관찰 |
| --- | --- | --- |
| 정적 검사 | LOCAL_PASS | `npm run check --prefix tools/carscope-account` (Claude 인수 모듈 포함) |
| 계정 단위/통합 | MOCK_PASS | `npm test --prefix tools/carscope-account`: 60 PASS |
| 브라우저 통합 | MOCK_PASS | `npm run test:integration-browser --prefix tools/carscope-account`: 실제 supabase-js, 모의 Auth/Data API, 실제 Chrome. PKCE callback→내 차량→3D→복귀/복구, 타인·삭제·잘못된 UUID, 실제 삭제 버튼→탭 알림, 로그아웃, 계정 전환, 비로그인, WebView 차단, 토큰 URL/console 검사 |
| 실제 로컬 GLB | LOCAL_PASS | 같은 브라우저 명령에 `CARSCOPE_IONIQ5_GLB` 설정. 모델 로드, 카메라, 보닛 개폐, 타이어 부품 탐색. 실제 OEM 형상/실차 검증 아님 |
| 3D 기존 회귀 | LOCAL_PASS | `npm test --prefix tools/three-poc`: 348 PASS, 기존 TODO 1, FAIL 0 |
| Android 패키징 경계 | LOCAL_PASS | `npm run test:android-assets --prefix tools/three-poc`: 4 PASS. 실제 WebView/AVD 실행과 다름 |
| 모바일 기존 회귀 | LOCAL_PASS | `npm test --prefix tools/mobile-ar-poc`: 183 PASS |
| QR/동기화 회귀 | LOCAL_PASS / NOT_RUN | `npm test --prefix tools/inspection-sync-poc`: 271 PASS, PostgreSQL 필요 41 SKIP. skip은 PASS 아님 |
| core JVM | LOCAL_PASS | `.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: BUILD SUCCESSFUL |
| 실제 RLS 새 실행 | NOT_RUN (로컬) | `npm run test:rls --prefix tools/carscope-account`: 로컬 스택 미설정. CI의 기존 local-stack gate에서 수행. 새 `repo.get()`의 타인 UUID 거부도 검사 |
| 운영 Google/Supabase | NOT_RUN | 운영 DB·설정·사용자 데이터 접근/변경 없음 |
| 실폰 카메라·AI 분석·차량 앱 전송·저장 이력 재조회 | NOT_RUN | 이번 PR의 모의/로컬 결과로 최종 제품 E2E 성공을 주장하지 않음 |
| Android AVD/실차 | NOT_RUN | 사용자 지시에 따라 장시간 AVD 보류 |

원본(로컬 전용): `C:\CarScope-External\p16-integration\summary.json`, `selected-desktop.png`, `selected-mobile.png`; `C:\CarScope-External\p16-*-test.log`, `p16-account-unit-final.log`, `p16-account-check.log`, `p16-android-assets.log`, `p16-core.log`, `p16-rls.log`.

초기 검사에서는 기존 boundary test의 LF 전용 정규식이 Windows CRLF에서 실패했다. 검증 조건을 줄이지 않고 `\r?\n`/`\r?$`로 수정해 재실행했다. 브라우저 테스트 작성 중에는 모의 OAuth redirect interception과 cross-tab 인증 이벤트 재현 방식을 수정했다. 최종 결과는 수정 후 실행 기준이다. inspection-sync 패키지에는 lockfile이 없어 초기 `npm ci`는 거부됐으며, 저장소 문서의 `npm install --ignore-scripts --no-audit --no-fund --package-lock=false`로 의존성만 설치했다.

CI는 PR의 head SHA에 대한 GitHub Actions 결과를 별도로 확인한다. 계정 CI에는 기존 RLS gate를 유지하고 신규 단위/브라우저 통합을 추가했다. CI 브라우저에는 저장소 밖 GLB가 없으므로 geometry는 NOT_RUN으로 표시하며 로컬 GLB 결과와 구분한다.
