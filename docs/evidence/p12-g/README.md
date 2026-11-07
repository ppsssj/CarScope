# P12-G 증거 인덱스

[사용법과 판정](../../p12-g-label-review.md). 원본은 `C:/CarScope-External/p12-g/`에 있고 Git에 넣지 않는다. 사진, 모델 응답, 키, 검수 결과는 저장소에 없다.

환경: Windows 10, Node 22.16.0, headless Chrome 157.0.8103.38.

| 범위 | 판정 | 근거 |
|---|---|---|
| 사진·해시·응답 확인 | **PASS.** 26장 | `npm run review:report` |
| 검수 UI, 저장·재로드, 재평가 (합성) | **PASS.** 브라우저 9건, 단위 시험 | `test/review-browser.mjs`, `test/review.test.mjs` |
| 실제 사진 26장을 UI에서 열기 | **PASS.** 저장 없음 | `test/review-real-smoke.mjs`, `smoke/` |
| **사람 검수** | **NOT_RUN. 0 / 26장, `AWAITING_HUMAN_REVIEW`** | 검수 파일 없음 |
| **검수 후 성능** | **NOT_RUN. `HUMAN_REVIEW_PENDING`** | |
| Roboflow 호출 | **0회** | 아래 |
| 모델 학습, 정확도 개선 | **하지 않음** | |
| Render, Supabase, QR, 세션, 운영 플래그 | **변경 없음** | |

## 데이터 확인 (이번 실행)

| 항목 | 결과 |
|---|---|
| 사진 파일 | 26 / 26 있음 (P12-C 12, P12-F 14) |
| SHA-256 | 26 / 26 일치 |
| 저장된 응답 | 26 / 26 유효, 예측 364개. `new-06`은 예측 0개 |
| P12-C 응답과 대조 | 12장 모두 `run2/results.json`과 동일 |
| 라이선스·출처 메타데이터 | 26 / 26 있음 |
| 누락·손상·불일치 | **0건** |
| 라벨 파일 | `labelsReviewedByPerson: false`, `main` 대비 변경 없음 |
| 초안 수치 재현 | P12-F의 5개 부품 TP/FP/FN과 동일 |

업로더의 권리 자체를 독립 검증하지는 않았다. 라이선스는 Commons 메타데이터 기준이다.

## 호출이 늘지 않았다는 근거

| 근거 | 내용 |
|---|---|
| 원장 파일 | `C:/CarScope-External/p12-f/calls.json` 19건, SHA-256 앞자리 `1c232ad4bbd3a0e8`, 수정 시각 2026-11-07 22:11:41 (P12-F E2E 마지막 호출 시각). 작업 전후 동일 |
| 코드 | 도구 파일에 호출 클라이언트, 원장, 키 읽기, 외부 주소가 없음을 시험이 검사 |
| 실행 | 실제 사진 실행에서 서버의 `fetch` 호출 0건, 브라우저 요청 전부 `127.0.0.1`, 쓰기 요청 0건, 검수 파일 생성 없음 |

## 화면

`smoke/`의 스크린샷을 직접 열어 확인했다. 사진이 들어 있어 Git에 넣지 않는다.

| 파일 | 내용 |
|---|---|
| `real-new-08-washer.png` | 워셔액 탭. 라디에이터 캡 위의 AI 예측 0.61, 초안 없음 |
| `real-commons-036-all-parts.png` | 모든 부품 보기. 점선 AI 상자와 흰 초안 |
| `real-leaf-case-evaluation.png` | Leaf 사례 필터, `HUMAN_REVIEW_PENDING`, 초안 수치 표 |
| `syn/synthetic-after-save.png` | 합성 데이터 저장 후 수치 |

## 테스트

| 검사 | 명령 | 결과 |
|---|---|---|
| `vision-poc` 전체 | `npm test` | PASS 126, FAIL 0 |
| 검수 화면 (합성, Chrome) | `npm run test:browser:review` | PASS 9, FAIL 0 |
| 실제 사진 읽기 전용 | `npm run test:review:real` | PASS. CI에서 실행하지 않음 |
| 서버·동기화 전체 | `tools/inspection-sync-poc`: `npm test` (PowerShell) | PASS 252, FAIL 0, SKIP 37 (로컬 DB 없음) |

요구된 항목 대응: SHA-256(1), 좌표 변환(2), 확대·이동 후 위치(3), 수정·저장·재로드(4), 진행률(5), `UNKNOWN`/`ABSENT`(6), 미검수 승인 차단(7), 잘못된 파일 거부(8), 라벨 불변(9), 저장된 응답 재사용(10), 수정 후 수치 갱신(11), 호출 0(12), 회귀(13).

합성 시험의 "검수자"는 `synthetic-tester`이고 파일은 `synthetic: true`이며 임시 폴더와 함께 지운다. **CI 성공은 사람 검수의 증거가 아니고 실제 성능의 증거도 아니다.**

### 변이 (선택한 조건만 대상, 완전성 증명이 아님)

규칙을 하나씩 임시로 깨고 복원했다. 대상 18건: 검수자, 미판정 완료, `ABSENT`의 박스, 변경된 사진, 검수자 없는 파일, `UNKNOWN` 집계, 미완료 저장 집계, 합성 파일 집계, 대기 중 수치, 부분을 완료로 표시, 응답 누락, 해시 미검사, 합성 파일을 검수로 열기, 다른 사이트의 쓰기, 전용 헤더, 저장소 안 파일, 이전 사본의 덮어쓰기, 전체 주소 수신.

처음 실행에서 **"미완료 저장 집계" 1건을 시험이 놓쳤다.** 코드는 맞았지만 지키는 시험이 없었다. 완료 사진과 미완료 저장이 섞인 경우의 시험을 추가했고 다시 실행해 18건 모두 시험이 실패하는 것을 확인했다.
