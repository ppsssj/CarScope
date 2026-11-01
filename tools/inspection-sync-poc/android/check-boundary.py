"""Inspect built artifacts; debug-only receiver classes must never enter release APK/AAB."""
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
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
        assert (b"Lio/carscope/app/sync/SyncReceiverController;" in dex) == debug, artifact.name
        for marker in (b"Lio/carscope/app/sync/InspectionSyncEntry;", b"Lio/carscope/app/sync/SyncReceiverActivity;", b"Lio/carscope/app/sync/HttpsSyncReceiverTransport;", b"Lio/carscope/app/sync/SyncHttpDecoder;", b"Lcom/google/zxing/qrcode/QRCodeWriter;"):
            assert (marker in dex) == debug, (artifact.name, marker)
        assert b"Lio/carscope/app/sync/ExplicitDebugTestCredentialProvider;" not in dex, artifact.name
        assert b"Lio/carscope/app/sync/ReceiverFixtureActivity;" not in dex, artifact.name
        assert b"Lio/carscope/app/sync/EntryHostActivity;" not in dex, artifact.name
        if not debug:
            assert b"Lio/carscope/app/sync/" not in dex, artifact.name

report = ROOT / "app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.SyncReceiverTest.xml"
suite = ET.parse(report).getroot()
assert int(suite.get("tests")) >= 15
assert int(suite.get("tests")) >= 17
assert all(int(suite.get(key, "0")) == 0 for key in ("failures", "errors", "skipped"))
for name, minimum in (("SyncHttpDecoderTest", 8), ("HttpsSyncReceiverTransportTest", 10), ("SyncReceiverActivityTest", 8), ("InspectionSyncEntryTest", 3)):
    report = ROOT / f"app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.{name}.xml"
    current = ET.parse(report).getroot()
    assert int(current.get("tests")) >= minimum, name
    assert all(int(current.get(key, "0")) == 0 for key in ("failures", "errors", "skipped")), name
    print(f"PASS: {name}: {current.get('tests')} tests (JVM/Robolectric scope, no AVD claim)")
print(f"PASS: receiver/HTTPS/decoder/QR Debug-only DEX; release APK/AAB clean; INTERNET debug-only, cleartext denied; {suite.get('tests')} original Fake tests")
subprocess.run([sys.executable, str(Path(__file__).with_name('test-device-readiness.py'))], check=True)
