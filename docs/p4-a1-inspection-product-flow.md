# P4-A1 — 차량 점검 제품 흐름

2026-11-02. PR #40이 병합된 `origin/main` `ef2f83f4d607951e1af6d9091bb1f0bd7bbdf01e`에서 별도 Worktree `C:\dev\CarScope-p4a1-product`, branch `feat/p4-a1-inspection-product-flow`를 만들었다. 시작 clean. 기존 PR #41과 그 Worktree는 변경하지 않았고 AVD/adb/Runtime 조사·실행은 하지 않는다.

## 기존 구현 감사와 최소 변경

| 경로 / 표면 | 기존 구현 | 발견한 누락 / 이번 변경 |
|---|---|---|
| 차량 홈 → 점검 | `inspect.html` IDLE과 START, 기존 GLB·OrbitControls | 그대로 재사용. 메모리 보존 한계를 홈에서 안내하고 숨은 홈/패널을 inert로 전환 |
| 보닛 → 부품 상세 → QR | 취소/중복/늦은 animation 이벤트를 처리하는 상태 머신, 워셔액 안내/QR, 네 부품 preview | 워셔액 상세·여는 중에도 공통 종료/전체 요약 진입 제공. 닫는 중 활성처럼 보이던 부위 선택 목록을 진행 안내로 교체 |
| 네 타이어 | 기존 세 응답 + 명시 확정, 수정 시 재확정, 위치별 요약, camera/raycast/highlight | 기록 모델 변경 없음. 전체 점검 요약에서 재진입하고 다른 부위 탐색 후에도 같은 메모리 기록 유지 |
| 전체 결과 → 종료 | 타이어 전용 요약만 있음. 종료 버튼 유무/문구가 화면마다 다름 | `INSPECTION_SUMMARY`와 공통 세션 동작. 열려 있는 보닛을 닫은 뒤 요약, 기록을 지우는 종료 문구 통일 |
| Android 시스템 Back | 기본 Activity 종료로 웹의 한 단계 Back과 다름 | InspectionActivity가 고정 JS 명령으로 공유 Back 호출. 홈/준비되지 않은 페이지는 화면 종료, 닫힘 중 무시된 Back은 Activity 종료로 전파하지 않음 |
| Android 외부 링크 | private WebView 정책상 차단되지만 사용자 피드백 없음 | 차단 이유와 QR/실제 설명서 안내 표시. origin/CSP/탐색 정책 유지 |
| README / UX 문서 | Android 미통합, 워셔액 외 전부 선택 불가, 타이어 미기재 | 현재 Debug 통합/부품 preview/사용자 기록/전체 요약 및 실측 미검증을 분리해 갱신 |

기존 다크 토큰·버튼·목록·타이어 요약 카드를 재사용했다. 모델/좌표/카메라 기저/mesh 매핑·정비 절차·OEM 치수는 추가하거나 변경하지 않는다. 폼·세션 버튼은 같은 스크롤 흐름에 두며 별도 고정 footer가 입력을 가리지 않게 한다.

## 제품 경로와 데이터 의미

```text
3D 차량 홈 → 차량 점검 → 보닛 또는 네 타이어 선택
  보닛 → 부품 목록 → 워셔액 안내 → 선택적 QR → 안내/목록으로 복귀
  타이어 → 육안 응답 → 명시 확정 → 수정/재확정 → 타이어 요약
  어느 활성 단계에서든 전체 점검 요약 → 계속 점검 또는 종료·기록 지우기 → 홈
```

전체 요약의 타이어 카드는 기존 `USER_REPORTED` 세션만 소비한다. 워셔액은 **이 3D 화면의 결과 미수집**으로 표시한다. 안내를 읽거나 QR을 보여 준 사실을 점검 완료로 바꾸지 않는다. 모바일 워셔액 결과와 Native Sync Receiver 결과는 기존 별도 흐름이며 여기로 자동 병합하지 않는다. Sync 수락을 타이어 기록이나 실제 차량 정상 상태로 변환하지 않는다.

타이어의 Pleos 정보는 상세의 별도 접기 영역에서 기존 capability/availability/source/observedAt을 보여 준다. 사용자 확정 시각은 실제 SDK 관측 시각이 아니며, USER_REPORTED 기록은 PLEOS/MOCK 상태를 변경하지 않는다. 원시 압력/단위/정상·안전·주행 가능 판정은 추가하지 않는다. STALE5000ms·lease·Native cache endpoint는 그대로다.

