#!/usr/bin/env python3
"""Inspect and, if absent, seed the pinned Kotlin compiler from official sources.

SHA-256: JetBrains/kotlin v2.2.0 release asset 598661100 digest.
SHA-1: Maven Central .jar.sha1 (also Gradle's content-addressed cache directory).
Both were independently matched against the complete Maven Central JAR.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

SHA256 = "b2f743ea5ba12f69e0f35e5d8d46069d74c8e2861087548a7e0e14a784bc4cf1"
SHA1 = "8cfa2b049a4006d94474296df4abd9b50f288821"
NAME = "kotlin-compiler-embeddable-2.2.0.jar"
SOURCES = (
    "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-compiler-embeddable/2.2.0/" + NAME,
    "https://api.github.com/repos/JetBrains/kotlin/releases/assets/598661100",
)


def verify(path):
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != SHA256:
        raise ValueError(f"Kotlin compiler SHA-256 mismatch: {actual}")
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha1").hexdigest() != SHA1:
            raise ValueError("Kotlin compiler SHA-1 cache address mismatch")
    print(f"Kotlin compiler 2.2.0 verified SHA-256: {actual}")


def download(destination, source):
    subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--connect-timeout", "20", "--max-time", "120",
        "--header", "Accept: application/octet-stream",
        "--output", str(destination), source,
    ], check=True)


def prepare(home):
    version = home / "caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-compiler-embeddable/2.2.0"
    existing = sorted(version.glob("*/" + NAME))
    print(f"Restored Kotlin compiler 2.2.0 cache: {len(existing)} JAR(s)")
    for jar in existing:
        verify(jar)
    target = version / SHA1 / NAME
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix="verified-kotlin-", dir=target.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        for index, source in enumerate(SOURCES):
            try:
                download(temporary, source)
                break
            except subprocess.CalledProcessError:
                if index == len(SOURCES) - 1:
                    raise
                print("Maven download failed; trying the official JetBrains release asset API once")
        verify(temporary)  # A checksum mismatch fails; never try to hide it with another source.
        temporary.replace(target)
        print("Missing Kotlin compiler added to the local Gradle cache")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    prepare(Path(os.environ.get("GRADLE_USER_HOME", Path.home() / ".gradle")))
