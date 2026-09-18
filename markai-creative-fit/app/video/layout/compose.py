"""The rebuild-around-the-video planner — the tier this product exists for.

`reframe.py` crops the SOURCE down to the target's own shape; that only works
when the target is close enough to the source that a crop still contains
everything required, and Task 6's own arithmetic proves a 1920x1080 master can
NEVER reframe onto a 1080x2400 (or 1080x1920) panel — the upscale ceiling is
exceeded before a single box is even examined. Compose is the tier that
actually gets a landscape ad onto a portrait café panel: instead of cropping
the source to fit the panel, it places the (down-scaled, never up-scaled)
source into a smaller STAGE box on a flat `background_hex` CARD the size of
the panel, and draws fresh copy — headline, subhead, body, contact, legal —
in the header/footer space around it.

**Stage sizing calls `reframe.plan()` as a subroutine, but inverted.**
`reframe.plan()`'s own gate requires every burned-in TEXT box and the LOGO to
stay inside its crop window — losing text to a crop is a defect on that tier,
because the crop IS the whole picture shown. Compose's crop is different: the
cropped-out region is never invisible, it just never appears IN THE VIDEO,
because the message that used to live there gets redrawn (bigger, legible)
in the surrounding card instead. So a compose crop that excludes a headline
costs nothing — no erase, no re-typeset risk, the crop simply never shows it.
The one thing this video path genuinely cannot rebuild is a LOGO (there is no
cutout/extraction tool on the video side — that machinery lives only in the
frozen image path) or the featured PRODUCT subject (same reason: no video-side
inset mechanism). So compose reuses `reframe.plan()`'s own containment gate
completely unmodified, but calls it against a blueprint filtered down to just
`logo`/`product` regions (`_required_inside_stage`) — everything else is
explicitly NOT required to survive the crop, which is the "inversion" the
module keeps referring to: reframe protects text; compose spends text to buy
height.

**Compose has no upscale problem by construction.** The stage is placed at
`scale = panel_w / window.width <= 1.0` always (`MAX_STAGE_SCALE`) — the video
is shown smaller than native, never larger, which is the entire reason this
tier exists where reframe cannot. Because of that, `reframe.plan()` is called
here with `target_h` pinned to the SOURCE's own height for every candidate
aspect, which makes its `effective_upscale` check trivially 1.0 always (see
`_reframe_at_aspect`) — it is reused purely for its containment gate, never
its upscale ceiling.

**The search.** `geometry.max_window` keeps the window's height pinned at the
source's own height for every aspect at or below the source's own aspect (see
its own docstring), so narrowing the stage aspect only ever shrinks window
WIDTH, symmetrically about the source's horizontal centre. Shrinking a window
can only ever make a fixed box HARDER to contain, never easier — feasibility
is therefore monotonic in aspect, crossing at most once, and a bisection
finds that crossing exactly rather than needing a scan (`_search_stage`).
Narrower aspect -> smaller `window.width` -> larger `scale = panel_w /
window.width` -> taller `stage.box` on the panel: "tallest" (objective 1) is
therefore "narrowest feasible", found by the bisection's own convergence
point, no separate optimisation needed for it. Objective 2 ("excluding the
most rescued-text area") only has real candidates to choose between on the
rare occasion more than one aspect ties for tallest; `_search_stage`
documents where that can happen and why it usually can't.

**Canvas.** A flat `background_hex` card whenever the blueprint has one — an
EXACT, constant background is the only thing that makes `readable_on_video`'s
luma-delta guarantee a certainty rather than a hope (see `typography.py`).
When `background_hex` is missing, `render_state` falls back to a blurred
STILL frame the caller supplies (never decoded here — Task 7 is "no ffmpeg";
see `render_state`'s docstring) and never a moving blur, because one contrast
measurement cannot certify 600 frames of luminance under a headline.

**Which copy gets rescued.** A region's cap height AS DRAWN in the original
master is assumed to follow this codebase's own nominal scale
(`typography.ROLE_HEIGHT[role] * src_h` — there is no per-region measured cap
height on `TextRegion`, so the nominal convention is the only consistent
proxy available). Scaled by the stage's own placement `scale`, that is
compared against `geometry.min_cap_px` — the OOH legibility floor, not
`ROLE_FLOOR_VIDEO` (that constant governs how small OUR OWN drawn type may
shrink under budget pressure; this is a different question, "is the ORIGINAL
still legible at this placement"). A region that fails the floor OR falls
outside the stage window (either way, it isn't going to be a legible part of
what's shown) gets RESCUED: redrawn fresh, at a legible size, in the
header/footer bands. A rescued region that is still (partially or fully)
VISIBLE inside the stage window also needs its original erased first — see
`ComposePlan.plate_request` — a rescued region entirely OUTSIDE the window
needs nothing erased at all, because the crop already removed it from what
plays.

**Erase coupling as an interface.** `plan()` never touches a plate, a frame,
or ffmpeg — it only emits `plate_request: list[(shot_index, erase_box)]`, the
regions Task 4's erase tier would need to have cleaned for this render to be
correct. `apply_plate_availability` is the seam: called with
`plate_ready_shots=None` (the default), it assumes every shot's plate is
ready — which is what makes this whole module testable end to end before
`erase/plate.py` exists or before a caller has actually run it, by standing
the raw SOURCE in for the not-yet-built plate. Called with a real set, any
region whose shot is missing degrades honestly (left burned in, reported),
never crashes and never silently ships a doubled caption.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from typing import Literal

from PIL import Image, ImageDraw, ImageFilter

from app.video.layout import geometry, reframe, typography
from app.video.layout.geometry import Box
from app.video.schemas import Shot, VideoBlueprint

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

#: Reference panel `typography.py`'s own module docstring cites when it
#: sanity-checks `ROLE_FLOOR_VIDEO` against `geometry.min_cap_px` ("...the
#: ~4.5%-of-panel-height target...independently derives for a 55" panel at
#: 3.5m"). A caller that doesn't know its physical panel lands on the same
#: number that check was calibrated against, rather than an arbitrary one.
DEFAULT_DIAGONAL_IN = 55.0

#: The OOH glance-window rule (Task 7's own framing): a copy state shorter
#: than this reads as a flash, not a message, so it is merged into a
#: neighbour rather than shown on its own.
MIN_STATE_SECONDS = 2.0

#: The video is placed smaller than native, never larger — the whole reason
#: this tier exists where reframe cannot (see module docstring). Exactly
#: 1.0, not "close to" 1.0: any upscale here is a correctness bug, not a
#: rounding nicety, so nothing is ever allowed to round up past it.
MAX_STAGE_SCALE = 1.0

#: Smallest share of PANEL HEIGHT left over for the copy bands, and ONLY
#: enforced when the stage would otherwise fill the panel edge-to-edge and
#: leave the rescued copy nowhere to go but on top of the footage.
#:
#: This is deliberately NOT a ceiling on the stage. The video is the ad and
#: gets every pixel it can; the bands take what is left. 12% of a 1080-tall
#: panel is ~130px, enough for one headline line at the video floor.
STAGE_MIN_BAND_FRAC = 0.12

#: Bisection precision on the stage-aspect search, and its iteration cap.
#: `_ASPECT_EPSILON` is far tighter than any pixel this search could resolve
#: to at realistic source widths; `_MAX_BISECT_STEPS` is a hard safety cap
#: (convergence needs `log2(range / epsilon)` steps, comfortably under it —
#: this bounds worst case, it is not the expected step count).
_ASPECT_EPSILON = 1e-4
_MAX_BISECT_STEPS = 40

#: These two roles are the only ones this video path cannot redraw from
#: scratch: neither a trademark nor the featured product has a video-side
#: cutout/inset tool (that machinery is image-path-only and frozen), so the
#: only way to keep either on screen at all is to keep it INSIDE whatever
#: crop the stage shows — the one place this module still protects a region
#: the way `reframe.py` protects all of them.
_REQUIRED_INSIDE_STAGE_ROLES = frozenset({"logo", "product"})

#: Everything else is a candidate for rescue — copy this module can and does
#: redraw. Grouped into two on-panel groups purely for a legible, predictable
#: stacking order: `top_bottom` (portrait) renders them as two separate bands,
#: header above the stage, footer below; `left_right` (landscape) collapses
#: both groups into ONE column via `_ROLE_ORDER` (see `render_state`) rather
#: than splitting them either side of the stage — a landscape panel's
#: leftover space is a single edge, not two, so a single reading-order column
#: is what "header first, footer second" actually looks like there. `badge`
#: lands in the footer group as a pragmatic simplification — like `product`,
#: a badge is normally a text-in-a-shape cutout on the image path, and this
#: video path has no cutout tool for it either, so a rescued badge is redrawn
#: as PLAIN text (its pill/circle is lost). That is a known, reported
#: degrade, not a silent one (see `_rescue_decisions`'s `reason` field).
_HEADER_ROLES = ("headline", "subhead")
_FOOTER_ROLES = ("body", "contact", "legal", "badge")
_ROLE_ORDER: dict[str, int] = {
    role: index for index, role in enumerate((*_HEADER_ROLES, *_FOOTER_ROLES))
}
_FALLBACK_ROLE = "body"  # mirrors typography.py's own `_DEFAULT_ROLE` value

#: Extra vertical gap between two DIFFERENT rescued items stacked in the same
#: band, as a fraction of the second item's own line height — enough to read
#: as two blocks, not one run-on paragraph.
_ITEM_GAP_FRACTION = 0.35

_DEFAULT_TEXT_COLOUR = (255, 255, 255)
_DEFAULT_BACKGROUND_COLOUR = (17, 17, 17)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

#: Which axis the rescued copy stacks along, decided once per target by
#: `_build_stage` from where the panel's leftover space (panel minus stage)
#: actually is — never re-derived downstream, so `render_state` (the pixels)
#: and anything reporting on the plan always describe the same layout.
#: "top_bottom": copy above/below the stage, the historical portrait layout.
#: "left_right": copy in columns beside the stage — the shape a landscape or
#: ultra-wide panel puts a squarish/tall stage into, where the leftover
#: space is mostly WIDTH, not height (see module's `_build_stage`).
BandOrientation = Literal["top_bottom", "left_right"]


@dataclass(frozen=True)
class Stage:
    """Where the (down-scaled) video sits on the panel.

    `window` is the crop taken from the SOURCE, in native px — the SAME size
    for every shot (`geometry.max_window` is aspect-only; see module
    docstring), though `crop` may still PAN across the source within that
    fixed size per shot, exactly like `reframe.ShotWindow`. `box` is the
    fixed on-panel placement that window is scaled into — fixed because the
    header/footer bands drawn around it (`render_state`) are laid out once,
    not per shot.
    """

    window: Box
    box: Box
    scale: float
    aspect: float
    crop: reframe.ReframePlan
    #: Where the copy goes relative to `box` — see `BandOrientation` above.
    orientation: BandOrientation = "top_bottom"
    #: Which edge the SINGLE rescued-copy column sits on when `orientation ==
    #: "left_right"` — `box` itself is pushed to the OPPOSITE edge (see
    #: `_choose_copy_side`). Always None for `top_bottom`, where copy runs
    #: above/below the (horizontally centred) stage rather than beside it.
    copy_side: Literal["left", "right"] | None = None


@dataclass(frozen=True)
class RescueDecision:
    """One non-logo, non-product region's fate under compose.

    `native_box` is `TextRegion.erase_box` denormalised to SOURCE native px —
    the geometry `plate_request` and the stage-window overlap test both need,
    kept alongside the pydantic region rather than re-derived by every
    caller.
    """

    shot_index: int
    role: str
    text: str | None
    color_hex: str | None
    font_family: str | None
    native_box: tuple[int, int, int, int]  # y0, x0, y1, x1
    first_seconds: float
    last_seconds: float
    #: Cap height as nominally drawn on the SOURCE (`ROLE_HEIGHT * src_h`).
    original_cap_px: float
    #: `original_cap_px * stage.scale` — what that same type would measure
    #: if left burned in and simply shown smaller inside the stage.
    placed_cap_px: float
    #: `geometry.min_cap_px` at the PANEL's own height — the OOH legibility
    #: floor this region is judged against (see module docstring).
    floor_px: float
    #: Fully outside `stage.window` — the crop already removes it from what
    #: plays, so no erase is needed even though it IS being rescued.
    cropped_out: bool
    #: Below `floor_px`, or `cropped_out` — either way, redrawn fresh.
    rescued: bool
    #: `rescued AND not cropped_out` — the burned-in original is still
    #: visible inside the shown crop, so it must be erased before the fresh
    #: copy is drawn, or the two would visibly double up.
    needs_erase: bool
    #: `role_floor_stem_px` raised for this role at the panel's own height —
    #: the video analogue of the image path's `SACRIFICE_ORDER`. Dropped
    #: means: not drawn at all, not erased, not counted into any copy state.
    dropped: bool = False
    reason: str = ""


@dataclass(frozen=True)
class CopyState:
    """One interval of the ad during which the set of VISIBLE rescued copy
    is constant. `active` indexes into `ComposePlan.decisions` — kept as
    indices rather than embedded `RescueDecision`s so `apply_plate_availability`
    can downgrade a decision without having to rebuild every state's payload,
    only prune indices that are no longer rescued.
    """

    start_seconds: float
    end_seconds: float
    active: tuple[int, ...] = ()

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds


@dataclass
class RenderedState:
    """One state's rendered overlay, plus what happened while drawing it —
    a colour swap, a band overflow. Not frozen: it is a return bundle from
    `render_state`, never re-planned or hashed."""

    image: Image.Image
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ComposePlan:
    """The whole target's compose decision: stage geometry, what gets
    rescued and why, the copy-state timeline, and what erase work the
    rescue depends on. Never renders a pixel itself — `render_state` does
    that, one call per `CopyState`.
    """

    target_w: int
    target_h: int
    src_w: int
    src_h: int
    stage: Stage
    decisions: list[RescueDecision] = field(default_factory=list)
    states: list[CopyState] = field(default_factory=list)
    #: (shot_index, native erase box y0,x0,y1,x1) for every region whose
    #: rescue needs its burned-in original erased first. See module
    #: docstring's "erase coupling" section.
    plate_request: list[tuple[int, tuple[int, int, int, int]]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    #: "hex" when `render_state` can paint the card from `background_hex`
    #: directly; "needs_fallback_frame" when the blueprint carried none and
    #: the caller must supply a still frame to blur (or accept the flat
    #: neutral default — see `render_state`).
    background_mode: str = "hex"
    #: Set by `apply_plate_availability` when so much rescue had to be
    #: downgraded (no plate for the shot) that compose can no longer make
    #: this ad legible on its own — an operator-facing signal to consider
    #: letterbox instead, never acted on automatically (Global Constraints:
    #: no automatic flicker/quality gate on publication).
    letterbox_recommended: bool = False


# ---------------------------------------------------------------------------
# Stage search
# ---------------------------------------------------------------------------


def _required_inside_stage(blueprint: VideoBlueprint) -> VideoBlueprint:
    """A copy of `blueprint` carrying only the regions the stage crop must
    never lose — see module docstring's "the inversion"."""
    kept = [r for r in blueprint.regions if r.role in _REQUIRED_INSIDE_STAGE_ROLES]
    return blueprint.model_copy(update={"regions": kept})


