"""Unit tests for the pure helpers in agent.py.

Only the pieces that can be tested without a device or a network are covered
here — hashing and version parsing. The install path itself is proven by the
end-to-end smoke test in README.md, because faking adb would test the fake.
"""

import hashlib
import os
import sys

# The module reads its config from the environment at import time, so these must
# be set before the import below.
os.environ.setdefault("MARKAI_API_BASE", "http://localhost:8000")
os.environ.setdefault("MARKAI_AGENT_SECRET", "test-secret")

sys.path.insert(0, os.path.dirname(__file__))

from agent import parse_installed_version, verify_sha256  # noqa: E402


def test_verify_sha256_accepts_matching(tmp_path):
    f = tmp_path / "a.apk"
    f.write_bytes(b"hello")
    assert verify_sha256(str(f), hashlib.sha256(b"hello").hexdigest()) is True


def test_verify_sha256_is_case_insensitive(tmp_path):
    f = tmp_path / "a.apk"
    f.write_bytes(b"hello")
    upper = hashlib.sha256(b"hello").hexdigest().upper()
    assert verify_sha256(str(f), upper) is True


def test_verify_sha256_rejects_mismatch(tmp_path):
    f = tmp_path / "a.apk"
    f.write_bytes(b"hello")
    assert verify_sha256(str(f), "0" * 64) is False


def test_verify_sha256_rejects_truncated_download(tmp_path):
    """The case this exists for: a cafe link dropping mid-download."""
    full = b"x" * 5000
    f = tmp_path / "a.apk"
    f.write_bytes(full[:2000])
    assert verify_sha256(str(f), hashlib.sha256(full).hexdigest()) is False


def test_parse_installed_version_reads_dumpsys():
    out = "    versionCode=10100 minSdk=24 targetSdk=34\n    versionName=1.1.0"
    assert parse_installed_version(out) == 10100


def test_parse_installed_version_returns_none_when_package_absent():
    assert parse_installed_version("no package found") is None


def test_parse_installed_version_handles_empty_output():
    """adb returns empty output when the package manager kills the pipe."""
    assert parse_installed_version("") is None
    assert parse_installed_version(None) is None
