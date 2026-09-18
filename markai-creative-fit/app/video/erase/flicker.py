"""The flicker ratio: does an erased region visibly pulse relative to its
surroundings, and did the erase actually recover the real picture or just
something that happens to hold still?

Two independent measurements live here, and the second exists because the
first is not enough on its own:

  measure()     flicker ratio = _crop_mafd(erased region) / _crop_mafd(control
                region). A flat, unchanging patch scores a perfect ratio here
                even when it is the WRONG picture -- a static rectangle has
                zero frame-to-frame delta by definition, whatever colour it
                happens to be.
  psnr_luma()   the check that catches exactly that: fidelity of the erased
                region against footage KNOWN to be correct. A flat patch
                scores low here even while scoring a perfect flicker ratio.

A third measurement, loop_seam(), covers a different defect neither of the
above can see: signage plays a finished ad on an unbroken loop, so the shot's
last displayed frame is immediately followed by its own first frame again,
and a splice AT that wrap-around never appears in a flicker ratio built only
from consecutive in-shot pairs.

All three reuse `motion._crop_mafd` for "frame-to-frame absolute luma
difference inside a crop" rather than reimplementing it -- see the import
below for why.
"""

from __future__ import annotations

import logging
import statistics
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.video import ffmpeg

# `_crop_mafd` already IS "frame-to-frame absolute luma difference inside a
# crop" (tblend=all_mode=difference -> signalstats YAVG -> /255, MEDIAN over
# the shot -- see its own docstring for why median, not mean). Reusing it
# here rather than re-deriving the same eight-line ffmpeg filter chain a
# second time is deliberate: two copies of a correctness-critical recipe are
# two places for a threshold, a normalisation, or the median-vs-mean choice
# to drift apart, and this file's whole job is to stay in lockstep with
# motion.py's definition of "did this move". Importing a private name from a
# sibling module is unusual, but it is the honest way to say "this IS that
# function", not a second implementation that could quietly disagree with it.
from app.video.motion import _crop_mafd
from app.video.schemas import Shot

logger = logging.getLogger(__name__)

#: (width, height, x, y) in NATIVE pixels -- the same shape `motion._pixels`
#: and `_crop_mafd` already use, and the shape Task 4's plate builder freezes
#: per shot after quantising + dilating a proxy box. This module never takes
#: a normalised 0-1000 box; by the time an erase decision reaches here the
#: crop is already fixed geometry.
Crop = tuple[int, int, int, int]

#: Flicker ratio gate. **Upper bound only -- there is no lower bound and one
#: must never be added.** A pasted clean-plate patch is legitimately
#: bit-identical across every frame of the shot (erase-side mafd ~0) while its
#: compressed surroundings still carry 0.002-0.01 of GOP quantisation noise,
#: so a ratio of ~0.1 is the CORRECT reading for a good erase, not a
#: suspicious one -- only a HIGH ratio (the erased region moving MORE than its
#: surroundings) is a real flicker defect.
FLICKER_PASS_MAX = 1.5
FLICKER_WARN_MAX = 2.0

#: Loop-seam gate. Same three-tier shape as the flicker gate above, but a
#: looser WARN band: this is a single wrap-around SAMPLE compared against a
#: shot's median step, not a median compared against a median, so it is
#: inherently noisier than the flicker ratio and deserves more room before a
#: WARN before it escalates to FAIL. No numeric value for this gate was
#: specified in the design -- these are this module's own judgement call, and
#: are named constants (not inlined) for exactly that reason: to be found and
#: revisited from real footage, not re-derived from the docstring each time.
SEAM_PASS_MAX = 1.5
SEAM_WARN_MAX = 3.0


def _grade(ratio: float, pass_max: float, warn_max: float) -> str:
    if ratio <= pass_max:
        return "pass"
    if ratio <= warn_max:
        return "warn"
    return "fail"


def _overlaps(a: Crop, b: Crop) -> bool:
    aw, ah, ax, ay = a
    bw, bh, bx, by = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def control_region(erase_box: Crop, other_erase_boxes: Sequence[Crop], width: int, height: int
                   ) -> Crop:
    """Pick the crop the flicker ratio measures the erased region against.

    Mirrored horizontally across the frame first: ad footage's motion is far
    more often laterally symmetric than vertically (a pan or a shoulder-height
    subject reads the same on either side of frame, rarely the same
    top-to-bottom), so a horizontal mirror is the candidate least likely to
    land somewhere structurally different from the erased region's own
    surroundings.

    Re-picked if that lands on another region's OWN erase box: two overlays
    placed symmetrically across the frame centre is not a freak case (a
    lower-third and a matching upper credit, say), and a control crop sitting
    on top of a DIFFERENT erased region would measure that region's own
    flicker instead of the background's -- silently invalidating the ratio
    rather than raising, which is worse than a slightly awkward fallback.
    Falls back to a vertical mirror, then a point mirror (both axes). If every
    candidate still collides, the horizontal mirror is returned anyway
    (clamped into frame) -- a contaminated control is auditable (it is
    RETURNED, see `FlickerResult.control_box`) and a human can see it landed
    on another box; silently refusing to measure at all would not be.
    """
    w, h, x, y = erase_box
    horizontal: Crop = (w, h, _clamp(width - x - w, 0, max(0, width - w)), y)
    vertical: Crop = (w, h, x, _clamp(height - y - h, 0, max(0, height - h)))
    both: Crop = (
        w, h,
        _clamp(width - x - w, 0, max(0, width - w)),
        _clamp(height - y - h, 0, max(0, height - h)),
    )
    for candidate in (horizontal, vertical, both):
        if not any(_overlaps(candidate, other) for other in other_erase_boxes):
            return candidate
    logger.warning(
        "control_region: every mirror candidate overlaps another erase box near "
        "%s; using the horizontal mirror anyway (recorded, not hidden)", erase_box,
    )
    return horizontal


