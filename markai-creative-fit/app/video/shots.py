"""Shot boundaries and the per-frame change signal, from ONE decode pass.

ffmpeg's `scdet` filter sets `lavfi.scd.mafd` on every frame and
`lavfi.scd.time` on the frames it calls a cut. Reading both out of a single
`metadata=print` pass means shot segmentation costs the same as the change
signal exposed here — one decode, not two.

scdet is LGPL (libavfilter/vf_scdet.c). PySceneDetect would also work and is
BSD-3, but it is a new dependency for something already in the binary we ship.

MAFD ("mean absolute frame difference") is UNBOUNDED, NOT normalised to 0-1 —
it lives on the same scale as DEFAULT_SCENE_THRESHOLD below. Measured values
range from ~0 on a static frame up past 85 on a hard cut (a 30fps
black/white flicker fixture measured a max of 85.5; ordinary footage has
already hit 1.118). Do not assume this is a 0-1 quantity anywhere downstream.

This is a DIFFERENT statistic from the region-scoped change signal computed
in app/video/motion.py, which reads `signalstats` YAVG off a
`tblend=all_mode=difference` stream — that one genuinely IS 0-255 and is
divided by 255 to land in 0-1. The two are not interchangeable; do not reuse a
threshold tuned for one on the other.

`_scdet_metadata` returns the per-frame MAFD list alongside the cut times. A
public `frame_mafd()` wrapper existed here and was removed: it had no caller,
and an UNBOUNDED function of that name sitting beside motion.py's normalised
metric was the conflation hazard this docstring warns about. If something ever
genuinely needs the series, take it from `_scdet_metadata` rather than
reintroducing a lookalike.
"""

from __future__ import annotations

import itertools
import logging
import re
from pathlib import Path

from app.core.config import settings
from app.video import ffmpeg
from app.video.schemas import Shot

logger = logging.getLogger(__name__)

#: ffmpeg's own default. Its docs say "good values are in the [8.0, 14.0]
#: range" — lower catches soft transitions, higher only hard cuts. Ad creatives
#: are cut-heavy, so the default is a reasonable middle.
DEFAULT_SCENE_THRESHOLD = 10.0

#: A cut closer than this to the previous one is treated as the same shot.
#: Flash frames and one-frame transitions otherwise produce shots too short to
#: analyse, and a "shot" of 2 frames has no temporal evidence in it at all.
MIN_SHOT_SECONDS = 0.4

_MAFD = re.compile(r"lavfi\.scd\.mafd=([0-9.]+)")
_TIME = re.compile(r"lavfi\.scd\.time=([0-9.]+)")


def _scdet_metadata(path: Path, threshold: float) -> tuple[list[float], list[float]]:
    """Run scdet once; return (per-frame MAFD, cut times in seconds).

    Analysis runs on a downscaled copy: a cut is a global change, so detecting
    it at 480px is identical to detecting it at 4K and costs a fraction as much.
    """
    raw = ffmpeg.run(
        [
            "-i", str(path),
            "-vf", (
                f"scale={settings.VIDEO_ANALYSIS_WIDTH}:-2,"
                f"scdet=threshold={threshold},"
                "metadata=print:file=-"
            ),
            "-f", "null", "-",
        ]
    ).decode("utf-8", "replace")

    mafd = [float(m) for m in _MAFD.findall(raw)]
    cuts = [float(t) for t in _TIME.findall(raw)]
    return mafd, cuts


def detect(
    path: Path, duration: float, fps: float, threshold: float | None = None
) -> list[Shot]:
    """Segment ``path`` into shots.

    A video with no detected cut is ONE shot spanning the whole clip — that is
    the common case for a 15-second ad, and it must not come back empty.
    """
    _, cuts = _scdet_metadata(path, threshold or DEFAULT_SCENE_THRESHOLD)

    # Merge cuts that land too close together, and drop any at t=0 (the first
    # frame is a boundary by definition, not a cut).
    boundaries: list[float] = [0.0]
    for cut in sorted(cuts):
        if cut <= 0.0 or cut >= duration:
            continue
        if cut - boundaries[-1] < MIN_SHOT_SECONDS:
            continue
        boundaries.append(cut)
    boundaries.append(duration)

    shots: list[Shot] = []
    # itertools.pairwise walks consecutive boundary pairs without allocating
    # the boundaries[1:] copy zip() needed, and has no strict= footgun — an
    # earlier strict=True here made zip() raise on every call.
    for index, (start, end) in enumerate(itertools.pairwise(boundaries)):
        shots.append(
            Shot(
                index=index,
                start_seconds=round(start, 3),
                end_seconds=round(end, 3),
                start_frame=int(round(start * fps)),
                end_frame=max(int(round(end * fps)) - 1, int(round(start * fps))),
            )
        )
    logger.info("%d shot(s): cuts at %s", len(shots), [round(c, 2) for c in boundaries[1:-1]])
    return shots
