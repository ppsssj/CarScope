"""Debug probe build boundary and on-device read-only smoke tests (Python stdlib)."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ANDROID = "{http://schemas.android.com/apk/res/android}"
PROPERTIES = {"INFO_MAKE", "INFO_MODEL", "INFO_MODEL_TRIM", "INFO_MODEL_YEAR", "INFO_EXTERIOR_DIMENSIONS"}


def check_report(report):
    assert set(report) == {"schemaVersion", "environment", "aaosConnection", "connectionErrorType", "identities", "availability"}
    assert report["schemaVersion"] == 1
    assert report["environment"]["pleosVehicleSdk"] == "2.3.2"
    assert set(report["environment"]) == {"androidApi", "androidRelease", "osBuild", "deviceProduct", "pleosVehicleSdk", "aaosCompileApi"}
    assert len(report["availability"]) == 10
    assert len(report["identities"]) == 2
    for source in ("aaos", "pleos-sdk"):
        rows = [r for r in report["availability"] if r["source"] == source]
        assert len(rows) == 5 and {r["property"] for r in rows} == PROPERTIES
        for row in rows:
            assert set(row) == {"source", "property", "support", "permission", "status", "value", "errorType", "configExposed"}
            assert row["permission"] in {"GRANTED", "DENIED"}
            assert row["support"] in {"SUPPORTED", "UNSUPPORTED", "UNKNOWN"}
            assert row["configExposed"] in (None, True, False)
            if row["status"] not in {"AVAILABLE", "EMPTY"}:
                assert row["value"] is None
        identity, = [i for i in report["identities"] if i["source"] == source]
        assert set(identity) == {"source", "make", "model", "trim", "modelYear", "dimensionsMm", "identityStatus", "oemVisualMatch"}
        assert identity["identityStatus"] in {"PARTIAL", "UNAVAILABLE"}
        assert identity["oemVisualMatch"] == "UNVERIFIED"
        for field, prop in (("make", "INFO_MAKE"), ("model", "INFO_MODEL"), ("trim", "INFO_MODEL_TRIM")):
            if identity[field] is not None:
                row, = [r for r in rows if r["property"] == prop]
                assert row["status"] == "AVAILABLE" and identity[field] == row["value"].strip()
        if source == "pleos-sdk":
            assert all(r["status"] == "NOT_EXPOSED_BY_SDK_2_3_2" for r in rows)
            assert identity["identityStatus"] == "UNAVAILABLE"


def build_contract():
    manifests = {}
    for variant in ("debug", "release"):
        manifests[variant] = ET.parse(ROOT / f"app/build/intermediates/merged_manifest/{variant}/process{variant.title()}MainManifest/AndroidManifest.xml").getroot()
    def names(root, tag):
        return {n.get(ANDROID + "name") for n in root.iter(tag)}
    permission = "android.car.permission.CAR_INFO"
    activity = "io.carscope.app.identity.VehicleIdentityActivity"
    assert permission in names(manifests["debug"], "uses-permission")
    assert permission not in names(manifests["release"], "uses-permission")
    assert activity in names(manifests["debug"], "activity")
    assert activity not in names(manifests["release"], "activity")
    assert "android.car" not in names(manifests["release"], "uses-library")
    assert names(manifests["release"], "uses-permission") == {
        "pleos.car.permission.CAR_DOORS", "ai.pleos.playground.service.vehicle.VEHICLE_BINDING"}
    for variant, apk in (("debug", "app-debug.apk"), ("release", "app-release-unsigned.apk")):
        with zipfile.ZipFile(ROOT / f"app/build/outputs/apk/{variant}/{apk}") as archive:
            dex = b"".join(archive.read(n) for n in archive.namelist() if n.endswith(".dex"))
            assert (b"Lio/carscope/app/identity/VehicleIdentityActivity;" in dex) == (variant == "debug")
            assert (b"Lio/carscope/app/identity/IdentityProbe;" in dex) == (variant == "debug")
    print("PASS: debug activity/AAOS permission/library; release manifest and DEX boundary")


def capture(adb, serial, output):
    output.mkdir(parents=True, exist_ok=True)
    def call(*args, check=True):
        return subprocess.run([adb, "-s", serial, *args], check=check, capture_output=True, timeout=30)
    user = call("shell", "am", "get-current-user").stdout.decode().strip()
    assert user.isdecimal(), "Invalid current Android user"
    call("shell", "am", "force-stop", "io.carscope.app")
    call("shell", "run-as", "io.carscope.app", "--user", user, "rm", "-f", "files/vehicle-identity.json")
    call("shell", "am", "start", "--display", "0", "--windowingMode", "1", "-n", "io.carscope.app/.identity.VehicleIdentityActivity")
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        result = call("exec-out", "run-as", "io.carscope.app", "--user", user, "cat", "files/vehicle-identity.json", check=False)
        if result.returncode == 0:
            try:
                report = json.loads(result.stdout)
                break
            except json.JSONDecodeError:
                pass  # File may still be being written.
        time.sleep(2)
    else:
        raise TimeoutError("No fresh probe result in 120 seconds; runtime gate NOT_RUN/FAIL")
    check_report(report)
    (output / "vehicle-identity.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    # Only explicit platform/version keys, never getprop/dumpsys of all vehicle properties.
    environment = {}
    for key in ("ro.build.version.release", "ro.build.version.sdk", "ro.build.display.id", "ro.product.name"):
        environment[key] = call("shell", "getprop", key).stdout.decode().strip()
    environment["avdName"] = call("emu", "avd", "name").stdout.decode().splitlines()[0]
    (output / "environment.json").write_text(json.dumps(environment, indent=2), encoding="utf-8")
    call("shell", "screencap", "-p", "/data/local/tmp/carscope-identity.png")
    call("pull", "/data/local/tmp/carscope-identity.png", str(output / "probe.png"))
    print("PASS: fresh allowlisted report captured; inspect probe.png for actual UI/OEM evidence")
    print(json.dumps(report["identities"], indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build-contract")
    run = sub.add_parser("capture")
    run.add_argument("--adb", default="adb")
    run.add_argument("--serial", required=True)
    run.add_argument("--output", type=Path, required=True)
    validate = sub.add_parser("report")
    validate.add_argument("path", type=Path)
    args = parser.parse_args()
    if args.command == "build-contract":
        build_contract()
    elif args.command == "capture":
        capture(args.adb, args.serial, args.output)
    else:
        check_report(json.loads(args.path.read_text(encoding="utf-8")))
        print("PASS: allowlist and conservative identity classification")