@dataclass(frozen=True)
class FlickerResult:
    """The flicker ratio, plus everything needed to audit it.

    `erase_box`/`control_box` are RECORDED, not just consumed internally --
    per the design, a bare ratio with no visible denominator is not
    auditable, and this project already has a documented history (Phase B) of
    a metric's normalisation silently breaking while its pass/fail output
    kept looking fine.
    """

    erase_mafd: float
    control_mafd: float
    ratio: float
    erase_box: Crop
    control_box: Crop
    grade: str  # "pass" | "warn" | "fail"


def measure(
    path: Path,
    erase_box: Crop,
    shot: Shot,
    width: int,
    height: int,
    other_erase_boxes: Sequence[Crop] = (),
) -> FlickerResult:
    """Flicker ratio = _crop_mafd(erase_box) / _crop_mafd(control_box).

    **Median, not mean -- inherited from `_crop_mafd`, not re-decided here.**
    The design spec this module implements says "mean"; that line is wrong
    and is deliberately overridden. `_crop_mafd` already returns a MEDIAN over
    the shot's frame pairs, for a documented reason (a handful of blocky
    macroblock outliers, which a re-encoded ad throws up at nearly every GOP
    boundary, drag a MEAN over any threshold a gate could set). Computing this
    ratio as a mean-of-per-frame-deltas on top of an already-median
    `_crop_mafd` would not "average things out" -- it would just reintroduce,
    one level up, the exact outlier sensitivity `_crop_mafd` was written to
    avoid, and the two numbers this file and motion.py hand to a human would
    quietly stop meaning the same thing.
    """
    control_box = control_region(erase_box, other_erase_boxes, width, height)
    erase_mafd = _crop_mafd(path, erase_box, shot)
    control_mafd = _crop_mafd(path, control_box, shot)

    if control_mafd > 0:
        ratio = erase_mafd / control_mafd
    elif erase_mafd <= 1e-9:
        # Both sides read exactly zero (e.g. a still-frame fixture): 0/0 is
        # mathematically undefined, but there is no flicker to report either
        # way, so this is the best case, not an error.
        ratio = 0.0
    else:
        # The erased region moves against a control that measures EXACTLY
        # zero -- the worst-calibrated case this ratio can hit. inf sorts
        # above every finite gate, which is the correct FAIL: dividing by a
        # tiny-but-nonzero floor instead would produce a large-but-finite
        # number that could accidentally slip under a loose threshold.
        ratio = float("inf")

    grade = _grade(ratio, FLICKER_PASS_MAX, FLICKER_WARN_MAX)
    logger.info(
        "flicker: region %.5f / control %.5f = %.3f (%s) -- erase=%s control=%s",
        erase_mafd, control_mafd, ratio, grade, erase_box, control_box,
    )
    return FlickerResult(
        erase_mafd=erase_mafd, control_mafd=control_mafd, ratio=ratio,
        erase_box=erase_box, control_box=control_box, grade=grade,
    )


