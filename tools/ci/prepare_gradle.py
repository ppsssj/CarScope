#!/usr/bin/env python3
"""Seed the unchanged Wrapper cache from Gradle's official GitHub release asset.

The normal release URL can return 504 while the REST asset download works.
No extraction or .ok marker is performed here: the Wrapper still installs and
verifies the archive. setup-gradle caches the resulting wrapper distribution.
"""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[2]
URL = "https://services.gradle.org/distributions/gradle-8.14-bin.zip"
ASSET = "https://api.github.com/repos/gradle/gradle-distributions/releases/assets/249401401"


def distribution(properties, home):
    values = dict(line.split("=", 1) for line in properties.read_text().splitlines()
                  if "=" in line and not line.startswith("#"))
    if values["distributionUrl"].replace("\\:", ":") != URL:
        raise ValueError("Update the official release asset mapping for this Gradle version")
    for key in ("distributionBase", "zipStoreBase"):
        if values[key] != "GRADLE_USER_HOME":
            raise ValueError(f"Unsupported {key}")
    for key in ("distributionPath", "zipStorePath"):
        if values[key] != "wrapper/dists":
            raise ValueError(f"Unsupported {key}")
    checksum = values["distributionSha256Sum"]
    if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
        raise ValueError("A pinned SHA-256 is required")
    # Gradle 8.14 PathAssembler: positive MD5 of the URL, encoded in base 36.
    number = int.from_bytes(hashlib.md5(URL.encode()).digest(), "big")
    suffix = ""
    while number:
        number, digit = divmod(number, 36)
        suffix = "0123456789abcdefghijklmnopqrstuvwxyz"[digit] + suffix
    return home / "wrapper/dists/gradle-8.14-bin" / (suffix or "0"), checksum


def download(destination):
    subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--connect-timeout", "20", "--max-time", "120",
        "--header", "Accept: application/octet-stream",
        "--output", str(destination), ASSET,
    ], check=True)


def prepare(properties, home):
    directory, checksum = distribution(properties, home)
    archive = directory / "gradle-8.14-bin.zip"
    if archive.with_suffix(".zip.ok").is_file() and (
        directory / "gradle-8.14/lib/gradle-launcher-8.14.jar"
    ).is_file():
        print("Gradle 8.14 wrapper distribution already installed; using restored cache")
        return
    directory.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix="official-asset-", dir=directory)
    os.close(descriptor)
    temporary = Path(name)
    try:
        download(temporary)
        with temporary.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != checksum:
            raise ValueError(f"Gradle distribution SHA-256 mismatch: expected {checksum}, got {actual}")
        temporary.replace(archive)
        print(f"Official Gradle 8.14 asset SHA-256 verified: {actual}")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gradle-user-home", type=Path,
                        default=Path(os.environ.get("GRADLE_USER_HOME", Path.home() / ".gradle")))
    args = parser.parse_args()
    prepare(REPO / "gradle/wrapper/gradle-wrapper.properties", args.gradle_user_home)
