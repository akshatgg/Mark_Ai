"""Shared helpers for fetching and caching model weights."""

import logging
import shutil
from pathlib import Path

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def ensure_weights(url: str, filename: str) -> Path:
    """Download ``url`` into MODEL_DIR once and return the local path.

    Downloads to a .part file and renames on success, so an interrupted pull
    never leaves a truncated checkpoint that fails to load later.
    """
    dest = settings.MODEL_DIR / filename
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    part = dest.with_suffix(dest.suffix + ".part")
    logger.info("Fetching model weights %s -> %s", url, dest)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600.0) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for chunk in resp.iter_bytes(1 << 20):
                fh.write(chunk)
    shutil.move(str(part), str(dest))
    logger.info("Model ready: %s (%.0f MB)", dest.name, dest.stat().st_size / 1e6)
    return dest
