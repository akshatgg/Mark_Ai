"""The three static tests — the inputs the erase router will decide on.

They are separate functions answering separate questions, and conflating them
is the standard bug here:

  A  has the BOX moved?          geometry, from tracking.py's observations
  B  have its PIXELS changed?    content, measured here
  C  does the SURROUND move?     whether the truth behind the overlay exists
                                 in any other frame at all

C is the one that decides everything downstream. If the surround is also
static, the pixels behind the overlay were never visible in any frame, and no
amount of temporal reasoning recovers them — that case must be inpainted. If
the surround moves, the real pixels are somewhere in the clip and can be
recovered exactly, with no model and no flicker.

Thresholds are RELATIVE, not absolute. ffmpeg's freezedetect defaults to
-60dB (0.001 normalised, ~0.26 grey levels), which is right for a genuinely
frozen signal and wrong for a re-encoded ad: quantisation resets at every GOP
and deblocking strength varies with neighbouring QP, so a visually static
overlay measures 0.002-0.01. A ratio against a control ring self-calibrates to
whatever bitrate the creative happens to have been delivered at.
"""

from __future__ import annotations

import logging
import re
import statistics
from pathlib import Path

from app.video import ffmpeg
from app.video.schemas import RegionMotion, Shot

logger = logging.getLogger(__name__)

#: A region changing less than a quarter as much as its surroundings is static.
#: Relative, so it holds at any bitrate.
STATIC_RATIO = 0.25

#: The surround must move at least this much (absolute, normalised) before the
#: background behind an overlay counts as recoverable. Below it the whole shot
#: is essentially frozen and there is nothing to recover FROM.
SURROUND_MOVES_MIN = 0.02

#: How far outside the region the control ring extends, as a share of the
#: region's size.
RING_MARGIN = 0.5

_YAVG = re.compile(r"lavfi\.signalstats\.YAVG=([0-9.]+)")


def _crop_mafd(path: Path, crop: tuple[int, int, int, int], shot: Shot) -> float:
    """Median frame-to-frame absolute luma difference inside ``crop``.

    `tblend=all_mode=difference` turns consecutive frames into their absolute
    difference, and `signalstats` then reports that frame's average luma — so
    YAVG on the blended stream IS the mean absolute difference. Median over the
    shot rather than mean: a handful of blocky macroblock outliers drag a mean
    over any threshold while the median stays put.
    """
    width, height, x, y = crop
    raw = ffmpeg.run(
        [
            "-ss", f"{shot.start_seconds:.3f}",
            "-t", f"{max(shot.duration_seconds, 0.1):.3f}",
            "-i", str(path),
            "-vf", (
                f"crop={width}:{height}:{x}:{y},"
                "format=gray,"
                "tblend=all_mode=difference,"
                "signalstats,"
                "metadata=print:key=lavfi.signalstats.YAVG:file=-"
            ),
            "-f", "null", "-",
        ]
    ).decode("utf-8", "replace")

    values = [float(v) for v in _YAVG.findall(raw)]
    if not values:
        return 0.0
    # YAVG is 0-255; normalise to 0-1 so the thresholds read the same way as
    # scdet's MAFD.
    return statistics.median(values) / 255.0


def _pixels(box: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """Normalised [ymin,xmin,ymax,xmax] -> even (w, h, x, y) crop, clamped."""
    y0 = max(0, min(height - 2, round(box[0] / 1000 * height)))
    x0 = max(0, min(width - 2, round(box[1] / 1000 * width)))
    y1 = max(y0 + 2, min(height, round(box[2] / 1000 * height)))
    x1 = max(x0 + 2, min(width, round(box[3] / 1000 * width)))
    # crop dimensions must be even for the yuv pipeline
    w = max(2, (x1 - x0) - ((x1 - x0) % 2))
    h = max(2, (y1 - y0) - ((y1 - y0) % 2))
    return w, h, x0, y0


def _ring(box: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """A control crop surrounding ``box``, clamped to the frame.

    Deliberately a larger box around the region rather than a true annulus:
    ffmpeg has no annulus crop, and a surrounding box that INCLUDES the region
    still moves markedly more than the region alone whenever the background is
    live, which is all this test needs to distinguish.
    """
    h_span, w_span = box[2] - box[0], box[3] - box[1]
    grown = [
        max(0, round(box[0] - h_span * RING_MARGIN)),
        max(0, round(box[1] - w_span * RING_MARGIN)),
        min(1000, round(box[2] + h_span * RING_MARGIN)),
        min(1000, round(box[3] + w_span * RING_MARGIN)),
    ]
    return _pixels(grown, width, height)


def classify(
    path: Path, box: list[int], shot: Shot, width: int, height: int,
    box_static: bool = True,
) -> RegionMotion:
    """Measure tests B and C for one region. ``box_static`` (test A) is passed in.

    Test A is geometry and belongs to tracking.py, which has the per-frame
    observations; this module only measures pixels.
    """
    inside = _crop_mafd(path, _pixels(box, width, height), shot)
    around = _crop_mafd(path, _ring(box, width, height), shot)

    pixels_static = (inside <= around * STATIC_RATIO) if around > 0 else (inside < 1e-4)
    background_moves = around >= SURROUND_MOVES_MIN

    logger.info(
        "region %s: mafd %.5f vs ring %.5f (ratio %.3f) -> pixels_static=%s "
        "background_moves=%s",
        box, inside, around, (inside / around) if around else 0.0,
        pixels_static, background_moves,
    )
    return RegionMotion(
        box_static=box_static,
        pixels_static=pixels_static,
        background_moves=background_moves,
        mafd_region=round(inside, 6),
        mafd_ring=round(around, 6),
    )
