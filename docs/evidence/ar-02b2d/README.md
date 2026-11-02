# AR-02B-2D 검증 증거 인덱스

2026-11-02 KST. Windows, Node 22.16.0, OpenSSL (기존 Git 배포), Edge 156.0.4314.58. 기준 main `7a4c77a`. 원본 로그·캡처·SQLite·인증서·키는 Git 밖에 둔다. fixture 키는 OS temp이며 개발 기기 CA 저장소를 바꾸지 않는다.

| 검사/명령 | fresh 결과 | 범위/증거 |
| --- | --- | --- |
| `npm run verify:local`: check | PASS | 외부 `node/summary.json`, `node/check.txt` |
| legacy Node | PASS 48/48 | `node/test-legacy.txt` |
| 전체 Node (추가 HTTPS/preflight/Receipt 포함) | PASS 73/73 | `node/test.txt`, 실패/skip 0 |
| SQLite race/service | PASS 21/21 | `node/test-sqlite.txt`; 전체 suite의 durable 독립 프로세스·재시작 포함 |
| 기존 AR-01 명시적 test clock harness | PASS 31/31 | `node/test-ar01.txt`; 원본 테스트 수정 없음 |
| `npm run test:https-e2e` | PASS 3/3 | 실제 TLS loopback, 생성 credential, QR/Claim/Submit/Receipt/View/Accept/ACCEPTED/Cancel/Expire; host preflight 양성/거부. Node 범위 |
| 기존 Sync `npm run test:browser` | PASS 11 checks | `sync-browser/summary.json` 및 선별 캡처 |
| 통합 `npm run test:mobile-browser` | PASS 19 checks | `mobile-browser/mobile-summary.json`; SQLite 재시작, 응답 유실, 실제 fetch redirect 차단, 상태/Receipt 불일치 거부 |
| AR-01 `npm run test:browser` | PASS 16 checks | 별도 qr-ar-01 외부 경로의 `browser-results.json`; 합성 카메라, 오류 0 |
| `python tools/inspection-sync-poc/android/test-device-readiness.py` | PASS 7/7 | adb mock 단위 검사. AVD 접속 없음 |
| 로컬 Gradle/core/JVM/Robolectric/APK boundary | NOT_RUN | Codex A의 기기/부하 분리. 과거 #37/#38 결과를 fresh PASS로 재사용하지 않음 |
| PR CI JVM 실제 handshake/Decoder/Digest/QR/lifecycle/Release | PENDING | PR 생성 후 job별 결과를 아래 기록 |
| 실제 서비스 host probe | NOT_RUN | 승인된 endpoint 없음. 테스트 서버 응답 검증만 PASS |
| Android HTTPS / 폰 HTTPS / 광학 QR / 두 기기 수락 | BLOCKED | 공급자·verifier·서비스·각 기기 trust/path 및 대상 사용 시간 미확보 |
| 실제 차량 인증 | BLOCKED | ProductionSessionCreationAuthorizer와 DenyByDefault 유지 |

원본 위치:

- `C:/CarScope-External/ar-02b2d/2026-11-02/node/`
- `C:/CarScope-External/ar-02b2d/2026-11-02/sync-browser/`
- `C:/CarScope-External/ar-02b2d/2026-11-02/mobile-browser/`
- `C:/CarScope-External/qr-ar-01/ar-02b2d-2026-11-02/` (AR-01 도구가 요구하는 prefix)

실패/보정 이력: 최초 verify:local은 sandbox의 외부 폴더 mkdir EPERM으로 미실행, 승인된 외부 증거 쓰기 권한으로 동일 명령 재실행해 위 suite 통과. AR-01 첫 browser 명령은 B 외부 경로가 도구의 고정 `qr-ar-01/` prefix와 달라 사전 검사 실패. 요구 prefix 아래 B 전용 경로로 수정 후 16 checks 통과. 두 경우 테스트 기준·TLS·인증 경계 완화 없음. 이번 로컬 Node TLS 실패 재발 없음. 이전 JVM TLS 간헐 실패의 원인을 이번 실행으로 해결했다고 주장하지 않는다.

자동 PR 병합 없음. READY_TO_MERGE는 준비 도구 PR의 CI와 리뷰 범위이며 두 기기/Production readiness와 별개다.