`SHOW_SUMMARY`는 보닛이 열렸거나 열리는 중이면 `HOOD_CLOSING → INSPECTION_SUMMARY`를 사용한다. 늦은 OPENED/CLOSED와 중복 summary는 상태를 바꾸지 않는다. 명시적 EXIT가 이미 홈을 목표로 닫는 중이면 늦은 summary가 이를 되돌리지 않는다. 기존 EXIT API는 홈에서 세션을 새로 만드는 의미를 유지한다. 뒤로 가기로 홈에 들어가도 기존과 같이 기록을 지운다.

## 브라우저와 Android Debug 차이

| 기능 | 브라우저 | Android Debug / 이번 검증 경계 |
|---|---|---|
| 3D/점검/요약 | 같은 상태 머신·JS·GLB | Debug assets에 같은 모듈 byte로 포함. 실제 WebView 렌더는 별도 최종 통합 단계 |
| Back | 화면 버튼/Escape → BACK | 시스템 Back → 고정 `__androidShell.back()` → 같은 BACK. JS 미준비/홈이면 native finish. Robolectric + desktop shell simulation으로 검증 |
| 종료 | 3D 홈으로 복귀, 응답 삭제 | 점검 종료는 같은 홈. 별도 닫기는 GL dispose 후 기존 private `/close`로 Activity 종료 |
| SDK 상태 | 기본 미연동; 테스트 fixture는 합성 표시 | 기존 private HTTPS cache projection. 이번 단계에서 실제 SDK 관측 없음 |
| 외부 PDF/모바일 링크 | 브라우저가 별도 탭으로 열 수 있음 | 기존 차단 유지 + 안내 표시. QR 자체는 기존 설정 계약 |
| 워셔액 수신 | Native 수신 화면 없음 | 기존 sibling Native 버튼 → SyncReceiverActivity → Android Back. Sync/auth/모바일 코드 변경 없음 |
| Release | 해당 없음 | 기존 MainActivity 정적 SVG/JS 비활성. 3D/Native Debug 화면·권한·외부 GLB 미포함 경계 유지 |

일반 Android MainActivity를 3D 제품 홈으로 교체하거나 Release에 Debug 화면을 포함시키지 않았다. SDK/Receiver lifecycle 호출 순서는 변경하지 않았다. 보존된 Activity/WebView로 돌아오면 메모리가 남을 수 있지만 페이지 reload·Activity/process 재생성 복구는 보장하지 않는다.

## 로컬 저장·재진입 복구·삭제 설계 — 후속 과제

결정: **이번 구현은 기존 메모리 전용 정책 유지**. TTL·저장 동의·차량/사용자 경계가 확정되지 않았으므로 localStorage/IndexedDB/DB·SavedInstanceState에 기록을 쓰지 않는다. 현재 종료/홈/새로고침/페이지 파괴가 삭제 경계다. 동일 페이지 안의 부위 이동과 요약 왕복만 복구한다.

| 선택지 | 장점 | 미결 조건 / 결정 |
|---|---|---|
| 메모리 전용(현재) | 명시적 종료 삭제, 공유 기기에 잔존하지 않음, 기존 계약 유지 | reload/process 복구 불가. 이번 채택 |
| 사용자 동의 기반 local draft | 재진입 시 미완료 응답 복구 가능 | 보존 기간/TTL, 사용자·차량 식별 경계, 저장 위치/보호 방식, 공용 차량·기기 정책 미확정. 별도 승인 후 구현 |
| 서버/계정 기록 | 기기 간 기록 연속성 | 인증·권한·schema·동기화·삭제 계약이 필요하며 Codex B의 기존 Sync 결과와 별개. 이번 제외 |