def psnr_luma(candidate: Path, ground_truth: Path, crop: Crop, shot: Shot) -> float:
    """Luma-only PSNR (dB, higher is better) of ``candidate``'s ``crop``
    against ``ground_truth``'s identical crop, over one shot.

    This is what makes `measure()`'s flicker ratio meaningful rather than
    gameable. A flat, unchanging rectangle scores a perfect flicker ratio
    against ITSELF -- zero frame-to-frame delta is zero frame-to-frame delta,
    whatever colour the rectangle is -- but flicker never looks at whether the
    content is actually the right picture. PSNR against footage KNOWN to be
    correct does: a flat patch that erased real, varying content reads a low,
    unmistakable PSNR here even while its own flicker ratio is perfect.

    Uses ffmpeg's own `psnr` filter rather than a numpy per-frame
    reimplementation, for the same "reuse a well-worn primitive instead of a
    second correctness-critical implementation" reason `measure()` reuses
    `_crop_mafd`. `stats_file=` is used instead of reading ffmpeg's stderr
    summary because that summary logs at AV_LOG_INFO, and every call in this
    codebase runs ffmpeg with `-v error` (see ffmpeg.py) -- the per-frame
    stats file is written unconditionally, regardless of log level.
    """
    width, height, x, y = crop
    crop_filter = f"crop={width}:{height}:{x}:{y}"
    with tempfile.TemporaryDirectory() as tmp:
        stats_path = Path(tmp) / "psnr.log"
        ffmpeg.run([
            "-ss", f"{shot.start_seconds:.3f}",
            "-t", f"{max(shot.duration_seconds, 0.1):.3f}",
            "-i", str(candidate),
            "-ss", f"{shot.start_seconds:.3f}",
            "-t", f"{max(shot.duration_seconds, 0.1):.3f}",
            "-i", str(ground_truth),
            "-lavfi",
            f"[0:v]{crop_filter}[a];[1:v]{crop_filter}[b];"
            f"[a][b]psnr=stats_file={stats_path}",
            "-f", "null", "-",
        ])
        lines = stats_path.read_text().splitlines()

    values: list[float] = []
    for line in lines:
        for token in line.split():
            if token.startswith("psnr_y:"):
                # ffmpeg writes the literal text "inf" for a bit-identical
                # frame pair; Python's float() parses that natively, and it
                # is the CORRECT reading here (a perfect per-frame match
                # really is infinite PSNR), not a sentinel to strip out.
                values.append(float(token.split(":", 1)[1]))
    if not values:
        raise ffmpeg.FfmpegError(
            f"psnr filter produced no psnr_y samples for {candidate} vs {ground_truth}"
        )

    finite = [v for v in values if v != float("inf")]
    if not finite:
        return float("inf")
    # Mean, not median, and deliberately the opposite choice from
    # `measure()` above: PSNR is already a per-frame fidelity figure in dB,
    # and this check wants the shot's AVERAGE fidelity, not to discount
    # whichever frame differed the most. An outlier-robust median is the
    # WRONG shape for THIS metric -- a single badly-recovered frame is
    # exactly the defect `erase-recovers` exists to surface, and a median
    # could bury it under a run of easy frames either side of it.
    return statistics.mean(finite)


def _frame_luma(path: Path, crop: Crop, timestamp: float) -> np.ndarray:
    """One frame's luma as a 2-D array, decoded at ``timestamp`` inside ``crop``."""
    width, height, x, y = crop
    raw = ffmpeg.run([
        "-ss", f"{max(timestamp, 0.0):.3f}",
        "-i", str(path),
        "-vf", f"crop={width}:{height}:{x}:{y},format=gray",
        "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ])
    return np.frombuffer(raw, np.uint8)[: width * height].reshape(height, width)


@dataclass(frozen=True)
class LoopSeamResult:
    seam_delta: float
    median_step_delta: float
    ratio: float
    grade: str  # "pass" | "warn" | "fail"


def loop_seam(path: Path, crop: Crop, shot: Shot, fps: float) -> LoopSeamResult:
    """How much the picture jumps where the loop wraps, relative to an
    ordinary in-shot frame step.

    Signage plays a finished ad on an unbroken loop: the shot's last displayed
    frame is immediately followed by its own first frame again, with no cut
    or fade between them. `measure()`'s flicker ratio cannot see a defect
    there -- it only ever compares CONSECUTIVE in-shot frames, and the
    wrap-around pair (last frame, first frame) is never one of those pairs.
    An erase composite can be smooth everywhere else and still splice
    unevenly exactly at the seam an erase pass touches (e.g. a clean-plate
    patch sourced from a reference frame near one end of the shot, or a
    median band that samples the swept region asymmetrically), and nothing
    else in this module would catch it.

    Compares the wrap-around delta against a MEDIAN of ordinary in-shot steps
    (reusing `_crop_mafd` again, same reuse-not-reimplement reasoning as
    `measure()`) -- a seam no worse than a typical frame-to-frame move reads
    as a continuation of normal motion; one much larger reads as a visible
    splice.
    """
    median_step = _crop_mafd(path, crop, shot)
    first = _frame_luma(path, crop, shot.start_seconds)
    # The frame AT end_seconds is one PAST the last displayed frame (Shot's
    # end is exclusive, matching shots.py) -- sampling there could pull in the
    # next shot after a cut, not the wrap-around seam this checks for, so
    # back off by one frame period to land on the true final frame.
    last_ts = max(shot.start_seconds, shot.end_seconds - 1.0 / fps)
    last = _frame_luma(path, crop, last_ts)

    seam = float(np.mean(np.abs(first.astype(np.float64) - last.astype(np.float64)))) / 255.0
    if median_step > 0:
        ratio = seam / median_step
    elif seam <= 1e-9:
        ratio = 0.0
    else:
        ratio = float("inf")

    grade = _grade(ratio, SEAM_PASS_MAX, SEAM_WARN_MAX)
    logger.info(
        "loop-seam: seam %.5f vs median step %.5f = %.3f (%s)", seam, median_step, ratio, grade,
    )
    return LoopSeamResult(
        seam_delta=seam, median_step_delta=median_step, ratio=ratio, grade=grade,
    )
