"""Synthetic checks: wrong bytes must never enter the Wrapper cache."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prepare_gradle as subject


class PrepareGradleTest(unittest.TestCase):
    def test_verified_archive_is_installed_by_the_real_wrapper_only(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            properties = root / "wrapper.properties"
            data = b"synthetic archive"
            checksum = hashlib.sha256(data).hexdigest()
            original = subject.REPO / "gradle/wrapper/gradle-wrapper.properties"
            values = original.read_text()
            pinned = next(line.split("=", 1)[1] for line in values.splitlines()
                          if line.startswith("distributionSha256Sum="))
            properties.write_text(values.replace(pinned, checksum))
            directory, _ = subject.distribution(properties, root)
            # Known path from the real Gradle Wrapper, not an alternate cache URL.
            self.assertEqual(directory.name, "38aieal9i53h9rfe7vjup95b9")
            with patch.object(subject, "download", lambda path: path.write_bytes(data)):
                subject.prepare(properties, root)
            self.assertEqual((directory / "gradle-8.14-bin.zip").read_bytes(), data)
            self.assertFalse((directory / "gradle-8.14-bin.zip.ok").exists())
            with patch.object(subject, "download", lambda path: path.write_bytes(b"wrong")):
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    subject.prepare(properties, root)
            self.assertEqual((directory / "gradle-8.14-bin.zip").read_bytes(), data)
            self.assertFalse(list(directory.glob("official-asset-*")))
            properties.write_text(values.replace("gradle-8.14-bin", "gradle-9.0-bin"))
            with self.assertRaisesRegex(ValueError, "asset mapping"):
                subject.prepare(properties, root)


if __name__ == "__main__":
    unittest.main()