후속 요구사항: 저장 opt-in과 저장 중인 상태를 명시하고, 복원은 사용자 확인을 거친다. version/session/user/vehicle 식별을 검증하며 다른 사용자·차량의 draft는 자동 적용하지 않는다. SDK 관측을 새 관측으로 갱신하거나 저장된 USER_REPORTED를 SDK로 승격하지 않는다. 저장된 확정 결과를 수정하면 다시 미확정으로 전환한다. 사용자가 언제든 draft 삭제 가능해야 하고 종료 시 삭제/보존 선택·자동 만료·백업 포함 삭제 범위를 먼저 결정한다. migration/손상/만료/기기 시간 변경·삭제 중 늦은 write·사용자 전환·재생성 복구를 별도 테스트한다. 서버의 Accept/Cancel/보존 정책을 무단 재사용하거나 바꾸지 않는다.

## 검증

Windows / Node22.16.0 / JDK17 / Gradle8.14 / SDK34. 원본은 저장소 밖 `C:\CarScope-External\p4-a1`의 `20261102-run01`(초기), `20261102-run02`(최종 프런트엔드), `20261102-isolated`(JVM 격리 진단), `20261102-final`(최종 기본 명령)로 구분한다. [증거 인덱스](evidence/p4-a1/README.md)만 공유하며 이전 PR #41 결과를 재사용하지 않는다.

| 검사 | 결과 | 새 실행 근거 |
|---|---|---|
| Node 단위/계약/상태 머신 | PASS | `npm test --prefix tools/three-poc`: 39/39. 기존34 + 전체 요약/닫힘 race/재진입/공통 종료/Android Back 의미5 |
| Android 자산 계약 | PASS | `npm run test:android-assets --prefix tools/three-poc`: 1/1, 새 모듈 source byte·상대 import·CSP·GLB 미포함 |
| 새 제품 Chrome E2E | PASS | `check-inspection-product.mjs`: 1600×1000 / 420×860 각각17 assertions. 실제 GLB, 요약·확정/수정/재확정·타 부위 왕복·종료/초기화, Android shell JS Back/링크 안내는 desktop simulation |
| 기존 Chrome 회귀 | PASS | 타이어 checklist34/34, Raycast/highlight39/36, 네 부품34/34, 보닛/워셔액/QR17. 전체9개 실행262 assertions, 모두 console clean. Desktop G1에는 선택 중 실제 child viewport resize 포함 |
| 실제 렌더 QA | PASS | Desktop/narrow 요약·워셔액 링크/세션 버튼 캡처 직접 검토. 44px 대상과 수평 overflow 확인 |
| Core JVM | PASS | `-PcoreOnly=true :vehicle-core:test --rerun-tasks`: 38 total, 37 pass / 기존 `IONIQ5_PARTS` optional1 skip, fail/error0 |
| Android JVM/Robolectric | PASS | 최종 기본 `:app:testDebugUnitTest --rerun-tasks`: **118/118**, fail/error/skip0. 새 Navigation4 + 기존114. Activity create만 사용하고 SDK lease resume 없음 |
| Debug/Release APK, Release AAB, lint | PASS | 최종 기본 빌드106 tasks 실행, 2m32s. lint 오류0/경고23, 기존 Gradle deprecation 안내 별도 |
| Identity/Tire/Receiver 격리 | PASS | 기존 build-contract3개, 새 test class가 모든 APK/AAB에서 제외됨. SDK→JS 합성 serializer 계약 및 readiness Python7도 PASS |
| APK 자산/서명 | PASS | inspection 전체 생성 파일이 Debug APK와 동일, GLB 미포함, APK v2 signature 검증 |
| 기존 IONIQ5/형상 회귀 | PASS | `node --test tools/ioniq5-asset/test/*.test.mjs`: 57 pass / 기존 `IONIQ5_BLEND` optional1 skip. Anatomy pin clean 유지, 형상 생성기/자산 변경 없음 |
| 변경 경계 | PASS | Sync 서버/모바일/인증·SDK transport·MainActivity·vehicle-core·Geometry diff0, PR #41 Worktree clean/HEAD 유지, `git diff --check` |
| CI | PR Checks에서 별도 확인 | 로컬 PASS를 CI 성공으로 대신하지 않는다. 게시한 최종 HEAD의 결과와 URL은 PR 본문/Checks에 기록 |
| AVD / adb / 실제 SDK | NOT_RUN | 사용자 지시로 호출·기동·조사도 하지 않음 |

