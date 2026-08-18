"""The designed-cover branch: an opaque, static band at the sampled local
background colour.

Not a failure mode. A lower-third bar is a legitimate ad idiom; a flickering
hallucinated background is not. `scrim` is chosen (see `erase/router.py`)
whenever the truth behind an overlay cannot be recovered exactly — either the
camera never moved (nothing else was ever visible there) or test D could not
confirm it did — so inventing pixels would be a guess, and a flat, honest
band reads as intentional where a wrong guess would not. It is static by
construction: one colour, sampled once, painted into every frame of the shot
identically, so there is nothing for a flicker check to catch.

Geometry is deliberately just the region's own mask box (see `plate.py`'s
`_mask_geometry`), never the whole frame or even the LaMa-style 128px context
margin — a scrim covers what needed covering and nothing more.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

#: How far outside the mask box the colour sample ring extends, in native
#: pixels. Wide enough to clear the box's own dilation/feather halo (so the
#: sample isn't contaminated by the erased edge) without wandering into
#: unrelated picture content.
RING_PX = 16


def sample_background_color(
    frame: np.ndarray, mask_box: tuple[int, int, int, int], ring_px: int = RING_PX
) -> tuple[int, int, int]:
    """Median RGB colour of a ring just outside ``mask_box``, clamped to
    ``frame``.

    Median, not mean, for the same reason `register.py`/`motion.py` use it
    elsewhere in this package: a handful of outlier pixels (a bit of the
    overlay's own anti-aliased edge, a stray highlight) drag a mean off the
    true local background while the median sits still.
    """
    height, width = frame.shape[:2]
    y0, x0, y1, x1 = mask_box
    ry0, rx0 = max(0, y0 - ring_px), max(0, x0 - ring_px)
    ry1, rx1 = min(height, y1 + ring_px), min(width, x1 + ring_px)

    window = frame[ry0:ry1, rx0:rx1]
    # Exclude the mask box itself from the sample — that is the overlay
    # (or the erased hole), not the background it sits on.
    yy, xx = np.mgrid[ry0:ry1, rx0:rx1]
    inside_mask = (yy >= y0) & (yy < y1) & (xx >= x0) & (xx < x1)
    outside = window[~inside_mask]

    if outside.size == 0:
        # Degenerate only when the mask box already fills the whole sample
        # window (an edge-hugging box with no room for a ring) — fall back to
        # whatever the window has rather than raising on a legitimate corner
        # case.
        outside = window.reshape(-1, window.shape[-1])
        logger.warning(
            "scrim: mask box %s left no ring to sample outside a %dpx margin; "
            "falling back to the window itself", mask_box, ring_px,
        )

    colour = np.median(outside.reshape(-1, 3).astype(np.float32), axis=0)
    return int(round(colour[0])), int(round(colour[1])), int(round(colour[2]))


def render(mask_box: tuple[int, int, int, int], colour: tuple[int, int, int]) -> np.ndarray:
    """A solid ``colour`` patch sized exactly to ``mask_box`` — the flat,
    static band `plate.py` composites into every frame of the shot."""
    y0, x0, y1, x1 = mask_box
    height, width = y1 - y0, x1 - x0
    patch = np.empty((height, width, 3), dtype=np.uint8)
    patch[:, :] = colour
    return patch
