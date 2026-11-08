"""A corrupt restored cache or download must fail without replacing good bytes."""
import hashlib
import io
from contextlib import redirect_stdout
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import prepare_kotlin as subject


class PrepareKotlinTest(unittest.TestCase):
    def test_cold_then_warm_cache_and_corrupt_cache_rejection(self):
        data = b"synthetic Kotlin JAR"
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            home = Path(directory)
            with patch.object(subject, "SHA256", hashlib.sha256(data).hexdigest()), \
                 patch.object(subject, "SHA1", hashlib.sha1(data).hexdigest()), \
                 patch.object(subject, "download", side_effect=lambda path, url: path.write_bytes(data)) as fetch:
                subject.prepare(home)
                subject.prepare(home)
                self.assertEqual(fetch.call_count, 1)
                jar = next(home.rglob(subject.NAME))
                jar.write_bytes(b"corrupt cache")
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    subject.prepare(home)
                self.assertEqual(fetch.call_count, 1)

    def test_failed_download_falls_back_once_but_bad_checksum_never_installs(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            home = Path(directory)

            def fetch(path, url):
                if url == subject.SOURCES[0]:
                    raise subprocess.CalledProcessError(22, "curl")
                path.write_bytes(b"wrong download")

            with patch.object(subject, "download", side_effect=fetch) as download:
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    subject.prepare(home)
                self.assertEqual(download.call_count, 2)
            self.assertFalse(list(home.rglob("*.jar")))
            self.assertFalse(list(home.rglob("verified-kotlin-*")))


if __name__ == "__main__":
    unittest.main()
