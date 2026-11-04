# P7-B 모바일 AR/QR 점검 커버리지

2026-11-04. 작업 사본 `C:\dev\CarScope-p7-ar`, 브랜치 `feat/p7-mobile-ar`. 시작 HEAD와 fetch한 `origin/main`은 `b99f177ec044b58a93279b7341d7885116a2dd48`, 로컬 main은 `ef6f2afe8e90257ea0a3d095df4c8187555f6b84`였다. origin은 `https://github.com/ppsssj/CarScope.git`. 시작 working tree는 깨끗했다. 다른 worktree·미병합 PR은 가져오지 않았다.

모바일/Node는 **17개 exact task**에 대해 카메라/수동 위치 안내 → 명시적 육안 응답 → 검토·확정 → QR v2 세션 제출 → 영수증 확인 → Node 수신자 명시적 수락을 지원한다. Native Kotlin/SDK·3D 모델과 앱 연결은 수정하지 않았다. 실제 스마트폰·차량용 앱 수락·실물 인식 정확도는 이 변경에서 NOT_RUN이다. Node ACCEPTED를 실제 차량 수락으로 보고하지 않는다.

## 전수조사와 재사용

| 코드 | 조사 결과와 변경 |
|---|---|
| `mobile-ar-poc/public/app-entry.mjs`, `handoff.mjs`, `app.mjs` | 정적 local-only 진입, QR v1 워셔액, 별도 local task 힌트. 워셔액의 중복 카메라 구현을 공통 InspectionCamera로 통합. 수동 셀프 점검 reducer와 schema v1은 그대로 |
| `camera.mjs`, `inspection-camera.mjs`, `marker.mjs`, `detector.mjs` | 후면 ideal 요청·late stream 정리·contain 좌표·수동 마커·워셔액 색상 후보. mute 종료, pending 단계 이탈, 숨김 상태 start 방지, 미준비/정지 영상 정리 보완. 색상 후보는 실물 식별이 아님 |
| `self-inspection.mjs`, `inspection-result.mjs` | 워셔액 intro/locate/check/result/confirm/done, 사용자 보고 OK/NEEDS_REFILL/UNSURE. 기존 모델을 유지하며 카메라로 결과를 결정하지 않음 |
| `checklist-flow.mjs`, `checklist-result.mjs`, `checklist-page.mjs`, `checklist-profiles.mjs` | 공통 safety → locate/check → review/done, 3상 응답, strict schema v2, observation stop. 신규 task도 이 코드 사용 |
| `tire-flow.mjs`, `tire-result.mjs`, `tire-page.mjs`, `charge-result.mjs`, `brake-result.mjs` | 네 타이어 exact ID, 충전구 주차/비충전 gate, 브레이크액 외관 질문, 기존 개별 validator·질문·집계 유지 |
| `inspection-tasks.mjs`, `inspection-ui.mjs`, `index.html`, `style.css` | 부품 목록·공통 summary. 위치 안내를 locate/check에도 표시. 타이어는 차량 기준 좌우/앞뒤를 강조하는 문자 배치도 제공. QR v2에서는 부품 전환 링크 없음 |
| 신규 `extra-tasks.mjs`, `extra-result.mjs`, `extra-profiles.mjs` | 10개 ID/질문/안전 범위, task별 strict validator와 공통 checklist profile. 새 schema version·수송 모델을 만들지 않음 |
| `public-modules.mjs`, `server.mjs`, `staging/build.mjs` | 동일 allowlist를 정적·HTTPS Sync 서버에 공유. 새 모듈만 allowlist에 추가. CSP·Permissions-Policy·no-store 유지 |
| `inspection-sync-poc/public/mobile-dev-entry.mjs`, `mobile-handoff.mjs`, `mobile-sync.mjs`, `sync-client.mjs` | QR v2 fragment 제거·explicit claim/send·영수증·수락 상태. 기존 구현 재사용, 인증·토큰·retry·polling 변경 없음 |
| `inspection-sync-poc/src/protocol.mjs`, `server.mjs`, `bin/receiver.mjs` | 신규 exact task와 validator dispatch, debug 의존 모듈 allowlist, 질문/응답 수신 표시만 추가. 세션 인증·role·digest·수락 정책 유지 |
| `tools/three-poc/test/mobile-result-design-contract.test.mjs` | 모바일 계약 회귀 테스트만 조정. 기존 7-task 3D 설계와 신규 10-task 모바일 확장의 합집합이 서버 allowlist와 정확히 일치하는지 검사. 3D ingress/모델/결과 적용은 추가하지 않음 |

