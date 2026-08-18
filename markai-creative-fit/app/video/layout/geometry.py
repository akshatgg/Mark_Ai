"""Pure geometry for reshaping a video onto a panel — no I/O, no ffmpeg, no PIL.

Everything here is arithmetic and comparisons on plain numbers and `Box`
tuples: window/aspect math, safe-area boxes, containment tests for the
reframe gate (Task 6), and `min_cap_px`, the OOH legibility rule that gives
`layout/typography.py`'s `ROLE_FLOOR_VIDEO` its independent sanity check.
Kept pure and side-effect-free deliberately — `reframe.py`'s gate (Task 6)
runs this arithmetic against every sampled frame of every shot before a
single pixel moves, and a function that touches a file or a subprocess would
make that walk slow and untestable in isolation.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Boxes and windows
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Box:
    """A rectangle in px, ``(x0, y0)`` top-left inclusive, ``(x1, y1)``
    bottom-right exclusive — the same convention `PIL.Image.crop` uses, since
    every box here eventually becomes a crop or a paste target."""

    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def aspect(width: float, height: float) -> float:
    return width / height


def aspect_shift(src_w: float, src_h: float, dst_w: float, dst_h: float) -> float:
    """How far the target shape is from the source, as a factor >= 1.0.

    Same arithmetic as the image path's `app.layout.rules.aspect_shift` —
    Task 6/7's reframe and compose gates need this exact comparison and
    `app/layout/` is frozen, so it is duplicated here rather than imported.
    """
    ratio = (dst_w / dst_h) / (src_w / src_h)
    return max(ratio, 1 / ratio)


def max_window(src_w: float, src_h: float, target_w: float, target_h: float) -> Box:
    """The largest ``target_w``x``target_h``-aspect window that fits inside a
    ``src_w``x``src_h`` frame, centred.

    This is "one fixed window of the target aspect" from Task 6's static
    case, and the search Task 7's compose stage walks (shrinking the target
    aspect until this window passes the gate) starts here.
    """
    target_aspect = target_w / target_h
    if target_aspect >= src_w / src_h:
        # Target is at least as wide, relative to its height, as the source —
        # the source's own width is the binding constraint.
        w = src_w
        h = w / target_aspect
    else:
        h = src_h
        w = h * target_aspect
    x0 = (src_w - w) / 2
    y0 = (src_h - h) / 2
    return Box(x0, y0, x0 + w, y0 + h)


# ---------------------------------------------------------------------------
# Safe areas
# ---------------------------------------------------------------------------
#: Burned-in text — already part of the source pixels, composed by whoever
#: made the original ad. A broadcast-style 5% keeps it clear of a panel's
#: bezel/overscan without re-margining a composition we did not make.
SAFE_AREA_BURNED_IN = 0.05

#: Text WE place (compose.py's copy, hold cards). Held to the fuller 10%
#: broadcast safe-area convention because it is OUR layout decision, not a
#: correction of someone else's: applying 10% to the advertiser's own
#: composition would just re-margin their design for no legibility gain,
#: which is exactly why the two constants are different rather than one.
SAFE_AREA_PLACED = 0.10


def safe_area(width: float, height: float, margin_fraction: float) -> Box:
    """The box inside ``width``x``height`` after an all-sides margin of
    ``margin_fraction`` of the SHORTER edge.

    The shorter edge, not width or height independently — broadcast safe-area
    convention, and the only choice that does not over-margin a portrait
    panel's top/bottom or under-margin a landscape one's left/right.
    """
    margin = margin_fraction * min(width, height)
    return Box(margin, margin, width - margin, height - margin)


# ---------------------------------------------------------------------------
# Containment — the reframe gate's primitive
# ---------------------------------------------------------------------------


def contains(window: Box, box: Box) -> bool:
    """True when ``box`` sits fully inside ``window``."""
    return (
        box.x0 >= window.x0
        and box.y0 >= window.y0
        and box.x1 <= window.x1
        and box.y1 <= window.y1
    )


def shortfall_px(window: Box, box: Box) -> float:
    """Px by which ``box`` fails to fit inside ``window``; 0 when it fits.

    The MAX over the four edges' overrun, not the sum: a box overrunning the
    window's left edge by 5px and its right edge by 3px cannot be fixed by
    translating the window at all (it would have to grow), so the single
    number that means something here is "how far short is the worst edge",
    which is what Task 6's gate reports back as a named violation.
    """
    left = max(0.0, window.x0 - box.x0)
    top = max(0.0, window.y0 - box.y0)
    right = max(0.0, box.x1 - window.x1)
    bottom = max(0.0, box.y1 - window.y1)
    return max(left, top, right, bottom)


# ---------------------------------------------------------------------------
# min_cap_px — the OOH legibility rule
# ---------------------------------------------------------------------------
#: 1 inch of cap height per 10 feet of viewing distance, expressed in metric:
#: 8.33mm of cap height per metre of viewing distance. The standard OOH/DOOH
#: rule of thumb for legible signage type.
CAP_MM_PER_METRE = 8.33

#: DOOH panel spec sheets quote a diagonal and a 16:9 physical aspect, never
#: a physical height directly — this is the assumption `min_cap_px` uses to
#: recover panel height in mm from `diagonal_in`. A panel genuinely built to
#: a different physical aspect would need its own height passed in some other
#: way; 16:9 covers every panel this codebase currently targets (see
#: `encode.py`'s level table).
_PANEL_ASPECT_W, _PANEL_ASPECT_H = 16, 9
_MM_PER_INCH = 25.4

DEFAULT_VIEWING_DISTANCE_M = 3.5  # a cafe — this codebase's stated venue

#: Clamp bounds, as a fraction of panel height. Below 3% the arithmetic can
#: produce a size too small to read as a legibility target regardless of what
#: the distance/diagonal inputs say (e.g. a very large panel at a very short
#: assumed distance); above 7.5% a single line would dominate the frame no
#: matter what the rule computes, which stops being a legibility aid and
#: starts being a layout problem.
MIN_CAP_FRACTION = 0.030
MAX_CAP_FRACTION = 0.075


def min_cap_px(
    panel_height_px: int,
    diagonal_in: float,
    viewing_distance_m: float = DEFAULT_VIEWING_DISTANCE_M,
) -> int:
    """Minimum cap height in px for text to read at ``viewing_distance_m`` on
    a ``diagonal_in`` panel rendered at ``panel_height_px``.

    This is a CAP height, not an EM size — `typography.CAP_RATIO` converts
    between the two elsewhere. Feeding this number straight into
    `ImageFont.truetype(size=...)` would under-size the rendered glyph by
    about 30%, the same trap the image path's `rules.py` warns about for its
    own `ROLE_HEIGHT`/`ROLE_FLOOR` tables.

    The physical panel height in mm is derived from the diagonal assuming a
    16:9 aspect (see `_PANEL_ASPECT_W/H` above); the required physical cap
    height in mm is `CAP_MM_PER_METRE * viewing_distance_m`; that requirement
    converted to a FRACTION of panel height is independent of
    `panel_height_px` (a physical ratio does not care how many pixels
    represent it) and is only then multiplied back into px at whatever
    resolution was asked for and clamped to `[MIN_CAP_FRACTION,
    MAX_CAP_FRACTION]`.
    """
    diagonal_mm = diagonal_in * _MM_PER_INCH
    aspect_hypotenuse = (_PANEL_ASPECT_W**2 + _PANEL_ASPECT_H**2) ** 0.5
    panel_height_mm = diagonal_mm * (_PANEL_ASPECT_H / aspect_hypotenuse)

    required_mm = CAP_MM_PER_METRE * viewing_distance_m
    fraction = required_mm / panel_height_mm
    fraction = min(MAX_CAP_FRACTION, max(MIN_CAP_FRACTION, fraction))
    return round(fraction * panel_height_px)
