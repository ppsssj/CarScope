# AR-02B-2E 검증 증거 인덱스

2026-11-02 KST. Windows, Node 22.16.0, 기존 OpenSSL, Edge 156.0.4314.58. 기준 main `ef2f83f`. 신규 B worktree에서 실행하며 PR #41과 A의 3D/Inspection UI는 변경하지 않는다. 원본 로그/캡처는 Git 밖에 보관한다. 인증서·키·DB는 test-owned OS temp에서 정리한다.

| 검사 | 결과 | 명령/범위/외부 증거 |
| --- | --- | --- |
| Sync check/legacy | PASS, legacy 48/48 | Sync 디렉터리 `npm run verify:local`, `node-final/check.txt`, `test-legacy.txt` |
| 전체 Node | PASS 83/83, failure/skip 0 | `node-final/test.txt`: 기존 suite + auth 6/service HTTPS 4 |
| SQLite race/service | PASS 21/21 | `node-final/test-sqlite.txt`; 전체 suite의 독립 프로세스/재시작 유지 |
| 기존 AR-01 clock harness | PASS 31/31 | `node-final/test-ar01.txt`; 원본 AR-01 수정 없음 |
| 집중 auth/service TLS | PASS 10/10 | `npm run test:service-tls`: 검증 assertion/등록/폐기, 같은 HTTPS origin에서 QR→Claim→Submit/ACK 유실/동일 재시도→SQLite 재시작/중복 Receipt→View→Accept→ACCEPTED, Cancel/Expire, body 대기 중 revoke |
| 기존 Node HTTPS/preflight/negative TLS | PASS | 전체 suite에 포함. CA 불신/SAN 불일치/expired 인증서 거부 유지. 서비스 시작 전 SAN/유효기간 검사 추가 |
| 통합 mobile browser | PASS 19 checks | `npm run test:mobile-browser`, `mobile-browser/mobile-summary.json`. HTTP loopback DOM + SQLite. 실제 브라우저 TLS 신뢰로 승격하지 않음 |
| 기존 Sync browser | PASS 11 checks | `npm run test:browser`, `sync-browser/summary.json` |
| 기존 AR-01 browser | PASS 16 checks, page errors 0 | AR-01 `npm run test:browser`, 별도 qr-ar-01 경로의 `browser-results.json`, 합성 카메라 |
| readiness offline | PASS 7/7 | `python tools/inspection-sync-poc/android/test-device-readiness.py`, adb mock 검사. 실제 adb 실행 없음 |
| Android provider + 기존 JVM/Decoder/HTTPS/Robolectric/Debug/Release | CI PASS (구현 SHA 21d3236) | 새 provider 7 + 기존 Sync 46 = 53개, failure/error/skip 0. Debug/Release APK, Release AAB, lintDebug, manifest/DEX 격리 통과. 로컬 무거운 Gradle 병렬 실행 없음 |
| 실제 기기 네트워크/TLS/광학 QR/차량 인증 | NOT_RUN | AVD/adb/폰 실행 및 외부 배포 없음 |

원본 위치:

- `C:/CarScope-External/ar-02b2e/2026-11-02/node/` (초기 전체 실행)
- `C:/CarScope-External/ar-02b2e/2026-11-02/node-final/` (최종 전체 재실행)
- `C:/CarScope-External/ar-02b2e/2026-11-02/mobile-browser/`
- `C:/CarScope-External/ar-02b2e/2026-11-02/sync-browser/`
- `C:/CarScope-External/qr-ar-01/ar-02b2e-2026-11-02/`

실패/수정 기록: service TLS 첫 실행 9/10. 잘못된 Host를 주었을 때 HTTP 403을 기대했으나 Node 기본 HTTPS 검증이 `ERR_TLS_CERT_ALTNAME_INVALID`로 먼저 차단했다. 테스트에서 그 TLS 거부를 명시적으로 검증하고, HTTP Host 거부 검사는 인증서 SAN에 실제 있는 localhost(설정 origin과는 다름)로 분리했다. 인증서·hostname 검증을 바꾸지 않았다. 이후 집중 suite 통과. 정상/불신 CA/hostname/expired 검사를 제거하거나 완화하지 않았다.

PKI 정리: Node 생성 실패를 별도 child process/통제한 temp parent에서 주입해 잔여 디렉터리 0 확인. 정상 key/cert 삭제와 cleanup idempotence 확인. JVM은 생성 실패/AfterClass cleanup 추가, CI로 확인한다. 타 작업의 temp나 기존 증거를 전역 삭제하지 않는다. crash/강제 종료 후 잔여 정리와 물리 삭제 보장은 별도 한계다.

실제 서비스 연결은 발급/등록/폐기 adapter와 Android provisioning, 승인된 DNS/TLS/배포·운영 구성이 남는다. 테스트 fixture ID나 credential을 실제 차량 인증으로 취급하지 않는다. 기본 거부 유지, 자동 병합 없음.

## PR CI 근거

[PR #42](https://github.com/ppsssj/CarScope/pull/42), 구현 SHA `21d3236d7b69cd3f5591edd31a43042087253c2e`의 fresh 7 checks 전부 SUCCESS. 이후 문서·주석만 보정한 최종 HEAD의 rollup은 PR에서 별도로 확인한다.

| 실행 | 결과/범위 |
| --- | --- |
| [Sync Linux/Windows](https://github.com/ppsssj/CarScope/actions/runs/41410818303) | 두 job SUCCESS. Node/SQLite/auth/TLS, Windows의 기존 Sync/AR-01/통합 모바일 browser. Linux는 Windows 전용 browser steps SKIPPED |
| [Android JVM·빌드·경계](https://github.com/ppsssj/CarScope/actions/runs/41410818328) | SUCCESS. provider 7, Decoder 8, 실제 HTTPS 10, Receiver 17, Robolectric lifecycle/QR 8, entry 3. app 전체 failure/error/skip 0 assertion 통과. Debug/Release APK·Release AAB·lint 및 Sync/Identity/Tire 경계 PASS. lint 성공을 경고 0으로 해석하지 않음 |
| [Core JVM](https://github.com/ppsssj/CarScope/actions/runs/41410818424) | SUCCESS 38개, failure/error 0, 기존 skip 1 |
| [Geometry](https://github.com/ppsssj/CarScope/actions/runs/41410818315) | SUCCESS. 기존 CI 범위이며 B의 형상 변경/기기 렌더링 검증이 아님 |
| [Tire offline](https://github.com/ppsssj/CarScope/actions/runs/41410818345) | SUCCESS, 기존 guard 검사. AVD 사용 없음 |
| GitGuardian | SUCCESS |

이번 CI에서 JVM TLS fixture 간헐 실패 재발 없음. 새 AfterClass PKI cleanup까지 통과했다. 과거 원인 미확정 TLS 실패를 이번 변경이 해결했다고 주장하지 않는다.
