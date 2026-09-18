"""Global-translation registration: did the CAMERA move?

This is the gate the `median` erase branch depends on (see `erase/router.py`).
`motion.background_moves` only proves that SOMETHING in the shot changed — a
walking subject in front of a locked-off camera clears it just as easily as a
real pan. If the camera never moved, the pixels behind a static overlay were
never visible in any frame, and no amount of temporal reasoning recovers
them: the median of the swept band would just be the overlay again, and the
flicker ratio would read a perfect, false 1.0 because the "recovered" plate
IS the input. Test D exists to catch that before it self-certifies.

**Why ffmpeg cannot do this** (verified, not re-litigated here): `vidstabdetect`
is absent from this build and vid.stab is GPL besides; `mestimate` exports its
motion vectors as frame side data that a rawvideo pipe cannot carry out;
`deshake`/`minterpolate` correct camera motion but never report how much there
was.

**The method: FFT phase correlation on proxy luma.** For two frames `a`, `b`
that differ (mostly) by a translation, the cross-power spectrum of their
Fourier transforms is a complex exponential whose only free parameter is that
translation; its inverse FFT is (ideally) a single sharp delta at exactly that
shift, recoverable to sub-pixel precision by fitting the peak's immediate
neighbours. This is ~40 lines of numpy and roughly 1 ms per 480px-proxy pair,
so a full shot's worth of pairs (proxies are decoded upstream — this module
takes plain 2-D arrays, no ffmpeg or file I/O of its own) is comfortably under
a second even for 600 frames.

**Scope: translation only, on purpose.** Rotation and zoom would need a
log-polar resampling of the spectrum before correlating — real work, and
nothing in this corpus needs it. The camera moves that matter in an ad are
pans and slow pushes; anything more exotic is out of scope until a clip
actually demands it. Do not build the log-polar path speculatively.
"""

from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

#: Test D, per the design doc: a shot counts as camera-moved only when
#: translation is both fast enough AND trustworthy enough, sustained across
#: most of the shot. All three numbers are load-bearing and were chosen in
#: the design, not derived here.
MIN_PAN_SPEED_PX = 1.0
MIN_SHOT_COVERAGE = 0.6
MIN_PEAK_RATIO = 3.0

#: Radius (px, in the correlation surface) excluded around the primary peak
#: when hunting for the runner-up. Must be >0 so the runner-up isn't just the
#: immediate neighbour of a sub-pixel peak — those are naturally close to the
#: peak's own height and would make every honest peak look "unconfident".
_EXCLUSION_RADIUS = 2

#: Floor for the regularised division in `translation()`, as a fraction of
#: the cross-power spectrum's own peak magnitude (see there for why this
#: scales with signal strength rather than being an absolute constant).
_REGULARISATION_FRACTION = 1e-6


def _parabolic_offset(left: float, centre: float, right: float) -> float:
    """Sub-pixel offset of a peak from a 3-point parabolic fit.

    Standard closed form: fit a parabola through (-1, left), (0, centre),
    (1, right) and solve for its vertex. Guarded against a flat or inverted
    triple (denominator ~0, e.g. a pair with no usable peak at all) by
    returning no offset rather than dividing towards infinity.
    """
    denom = left - 2.0 * centre + right
    if abs(denom) < 1e-12:
        return 0.0
    # Clip to +-1: a fit landing outside the sampled interval means the true
    # peak isn't well-approximated by this parabola, and the caller's integer
    # location is a better estimate than an extrapolated one.
    return float(np.clip(0.5 * (left - right) / denom, -1.0, 1.0))


