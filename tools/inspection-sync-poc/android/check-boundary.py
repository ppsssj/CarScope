"""Inspect built artifacts; debug-only receiver classes must never enter release APK/AAB.

The Release submission (docs/release-submission.md) shares only the pure inspection bridge and result contract
(src/inspection/java/io/carscope/app/sync). Network transport, provisioning, enrollment, credentials, the AVD simulator,
the receiver screen and QR rendering stay in src/debug and must not appear in Release DEX; INTERNET stays debug-only.
"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
DECLARATION = re.compile(r"^(?:internal |private |public )?(?:data |sealed |enum |abstract |open |fun )*(?:class|object|interface) ([A-Z]\w*)", re.M)
def declared(directory):
    """Top-level declarations plus each file's facade class (<File>Kt) for top-level functions and values."""
    paths = list((ROOT / directory).glob("*.kt"))
    return {name for path in paths for name in DECLARATION.findall(path.read_text(encoding="utf-8"))} | {p.stem + "Kt" for p in paths}
SHARED = declared("app/src/inspection/java/io/carscope/app/sync")
DEBUG_ONLY = declared("app/src/debug/java/io/carscope/app/sync")
assert {"NativeInspectionBridge", "SyncHttpDecoder", "SyncReceiverState"} <= SHARED, SHARED
assert {"SyncReceiverActivity", "HttpsSyncReceiverTransport", "AvdSimulatorPolicy", "SyncReceiverController"} <= DEBUG_ONLY, DEBUG_ONLY
assert not SHARED & DEBUG_ONLY, SHARED & DEBUG_ONLY
NS = "{http://schemas.android.com/apk/res/android}"
for variant in ("debug", "release"):
    manifest = ROOT / f"app/build/intermediates/merged_manifest/{variant}/process{variant.title()}MainManifest/AndroidManifest.xml"
    tree = ET.parse(manifest).getroot()
    assert ("android.permission.INTERNET" in {n.get(NS + "name") for n in tree.iter("uses-permission")}) == (variant == "debug")
    assert tree.find("application").get(NS + "usesCleartextTraffic") == "false"
    activities = {n.get(NS + "name") for n in tree.iter("activity")}
    assert ("io.carscope.app.sync.SyncReceiverActivity" in activities) == (variant == "debug")