def _reframe_at_aspect(blueprint: VideoBlueprint, aspect: float) -> reframe.ReframePlan:
    """`reframe.plan()` at a candidate STAGE aspect, with `target_h` pinned
    to the source's own height so `effective_upscale` reads exactly 1.0 for
    every aspect this search ever tries (see module docstring) — this call
    exists purely to read `.feasible`, never its upscale verdict.
    """
    target_h = blueprint.height
    target_w = max(1, round(aspect * target_h))
    return reframe.plan(blueprint, target_w, target_h)


def _search_stage(
    blueprint: VideoBlueprint, panel_w: int, panel_h: int
) -> tuple[float, reframe.ReframePlan, list[str]]:
    """The narrowest (tallest-on-panel) stage aspect that both avoids an
    upscale and keeps every `logo`/`product` region inside the crop.

    Monotonic bisection (see module docstring) between `floor_aspect` (the
    narrowest aspect that still avoids upscaling the placed video) and
    `src_aspect` (the widest — the whole, uncropped source frame). Two
    degenerate cases are handled directly, without a search:

    - the full source frame ITSELF already fails the gate (a `logo`/
      `product` box already grazes the source's own edge, inside the safe
      margin) — no narrower crop can ever improve that (narrowing only ever
      moves the window's edges INWARD, closer to the box, never away from
      it), so the full frame is used anyway, as the best available answer,
      with an honest warning rather than a refusal.
    - the floor aspect is ALREADY feasible (no required region is anywhere
      near being cropped) — that is directly the tallest legal answer, no
      bisection needed to find it.

    Ties for "tallest" (objective 2's territory) can only happen when the
    bisection's own convergence tolerance (`_ASPECT_EPSILON`) straddles the
    true crossing point closely enough that two adjacent tested aspects both
    read as feasible at the same rounded on-panel height — a sub-pixel
    situation this module resolves by simply keeping the FIRST (narrowest)
    one the bisection lands on, which is already, by construction, at least
    as tall as any other feasible candidate up to that tolerance. A true,
    macroscopic tie (two aspects offering meaningfully different EXCLUDED
    rescued-text area at the identical on-panel height) does not occur here:
    on-panel height is a strictly monotonic function of aspect for a fixed
    `panel_w`, so distinct aspects only ever tie within floating-point noise.
    """
    src_w, src_h = blueprint.width, blueprint.height
    src_aspect = src_w / src_h
    warnings: list[str] = []

    # The aspect at which the window's own width already equals the panel's
    # — any narrower and placing it without upscaling is impossible.
    floor_aspect = panel_w / (src_h * MAX_STAGE_SCALE)
    if floor_aspect >= src_aspect:
        floor_aspect = src_aspect

    required = _required_inside_stage(blueprint)

    hi_aspect = src_aspect
    hi_plan = _reframe_at_aspect(required, hi_aspect)
    if not hi_plan.feasible:
        message = (
            "the full, uncropped source frame does not keep every "
            f"logo/product region inside its safe-area margin "
            f"({len(hi_plan.violations)} violation(s)); using it anyway as "
            "the best available stage — no narrower crop can improve a "
            "region already grazing the source's own edge"
        )
        warnings.append(message)
        logger.warning("compose stage search: %s", message)
        return hi_aspect, hi_plan, warnings

    if floor_aspect >= hi_aspect - _ASPECT_EPSILON:
        return hi_aspect, hi_plan, warnings

    lo_aspect = floor_aspect
    lo_plan = _reframe_at_aspect(required, lo_aspect)
    if lo_plan.feasible:
        return lo_aspect, lo_plan, warnings

    for _ in range(_MAX_BISECT_STEPS):
        if hi_aspect - lo_aspect < _ASPECT_EPSILON:
            break
        mid = (lo_aspect + hi_aspect) / 2
        mid_plan = _reframe_at_aspect(required, mid)
        if mid_plan.feasible:
            hi_aspect, hi_plan = mid, mid_plan
        else:
            lo_aspect = mid
    return hi_aspect, hi_plan, warnings