def _secondary_peak(surface: np.ndarray, peak: tuple[int, int], radius: int) -> float:
    """Highest value in ``surface`` outside a ``radius``-px box around ``peak``.

    The exclusion box wraps (the correlation surface is periodic — it came
    out of an FFT), matching how the peak location itself is interpreted.
    """
    height, width = surface.shape
    py, px = peak
    ys = [(py + dy) % height for dy in range(-radius, radius + 1)]
    xs = [(px + dx) % width for dx in range(-radius, radius + 1)]
    mask = np.ones_like(surface, dtype=bool)
    mask[np.ix_(ys, xs)] = False
    if not mask.any():
        # Degenerate only on a surface smaller than the exclusion box itself.
        return float(surface.max())
    return float(surface[mask].max())


def translation(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Recover the (dx, dy) translation that best explains ``b`` as a shifted
    version of ``a``, plus a confidence figure. ``a`` and ``b`` are 2-D luma
    arrays of identical shape (any real dtype — cast to float internally).

    Returns ``(dx, dy, peak_ratio)``:

    * ``dx``/``dy`` — sub-pixel translation, in pixels, positive meaning
      content in ``b`` sits to the right of / below where it was in ``a``.
    * ``peak_ratio`` — the correlation peak against the next-highest point on
      the surface (or the surface mean, whichever is larger, so a peak that
      merely beats one noisy neighbour isn't mistaken for a confident
      answer). Comfortably above 1 for a real, unambiguous shift; near 1 for
      a featureless or noise-dominated pair where no shift is actually
      determinable — callers use this to distrust a fast-looking but
      unreliable estimate rather than trust it outright.
    """
    if a.shape != b.shape:
        raise ValueError(f"translation() needs matching shapes, got {a.shape} vs {b.shape}")
    if a.ndim != 2:
        raise ValueError(f"translation() needs 2-D luma arrays, got ndim={a.ndim}")

    height, width = a.shape
    fa = a.astype(np.float64)
    fb = b.astype(np.float64)

    # A Hann window before the FFT: a real (non-cyclic) frame's hard
    # rectangular edge otherwise injects broadband spectral leakage that
    # phase correlation reads as spurious high-frequency structure, burying
    # the true peak under it.
    window = np.outer(np.hanning(height), np.hanning(width))
    fa = fa * window
    fb = fb * window

    fft_a = np.fft.fft2(fa)
    fft_b = np.fft.fft2(fb)
    # b(x) = a(x - shift)  =>  FFT(b) = FFT(a) * exp(-i*2*pi*k*shift/N), so
    # FFT(b) * conj(FFT(a)) isolates that phase term with the sign that puts
    # the recovered peak at +shift (verified against a known numpy roll —
    # the other operand order recovers -shift instead).
    cross = fft_b * np.conj(fft_a)
    magnitude = np.abs(cross)
    # Regularised, not a hard floor at zero: dividing by near-zero magnitude
    # at bins with no real energy (a flat or nearly flat pair) would AMPLIFY
    # float noise into a full-strength false peak — precisely the
    # "confident wrong answer" this function must not produce. The floor
    # scales with the spectrum's own peak so it adapts to signal strength
    # rather than fighting an arbitrary absolute constant.
    floor = max(float(magnitude.max()), 1e-12) * _REGULARISATION_FRACTION
    normalised = cross / (magnitude + floor)
    surface = np.fft.ifft2(normalised).real

    peak_index = np.unravel_index(int(np.argmax(surface)), surface.shape)
    py, px = peak_index
    peak_value = float(surface[py, px])

    dy_offset = _parabolic_offset(
        surface[(py - 1) % height, px], peak_value, surface[(py + 1) % height, px]
    )
    dx_offset = _parabolic_offset(
        surface[py, (px - 1) % width], peak_value, surface[py, (px + 1) % width]
    )

    dy = py + dy_offset
    dx = px + dx_offset
    # The surface is periodic: a location past half the frame is a smaller
    # shift in the opposite direction wrapping around.
    if dy > height / 2:
        dy -= height
    if dx > width / 2:
        dx -= width

    secondary = _secondary_peak(surface, peak_index, _EXCLUSION_RADIUS)
    denominator = max(secondary, float(surface.mean()), 1e-6)
    peak_ratio = peak_value / denominator

    return float(dx), float(dy), float(peak_ratio)


@dataclass(frozen=True)
class TestDVerdict:
    """Did the camera move enough, and reliably enough, that the truth behind
    a static overlay was actually visible at some point in the shot?

    Deliberately its own small, dependency-free type (no frame data, no numpy
    arrays) so `erase/router.py`'s `plan()` can take just this as a parameter
    without needing to know how it was computed.
    """

    camera_moved: bool
    #: Share of consecutive-frame pairs clearing BOTH bars below. A pair that
    #: moves fast but scores a low peak_ratio does not count — an unreliable
    #: estimate is not evidence of a real pan, however large the number.
    coverage: float
    #: Diagnostics only — not part of the pass/fail test, but what a human
    #: (or erase.json) would want printed alongside the verdict.
    mean_speed_px: float
    mean_peak_ratio: float
    reason: str


@dataclass(frozen=True)
class ShotPath:
    """Cumulative global translation across a shot's sampled proxy frames."""

    #: Cumulative (dx, dy) from the first frame; ``positions[0] == (0.0, 0.0)``.
    positions: list[tuple[float, float]]
    #: Per consecutive-pair peak_ratio, ``len(peak_ratios) == len(positions) - 1``.
    peak_ratios: list[float]
    verdict: TestDVerdict


def shot_path(frames: list[np.ndarray]) -> ShotPath:
    """Register every consecutive pair of ``frames`` (2-D luma, one shot's
    worth of proxies, in order) and return the cumulative path plus the
    test-D verdict.

    Consecutive pairs, not frame-0-vs-frame-N: a fast pan can leave the first
    and last frame of a long shot with almost no overlapping content to
    correlate at all, while adjacent frames always share nearly everything.
    """
    if len(frames) < 2:
        verdict = TestDVerdict(
            camera_moved=False, coverage=0.0, mean_speed_px=0.0, mean_peak_ratio=0.0,
            reason="fewer than 2 frames — no motion to measure",
        )
        return ShotPath(positions=[(0.0, 0.0)], peak_ratios=[], verdict=verdict)

    positions: list[tuple[float, float]] = [(0.0, 0.0)]
    peak_ratios: list[float] = []
    speeds: list[float] = []
    cx, cy = 0.0, 0.0
    # Deliberately strict=False: pairing N frames into N-1 consecutive pairs
    # means the two sides of this zip are always one apart by design, not a
    # length bug.
    for previous, current in zip(frames, frames[1:], strict=False):
        dx, dy, ratio = translation(previous, current)
        cx, cy = cx + dx, cy + dy
        positions.append((cx, cy))
        peak_ratios.append(ratio)
        speeds.append(float(np.hypot(dx, dy)))

    qualifies = [
        speed >= MIN_PAN_SPEED_PX and ratio >= MIN_PEAK_RATIO
        for speed, ratio in zip(speeds, peak_ratios, strict=True)
    ]
    coverage = sum(qualifies) / len(qualifies)
    mean_speed = statistics.mean(speeds)
    mean_ratio = statistics.mean(peak_ratios)
    camera_moved = coverage >= MIN_SHOT_COVERAGE

    reason = (
        f"{coverage:.0%} of {len(qualifies)} pair(s) sustained >= {MIN_PAN_SPEED_PX:g} "
        f"px/frame at peak_ratio >= {MIN_PEAK_RATIO:g} (need >= {MIN_SHOT_COVERAGE:.0%}); "
        f"mean speed {mean_speed:.2f} px/frame, mean peak_ratio {mean_ratio:.2f}"
    )
    logger.info("shot_path: camera_moved=%s — %s", camera_moved, reason)

    verdict = TestDVerdict(
        camera_moved=camera_moved, coverage=coverage, mean_speed_px=mean_speed,
        mean_peak_ratio=mean_ratio, reason=reason,
    )
    return ShotPath(positions=positions, peak_ratios=peak_ratios, verdict=verdict)