architecture·roadmap·development-setup·validation-report·Pleos 연동·STALE 검토·Anatomy 통합·3D PoC 문서를 확인했다. `vehicle-core` 독립성, PLEOS 출처, 5000ms STALE, Anatomy 고정 SHA와 좌표 계약에는 변경이 없다.

## 부품별 안전한 관찰 범위

기존 7개는 워셔액, 네 타이어, `ev-charge.port`, `brake-fluid`다. 신규 10개의 정확한 key·enum·Native 인계 표는 [추가 task 계약](contracts/p7-b-mobile-tasks-v2.md)에 있다.

제조사 근거는 [2022 UK IONIQ 5 정비 설명서](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf)의 9-3, 9-5, 9-12, 9-16, 9-19, 9-30~32, 9-43이다. 모터룸 배치는 사양별로 다르며 실차 일치를 보장하지 않는다. 아래 외관 전용 범위는 해당 경고를 바탕으로 정한 서비스 설계 범위다. 사용설명서의 정비/교체 절차를 앱에서 실행하도록 옮기지 않는다.

| 신규 범위 | 사용자 보고 항목 | 제외한 작업 |
|---|---|---|
| 일반/LCW 냉각수, 각 1 task | 식은 저장통 외부 액면/표시, 젖음 흔적, 외관 | 캡 개방·직접 보충·액체 종류/전도도 판단 |
| 12V 보조 배터리 | 보이는 케이스 손상, 누액 의심, 부식 의심 | 전압/용량/수명 판단·단자 접촉/덮개 분리·충전/점프·청소 |
| 모터룸 퓨즈박스 | 닫힌 덮개 손상, 외부 오염/젖음, 변형/변색 | 내부 퓨즈 판별·덮개 개방·회로 진단·퓨즈 교환 |
| 좌/우 전면 와이퍼, 각 1 task | 보이는 고무 손상, 이물질, 암 외관 | 암 올림·손으로 이동·작동/닦임 성능 시험·분리 |
| 좌/우 상향/하향등, 각 1 task | 선택 영역 렌즈 손상, 가림, 보이는 물기 | 점등·밝기·광축/기능 판단·접촉·탈거·결로의 고장 판정 |

관찰이 어렵거나 부품/램프 영역을 구별할 수 없으면 UNABLE이다. 없는 LCW 사양도 다른 저장통으로 대체하지 않는다. 같은 모듈의 상향/하향등이라도 별도 점검 기록이며 답을 자동 공유하지 않는다. 이상 징후 또는 자발적 관찰 중단은 카메라를 끄고 기존 응답을 유지하며, 남은 항목은 사용자가 직접 선택한다. 손상 징후를 발견해도 고장·안전을 자동 판정하지 않는다.

## 카메라와 실패 대응

모든 task는 CameraSession·InspectionCamera·2D Overlay를 공유한다. 시작/중지는 사용자 동작이며 회전/resize/영상 크기 변경·질문 전환 때 수동 마커를 해제한다. 마커는 세계 좌표 anchor가 아니며, 이동 후 다시 지정해야 한다. 체크리스트 응답은 회전이나 카메라 실패 때문에 채워지거나 지워지지 않는다.

권한 거부/미지원은 이유를 보여 주고 수동 진행을 유지한다. 권한 pending 중 뒤로·취소·수동 전환·background 후 늦게 도착한 stream은 즉시 종료한다. 트랙 ended/mute, 영상 pause/stalled/error/ended, pagehide/hidden은 트랙·타이머·표시를 정리한다. 미준비 영상/갱신이 멈춘 영상은 최대 약 2초의 검사 대기 후 중지한다(브라우저 timer 지연 제외). foreground 복귀는 자동 시작하지 않는다.

[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)는 secure context와 권한을 요구하며 `ideal: environment`는 후면 렌즈 보장이 아니다. [track mute](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event)는 프레임 공급 중단이므로 이 구현은 보수적으로 종료하고 명시적 재시작을 요구한다. 실제 기기의 이벤트 순서·카메라 indicator 종료는 별도 검증 대상이다.