def _choose_copy_side(blueprint: VideoBlueprint) -> tuple[Literal["left", "right"], str]:
    """Which edge the SINGLE rescued-copy column lands on, for a `left_right`
    stage — the video (`Stage.box`) is pushed to the opposite edge by
    `_build_stage`, so this decides both at once.

    A cheap POSITION heuristic, not real gaze detection — `TextRegion` carries
    no facing-direction signal, only a box. The proxy used here is the
    `product` region's own horizontal centre in the source frame: a subject
    sitting right-of-centre reads better with the video anchored to that same
    edge (nothing crops the subject, it simply sits where it already was) and
    the copy on the side the subject faces away from — left, in that case.
    Measured on the real 1280x1280 creative this was built against: `product`
    is `[230, 480, 1000, 1000]` (ymin/xmin/ymax/xmax, /1000) — its x-centre is
    (480+1000)/2 = 740, well right of the 500 midpoint, matching the
    operator's own read of the creative ("student on the right, logo
    top-left") — so the video goes right, copy goes left.

    No `product` region (a pure card/flat-lay ad with no subject to face away
    from) falls back to copy-on-the-right. That is a DEFAULT, not a decision
    — the task spec is explicit that an inability to tell cheaply should
    default rather than guess — and is reported as such.
    """
    products = [r for r in blueprint.regions if r.role == "product"]
    if not products:
        return "right", "no product region in the blueprint; copy defaults to the right edge"

    # erase_box is [ymin, xmin, ymax, xmax], normalised 0-1000 — see
    # `_native_box`'s own docstring for the convention.
    centres = [(r.erase_box[1] + r.erase_box[3]) / 2 for r in products]
    centre = sum(centres) / len(centres)
    if centre > 500:
        return "left", (
            f"product region centres at x={centre:.0f}/1000, right of frame; "
            "copy placed on the left, the side the subject faces away from"
        )
    if centre < 500:
        return "right", (
            f"product region centres at x={centre:.0f}/1000, left of frame; "
            "copy placed on the right, the side the subject faces away from"
        )
    return "right", (
        f"product region centres at x={centre:.0f}/1000 (dead centre); copy defaults right"
    )


