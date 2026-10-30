"""Validate CI test counts before publishing a test-only APK; no Android runtime calls."""

import hashlib
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def verify(root: Path) -> tuple[str, Path]:
    lines = ["## Android build CI (test-only)", ""]
    for module, task, expected in (
        ("vehicle-core", "test", 17),
        ("app", "testDebugUnitTest", 19),
    ):
        reports = sorted((root / module / "build/test-results" / task).glob("TEST-*.xml"))
        if not reports:
            raise ValueError(f"{module}: missing JUnit XML reports")
        totals = dict.fromkeys(("tests", "failures", "errors", "skipped"), 0)
        for report in reports:
            suite = ET.parse(report).getroot()
            if suite.tag != "testsuite":
                raise ValueError(f"{module}: unexpected JUnit XML root")
            if len(suite.findall("testcase")) != int(suite.attrib["tests"]):
                raise ValueError(f"{module}: inconsistent XML testcase count")
            for key in totals:
                totals[key] += int(suite.attrib[key])
        result = f"{module}: " + ", ".join(f"{key}={value}" for key, value in totals.items())
        print(result)
        lines.append(result + "  ")
        if totals != {"tests": expected, "failures": 0, "errors": 0, "skipped": 0}:
            raise ValueError(f"{module}: expected {expected} tests, no failures/errors/skips")

    apk = root / "app/build/outputs/apk/debug/app-debug.apk"
    if not apk.is_file() or apk.stat().st_size == 0:
        raise ValueError("Debug APK is missing or empty")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    apk.with_suffix(".apk.sha256").write_text(f"{digest}  {apk.name}\n", encoding="utf-8")
    print(f"Test-only debug APK SHA-256: {digest}")
    lines += ["", "Total: 36 PASS", "", f"APK SHA-256: `{digest}`", "",
              "Debug APK is for testing, not distribution. P1-B runtime remains BLOCKED.", ""]
    return "\n".join(lines), apk


if __name__ == "__main__":
    try:
        summary, _ = verify(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd())
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
                output.write(summary)
    except (ValueError, KeyError, OSError, ET.ParseError) as error:
        raise SystemExit(f"Android CI validation failed: {error}") from error