새 Native4 검사는 고정 Back JS 방출/처리된 응답, JS 미준비 시 종료 fallback, finish 이후 늦은 응답, pause 뒤 늦은 unhandled 응답의 세대 차단이다. Back callback을 pause/destroy에서 무효화해 Receiver 뒤의 부모 Activity를 늦은 응답이 닫지 않게 한다. 실제 Receiver·SDK 구현과 lifecycle 호출 순서는 유지했다.

### 실패 이력과 JVM 실행 격리

초기 desktop 제품 E2E는 여러 줄 inline 링크의 click 영역에서 피드백 assertion이 실패했다. 링크를 inline-block/min-height44px로 명확히 만들고 최종 두 viewport에서 실제 클릭과 안내 표시를 통과했다. 초기 capture/log와 최종 run02를 구분한다.

초기 공유 JVM worker 전체 실행은 두 번 모두 기존 HTTPS fixture7개에서 NETWORK/EOF 실패(당시117 total)가 있었고, 해당 클래스 단독 실행10개는 PASS했다. 정확한 공유 상태의 내부 원인은 미확정이다. Sync 코드·인증서·hostname·timeout·assertion을 바꾸지 않고, 먼저 외부 init script로 클래스별 JVM 분리를 검증해 전체118 PASS를 얻었다. 이어 `app/build.gradle.kts`의 **테스트 실행 설정에만** `unitTests.all { it.forkEvery = 1 }`을 명시하고 **외부 init script 없는 기본 명령으로 전체118 및 빌드/격리를 다시 통과**했다. 테스트 제외·skip 추가·TLS 완화는 없고 클래스 내부의 요청/취소 race 검사는 그대로다. 이는 테스트 프로세스 격리이며 제품 네트워크 오류를 해결했다고 주장하지 않는다.

초기 빌드가 테스트에서 중단돼 Release manifest가 없던 때의 격리 도구 실패도 원본에 남겼다. 최종 빌드 산출물에 대한 재검사는 전부 PASS다. 초기 로컬 실행 보조 스크립트의 cp949 출력 오류도 제품 오류와 구분하며 최종 로그 수집에서 처리했다.

### 최종 산출물과 재실행

| 산출물 | bytes | SHA256 |
|---|---:|---|
| Debug APK | 11,216,520 | `5473b015fefb9bdbac046b4400c238ce578ff6be3357c0b63559e89e12c2ad11` |
| Release unsigned APK | 7,950,970 | `77ec8fa6b11e365ebc9ed85d68cd97751a4eb674bf86d79896b8d1f21a57e10d` |
| Release AAB | 2,761,821 | `840ade102c917d63076be12fca43d9a3cb40e1bd1dbdede5bb9667e9d7efb650` |
| 기존 외부 GLB | 1,902,820 | `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` |

Release APK/AAB는 기존 산출물 hash와 같고 외부 GLB도 그대로다. 원본 GLB/모델 파일은 읽기만 했다.

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/anatomy-car
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
python tools/inspection-sync-poc/android/check-boundary.py
node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json
$env:IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
node --test tools/ioniq5-asset/test/*.test.mjs
```

Chrome은 기존 `serve.mjs`에 `CARSCOPE_IONIQ5_GLB`와 QR 테스트 origin `https://inspection.example.test/`를 지정하고, 실행별 새 외부 output와 `?capture=1` URL 및 width/height를 각 `check-*.mjs`에 전달한다. 새 검사 후반의 shell import는 local Kotlin serializer의 **합성 MOCK JSON**을 `CARSCOPE_TIRE_UI_FIXTURE`로 제공했다. 이는 Native endpoint/SDK 응답이 아니고 Android 자산에는 포함하지 않는다. localhost 서버는 본 실행이 만든 프로세스만 종료했다.

## 남은 실제 Android 실측

AVD·adb 명령은 사용자 지시로 **NOT_RUN**이다. WebView/WebGL 렌더·실제 터치/Back·home 복귀, Native Receiver 왕복 후 메모리/lease 복원, Activity 재생성·process death, 실제 SDK callback/STALE/원격 정리, 성능·장시간 안정성은 환경 안정화 후 최종 통합 단계에서 검증한다. desktop Chrome/합성 JS/Robolectric/빌드/CI 성공으로 이 항목을 완료 처리하지 않는다. PR #41의 Runtime/부하/SystemUI 조사 범위를 재개하거나 이 브랜치에 포함하지 않는다.
