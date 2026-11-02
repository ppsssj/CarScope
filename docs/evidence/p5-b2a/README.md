# P5-B2A evidence index

Only this index is committed. Raw test XML, reports, TLS keys/certificates, APKs, tokens and personal paths are
not evidence to commit. Local raw build reports remain in ignored `app/build/`; fixture PKI is generated in
the temporary directory by the existing test and removed in its `AfterClass` cleanup.

## Fresh local execution

- `node tools/native-tire-sync/vectors.mjs`: PASS, 109 synthetic JS vectors generated and validated.
- First Gradle invocation: FAIL before tests, PowerShell split an unquoted dotted `-P` argument; quoted in the
  documented command. No test threshold or TLS setting was changed.
- Initial `:app:testDebugUnitTest --tests 'io.carscope.app.sync.*'`: 60 tests, 59 PASS / 1 FAIL.
  `InspectionSyncEntryTest` could not open generated Debug inspection assets in the new worktree.
  The existing CI generates those assets before its full run. This local failure is not a device or TLS failure.
- Focused Native run: PASS, 58 tests / 0 failures / 0 errors / 0 skipped. Suites:
  original receiver 17; decoder 8; real TLS transport 11; Activity/Robolectric 9;
  provisioned credentials 7; new tire integration 6 (including 109 JS/Kotlin vectors).
  A further assertion that default denial covers every tire task is included in the CI run below.
- Existing Android CI (all tests, builds, lint, DEX/manifest boundaries): PENDING PR run.

AVD / adb / real phone / optical QR / real vehicle authentication: NOT_RUN.
No existing processes or other worktrees were manipulated. No mobile/server/Three.js source changes.