## 실제 객체 인식 검토

[MediaPipe Web Object Detector](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js)는 학습된 호환 모델을 필요로 한다. 브라우저에서 부품 후보 탐지는 기술적으로 검토 가능하지만, 현재 저장소에는 이 17개 부품을 검증할 모델·권한 있는 라벨 데이터셋·홀드아웃 평가 결과가 없다. 일반 객체 모델이나 참조 무늬 일치만으로 부품 의미/좌우/액체 종류를 식별했다고 주장할 수 없다.

최신 작업 지시대로 **새 인식 PoC/모델을 추가하지 않았다**. 초기 검토 중의 참조 무늬 실험은 최종 diff에 포함하지 않았다. 기존 워셔액 파란 영역 휴리스틱은 이전의 미검증 색상 후보로만 유지하고, 다른 부품으로 확대하지 않았다. 수동 AR가 기본이며 결과 확정·응답 입력에 detector 출력을 사용하지 않는다.

후속 인식 PoC의 진입 조건: 차량/연속 영상 단위 분리된 학습·평가 데이터, 실제 표기/설명서로 확인한 정답과 UNKNOWN, 차종/사양/좌우/광원/가림/블러 조건, 다른 저장통·일반 파란 물체 등 음성 예, 사전 고정 IoU 0.5 일대일 매칭 기준. 후보 precision/recall·FP/frame·미탐·기기 처리 지연과 의미 식별을 별도로 보고한다. 표본 부족은 DATA_INSUFFICIENT이며 외관/안전 판정으로 확장하지 않는다.

## 검증·재현

Windows, Node 22.16.0. 브라우저는 설치된 Edge/Chrome의 headless Playwright이며 synthetic canvas stream, 주입한 권한/이벤트와 loopback HTTP를 사용한다. 실제 폰·카메라·차량과 다르다. [스마트폰 HTTPS 절차](../tools/mobile-ar-poc/P7_B_DEVICE_TEST.md)를 별도로 따른다.

```powershell
Set-Location C:\dev\CarScope-p7-ar\tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check
npm test
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/NEW-P7B-RUN'
npm run test:browser

Set-Location C:\dev\CarScope-p7-ar\tools\inspection-sync-poc
npm run check
npm test
npm run test:sqlite
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/NEW-P7B-RUN/sync-mobile'
npm run test:mobile-browser

Set-Location C:\dev\CarScope-p7-ar
node --test tools/three-poc/test/*.test.mjs
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

| Gate | 이번 실행 결과 |
|---|---|
| Mobile syntax / Node | PASS, 80 tests (신규 10 task × 27 응답 조합 포함) |
| Sync syntax / Node | PASS, 127 pass / 4 skipped; `PG_TEST_URL` 없는 실제 Postgres 환경은 NOT_RUN |
| Existing washer/tire/charge/brake browser | PASS, 기존 네 suite 모두 재실행 |
| 17-task browser matrix | PASS: guide/marker/rotation/mute/background/manual/pending/denial ×17 + 영상 준비 실패 + QR v2→Node ACCEPTED ×17 |
| Sync browser / SQLite | PASS, 실제 모바일 DOM 19 그룹 + debug 11 그룹 / 별도 SQLite 21 tests |
| Three-poc contract regression | PASS, 81 Node tests; 형상 생성·변경 없음 |
| Core | PASS, 38 tests, `BUILD SUCCESSFUL` |
| Real phone / Native new tasks / recognition accuracy | NOT_RUN |
| CI | PR checks를 별도로 기록. 로컬 PASS와 혼동하지 않음 |

최종 결과와 외부 로그·캡처 위치는 [증거 인덱스](evidence/p7-b/README.md)에 기록한다. 앞선 새 browser harness 실행은 같은 URL 재방문이 페이지를 초기화하지 않아 FAIL했고, 새 문서 로드를 강제한 후 위 17-task matrix가 PASS했다. Sync 폴더에는 lockfile이 없어 `npm ci` 시도는 실패했다. 이 기존 모듈의 기본 Node/TLS 검사는 설치 없이 실행했고 PASS했다. 실패한 시도를 성공 증거로 사용하지 않는다.