def _build_stage(
    blueprint: VideoBlueprint,
    panel_w: int,
    panel_h: int,
    aspect: float,
    crop: reframe.ReframePlan,
) -> Stage:
    src_w, src_h = blueprint.width, blueprint.height
    window = geometry.max_window(src_w, src_h, aspect, 1.0)
    # Three constraints, and the HEIGHT one is not optional.
    #
    # Width and MAX_STAGE_SCALE were the original pair, on the assumption that
    # `_search_stage` had already guaranteed the fit. It has not, on the
    # degrade path: when no crop can keep a logo/product region inside the
    # safe area, the search falls back to the full source frame regardless of
    # aspect. A 1280x1280 source then lands a 1280-tall stage on a 1080-tall
    # panel — measured on a real creative, where ffmpeg rejected it outright
    # ("Padded dimensions cannot be smaller than input dimensions") and the
    # whole render produced no file.
    #
    # STAGE_MAX_HEIGHT_FRAC also leaves the header/footer bands somewhere to
    # live: a stage occupying the entire panel has no room for the copy that
    # is the entire reason this tier exists.
    # THE VIDEO IS THE AD. Scale it to fill the panel in whichever dimension
    # binds first, capped at 1.0 so it is never upscaled — that "contain" fit
    # is the largest the footage can legitimately be.
    #
    # An earlier version also multiplied the height limit by a fraction
    # (0.55) to reserve room for the copy bands. That inverted the priority
    # and it showed: a 1280x1280 source on a 1920x1080 panel came out 594x594,
    # a small square floating in white space, with re-typeset copy around it.
    # The operator's verdict was blunt and correct — "you are not resizing the
    # video, you are just resizing the text."
    #
    # Copy now gets the margin the video leaves over, not the other way round.
    # Where that margin cannot hold a role at its floor, the role is dropped
    # (the video analogue of the image path's SACRIFICE_ORDER) rather than the
    # footage being shrunk to accommodate it.
    fill = min(MAX_STAGE_SCALE, panel_w / window.width, panel_h / window.height)

    # Where is the margin the video just left over? Measured at THIS natural
    # contain-fit, not after any guard shrink below — shrinking first would
    # beg the question of which axis needed the room. A 1920x1080 panel under
    # a 1:1 stage leaves ~840px of untouched WIDTH and 0px of height; a
    # 1080x2400 panel under the same stage leaves 0px of width and ~1320px of
    # height. The bigger of the two margins is where the copy actually has
    # room to live, so it decides the orientation — a plain landscape/
    # portrait guess would get this backwards for a stage whose OWN aspect
    # doesn't match the panel's (measured: a square source on a 4K landscape
    # panel leaves both axes with slack, but width by nearly 3x more).
    margin_w = panel_w - window.width * fill
    margin_h = panel_h - window.height * fill
    orientation: BandOrientation = "left_right" if margin_w > margin_h else "top_bottom"

    # Give the bands a slice back ONLY when there is genuinely nothing left in
    # EITHER axis — a stage that fills the panel edge-to-edge in BOTH width
    # and height leaves no margin at all, and every rescued line would have
    # to be drawn over the footage. Checking height alone here was the bug
    # the operator caught: on the real 1920x1080 render, the 840px of spare
    # WIDTH sitting right next to the stage was invisible to a height-only
    # check, so this guard fired anyway and shrank a clean 1080x1080 stage
    # down to 950x950 to manufacture vertical room nothing needed. Now the
    # guard only tightens the axis `orientation` above just pointed the copy
    # to, and only when NEITHER axis already has enough.
    if margin_w < panel_w * STAGE_MIN_BAND_FRAC and margin_h < panel_h * STAGE_MIN_BAND_FRAC:
        if orientation == "left_right":
            fill = min(fill, (panel_w * (1.0 - STAGE_MIN_BAND_FRAC)) / window.width)
        else:
            fill = min(fill, (panel_h * (1.0 - STAGE_MIN_BAND_FRAC)) / window.height)
    scale = fill
    box_w, box_h = window.width * scale, window.height * scale

    copy_side: Literal["left", "right"] | None = None
    if orientation == "left_right":
        # ONE wide column, not two narrow ones. Centring the stage (the
        # earlier behaviour) split the ~840px leftover width on the real
        # 1920x1080 creative into two ~420px margins — too narrow for either
        # the headline ("Make Your Own Way") or the CTA ("ADMISSIONS OPEN AY
        # 2026 - 27") to fit even at ROLE_FLOOR_VIDEO, so both were dropped
        # and only the small "www.cmr.edu.in" line survived. Giving the copy
        # the WHOLE leftover width instead — by pushing the stage to one
        # edge rather than centring it — measures against the same 840px
        # budget the headline now needs, not half of it, so nothing has to
        # be dropped for want of room (see `_choose_copy_side`).
        copy_side, side_reason = _choose_copy_side(blueprint)
        logger.info("compose stage: %s", side_reason)
        x0 = 0.0 if copy_side == "right" else panel_w - box_w
    else:
        x0 = (panel_w - box_w) / 2
    y0 = (panel_h - box_h) / 2
    box = Box(x0, y0, x0 + box_w, y0 + box_h)
    return Stage(window=window, box=box, scale=scale, aspect=aspect, crop=crop,
                 orientation=orientation, copy_side=copy_side)


