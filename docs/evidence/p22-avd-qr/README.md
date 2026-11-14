# P22 evidence index

Raw artifacts are outside Git at `C:\CarScope-External\p22-avd-qr\`. Nothing there contains a proof, hash, grant, token or DB URL; a pattern scan of the report found none.

| File | Content |
|---|---|
| `live/vision-healthz.txt` | Vision `/healthz` (200, UP, STATEFUL_AVD_SIMULATION, OPERATOR_APPROVED_AVD_ONLY) |
| `live/logcat-avdauth.txt` | `CarScopeAvdAuth` categories: two `PROVISION_HTTP_UNAUTHORIZED`, 30 s apart (read with `logcat -d`, not cleared) |
| `vision-qr-20261114T101705Z.json` | Real read-only diagnosis of `emulator-5554`: AVD, APK (Vision origin in dex), origin, server, enrollment PASS; DB and live tests NOT_RUN |
| `logs/gradle-app3.log` | `:app:testDebugUnitTest` 291/291 |
| `logs/sync-rerun.log`, `logs/sync.log` | inspection-sync suites (283 pass / 0 fail / 42 PostgreSQL skip; check, legacy, https-e2e) |
| `logs/three-poc.log`, `logs/three-poc-browser.log` | three-poc checks, unit and browser |
| `logs/gradle-core.log` | `:vehicle-core:test` |
