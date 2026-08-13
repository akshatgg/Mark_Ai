#!/usr/bin/env python3
"""Mark AI updater agent — installs player APKs onto screens over Headscale.

Runs on the `headscale` GCE VM, which is the only machine that is both on the
tailnet and holds an adb key the screens have authorized. The backend cannot
reach a box sitting behind a cafe's NAT; this process can.

Four design decisions worth keeping:

* **It POLLS the backend.** Nothing calls in, so the VM needs no inbound
  exposure beyond Headscale itself.
* **It never trusts adb's exit code.** The package manager kills the calling
  process's pipe during an install, so a *successful* install routinely returns
  truncated or empty output. Success is confirmed by reading the installed
  versionCode back off the device.
* **It verifies sha256 before touching the device.** A truncated download must
  fail here, cheaply, rather than part-way through replacing a running player.
* **It downloads each release once.** A fleet rollout is the same bytes N times;
  caching by version code turns a 20 MB fetch per screen into one.
"""

import hashlib
import logging
import os
import re
import subprocess
import sys
import time
from typing import List, Optional

import requests

API_BASE = os.environ["MARKAI_API_BASE"].rstrip("/")
AGENT_SECRET = os.environ["MARKAI_AGENT_SECRET"]
BUCKET = os.environ.get("MARKAI_BUCKET", "markai-storage")
POLL_SECONDS = int(os.environ.get("MARKAI_POLL_SECONDS", "20"))
CACHE_DIR = os.environ.get("MARKAI_CACHE_DIR", "/var/lib/markai-agent/apk")
PKG = os.environ.get("MARKAI_PACKAGE", "tech.markai.player")
ADB_PORT = os.environ.get("MARKAI_ADB_PORT", "5555")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("markai-agent")

_VERSION_CODE_RE = re.compile(r"versionCode=(\d+)")


def verify_sha256(path: str, expected: str) -> bool:
    """Stream the file so a 20 MB APK never lands in memory twice."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected.lower()


def parse_installed_version(dumpsys_output: str) -> Optional[int]:
    """Pull versionCode out of `dumpsys package`, or None if the package is absent."""
    match = _VERSION_CODE_RE.search(dumpsys_output or "")
    return int(match.group(1)) if match else None


def run(cmd: List[str], timeout: int = 180) -> subprocess.CompletedProcess:
    log.info("$ %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def fetch_apk(gcs_object: str, version_code: int, sha256: str) -> str:
    """Download the release once, reuse it for every screen in the rollout."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    local = os.path.join(CACHE_DIR, f"{version_code}.apk")

    if os.path.exists(local) and verify_sha256(local, sha256):
        log.info("using cached %s", local)
        return local

    result = run(
        ["gcloud", "storage", "cp", f"gs://{BUCKET}/{gcs_object}", local], timeout=900
    )
    if result.returncode != 0:
        raise RuntimeError(f"GCS download failed: {result.stderr.strip()[:300]}")
    if not verify_sha256(local, sha256):
        # Delete it: a bad cached file would fail every subsequent screen too.
        os.remove(local)
        raise RuntimeError("sha256 mismatch on the downloaded APK — refusing to install")
    return local


def installed_version(target: str) -> Optional[int]:
    return parse_installed_version(
        run(["adb", "-s", target, "shell", "dumpsys", "package", PKG]).stdout
    )


def install_on(ip: str, apk_path: str, expected_code: int) -> int:
    """Install on one screen and return the versionCode the device reports back."""
    target = f"{ip}:{ADB_PORT}"

    # Always start from a clean transport: adb accumulates dead/offline entries
    # for NAT'd links, and a stale one makes every later command fail.
    run(["adb", "disconnect", target], timeout=30)

    connected = run(["adb", "connect", target], timeout=60)
    combined_connect = f"{connected.stdout} {connected.stderr}".lower()
    if "connected" not in combined_connect:
        raise RuntimeError(
            f"could not reach the screen at {target}: "
            f"{connected.stdout.strip() or connected.stderr.strip()}"
        )

    devices = run(["adb", "devices"]).stdout
    if f"{target}\tunauthorized" in devices or "unauthorized" in devices:
        raise RuntimeError(
            "the screen reports 'unauthorized' — this agent's adb key was never "
            "approved on that box, and it cannot be approved remotely (someone "
            "must tap Allow on the screen itself)"
        )

    before = installed_version(target)
    result = run(["adb", "-s", target, "install", "-r", apk_path], timeout=900)
    output = f"{result.stdout} {result.stderr}".strip()

    # Confirm from the device, never from the exit code — see module docstring.
    actual = installed_version(target)
    run(["adb", "disconnect", target], timeout=30)

    if actual == expected_code:
        return actual
    raise RuntimeError(
        f"install did not take (was {before}, wanted {expected_code}, device now "
        f"reports {actual}): {output[:300]}"
    )


def claim(limit: int = 5) -> List[dict]:
    response = requests.post(
        f"{API_BASE}/api/agent/apk/claim",
        json={"limit": limit},
        headers={"X-Agent-Secret": AGENT_SECRET},
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("jobs", [])


def report(
    job_id: str, ok: bool, code: Optional[int], error: Optional[str]
) -> None:
    requests.post(
        f"{API_BASE}/api/agent/apk/report",
        json={
            "job_id": job_id,
            "ok": ok,
            "installed_version_code": code,
            # Truncated: the backend stores this for an operator to read in the
            # CMS, not for a full stack trace.
            "error": (error or "")[:1000] or None,
        },
        headers={"X-Agent-Secret": AGENT_SECRET},
        timeout=30,
    ).raise_for_status()


def process(job: dict) -> None:
    job_id = job["job_id"]
    try:
        apk = fetch_apk(
            job["gcs_object"], job["target_version_code"], job["sha256"]
        )
        code = install_on(job["tailscale_ip"], apk, job["target_version_code"])
        log.info("job %s OK — screen %s now on %s", job_id, job["screen_id"], code)
        report(job_id, True, code, None)
    except Exception as exc:  # noqa: BLE001 — every failure must reach the CMS
        log.warning("job %s FAILED: %s", job_id, exc)
        try:
            report(job_id, False, None, str(exc))
        except Exception as report_exc:  # noqa: BLE001
            # The backend requeues a claim that goes stale, so a lost report
            # self-heals rather than stranding the screen.
            log.error("could not report job %s: %s", job_id, report_exc)


def main() -> None:
    log.info(
        "markai updater agent starting; api=%s bucket=%s poll=%ss",
        API_BASE,
        BUCKET,
        POLL_SECONDS,
    )
    while True:
        try:
            for job in claim():
                process(job)
        except Exception as exc:  # noqa: BLE001 — the loop must never die
            log.error("poll cycle failed: %s", exc)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