artifacts = [
    (ROOT / "app/build/outputs/apk/debug/app-debug.apk", True),
    (ROOT / "app/build/outputs/apk/release/app-release-unsigned.apk", False),
    (ROOT / "app/build/outputs/bundle/release/app-release.aab", False),
]
for artifact, debug in artifacts:
    with zipfile.ZipFile(artifact) as archive:
        dex = b"".join(archive.read(n) for n in archive.namelist() if n.endswith(".dex"))
        resources = b"".join(archive.read(n) for n in archive.namelist() if n.endswith(("resources.arsc", "resources.pb")))
        assert (b"inspection_sync_entry_tasks" in resources) == debug, artifact.name
        assert (b"Lio/carscope/app/sync/SyncReceiverController;" in dex) == debug, artifact.name
        for name in ("SyncChecklistTasks", "CompletedChecklistInspection", "SyncChecklistProfile", "NativeInspectionBridge", "SyncHttpDecoder"):
            assert f"Lio/carscope/app/sync/{name};".encode() in dex, (artifact.name, name)
        for name in ("BrakeSyncReceiverTest", "NativeTaskCoverageTest", "NativeTaskSamples"):
            assert f"Lio/carscope/app/sync/{name};".encode() not in dex, artifact.name
        for marker in (b"Lio/carscope/app/sync/InspectionSyncEntry;", b"Lio/carscope/app/sync/SyncReceiverActivity;", b"Lio/carscope/app/sync/HttpsSyncReceiverTransport;", b"Lcom/google/zxing/qrcode/QRCodeWriter;"):
            assert (marker in dex) == debug, (artifact.name, marker)
        assert b"Lio/carscope/app/sync/ExplicitDebugTestCredentialProvider;" not in dex, artifact.name
        assert b"Lio/carscope/app/sync/ProvisionedSessionCredentialProviderTest;" not in dex, artifact.name
        assert (b"Lio/carscope/app/sync/ProvisionedSessionCreationCredentialProvider;" in dex) == debug, artifact.name
        assert b"Lio/carscope/app/sync/ReceiverFixtureActivity;" not in dex, artifact.name
        assert b"Lio/carscope/app/sync/EntryHostActivity;" not in dex, artifact.name
        for name in ("HttpsProvisioningExchange", "RefreshingProvisionedCredentialSource", "ProvisioningDecoder", "EnrollmentCredential",
                     "AvdSimulatorPolicy", "AvdSimulatorEnrollment", "AvdSimulatorGrant",
                     "HttpsAvdSimulatorGrantExchange", "RefreshingAvdSimulatorCredentialSource"):
            assert (f"Lio/carscope/app/sync/{name};".encode() in dex) == debug, (artifact.name, name)
        for name in ("ProvisioningLifecycleTest", "HttpsProvisioningIntegrationTest", "ProvisioningFixtureActivity", "PendingProvisioningExchange",
                     "AvdSimulatorProvisioningTest", "AvdSimulatorActivityTest", "AvdSimulatorFixtureActivity", "PendingAvdSimulatorExchange",
                     "HttpsAvdSimulatorGrantExchangeTest"):
            assert f"Lio/carscope/app/sync/{name};".encode() not in dex, (artifact.name, name)
        assert b"SYNC_ENROLLMENT_FIXTURE" not in dex, artifact.name
        assert not any("native-auth-sync" in n or "authority-fixture.mjs" in n for n in archive.namelist()), artifact.name
        if not debug:
            # Every sync class in Release is declared in the shared source set; no Debug-only declaration leaks in.
            present = {m.decode() for m in re.findall(rb"Lio/carscope/app/sync/([A-Za-z0-9_]+)[;$]", dex)}
            assert present and present <= SHARED, (artifact.name, sorted(present - SHARED))
            for name in DEBUG_ONLY:
                assert f"Lio/carscope/app/sync/{name};".encode() not in dex, (artifact.name, name)
            for text in (b"sync-endpoint.json", b"avd-simulator-enrollment.json", b"avd-vision-enrollment.json", b"/simulator/provision"):
                assert text not in dex, (artifact.name, text)

report = ROOT / "app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.SyncReceiverTest.xml"
suite = ET.parse(report).getroot()
assert int(suite.get("tests")) >= 15
assert int(suite.get("tests")) >= 17
assert all(int(suite.get(key, "0")) == 0 for key in ("failures", "errors", "skipped"))
for name, minimum in (("SyncHttpDecoderTest", 8), ("NativeTaskCoverageTest", 6), ("BrakeSyncReceiverTest", 3), ("HttpsSyncReceiverTransportTest", 10), ("SyncReceiverActivityTest", 8), ("InspectionSyncEntryTest", 3), ("ProvisionedSessionCredentialProviderTest", 7), ("ProvisioningLifecycleTest", 4), ("ProvisioningActivityTest", 2), ("HttpsProvisioningIntegrationTest", 2),
                      ("AvdSimulatorProvisioningTest", 5), ("AvdSimulatorActivityTest", 2), ("HttpsAvdSimulatorGrantExchangeTest", 3)):
    report = ROOT / f"app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.{name}.xml"
    current = ET.parse(report).getroot()
    assert int(current.get("tests")) >= minimum, name
    assert all(int(current.get(key, "0")) == 0 for key in ("failures", "errors", "skipped")), name
    print(f"PASS: {name}: {current.get('tests')} tests (JVM/Robolectric scope, no AVD claim)")
print(f"PASS: receiver/HTTPS/provisioning/QR Debug-only DEX; release APK/AAB carry only the shared bridge/contract; INTERNET debug-only, cleartext denied; {suite.get('tests')} original Fake tests")
subprocess.run([sys.executable, str(Path(__file__).with_name('test-device-readiness.py'))], check=True)
