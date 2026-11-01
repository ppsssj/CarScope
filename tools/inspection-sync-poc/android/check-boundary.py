"""Inspect built artifacts; debug-only receiver classes must never enter release APK/AAB."""
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[3]
NS = "{http://schemas.android.com/apk/res/android}"
for variant in ("debug", "release"):
    manifest = ROOT / f"app/build/intermediates/merged_manifest/{variant}/process{variant.title()}MainManifest/AndroidManifest.xml"
    tree = ET.parse(manifest).getroot()
    assert "android.permission.INTERNET" not in {n.get(NS + "name") for n in tree.iter("uses-permission")}
    assert tree.find("application").get(NS + "usesCleartextTraffic") == "false"

artifacts = [
    (ROOT / "app/build/outputs/apk/debug/app-debug.apk", True),
    (ROOT / "app/build/outputs/apk/release/app-release-unsigned.apk", False),
    (ROOT / "app/build/outputs/bundle/release/app-release.aab", False),
]
for artifact, debug in artifacts:
    with zipfile.ZipFile(artifact) as archive:
        dex = b"".join(archive.read(n) for n in archive.namelist() if n.endswith(".dex"))
        assert (b"Lio/carscope/app/sync/SyncReceiverController;" in dex) == debug, artifact.name
        if not debug:
            assert b"Lio/carscope/app/sync/" not in dex, artifact.name

report = ROOT / "app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.SyncReceiverTest.xml"
suite = ET.parse(report).getroot()
assert int(suite.get("tests")) >= 15
assert all(int(suite.get(key, "0")) == 0 for key in ("failures", "errors", "skipped"))
print(f"PASS: receiver Debug-only DEX; release APK/AAB clean; no INTERNET/cleartext; {suite.get('tests')} Fake transport tests")