# ---------------------------------------------------------------------------
# Rescue decisions
# ---------------------------------------------------------------------------


def _native_box(box_2d: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """[ymin,xmin,ymax,xmax] normalised 0-1000 -> native px, same convention
    `erase/plate.py::_quantise_box` uses (kept local rather than imported —
    that function lives in the erase package, which this planning-only
    module has no other reason to depend on)."""
    ymin, xmin, ymax, xmax = box_2d
    return (
        round(ymin / 1000 * height), round(xmin / 1000 * width),
        round(ymax / 1000 * height), round(xmax / 1000 * width),
    )


def _fully_outside(box: tuple[int, int, int, int], window: Box) -> bool:
    y0, x0, y1, x1 = box
    return x1 <= window.x0 or x0 >= window.x1 or y1 <= window.y0 or y0 >= window.y1


def _frame_offset(shot: Shot, t_seconds: float) -> float:
    """`t_seconds` as a frame offset from `shot`'s own first frame — mirrors
    `reframe._frame_of` exactly (kept local rather than reaching into that
    module's private helper; this and `_shot_window_box` below are a few
    lines of pure geometry each, and duplicating them keeps this module from
    depending on another module's underscore-prefixed internals)."""
    span = shot.duration_seconds
    if span <= 0:
        return 0.0
    frames = shot.end_frame - shot.start_frame
    return (t_seconds - shot.start_seconds) / span * frames


def _shot_window_box(
    shot_window: reframe.ShotWindow, shot: Shot, t_seconds: float, src_w: float, src_h: float
) -> Box:
    """`stage.window`'s ACTUAL native-px position for one shot at one
    instant — mirrors `reframe._window_at`. Load-bearing: `geometry.
    max_window` alone always centres the window on the source, but
    `reframe.plan()`'s per-shot solve is free to slide (or pan) it off
    centre to keep a `logo`/`product` region inside — measured directly
    while building this module: a corner logo pulled a 1080-wide window's
    centre from the geometric 960px to 1272.6px. Testing containment
    against the naive centred box would silently misjudge every region in a
    shot whose window actually moved.
    """
    frame = _frame_offset(shot, t_seconds)
    centre = shot_window.c0 + shot_window.v * frame
    if shot_window.pan_axis == "x":
        x0 = centre - shot_window.window_w / 2
        y0 = (src_h - shot_window.window_h) / 2
        return Box(x0, y0, x0 + shot_window.window_w, y0 + shot_window.window_h)
    y0 = centre - shot_window.window_h / 2
    x0 = (src_w - shot_window.window_w) / 2
    return Box(x0, y0, x0 + shot_window.window_w, y0 + shot_window.window_h)


def _region_cropped_out(
    native_box: tuple[int, int, int, int],
    shot: Shot | None,
    shot_window: reframe.ShotWindow | None,
    stage: Stage,
    first_seconds: float,
    last_seconds: float,
    src_w: float,
    src_h: float,
) -> bool:
    """True only when `native_box` is outside the stage window for EVERY
    instant it could be on screen — sampled at the start, middle and end of
    its own active span (cheap and exact for the STATIC case this codebase
    ships almost everywhere; for a PAN, three points is the same economy
    `reframe.py` itself applies rather than a continuous sweep). Erring
    toward "not cropped out" (needs erase) on any ambiguity is the safer
    failure: an unnecessary erase costs LaMa time, a skipped one ships a
    doubled caption.
    """
    if shot is None or shot_window is None:
        return _fully_outside(native_box, stage.window)
    lo = max(shot.start_seconds, first_seconds)
    hi = min(shot.end_seconds, last_seconds)
    times = sorted({lo, (lo + hi) / 2, hi})
    return all(
        _fully_outside(native_box, _shot_window_box(shot_window, shot, t, src_w, src_h))
        for t in times
    )


def _rescue_decisions(
    blueprint: VideoBlueprint, stage: Stage, floor_px: float, panel_h: int
) -> tuple[list[RescueDecision], list[str]]:
    src_w, src_h = blueprint.width, blueprint.height
    shots_by_index = {shot.index: shot for shot in blueprint.shots}
    windows_by_shot = {w.shot_index: w for w in stage.crop.windows}
    decisions: list[RescueDecision] = []
    warnings: list[str] = []

    for region in blueprint.regions:
        if region.role in _REQUIRED_INSIDE_STAGE_ROLES:
            continue  # stays IN the video — see module docstring

        native_box = _native_box(region.erase_box, src_w, src_h)
        nominal_fraction = typography.ROLE_HEIGHT.get(
            region.role, typography.ROLE_HEIGHT[_FALLBACK_ROLE]
        )
        original_cap_px = nominal_fraction * src_h
        placed_cap_px = original_cap_px * stage.scale
        cropped_out = _region_cropped_out(
            native_box, shots_by_index.get(region.shot_index),
            windows_by_shot.get(region.shot_index), stage,
            region.first_seconds, region.last_seconds, src_w, src_h,
        )
        below_floor = placed_cap_px < floor_px
        rescued = below_floor or cropped_out
        needs_erase = rescued and not cropped_out

        dropped = False
        reason = (
            f"{'cropped out of the stage window' if cropped_out else 'inside the stage window'}; "
            f"placed cap {placed_cap_px:.1f}px vs floor {floor_px:.1f}px -> "
            f"{'rescue' if rescued else 'leave burned in as-is'}"
        )
        if rescued:
            try:
                typography.role_floor_stem_px(region.role, panel_h)
            except ValueError as exc:
                dropped = True
                needs_erase = False
                reason = (
                    f"rescue needed but dropped — {exc}; the video analogue of the "
                    "image path's SACRIFICE_ORDER"
                )
                warnings.append(f"shot {region.shot_index} role {region.role!r}: {reason}")
                logger.info("compose: shot %d role %r dropped: %s",
                            region.shot_index, region.role, exc)

        decisions.append(RescueDecision(
            shot_index=region.shot_index, role=region.role, text=region.text,
            color_hex=region.color_hex, font_family=region.font_family,
            native_box=native_box, first_seconds=region.first_seconds,
            last_seconds=region.last_seconds, original_cap_px=original_cap_px,
            placed_cap_px=placed_cap_px, floor_px=floor_px, cropped_out=cropped_out,
            rescued=rescued, needs_erase=needs_erase, dropped=dropped, reason=reason,
        ))
    return decisions, warnings


# ---------------------------------------------------------------------------
# Copy-state timeline
# ---------------------------------------------------------------------------


def _breakpoints(shots: list[Shot], rescuable: list[tuple[int, RescueDecision]],
                  duration: float) -> list[float]:
    points = {0.0, duration}
    for shot in shots:
        points.add(min(duration, max(0.0, shot.start_seconds)))
        points.add(min(duration, max(0.0, shot.end_seconds)))
    for _, decision in rescuable:
        points.add(min(duration, max(0.0, decision.first_seconds)))
        points.add(min(duration, max(0.0, decision.last_seconds)))

    ordered = sorted(points)
    out: list[float] = []
    for point in ordered:
        if not out or point - out[-1] > 1e-6:
            out.append(point)
    return out


def _merge_short_states(states: list[CopyState], min_seconds: float) -> list[CopyState]:
    """Merge any state shorter than `min_seconds` into a neighbour, unioning
    the active set, until every remaining state clears the floor (or only
    one state is left). Each merge removes one state, so this always
    terminates; `guard` is a hard cap purely as a defensive backstop.
    """
    states = list(states)
    guard = 0
    while len(states) > 1 and guard < 10_000:
        guard += 1
        shortest = min(range(len(states)), key=lambda i: states[i].duration_seconds)
        if states[shortest].duration_seconds >= min_seconds:
            break
        if shortest == 0:
            neighbour = 1
        elif shortest == len(states) - 1:
            neighbour = shortest - 1
        else:
            left, right = states[shortest - 1], states[shortest + 1]
            neighbour = (
                shortest - 1 if left.duration_seconds <= right.duration_seconds else shortest + 1
            )
        lo, hi = min(shortest, neighbour), max(shortest, neighbour)
        merged = CopyState(
            start_seconds=states[lo].start_seconds,
            end_seconds=states[hi].end_seconds,
            active=tuple(sorted(set(states[lo].active) | set(states[hi].active))),
        )
        states[lo:hi + 1] = [merged]
    return states


def _build_states(
    decisions: list[RescueDecision], shots: list[Shot], duration: float
) -> list[CopyState]:
    """Every region's `first_seconds`/`last_seconds` plus every shot
    boundary collapsed into breakpoints; between breakpoints the visible
    rescued-copy set is constant by construction (see module docstring)."""
    if duration <= 0:
        return []

    rescuable = [(i, d) for i, d in enumerate(decisions) if d.rescued and not d.dropped]
    breakpoints = _breakpoints(shots, rescuable, duration)
    if len(breakpoints) < 2:
        return [CopyState(0.0, duration, ())]

    states: list[CopyState] = []
    for start, end in zip(breakpoints, breakpoints[1:], strict=False):
        mid = (start + end) / 2
        active = tuple(i for i, d in rescuable if d.first_seconds <= mid <= d.last_seconds)
        states.append(CopyState(start_seconds=start, end_seconds=end, active=active))

    return _merge_short_states(states, MIN_STATE_SECONDS)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def plan(
    blueprint: VideoBlueprint,
    target_w: int,
    target_h: int,
    diagonal_in: float = DEFAULT_DIAGONAL_IN,
    viewing_distance_m: float = geometry.DEFAULT_VIEWING_DISTANCE_M,
) -> ComposePlan:
    """The whole target's compose decision — stage geometry, per-region
    rescue verdicts, the copy-state timeline and the erase work the rescue
    depends on. Pure: no ffmpeg, no pixels, no I/O; never mutates
    `blueprint`.
    """
    aspect, crop, stage_warnings = _search_stage(blueprint, target_w, target_h)
    stage = _build_stage(blueprint, target_w, target_h, aspect, crop)

    floor_px = geometry.min_cap_px(target_h, diagonal_in, viewing_distance_m)
    decisions, rescue_warnings = _rescue_decisions(blueprint, stage, floor_px, target_h)

    states = _build_states(decisions, blueprint.shots, blueprint.duration_seconds)
    plate_request = [(d.shot_index, d.native_box) for d in decisions if d.needs_erase]

    background_mode = "hex" if blueprint.background_hex else "needs_fallback_frame"

    result = ComposePlan(
        target_w=target_w, target_h=target_h, src_w=blueprint.width, src_h=blueprint.height,
        stage=stage, decisions=decisions, states=states, plate_request=plate_request,
        warnings=[*stage_warnings, *rescue_warnings], background_mode=background_mode,
    )
    rescued_count = sum(1 for d in decisions if d.rescued and not d.dropped)
    logger.info(
        "compose %dx%d -> %dx%d: stage %.0fx%.0f px (%.1f%% of panel height, scale %.3fx), "
        "copy in %s, %d/%d region(s) rescued, %d copy state(s), %d plate request(s)",
        blueprint.width, blueprint.height, target_w, target_h,
        stage.box.width, stage.box.height, 100 * stage.box.height / target_h, stage.scale,
        stage.orientation, rescued_count, len(decisions), len(states), len(plate_request),
    )
    return result


def apply_plate_availability(
    plan_result: ComposePlan, plate_ready_shots: set[int] | None = None
) -> ComposePlan:
    """Degrade `plan_result` for shots that do NOT have a real erased plate.

    `plate_ready_shots=None` (the default) assumes every shot's plate is
    ready — the caller stands the raw SOURCE video in for a plate that may
    not exist yet, which is what makes this whole module exercisable end to
    end before `erase/plate.py` is wired (see module docstring). Passing an
    explicit set is the real post-erase path: any `needs_erase` region whose
    shot is missing from it is downgraded — NOT re-typeset (its burned-in
    original stays on screen, unmodified, unerased) — rather than shipping a
    fresh caption doubled over the original.
    """
    if plate_ready_shots is None:
        return plan_result

    decisions: list[RescueDecision] = []
    warnings = list(plan_result.warnings)
    needed = 0
    downgraded = 0
    for decision in plan_result.decisions:
        if decision.needs_erase:
            needed += 1
            if decision.shot_index not in plate_ready_shots:
                downgraded += 1
                message = (
                    f"shot {decision.shot_index} role {decision.role!r}: no erased "
                    "plate for this shot — leaving the burned-in original on screen "
                    "instead of re-typesetting over it (degrade, not a crash)"
                )
                warnings.append(message)
                logger.info("compose: %s", message)
                decision = replace(decision, rescued=False, needs_erase=False, reason=message)
        decisions.append(decision)

    still_active = {i for i, d in enumerate(decisions) if d.rescued and not d.dropped}
    states = [
        replace(state, active=tuple(i for i in state.active if i in still_active))
        for state in plan_result.states
    ]
    plate_request = [(d.shot_index, d.native_box) for d in decisions if d.needs_erase]

    # More than half the erase work this plan needed simply isn't available
    # — compose alone can no longer make this ad legible. Report it as a
    # signal, never act on it automatically (Global Constraints: no
    # automatic quality gate on publication — a human decides).
    letterbox_recommended = needed > 0 and (downgraded / needed) > 0.5

    return replace(
        plan_result, decisions=decisions, states=states, plate_request=plate_request,
        warnings=warnings, letterbox_recommended=letterbox_recommended,
    )


# ---------------------------------------------------------------------------
# Rendering — Pillow only, no ffmpeg (Task 8 turns this plan into argv)
# ---------------------------------------------------------------------------


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    try:
        r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
        return r, g, b
    except (ValueError, IndexError):
        return _DEFAULT_BACKGROUND_COLOUR


def _paint_background(
    canvas: Image.Image, stage_box: Box, background_hex: str | None,
    fallback_frame: Image.Image | None,
) -> str:
    """Fills `canvas` (already RGBA, fully transparent) with the card, then
    punches the stage box back out to fully transparent — the video shows
    through there. Returns which background source was actually used, for
    the caller's own reporting.
    """
    width, height = canvas.size
    if background_hex:
        card = Image.new("RGBA", (width, height), (*_hex_to_rgb(background_hex), 255))
        source = "hex"
    elif fallback_frame is not None:
        # A STILL frame, blurred ONCE here in Pillow — never a moving blur
        # (module docstring): one contrast measurement cannot certify 600
        # frames of luminance under a headline. No ffmpeg call: the frame
        # itself is the caller's responsibility to extract (Task 8's job).
        radius = max(width, height) * 0.03
        card = fallback_frame.convert("RGB").resize((width, height), Image.LANCZOS)
        card = card.filter(ImageFilter.GaussianBlur(radius=radius)).convert("RGBA")
        source = "blurred_fallback_frame"
    else:
        card = Image.new("RGBA", (width, height), (*_DEFAULT_BACKGROUND_COLOUR, 255))
        source = "flat_default"

    canvas.paste(card, (0, 0))
    hole = Image.new("RGBA", (max(1, round(stage_box.width)), max(1, round(stage_box.height))),
                      (0, 0, 0, 0))
    canvas.paste(hole, (round(stage_box.x0), round(stage_box.y0)))
    return source


def _measure(
    draw: ImageDraw.ImageDraw, item: RescueDecision, panel_h: int, max_w: int, scale: float,
) -> tuple[typography.ImageFont.FreeTypeFont, list[str], int, int, float]:
    """One item's (font, wrapped lines, line height, block height, cap_px)
    at `scale` of its nominal cap height — clamped so it never drops below
    ``ROLE_FLOOR_VIDEO[item.role]``, the per-role floor for OUR OWN drawn
    type (module docstring's "which copy gets rescued" section is explicit
    that this is a DIFFERENT question from `item.floor_px`, the OOH floor
    that decided whether the ORIGINAL burned-in text needed rescuing at all —
    conflating the two clamps every role, `legal` included, up to the SAME
    ~4%-of-panel-height number regardless of its own much smaller nominal
    size, which manufactures a block far taller than any band can ever hold
    and drops nearly everything). `role_floor_stem_px` already validated
    this floor at plan time for every item reaching here (`_rescue_decisions`
    drops anything that fails it before it is ever `active`), so clamping to
    it here can never regress below the 4:2:0 stem-survival minimum.
    """
    nominal = (
        typography.ROLE_HEIGHT.get(item.role, typography.ROLE_HEIGHT[_FALLBACK_ROLE]) * panel_h
    )
    role_floor_px = (
        typography.ROLE_FLOOR_VIDEO.get(item.role, typography.ROLE_FLOOR_VIDEO[_FALLBACK_ROLE])
        * panel_h
    )
    cap_px = max(nominal * scale, role_floor_px)
    em_size = max(typography.MIN_FONT_PX, round(cap_px / typography.CAP_RATIO))
    text = (item.text or item.role).strip() or item.role
    font = typography.load_font(item.font_family, 700, em_size, text)
    lines = typography.wrap(draw, text, font, max_w)
    line_h = typography.line_height(font)
    return font, lines, line_h, line_h * len(lines), cap_px


def _band_height(measured: list[tuple]) -> float:
    """Total vertical space `measured` items would occupy stacked with the
    inter-item gap this module always draws — including one trailing gap
    past the last item, which makes this a slightly CONSERVATIVE estimate
    (a small safety margin, not an exact footprint)."""
    return sum(
        block_h + round(line_h * _ITEM_GAP_FRACTION) for _, _, line_h, block_h, _ in measured
    )


def _draw_band(
    draw: ImageDraw.ImageDraw,
    items: list[RescueDecision],
    x0: float, y0: float, width: float, height: float,
    panel_h: int,
    background_rgb: tuple[int, int, int],
    align: Literal["center", "left"] = "center",
    vertical: Literal["top", "middle"] = "top",
) -> list[str]:
    """Stacks `items`' copy inside the `[x0,y0,x0+width,y0+height)` band — a
    wide, short header/footer strip or the tall single side column landscape
    now uses, this function does not care which; `width` is simply the wrap
    width `typography.wrap`/`_measure` line-break against, so an 840px column
    wraps on its own terms and a 1920px band wraps on its own, both through
    the same code path. Copy WE place gets `geometry.SAFE_AREA_PLACED` (the
    fuller 10% convention) rather than burned-in text's 5% — this is our own
    layout decision, not a correction of the advertiser's, so it earns the
    fuller broadcast margin (see `geometry.py`).

    `align`/`vertical` default to the ORIGINAL top/bottom-band behaviour
    (each line centred in the wrap width, the stack anchored at the band's
    own top) so portrait output is byte-for-byte unaffected. `render_state`
    passes `align="left", vertical="middle"` only for the landscape single
    column — left-aligned reads as one column of copy rather than a
    centred-per-line jumble, and centring the BLOCK vertically (computed
    below, after any shrink) rather than anchoring it at the top uses the
    column's full height instead of stranding the stack up near the panel's
    top edge.

    Sized in two passes, mirroring the image path's own `fit_to_budget`
    idiom (CLAUDE.md rule 2b: shrink the WHOLE block together to keep the
    hierarchy, rather than truncating or silently dropping content): first
    at nominal size; if that overflows the band, every item in it is
    re-measured at one shared shrink factor (clamped per item at its own
    legibility floor — see `_measure`) before anything is drawn. A one-shot
    linear estimate, not an iterative solve: `typography.wrap`'s line count
    can only drop (never rise) as a font shrinks for the same text and
    width, so re-measuring at the estimated scale cannot come back WORSE
    than the estimate that produced it.

    An item that STILL doesn't fit after that shared shrink is at its
    legibility floor (`_measure` clamps every item to its own role's
    `ROLE_FLOOR_VIDEO`) with nowhere left to go — the video analogue of the
    image path's own
    SACRIFICE_ORDER, which drops the least-important block rather than
    running text off the edge. Overlapping the footage was the earlier
    behaviour here ("drawn anyway") and it is exactly the defect the
    operator caught ("ADMISSIONS OPEN AY 2026 – 27" across the logo and the
    subject) — so the item is skipped, not drawn, and why is recorded. The
    cursor is left where it was rather than advanced past the skipped item,
    so a smaller, lower-priority item later in the stack (`legal`, say)
    still gets a chance at whatever room is left — this only ever helps: no
    item's own size depends on what did or didn't get drawn before it.
    """
    warnings: list[str] = []
    if not items or height <= 1 or width <= 1:
        return warnings

    inset = geometry.safe_area(width, height, geometry.SAFE_AREA_PLACED)
    band_x0, band_y0 = x0 + inset.x0, y0 + inset.y0
    band_x1, band_y1 = x0 + inset.x1, y0 + inset.y1
    max_w = max(1, round(band_x1 - band_x0))
    available = band_y1 - band_y0

    measured = [_measure(draw, item, panel_h, max_w, 1.0) for item in items]
    nominal_total = _band_height(measured)
    if nominal_total > available > 0:
        scale = available / nominal_total
        measured = [_measure(draw, item, panel_h, max_w, scale) for item in items]

    cursor = band_y0
    if vertical == "middle":
        # Centre the whole stack in the band, using its ACTUAL (possibly
        # shrunk) height, not the pre-shrink estimate — the same reasoning
        # `_build_stage`'s margin measurement uses: decide from the real
        # placement, not from a number that might not be what got drawn.
        actual_total = _band_height(measured)
        cursor = band_y0 + max(0.0, (available - actual_total) / 2)

    for item, (font, lines, line_h, block_h, cap_px) in zip(items, measured, strict=True):
        if cursor + block_h > band_y1:
            warnings.append(
                f"shot {item.shot_index} role {item.role!r}: dropped — no room left in "
                f"its band even at the legibility floor (needs {block_h:.0f}px, "
                f"{max(0.0, band_y1 - cursor):.0f}px left); not drawn over the stage"
            )
            continue

        original_colour = _hex_to_rgb(item.color_hex) if item.color_hex else _DEFAULT_TEXT_COLOUR
        colour = typography.readable_on_video(original_colour, background_rgb)
        if colour != original_colour:
            warnings.append(
                f"shot {item.shot_index} role {item.role!r}: colour {original_colour} "
                f"failed the luma gate against background {background_rgb}; swapped to {colour}"
            )
        outline_width, outline_fill = typography.outline_for(colour, background_rgb, cap_px)

        for line in lines:
            if align == "left":
                lx = band_x0
            else:
                line_w = draw.textlength(line, font=font)
                lx = band_x0 + max(0.0, (max_w - line_w) / 2)
            draw.text((lx, cursor), line, font=font, fill=colour,
                       stroke_width=outline_width, stroke_fill=outline_fill)
            cursor += line_h
        cursor += round(line_h * _ITEM_GAP_FRACTION)

    return warnings


def render_state(
    plan_result: ComposePlan,
    state: CopyState,
    background_hex: str | None,
    fallback_frame: Image.Image | None = None,
) -> RenderedState:
    """One copy state's full-panel RGBA PNG: the card (flat colour or a
    blurred fallback still — see `_paint_background`) everywhere except the
    stage box, which is left fully transparent for the actual cropped/scaled
    video to show through (Task 8's job), plus every active, rescued,
    non-dropped region's copy drawn around it — in top/bottom bands
    (portrait) or in a SINGLE left/right column (landscape), following
    `plan_result.stage.orientation`/`.copy_side` exactly (decided once, in
    `_build_stage`, from where the panel's leftover space actually is and
    which side the subject faces away from — never re-decided here, so this
    can never draw a layout that disagrees with what the plan itself
    reports).

    Deliberately takes `background_hex` again rather than reading only
    `plan_result.background_mode`: a caller re-rendering several states of
    the SAME plan calls this once per state, and passing the value directly
    (instead of stashing it on the immutable `ComposePlan`) keeps this
    function the only place that decides how the card actually gets painted.
    """
    panel_w, panel_h = plan_result.target_w, plan_result.target_h
    canvas = Image.new("RGBA", (panel_w, panel_h), (0, 0, 0, 0))
    background_source = _paint_background(canvas, plan_result.stage.box, background_hex,
                                            fallback_frame)
    draw = ImageDraw.Draw(canvas)

    active = [plan_result.decisions[i] for i in state.active]
    header = sorted((d for d in active if d.role in _HEADER_ROLES),
                     key=lambda d: _ROLE_ORDER.get(d.role, len(_ROLE_ORDER)))
    footer = sorted((d for d in active if d.role not in _HEADER_ROLES),
                     key=lambda d: _ROLE_ORDER.get(d.role, len(_ROLE_ORDER)))

    background_rgb = _hex_to_rgb(background_hex) if background_hex else _DEFAULT_BACKGROUND_COLOUR
    stage_box = plan_result.stage.box

    warnings: list[str] = []
    if plan_result.stage.orientation == "left_right":
        # ONE column, on the side `_build_stage` chose (`copy_side`), holding
        # EVERY active role in the same header-then-footer reading order the
        # top/bottom layout uses — not split header/footer either side of the
        # stage, which is the two-narrow-columns defect this replaced (see
        # `_build_stage`'s comment: 420px each, too narrow for the headline
        # or the CTA). The column gets the FULL leftover width, left-aligned
        # and vertically centred as a block (`align`/`vertical` below) rather
        # than the per-line-centred, top-anchored stacking the header/footer
        # bands use, which is what makes it read as one designed block of
        # copy instead of a top/bottom band rotated sideways.
        column = sorted(active, key=lambda d: _ROLE_ORDER.get(d.role, len(_ROLE_ORDER)))
        copy_side = plan_result.stage.copy_side or "right"
        if copy_side == "left":
            band_x0, band_width = 0, stage_box.x0
        else:
            band_x0, band_width = stage_box.x1, panel_w - stage_box.x1
        warnings += _draw_band(draw, column, band_x0, 0, band_width, panel_h, panel_h,
                                background_rgb, align="left", vertical="middle")
    else:
        warnings += _draw_band(draw, header, 0, 0, panel_w, stage_box.y0, panel_h, background_rgb)
        warnings += _draw_band(draw, footer, 0, stage_box.y1, panel_w, panel_h - stage_box.y1,
                                panel_h, background_rgb)
    if background_source == "flat_default" and background_hex is None and fallback_frame is None:
        warnings.append(
            "no background_hex and no fallback_frame supplied; painted a flat neutral "
            "default card instead of refusing to render"
        )

    return RenderedState(image=canvas, warnings=warnings)
